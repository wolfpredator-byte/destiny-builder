/**
 * Destiny Builder — SYNC-1: local persistence boundary for item-instance details.
 * SERVER ONLY: do not import into React/client modules.
 *
 * This is a storage foundation, NOT automatic Bungie synchronization. Cache
 * content is never evidence of current equip state or installability.
 */
import { createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MAX_ITEMS_PER_SNAPSHOT = 10_000;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
// Hard expiration: aged evidence must NOT masquerade as current forever.
// Soft refresh is incremental and bounded by the client; see SYNC-3a.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const EQUIPPED_SOFT_REFRESH_MS = 6 * 60 * 60 * 1000;
const OTHER_SOFT_REFRESH_MS = 3 * 24 * 60 * 60 * 1000;
const UINT32_MAX = 0xffffffff;

export type ItemStoreScope = Readonly<{ membershipType: number; membershipId: string }>;
export type ItemStoreLocation = "equipped" | "characterInventory" | "vault" | "otherGuardian" | "unknown";
export type ObservedInstance = Readonly<{
  itemInstanceId: string;
  itemHash: number;
  category: "weapon" | "armor" | "artifact" | "other";
  location: ItemStoreLocation;
  /** Optional authoritative fingerprint from relevant LIVE components only. */
  componentFingerprint?: string | null;
}>;
export type InventoryCoverage = "full_account" | "partial";
export type StoredItemDetail = Readonly<Record<string, unknown> & { itemInstanceId: string; itemHash: number }>;
export type LookupResult =
  | { state: "not_current" | "missing" | "hash_mismatch" | "refresh_required"; detail: null }
  | { state: "cached_unverified"; detail: StoredItemDetail; fetchedAtMs: number; refreshRecommended: boolean };

const ALLOWED_DETAIL_FIELDS = [
  "name", "description", "icon", "itemTypeDisplayName", "itemType", "itemSubType",
  "category", "tierTypeName", "gearTier", "power", "damageType", "damageTypeHash",
  "stats", "armorStats", "armorStatTotal", "armorStatEvidence",
  "armorModifierAvailabilityEvidence", "selectedPerks", "perkColumns", "intrinsicPerks",
  "itemSet", "recoilDirection", "livePerks",
] as const;
const PRIVATE_FIELD = /(?:token|cookie|secret|password|authorization|membershipid|characterid|accountid|clientsecret)/i;

function validHash(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= UINT32_MAX;
}
function validInstance(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,22}$/.test(value) && value !== "0";
}
function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function accountKey(scope: ItemStoreScope): string {
  if (!scope || !Number.isSafeInteger(scope.membershipType) || scope.membershipType <= 0 ||
      typeof scope.membershipId !== "string" || !/^\d{1,22}$/.test(scope.membershipId) || scope.membershipId === "0") {
    throw new Error("Invalid account scope");
  }
  // Partitioning identifier; hashing is NOT encryption or anonymity.
  return createHash("sha256").update(`${scope.membershipType}:${scope.membershipId}`).digest("hex");
}
function normalizeFingerprint(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{8,128}$/.test(value)) {
    throw new Error("Invalid component fingerprint");
  }
  return value;
}
function copyJson(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 32) throw new Error("Detail nesting limit exceeded");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 500_000) throw new Error("Detail string limit exceeded");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Detail contains nonfinite numeric evidence");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value) || value.length > 30_000) throw new Error("Detail array invalid");
    seen.add(value);
    const out = value.map((entry) => copyJson(entry, depth + 1, seen));
    seen.delete(value);
    return out;
  }
  if (typeof value === "object" && value !== null &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    if (seen.has(value)) throw new Error("Circular detail reference");
    seen.add(value);
    const keys = Object.keys(value);
    if (keys.length > 10_000) throw new Error("Detail object too large");
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (PRIVATE_FIELD.test(key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = copyJson(item, depth + 1, seen);
    }
    seen.delete(value);
    return out;
  }
  throw new Error("Unsupported detail value");
}
function projectDetail(detail: StoredItemDetail): string {
  if (!detail || !validHash(detail.itemHash) || !validInstance(detail.itemInstanceId)) {
    throw new Error("Invalid detail identity");
  }
  const projected: Record<string, unknown> = { itemHash: detail.itemHash, itemInstanceId: detail.itemInstanceId };
  for (const field of ALLOWED_DETAIL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(detail, field) && detail[field] !== undefined) {
      projected[field] = copyJson(detail[field]);
    }
  }
  const serialized = JSON.stringify(projected);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("Detail exceeds size limit");
  return serialized;
}
export function defaultItemDetailDatabasePath(): string {
  const home = homedir();
  const root = process.platform === "win32"
    ? process.env.LOCALAPPDATA || join(home, "AppData", "Local")
    : process.env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(root, "DestinyBuilder", "item-details-v1.sqlite");
}

/** One store per server process (or an explicit disposable store in tests). */
export function openItemDetailStore(databasePath = defaultItemDetailDatabasePath()) {
  if (databasePath !== ":memory:" && !isAbsolute(databasePath)) throw new Error("Database path must be absolute");
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  if (databasePath !== ":memory:") {
    try { chmodSync(databasePath, 0o600); } catch { /* Windows ACLs are managed by Windows. */ }
  }
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  if (databasePath !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_instances (
      account_key TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      item_hash INTEGER NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      component_fingerprint TEXT,
      present INTEGER NOT NULL CHECK (present IN (0, 1)),
      last_observed_ms INTEGER NOT NULL,
      PRIMARY KEY (account_key, instance_id)
    );
    CREATE TABLE IF NOT EXISTS item_details (
      account_key TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      item_hash INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at_ms INTEGER NOT NULL,
      component_fingerprint TEXT,
      PRIMARY KEY (account_key, instance_id),
      FOREIGN KEY (account_key, instance_id)
        REFERENCES inventory_instances(account_key, instance_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_current_instances
      ON inventory_instances(account_key, present, category);
  `);
  let closed = false;
  const ensureOpen = () => { if (closed) throw new Error("Item detail store is closed"); };
  const snapshotUpsert = db.prepare(`
    INSERT INTO inventory_instances (account_key, instance_id, item_hash, category, location,
      component_fingerprint, present, last_observed_ms) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(account_key, instance_id) DO UPDATE SET
      item_hash=excluded.item_hash, category=excluded.category,
      location=excluded.location, component_fingerprint=excluded.component_fingerprint,
      present=1, last_observed_ms=excluded.last_observed_ms
  `);
  const markAbsent = db.prepare("UPDATE inventory_instances SET present=0 WHERE account_key=?");
  const invalidateDetail = db.prepare("DELETE FROM item_details WHERE account_key=? AND instance_id=?");
  const lookupInventory = db.prepare("SELECT item_hash, component_fingerprint, present FROM inventory_instances WHERE account_key=? AND instance_id=?");
  const deleteObsoleteDetail = db.prepare("DELETE FROM item_details WHERE account_key=? AND instance_id=? AND item_hash <> ?");
  const insertDetail = db.prepare(`
    INSERT INTO item_details (account_key, instance_id, item_hash, payload_json, fetched_at_ms, component_fingerprint)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_key, instance_id) DO UPDATE SET
      item_hash=excluded.item_hash, payload_json=excluded.payload_json,
      fetched_at_ms=excluded.fetched_at_ms, component_fingerprint=excluded.component_fingerprint
  `);
  const lookupDetail = db.prepare(`SELECT i.item_hash AS current_hash, i.component_fingerprint AS live_fingerprint,
    i.present AS present, i.location AS current_location, d.item_hash AS saved_hash, d.component_fingerprint AS saved_fingerprint,
    d.payload_json AS payload, d.fetched_at_ms AS fetched_at_ms
    FROM inventory_instances i LEFT JOIN item_details d
      ON d.account_key=i.account_key AND d.instance_id=i.instance_id
    WHERE i.account_key=? AND i.instance_id=?`);
  const pendingStmt = db.prepare(`SELECT i.instance_id, i.item_hash FROM inventory_instances i
    LEFT JOIN item_details d ON d.account_key=i.account_key AND d.instance_id=i.instance_id
    WHERE i.account_key=? AND i.present=1 AND (
      d.instance_id IS NULL OR i.item_hash<>d.item_hash OR
      (i.component_fingerprint IS NOT NULL AND
        (d.component_fingerprint IS NULL OR i.component_fingerprint<>d.component_fingerprint)) OR
      d.fetched_at_ms < ? OR d.fetched_at_ms > ?)
    ORDER BY CASE i.location WHEN 'equipped' THEN 0 WHEN 'characterInventory' THEN 1
      WHEN 'vault' THEN 2 ELSE 3 END, i.last_observed_ms ASC, i.instance_id ASC LIMIT ?`);
  const summaryStmt = db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN d.instance_id IS NOT NULL AND d.item_hash=i.item_hash THEN 1 ELSE 0 END), 0) AS cached
    FROM inventory_instances i LEFT JOIN item_details d
    ON d.account_key=i.account_key AND d.instance_id=i.instance_id
    WHERE i.account_key=? AND i.present=1`);
  return {
    /** Only full_account can make an absent instance inactive. Partial never infers deletion. */
    applyInventorySnapshot(scope: ItemStoreScope, entries: readonly ObservedInstance[],
      coverage: InventoryCoverage, observedAtMs = Date.now()) {
      ensureOpen();
      const key = accountKey(scope);
      if (coverage !== "partial" && coverage !== "full_account") throw new Error("Invalid snapshot coverage");
      if (!Array.isArray(entries) || entries.length > MAX_ITEMS_PER_SNAPSHOT || !validTime(observedAtMs)) {
        throw new Error("Invalid inventory snapshot");
      }
      const seen = new Set<string>();
      const normalized = entries.map((item) => {
        if (!item || !validInstance(item.itemInstanceId) || !validHash(item.itemHash) ||
            !["weapon", "armor", "artifact", "other"].includes(item.category) ||
            !["equipped", "characterInventory", "vault", "otherGuardian", "unknown"].includes(item.location) ||
            seen.has(item.itemInstanceId)) throw new Error("Ambiguous or invalid inventory instance");
        seen.add(item.itemInstanceId);
        return { ...item, componentFingerprint: normalizeFingerprint(item.componentFingerprint) };
      });
      db.exec("BEGIN IMMEDIATE");
      try {
        // Capture genuinely absent instances BEFORE the full-account sweep.
        // The sweep temporarily marks every row absent, so consulting `present`
        // afterwards would falsely classify every still-owned item as returned
        // and delete its valid detail on each refresh.
        const previouslyAbsent = new Set<string>();
        for (const item of normalized) {
          const previous = lookupInventory.get(key, item.itemInstanceId);
          if (previous?.present === 0) previouslyAbsent.add(item.itemInstanceId);
        }
        if (coverage === "full_account") markAbsent.run(key);
        for (const item of normalized) {
          snapshotUpsert.run(key, item.itemInstanceId, item.itemHash, item.category, item.location,
            item.componentFingerprint, observedAtMs);
          // Only an item absent BEFORE this snapshot may be a returned item.
          if (previouslyAbsent.has(item.itemInstanceId)) invalidateDetail.run(key, item.itemInstanceId);
          deleteObsoleteDetail.run(key, item.itemInstanceId, item.itemHash);
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return { observed: normalized.length, absenceReconciled: coverage === "full_account" };
    },
    /** A detail can be saved only for a matching presently observed instance. */
    saveDetail(scope: ItemStoreScope, detail: StoredItemDetail, fetchedAtMs = Date.now()) {
      ensureOpen();
      const key = accountKey(scope);
      if (!validTime(fetchedAtMs)) throw new Error("Invalid detail timestamp");
      const json = projectDetail(detail);
      const item = lookupInventory.get(key, detail.itemInstanceId);
      if (!item || item.present !== 1 || item.item_hash !== detail.itemHash) {
        throw new Error("Detail does not match a currently observed account instance");
      }
      insertDetail.run(key, detail.itemInstanceId, detail.itemHash, json, fetchedAtMs,
        item.component_fingerprint ?? null);
    },
    /** No record is ever labelled installable, or verified live, by being cached. */
    lookup(scope: ItemStoreScope, instanceId: string, expectedHash: number,
      options?: { nowMs?: number; maxAgeMs?: number }): LookupResult {
      ensureOpen();
      const key = accountKey(scope);
      if (!validInstance(instanceId) || !validHash(expectedHash)) throw new Error("Invalid lookup identity");
      const row = lookupDetail.get(key, instanceId);
      if (!row || row.present !== 1) return { state: "not_current", detail: null };
      if (row.current_hash !== expectedHash) return { state: "hash_mismatch", detail: null };
      if (row.payload == null || row.saved_hash !== expectedHash) return { state: "missing", detail: null };
      const now = options?.nowMs ?? Date.now();
      const maxAge = options?.maxAgeMs ?? MAX_AGE_MS;
      if (!validTime(now) || !validTime(maxAge)) throw new Error("Invalid cache age policy");
      if ((row.live_fingerprint != null && row.live_fingerprint !== row.saved_fingerprint) ||
          !validTime(row.fetched_at_ms) || row.fetched_at_ms > now || now - row.fetched_at_ms > maxAge) {
        return { state: "refresh_required", detail: null };
      }
      let parsed: unknown;
      try { parsed = JSON.parse(String(row.payload)); } catch { return { state: "refresh_required", detail: null }; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
          (parsed as StoredItemDetail).itemInstanceId !== instanceId ||
          (parsed as StoredItemDetail).itemHash !== expectedHash) {
        return { state: "refresh_required", detail: null };
      }
      // Cache-read remains explicitly UNVERIFIED; the recheck hint never implies
      // up-to-date Bungie evidence. Location only changes the soft age window.
      const softAge = row.current_location === "equipped" ? EQUIPPED_SOFT_REFRESH_MS : OTHER_SOFT_REFRESH_MS;
      return { state: "cached_unverified", detail: parsed as StoredItemDetail,
        fetchedAtMs: row.fetched_at_ms as number,
        refreshRecommended: now - (row.fetched_at_ms as number) >= softAge };
    },
    /** Read-only queue for SYNC-2; SYNC-1 does NOT make Bungie requests. */
    listPending(scope: ItemStoreScope, limit = 32, options?: { nowMs?: number; maxAgeMs?: number }) {
      ensureOpen();
      const key = accountKey(scope);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid pending limit");
      const now = options?.nowMs ?? Date.now();
      const maxAge = options?.maxAgeMs ?? MAX_AGE_MS;
      if (!validTime(now) || !validTime(maxAge)) throw new Error("Invalid pending age policy");
      return pendingStmt.all(key, Math.max(0, now - maxAge), now, limit).map((row) => ({
        itemInstanceId: String(row.instance_id), itemHash: row.item_hash as number,
      }));
    },
    summary(scope: ItemStoreScope) {
      ensureOpen();
      const row = summaryStmt.get(accountKey(scope));
      const current = Number(row?.total ?? 0);
      const stored = Number(row?.cached ?? 0);
      return { current, stored, missing: current - stored, /** Unverified freshness! */ certified: false as const };
    },
    close() { if (!closed) { db.close(); closed = true; } },
  };
}
