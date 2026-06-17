import { SlashCommandBuilder, PermissionFlagsBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';

// Load env files
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export const configureCommand = new SlashCommandBuilder()
  .setName('scoreboard-configure')
  .setDescription('Configures scoreboard bot settings for a channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(option =>
    option.setName('channel')
      .setDescription('The target channel where screenshots and sheet links will be posted')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('mode')
      .setDescription('The prefix for the workflow mode (e.g. opr, zoo)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('sheets_url')
      .setDescription('The URL of the Google Sheet')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('resolutions')
      .setDescription('Comma-separated list of allowed resolutions (e.g. 1920,2560)')
      .setRequired(true)
  )
  .addChannelOption(option =>
    option.setName('error_channel')
      .setDescription('The channel where processing error messages will be sent')
      .setRequired(false)
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
      .setRequired(true)
  );

export const commands = [configureCommand, submitCommand];

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    console.error('ERROR: DISCORD_TOKEN and DISCORD_CLIENT_ID must be set to register commands.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands.map(cmd => cmd.toJSON()) }
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
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
