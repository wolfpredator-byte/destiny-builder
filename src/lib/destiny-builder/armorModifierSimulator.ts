/**
 * Destiny Builder — Engine-B0.5a: pure, read-only mathematical armor simulation.
 * IMPORTANT: a simulated result says nothing about socket availability, energy,
 * masterwork, ownership, or legal equipability. B0.5b must verify those separately.
 */
import { ARMOR_3_STAT_IDS } from './armorBaseStatsResolver';

const STAT_NAMES: Record<number, string> = {
  2996146975: 'Weapons', 392767087: 'Health', 1943323491: 'Class',
  1735777505: 'Grenade', 144602215: 'Super', 4244567218: 'Melee',
};
const STAT_SET = new Set<number>(ARMOR_3_STAT_IDS);
const GENERAL = 'enhancements.v2_general' as const;
const TUNING = 'core.gear_systems.armor_tiering.plugs.tuning.mods' as const;
const BALANCED_HASH = 3122197216;

export interface ArmorBaseStats {
  statHash: number;
  value: number;
  name: string;
}

export interface ModifierConfig {
  plugHash: number;
  name: string;
  category: typeof GENERAL | typeof TUNING;
  /** Direct contributions must be explicitly attested as unconditional.
   * For Balanced Tuning use [] or the six +1 conditional Manifest candidates. */
  contributions: (ArmorBaseStats & { isConditionallyActive?: boolean | null })[];
  /** Explicit rule; only the documented Balanced Tuning plug hash is accepted. */
  rule?: 'balanced_lowest_three';
  /** Deprecated B0.5a draft alias, accepted only with the documented plug hash. */
  isBalancedTuning?: boolean;
  /** false REQUIRED for direct effects; Balanced's known rule is an exception. */
  hasConditionalEffects?: boolean;
}

export interface SimulatorInput {
  baseStats: ArmorBaseStats[];
  modifiers: ModifierConfig[];
  baseProvenance?: 'reconciled_roll_candidate' | 'unverified';
}

export interface SimulatorResult {
  mathematicallyValid: boolean;
  installabilityVerified: false;
  certifiedForOptimization: false;
  baseProvenance: 'reconciled_roll_candidate' | 'unverified';
  reason: string;
  baseStats: ArmorBaseStats[];
  baseTotal: number;
  modifierContributions: ArmorBaseStats[];
  tuningContributions: ArmorBaseStats[];
  simulatedStats: ArmorBaseStats[];
  totalChange: number;
  simulatedTotal: number;
  appliedModifiers: {
    plugHash: number;
    name: string;
    category: string;
    rule?: 'balanced_lowest_three';
    contributions: ArmorBaseStats[];
  }[];
}

type StatVector = Map<number, number>;
const vector = (): StatVector => new Map(ARMOR_3_STAT_IDS.map((hash) => [hash, 0]));
const asStats = (v: ReadonlyMap<number, number>): ArmorBaseStats[] =>
  ARMOR_3_STAT_IDS.map((statHash) => ({
    statHash, name: STAT_NAMES[statHash], value: v.get(statHash) ?? 0,
  }));

function addSafe(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error('Stat arithmetic overflow.');
  return sum;
}
function sumSafe(values: Iterable<number>): number {
  let sum = 0;
  for (const n of values) sum = addSafe(sum, n);
  return sum;
}
function addInto(dest: StatVector, src: ReadonlyMap<number, number>): void {
  for (const hash of ARMOR_3_STAT_IDS) {
    dest.set(hash, addSafe(dest.get(hash) ?? 0, src.get(hash) ?? 0));
  }
}
function parseStats(
  stats: unknown, complete: boolean, context: string,
  allowConditional = false, allowNegative = true,
): StatVector {
  if (!Array.isArray(stats) || (complete && stats.length !== ARMOR_3_STAT_IDS.length)) {
    throw new Error(`${context}: ${complete ? 'exactly six' : 'an array of'} Armor 3.0 stats required.`);
  }
  const seen = new Set<number>();
  const out = vector();
  for (const entry of stats) {
    if (!entry || !STAT_SET.has(entry.statHash) || seen.has(entry.statHash) ||
        !Number.isSafeInteger(entry.value) ||
        (!allowNegative && entry.value < 0) ||
        (entry.isConditionallyActive !== undefined &&
          entry.isConditionallyActive !== false &&
          !(allowConditional && entry.isConditionallyActive === true))) {
      throw new Error(`${context}: duplicate, unsupported, conditional or malformed stat.`);
    }
    seen.add(entry.statHash);
    out.set(entry.statHash, entry.value);
  }
  if (complete && seen.size !== ARMOR_3_STAT_IDS.length) {
    throw new Error(`${context}: incomplete stat vector.`);
  }
  return out;
}

function parseBalancedEvidence(entries: ModifierConfig['contributions']): void {
  if (entries.length === 0) return; // Documented hash + explicit rule suffice for math-only simulation.
  const parsed = parseStats(entries, true, 'Balanced Tuning evidence', true);
  if (ARMOR_3_STAT_IDS.some((hash) => parsed.get(hash) !== 1) ||
      entries.some((entry) => entry.isConditionallyActive !== true)) {
    throw new Error('Balanced Tuning evidence must contain six conditional +1 candidates.');
  }
}

/** +1 to the unique three lowest stats AFTER direct modifiers, BEFORE Balanced. */
function balancedContributions(preBalanced: ReadonlyMap<number, number>): StatVector {
  const ranking = ARMOR_3_STAT_IDS.map((statHash) => ({
    statHash, value: preBalanced.get(statHash)!,
  })).sort((a, b) => a.value - b.value || a.statHash - b.statHash);
  if (ranking[2].value === ranking[3].value) {
    throw new Error('Balanced Tuning: third/fourth lowest stats are tied; cannot resolve safely.');
  }
  const out = vector();
  for (const entry of ranking.slice(0, 3)) out.set(entry.statHash, 1);
  return out;
}

export function simulateArmorModifiers(input: SimulatorInput): SimulatorResult {
  const result: SimulatorResult = {
    mathematicallyValid: false, installabilityVerified: false,
    certifiedForOptimization: false, baseProvenance: 'unverified', reason: '',
    baseStats: [], baseTotal: 0, modifierContributions: [], tuningContributions: [],
    simulatedStats: [], totalChange: 0, simulatedTotal: 0, appliedModifiers: [],
  };
  try {
    if (!input || typeof input !== 'object') throw new Error('Simulator input is missing.');
    if (input.baseProvenance !== undefined &&
        input.baseProvenance !== 'unverified' &&
        input.baseProvenance !== 'reconciled_roll_candidate') {
      throw new Error('Invalid base provenance.');
    }
    result.baseProvenance = input.baseProvenance ?? 'unverified';
    const base = parseStats(input.baseStats, true, 'Base stats', false, false);
    result.baseStats = asStats(base);
    result.baseTotal = sumSafe(base.values());
    if (!Array.isArray(input.modifiers)) throw new Error('Modifiers must be an array.');

    const seenPlugs = new Set<number>();
    const modifiers = vector();
    const tuning = vector();
    const applications: SimulatorResult['appliedModifiers'] = [];
    let generalCount = 0;
    let tuningCount = 0;
    let useBalanced: ModifierConfig | undefined;

    for (const mod of input.modifiers) {
      if (!mod || !Number.isSafeInteger(mod.plugHash) || mod.plugHash <= 0 || mod.plugHash > 0xffffffff) {
        throw new Error('Invalid modifier plug hash.');
      }
      if (seenPlugs.has(mod.plugHash)) throw new Error('Duplicate modifier plug hash.');
      seenPlugs.add(mod.plugHash);
      if (mod.category !== GENERAL && mod.category !== TUNING) {
        throw new Error('Unsupported modifier category.');
      }
      if (!Array.isArray(mod.contributions)) throw new Error('Modifier contributions are missing.');
      if (typeof mod.name !== 'string') throw new Error('Modifier name is invalid.');

      if (mod.category === GENERAL && ++generalCount > 1) {
        throw new Error('More than one general stat mod on the same armor piece is unsupported.');
      }
      if (mod.category === TUNING && ++tuningCount > 1) {
        throw new Error('More than one tuning plug on the same armor piece is unsupported.');
      }

      const balancedRequested = mod.rule === 'balanced_lowest_three' || mod.isBalancedTuning === true;
      const balancedHash = mod.plugHash === BALANCED_HASH && mod.category === TUNING;
      if (balancedRequested || balancedHash) {
        if (!balancedRequested || !balancedHash ||
            (mod.rule !== undefined && mod.rule !== 'balanced_lowest_three') ||
            mod.isBalancedTuning === false) {
          throw new Error('Balanced Tuning rule must use its documented tuning plug hash.');
        }
        parseBalancedEvidence(mod.contributions);
        useBalanced = mod;
        continue;
      }
      if (mod.rule !== undefined || mod.isBalancedTuning === true) {
        throw new Error('Unknown modifier rule.');
      }
      if (mod.hasConditionalEffects !== false) {
        throw new Error('Direct modifier effects must be explicitly confirmed unconditional.');
      }
      const vectorValue = parseStats(mod.contributions, false, `Modifier ${mod.plugHash}`);
      if (!mod.contributions.length || !Array.from(vectorValue.values()).some((n) => n !== 0)) {
        throw new Error('Direct modifier must declare a nonzero numeric contribution.');
      }
      addInto(mod.category === GENERAL ? modifiers : tuning, vectorValue);
      applications.push({plugHash: mod.plugHash, name: mod.name, category: mod.category,
        contributions: asStats(vectorValue)});
    }

    const preBalanced = new Map(base);
    addInto(preBalanced, modifiers);
    addInto(preBalanced, tuning);
    if (useBalanced) {
      const plusOne = balancedContributions(preBalanced);
      addInto(tuning, plusOne);
      applications.push({
        plugHash: useBalanced.plugHash, name: useBalanced.name, category: useBalanced.category,
        rule: 'balanced_lowest_three', contributions: asStats(plusOne),
      });
    }
    const simulated = new Map(base);
    addInto(simulated, modifiers);
    addInto(simulated, tuning);
    const finalTotal = sumSafe(simulated.values());
    const change = addSafe(finalTotal, -result.baseTotal);

    result.modifierContributions = asStats(modifiers);
    result.tuningContributions = asStats(tuning);
    result.simulatedStats = asStats(simulated);
    result.simulatedTotal = finalTotal;
    result.totalChange = change;
    result.appliedModifiers = applications;
    result.mathematicallyValid = true;
    result.reason = 'Mathematical simulation only; installation legality not verified.';
  } catch (error) {
    result.reason = error instanceof Error ? error.message : String(error);
  }
  return result;
}
