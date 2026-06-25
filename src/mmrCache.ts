import { google } from 'googleapis';

export interface MmrPlayerRow {
  player: string;
  mmr: string;
  rank: string;
  games: string;
  wins: string;
  losses: string;
  delta: string;
}

let cachedMmrData: MmrPlayerRow[] | null = null;
let prefetchTimer: NodeJS.Timeout | null = null;

export async function prefetchMmr(): Promise<void> {
  // Clear any existing timer to avoid overlapping schedules
  if (prefetchTimer) {
    clearTimeout(prefetchTimer);
    prefetchTimer = null;
  }

  const SPREADSHEET_ID = process.env.MMR_SPREADSHEET_ID || '1lJrTw9okwrOi9CyzLr_M3ecYi8cDcG4m-4Gtx-NsgCQ';
  const GID = process.env.MMR_SHEET_GID || '558216310';
  const TTL_MS = parseInt(process.env.MMR_CACHE_TTL_MS || '300000', 10);

  try {
    console.log(`[MMR Cache] Starting MMR prefetch from spreadsheet: ${SPREADSHEET_ID}, tab GID: ${GID}`);
    
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Get spreadsheet metadata to map GID to sheet title
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets.properties',
    });

    const targetSheet = spreadsheet.data.sheets?.find(
      s => String(s.properties?.sheetId) === String(GID)
    );

    if (!targetSheet || !targetSheet.properties?.title) {
      throw new Error(`Sheet tab with GID ${GID} not found in spreadsheet.`);
    }

    const sheetTitle = targetSheet.properties.title;
    console.log(`[MMR Cache] Mapped GID ${GID} to sheet title: "${sheetTitle}"`);

    // 2. Fetch sheet values using the title as the range
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetTitle,
    });

    const rawRows = response.data.values;
    if (!rawRows || rawRows.length === 0) {
      throw new Error('Spreadsheet returned empty data.');
    }

    // 3. Normalize headers to lowercase/trimmed keys and map to MmrPlayerRow objects
    const headers = rawRows[0].map(col => col.toLowerCase().trim());
    const parsed: MmrPlayerRow[] = [];

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      // Skip completely empty rows
      if (row.length === 0 || row.every(cell => !cell.trim())) {
        continue;
      }

      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = (row[index] || '').trim();
      });
      parsed.push(obj as MmrPlayerRow);
    }

    cachedMmrData = parsed;
    console.log(`[MMR Cache] Successfully loaded ${parsed.length} rows of MMR data.`);
  } catch (error: any) {
    console.error('[MMR Cache] Failed to prefetch MMR data:', error.message || error);
  } finally {
    // Schedule next prefetch (prefetch-on-expiry)
    prefetchTimer = setTimeout(() => {
      prefetchMmr();
    }, TTL_MS);
  }
}

export function getGlobalMmrData(): Promise<MmrPlayerRow[] | null> {
  // If the cache is empty, we prefetch immediately on-demand
  return new Promise<MmrPlayerRow[] | null>((resolve) => {
    if (!cachedMmrData) {
      console.log('[MMR Cache] Cache is empty. Fetching on-demand...');
      prefetchMmr()
        .then(() => resolve(cachedMmrData))
        .catch(() => resolve(null));
    } else {
      resolve(cachedMmrData);
    }
  });
}

export async function initMmrCache(): Promise<void> {
  const SPREADSHEET_ID = process.env.MMR_SPREADSHEET_ID || '1lJrTw9okwrOi9CyzLr_M3ecYi8cDcG4m-4Gtx-NsgCQ';
  if (!SPREADSHEET_ID) {
    console.warn('[MMR Cache] WARNING: MMR_SPREADSHEET_ID is not configured. MMR caching is disabled.');
    return;
  }

  // Trigger initial prefetch in the background
  prefetchMmr().catch(err => {
    console.error('[MMR Cache] Initial background prefetch failed:', err);
  });
}
