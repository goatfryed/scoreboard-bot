import { Client, GatewayIntentBits, Interaction, Events } from 'discord.js';
import dotenv from 'dotenv';
import { initDatabase } from './database.js';
import { handleSetup } from './commands/setup.js';
import { handleConfigure } from './commands/configure.js';
import { handleResolution } from './commands/resolution.js';
import { handleSubmit, handleAutocomplete } from './commands/submit.js';
import { handleUpdate } from './commands/update.js';
import { handleWhitelist } from './commands/whitelist.js';
import { handleStatus } from './commands/status.js';
import { initMmrCache } from './mmrCache.js';

// Load env files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once(Events.ClientReady, async () => {
  try {
    await initDatabase();
    console.log(`Bot logged in as ${client.user?.tag} and database initialized.`);
    await initMmrCache();
  } catch (error) {
    console.error('Failed to initialize bot services during startup:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'scoreboard-setup') {
      await handleSetup(interaction);
    } else if (interaction.commandName === 'scoreboard-configure') {
      await handleConfigure(interaction);
    } else if (interaction.commandName === 'scoreboard-resolution') {
      await handleResolution(interaction);
    } else if (interaction.commandName === 'scoreboard-submit') {
      await handleSubmit(interaction);
    } else if (interaction.commandName === 'scoreboard-update') {
      await handleUpdate(interaction);
    } else if (interaction.commandName === 'nw-mmr-whitelist') {
      await handleWhitelist(interaction);
    } else if (interaction.commandName === 'nw-mmr-status') {
      await handleStatus(interaction);
    }
  } else if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'scoreboard-submit') {
      await handleAutocomplete(interaction);
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (token) {
  client.login(token).catch(err => {
    console.error('Error logging in to Discord:', err);
  });
} else {
  console.warn('WARNING: DISCORD_TOKEN is not defined in the environment. Bot will not login.');
}
