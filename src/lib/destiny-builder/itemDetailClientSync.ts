/**
 * Destiny Builder — SYNC-2c: client-side bounded hydration orchestration.
 * Pure / transport-injected: NO implicit fetch, Bungie calls or React coupling.
 * Only item instance references from the current account snapshot are used.
 * Cache hits are NEVER evidence of a freshly verified live item.
 */
export type DetailKey = Readonly<{ itemInstanceId: string; itemHash: number }>;
export type DetailItem = Readonly<Record<string, unknown> & DetailKey>;
export type DetailSummaryItem = Readonly<{
  itemInstanceId?: string | null;
  itemHash?: number | null;
  category?: string | null;
}>;
export type DetailCollections = Readonly<{
  equipped: readonly DetailSummaryItem[];
  inventory: readonly DetailSummaryItem[];
  vault: readonly DetailSummaryItem[];
  otherGuardian: readonly DetailSummaryItem[];
}>;
export type DetailSyncStage = "cache" | "live" | "complete" | "paused" | "cache_unavailable";
export type DetailSyncProgress = Readonly<{
  stage: DetailSyncStage;
  total: number;
  cacheHits: number;
  liveDone: number;
  liveLoaded: number;
  failed: number;
  pending: number;
  refreshDue: number;
  refreshDone: number;
  refreshRemaining: number;
}>;
export type CacheReply = Readonly<{
  success?: unknown;
  scope?: unknown;
  cachedDataIsLiveVerified?: unknown;
  cached?: unknown;
}>;
const ID = /^\d{1,22}$/;
const MAX_HASH = 0xffffffff;
export const CACHE_BATCH_SIZE = 32;
export const LIVE_BATCH_SIZE = 32;
export const MAX_AUTO_LIVE_PER_RUN = 256;
/** Recheck only this many already-cached items per visit; no 450-item wave after 6h. */
export const MAX_SOFT_REFRESH_PER_RUN = 8;

function validKey(item: DetailKey): boolean {
  return !!item && typeof item.itemInstanceId === "string" && ID.test(item.itemInstanceId) &&
    item.itemInstanceId !== "0" && typeof item.itemHash === "number" &&
    Number.isSafeInteger(item.itemHash) && item.itemHash > 0 && item.itemHash <= MAX_HASH;
}

/** Deterministic order: equipped first, then inventory/Vault/other Guardian;
 * within a location, armor first. Duplicate instance IDs are ambiguous: omit. */
export function selectAccountDetailKeys(collections: DetailCollections): DetailKey[] {
  if (!collections || ![collections.equipped, collections.inventory, collections.vault, collections.otherGuardian]
    .every(Array.isArray)) throw new Error("Complete four-source account view required");
  const all: Array<DetailKey & {priority: number; category: string}> = [];
  const ambiguous = new Set<string>();
  const seen = new Set<string>();
  for (const [index, entries] of [collections.equipped, collections.inventory, collections.vault, collections.otherGuardian].entries()) {
    for (const entry of entries) {
      if (entry?.category !== "armor" && entry?.category !== "weapon") continue;
      const key = {itemInstanceId: entry.itemInstanceId as string, itemHash: entry.itemHash as number};
      if (!validKey(key)) continue;
      if (seen.has(key.itemInstanceId)) { ambiguous.add(key.itemInstanceId); continue; }
      seen.add(key.itemInstanceId);
      all.push({...key, priority:index, category:entry.category});
    }
  }
  return all.filter((key) => !ambiguous.has(key.itemInstanceId))
    .sort((a,b) => a.priority-b.priority || Number(b.category==="armor")-Number(a.category==="armor") ||
      a.itemInstanceId.localeCompare(b.itemInstanceId))
    .map(({itemInstanceId,itemHash}) => ({itemInstanceId,itemHash}));
}

/** Validate authenticated cache response against the EXACT current requested pairs.
 * Never blindly trust a returned pair, duplicate or an unverified schema. */
export function extractMatchingCachedDetails(requested: readonly DetailKey[], raw: CacheReply): DetailItem[] {
  if (!raw || raw.success !== true || raw.scope !== "cached-details" ||
    raw.cachedDataIsLiveVerified !== false || !Array.isArray(raw.cached)) {
    throw new Error("Invalid authenticated cache response");
  }
  const selection = new Map<string,number>();
  for (const key of requested) {
    if (!validKey(key) || selection.has(key.itemInstanceId)) throw new Error("Invalid requested identity");
    selection.set(key.itemInstanceId,key.itemHash);
  }
  const seen = new Set<string>();
  const matched: DetailItem[] = [];
  for (const value of raw.cached) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string,unknown>;
    const id = record.itemInstanceId;
    const hash = record.itemHash;
    if (typeof id !== "string" || seen.has(id) || selection.get(id) !== hash) continue;
    const detail = record.item;
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    const data = detail as Record<string,unknown>;
    if (data.itemInstanceId !== id || data.itemHash !== hash) continue;
    seen.add(id);
    matched.push(data as DetailItem);
  }
  return matched;
}

export function matchesLiveDetail(key: DetailKey, raw: unknown): raw is DetailItem {
  return validKey(key) && !!raw && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string,unknown>).itemInstanceId === key.itemInstanceId &&
    (raw as Record<string,unknown>).itemHash === key.itemHash;
}

type Options = Readonly<{
  requestCache: (keys: readonly DetailKey[], signal: AbortSignal) => Promise<CacheReply>;
  requestLive: (key: DetailKey, signal: AbortSignal) => Promise<unknown>;
  onDetails: (details: readonly DetailItem[], source: "cache" | "live") => void;
  onProgress?: (progress: DetailSyncProgress) => void;
  signal: AbortSignal;
  /** In-memory results acquired earlier in this page session. */
  existing?: Readonly<Record<string, unknown>>;
  /** Max 256 live requests per explicitly initiated run; resumes on next run. */
  liveBudget?: number;
  /** Separate bounded budget for rechecking cached-but-soft-stale records. */
  refreshBudget?: number;
}>;

/** Cache hydrate first; then bounded, cancellable two-at-a-time live GetItem.
 * A cache outage disables bulk auto fetch to avoid downloading everything again
 * on each page visit with nowhere to save it. Existing manual loader remains.
 */
export async function runDetailClientSync(keys: readonly DetailKey[], opts: Options): Promise<DetailSyncProgress> {
  const budget = opts.liveBudget ?? MAX_AUTO_LIVE_PER_RUN;
  const refreshBudget = opts.refreshBudget ?? MAX_SOFT_REFRESH_PER_RUN;
  if (!Number.isSafeInteger(refreshBudget) || refreshBudget < 0 || refreshBudget > MAX_SOFT_REFRESH_PER_RUN ||
      !Number.isSafeInteger(budget) || budget < 1 || budget > MAX_AUTO_LIVE_PER_RUN ||
      keys.length > 5000 || keys.some((item) => !validKey(item)) ||
      new Set(keys.map((item) => item.itemInstanceId)).size !== keys.length) throw new Error("Invalid sync input");
  const held = new Set(keys.filter((key) => matchesLiveDetail(key,opts.existing?.[key.itemInstanceId]))
    .map((key) => key.itemInstanceId));
  let cacheHits = 0, liveDone = 0, liveLoaded = 0, failed = 0;
  const refreshDue = new Set<string>();
  let refreshDone = 0;
  const update = (stage: DetailSyncStage): DetailSyncProgress => ({
    stage, total:keys.length, cacheHits, liveDone, liveLoaded, failed,
    pending:Math.max(0,keys.length-held.size),
    refreshDue:refreshDue.size, refreshDone,
    refreshRemaining:Math.max(0,refreshDue.size-refreshDone),
  });
  const emit = (stage: DetailSyncStage) => { const p=update(stage); opts.onProgress?.(p); return p; };
  emit("cache");
  if (opts.signal.aborted) return emit("paused");
  try {
    for (let i=0;i<keys.length;i+=CACHE_BATCH_SIZE) {
      if (opts.signal.aborted) return emit("paused");
      const batch=keys.slice(i,i+CACHE_BATCH_SIZE).filter((key)=>!held.has(key.itemInstanceId));
      if (!batch.length) continue;
      const response=await opts.requestCache(batch,opts.signal);
      if (opts.signal.aborted) return emit("paused");
      const found=extractMatchingCachedDetails(batch,response);
      if (found.length) {
        for (const entry of found) held.add(entry.itemInstanceId);
        cacheHits+=found.length;
        opts.onDetails(found,"cache");
        // The server can recommend age-based verification without denying a
        // usable, identity-checked cache hit. Treat optional/invalid hints as
        // false; only already validated cache hits may enter this queue.
        const acceptedIds = new Set(found.map((item)=>item.itemInstanceId));
        if (Array.isArray(response.cached)) {
          for (const value of response.cached) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            const row=value as Record<string,unknown>;
            if (row.refreshRecommended === true && typeof row.itemInstanceId === "string" &&
                acceptedIds.has(row.itemInstanceId) &&
                batch.some((key)=>key.itemInstanceId === row.itemInstanceId && key.itemHash === row.itemHash)) {
              refreshDue.add(row.itemInstanceId);
            }
          }
        }
      }
      emit("cache");
    }
  } catch {
    return emit(opts.signal.aborted ? "paused" : "cache_unavailable");
  }
  // Actual missing/new instances always take precedence over age rechecks.
  // Do not re-fetch hundreds of still-usable details just because 6h elapsed.
  const missing=keys.filter((key)=>!held.has(key.itemInstanceId)).slice(0,budget);
  const refresh=keys.filter((key)=>held.has(key.itemInstanceId) && refreshDue.has(key.itemInstanceId))
    .slice(0,Math.min(refreshBudget,Math.max(0,budget-missing.length)));
  const needed=[...missing,...refresh];
  const refreshingIds=new Set(refresh.map((key)=>key.itemInstanceId));
  let consecutiveFailures=0;
  emit("live");
  for (let i=0;i<needed.length;i+=LIVE_BATCH_SIZE) {
    if (opts.signal.aborted) return emit("paused");
    const batch=needed.slice(i,i+LIVE_BATCH_SIZE);
    for (let j=0;j<batch.length;j+=2) {
      if (opts.signal.aborted) return emit("paused");
      const pair=batch.slice(j,j+2);
      const received=await Promise.all(pair.map(async (key) => {
        try { return await opts.requestLive(key,opts.signal); }
        catch { return null; }
      }));
      if (opts.signal.aborted) return emit("paused");
      const valid:DetailItem[]=[];
      for (let k=0;k<pair.length;k++) {
        liveDone++;
        if (refreshingIds.has(pair[k].itemInstanceId)) refreshDone++;
        if (matchesLiveDetail(pair[k],received[k])) {
          const detail=received[k] as DetailItem;
          valid.push(detail);
          held.add(detail.itemInstanceId);
          liveLoaded++;
          consecutiveFailures=0;
        } else {
          failed++;
          consecutiveFailures++;
        }
      }
      if (valid.length) opts.onDetails(valid,"live");
      emit("live");
      // A burst of persistent HTTP errors should NOT fan out over a vault.
      if (consecutiveFailures>=4) return emit("paused");
    }
  }
  return emit(opts.signal.aborted || update("live").pending>0 ? "paused" : "complete");
}
