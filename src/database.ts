import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

export interface GuildConfig {
  guildId: string;
  targetChannelId: string | null;
  mode: string | null;
  sheetsUrl: string | null;
  resolutions: string | null; // Comma-separated list (e.g. "1920,2560")
  errorChannelId: string | null;
  pingRoleId: string | null;
}

export interface Submission {
  guildId: string;
  messageId: string | null;
  mode: string;
  parseWorkflowRunId: number | null;
  screenshotWorkflowRunId: number | null;
}

let db: Database<sqlite3.Database, sqlite3.Statement> | null = null;

export async function initDatabase(): Promise<void> {
  const dbPath = path.join(process.cwd(), 'database.sqlite');
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS configurations (
      guildId TEXT PRIMARY KEY,
      targetChannelId TEXT,
      mode TEXT,
      sheetsUrl TEXT,
      resolutions TEXT,
      errorChannelId TEXT,
      pingRoleId TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS streamer_resolutions (
      guildId TEXT,
      streamerName TEXT,
      resolution TEXT,
      PRIMARY KEY (guildId, streamerName)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      guildId TEXT PRIMARY KEY,
      messageId TEXT,
      mode TEXT,
      parseWorkflowRunId INTEGER,
      screenshotWorkflowRunId INTEGER
    )
  `);

  // Migration: Add pingRoleId column if it does not exist in an already existing table
  try {
    await db.exec('ALTER TABLE configurations ADD COLUMN pingRoleId TEXT');
  } catch (error: any) {
    // Ignore error if the column already exists
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      throw error;
    }
  }
}

export async function getConfiguration(guildId: string): Promise<GuildConfig | null> {
  if (!db) throw new Error('Database not initialized');
  const result = await db.get<GuildConfig>(
    'SELECT guildId, targetChannelId, mode, sheetsUrl, resolutions, errorChannelId, pingRoleId FROM configurations WHERE guildId = ?',
    guildId
  );
  return result || null;
}

export async function setConfiguration(config: GuildConfig): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.run(
    `INSERT OR REPLACE INTO configurations (guildId, targetChannelId, mode, sheetsUrl, resolutions, errorChannelId, pingRoleId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    config.guildId,
    config.targetChannelId,
    config.mode,
    config.sheetsUrl,
    config.resolutions,
    config.errorChannelId,
    config.pingRoleId
  );
}

export async function setStreamerResolution(guildId: string, streamerName: string, resolution: string): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.run(
    `INSERT OR REPLACE INTO streamer_resolutions (guildId, streamerName, resolution)
     VALUES (?, ?, ?)`,
    guildId,
    streamerName.toLowerCase(),
    resolution
  );
}

export async function getStreamerResolution(guildId: string, streamerName: string): Promise<string | null> {
  if (!db) throw new Error('Database not initialized');
  const result = await db.get<{ resolution: string }>(
    'SELECT resolution FROM streamer_resolutions WHERE guildId = ? AND streamerName = ?',
    guildId,
    streamerName.toLowerCase()
  );
  return result ? result.resolution : null;
}

export async function deleteStreamerResolution(guildId: string, streamerName: string): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.run(
    'DELETE FROM streamer_resolutions WHERE guildId = ? AND streamerName = ?',
    guildId,
    streamerName.toLowerCase()
  );
}

export async function getLastSubmission(guildId: string): Promise<Submission | null> {
  if (!db) throw new Error('Database not initialized');
  const result = await db.get<Submission>(
    'SELECT guildId, messageId, mode, parseWorkflowRunId, screenshotWorkflowRunId FROM submissions WHERE guildId = ?',
    guildId
  );
  return result || null;
}

export async function setSubmission(submission: Submission): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.run(
    `INSERT OR REPLACE INTO submissions (guildId, messageId, mode, parseWorkflowRunId, screenshotWorkflowRunId)
     VALUES (?, ?, ?, ?, ?)`,
    submission.guildId,
    submission.messageId,
    submission.mode,
    submission.parseWorkflowRunId,
    submission.screenshotWorkflowRunId
  );
}

export async function updateSubmission(guildId: string, updates: Partial<Omit<Submission, 'guildId'>>): Promise<void> {
  if (!db) throw new Error('Database not initialized');

  const fields = Object.keys(updates);
  if (fields.length === 0) return;

  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => (updates as any)[field]);

  await db.run(
    `UPDATE submissions SET ${setClause} WHERE guildId = ?`,
    ...values,
    guildId
  );
}

export async function deleteConfiguration(guildId: string): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  await db.run('DELETE FROM configurations WHERE guildId = ?', guildId);
}
