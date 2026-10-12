/**
 * Destiny Builder — Phase 8R.4.4: mechanics-aware owned-armor optimizer.
 * Install at src/lib/destiny-builder/armorOptimizer.ts
 *
 * Pure/read-only, bounded, deterministic. Ranks VERIFIED armor-item stat sums,
 * not combat performance, DPS, perks or final Guardian stats. No network,
 * Bungie equip/write, storage, or Manifest-only inventory. Every result is a
 * hypothetical loadout that the UI must separately preview/confirm.
 *
 * Inputs are the existing BuildContext, scope=detail cache, and observed facts
 * from collectCompatibilityFacts(core, account, detailsByInstanceId).
 */
import type { BuildContext, ChosenPerk, ItemDetail, KnownItem, SelectedGear, StatValue } from "./buildContext";
import { resolveBuildMechanics, type MechanicsReport } from "./mechanicsResolver";
import {
  calculateGuardianArmorStats,
  validateBuildCompatibility,
  type CompatibilityFacts,
  type CompatibilityReport,
  type GuardianArmorStatsReport,
} from "./compatibilityValidator";

export const ARMOR_3_STATS = [
  { statHash: 2996146975, name: "Weapons" },
  { statHash: 392767087, name: "Health" },
  { statHash: 1943323491, name: "Class" },
  { statHash: 1735777505, name: "Grenade" },
  { statHash: 144602215, name: "Super" },
  { statHash: 4244567218, name: "Melee" },
] as const;

export const ARMOR_SLOTS = [
  { slotHash: 3448274439, name: "Helmet" },
  { slotHash: 3551918588, name: "Gauntlets" },
  { slotHash: 14239492, name: "Chest" },
  { slotHash: 20886954, name: "Legs" },
  { slotHash: 1585787867, name: "Class item" },
] as const;

type ArmorStatHash = (typeof ARMOR_3_STATS)[number]["statHash"];
type ArmorSlotHash = (typeof ARMOR_SLOTS)[number]["slotHash"];
const STAT_HASHES = new Set<number>(ARMOR_3_STATS.map((s) => s.statHash));
const SLOT_HASHES = new Set<number>(ARMOR_SLOTS.map((s) => s.slotHash));

export interface ArmorStatPriority {
  statHash: ArmorStatHash;
  /** Ranking importance only; NOT an in-game conversion or damage multiplier. */
  weight: number;
}
export interface ArmorStatMinimum {
  statHash: ArmorStatHash;
  /** Minimum sum across the 5 item detail stats, not final Guardian stat. */
  value: number;
}
export interface ArmorStatMaximumLoss {
  statHash: ArmorStatHash;
  /** Hard cap: candidate item-level total cannot fall more than value below baseline. */
  value: number;
}
export interface RequiredArmorSet {
  /** Exact Bungie item-set hash. Do not use its localized display name. */
  setHash: number;
  minPieces: number;
}
export interface ArmorOptimizationRequest {
  context: BuildContext;
  /** Current scope=detail responses. Only matching item instance/hash pairs count. */
  detailsByInstanceId: Readonly<Record<string, ItemDetail | null | undefined>>;
  /** Metadata from collectCompatibilityFacts; required to verify exotic/set identity. */
  facts: CompatibilityFacts;
  priorities: readonly ArmorStatPriority[];
  minimums?: readonly ArmorStatMinimum[];
  /** Optional hard loss caps relative to current five-piece armor (requires complete baseline). */
  maxStatLosses?: readonly ArmorStatMaximumLoss[];
  /** Optional tradeoff penalty from 0 to 10 per item-stat point lost versus current build.
   * Zero is backwards-compatible pure weighted optimization. This is a USER
   * preference, NOT a Bungie gameplay/performance score. Requires full baseline. */
  lossAversion?: number;
  /** Exact IDs from resolveBuildMechanics(context), not names or free text.
   * Required mechanics must remain recognized AND must not lose verified
   * eligibility. Unknown effects are never assumed absent. */
  protectedMechanicIds?: readonly string[];
  /** Keep these known conditional chains in the optimized configuration. */
  protectedChainIds?: readonly string[];
  /** Optional user-defined loss costs. Each loss deducts the given amount
   * from ranking, without claiming any damage or proc-equivalence. 0..1000. */
  mechanicLossCost?: number;
  chainLossCost?: number;
  setThresholdLossCost?: number;
  /** OPTIONAL separate BuildContext created from the same fresh core snapshot,
   * WITHOUT a local draft. Must independently verify Bungie-equipped locations.
   * The optimizer ALWAYS ranks relative to `context` (current Builder Preview). */
  equippedReferenceContext?: BuildContext;
  /** These exact owned instances MUST remain in the optimized loadout. */
  lockedInstanceIds?: readonly string[];
  /** Default true: if wearing an Exotic armor piece, keep it unless explicitly disabled. */
  preserveCurrentExotic?: boolean;
  /** Optional 2/4-piece target; only a verified setHash can satisfy this. */
  requiredSet?: RequiredArmorSet;
  /** Default 5; max 10. */
  maxResults?: number;
  /** DFS node budget; default 150,000 (20,000 when mechanics-aware), max 500,000. */
  maxSearchNodes?: number;
}

export interface ArmorOptimizerMissingDetail {
  itemInstanceId: string;
  itemHash: number;
  name: string;
  slotHash: ArmorSlotHash;
  reason: "not_loaded" | "invalid_or_incomplete";
}
export interface OptimizedArmorPart {
  slotHash: ArmorSlotHash;
  slotName: string;
  itemInstanceId: string;
  itemHash: number;
  name: string;
  position: string;
  exotic: boolean;
  /** Whether it replaces the item in the current Builder preview. */
  changesCurrentSelection: boolean;
}
export interface ArmorStatResult {
  statHash: ArmorStatHash;
  name: string;
  itemTotal: number;
  /** Null if current BuildContext has missing item-detail coverage. */
  deltaFromCurrent: number | null;
}
export interface ArmorTradeoff {
  statHash: ArmorStatHash;
  name: string;
  delta: number;
}
export interface ArmorSetThresholdDelta {
  /** Threshold met by exact Bungie set identity; NOT a combat proc. */
  setHash: number;
  setName: string;
  perkName: string;
  requiredPieces: number;
}
export interface ArmorMechanicsDifference {
  /** Sources newly/lost from the current exact-hash rule catalog. */
  newlyRecognized: string[];
  noLongerRecognized: string[];
  /** Mechanics present but NOT guaranteed to activate in combat. */
  missingRequirements: string[];
  newlyRecognizedChains: string[];
  noLongerRecognizedChains: string[];
  /** The catalog is incomplete: zero changes does not imply zero gameplay changes. */
  catalogVersion: MechanicsReport["catalogVersion"];
}
export interface OptimizedArmorLoadout {
  id: string;
  /** Weighted sum of item stats; only meaningful relative to the same priorities. */
  objectiveScore: number;
  /** Weighted stat score minus the requested, explicit loss-aversion penalty. */
  rankingScore: number;
  lossPenalty: number;
  /** Transparent, non-gameplay components of the ranking deduction. */
  lossBreakdown: { stat: number; mechanics: number; chains: number; setThresholds: number };
  /** Number of saved rules/chains still recognized in this hypothetical build. */
  preservedRecognized: { mechanics: string[]; chains: string[] };
  /** Deltas against a SEPARATELY VERIFIED Bungie-equipped context; never used for ranking. */
  versusEquipped: { armorChanges: number; stats: ArmorStatResult[] } | null;
  /** All stats are observed item-level totals, NOT final Guardian values. */
  tradeoffs: { gains: ArmorTradeoff[]; losses: ArmorTradeoff[]; unchanged: string[]; baselineComplete: boolean };
  /** Only threshold attainment with Bungie set hashes is compared. */
  setThresholdChanges: { gained: ArmorSetThresholdDelta[]; lost: ArmorSetThresholdDelta[] };
  /** Conservative catalog-level mechanic differences, not performance claims. */
  mechanicsChanges: ArmorMechanicsDifference;
  /** Ready to show in future UI. Statements describe selection math, not DPS. */
  explanations: string[];
  parts: OptimizedArmorPart[];
  stats: ArmorStatResult[];
  armorItemTotal: number;
  changes: number;
  /** Safe identity-based mapping for the UI to resolve in live Bungie snapshot. */
  previewBySlot: Readonly<Record<string, { itemInstanceId: string; itemHash: number }>>;
  /** Validates set thresholds and existing mechanics without claiming a proc happened. */
  compatibility: CompatibilityReport;
}
export interface ArmorOptimizationReport {
  version: 1;
  scope: "owned_verified_item_stats_only";
  status: "ok" | "partial" | "invalid_request" | "no_verified_combination";
  /** True only if every possible eligible item was covered AND search finished. */
  globallyExhaustive: boolean;
  /** True when the eligible-details-only search was not cut short. */
  exhaustedEligibleSearch: boolean;
  nodesVisited: number;
  eligibleCombinationsEvaluated: number;
  currentStats: GuardianArmorStatsReport;
  /** `context` is always the ranking baseline, and may be a local preview. */
  reference: {
    rankingBaseline: "builder_preview" | "bungie_equipped_snapshot" | "uncertain_selection";
    equippedReference: "not_supplied" | "verified" | "incomplete_or_unverified";
    equippedStats: GuardianArmorStatsReport | null;
  };
  /** Known exact-hash mechanics; these IDs can be passed back as hard requirements. */
  baselineMechanics: { catalogVersion: MechanicsReport["catalogVersion"]; mechanics: Array<{ id: string; name: string; configuration: string }>; chains: Array<{ id: string; name: string; configuration: string }> };
  totalOwnedArmorConsidered: number;
  verifiedCandidatesBySlot: Record<string, number>;
  missingDetailCount: number;
  /** A bounded list; count above may be higher. No automatic fetch. */
  missingDetails: ArmorOptimizerMissingDetail[];
  rejected: Record<string, number>;
  results: OptimizedArmorLoadout[];
  warnings: string[];
}

interface Candidate {
  item: KnownItem;
  slot: ArmorSlotHash;
  detail: ItemDetail;
  exotic: boolean;
  setHash: number | null;
  values: readonly number[];
  weightedScore: number;
}

function statVector(detail: ItemDetail): number[] | null {
  if (!Array.isArray(detail.armorStats)) return null;
  const byHash = new Map<number, number>();
  for (const value of detail.armorStats) {
    if (!STAT_HASHES.has(value.statHash)) continue;
    if (byHash.has(value.statHash) || !Number.isInteger(value.value) || value.value < 0) return null;
    byHash.set(value.statHash, value.value);
  }
  if (byHash.size !== ARMOR_3_STATS.length) return null;
  return ARMOR_3_STATS.map((stat) => byHash.get(stat.statHash)!);
}

function chosen(perk: { plugHash: number; name: string; description?: string; effectTags?: ChosenPerk["effectTags"] }): ChosenPerk {
  return { plugHash: perk.plugHash, name: perk.name, description: perk.description ?? "",
    effectTags: perk.effectTags ?? [], effectOrigin: "inferred_from_description",
    availability: "selected_on_item" };
}

function selectArmorPart(candidate: Candidate, baseline: BuildContext): SelectedGear {
  const { item, detail, slot } = candidate;
  const current = baseline.build.gear.find((part) => part.slotHash === slot);
  const selected = new Map<string, ChosenPerk>();
  for (const perk of detail.selectedPerks ?? []) {
    if (perk.state === "selected" || perk.state === undefined)
      selected.set(`${perk.socketIndex}:${perk.plugHash}`, chosen(perk));
  }
  for (const col of detail.perkColumns ?? []) {
    if (col.selected && col.selected.state !== "possible" && col.selected.state !== "rolled")
      selected.set(`${col.selected.socketIndex}:${col.selected.plugHash}`, chosen(col.selected));
  }
  return {
    slotHash: slot, item, detailsLoaded: true,
    isPreview: current?.item.itemInstanceId !== item.itemInstanceId || Boolean(current?.isPreview),
    stats: detail.armorStats as StatValue[],
    selectedPerks: [...selected.values()],
    intrinsicPerks: (detail.intrinsicPerks ?? []).filter((p) =>
      ![...selected.values()].some((selectedPerk) => selectedPerk.plugHash === p.perkHash))
      .map((p) => chosen({ ...p, plugHash: p.perkHash })),
    recoilDirection: null,
    setBonuses: (detail.itemSet?.perks ?? []).map((perk) => ({
      setName: detail.itemSet?.name ?? "", perkName: perk.name,
      requiredPieces: perk.requiredSetCount, effectTags: perk.effectTags ?? [],
    })),
  };
}

/** Set identities are taken ONLY from observed instance facts; identical names are insufficient. */
function attainedSetThresholds(context: BuildContext, facts: CompatibilityFacts): ArmorSetThresholdDelta[] {
  const pieces = new Map<number, number>();
  const bonuses = new Map<string, ArmorSetThresholdDelta>();
  for (const gear of context.build.gear) {
    if (gear.item.category !== "armor" || !gear.item.itemInstanceId) continue;
    const fact = facts[gear.item.itemInstanceId];
    if (!fact || fact.conflicting || fact.itemHash !== gear.item.itemHash ||
      !Number.isInteger(fact.setHash) || (fact.setHash ?? 0) <= 0 || !gear.detailsLoaded) continue;
    const hash = fact.setHash!;
    pieces.set(hash, (pieces.get(hash) ?? 0) + 1);
    for (const perk of gear.setBonuses ?? []) {
      if (!Number.isInteger(perk.requiredPieces) || perk.requiredPieces < 1 ||
        !perk.perkName.trim() || !perk.setName.trim()) continue;
      bonuses.set(`${hash}:${perk.requiredPieces}:${perk.perkName}`, {
        setHash: hash, setName: perk.setName, perkName: perk.perkName,
        requiredPieces: perk.requiredPieces,
      });
    }
  }
  return [...bonuses.values()].filter((perk) => (pieces.get(perk.setHash) ?? 0) >= perk.requiredPieces)
    .sort((a, b) => a.setHash - b.setHash || a.requiredPieces - b.requiredPieces ||
      a.perkName.localeCompare(b.perkName));
}
function differenceByKey<T>(before: readonly T[], after: readonly T[], id: (part: T) => string): {
  gained: T[]; lost: T[];
} {
  const old = new Set(before.map(id));
  const next = new Set(after.map(id));
  return { gained: after.filter((part) => !old.has(id(part))),
    lost: before.filter((part) => !next.has(id(part))) };
}
function compareMechanics(before: MechanicsReport, after: MechanicsReport): ArmorMechanicsDifference {
  const mec = differenceByKey(before.mechanics, after.mechanics, (m) => m.id);
  const chains = differenceByKey(before.chains, after.chains, (c) => c.id);
  return {
    newlyRecognized: mec.gained.map((m) => m.title),
    noLongerRecognized: mec.lost.map((m) => m.title),
    missingRequirements: after.mechanics.filter((m) => m.configuration === "missing_requirement")
      .map((m) => m.title),
    newlyRecognizedChains: chains.gained.map((c) => c.title),
    noLongerRecognizedChains: chains.lost.map((c) => c.title),
    catalogVersion: after.catalogVersion,
  };
}

const finiteInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/**
 * Enumerate with a bounded branch-and-bound search. Scores only actual item
 * stat values, respects ownership/class/slot/exotic/locked items/set targets.
 * When details or search coverage are incomplete, never claim global optimality.
 */
export function optimizeOwnedArmor(request: ArmorOptimizationRequest): ArmorOptimizationReport {
  const { context, detailsByInstanceId, facts } = request;
  const currentStats = calculateGuardianArmorStats(context);
  const baselineMechanics = resolveBuildMechanics(context);
  const baselineSets = attainedSetThresholds(context, facts);
  const actualEquipped = request.equippedReferenceContext;
  const requiredSlots = new Set<number>(ARMOR_SLOTS.map((x) => x.slotHash));
  const referenceVerified = (candidate: BuildContext | undefined): candidate is BuildContext => {
    if (!candidate || candidate.guardian.characterId !== context.guardian.characterId) return false;
    const selected = candidate.build.gear.filter((g) => g.item.category === "armor");
    return selected.length === 5 && new Set(selected.map((g) => g.slotHash)).size === 5 &&
      selected.every((g) => requiredSlots.has(g.slotHash) && !g.isPreview &&
        g.item.availability === "owned" && g.item.positionStatus === "confirmed" &&
        g.item.position === `${context.guardian.characterId}:equipped`);
  };
  const actualIsVerified = referenceVerified(actualEquipped);
  const actualStats = actualIsVerified ? calculateGuardianArmorStats(actualEquipped) : null;
  const equippedBySlot = actualIsVerified ? new Map(actualEquipped.build.gear.filter((g) => g.item.category === "armor")
    .map((g) => [g.slotHash, g.item.itemInstanceId])) : null;
  const previewArmor = context.build.gear.filter((g) => g.item.category === "armor");
  const rankingBaseline = previewArmor.some((g) => g.isPreview) ? "builder_preview" :
    referenceVerified(context) ? "bungie_equipped_snapshot" : "uncertain_selection";
  const warnings = [
    "Scores rank weighted Bungie ARMOR ITEM stats only; they are not final Guardian stats, proc strength, combat effectiveness or DPS.",
    "Item stats may already include installed mods/tuning. Subclass and temporary modifiers are not added again.",
    "A candidate is only a hypothetical selection; equipment is never moved or equipped by this module.",
  ];
  const rejected: Record<string, number> = {};
  const bump = (key: string) => { rejected[key] = (rejected[key] ?? 0) + 1; };
  const report: ArmorOptimizationReport = {
    version: 1, scope: "owned_verified_item_stats_only", status: "invalid_request",
    globallyExhaustive: false, exhaustedEligibleSearch: false,
    nodesVisited: 0, eligibleCombinationsEvaluated: 0, currentStats,
    reference: { rankingBaseline, equippedReference: actualIsVerified && actualStats?.complete ? "verified" :
      actualEquipped ? "incomplete_or_unverified" : "not_supplied", equippedStats: actualStats },
    baselineMechanics: { catalogVersion: baselineMechanics.catalogVersion,
      mechanics: baselineMechanics.mechanics.map((m) => ({ id: m.id, name: m.title, configuration: m.configuration })),
      chains: baselineMechanics.chains.map((c) => ({ id: c.id, name: c.title, configuration: c.configuration })) },
    totalOwnedArmorConsidered: 0, verifiedCandidatesBySlot: {},
    missingDetailCount: 0, missingDetails: [], rejected, results: [], warnings,
  };

  if (actualEquipped && !actualIsVerified) warnings.push("Provided equippedReferenceContext is not verifiably the Bungie-equipped five-piece snapshot; no comparison with equipped gear is asserted.");
  if (rankingBaseline === "builder_preview") warnings.push("Ranking baseline is the CURRENT local Builder Preview, not the live Bungie loadout. New previews become the baseline for the next search.");
  const baseline = ARMOR_3_STATS.map((stat) => currentStats.stats.find((s) => s.statHash === stat.statHash)?.value ?? null);
  const baselineComplete = baseline.every((value) => value !== null);
  const lossAversion = request.lossAversion ?? 0;
  if (!finiteInt(lossAversion, 0, 10)) {
    warnings.push("lossAversion must be an integer between 0 and 10.");
    return report;
  }
  if ((lossAversion > 0 || (request.maxStatLosses?.length ?? 0) > 0) && !baselineComplete) {
    warnings.push("Tradeoff loss limits require complete current five-piece armor stats; no missing baseline can be treated as zero.");
    return report;
  }
  if (lossAversion > 0) warnings.push(`Tradeoff-aware ranking: ${lossAversion} score points removed per observed armor-stat point lost from the current five pieces. This is preference math, not gameplay efficiency.`);
  const mechanicLossCost = request.mechanicLossCost ?? 0;
  const chainLossCost = request.chainLossCost ?? 0;
  const setThresholdLossCost = request.setThresholdLossCost ?? 0;
  if (![mechanicLossCost, chainLossCost, setThresholdLossCost].every((v) => finiteInt(v, 0, 1000))) {
    warnings.push("Catalog-mechanic, chain, and set threshold loss costs must be whole numbers 0..1000.");
    return report;
  }
  const protectedMechanicIds = new Set(request.protectedMechanicIds ?? []);
  const protectedChainIds = new Set(request.protectedChainIds ?? []);
  if (protectedMechanicIds.size !== (request.protectedMechanicIds ?? []).length ||
      protectedChainIds.size !== (request.protectedChainIds ?? []).length ||
      [...protectedMechanicIds].some((id) => !baselineMechanics.mechanics.some((m) => m.id === id)) ||
      [...protectedChainIds].some((id) => !baselineMechanics.chains.some((c) => c.id === id))) {
    warnings.push("Protected IDs must uniquely identify mechanics/chains already observed in the selected baseline; unknown catalog IDs cannot be protected.");
    return report;
  }
  if (protectedMechanicIds.size || protectedChainIds.size || mechanicLossCost || chainLossCost || setThresholdLossCost)
    warnings.push("Mechanical preferences operate ONLY on exact-hash recognized rules and verified set thresholds. Unknown mechanics are not graded or treated as absent.");
  const weights = new Array<number>(ARMOR_3_STATS.length).fill(0);
  const floors = new Array<number>(ARMOR_3_STATS.length).fill(0);
  if (!Array.isArray(request.priorities) || request.priorities.length === 0) {
    warnings.push("Select at least one priority statistic before searching.");
    return report;
  }
  const seenPriorities = new Set<number>();
  for (const entry of request.priorities) {
    const index = ARMOR_3_STATS.findIndex((s) => s.statHash === entry.statHash);
    if (index < 0 || seenPriorities.has(entry.statHash) || !finiteInt(entry.weight, 0, 10)) {
      warnings.push("Invalid or duplicated stat priority; weights must be integers from 0 to 10.");
      return report;
    }
    seenPriorities.add(entry.statHash);
    weights[index] = entry.weight;
  }
  if (!weights.some((w) => w > 0)) {
    warnings.push("At least one priority must have a positive weight.");
    return report;
  }
  const seenMinimums = new Set<number>();
  for (const entry of request.minimums ?? []) {
    const index = ARMOR_3_STATS.findIndex((s) => s.statHash === entry.statHash);
    if (index < 0 || seenMinimums.has(entry.statHash) || !finiteInt(entry.value, 0, 500)) {
      warnings.push("Invalid or duplicated minimum; item-stat floors must be integers between 0 and 500.");
      return report;
    }
    seenMinimums.add(entry.statHash);
    floors[index] = entry.value;
  }
  const seenLossCaps = new Set<number>();
  for (const entry of request.maxStatLosses ?? []) {
    const index = ARMOR_3_STATS.findIndex((s) => s.statHash === entry.statHash);
    if (index < 0 || seenLossCaps.has(entry.statHash) || !finiteInt(entry.value, 0, 500)) {
      warnings.push("Invalid or duplicated maxStatLosses; each allowed loss must be an integer from 0 to 500.");
      return report;
    }
    seenLossCaps.add(entry.statHash);
    floors[index] = Math.max(floors[index], baseline[index]! - entry.value);
  }
  if (request.requiredSet && (!finiteInt(request.requiredSet.setHash, 1, 0xffffffff) ||
    !finiteInt(request.requiredSet.minPieces, 1, 5))) {
    warnings.push("A required set needs an exact positive Bungie set hash and between 1 and 5 pieces.");
    return report;
  }
  if (request.maxResults !== undefined && !finiteInt(request.maxResults, 1, 10)) {
    warnings.push("maxResults must be between 1 and 10."); return report;
  }
  if (request.maxSearchNodes !== undefined && !finiteInt(request.maxSearchNodes, 100, 500000)) {
    warnings.push("maxSearchNodes must be between 100 and 500000."); return report;
  }
  const limit = request.maxResults ?? 5;
  // Full mechanics/set checks at DFS leaves are more expensive than pure stat math.
  // Default to a smaller bounded exploration; UI can request a larger budget,
  // and the report explicitly says when the search was not exhaustive.
  const mechanicsAwareRequested = protectedMechanicIds.size > 0 || protectedChainIds.size > 0 ||
    mechanicLossCost > 0 || chainLossCost > 0 || setThresholdLossCost > 0;
  const nodeBudget = request.maxSearchNodes ?? (mechanicsAwareRequested ? 20000 : 150000);
  if (context.guardian.classType == null || !Number.isInteger(context.guardian.classType)) {
    warnings.push("Guardian class is not verified, so class-restricted armor cannot be safely optimized.");
    return report;
  }
  if (!context.account.complete)
    warnings.push("Vault or other Guardian inventory is not fully loaded; the search cannot cover all owned armor.");

  const bySlot = new Map<ArmorSlotHash, Candidate[]>();
  for (const { slotHash } of ARMOR_SLOTS) bySlot.set(slotHash, []);
  const missingIds = new Set<string>();
  let uncoveredEligible = 0;
  const unique = new Set<string>();
  for (const item of context.account.items) {
    if (item.category !== "armor" || !SLOT_HASHES.has(item.equipmentSlotHash ?? -1)) continue;
    if (!item.itemInstanceId) { bump("no_instance_id"); uncoveredEligible++; continue; }
    if (unique.has(item.itemInstanceId)) { bump("duplicate_instance"); continue; }
    unique.add(item.itemInstanceId);
    report.totalOwnedArmorConsidered += 1;
    if (item.availability !== "owned" || item.positionStatus !== "confirmed" || !item.position ||
        item.position.startsWith("unknown:")) { bump("unverified_ownership_or_position"); uncoveredEligible++; continue; }
    if (item.classType !== 3 && item.classType !== context.guardian.classType) {
      bump(item.classType === null ? "unknown_class" : "wrong_class");
      if (item.classType === null) uncoveredEligible++;
      continue;
    }
    const fact = facts[item.itemInstanceId];
    if (!fact || fact.itemHash !== item.itemHash || fact.conflicting || fact.exotic === null) {
      bump("missing_or_conflicting_rarity"); uncoveredEligible++; continue;
    }
    const detail = detailsByInstanceId[item.itemInstanceId];
    const present = Boolean(detail && detail.itemHash === item.itemHash && detail.itemInstanceId === item.itemInstanceId);
    const values = present ? statVector(detail!) : null;
    if (!values) {
      uncoveredEligible++;
      report.missingDetailCount++;
      if (!missingIds.has(item.itemInstanceId) && report.missingDetails.length < 80) {
        report.missingDetails.push({ itemInstanceId: item.itemInstanceId, itemHash: item.itemHash,
          name: item.name, slotHash: item.equipmentSlotHash as ArmorSlotHash,
          reason: detail ? "invalid_or_incomplete" : "not_loaded" });
        missingIds.add(item.itemInstanceId);
      }
      continue;
    }
    const candidate: Candidate = {
      item, slot: item.equipmentSlotHash as ArmorSlotHash, detail: detail!, exotic: fact.exotic,
      setHash: fact.setHash, values,
      weightedScore: values.reduce((sum, v, i) => sum + v * weights[i], 0),
    };
    bySlot.get(candidate.slot)!.push(candidate);
  }
  for (const { slotHash } of ARMOR_SLOTS) {
    bySlot.get(slotHash)!.sort((a, b) => b.weightedScore - a.weightedScore ||
      a.item.itemInstanceId!.localeCompare(b.item.itemInstanceId!));
    report.verifiedCandidatesBySlot[String(slotHash)] = bySlot.get(slotHash)!.length;
  }
  const locked = new Set(request.lockedInstanceIds ?? []);
  if (request.preserveCurrentExotic !== false) {
    // Do not silently drop the currently equipped Exotic when rarity metadata
    // is absent. Without it we cannot know which item needs to stay locked.
    for (const gear of context.build.gear) {
      if (gear.item.category !== "armor") continue;
      const id = gear.item.itemInstanceId;
      const fact = id ? facts[id] : undefined;
      if (!id || !fact || fact.itemHash !== gear.item.itemHash || fact.conflicting || fact.exotic === null) {
        warnings.push(`Cannot verify the rarity of selected armor ${gear.item.name}; preserving the current Exotic requires complete observed facts.`);
        report.status = "partial";
        return report;
      }
    }
  }
  if (request.preserveCurrentExotic !== false) {
    for (const gear of context.build.gear) {
      if (gear.item.category !== "armor" || !gear.item.itemInstanceId) continue;
      if (facts[gear.item.itemInstanceId]?.exotic === true) locked.add(gear.item.itemInstanceId);
    }
  }
  const lockedSlot = new Map<number, string>();
  for (const id of locked) {
    const candidate = [...bySlot.values()].flat().find((item) => item.item.itemInstanceId === id);
    if (!candidate) {
      warnings.push(`Locked instance ${id} is not a verified, class-compatible armor candidate with complete detail.`);
      return report;
    }
    if (lockedSlot.has(candidate.slot) && lockedSlot.get(candidate.slot) !== id) {
      warnings.push("Two locked armor instances would occupy the same slot.");
      return report;
    }
    lockedSlot.set(candidate.slot, id);
  }
  const lockedExotics = [...lockedSlot.entries()].filter(([slot, id]) =>
    bySlot.get(slot as ArmorSlotHash)?.some((candidate) => candidate.item.itemInstanceId === id && candidate.exotic));
  if (lockedExotics.length > 1) {
    warnings.push("Locked armor would require more than one Exotic; no valid loadout can satisfy this request.");
    return report;
  }
  for (const [slot, id] of lockedSlot) {
    bySlot.set(slot as ArmorSlotHash, bySlot.get(slot as ArmorSlotHash)!.filter((entry) => entry.item.itemInstanceId === id));
  }
  const pools = ARMOR_SLOTS.map(({ slotHash }) => bySlot.get(slotHash)!);
  if (pools.some((pool) => pool.length === 0)) {
    warnings.push("One or more armor slots has no verified candidates. Load item details before searching.");
    report.status = "partial";
    return report;
  }
  // An optimistic bound per remaining slot permits exact best-first *ranking*
  // over the verified subset, without enumerating every combination.
  const remainingMaxScore = new Array<number>(6).fill(0);
  const remainingMaxStat = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  const requiredHash = request.requiredSet?.setHash ?? null;
  const remainingSetCapacity = new Array<number>(6).fill(0);
  for (let depth = 4; depth >= 0; depth--) {
    remainingMaxScore[depth] = remainingMaxScore[depth + 1] + pools[depth][0].weightedScore;
    for (let i = 0; i < 6; i++) {
      let max = 0;
      for (const option of pools[depth]) if (option.values[i] > max) max = option.values[i];
      remainingMaxStat[depth][i] = remainingMaxStat[depth + 1][i] + max;
    }
    remainingSetCapacity[depth] = remainingSetCapacity[depth + 1] +
      (requiredHash !== null && pools[depth].some((p) => p.setHash === requiredHash) ? 1 : 0);
  }
  interface Evaluated { members: Candidate[]; score: number; rankScore: number; penalty: number;
    lossBreakdown: { stat: number; mechanics: number; chains: number; setThresholds: number }; id: string }
  // Expensive whole-build resolver checks are only needed when the user enabled
  // an explicit mechanic/set rule. The default 8R.4.3 search stays fast.
  const needsMechanicSearch = mechanicsAwareRequested;
  const oldMechanics = new Map(baselineMechanics.mechanics.map((m) => [m.id, m]));
  const oldChains = new Map(baselineMechanics.chains.map((c) => [c.id, c]));
  const nonDowngraded = (from: string, to: string): boolean => {
    if (from === "eligible" || from === "preview") return to === "eligible" || to === "preview";
    if (from === "unknown") return to !== "missing_requirement" && to !== "theoretical";
    return true;
  };
  const buildAfter = (members: readonly Candidate[]): BuildContext => ({ ...context,
    build: { ...context.build, gear: [
      ...context.build.gear.filter((part) => part.item.category !== "armor"),
      ...members.map((member) => selectArmorPart(member, context)),
    ] },
  });
  const best: Evaluated[] = [];
  const chosen: Candidate[] = [];
  const sums = new Array<number>(6).fill(0);
  let hitBudget = false;
  const better = (a: Evaluated, b: Evaluated) => b.rankScore - a.rankScore || b.score - a.score || a.id.localeCompare(b.id);
  const search = (depth: number, score: number, exoticCount: number, setCount: number) => {
    if (report.nodesVisited >= nodeBudget) { hitBudget = true; return; }
    report.nodesVisited++;
    if (best.length === limit && score + remainingMaxScore[depth] < best[best.length - 1].rankScore) return;
    if (sums.some((sum, i) => sum + remainingMaxStat[depth][i] < floors[i])) return;
    if (request.requiredSet && setCount + remainingSetCapacity[depth] < request.requiredSet.minPieces) return;
    if (depth === 5) {
      report.eligibleCombinationsEvaluated++;
      if (sums.some((v, i) => v < floors[i])) return;
      if (request.requiredSet && setCount < request.requiredSet.minPieces) return;
      const id = chosen.map((p) => p.item.itemInstanceId).join("|");
      const stat = lossAversion * sums.reduce((sum, value, i) =>
        sum + (baseline[i] === null ? 0 : Math.max(0, baseline[i] - value)), 0);
      let mechanics = 0, chains = 0, setThresholds = 0;
      if (needsMechanicSearch) {
        const hypothetical = buildAfter(chosen);
        const after = resolveBuildMechanics(hypothetical);
        const afterMechanics = new Map(after.mechanics.map((m) => [m.id, m]));
        const afterChains = new Map(after.chains.map((c) => [c.id, c]));
        for (const id of protectedMechanicIds) {
          const before = oldMechanics.get(id)!;
          const now = afterMechanics.get(id);
          if (!now || !nonDowngraded(before.configuration, now.configuration)) return;
        }
        for (const id of protectedChainIds) {
          const before = oldChains.get(id)!;
          const now = afterChains.get(id);
          if (!now || !nonDowngraded(before.configuration, now.configuration)) return;
        }
        if (mechanicLossCost) for (const before of baselineMechanics.mechanics) {
          const now = afterMechanics.get(before.id);
          if (!now || !nonDowngraded(before.configuration, now.configuration)) mechanics += mechanicLossCost;
        }
        if (chainLossCost) for (const before of baselineMechanics.chains) {
          const now = afterChains.get(before.id);
          if (!now || !nonDowngraded(before.configuration, now.configuration)) chains += chainLossCost;
        }
        if (setThresholdLossCost) {
          const afterSets = attainedSetThresholds(hypothetical, facts);
          const changed = differenceByKey(baselineSets, afterSets, (x) =>
            `${x.setHash}:${x.requiredPieces}:${x.perkName}`);
          setThresholds = changed.lost.length * setThresholdLossCost;
        }
      }
      const penalty = stat + mechanics + chains + setThresholds;
      const result: Evaluated = { members: [...chosen], score, rankScore: score - penalty, penalty,
        lossBreakdown: { stat, mechanics, chains, setThresholds }, id };
      if (best.length < limit || better(result, best[best.length - 1]) < 0) {
        best.push(result); best.sort(better); if (best.length > limit) best.pop();
      }
      return;
    }
    for (const candidate of pools[depth]) {
      if (candidate.exotic && exoticCount > 0) continue;
      chosen.push(candidate);
      for (let i = 0; i < 6; i++) sums[i] += candidate.values[i];
      search(depth + 1, score + candidate.weightedScore,
        exoticCount + (candidate.exotic ? 1 : 0),
        setCount + (requiredHash !== null && candidate.setHash === requiredHash ? 1 : 0));
      for (let i = 0; i < 6; i++) sums[i] -= candidate.values[i];
      chosen.pop();
      if (hitBudget) return;
    }
  };
  search(0, 0, 0, 0);
  const currentIds = new Map(context.build.gear.filter((part) => part.item.category === "armor")
    .map((part) => [part.slotHash, part.item.itemInstanceId] as const));
  let hardConflictsFiltered = 0;
  report.results = best.map(({ members, score, rankScore, penalty, lossBreakdown, id }) => {
    const hypothetical = buildAfter(members);
    const statsReport = calculateGuardianArmorStats(hypothetical);
    const compatibility = validateBuildCompatibility(hypothetical, facts);
    const hypotheticalMechanics = resolveBuildMechanics(hypothetical);
    const mechanicsChanges = compareMechanics(baselineMechanics, hypotheticalMechanics);
    const afterSets = attainedSetThresholds(hypothetical, facts);
    const setChanges = differenceByKey(baselineSets, afterSets,
      (x) => `${x.setHash}:${x.requiredPieces}:${x.perkName}`);
    const stats = ARMOR_3_STATS.map((stat, i) => ({
      statHash: stat.statHash, name: stat.name, itemTotal: statsReport.stats[i].value!,
      deltaFromCurrent: currentStats.stats[i].value === null ? null :
        statsReport.stats[i].value! - currentStats.stats[i].value!,
    }));
    const previewBySlot: Record<string, { itemInstanceId: string; itemHash: number }> = {};
    const parts = members.map((member, i) => {
      const itemInstanceId = member.item.itemInstanceId!;
      previewBySlot[String(member.slot)] = { itemInstanceId, itemHash: member.item.itemHash };
      return { slotHash: member.slot, slotName: ARMOR_SLOTS[i].name, itemInstanceId,
        itemHash: member.item.itemHash, name: member.item.name, position: member.item.position!,
        exotic: member.exotic, changesCurrentSelection: currentIds.get(member.slot) !== itemInstanceId };
    });
    const versusEquipped = actualIsVerified && actualStats && equippedBySlot ? {
      armorChanges: parts.filter((part) => equippedBySlot.get(part.slotHash) !== part.itemInstanceId).length,
      stats: stats.map((s) => ({ ...s, deltaFromCurrent: actualStats.stats.find((a) => a.statHash === s.statHash)?.value == null
        ? null : s.itemTotal - actualStats.stats.find((a) => a.statHash === s.statHash)!.value! })),
    } : null;
    const preservedRecognized = {
      mechanics: baselineMechanics.mechanics.filter((m) => hypotheticalMechanics.mechanics.some((a) =>
        a.id === m.id && nonDowngraded(m.configuration, a.configuration))).map((m) => m.id),
      chains: baselineMechanics.chains.filter((c) => hypotheticalMechanics.chains.some((a) =>
        a.id === c.id && nonDowngraded(c.configuration, a.configuration))).map((c) => c.id),
    };
    const gains = stats.filter((s) => (s.deltaFromCurrent ?? 0) > 0)
      .map((s) => ({ statHash: s.statHash, name: s.name, delta: s.deltaFromCurrent! }))
      .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
    const losses = stats.filter((s) => (s.deltaFromCurrent ?? 0) < 0)
      .map((s) => ({ statHash: s.statHash, name: s.name, delta: s.deltaFromCurrent! }))
      .sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name));
    const unchanged = stats.filter((s) => s.deltaFromCurrent === 0).map((s) => s.name);
    const explanations: string[] = [];
    if (!baselineComplete) explanations.push("Current five-piece stat baseline incomplete: numeric differences cannot be certified.");
    else {
      if (gains.length) explanations.push(`Item-stat gains: ${gains.map((s) => `${s.name} +${s.delta}`).join(", ")}.`);
      if (losses.length) explanations.push(`Item-stat sacrifices: ${losses.map((s) => `${s.name} ${s.delta}`).join(", ")}.`);
      if (!gains.length && !losses.length) explanations.push("No item-level stat change compared with the current build.");
    }
    if (penalty > 0 || lossAversion || mechanicLossCost || chainLossCost || setThresholdLossCost) explanations.push(
      `Preference ranking: ${score} weighted stat points - ${lossBreakdown.stat} stat tradeoff - ${lossBreakdown.mechanics} recognized mechanic - ${lossBreakdown.chains} chain - ${lossBreakdown.setThresholds} verified set threshold cost = ${rankScore}. None of these amounts represent combat power.`);
    if (protectedMechanicIds.size || protectedChainIds.size) explanations.push(
      `Protected catalog evidence retained: ${protectedMechanicIds.size} mechanic(s) and ${protectedChainIds.size} conditional chain(s). Combat activation NOT observed.`);
    if (setChanges.gained.length) explanations.push(`${setChanges.gained.length} Bungie-hash set threshold(s) newly met (NOT necessarily activated in combat).`);
    if (setChanges.lost.length) explanations.push(`${setChanges.lost.length} Bungie-hash set threshold(s) no longer met.`);
    if (mechanicsChanges.newlyRecognized.length) explanations.push(`New catalog mechanics: ${mechanicsChanges.newlyRecognized.join(", ")}; activation not observed.`);
    if (mechanicsChanges.noLongerRecognized.length) explanations.push(`Lost catalog mechanics: ${mechanicsChanges.noLongerRecognized.join(", ")}.`);
    explanations.push("Catalog and set evidence are incomplete; unrecognized differences are not proof of no gameplay effect.");
    return { id, objectiveScore: score, rankingScore: rankScore, lossPenalty: penalty,
      lossBreakdown, preservedRecognized, versusEquipped,
      tradeoffs: { gains, losses, unchanged, baselineComplete },
      setThresholdChanges: setChanges, mechanicsChanges, explanations, parts, stats,
      armorItemTotal: statsReport.armorItemTotal!,
      changes: parts.filter((part) => part.changesCurrentSelection).length,
      previewBySlot, compatibility };
  }).filter((result) => {
    if (result.compatibility.status === "incompatible") { hardConflictsFiltered++; return false; }
    return true;
  });
  report.exhaustedEligibleSearch = !hitBudget;
  const poolCoverageComplete = uncoveredEligible === 0 && context.account.complete;
  report.globallyExhaustive = report.exhaustedEligibleSearch && poolCoverageComplete;
  if (hitBudget) warnings.push(`Search stopped at ${nodeBudget} nodes. Results are promising, NOT proven best even among loaded details.`);
  if (uncoveredEligible) warnings.push(`${uncoveredEligible} potentially relevant armor instances lacked sufficient ownership/class/rarity/detail evidence; they were excluded, not assigned zero stats.`);
  if ((request.maxStatLosses?.length ?? 0) > 0) warnings.push("Maximum stat-loss rules are hard floors relative to observed five-piece armor; they never use uncertified final Guardian stats.");
  if (request.requiredSet) warnings.push("Required set membership is checked by observed Bungie set hash; a name match alone is insufficient.");
  if (protectedMechanicIds.size || protectedChainIds.size)
    warnings.push("Protected mechanics/chains refer to recognized sources and supported configuration prerequisites only; the in-game trigger is never guaranteed to happen.");
  if (hardConflictsFiltered)
    warnings.push(`${hardConflictsFiltered} highest-ranked combinations inherited hard conflicts and were excluded. Inspect the baseline configuration.`);
  if (!report.results.length) {
    report.status = report.globallyExhaustive ? "no_verified_combination" : "partial";
    warnings.push("No VERIFIED loadout satisfied all conditions in this search. This does not rule out armor whose details were unavailable.");
  } else {
    report.status = report.globallyExhaustive ? "ok" : "partial";
  }
  return report;
}
