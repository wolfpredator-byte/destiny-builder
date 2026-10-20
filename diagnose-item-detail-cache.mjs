/**
 * Destiny Builder — SYNC-2c cache diagnostics, READ ONLY.
 * No Bungie requests, no writes, no identifiers, account keys, token values,
 * usernames, file paths or detail payloads printed.
 * Node 24+ (node:sqlite).
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const home = homedir();
const root = process.platform === 'win32'
  ? process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  : process.env.XDG_DATA_HOME || join(home, '.local', 'share');
const databasePath = join(root, 'DestinyBuilder', 'item-details-v1.sqlite');

console.log('SYNC-2c READ-ONLY CACHE AUDIT');
console.log(`Runtime: ${process.version}; SQLite database exists: ${existsSync(databasePath)}`);
if (!existsSync(databasePath)) {
  console.log('Finding: No database file at the application default path.');
  process.exit(0);
}
if (!isAbsolute(databasePath)) throw new Error('Expected absolute SQLite path');
console.log(`Database size bytes: ${statSync(databasePath).size}`);
let db;
try {
  db = new DatabaseSync(databasePath, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('inventory_instances','item_details')").all();
  const names = new Set(tables.map((row) => row.name));
  console.log(`Schema present: ${names.has('inventory_instances') && names.has('item_details')}`);
  if (!names.has('inventory_instances') || !names.has('item_details')) process.exit(0);
  const total = db.prepare(`SELECT COUNT(*) AS instance_count, COUNT(DISTINCT account_key) AS partitions,
    COALESCE(SUM(CASE WHEN present=1 THEN 1 ELSE 0 END),0) active,
    COALESCE(SUM(CASE WHEN present=0 THEN 1 ELSE 0 END),0) inactive
    FROM inventory_instances`).get();
  const saved = db.prepare('SELECT COUNT(*) details FROM item_details').get();
  const matching = db.prepare(`SELECT COUNT(*) matching FROM inventory_instances i
    JOIN item_details d ON i.account_key=d.account_key AND i.instance_id=d.instance_id
    WHERE i.present=1 AND i.item_hash=d.item_hash`).get();
  const now = Date.now();
  const cutoff = now - 6*60*60*1000;
  const eligible = db.prepare(`SELECT COUNT(*) eligible FROM inventory_instances i
    JOIN item_details d ON i.account_key=d.account_key AND i.instance_id=d.instance_id
    WHERE i.present=1 AND i.item_hash=d.item_hash
      AND (i.component_fingerprint IS NULL OR i.component_fingerprint=d.component_fingerprint)
      AND d.fetched_at_ms>=? AND d.fetched_at_ms<=?`).get(cutoff, now);
  const changed = db.prepare(`SELECT COUNT(*) changed FROM inventory_instances i
    JOIN item_details d ON i.account_key=d.account_key AND i.instance_id=d.instance_id
    WHERE i.present=1 AND i.item_hash=d.item_hash
      AND i.component_fingerprint IS NOT NULL AND i.component_fingerprint IS NOT d.component_fingerprint`).get();
  console.log(`Account partitions: ${Number(total.partitions)}`);
  console.log(`Indexed instances: ${Number(total.instance_count)} (active ${Number(total.active)}, inactive ${Number(total.inactive)})`);
  console.log(`Saved details: ${Number(saved.details)}`);
  console.log(`Matching active details: ${Number(matching.matching)}`);
  console.log(`Fingerprint-changed details: ${Number(changed.changed)}`);
  console.log(`Cache-eligible within 6h: ${Number(eligible.eligible)}`);
  console.log('No local data was modified. No private identifiers were printed.');
} catch (error) {
  console.log(`Read-only audit failed: ${error instanceof Error ? error.name : 'unknown error'}`);
  console.log('No account data or detail payloads were printed.');
  process.exitCode = 1;
} finally {
  db?.close();
}
