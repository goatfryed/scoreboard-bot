import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getConfiguration, setConfiguration } from '../database.js';

export const setupCommand = new SlashCommandBuilder()
  .setName('scoreboard-setup')
  .setDescription('Configures the technical scoreboard connection settings')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setIntegrationTypes([0])
  .setContexts([0])
  .addStringOption(option =>
    option.setName('mode')
      .setDescription('The processing rule set. Ask you bot admin which one to use.')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('sheets_url')
      .setDescription('The URL of the Google Sheet')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('resolutions')
      .setDescription('Comma-separated list of supported resolutions (e.g. 1920,2560)')
      .setRequired(true)
  );

export async function handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'Error: This command can only be used within a server (guild).',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const mode = interaction.options.getString('mode', true).trim();
  const sheetsUrl = interaction.options.getString('sheets_url', true).trim();
  const resolutions = interaction.options.getString('resolutions', true).trim();

  try {
    const existingConfig = await getConfiguration(guildId);

    await setConfiguration({
      guildId,
      mode,
      sheetsUrl,
      resolutions,
      targetChannelId: existingConfig ? existingConfig.targetChannelId : null,
      errorChannelId: existingConfig ? existingConfig.errorChannelId : null,
      pingRoleId: existingConfig ? existingConfig.pingRoleId : null,
    });

    await interaction.reply({
      content: `Technical scoreboard connection settings saved successfully!\n` +
        `- **Mode**: \`${mode}\`\n` +
        `- **Sheets URL**: <${sheetsUrl}>\n` +
        `- **Resolutions**: \`${resolutions}\``,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('Error saving server technical setup:', error);
    await interaction.reply({
      content: 'An error occurred while saving the technical setup.',
      flags: MessageFlags.Ephemeral
    });
  }
}
