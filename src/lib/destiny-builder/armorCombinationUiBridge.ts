/**
 * Engine-B0.6a2 — UI v2 boundary for fixed-equipped-mod Armor searches.
 * Pure data mapping only. No API, cross-Guardian ownership inference, writes,
 * implicit rarity guesses or reuse of truncated audit reports.
 */
import {
  ARMOR_COMBINATION_SLOT_HASHES,
  type ArmorCombinationItem, type ArmorSource,
} from './armorCombinationEngine';
import type { ArmorResolverInput } from './armorBaseStatsResolver';

type Rec = Record<string, unknown>;
const object = (v: unknown): Rec | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null;
const hash = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 0xffffffff ? v : null;
const classType = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3 ? v : null;
const rarity = (v: unknown): 'legendary' | 'exotic' | null => {
  if (typeof v !== 'string') return null;
  const word = v.trim().toLowerCase();
  return word === 'legendary' ? 'legendary' : word === 'exotic' ? 'exotic' : null;
};

export interface ArmorUiSources {
  equipped: readonly unknown[];
  inventory: readonly unknown[];
  vault: readonly unknown[];
  otherGuardian: readonly unknown[];
}
export interface MissingArmorUiDetail {
  itemInstanceId: string;
  itemHash: number;
  name: string;
  equipmentSlotHash: number;
}
export interface ArmorUiPreparation {
  items: ArmorCombinationItem[];
  /** Only requestable summary items; at most eight will be requested per click. */
  missingDetails: MissingArmorUiDetail[];
}

export function prepareArmorCombinationUi(
  sources: ArmorUiSources,
  detailsById: Readonly<Record<string, unknown>>,
): ArmorUiPreparation {
  const items: ArmorCombinationItem[] = [];
  const missingDetails: MissingArmorUiDetail[] = [];
  const missingIds = new Set<string>();
  const pools: readonly {source: ArmorSource; items: readonly unknown[]}[] = [
    {source:'equipped',items:sources.equipped},
    {source:'inventory',items:sources.inventory},
    {source:'vault',items:sources.vault},
    {source:'other_guardian',items:sources.otherGuardian},
  ];
  for (const pool of pools) {
    for (const raw of pool.items) {
      const summary = object(raw);
      if (summary?.category !== 'armor') continue;
      const id = typeof summary.itemInstanceId === 'string' && summary.itemInstanceId.length > 0
        ? summary.itemInstanceId : '';
      const itemHash = hash(summary.itemHash) ?? 0;
      const slot = hash(summary.equipmentSlotHash) ?? hash(summary.bucketHash) ?? 0;
      if (!ARMOR_COMBINATION_SLOT_HASHES.includes(slot as typeof ARMOR_COMBINATION_SLOT_HASHES[number])) continue;
      const rawDetail = id ? object(detailsById[id]) : null;
      // A stale or different-instance detail must never be used for this item.
      const detail = rawDetail && rawDetail.itemInstanceId === id && rawDetail.itemHash === itemHash
        ? rawDetail : null;
      const summaryRarity = rarity(summary.tierTypeName);
      const detailRarity = rarity(detail?.tierTypeName);
      const resolvedRarity = summaryRarity && detailRarity && summaryRarity !== detailRarity
        ? 'unknown' : summaryRarity ?? detailRarity ?? 'unknown';
      const summaryClass = classType(summary.classType);
      const detailClass = classType(detail?.classType);
      const resolvedClass = summaryClass !== null && detailClass !== null && summaryClass !== detailClass
        ? null : summaryClass ?? detailClass;
      items.push({
        itemInstanceId:id,
        itemHash,
        equipmentSlotHash:slot,
        classType:resolvedClass,
        rarity:resolvedRarity,
        source:pool.source,
        detail:detail as ArmorResolverInput | null,
      });
      if (id && itemHash > 0 && !detail && !missingIds.has(id)) {
        missingIds.add(id);
        missingDetails.push({itemInstanceId:id,itemHash,
          name: typeof summary.name === 'string' ? summary.name : 'Armatura',
          equipmentSlotHash:slot});
      }
    }
  }
  return {items,missingDetails};
}
