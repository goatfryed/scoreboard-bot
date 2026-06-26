import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js';
import { whitelistUser } from '../database.js';

export const whitelistCommand = new SlashCommandBuilder()
  .setName('nw-mmr-whitelist')
  .setDescription('Maps a Discord user to their in-game character name for MMR lookup')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setIntegrationTypes([0])
  .setContexts([0])
  .addUserOption(option =>
    option.setName('user')
      .setDescription('The Discord user to whitelist')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('character')
      .setDescription('Their in-game character name (defaults to their Discord username)')
      .setRequired(false)
  );

export async function handleWhitelist(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  const whitelistStr = process.env.SERVER_WHITELIST || '';
  const whitelistedGuilds = whitelistStr
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

  const primaryGuildId = whitelistedGuilds[0];

  if (!guildId || guildId !== primaryGuildId) {
    await interaction.reply({
      content: '❌ Error: This command is only available on the primary whitelisted server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const characterOption = interaction.options.getString('character')?.trim();
  const characterName = characterOption || targetUser.username;

  try {
    await whitelistUser(targetUser.id, characterName);
    await interaction.reply({
      content: `✅ Successfully whitelisted <@${targetUser.id}> as in-game character **${characterName}**.`,
      flags: MessageFlags.Ephemeral
    });
  } catch (error: any) {
    console.error(`[Whitelist] Failed to whitelist user ${targetUser.id} as ${characterName}:`, error);
    await interaction.reply({
      content: `❌ Error: Failed to save whitelist mapping. Details: ${error.message || error}`,
      flags: MessageFlags.Ephemeral
    });
  }
}
