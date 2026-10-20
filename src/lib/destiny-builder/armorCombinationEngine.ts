/**
 * Destiny Builder — Engine-B0.6a1, FIXED-EQUIPMENT five-piece search.
 * Pure/read-only. Requires individually reconciled Bungie item details; never
 * changes socket plugs, installs mods, calls APIs or certifies equip legality.
 *
 * "observedGearStats" are the sum of each item's already-observed Armor 3.0
 * values WITH its currently selected mod/tuning. They are NOT the final Guardian
 * stats, and NOT a simulated redistribution of mods/tuning. "baseRollStats"
 * are a separate sum of the resolver's unmodified roll candidates.
 */
import {
  ARMOR_3_STAT_IDS, resolveArmorBaseStats,
  type ArmorResolverInput,
} from './armorBaseStatsResolver';

export const ARMOR_COMBINATION_SLOT_HASHES = [
  3448274439, // Helmet
  3551918588, // Gauntlets
  14239492,   // Chest
  20886954,   // Legs
  1585787867, // Class item
] as const;
export type ArmorCombinationSlotHash = typeof ARMOR_COMBINATION_SLOT_HASHES[number];
export type ArmorCombinationStatHash = typeof ARMOR_3_STAT_IDS[number];
export type ArmorSource = 'equipped' | 'inventory' | 'vault' | 'other_guardian';
export type ArmorRarity = 'legendary' | 'exotic' | 'unknown';
export type ArmorStatRange = { min?: number | null; max?: number | null };
export type ArmorRanges = Partial<Record<ArmorCombinationStatHash, ArmorStatRange>>;
export type ArmorWeights = Partial<Record<ArmorCombinationStatHash, number>>;

export interface ArmorCombinationItem {
  /** Local browser-side Bungie instance reference; NEVER place into AI packets or public audit reports. */
  itemInstanceId: string;
  itemHash: number;
  equipmentSlotHash: number;
  /** 0 Titan, 1 Hunter, 2 Warlock, 3 universal. Unknown classes are rejected. */
  classType: number | null;
  rarity: ArmorRarity;
  source: ArmorSource;
  /** Full scope=detail evidence, not a summary/sample. */
  detail: ArmorResolverInput | null;
}
export interface ArmorCombinationRequest {
  classType: 0 | 1 | 2;
  items: readonly ArmorCombinationItem[];
  ranges?: ArmorRanges;
  /** Ranking only: omitted stat weights default to 1; zero ignores that stat. */
  weights?: ArmorWeights;
  /** All items must be owned. Vault/other Guardian are labeled transfer-required. */
  includeTransfers?: boolean;
  lockedItemInstanceIds?: readonly string[];
  maxResults?: number; // 1–5
  maxEvaluations?: number; // 1–1,000,000; bounded search (no false completeness)
}
export type ArmorCombinationRejectReason =
  | 'invalid_metadata' | 'wrong_class' | 'transfer_excluded'
  | 'unreconciled_or_missing_detail' | 'duplicate_instance';
export interface ArmorCombinationPiece {
  itemInstanceId: string;
  itemHash: number;
  equipmentSlotHash: ArmorCombinationSlotHash;
  source: ArmorSource;
  rarity: Exclude<ArmorRarity, 'unknown'>;
}
export interface ArmorCombinationResult {
  pieces: ArmorCombinationPiece[];
  /** In canonical six-stat order. Current installed mod/tuning are unchanged. */
  observedGearStats: number[];
  /** Separate total of the five reconciled, pre-mod/tuning roll candidates. */
  baseRollStats: number[];
  weightedScore: number;
  requiresTransfer: boolean;
  readOnly: true;
  installabilityVerified: false;
  certifiedForOptimization: false;
}
export interface ArmorCombinationSearch {
  schemaVersion: 1;
  mode: 'fixed_installed_mods_and_tuning';
  status: 'complete' | 'truncated' | 'insufficient_candidates' | 'invalid_request';
  /** true only after exhaustive search (including safe range pruning). */
  searchComplete: boolean;
  readOnly: true;
  installabilityVerified: false;
  certifiedForOptimization: false;
  /** Counts relate to item instances, not unique Manifest definitions. */
  eligibleItems: number;
  rejectedItems: Record<ArmorCombinationRejectReason, number>;
  missingSlotHashes: ArmorCombinationSlotHash[];
  evaluatedCombinations: number;
  /** The list may be provisional when status='truncated'. */
  results: ArmorCombinationResult[];
  reasons: string[];
}

type ValidPiece = {
  piece: ArmorCombinationPiece;
  observed: number[];
  base: number[];
};
const MAX_UINT32 = 0xffffffff;
const STAT_INDEX = new Map<number, number>(ARMOR_3_STAT_IDS.map((hash, index) => [hash, index]));
const VALID_SOURCES = new Set<ArmorSource>(['equipped', 'inventory', 'vault', 'other_guardian']);
const inUInt32 = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= MAX_UINT32;
const safeInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const emptyRejects = (): Record<ArmorCombinationRejectReason, number> => ({
  invalid_metadata: 0, wrong_class: 0, transfer_excluded: 0,
  unreconciled_or_missing_detail: 0, duplicate_instance: 0,
});
const emptyResponse = (): ArmorCombinationSearch => ({
  schemaVersion: 1, mode: 'fixed_installed_mods_and_tuning',
  status: 'invalid_request', searchComplete: false, readOnly: true,
  installabilityVerified: false, certifiedForOptimization: false,
  eligibleItems: 0, rejectedItems: emptyRejects(), missingSlotHashes: [],
  evaluatedCombinations: 0, results: [], reasons: [],
});
function statVector(stats: readonly {statHash: number; value: number}[] | null): number[] | null {
  if (!Array.isArray(stats) || stats.length !== ARMOR_3_STAT_IDS.length) return null;
  const values: number[] = Array(ARMOR_3_STAT_IDS.length).fill(0);
  const seen = new Set<number>();
  for (const stat of stats) {
    const i = STAT_INDEX.get(stat?.statHash);
    if (i === undefined || seen.has(i) || !safeInt(stat?.value)) return null;
    values[i] = stat.value;
    seen.add(i);
  }
  return seen.size === ARMOR_3_STAT_IDS.length ? values : null;
}
function configArray(
  obj: Record<string, unknown> | undefined,
  mode: 'ranges' | 'weights',
): { ranges: (readonly [number | null, number | null])[]; weights: number[] } | null {
  const ranges: [number | null, number | null][] = ARMOR_3_STAT_IDS.map(() => [null, null]);
  const weights: number[] = ARMOR_3_STAT_IDS.map(() => 1);
  if (obj === undefined) return {ranges, weights};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const [key, value] of Object.entries(obj)) {
    const index = STAT_INDEX.get(Number(key));
    if (index === undefined) return null;
    if (mode === 'weights') {
      if (!safeInt(value) || value < 0 || value > 20) return null;
      weights[index] = value;
    } else {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const r = value as Record<string, unknown>;
      if (Object.keys(r).some((k) => k !== 'min' && k !== 'max')) return null;
      const min = r.min ?? null, max = r.max ?? null;
      if ((min !== null && !safeInt(min)) || (max !== null && !safeInt(max)) ||
          (min !== null && max !== null && min > max)) return null;
      ranges[index] = [min as number | null, max as number | null];
    }
  }
  return {ranges, weights};
}
function sumVectors(a: readonly number[], b: readonly number[]): number[] | null {
  const added = a.map((n, i) => n + b[i]);
  return added.every(safeInt) ? added : null;
}
function scoreOf(values: readonly number[], weights: readonly number[]): number | null {
  const score = values.reduce((sum, n, i) => sum + n * weights[i], 0);
  return safeInt(score) ? score : null;
}
const keyFor = (pieces: readonly ArmorCombinationPiece[]) => pieces.map((p) => p.itemInstanceId).join('|');

/** A single local, bounded search. No network, storage, timers, mutation or side effects. */
export function searchArmorCombinations(request: ArmorCombinationRequest): ArmorCombinationSearch {
  const out = emptyResponse();
  if (!request || ![0, 1, 2].includes(request.classType) || !Array.isArray(request.items) ||
      request.items.length > 5000 ||
      (request.includeTransfers !== undefined && typeof request.includeTransfers !== 'boolean') ||
      (request.maxResults !== undefined && (!safeInt(request.maxResults) || request.maxResults < 1 || request.maxResults > 5)) ||
      (request.maxEvaluations !== undefined && (!safeInt(request.maxEvaluations) || request.maxEvaluations < 1 || request.maxEvaluations > 1_000_000)) ||
      (request.lockedItemInstanceIds !== undefined && (!Array.isArray(request.lockedItemInstanceIds) ||
        request.lockedItemInstanceIds.some((s) => typeof s !== 'string' || !s.length) ||
        new Set(request.lockedItemInstanceIds).size !== request.lockedItemInstanceIds.length))) {
    out.reasons.push('Invalid request: class, items, limits or locked instance references.');
    return out;
  }
  const minMax = configArray(request.ranges as Record<string, unknown> | undefined, 'ranges');
  const scoring = configArray(request.weights as Record<string, unknown> | undefined, 'weights');
  if (!minMax || !scoring) {
    out.reasons.push('Invalid Armor 3.0 stat ranges or weights.');
    return out;
  }
  const ranges = minMax.ranges;
  const weights = request.weights ? scoring.weights : ARMOR_3_STAT_IDS.map(() => 1);
  const maxResults = request.maxResults ?? 5;
  const maxEvaluations = request.maxEvaluations ?? 100_000;
  const allowTransfers = request.includeTransfers !== false;
  const ids = new Map<string, number>();
  for (const item of request.items) {
    if (typeof item?.itemInstanceId === 'string' && item.itemInstanceId.length)
      ids.set(item.itemInstanceId, (ids.get(item.itemInstanceId) ?? 0) + 1);
  }
  const bySlot = new Map<ArmorCombinationSlotHash, ValidPiece[]>(ARMOR_COMBINATION_SLOT_HASHES.map((s) => [s, []]));
  for (const item of request.items) {
    if (!item || typeof item.itemInstanceId !== 'string' || !item.itemInstanceId.length ||
        !inUInt32(item.itemHash) || !inUInt32(item.equipmentSlotHash) ||
        !bySlot.has(item.equipmentSlotHash as ArmorCombinationSlotHash) ||
        ![0, 1, 2, 3].includes(item.classType as number) ||
        (item.rarity !== 'legendary' && item.rarity !== 'exotic') ||
        !VALID_SOURCES.has(item.source)) {
      out.rejectedItems.invalid_metadata++;
      continue;
    }
    if ((ids.get(item.itemInstanceId) ?? 0) !== 1) {
      out.rejectedItems.duplicate_instance++;
      continue;
    }
    if (item.classType !== 3 && item.classType !== request.classType) {
      out.rejectedItems.wrong_class++;
      continue;
    }
    if (!allowTransfers && (item.source === 'vault' || item.source === 'other_guardian')) {
      out.rejectedItems.transfer_excluded++;
      continue;
    }
    // Do not accept manually forged "reconciled" labels: recompute from the
    // complete source evidence for each item. Never use catalog or core-only stats.
    const resolved = item.detail ? resolveArmorBaseStats(item.detail) : null;
    const observed = resolved?.status === 'reconciled_roll_candidate'
      ? statVector(resolved.observedStats) : null;
    const base = resolved?.status === 'reconciled_roll_candidate'
      ? statVector(resolved.rollStats) : null;
    if (!observed || !base) {
      out.rejectedItems.unreconciled_or_missing_detail++;
      continue;
    }
    const slot = item.equipmentSlotHash as ArmorCombinationSlotHash;
    bySlot.get(slot)!.push({
      piece: {itemInstanceId: item.itemInstanceId, itemHash: item.itemHash,
        equipmentSlotHash: slot, source: item.source, rarity: item.rarity},
      observed, base,
    });
    out.eligibleItems++;
  }
  const pinnedIds = new Set(request.lockedItemInstanceIds ?? []);
  const pinnedSlots = new Set<number>();
  for (const id of pinnedIds) {
    const matches = [...bySlot.values()].flat().filter((v) => v.piece.itemInstanceId === id);
    if (matches.length !== 1 || pinnedSlots.has(matches[0].piece.equipmentSlotHash)) {
      out.reasons.push('A locked item is missing, rejected or conflicts with another locked item in its slot.');
      return out;
    }
    pinnedSlots.add(matches[0].piece.equipmentSlotHash);
  }
  const slots = ARMOR_COMBINATION_SLOT_HASHES.map((hash) => {
    const all = bySlot.get(hash)!;
    const pinned = all.filter((v) => pinnedIds.has(v.piece.itemInstanceId));
    return pinned.length ? pinned : all;
  });
  out.missingSlotHashes = ARMOR_COMBINATION_SLOT_HASHES.filter((_, i) => slots[i].length === 0);
  if (out.missingSlotHashes.length) {
    out.status = 'insufficient_candidates';
    out.reasons.push('No fully reconciled, eligible armor is available for every required slot.');
    return out;
  }
  // Explore promising branches first, but never claim optimality if truncated.
  slots.forEach((choices) => choices.sort((a, b) =>
    (scoreOf(b.observed, weights) ?? Number.NEGATIVE_INFINITY) -
    (scoreOf(a.observed, weights) ?? Number.NEGATIVE_INFINITY) ||
    a.piece.itemInstanceId.localeCompare(b.piece.itemInstanceId)));
  // Loose suffix lower/upper bounds are safe even with exotic restrictions.
  const suffixLow: number[][] = Array.from({length: 6}, () => Array(6).fill(0));
  const suffixHigh: number[][] = Array.from({length: 6}, () => Array(6).fill(0));
  for (let depth = 4; depth >= 0; depth--) {
    for (let s = 0; s < 6; s++) {
      suffixLow[depth][s] = suffixLow[depth + 1][s] + Math.min(...slots[depth].map((v) => v.observed[s]));
      suffixHigh[depth][s] = suffixHigh[depth + 1][s] + Math.max(...slots[depth].map((v) => v.observed[s]));
    }
  }
  // Reject inputs whose loose five-piece envelope already exceeds JS exact
  // integer precision; never use imprecise bounds for Min/Max pruning.
  if (suffixLow[0].some((n) => !safeInt(n)) || suffixHigh[0].some((n) => !safeInt(n))) {
    out.reasons.push('Five-piece stat envelope exceeds safe integer precision.');
    return out;
  }
  const best: ArmorCombinationResult[] = [];
  const picked: ValidPiece[] = [];
  let truncated = false;
  const inRange = (values: readonly number[], nextDepth: number) => ranges.every(([min, max], s) =>
    (min === null || values[s] + suffixHigh[nextDepth][s] >= min) &&
    (max === null || values[s] + suffixLow[nextDepth][s] <= max));
  const dfs = (depth: number, observed: readonly number[], base: readonly number[], exotic: number): void => {
    if (truncated || !inRange(observed, depth)) return;
    if (depth === 5) {
      if (out.evaluatedCombinations >= maxEvaluations) { truncated = true; return; }
      out.evaluatedCombinations++;
      const score = scoreOf(observed, weights);
      if (score === null) {
        truncated = true;
        out.reasons.push('Unsafe arithmetic: candidate ranking score exceeds safe integer precision.');
        return;
      }
      const pieces = picked.map((v) => ({...v.piece}));
      const candidate: ArmorCombinationResult = {
        pieces, observedGearStats: [...observed], baseRollStats: [...base],
        weightedScore: score, requiresTransfer: pieces.some((p) =>
          p.source === 'vault' || p.source === 'other_guardian'),
        readOnly: true, installabilityVerified: false, certifiedForOptimization: false,
      };
      best.push(candidate);
      best.sort((a, b) => b.weightedScore - a.weightedScore ||
        keyFor(a.pieces).localeCompare(keyFor(b.pieces)));
      if (best.length > maxResults) best.pop();
      return;
    }
    for (const v of slots[depth]) {
      if (truncated) return;
      if (exotic + Number(v.piece.rarity === 'exotic') > 1) continue;
      const newObserved = sumVectors(observed, v.observed);
      const newBase = sumVectors(base, v.base);
      if (!newObserved || !newBase) {
        truncated = true;
        out.reasons.push('Unsafe arithmetic: combined armor stats exceed safe integer precision.');
        return;
      }
      picked.push(v);
      dfs(depth + 1, newObserved, newBase, exotic + Number(v.piece.rarity === 'exotic'));
      picked.pop();
    }
  };
  dfs(0, Array(6).fill(0), Array(6).fill(0), 0);
  out.results = best;
  out.status = truncated ? 'truncated' : 'complete';
  out.searchComplete = !truncated;
  if (truncated) out.reasons.push('Search budget or numeric safety limit reached; rankings are provisional, not proven globally optimal.');
  out.reasons.push('Only currently installed item mods/tuning were retained; no mod redistribution, transfers or Bungie equip operations performed.');
  return out;
}
