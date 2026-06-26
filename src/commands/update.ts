import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  MessageFlags,
  AttachmentBuilder,
  TextChannel
} from 'discord.js';
import { getConfiguration, getLastSubmission, updateSubmission } from '../database.js';
import { dispatchWorkflow, pollWorkflowRun, downloadArtifacts } from '../github.js';

export const updateCommand = new SlashCommandBuilder()
  .setName('scoreboard-update')
  .setDescription('Updates the screenshots of the last scoreboard message')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setIntegrationTypes([0])
  .setContexts([0]);

// Track active updates per server to prevent concurrent runs
const activeUpdates = new Set<string>();

export async function handleUpdate(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'Error: This command can only be used within a server (guild).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (activeUpdates.has(guildId)) {
    await interaction.reply({
      content: '⚠️ An update is currently being processed for this server. Please wait for the current run to complete.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lastSub = await getLastSubmission(guildId);
  if (!lastSub || !lastSub.messageId || !lastSub.mode) {
    await interaction.reply({
      content: '❌ Error: No previous scoreboard submission was found for this server to update.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const config = await getConfiguration(guildId);
  if (!config || !config.targetChannelId) {
    await interaction.reply({
      content: '❌ Error: This server is not fully configured. Target channel is missing.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  console.log(`[Update] ${interaction.user.tag}(${interaction.user.id})@${interaction.guild?.name || guildId}: Submitted update`);

  // Acquire lock
  activeUpdates.add(guildId);

  try {
    // Dispatch the screenshot.yml workflow with the stored mode
    const runId = await dispatchWorkflow({ mode: lastSub.mode }, 'screenshot.yml');

    try {
      await updateSubmission(guildId, { screenshotWorkflowRunId: runId });
    } catch (dbErr) {
      console.error('Failed to update submission screenshot run ID in database:', dbErr);
    }

    await interaction.reply({
      content: 'Update accepted, please await processing...',
      flags: MessageFlags.Ephemeral,
    });

    // Run processing in background
    processUpdateInBackground(runId, lastSub, config, interaction.user.id, interaction.client);
  } catch (error: any) {
    activeUpdates.delete(guildId);
    console.error(`[Update Failed] ${interaction.user.tag}(${interaction.user.id})@${interaction.guild?.name || guildId}: Failed to dispatch update workflow:`, error);
    await interaction.reply({
      content: `Error: Failed to trigger the update pipeline. Details: ${error.message || error}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function processUpdateInBackground(
  runId: number,
  lastSub: any,
  config: any,
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

    const message = await targetChannel.messages.fetch(lastSub.messageId);
    if (!message) {
      throw new Error(`Could not find the last scoreboard message (ID: ${lastSub.messageId}) in the target channel.`);
    }

    // Keep only the 'scoreboard.png' or 'stitched.png' attachment from the original message
    const keptAttachments = message.attachments
      .filter(att => att.name === 'scoreboard.png' || att.name === 'stitched.png')
      .map(att => ({ id: att.id }));

    // Prepare the new screenshots (PNGs only)
    const newAttachments = files
      .filter(file => file.name.toLowerCase().endsWith('.png'))
      .map(file => new AttachmentBuilder(file.buffer, { name: file.name }));

    // Edit message: replace other attachments with the new screenshots, keeping the scoreboard image
    await message.edit({
      attachments: keptAttachments,
      files: newAttachments,
    });

    if (files.length > 0) {
      console.log(`[Update Success] @${serverName}: Screenshot update succeeded with ${files.length} screenshots.`);
    } else {
      console.warn(`[Update Warning] @${serverName}: Screenshot update succeeded but no screenshots were found in artifacts.`);
    }
  } catch (error: any) {
    const errorMessage = `Scoreboard update processing failed.\n` +
      `- **Error**: ${error.message || error}`;

    console.error(`[Update Failed] @${serverName}: Screenshot update failed. Error: ${error.message || error}`);

    // Notify submitting user via DM
    try {
      const user = await client.users.fetch(userId);
      if (user) {
        await user.send(`❌ Your scoreboard update failed:\n` +
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
          await errorChannel.send(`❌ **Update Pipeline Error**\n${errorMessage}`);
        }
      } catch (chanError) {
        console.error(`Could not send error log to channel ${config.errorChannelId}:`, chanError);
      }
    }
  } finally {
    // Release lock
    activeUpdates.delete(config.guildId);
  }
}
