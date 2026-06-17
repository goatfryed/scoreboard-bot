import { SlashCommandBuilder, PermissionFlagsBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

// Load env files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export const setupCommand = new SlashCommandBuilder()
  .setName('scoreboard-setup')
  .setDescription('Configures the technical scoreboard connection settings')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
  process.argv[1].endsWith('register')
);

if (isDirectRun) {
  registerCommands();
}
