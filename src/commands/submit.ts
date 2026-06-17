import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  MessageFlags,
  AttachmentBuilder,
  TextChannel
} from 'discord.js';
import { getConfiguration, getStreamerResolution, setSubmission, updateSubmission } from '../database.js';
import { dispatchWorkflow, pollWorkflowRun, downloadArtifacts } from '../github.js';

export const submitCommand = new SlashCommandBuilder()
  .setName('scoreboard-submit')
  .setDescription('Submits a twitch clip to the scoreboard processing pipeline')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(option =>
    option.setName('clip')
      .setDescription('Twitch clip URL')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('resolution')
      .setDescription('The resolution of the video')
      .setAutocomplete(true)
      .setRequired(false)
  );

// Track active workflow runs per server to prevent concurrent submissions
const activeSubmissions = new Set<string>();

function extractStreamer(url: string): string | null {
  const match = url.match(/twitch\.tv\/([a-zA-Z0-9_\-]+)\/clip\//i);
  return match ? match[1].toLowerCase() : null;
}

export async function handleSubmit(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'Error: This command can only be used within a server (guild).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (activeSubmissions.has(guildId)) {
    await interaction.reply({
      content: '⚠️ A scoreboard is currently being processed for this server. Please wait for the current run to complete before submitting another.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const config = await getConfiguration(guildId);

  if (!config || !config.mode || !config.sheetsUrl || !config.resolutions || !config.targetChannelId) {
    await interaction.reply({
      content: 'This server is not fully configured yet. An administrator must run `/scoreboard-setup` (technical connection) and `/scoreboard-configure` (communication channels) first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const clipUrl = interaction.options.getString('clip', true).trim();
  let resolution = interaction.options.getString('resolution')?.trim();

  if (!resolution) {
    const streamer = extractStreamer(clipUrl);
    if (!streamer) {
      await interaction.reply({
        content: '❌ Error: Could not determine the streamer name from the Twitch clip URL. Please specify the `resolution` parameter manually.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const defaultRes = await getStreamerResolution(guildId, streamer);
    if (!defaultRes) {
      await interaction.reply({
        content: `❌ Error: No default resolution is configured for streamer **${streamer}**. Please specify the \`resolution\` parameter manually, or configure a default using \`/scoreboard-resolution\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    resolution = defaultRes;
  }

  const finalMode = `${config.mode}${resolution}`;

  console.log(`[Submit] User ${interaction.user.tag} (${interaction.user.id}) submitted clip ${clipUrl} for server ${interaction.guild?.name || guildId} (${guildId}) with mode ${finalMode}`);

  // Acquire lock
  activeSubmissions.add(guildId);

  try {
    const runId = await dispatchWorkflow({ clip_url: clipUrl, mode: finalMode });

    await setSubmission({
      guildId,
      messageId: null,
      mode: finalMode,
      parseWorkflowRunId: runId,
      screenshotWorkflowRunId: null
    });

    await interaction.reply({
      content: 'Accepted, please await processing...',
      flags: MessageFlags.Ephemeral,
    });

    // Run the processing pipeline in the background
    processWorkflowInBackground(runId, config, clipUrl, interaction.user.id, interaction.client);
  } catch (error: any) {
    // Release lock on immediate dispatch failure
    activeSubmissions.delete(guildId);
    console.error(`[Submit Failed] ${interaction.user.tag}(${interaction.user.id})@${interaction.guild?.name || guildId}: Failed to dispatch workflow:`, error);
    await interaction.reply({
      content: `Error: Failed to trigger the processing pipeline. Details: ${error.message || error}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'resolution') {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }

    const config = await getConfiguration(guildId);
    if (!config || !config.resolutions) {
      await interaction.respond([]);
      return;
    }

    const availableResolutions = config.resolutions
      .split(',')
      .map(r => r.trim())
      .filter(r => r.length > 0);

    const filtered = availableResolutions.filter(res =>
      res.toLowerCase().includes(focusedOption.value.toLowerCase())
    );

    await interaction.respond(
      filtered.map(res => ({ name: res, value: res })).slice(0, 25)
    );
  }
}

async function processWorkflowInBackground(
  runId: number,
  config: any,
  clipUrl: string,
  userId: string,
  client: any
): Promise<void> {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  const serverName = guild?.name || config.guildId;

  try {
    await pollWorkflowRun(runId);
    const files = await downloadArtifacts(runId);

    const targetChannel = await client.channels.fetch(config.targetChannelId) as TextChannel;
    if (!targetChannel) {
      throw new Error(`Target channel ${config.targetChannelId} could not be found.`);
    }

    const attachments = files.map(file =>
      new AttachmentBuilder(file.buffer, { name: file.name })
    );

    const ping = config.pingRoleId ? `<@&${config.pingRoleId}> ` : '';
    const message = await targetChannel.send({
      content: `Stats are up!\n` +
        `- 📊 [Google Sheets](${config.sheetsUrl})\n` +
        `- 🎬 [Source Clip](${clipUrl})\n` +
        `${ping}`,
      files: attachments,
    });

    console.log(`[Submit Success] @${serverName}: Parse succeeded. Message ID: ${message.id}`);

    try {
      await updateSubmission(config.guildId, { messageId: message.id });
    } catch (dbErr) {
      console.error('Failed to update submission message ID in database:', dbErr);
    }
  } catch (error: any) {
    const errorMessage = `Scoreboard submission processing failed.\n` +
      `- **Clip**: ${clipUrl}\n` +
      `- **Error**: ${error.message || error}`;

    console.error(`[Submit Failed] @${serverName}: Parse failed. Error: ${error.message || error}`);

    // Notify submitting user via DM
    try {
      const user = await client.users.fetch(userId);
      if (user) {
        await user.send(`❌ Your scoreboard submission failed:\n` +
          `- **Clip**: ${clipUrl}\n` +
          `- **Reason**: ${error.message || error}`);
      }
    } catch (dmError) {
      console.warn(`Could not send failure DM to user ${userId}:`, dmError);
    }

    // Notify error channel if configured
    if (config.errorChannelId) {
      try {
        const errorChannel = await client.channels.fetch(config.errorChannelId) as TextChannel;
        if (errorChannel) {
          await errorChannel.send(`❌ **Pipeline Error**\n${errorMessage}`);
        }
      } catch (chanError) {
        console.error(`Could not send error log to channel ${config.errorChannelId}:`, chanError);
      }
    }
  } finally {
    // Always release lock when processing finishes
    activeSubmissions.delete(config.guildId);
  }
}
