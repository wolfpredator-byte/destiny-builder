/**
 * MF-B1b: Italian Manifest Reader
 * 
 * This module provides read-only access to the official Bungie Manifest
 * in Italian (SQLite format) downloaded during MF-B1a.
 * 
 * The database is NOT downloaded automatically by this module.
 * It must be present at the expected location from MF-B1a.
 */

/// <reference path="../../types/node-sqlite.d.ts" />

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Configuration
// Note: This module depends on the database downloaded by MF-B1a script.
// The database location and version metadata are managed separately by MF-B1a.
const MANIFEST_DIR = join(tmpdir(), 'destiny-builder-manifest-it');
const MANIFEST_DB_PATH = join(MANIFEST_DIR, 'manifest-it.db');

// Allowed table names for security
const ALLOWED_TABLES = new Set([
  'DestinyInventoryItemDefinition',
  'DestinyStatDefinition',
  'DestinyPlugSetDefinition',
  'DestinySandboxPerkDefinition',
  'DestinyEquipableItemSetDefinition',
]);

/**
 * Convert unsigned hash to signed integer for SQLite lookup
 * SQLite stores integers as signed, while Bungie hashes are unsigned 32-bit
 */
function unsignedToSigned(hash: number): number {
  if (hash > 2147483647) {
    return hash - 4294967296;
  }
  return hash;
}

/**
 * Validate hash is a safe unsigned 32-bit integer
 * Bungie hashes are in range 0-4294967295
 */
function validateHash(hash: number): void {
  if (typeof hash !== 'number') {
    throw new Error(`Invalid hash: must be number, got ${typeof hash}`);
  }
  if (isNaN(hash)) {
    throw new Error('Invalid hash: NaN');
  }
  if (!Number.isInteger(hash)) {
    throw new Error(`Invalid hash: must be integer, got ${hash}`);
  }
  if (hash < 0) {
    throw new Error(`Invalid hash: must be non-negative, got ${hash}`);
  }
  if (hash > 4294967295) {
    throw new Error(`Invalid hash: must be <= 4294967295, got ${hash}`);
  }
}

/**
 * Check if the Italian Manifest database exists and is accessible
 */
export async function isItalianManifestAvailable(): Promise<boolean> {
  try {
    await access(MANIFEST_DB_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the path to the Italian Manifest database
 */
export function getItalianManifestPath(): string {
  return MANIFEST_DB_PATH;
}

/**
 * Get a definition from the Italian Manifest by type and hash
 * 
 * @param definitionType - The table name (e.g., 'DestinyInventoryItemDefinition')
 * @param hash - The unsigned hash of the definition
 * @returns The JSON definition, or null if not found
 * @throws Error if table name is not allowed or database is not accessible
 */
export function getItalianDefinition(
  definitionType: string,
  hash: number
): unknown | null {
  // Validate table name
  if (!ALLOWED_TABLES.has(definitionType)) {
    throw new Error(`Unauthorized table: ${definitionType}`);
  }

  // Validate hash
  validateHash(hash);

  // Check if database exists (synchronous check)
  if (!existsSync(MANIFEST_DB_PATH)) {
    throw new Error('Italian Manifest database not found. Run MF-B1a script first.');
  }

  let db: DatabaseSync | null = null;

  try {
    // Open database in read-only mode
    db = new DatabaseSync(MANIFEST_DB_PATH, { readOnly: true });

    // Convert hash to signed for SQLite
    const signedHash = unsignedToSigned(hash);

    // Query the definition
    const stmt = db.prepare(
      `SELECT json FROM ${definitionType} WHERE id = ?`
    );
    const result = stmt.get(signedHash) as { json: string } | undefined;

    if (!result) {
      return null;
    }

    // Parse and return the JSON
    return JSON.parse(result.json);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in definition ${definitionType}:${hash}`);
    }
    throw error;
  } finally {
    if (db) {
      db.close();
    }
  }
}

/**
 * Get an Inventory Item definition from the Italian Manifest
 * 
 * @param itemHash - The unsigned hash of the item
 * @returns The item definition, or null if not found
 */
export function getItalianInventoryItemDefinition(itemHash: number): unknown | null {
  return getItalianDefinition('DestinyInventoryItemDefinition', itemHash);
}

/**
 * Get a Stat definition from the Italian Manifest
 * 
 * @param statHash - The unsigned hash of the stat
 * @returns The stat definition, or null if not found
 */
export function getItalianStatDefinition(statHash: number): unknown | null {
  return getItalianDefinition('DestinyStatDefinition', statHash);
}

/**
 * Get a Plug Set definition from the Italian Manifest
 * 
 * @param plugSetHash - The unsigned hash of the plug set
 * @returns The plug set definition, or null if not found
 */
export function getItalianPlugSetDefinition(plugSetHash: number): unknown | null {
  return getItalianDefinition('DestinyPlugSetDefinition', plugSetHash);
}

/**
 * Get a Sandbox Perk definition from the Italian Manifest
 * 
 * @param perkHash - The unsigned hash of the perk
 * @returns The perk definition, or null if not found
 */
export function getItalianSandboxPerkDefinition(perkHash: number): unknown | null {
  return getItalianDefinition('DestinySandboxPerkDefinition', perkHash);
}

/**
 * Get an Equipable Item Set definition from the Italian Manifest
 * 
 * @param itemSetHash - The unsigned hash of the item set
 * @returns The item set definition, or null if not found
 */
export function getItalianEquipableItemSetDefinition(itemSetHash: number): unknown | null {
  return getItalianDefinition('DestinyEquipableItemSetDefinition', itemSetHash);
}
