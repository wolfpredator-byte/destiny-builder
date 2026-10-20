/**
 * Destiny Builder — SYNC-2a: strictly bounded, read-only inventory-detail sync.
 * Pure queue orchestration: no Bungie URLs, tokens, or implicit network calls.
 * Caller supplies a fetcher ONLY after an authenticated explicit sync trigger.
 * Must remain server-side with itemDetailStore; never import into a client component.
 */
import type {
  InventoryCoverage, ItemStoreScope, ObservedInstance, StoredItemDetail,
} from "./itemDetailStore";

export type SyncCandidate = Readonly<{
  itemHash: number;
  itemInstanceId: string | null;
  category?: string | null;
}>;
export type SyncSnapshotInput = Readonly<{
  equipped?: readonly SyncCandidate[] | null;
  inventory?: readonly SyncCandidate[] | null;
  vault?: readonly SyncCandidate[] | null;
  otherGuardian?: readonly SyncCandidate[] | null;
  /** Only the server may assert a complete account-wide Bungie response. */
  completeAccountResponse?: boolean;
}>;
export type SyncSnapshot = Readonly<{
  coverage: InventoryCoverage;
  entries: readonly ObservedInstance[];
  skippedStackable: number;
}>;

type Store = Readonly<{
  applyInventorySnapshot(scope: ItemStoreScope, entries: readonly ObservedInstance[],
    coverage: InventoryCoverage, observedAtMs?: number): unknown;
  listPending(scope: ItemStoreScope, limit?: number, options?: {nowMs?: number; maxAgeMs?: number}):
    Array<{itemInstanceId: string; itemHash: number}>;
  saveDetail(scope: ItemStoreScope, detail: StoredItemDetail, fetchedAtMs?: number): void;
}>;

const LOCATIONS = ["equipped", "characterInventory", "vault", "otherGuardian"] as const;
const MAX_BATCH = 32;
const MAX_UINT32 = 0xffffffff;
const INSTANCE = /^\d{1,22}$/;
const PRIORITY: Record<typeof LOCATIONS[number], number> = {
  equipped: 0, characterInventory: 1, vault: 2, otherGuardian: 3,
};

function validId(value: unknown): value is string {
  return typeof value === "string" && INSTANCE.test(value) && value !== "0";
}
function validHash(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_UINT32;
}
function categoryOf(value: unknown): ObservedInstance["category"] {
  return value === "weapon" || value === "armor" || value === "artifact" ? value : "other";
}

/**
 * Do not infer account completeness from four array shapes alone. An explicit
 * trusted completeAccountResponse from a server-verified GetProfile is required.
 * Conflicting/duplicated instance records must not silently replace each other.
 */
export function assembleItemDetailSyncSnapshot(input: SyncSnapshotInput): SyncSnapshot {
  if (!input || typeof input !== "object") throw new Error("Invalid sync snapshot");
  const ready = [input.equipped, input.inventory, input.vault, input.otherGuardian];
  const coverage: InventoryCoverage = input.completeAccountResponse === true &&
    ready.every(Array.isArray) ? "full_account" : "partial";
  if (input.completeAccountResponse === true && coverage !== "full_account") {
    throw new Error("A complete account requires all four Bungie inventory collections");
  }
  const seen = new Set<string>();
  const entries: ObservedInstance[] = [];
  let skippedStackable = 0;
  for (let index = 0; index < LOCATIONS.length; index++) {
    const group = ready[index];
    if (group == null) continue;
    if (!Array.isArray(group)) throw new Error("Invalid inventory collection");
    if (group.length > 10_000) throw new Error("Inventory collection exceeds safety limit");
    for (const item of group) {
      if (!item || typeof item !== "object") throw new Error("Malformed inventory item");
      // Bungie stackables without itemInstanceId do not have a stable item record.
      if (item.itemInstanceId == null) { skippedStackable++; continue; }
      if (!validId(item.itemInstanceId) || !validHash(item.itemHash) || seen.has(item.itemInstanceId)) {
        throw new Error("Malformed or ambiguous account item instance");
      }
      seen.add(item.itemInstanceId);
      entries.push({itemInstanceId: item.itemInstanceId, itemHash: item.itemHash,
        category: categoryOf(item.category), location: LOCATIONS[index]});
    }
  }
  if (entries.length > 10_000) throw new Error("Account exceeds safe item snapshot limit");
  entries.sort((a,b) => PRIORITY[a.location as keyof typeof PRIORITY] -
    PRIORITY[b.location as keyof typeof PRIORITY] || a.itemInstanceId.localeCompare(b.itemInstanceId));
  return {coverage, entries, skippedStackable};
}

export type DetailLoader = (request: Readonly<{itemInstanceId: string; itemHash: number}>,
  signal?: AbortSignal) => Promise<StoredItemDetail>;
export type SyncProgress = Readonly<{
  queued: number;
  processed: number;
  saved: number;
  failed: number;
  cancelled: boolean;
}>;
export type SyncBatchOptions = Readonly<{
  limit?: number;
  nowMs?: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}>;

/**
 * Explicit, bounded queue drain. Up to two in flight, <=32 requests per call.
 * Does NOT schedule itself, retry endlessly, cache credential material, or send
 * network traffic unless caller deliberately supplies an active loader.
 */
export async function runItemDetailSyncBatch(
  store: Store, scope: ItemStoreScope, loader: DetailLoader, options: SyncBatchOptions = {},
): Promise<SyncProgress> {
  if (typeof loader !== "function") throw new Error("No item detail loader supplied");
  const limit = options.limit ?? MAX_BATCH;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) {
    throw new Error("Invalid bounded sync batch size");
  }
  const pending = store.listPending(scope, limit, {nowMs: options.nowMs, maxAgeMs: options.maxAgeMs});
  if (!Array.isArray(pending) || pending.length > limit ||
      pending.some((item) => !validId(item?.itemInstanceId) || !validHash(item?.itemHash))) {
    throw new Error("Invalid persisted pending queue");
  }
  let nextIndex = 0;
  let processed = 0;
  let saved = 0;
  let failed = 0;
  const emit = () => options.onProgress?.({queued:pending.length, processed, saved, failed,
    cancelled:options.signal?.aborted === true});
  emit();
  const worker = async () => {
    while (!options.signal?.aborted) {
      const index = nextIndex++;
      if (index >= pending.length) return;
      const request = pending[index];
      try {
        const detail = await loader(request, options.signal);
        if (!options.signal?.aborted) {
          if (!detail || detail.itemInstanceId !== request.itemInstanceId ||
              detail.itemHash !== request.itemHash) throw new Error("Detail identity mismatch");
          // Store validates that the instance is still current and matches hash.
          store.saveDetail(scope, detail, options.nowMs ?? Date.now());
          saved++;
        }
      } catch {
        // Errors are aggregated, never exposed with private IDs in public status.
        if (!options.signal?.aborted) failed++;
      } finally {
        processed++;
        emit();
      }
    }
  };
  await Promise.all(Array.from({length:Math.min(2,pending.length)},worker));
  return {queued:pending.length, processed, saved, failed,
    cancelled:options.signal?.aborted === true};
}
