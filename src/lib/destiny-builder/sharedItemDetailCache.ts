/**
 * Destiny Builder — SYNC-3b1: shared, per-instance authenticated cache-first read.
 *
 * Both Builder and Vault use the already-authenticated inventory Route Handler.
 * No implicit networking, credentials, persistence or account-global in-memory state.
 * Cache hits are explicitly NOT proof of a live Bungie verification. The existing
 * server controls account isolation, allowed detail fields and cache age.
 */
import {
  extractMatchingCachedDetails, matchesLiveDetail,
  type CacheReply, type DetailItem, type DetailKey,
} from "./itemDetailClientSync";

export type SharedItemDetailSource = "cached_unverified" | "bungie_live";
export type SharedDetailResult = Readonly<{ detail: DetailItem; source: SharedItemDetailSource }>;
export type SharedDetailReaders = Readonly<{
  readCache: () => Promise<CacheReply>;
  readLive: () => Promise<unknown>;
  /** Explicit Bungie Sync / item inspection refresh bypasses saved values. */
  forceLive?: boolean;
}>;

function validIdentity(key: DetailKey): boolean {
  return key && typeof key.itemInstanceId === "string" &&
    /^\d{1,22}$/.test(key.itemInstanceId) && key.itemInstanceId !== "0" &&
    typeof key.itemHash === "number" && Number.isSafeInteger(key.itemHash) &&
    key.itemHash > 0 && key.itemHash <= 0xffffffff;
}

/** One exact pair; no bulk sync, no auto-download of unrelated items. */
export function sharedItemCacheUrl(characterId: string, key: DetailKey): string {
  if (!/^\d{1,22}$/.test(characterId) || characterId === "0" || !validIdentity(key)) {
    throw new Error("Invalid Guardian or detail identity");
  }
  const pair = `${key.itemInstanceId}:${key.itemHash}`;
  return `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=cached-details&items=${encodeURIComponent(pair)}`;
}

/** One exact pair; always cache-first unless the caller explicitly forces live. */
export async function resolveSharedItemDetail(key: DetailKey, readers: SharedDetailReaders): Promise<SharedDetailResult> {
  if (!validIdentity(key) || !readers || typeof readers.readCache !== "function" ||
      typeof readers.readLive !== "function") {
    throw new Error("Invalid shared detail request");
  }
  if (!readers.forceLive) {
    try {
      const raw = await readers.readCache();
      const matched = extractMatchingCachedDetails([key], raw);
      if (matched.length === 1) return { detail: matched[0], source: "cached_unverified" };
    } catch {
      // For one *explicitly inspected* item, fall back to the existing single
      // GetItem operation. Never turn a cache outage into a bulk Bungie fetch.
    }
  }
  const detail = await readers.readLive();
  if (!matchesLiveDetail(key, detail)) throw new Error("Bungie detail identity mismatch");
  return { detail: detail as DetailItem, source: "bungie_live" };
}
