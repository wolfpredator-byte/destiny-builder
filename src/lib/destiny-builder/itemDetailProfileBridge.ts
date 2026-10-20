/**
 * Destiny Builder — SYNC-2b: convert the SERVER-RETURNED Bungie GetProfile
 * component payload to an inventory observation for the private SQLite store.
 *
 * PURE. No network, token access, persistence or claims of current detail
 * verification. Only a genuinely complete account-wide component response
 * may reconcile disappeared instances. No client-supplied completeness flag.
 */
import { assembleItemDetailSyncSnapshot, type SyncSnapshot, type SyncCandidate } from "./itemDetailSync";
import type { ItemStoreScope, ObservedInstance, InventoryCoverage } from "./itemDetailStore";

type Dict = Record<string, unknown>;
const ID = /^\d{1,22}$/;
function obj(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Dict : null;
}
function componentData(response: Dict, key: string): Dict | null {
  return obj(obj(response[key])?.data);
}
function collection(data: Dict | null, characterId: string): unknown[] | null {
  const value = obj(data?.[characterId])?.items;
  if (value == null) return null;
  if (!Array.isArray(value)) throw new Error("Invalid Bungie character collection");
  return value;
}
function candidates(items: readonly unknown[] | null): SyncCandidate[] | undefined {
  if (items === null) return undefined;
  return items.map((value) => {
    const record = obj(value);
    if (!record) throw new Error("Malformed Bungie inventory item");
    return {itemHash: record.itemHash as number, itemInstanceId: record.itemInstanceId as string | null,
      category: typeof record.category === "string" ? record.category : null};
  });
}
function members(data: Dict | null): string[] {
  if (!data) return [];
  const ids = Object.keys(data);
  if (ids.some((id) => !ID.test(id) || id === "0")) throw new Error("Invalid Bungie character roster");
  return ids;
}

export type ProfileObservation = Readonly<SyncSnapshot & { accountComplete: boolean }>;
export function profileObservationFromBungie(rawResponse: unknown, requestedCharacterId: string): ProfileObservation {
  if (!ID.test(requestedCharacterId) || requestedCharacterId === "0") {
    throw new Error("Invalid requested character");
  }
  const response = obj(rawResponse);
  if (!response) throw new Error("Bungie GetProfile response missing");
  const roster = members(componentData(response, "characters"));
  if (roster.length > 3) throw new Error("Unexpected Bungie character roster size");
  const inventories = componentData(response, "characterInventories");
  const equipment = componentData(response, "characterEquipment");
  const vaultItems = obj(componentData(response, "profileInventory"))?.items;
  if (vaultItems != null && !Array.isArray(vaultItems)) throw new Error("Invalid Bungie Vault collection");
  const allCharacterIds = [...new Set([...roster, requestedCharacterId])];
  const equipped = collection(equipment, requestedCharacterId);
  const inventory = collection(inventories, requestedCharacterId);
  const otherGuardian: unknown[] = [];
  let allCharactersPresent = roster.includes(requestedCharacterId) && roster.length > 0 && !!inventories && !!equipment;
  for (const id of allCharacterIds) {
    const inventoryItems = collection(inventories, id);
    const equipmentItems = collection(equipment, id);
    if (!inventoryItems || !equipmentItems) allCharactersPresent = false;
    if (id !== requestedCharacterId) {
      if (inventoryItems) otherGuardian.push(...inventoryItems);
      if (equipmentItems) otherGuardian.push(...equipmentItems);
    }
  }
  const accountComplete = allCharactersPresent && Array.isArray(vaultItems);
  // Account absence reconciliation is only allowed if the actual profile
  // proves all four collections, not merely because four arrays can be made.
  const snapshot = assembleItemDetailSyncSnapshot({
    equipped: candidates(equipped),
    inventory: candidates(inventory),
    vault: candidates(Array.isArray(vaultItems) ? vaultItems : null),
    otherGuardian: candidates(otherGuardian),
    completeAccountResponse: accountComplete,
  });
  return {...snapshot, accountComplete};
}

export type ObservationStore = Readonly<{
  applyInventorySnapshot(scope: ItemStoreScope, entries: readonly ObservedInstance[],
    coverage: InventoryCoverage, observedAtMs?: number): unknown;
}>;
export function indexProfileObservation(
  store: ObservationStore, scope: ItemStoreScope, profile: unknown,
  requestedCharacterId: string, observedAtMs = Date.now(),
) {
  const snapshot = profileObservationFromBungie(profile, requestedCharacterId);
  store.applyInventorySnapshot(scope, snapshot.entries, snapshot.coverage, observedAtMs);
  return {coverage: snapshot.coverage, indexed: snapshot.entries.length,
    skippedStackable: snapshot.skippedStackable, accountComplete: snapshot.accountComplete};
}

/** Strict bounded cache-hydration selector. IDs remain in the authenticated
 * request only and must never enter a public diagnostic or telemetry record. */
export function parseCachedDetailSelection(raw: string | null) {
  if (typeof raw !== "string" || !raw || raw.length > 3200) throw new Error("Invalid cache request");
  const tokens = raw.split(",");
  if (tokens.length < 1 || tokens.length > 64) throw new Error("Cache request exceeds bounded size");
  const seen = new Set<string>();
  return tokens.map((token) => {
    const match = /^(\d{1,22}):(\d{1,10})$/.exec(token);
    if (!match || match[1] === "0" || seen.has(match[1])) throw new Error("Invalid cache request entry");
    seen.add(match[1]);
    const itemHash = Number(match[2]);
    if (!Number.isSafeInteger(itemHash) || itemHash <= 0 || itemHash > 0xffffffff) {
      throw new Error("Invalid cache request hash");
    }
    return {itemInstanceId: match[1], itemHash};
  });
}
