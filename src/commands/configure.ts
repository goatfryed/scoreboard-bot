import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, ChannelType, MessageFlags } from 'discord.js';
import { getConfiguration, setConfiguration } from '../database.js';

export const configureCommand = new SlashCommandBuilder()
  .setName('scoreboard-configure')
  .setDescription('Configures the communication settings for the server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(option =>
    option.setName('channel')
      .setDescription('The target channel where screenshots and sheet links will be posted')
      .setRequired(true)
  )
  .addChannelOption(option =>
    option.setName('error_channel')
      .setDescription('The channel where processing error messages will be sent')
      .setRequired(false)
  )
  .addRoleOption(option =>
    option.setName('ping_role')
      .setDescription('The role to ping when stats are posted')
      .setRequired(false)
  );

export async function handleConfigure(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'Error: This command can only be used within a server (guild).',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetChannel = interaction.options.getChannel('channel', true);
  const errorChannel = interaction.options.getChannel('error_channel');
  const pingRole = interaction.options.getRole('ping_role');

  if (targetChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Error: The target channel must be a text channel.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (errorChannel && errorChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Error: The error channel must be a text channel.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    const existingConfig = await getConfiguration(guildId);

    await setConfiguration({
      guildId,
      targetChannelId: targetChannel.id,
      errorChannelId: errorChannel ? errorChannel.id : null,
      pingRoleId: pingRole ? pingRole.id : null,
      mode: existingConfig ? existingConfig.mode : null,
      sheetsUrl: existingConfig ? existingConfig.sheetsUrl : null,
      resolutions: existingConfig ? existingConfig.resolutions : null,
    });

    await interaction.reply({
      content: `Server communication settings saved successfully!\n` +
        `- **Target Channel**: <#${targetChannel.id}>\n` +
        `- **Error Channel**: ${errorChannel ? `<#${errorChannel.id}>` : '*None configured*'}\n` +
        `- **Ping Role**: ${pingRole ? `<@&${pingRole.id}>` : '*None configured*'}`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('Error saving server configuration:', error);
    await interaction.reply({
      content: 'An error occurred while saving the configuration.',
      flags: MessageFlags.Ephemeral
    });
  }
}
