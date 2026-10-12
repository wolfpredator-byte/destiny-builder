#!/usr/bin/env node
/**
 * MF-B1a: Italian SQLite Proof of Concept
 * 
 * This script demonstrates downloading and inspecting the official Bungie Manifest
 * in Italian (SQLite format) using only Node.js built-in modules.
 * 
 * Manual execution only - no automatic integration with the application.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, unlink, rename, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';

// Configuration
const BUNGIE_API_ROOT = 'https://www.bungie.net/Platform';
const MANIFEST_DIR = join(tmpdir(), 'destiny-builder-manifest-it');
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50MB limit
const MAX_DB_SIZE = 512 * 1024 * 1024; // 512MB limit for extracted DB

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Get Manifest information from Bungie API
 */
async function getManifestInfo(apiKey) {
  const response = await fetch(`${BUNGIE_API_ROOT}/Destiny2/Manifest/`, {
    headers: {
      'X-API-Key': apiKey,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch manifest info: ${response.status}`);
  }

  const data = await response.json();

  if (data.ErrorCode !== 1) {
    throw new Error(`Bungie API error: ${data.Message}`);
  }

  const version = data.Response?.version;
  const italianPath = data.Response?.mobileWorldContentPaths?.it;

  if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version) ||
      typeof italianPath !== 'string' || !italianPath.startsWith('/common/destiny2_content/sqlite/it/') ||
      !italianPath.endsWith('.content') || italianPath.includes('..')) {
    throw new Error('Invalid Manifest version or Italian SQLite path');
  }

  return { version, italianPath };
}

/**
 * Download the Italian Manifest .content file
 */
async function downloadItalianManifest(italianPath, apiKey) {
  const url = new URL(italianPath, 'https://www.bungie.net');
  if (url.protocol !== 'https:' || url.hostname !== 'www.bungie.net' ||
      !url.pathname.startsWith('/common/destiny2_content/sqlite/it/') ||
      !url.pathname.endsWith('.content') || url.search || url.hash) {
    throw new Error('Unsafe Bungie Manifest asset URL');
  }
  log(`Downloading from: ${url}`, colors.cyan);

  // The static asset is public; never send the Bungie API key to an asset or redirect.
  const response = await fetch(url, { redirect: 'error' });

  if (!response.ok) {
    throw new Error(`Failed to download manifest: ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_DOWNLOAD_SIZE) {
    throw new Error(`Download too large: ${contentLength} bytes`);
  }

  const buffer = await response.arrayBuffer();

  if (buffer.byteLength > MAX_DOWNLOAD_SIZE) {
    throw new Error(`Downloaded file too large: ${buffer.byteLength} bytes`);
  }

  return Buffer.from(buffer);
}

/**
 * Extract .content file (it's a ZIP archive containing SQLite database)
 * Extracts to a temporary path for validation before publishing
 */
async function extractManifest(contentBuffer, contentPath, tempOutputPath) {
  log(`Examining file format...`, colors.cyan);

  // Check file signature
  const header = contentBuffer.subarray(0, 4);
  const headerHex = header.toString('hex');
  
  if (headerHex === '504b0304') {
    log('File format: ZIP archive', colors.green);
  } else if (headerHex === '1f8b') {
    log('File format: GZIP', colors.green);
    throw new Error('GZIP format not supported; should be ZIP');
  } else if (headerHex === '53514c69') {
    log('File format: SQLite database (already extracted)', colors.green);
    await writeFile(tempOutputPath, contentBuffer);
    return contentBuffer.length;
  } else {
    log(`File format: Unknown (header: ${headerHex})`, colors.yellow);
    throw new Error('Unknown file format');
  }

  log(`Extracting ZIP archive using PowerShell...`, colors.cyan);

  try {
    // Write the .content file temporarily for PowerShell to read
    await writeFile(contentPath, contentBuffer);

    // Use PowerShell with .NET ZipArchive to extract without renaming extension
    const extractDir = join(MANIFEST_DIR, 'extract');
    await mkdir(extractDir, { recursive: true });

    const psContentPath = contentPath.replaceAll("'", "''");
    const psExtractDir = extractDir.replaceAll("'", "''");
    const psScript = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $zip = [System.IO.Compression.ZipFile]::OpenRead('${psContentPath}')
      $entries = $zip.Entries
      $dbEntry = $null
      $totalSize = 0
      $matchingEntries = 0
      if ($entries.Count -gt 64) { throw 'Too many ZIP entries' }
      foreach ($entry in $entries) {
        $totalSize += $entry.Length
        if ($totalSize -gt ${MAX_DB_SIZE * 2}) { throw 'ZIP total expanded size exceeded' }
        if ($entry.Name -match '\\.(db|sqlite|content)$' -or $entry.Name -eq 'content') {
          if ($entry.FullName -ne $entry.Name -or $entry.Name -match '[\\/]') { throw 'Unsafe ZIP entry path' }
          $matchingEntries += 1
          $dbEntry = $entry
        }
      }
      if ($matchingEntries -ne 1) { throw 'Expected exactly one SQLite entry' }
      
      if (-not $dbEntry) {
        $zip.Dispose()
        Write-Error "No SQLite database file found in archive"
        exit 1
      }
      
      if ($dbEntry.Length -gt ${MAX_DB_SIZE}) {
        $zip.Dispose()
        Write-Error "Database entry too large: $($dbEntry.Length) bytes"
        exit 1
      }
      
      $extractPath = Join-Path '${psExtractDir}' $dbEntry.Name
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($dbEntry, $extractPath, $true)
      $zip.Dispose()
      Write-Output "$extractPath|$($dbEntry.Length)|$totalSize"
    `;

    const extractedPath = await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-Command', psScript], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`PowerShell extraction failed: ${stderr || error.message}`));
        } else {
          const output = stdout.trim();
          if (!output) {
            reject(new Error('PowerShell returned no output'));
          } else {
            resolve(output);
          }
        }
      });
    });

    // Parse output: path|dbSize|totalSize
    const [path, dbSizeStr, totalSizeStr] = extractedPath.split('|');
    const dbSize = parseInt(dbSizeStr, 10);
    const totalSize = parseInt(totalSizeStr, 10);

    log(`Archive total size: ${totalSize} bytes`, colors.cyan);
    log(`Database entry size: ${dbSize} bytes`, colors.cyan);
    log(`Compression ratio: ${((1 - contentBuffer.length / totalSize) * 100).toFixed(1)}%`, colors.cyan);

    // Read the extracted database
    const extractedBuffer = await readFile(path);

    if (extractedBuffer.length > MAX_DB_SIZE) {
      throw new Error(`Extracted database too large: ${extractedBuffer.length} bytes`);
    }

    log(`Actual extracted size: ${extractedBuffer.length} bytes`, colors.cyan);

    // Verify SQLite header
    const dbHeader = extractedBuffer.subarray(0, 16);
    const dbHeaderStr = dbHeader.toString('utf8');
    if (!dbHeaderStr.startsWith('SQLite format 3')) {
      throw new Error(`Invalid SQLite header: ${dbHeaderStr}`);
    }

    // Copy to temporary path (not final location)
    await writeFile(tempOutputPath, extractedBuffer);
    
    // Cleanup extraction directory
    const fs = await import('node:fs');
    await fs.promises.rm(extractDir, { recursive: true, force: true });

    log(`Extracted ${extractedBuffer.length} bytes to ${tempOutputPath}`, colors.green);
    return extractedBuffer.length;
  } catch (error) {
    throw new Error(`Failed to extract manifest: ${error.message}`);
  }
}

/**
 * Validate the extracted SQLite database before publishing
 */
async function validateDatabase(dbPath) {
  log(`Validating database...`, colors.cyan);
  const { DatabaseSync } = await import('node:sqlite');
  
  let db = null;

  try {
    // Open in read-only mode
    db = new DatabaseSync(dbPath, { readOnly: true });

    // Check SQLite integrity
    const integrityCheck = db.prepare("PRAGMA quick_check;").get();
    log(`SQLite integrity check: ${integrityCheck.quick_check}`, colors.cyan);
    if (integrityCheck.quick_check !== 'ok') {
      throw new Error(`SQLite integrity check failed: ${integrityCheck.quick_check}`);
    }

    // Check for required tables
    const requiredTables = [
      'DestinyInventoryItemDefinition',
      'DestinyStatDefinition',
      'DestinyPlugSetDefinition',
      'DestinySandboxPerkDefinition',
      'DestinyEquipableItemSetDefinition',
    ];

    const tablesStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
    const tables = tablesStmt.all();
    const tableNames = tables.map((row) => row.name);

    log(`Tables found: ${tables.length}`, colors.cyan);
    for (const table of requiredTables) {
      const exists = tableNames.includes(table);
      if (!exists) {
        throw new Error(`Required table missing: ${table}`);
      }
      log(`  ✓ ${table}`, colors.green);
    }

    // Try a real lookup
    const sampleItem = db.prepare("SELECT * FROM DestinyInventoryItemDefinition LIMIT 1;").get();
    if (!sampleItem) {
      throw new Error('Database appears to be empty');
    }

    if (typeof sampleItem.json !== 'string') {
      throw new Error('Sample InventoryItem has no JSON definition');
    }
    const itemJson = JSON.parse(sampleItem.json);
    if (!Number.isInteger(itemJson.hash)) {
      throw new Error('Sample InventoryItem JSON has an invalid hash');
    }
    log(`Sample lookup succeeded: ${itemJson.displayProperties?.name || 'N/A'}`, colors.green);

    log(`Database validation passed`, colors.green);
    return true;
  } finally {
    if (db) {
      db.close();
    }
  }
}

/**
 * Open and inspect SQLite database using node:sqlite
 */
async function inspectDatabase(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  
  log(`Opening database: ${dbPath}`, colors.cyan);
  const openStart = Date.now();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const openTime = Date.now() - openStart;
  log(`Database opened in ${openTime}ms`, colors.green);

  try {
    // First, inspect table structure
    log('\n--- Table structure inspection ---', colors.cyan);
    
    const inventoryItemInfo = db.prepare("PRAGMA table_info(DestinyInventoryItemDefinition);").all();
    log('DestinyInventoryItemDefinition columns:', colors.cyan);
    inventoryItemInfo.forEach(col => log(`  - ${col.name} (${col.type})`));

    const statInfo = db.prepare("PRAGMA table_info(DestinyStatDefinition);").all();
    log('DestinyStatDefinition columns:', colors.cyan);
    statInfo.forEach(col => log(`  - ${col.name} (${col.type})`));

    // Check record counts
    const itemCount = db.prepare("SELECT COUNT(*) as count FROM DestinyInventoryItemDefinition;").get();
    const statCount = db.prepare("SELECT COUNT(*) as count FROM DestinyStatDefinition;").get();
    log(`\nRecord counts:`, colors.cyan);
    log(`  InventoryItem: ${itemCount.count} records`, colors.green);
    log(`  Stat: ${statCount.count} records`, colors.green);

    // Read some sample records to understand structure
    log('\n--- Sample records ---', colors.cyan);
    
    const sampleItem = db.prepare("SELECT * FROM DestinyInventoryItemDefinition LIMIT 1;").get();
    if (sampleItem) {
      log('Sample InventoryItem keys:', colors.cyan);
      Object.keys(sampleItem).forEach(key => log(`  - ${key}`));
      if (sampleItem.json) {
        const itemJson = JSON.parse(sampleItem.json);
        log(`Sample item hash in JSON: ${itemJson.hash}`, colors.green);
        log(`Sample item name: ${itemJson.displayProperties?.name || 'N/A'}`, colors.green);
      }
    }

    const sampleStat = db.prepare("SELECT * FROM DestinyStatDefinition LIMIT 1;").get();
    if (sampleStat) {
      log('Sample Stat keys:', colors.cyan);
      Object.keys(sampleStat).forEach(key => log(`  - ${key}`));
      if (sampleStat.json) {
        const statJson = JSON.parse(sampleStat.json);
        log(`Sample stat hash in JSON: ${statJson.hash}`, colors.green);
        log(`Sample stat name: ${statJson.displayProperties?.name || 'N/A'}`, colors.green);
      }
    }

    // List all tables
    const tablesStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
    const tables = tablesStmt.all();
    log(`\nTables found (${tables.length}):`, colors.cyan);
    tables.forEach(row => log(`  - ${row.name}`));

    // Check for required tables
    const requiredTables = [
      'DestinyInventoryItemDefinition',
      'DestinyStatDefinition',
      'DestinyPlugSetDefinition',
      'DestinySandboxPerkDefinition',
      'DestinyEquipableItemSetDefinition',
    ];

    log('\nRequired tables check:', colors.cyan);
    const tableNames = tables.map(row => row.name);
    for (const table of requiredTables) {
      const exists = tableNames.includes(table);
      if (!exists) {
        throw new Error(`Required table missing: ${table}`);
      }
      log(`  ✓ ${table}`, colors.green);
    }

    // Perform some sample lookups using real hashes from the database
    log('\n--- Lookups using real database hashes ---', colors.cyan);

    // Get a real item hash from the database
    const realItem = db.prepare("SELECT * FROM DestinyInventoryItemDefinition LIMIT 1;").get();
    if (realItem && realItem.json) {
      const itemJson = JSON.parse(realItem.json);
      const realItemHash = itemJson.hash;
      const idColumn = realItem.id;
      
      log(`Testing with real item:`, colors.cyan);
      log(`  ID column value: ${idColumn}`, colors.cyan);
      log(`  JSON hash value: ${realItemHash}`, colors.cyan);
      
      // Try lookup by ID column
      const itemLookupStart = Date.now();
      const itemStmt = db.prepare(
        `SELECT json FROM DestinyInventoryItemDefinition WHERE id = ${idColumn}`
      );
      const itemResult = itemStmt.get();
      const itemLookupTime = Date.now() - itemLookupStart;

      if (itemResult) {
        const itemData = JSON.parse(itemResult.json);
        log(`  ✓ Lookup by ID succeeded`, colors.green);
        log(`    Name: ${itemData.displayProperties?.name || 'N/A'}`);
        log(`    Display name from Italian Manifest: ${itemData.displayProperties?.name || 'N/A'}`);
        log(`    Lookup time: ${itemLookupTime}ms`);
      } else {
        log(`  ✗ Lookup by ID failed`, colors.red);
      }
    }

    // Get a real stat hash from the database
    const realStat = db.prepare("SELECT * FROM DestinyStatDefinition LIMIT 1;").get();
    if (realStat && realStat.json) {
      const statJson = JSON.parse(realStat.json);
      const realStatHash = statJson.hash;
      const idColumn = realStat.id;
      
      log(`\nTesting with real stat:`, colors.cyan);
      log(`  ID column value: ${idColumn}`, colors.cyan);
      log(`  JSON hash value: ${realStatHash}`, colors.cyan);
      
      // Try lookup by ID column
      const statLookupStart = Date.now();
      const statStmt = db.prepare(
        `SELECT json FROM DestinyStatDefinition WHERE id = ${idColumn}`
      );
      const statResult = statStmt.get();
      const statLookupTime = Date.now() - statLookupStart;

      if (statResult) {
        const statData = JSON.parse(statResult.json);
        log(`  ✓ Lookup by ID succeeded`, colors.green);
        log(`    Name: ${statData.displayProperties?.name || 'N/A'}`);
        log(`    Display name from Italian Manifest: ${statData.displayProperties?.name || 'N/A'}`);
        log(`    Lookup time: ${statLookupTime}ms`);
      } else {
        log(`  ✗ Lookup by ID failed`, colors.red);
      }
    }

    // Test signed/unsigned conversion with a real large hash
    log('\n--- Large hash conversion test ---', colors.cyan);
    const largeItemQuery = db.prepare("SELECT * FROM DestinyInventoryItemDefinition WHERE id < 0 LIMIT 1;").get();
    if (largeItemQuery && largeItemQuery.json) {
      const largeItemJson = JSON.parse(largeItemQuery.json);
      const signedId = largeItemQuery.id;
      const unsignedHash = largeItemJson.hash;
      
      log(`Found item with negative ID:`, colors.cyan);
      log(`  Signed ID in SQLite: ${signedId}`, colors.cyan);
      log(`  Unsigned hash in JSON: ${unsignedHash}`, colors.cyan);
      log(`  Conversion check: ${signedId + 4294967296} (should equal ${unsignedHash})`, colors.cyan);
      
      if (signedId + 4294967296 === unsignedHash) {
        log(`  ✓ Signed/unsigned conversion verified`, colors.green);
      } else {
        log(`  ✗ Signed/unsigned conversion mismatch`, colors.red);
      }
    } else {
      log('No items with negative ID found in database', colors.yellow);
    }

    // Test repeated lookup performance with real hash
    if (realItem) {
      log('\n--- Performance test (10 repeated lookups) ---', colors.cyan);
      const perfStmt = db.prepare(`SELECT json FROM DestinyInventoryItemDefinition WHERE id = ${realItem.id}`);
      const perfStart = Date.now();
      for (let i = 0; i < 10; i++) {
        perfStmt.get();
      }
      const perfTime = Date.now() - perfStart;
      log(`  10 lookups in ${perfTime}ms (${(perfTime / 10).toFixed(2)}ms average)`, colors.green);
    }

  } finally {
    db.close();
    log('Database closed', colors.cyan);
  }
}

/**
 * Stream a checksum instead of loading another 345 MiB into memory.
 * This checksum identifies the validated DB bytes; it is not a Bungie signature.
 */
async function checksumFile(filePath) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}

async function exists(filePath) {
  try { await stat(filePath); return true; } catch (e) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
}

async function removeIfExists(filePath) {
  try { await unlink(filePath); } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
}

function publicationPaths(dbPath, metadataPath) {
  return {
    dbBackup: dbPath + '.backup',
    metadataBackup: metadataPath + '.backup',
    journal: join(dirname(dbPath), 'publication-in-progress.json'),
    journalTemp: join(dirname(dbPath), 'publication-in-progress.tmp'),
  };
}

/**
 * If the previous process crashed after starting publication, restore the old
 * pair from backups. Two renames cannot be atomic together; the journal makes
 * the next manually initiated run recover from this specific crash window.
 */
async function recoverPublication(dbPath, metadataPath) {
  const { dbBackup, metadataBackup, journal, journalTemp } = publicationPaths(dbPath, metadataPath);
  if (!(await exists(journal))) {
    // No publication began. Leftover backups are pre-transaction or post-commit.
    await removeIfExists(dbBackup);
    await removeIfExists(metadataBackup);
    await removeIfExists(journalTemp);
    return;
  }
  const record = JSON.parse(await readFile(journal, 'utf8'));
  if (typeof record?.hadDb !== 'boolean' || typeof record?.hadMetadata !== 'boolean') {
    throw new Error('Malformed publication journal; intervention required');
  }
  if (record.hadDb && !(await exists(dbBackup)) ||
      record.hadMetadata && !(await exists(metadataBackup))) {
    throw new Error('Publication backup missing; refusing unsafe recovery');
  }
  // Leave journal/backups on disk if recovery itself fails; retry next run.
  if (record.hadDb) await copyFile(dbBackup, dbPath);
  else await removeIfExists(dbPath);
  if (record.hadMetadata) await copyFile(metadataBackup, metadataPath);
  else await removeIfExists(metadataPath);
  await removeIfExists(journal);
  await removeIfExists(dbBackup);
  await removeIfExists(metadataBackup);
  await removeIfExists(journalTemp);
  log('Recovered the previous Manifest database + metadata pair', colors.yellow);
}

/** Backup + journal + rollback for failures during either rename. */
async function publishDatabase(tempDbPath, tempMetadataPath, dbPath, metadataPath, testing = {}) {
  const { dbBackup, metadataBackup, journal, journalTemp } = publicationPaths(dbPath, metadataPath);
  if (await exists(journal)) throw new Error('Unrecovered publication journal exists');
  const hadDb = await exists(dbPath);
  const hadMetadata = await exists(metadataPath);
  try {
    if (hadDb) await copyFile(dbPath, dbBackup);
    if (hadMetadata) await copyFile(metadataPath, metadataBackup);
    await writeFile(journalTemp, JSON.stringify({ hadDb, hadMetadata }));
    await rename(journalTemp, journal);
  } catch (error) {
    // No final file was touched before the journal was installed.
    if (!(await exists(journal))) {
      await removeIfExists(dbBackup);
      await removeIfExists(metadataBackup);
      await removeIfExists(journalTemp);
    }
    throw error;
  }
  try {
    await rename(tempDbPath, dbPath);
    if (testing.failAfterDbRename) throw new Error('Simulated metadata publication failure');
    await rename(tempMetadataPath, metadataPath);
    // Commit marker first; backup cleanup can safely be retried on next run.
    await removeIfExists(journal);
  } catch (error) {
    try {
      await recoverPublication(dbPath, metadataPath);
    } catch (recoveryError) {
      throw new Error(`Publication failed: ${error.message}; rollback incomplete: ${recoveryError.message}. Backups and journal retained.`);
    }
    throw new Error(`Publication failed and previous version restored: ${error.message}`);
  }
  try {
    await removeIfExists(dbBackup);
    await removeIfExists(metadataBackup);
  } catch (e) {
    log(`Committed pair is intact; old backup cleanup can be retried: ${e.message}`, colors.yellow);
  }
  log('Published validated database and metadata', colors.green);
}

/** No network and no real Manifest: tests invoke the actual publication helpers. */
async function runPublicationSelfTests() {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const testDir = await mkdtemp(join(tmpdir(), 'destiny-manifest-publication-test-'));
  const db = join(testDir, 'manifest-it.db');
  const meta = join(testDir, 'metadata.json');
  const candidateDb = join(testDir, 'candidate.db');
  const candidateMeta = join(testDir, 'candidate.json');
  try {
    await writeFile(db, 'old-db');
    await writeFile(meta, 'old-metadata');
    await writeFile(candidateDb, 'new-db');
    await writeFile(candidateMeta, 'new-metadata');
    let failed = false;
    try {
      await publishDatabase(candidateDb, candidateMeta, db, meta, { failAfterDbRename: true });
    } catch (error) {
      failed = error.message.includes('previous version restored');
    }
    if (!failed || await readFile(db, 'utf8') !== 'old-db' ||
        await readFile(meta, 'utf8') !== 'old-metadata') {
      throw new Error('Injected failure rollback test failed');
    }
    log('PASS: injected failure after DB rename restores old pair', colors.green);

    // Inject an interrupted process that had journal+backups but half-published pair.
    const { dbBackup, metadataBackup, journal } = publicationPaths(db, meta);
    await copyFile(db, dbBackup);
    await copyFile(meta, metadataBackup);
    await writeFile(journal, JSON.stringify({ hadDb: true, hadMetadata: true }));
    await writeFile(db, 'half-published-db');
    await recoverPublication(db, meta);
    if (await readFile(db, 'utf8') !== 'old-db' ||
        await readFile(meta, 'utf8') !== 'old-metadata') {
      throw new Error('Interrupted publication recovery test failed');
    }
    log('PASS: interrupted publication recovered from journal', colors.green);

    await writeFile(candidateDb, 'new-db');
    await publishDatabase(candidateDb, candidateMeta, db, meta);
    if (await readFile(db, 'utf8') !== 'new-db' ||
        await readFile(meta, 'utf8') !== 'new-metadata') {
      throw new Error('Successful publication test failed');
    }
    log('PASS: new DB and metadata committed together', colors.green);

    // Fresh installation without an old pair.
    await removeIfExists(db);
    await removeIfExists(meta);
    await writeFile(candidateDb, 'first-db');
    await writeFile(candidateMeta, 'first-metadata');
    await publishDatabase(candidateDb, candidateMeta, db, meta);
    if (await readFile(db, 'utf8') !== 'first-db' ||
        await readFile(meta, 'utf8') !== 'first-metadata') {
      throw new Error('First installation publication test failed');
    }
    log('PASS: initial publication without backups', colors.green);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

/**
 * Main execution
 */
async function main() {
  log('=== MF-B1c.1: Italian SQLite Manifest Publication ===', colors.cyan);
  const apiKey = process.env.BUNGIE_API_KEY;
  if (!apiKey) throw new Error('BUNGIE_API_KEY environment variable not set');

  await mkdir(MANIFEST_DIR, { recursive: true });
  const dbPath = join(MANIFEST_DIR, 'manifest-it.db');
  const metadataPath = join(MANIFEST_DIR, 'metadata.json');
  const tempDbPath = join(MANIFEST_DIR, 'manifest-it-temp.db');
  const tempMetadataPath = join(MANIFEST_DIR, 'metadata-temp.json');

  // Recover interrupted publication before trusting any local database.
  await recoverPublication(dbPath, metadataPath);

  const { version, italianPath } = await getManifestInfo(apiKey);
  log(`Manifest version: ${version}`, colors.green);
  log(`Italian path: ${italianPath}`, colors.green);

  let reuse = false;
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const fileStat = await stat(dbPath);
    if (metadata && metadata.version === version && metadata.italianPath === italianPath &&
        metadata.dbPath === dbPath && Number.isInteger(metadata.dbSize) &&
        metadata.dbSize > 0 && metadata.dbSize <= MAX_DB_SIZE && fileStat.size === metadata.dbSize) {
      await validateDatabase(dbPath);
      if (typeof metadata.dbSha256 === 'string') {
        if (await checksumFile(dbPath) !== metadata.dbSha256) throw new Error('Database checksum mismatch');
      }
      reuse = true;
      log(`Reusing verified Italian Manifest version ${version}`, colors.green);
    }
  } catch (e) {
    log(`Cannot reuse local Manifest: ${e.message}; preparing download`, colors.yellow);
  }

  if (!reuse) {
    try {
      const contentBuffer = await downloadItalianManifest(italianPath);
      log(`Downloaded ${contentBuffer.length} bytes`, colors.green);
      const contentPath = join(MANIFEST_DIR, 'manifest-it.content');
      await writeFile(contentPath, contentBuffer);
      const dbSize = await extractManifest(contentBuffer, contentPath, tempDbPath);
      const fileStat = await stat(tempDbPath);
      if (fileStat.size !== dbSize) throw new Error('Extracted database size mismatch');
      await validateDatabase(tempDbPath);
      const tempMetadata = {
        version, italianPath, dbPath, dbSize,
        dbSha256: await checksumFile(tempDbPath),
        preparedAt: new Date().toISOString(),
      };
      await writeFile(tempMetadataPath, JSON.stringify(tempMetadata, null, 2));
      await publishDatabase(tempDbPath, tempMetadataPath, dbPath, metadataPath);
    } finally {
      // Never touch the committed pair in cleanup.
      await removeIfExists(tempDbPath);
      await removeIfExists(tempMetadataPath);
    }
  }
  await inspectDatabase(dbPath);
  log('\n=== MF-B1c.1 completed successfully ===', colors.green);
}

if (process.argv.includes('--self-test')) {
  runPublicationSelfTests().catch(e => { console.error(e); process.exitCode = 1; });
} else {
  main().catch(e => { log(`\nError: ${e.message}`, colors.red); process.exitCode = 1; });
}
