import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags
} from 'discord.js';
import { getWhitelistUser } from '../database.js';
import { getGlobalMmrData, prefetchMmr, MmrPlayerRow } from '../mmrCache.js';

export const statusCommand = new SlashCommandBuilder()
  .setName('nw-mmr-status')
  .setDescription('Displays your current MMR and leaderboard rank details')
  .setIntegrationTypes([0, 1]) // 0: GuildInstall, 1: UserInstall
  .setContexts([0, 1, 2]); // 0: Guild, 1: BotDM, 2: PrivateChannel

function cleanPlayerName(name: string): string {
  return name.replace(/^\||\|$/g, '').trim().toLowerCase();
}

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  // Retrieve whitelisted character name
  const whitelistedName = await getWhitelistUser(userId);
  if (!whitelistedName) {
    await interaction.reply({
      content: '❌ You do not have a registered in-game character name. Please request MMR access from an administrator.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    const mmrData = await getGlobalMmrData();

    if (!mmrData || mmrData.length === 0) {
      await interaction.reply({
        content: '❌ Error: MMR leaderboard data is currently unavailable. Please ask a bot administrator to check the configuration.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Find the player's row
    const targetCleanName = cleanPlayerName(whitelistedName);
    const playerRow = mmrData.find(row => cleanPlayerName(row.player || '') === targetCleanName);

    if (!playerRow) {
      await interaction.reply({
        content: `Lock in, <@${userId}>! Grind some OPRs. No matches found.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Extract values directly from the typed object keys
    const mmrStr = playerRow.mmr || '0';

    // Count all ranked players (players with rank not equal to 0)
    const rankedPlayersCount = mmrData.filter(row => {
      const r = parseInt(row.rank || '0', 10);
      return !isNaN(r) && r !== 0;
    }).length;

    const rankVal = parseInt(playerRow.rank || '0', 10);
    const isUnranked = isNaN(rankVal) || rankVal === 0;
    const rankStr = isUnranked ? 'Unranked. Play more!' : `${playerRow.rank}/${rankedPlayersCount}`;

    const gamesStr = playerRow.games || '0';
    const winsStr = playerRow.wins || '0';
    const lossesStr = playerRow.losses || '0';
    const rawDelta = playerRow.delta || '0';

    // Calculate Win Rate
    const gNum = parseFloat(gamesStr) || 0;
    const wNum = parseFloat(winsStr) || 0;
    const winRateVal = gNum > 0 ? (wNum / gNum) * 100 : 0;
    const winRateStr = `${winRateVal.toFixed(1)}%`;

    // Format Delta (+ prefix for positive numeric values)
    let deltaStr = rawDelta.trim();
    if (!deltaStr.startsWith('+') && !deltaStr.startsWith('-')) {
      const dNum = parseFloat(deltaStr);
      if (!isNaN(dNum) && dNum > 0) {
        deltaStr = `+${deltaStr}`;
      }
    }

    // Format fields with aligned padding (keys padded to 16 characters including 2 spaces prefix)
    const formattedLines = [
      `  MMR:`.padEnd(16) + mmrStr,
      `  Rank:`.padEnd(16) + rankStr,
      `  Games Played:`.padEnd(16) + gamesStr,
      `  Wins:`.padEnd(16) + winsStr,
      `  Losses:`.padEnd(16) + lossesStr,
      `  Win Rate:`.padEnd(16) + winRateStr,
      `  Delta:`.padEnd(16) + deltaStr,
    ];

    await interaction.reply({
      content: `\`\`\`\n${formattedLines.join('\n')}\n\`\`\``,
      flags: MessageFlags.Ephemeral
    });
  } catch (error: any) {
    console.error(`[Status Command] Failed to fetch or process MMR details for ${whitelistedName}:`, error);
    await interaction.reply({
      content: `❌ Error: Failed to retrieve MMR details. Details: ${error.message || error}`,
      flags: MessageFlags.Ephemeral
    });
  }
}
