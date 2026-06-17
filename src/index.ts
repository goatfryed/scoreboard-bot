import { 
  Client, 
  GatewayIntentBits, 
  Interaction, 
  ChannelType, 
  TextChannel, 
  AttachmentBuilder
} from 'discord.js';
import dotenv from 'dotenv';
import { 
  initDatabase, 
  getConfiguration, 
  setConfiguration 
} from './database.js';
import { 
  dispatchWorkflow, 
  pollWorkflowRun, 
  downloadArtifacts 
} from './github.js';

// Load env files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', async () => {
  try {
    await initDatabase();
    console.log(`Bot logged in as ${client.user?.tag} and database initialized.`);
  } catch (error) {
    console.error('Failed to initialize database during startup:', error);
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'scoreboard-configure') {
      await handleConfigure(interaction);
    } else if (interaction.commandName === 'scoreboard-submit') {
      await handleSubmit(interaction);
    }
  } else if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'scoreboard-submit') {
      await handleAutocomplete(interaction);
    }
  }
});

async function handleConfigure(interaction: any): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ 
      content: 'Error: This command can only be used within a server (guild).', 
      ephemeral: true 
    });
    return;
  }

  const targetChannel = interaction.options.getChannel('channel', true);
  const mode = interaction.options.getString('mode', true).trim();
  const sheetsUrl = interaction.options.getString('sheets_url', true).trim();
  const resolutions = interaction.options.getString('resolutions', true).trim();
  const errorChannel = interaction.options.getChannel('error_channel');

  if (targetChannel.type !== ChannelType.GuildText) {
    await interaction.reply({ 
      content: 'Error: The target channel must be a text channel.', 
      ephemeral: true 
    });
    return;
  }

  if (errorChannel && errorChannel.type !== ChannelType.GuildText) {
    await interaction.reply({ 
      content: 'Error: The error channel must be a text channel.', 
      ephemeral: true 
    });
    return;
  }

  try {
    await setConfiguration({
      guildId,
      targetChannelId: targetChannel.id,
      mode,
      sheetsUrl,
      resolutions,
      errorChannelId: errorChannel ? errorChannel.id : null,
    });

    await interaction.reply({
      content: `Configuration successfully saved for this server!\n` +
               `- **Target Channel**: <#${targetChannel.id}>\n` +
               `- **Mode**: \`${mode}\`\n` +
               `- **Sheets URL**: <${sheetsUrl}>\n` +
               `- **Resolutions**: \`${resolutions}\`\n` +
               `- **Error Channel**: ${errorChannel ? `<#${errorChannel.id}>` : '*None configured*'}`,
      ephemeral: true,
    });
  } catch (error) {
    console.error('Error saving server configuration:', error);
    await interaction.reply({ 
      content: 'An error occurred while saving the configuration.', 
      ephemeral: true 
    });
  }
}

async function handleSubmit(interaction: any): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'Error: This command can only be used within a server (guild).',
      ephemeral: true,
    });
    return;
  }

  const config = await getConfiguration(guildId);

  if (!config) {
    await interaction.reply({
      content: 'This server is not configured yet. An administrator must configure it first using `/scoreboard-configure`.',
      ephemeral: true,
    });
    return;
  }

  const clipUrl = interaction.options.getString('clip', true).trim();
  const resolution = interaction.options.getString('resolution', true).trim();
  const finalMode = `${config.mode}${resolution}`;

  try {
    const runId = await dispatchWorkflow(clipUrl, finalMode);

    await interaction.reply({
      content: 'Accepted, please await processing...',
      ephemeral: false,
    });

    // Run the processing pipeline in the background
    processWorkflowInBackground(runId, config, clipUrl, interaction.user.id);
  } catch (error: any) {
    console.error('Failed to dispatch workflow:', error);
    await interaction.reply({
      content: `Error: Failed to trigger the processing pipeline. Details: ${error.message || error}`,
      ephemeral: true,
    });
  }
}

async function handleAutocomplete(interaction: any): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  if (focusedOption.name === 'resolution') {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }

    const config = await getConfiguration(guildId);
    if (!config) {
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
  userId: string
): Promise<void> {
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

    await targetChannel.send({
      content: `### New Scoreboard Processed!\n` +
               `- **Sheets**: <${config.sheetsUrl}>\n` +
               `- **Clip**: <${clipUrl}>`,
      files: attachments,
    });
  } catch (error: any) {
    const errorMessage = `Scoreboard submission processing failed.\n` +
                         `- **Clip**: ${clipUrl}\n` +
                         `- **Error**: ${error.message || error}`;

    console.error(errorMessage);

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
  }
}

const token = process.env.DISCORD_TOKEN;
if (token) {
  client.login(token).catch(err => {
    console.error('Error logging in to Discord:', err);
  });
} else {
  console.warn('WARNING: DISCORD_TOKEN is not defined in the environment. Bot will not login.');
}
