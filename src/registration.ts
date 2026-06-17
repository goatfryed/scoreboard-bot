import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { setupCommand } from './commands/setup.js';
import { configureCommand } from './commands/configure.js';
import { resolutionCommand } from './commands/resolution.js';
import { submitCommand } from './commands/submit.js';

// Load env files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export const commands = [setupCommand, configureCommand, resolutionCommand, submitCommand];

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const whitelistStr = process.env.SERVER_WHITELIST || '';
  const whitelistedGuilds = whitelistStr
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

  if (!token || !clientId) {
    console.error('ERROR: DISCORD_TOKEN and DISCORD_CLIENT_ID must be set to register commands.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Registering configure, setup, and resolution commands globally...');
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: [setupCommand.toJSON(), configureCommand.toJSON(), resolutionCommand.toJSON()] }
    );

    // Fetch all servers the bot is currently joined to
    console.log('Fetching bot guilds to manage command states...');
    let joinedGuilds: string[] = [];
    try {
      const guildsData = await rest.get(Routes.userGuilds()) as any[];
      joinedGuilds = guildsData.map(g => g.id);
    } catch (guildsError) {
      console.warn('Could not fetch joined guilds. Cleanup of removed servers will be skipped:', guildsError);
    }

    if (whitelistedGuilds.length > 0) {
      console.log(`Registering submit command to whitelisted guilds: ${whitelistedGuilds.join(', ')}`);

      // Register commands to whitelisted guilds
      for (const guildId of whitelistedGuilds) {
        try {
          await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: [submitCommand.toJSON()] }
          );
          console.log(`Successfully registered submit command to guild: ${guildId}`);
        } catch (guildError: any) {
          if (guildError.status === 403 || guildError.code === 50001) {
            console.warn(`WARNING: Failed to register submit command for guild ${guildId} (Missing Access). Ensure the bot is invited to this server with the 'applications.commands' scope.`);
          } else {
            console.error(`Failed to register submit command for guild ${guildId}:`, guildError);
          }
        }
      }

      // Automatically clean up commands from servers that were removed from the whitelist
      const guildsToClean = joinedGuilds.filter(id => !whitelistedGuilds.includes(id));
      if (guildsToClean.length > 0) {
        console.log(`Cleaning up commands from removed/unlisted guilds: ${guildsToClean.join(', ')}`);
        for (const guildId of guildsToClean) {
          try {
            await rest.put(
              Routes.applicationGuildCommands(clientId, guildId),
              { body: [] }
            );
            console.log(`Successfully cleared guild commands for guild: ${guildId}`);
          } catch (cleanError: any) {
            // Ignore 403s on cleanup since we may have been kicked from that server
            if (cleanError.status !== 403 && cleanError.code !== 50001) {
              console.error(`Failed to clear guild commands for guild ${guildId}:`, cleanError);
            }
          }
        }
      }
    } else {
      console.warn('WARNING: SERVER_WHITELIST is empty. The submit command will not be registered on any server.');

      // Clear commands from all joined guilds since whitelist is empty
      if (joinedGuilds.length > 0) {
        console.log(`Clearing guild commands from all servers: ${joinedGuilds.join(', ')}`);
        for (const guildId of joinedGuilds) {
          try {
            await rest.put(
              Routes.applicationGuildCommands(clientId, guildId),
              { body: [] }
            );
          } catch (cleanError) { }
        }
      }
    }

    console.log('Command registration process complete.');
  } catch (error) {
    console.error('Error during command registration:', error);
    process.exit(1);
  }
}

// Check if this file was executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('commands.ts') ||
  process.argv[1].endsWith('commands.js') ||
  process.argv[1].endsWith('registration.ts') ||
  process.argv[1].endsWith('registration.js') ||
  process.argv[1].endsWith('register')
);

if (isDirectRun) {
  registerCommands();
}
