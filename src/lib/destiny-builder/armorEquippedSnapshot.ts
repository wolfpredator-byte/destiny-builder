/**
 * Engine-B0.6a3 — pure display-only equipment stat reconciliation and
 * bounded explicit detail queue. No network, mutation, writes, or certification.
 */
import { ARMOR_3_STAT_IDS, resolveArmorBaseStats } from './armorBaseStatsResolver';
import {
  ARMOR_COMBINATION_SLOT_HASHES, type ArmorCombinationItem,
} from './armorCombinationEngine';
import type { MissingArmorUiDetail } from './armorCombinationUiBridge';

export const ARMOR_DETAIL_BATCH_LIMIT = 32 as const;

export interface EquippedArmorSnapshot {
  /** Number of distinct equipped Armor 3.0 slots with individually reconciled details. */
  verifiedSlots: number;
  missingSlotHashes: number[];
  /** null indicates an incomplete five-piece total; never inferred from summary stats. */
  observedGearTotals: (number | null)[];
  /** Sum of reconciled pieces ONLY. Negative numbers are meaningful and preserved. */
  partialSums: number[] | null;
  readOnly: true;
  certifiedForOptimization: false;
}

export function summarizeEquippedArmorSnapshot(items: readonly ArmorCombinationItem[]): EquippedArmorSnapshot {
  const slotTotals = new Map<number, readonly number[]>();
  const invalidSlots = new Set<number>();
  for (const slot of ARMOR_COMBINATION_SLOT_HASHES) {
    const matches = items.filter((i) => i.source === 'equipped' && i.equipmentSlotHash === slot);
    // Duplicate/ambiguous equipped slots are never resolved by arbitrary array order.
    if (matches.length !== 1) { invalidSlots.add(slot); continue; }
    const item = matches[0];
    const matchedDetail = item.detail as (typeof item.detail & {itemInstanceId?:unknown;itemHash?:unknown}) | null;
    if (!matchedDetail || matchedDetail.itemInstanceId !== item.itemInstanceId ||
        matchedDetail.itemHash !== item.itemHash || !item.itemInstanceId ||
        !Number.isSafeInteger(item.itemHash) || item.itemHash <= 0) {
      invalidSlots.add(slot); continue;
    }
    const resolution = resolveArmorBaseStats(matchedDetail);
    if (resolution.status !== 'reconciled_roll_candidate' || !resolution.observedStats) {
      invalidSlots.add(slot); continue;
    }
    const index = new Map(resolution.observedStats.map((s) => [s.statHash, s.value]));
    const values = ARMOR_3_STAT_IDS.map((hash) => index.get(hash));
    if (values.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value))) {
      invalidSlots.add(slot); continue;
    }
    slotTotals.set(slot, values as number[]);
  }
  const partialSums = ARMOR_3_STAT_IDS.map((_, index) =>
    [...slotTotals.values()].reduce((sum, values) => sum + values[index], 0));
  const validSums = partialSums.every(Number.isSafeInteger);
  const missingSlotHashes = ARMOR_COMBINATION_SLOT_HASHES.filter((slot) => invalidSlots.has(slot) || !slotTotals.has(slot));
  return {
    verifiedSlots: slotTotals.size,
    missingSlotHashes: [...missingSlotHashes],
    observedGearTotals: missingSlotHashes.length === 0 && validSums ? [...partialSums] : ARMOR_3_STAT_IDS.map(() => null),
    partialSums: validSums ? partialSums : null,
    readOnly: true,
    certifiedForOptimization: false,
  };
}

/** Prioritize worn armor; never retry failed IDs without a separate user action. */
export function selectMissingArmorDetailBatch(
  missing: readonly MissingArmorUiDetail[],
  equippedInstanceIds: readonly string[],
  failedInstanceIds: ReadonlySet<string>,
  maxCount: number = ARMOR_DETAIL_BATCH_LIMIT,
): MissingArmorUiDetail[] {
  if (!Number.isSafeInteger(maxCount) || maxCount < 1 || maxCount > ARMOR_DETAIL_BATCH_LIMIT) return [];
  const equipped = new Set(equippedInstanceIds);
  const seen = new Set<string>();
  const candidates: MissingArmorUiDetail[] = [];
  for (const item of missing) {
    if (typeof item.itemInstanceId !== 'string' || !item.itemInstanceId ||
        !Number.isSafeInteger(item.itemHash) || item.itemHash <= 0 || item.itemHash > 0xffffffff ||
        !ARMOR_COMBINATION_SLOT_HASHES.includes(item.equipmentSlotHash as typeof ARMOR_COMBINATION_SLOT_HASHES[number]) ||
        failedInstanceIds.has(item.itemInstanceId) || seen.has(item.itemInstanceId)) continue;
    seen.add(item.itemInstanceId);
    candidates.push(item);
  }
  // Stable sorting; worn items first, otherwise original source order.
  return candidates.map((item, index) => ({item, index}))
    .sort((a, b) => Number(equipped.has(b.item.itemInstanceId)) - Number(equipped.has(a.item.itemInstanceId)) || a.index - b.index)
    .slice(0, maxCount).map(({item}) => item);
}
