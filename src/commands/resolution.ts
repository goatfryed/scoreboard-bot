import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { setStreamerResolution } from '../database.js';

export const resolutionCommand = new SlashCommandBuilder()
  .setName('scoreboard-resolution')
  .setDescription('Configures a default resolution for a specific streamer on this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(option =>
    option.setName('streamer')
      .setDescription('Twitch username of the streamer')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('resolution')
      .setDescription('The default resolution for this streamer (e.g. 1920)')
      .setRequired(true)
  );

export async function handleResolution(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: 'Error: This command can only be used within a server (guild).',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const streamer = interaction.options.getString('streamer', true).trim().toLowerCase();
  const resolution = interaction.options.getString('resolution', true).trim();

  try {
    await setStreamerResolution(guildId, streamer, resolution);
    await interaction.reply({
      content: `Default resolution for **${streamer}** set to \`${resolution}\`!`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('Error saving streamer resolution:', error);
    await interaction.reply({
      content: 'An error occurred while saving the streamer resolution.',
      flags: MessageFlags.Ephemeral
    });
  }
}
