/**
 * Destiny Builder — Phase 8R.3.1: mechanics-aware, evidence-gated gear candidate engine.
 *
 * Read-only, deterministic, framework-independent. Does not fetch Bungie,
 * edit drafts, equip gear, score rolls or assert that combat triggers occurred.
 * A recommendation here means a *candidate worth inspecting*, not "better".
 * Caller explicitly loads a bounded number of details through scope=detail.
 */
import type {
  BuildContext, ChosenPerk, DetailPerk, EffectTag, ItemDetail, ItemCategory, KnownItem,
  PerkAvailability, SelectedGear, StatValue,
} from "./buildContext";
import {
  resolveBuildMechanics,
  type MechanicConfiguration,
  type MechanicsReport,
  type ResolvedMechanic,
} from "./mechanicsResolver";
import { analyzeBuildSynergies, isSupportedEffectTag, type SynergyReport } from "./synergyEngine";

export type CandidateOrigin = "guardian" | "vault" | "other_guardian";
export type RecommendationStatus = "ready" | "partial" | "theoretical" | "no_focus";

export interface CandidateEvidence {
  /** The observed text is Bungie-derived; it does not prove a game mechanic. */
  effectKey: string;
  effectLabel: string;
  effectKind: EffectTag["kind"];
  plugHash: number;
  perkName: string;
  description: string;
  source: "selected_perk" | "intrinsic_perk";
  availability: PerkAvailability;
}

export interface CandidateStatDelta {
  statHash: number;
  name: string;
  candidateValue: number;
  currentValue: number;
  /** Numeric difference ONLY. A higher value is not always better. */
  difference: number;
}

export interface CandidateMechanicEvidence {
  id: string;
  title: string;
  configuration: MechanicConfiguration;
  trigger: string;
  effects: string[];
  prerequisites: string[];
}

export interface CandidateMechanicsComparison {
  /** Catalog rules newly present, or becoming unblocked, in this hypothetical swap. */
  added: CandidateMechanicEvidence[];
  /** Catalog rules removed, or losing satisfied requirements, by the swap. */
  lost: CandidateMechanicEvidence[];
  /** Conditional sequences only, never an observed combat activation. */
  addedChains: string[];
  lostChains: string[];
  /** Changes in selected copy counts are NOT proof of stronger stacking. */
  changedCopies: Array<{ title: string; before: number; after: number }>;
  /** True when current selected gear lacks instance details. */
  incompleteBaseline: boolean;
}

export interface RecommendationCandidate {
  id: string;
  item: KnownItem;
  origin: CandidateOrigin;
  replaceSlotHash: number;
  replaceItemInstanceId: string | null;
  replaceItemName: string;
  /** Matching topic keys from observed text OR explicitly mapped verified rule IDs. */
  matchedEffectKeys: string[];
  evidence: CandidateEvidence[];
  /** Hypothetical swap checked with exactly the same rules as Conditional Mechanics. */
  mechanics: CandidateMechanicsComparison;
  statDeltas: CandidateStatDelta[];
  provisional: boolean;
  /** Why it was surfaced, without saying the roll is "better". */
  explanation: string;
}

export interface DetailRequest {
  itemHash: number;
  itemInstanceId: string;
  name: string;
  origin: CandidateOrigin;
  category: "weapon" | "armor";
  slotHash: number;
}

export interface RecommendationReport {
  version: 1;
  guardianId: string;
  status: RecommendationStatus;
  activity: BuildContext["activity"];
  /** Original free-text input, unmodified. Only recognized effect names can filter results. */
  goal: string;
  /** Which user input determines matching; auto mode can also inspect catalog rule gains. */
  focusSource: "manual" | "goal" | "current_build";
  /** Recognized Destiny effect keywords in the goal; none implies free text stayed context only. */
  recognizedGoalEffects: Array<{ key: string; label: string }>;
  focusedEffects: Array<{ key: string; label: string }>;
  recommendations: RecommendationCandidate[];
  /** On-demand detail requests; this module NEVER executes them. */
  detailQueue: DetailRequest[];
  coverage: {
    accountComplete: boolean;
    eligibleAlternatives: number;
    inspectedAlternatives: number;
    awaitingDetails: number;
    incompatibleArmor: number;
    uncertainPosition: number;
    nonInstanced: number;
    unmatchedInspected: number;
  };
  warnings: string[];
}

export interface RecommendationOptions {
  /** Explicit effect focus from the UI; defaults to effects observed in the selected build. */
  focusEffectKeys?: readonly string[];
  /** Hard-capped to 20; never silently request the entire Vault. */
  maxResults?: number;
  /** Hard-capped to 24. A UI may request this queue via bounded scope=detail calls. */
  maxDetailRequests?: number;
  /** Optional already-built report; omitting it reuses the pure Synergy Engine. */
  synergyReport?: SynergyReport;
}

const DEFAULT_RESULTS = 12;
const DEFAULT_DETAIL_REQUESTS = 8;
const MAX_RESULTS = 20;
const MAX_DETAIL_REQUESTS = 24;

function cap(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

function cleanEffect(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Intentional closed vocabulary from the Bungie description-tag adapter.
 * This is NOT an NLP interpreter, effect solver, or gameplay simulator.
 * Match the exact named effects only, never arbitrary substring similarity.
 * A requested effect may be absent from the currently selected subclass/gear;
 * that is exactly when inspecting alternatives can be useful.
 */
const GOAL_EFFECT_NAMES = [
  ["amplified", "Amplified"],
  ["radiant", "Radiant"],
  ["restoration", "Restoration"],
  ["cure", "Cure"],
  ["overshield", "Overshield"],
  ["devour", "Devour"],
  ["invisibility", "Invisibility"],
  ["frost-armor", "Frost Armor"],
  ["woven-mail", "Woven Mail"],
  ["transcendence", "Transcendence"],
  ["volatile-rounds", "Volatile Rounds"],
  ["unraveling-rounds", "Unraveling Rounds"],
  ["damage-resistance", "Damage Resistance"],
  ["weapon-damage", "Weapon Damage"],
  ["blind", "Blind"],
  ["jolt", "Jolt"],
  ["scorch", "Scorch"],
  ["ignition", "Ignition"],
  ["volatile", "Volatile"],
  ["weaken", "Weaken"],
  ["suppression", "Suppression"],
  ["slow", "Slow"],
  ["freeze", "Freeze"],
  ["shatter", "Shatter"],
  ["sever", "Sever"],
  ["suspend", "Suspend"],
  ["unravel", "Unravel"],
  ["ionic-trace", "Ionic Trace"],
  ["firesprite", "Firesprite"],
  ["void-breach", "Void Breach"],
  ["stasis-shard", "Stasis Shard"],
  ["tangle", "Tangle"],
  ["threadling", "Threadling"],
  ["ability-energy", "Ability Energy"],
] as const;

const GOAL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "void-breach": ["void breach", "void breaches"],
  "stasis-shard": ["stasis shard", "stasis shards"],
  "ionic-trace": ["ionic trace", "ionic traces"],
  "scorch": ["scorched", "scorching"],
  "ignition": ["ignitions"],
  "weaken": ["weakened", "weakening"],
  "freeze": ["frozen", "freezing"],
  "shatter": ["shattered", "shattering"],
  "threadling": ["threadlings"],
  "firesprite": ["firesprites"],
  "tangle": ["tangles"],
  "volatile-rounds": ["volatile rounds"],
  "unraveling-rounds": ["unraveling rounds"],
};

const GOAL_PATTERNS = GOAL_EFFECT_NAMES.flatMap(([key, label]) => {
  const variants = GOAL_ALIASES[key] ?? [label];
  return variants.map((variant) => ({
    key, label, variant,
    pattern: new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ -]+/g, "[\\s-]+")}\\b`, "gi"),
  }));
}).sort((a, b) => b.variant.length - a.variant.length);

/**
 * Recognizes ONLY explicit Destiny effect terms. Longest phrase wins, so
 * 'Volatile Rounds' is not also interpreted as the 'Volatile' debuff.
 * The caller can show this set as diagnostic evidence of what it understood.
 */
export function extractGoalEffectFocus(goal: string): Array<{ key: string; label: string }> {
  if (!goal.trim()) return [];
  const matches: Array<{ key: string; label: string; index: number }> = [];
  const occupied: Array<[number, number]> = [];
  for (const entry of GOAL_PATTERNS) {
    entry.pattern.lastIndex = 0;
    for (const match of goal.matchAll(entry.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (occupied.some(([from, to]) => start < to && end > from)) continue;
      // 'Volatile Launch' is a launcher stat perk, not a request for a Void debuff.
      if (entry.key === "volatile" && /^\s+launch\b/i.test(goal.slice(end))) continue;
      // Simple explicit exclusion language; do not turn 'without Devour' into
      // an affirmative filter. Arbitrary complex natural language is not parsed.
      const prefix = goal.slice(Math.max(0, start - 35), start);
      if (/\b(?:no|not|without|avoid|exclude|non|senza|evita|escludi)\s+(?:any\s+|the\s+|il\s+|la\s+)?$/i.test(prefix)) continue;
      occupied.push([start, end]);
      matches.push({ key: entry.key, label: entry.label, index: start });
    }
  }
  matches.sort((a, b) => a.index - b.index);
  const used = new Set<string>();
  return matches.filter((entry) => {
    if (used.has(entry.key)) return false;
    used.add(entry.key);
    return true;
  }).map(({ key, label }) => ({ key, label }));
}

function originFor(item: KnownItem, guardianId: string): CandidateOrigin {
  if (item.position === "vault") return "vault";
  if (item.position?.startsWith(`${guardianId}:`)) return "guardian";
  return "other_guardian";
}

function originPriority(origin: CandidateOrigin): number {
  return origin === "guardian" ? 0 : origin === "vault" ? 1 : 2;
}

function sameIdentity(a: KnownItem, b: KnownItem): boolean {
  return a.itemInstanceId !== null && b.itemInstanceId !== null
    ? a.itemInstanceId === b.itemInstanceId
    : a.identity === b.identity;
}

function validDetails(item: KnownItem, map: Record<string, ItemDetail | null | undefined>): ItemDetail | null {
  if (!item.itemInstanceId) return null;
  const detail = map[item.itemInstanceId];
  return detail && detail.itemInstanceId === item.itemInstanceId && detail.itemHash === item.itemHash
    ? detail : null;
}

/** Uses only the *selected socket plug*, never rolled or Manifest-only options. */
function collectCandidateEvidence(detail: ItemDetail, focus: ReadonlySet<string>): CandidateEvidence[] {
  const evidence: CandidateEvidence[] = [];
  const seen = new Set<string>();
  const selected = new Map<string, NonNullable<ItemDetail["selectedPerks"]>[number]>();

  for (const perk of detail.selectedPerks ?? []) {
    if (perk.state === "selected") selected.set(`${perk.socketIndex}:${perk.plugHash}`, perk);
  }
  for (const column of detail.perkColumns ?? []) {
    if (column.selected && column.selected.state !== "possible" && column.selected.state !== "rolled") {
      selected.set(`${column.socketIndex}:${column.selected.plugHash}`, column.selected);
    }
  }

  const collect = (
    perk: { plugHash: number; name: string; description?: string; effectTags?: EffectTag[] },
    source: CandidateEvidence["source"],
  ) => {
    if (!Number.isFinite(perk.plugHash) || !perk.name.trim()) return;
    for (const tag of perk.effectTags ?? []) {
      if (!tag || typeof tag.key !== "string" || typeof tag.label !== "string") continue;
      const effectKey = cleanEffect(tag.key);
      if (!effectKey || !tag.label.trim() || !focus.has(effectKey)) continue;
      if (tag.kind !== "buff" && tag.kind !== "debuff" && tag.kind !== "effect") continue;
      // Use the SAME semantic guard as Synergy Analysis. The inventory adapter
      // infers effect tags from text, so a raw tag alone is not trustworthy:
      // Volatile Launch != Void Volatile; damage resistance != weapon damage.
      // Evaluate only the actually selected or intrinsic perk instance here.
      if (!isSupportedEffectTag(tag, perk.name, perk.description ?? "")) continue;
      const id = `${source}:${perk.plugHash}:${effectKey}`;
      if (seen.has(id)) continue;
      seen.add(id);
      evidence.push({
        effectKey, effectLabel: tag.label, effectKind: tag.kind,
        plugHash: perk.plugHash, perkName: perk.name,
        description: perk.description ?? "", source,
        availability: "selected_on_item",
      });
    }
  };
  for (const perk of selected.values()) collect(perk, "selected_perk");
  for (const perk of detail.intrinsicPerks ?? []) collect({ ...perk, plugHash: perk.perkHash }, "intrinsic_perk");
  return evidence;
}

function compareStats(current: SelectedGear, detail: ItemDetail): CandidateStatDelta[] {
  const candidateStats: StatValue[] = current.item.category === "armor"
    ? detail.armorStats ?? [] : detail.stats ?? [];
  const baseline = new Map((current.stats ?? [])
    .filter((stat) => Number.isFinite(stat.statHash) && Number.isFinite(stat.value))
    .map((stat) => [stat.statHash, stat] as const));
  return candidateStats.flatMap((stat) => {
    const previous = baseline.get(stat.statHash);
    if (!previous || !Number.isFinite(stat.value)) return [];
    return [{ statHash: stat.statHash, name: stat.name || previous.name,
      candidateValue: stat.value, currentValue: previous.value,
      difference: stat.value - previous.value }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Only these audited resolver IDs have an explicit effect-key translation.
 * Names or descriptive text never create a mechanics-aware match.
 */
const VERIFIED_MECHANIC_EFFECTS: Readonly<Record<string, readonly string[]>> = {
  "void.feed-the-void": ["devour"],
  "void.echo-starvation": ["devour"],
  "void.echo-instability": ["volatile-rounds"],
};
const VERIFIED_CHAIN_EFFECTS: Readonly<Record<string, readonly string[]>> = {
  "void.firepower-orb-starvation-devour": ["devour"],
};

function detailToChosen(perk: DetailPerk): ChosenPerk {
  return {
    plugHash: perk.plugHash, name: perk.name, description: perk.description ?? "",
    availability: "selected_on_item", effectTags: perk.effectTags ?? [],
    effectOrigin: "inferred_from_description",
  };
}

/** Emulates exactly one slot change IN MEMORY. Not an equip or saved draft.
 * Use the selected plugs of a verified exact instance; possible/rolled options
 * must not enter the comparison as if they were selected.
 */
function hypotheticalReplacement(context: BuildContext, current: SelectedGear, item: KnownItem, detail: ItemDetail): BuildContext {
  const chosen = new Map<string, ChosenPerk>();
  for (const perk of detail.selectedPerks ?? []) {
    if (perk.state === "selected" || perk.state === undefined) {
      chosen.set(`${perk.socketIndex}:${perk.plugHash}`, detailToChosen(perk));
    }
  }
  for (const column of detail.perkColumns ?? []) {
    if (column.selected && column.selected.state !== "possible" && column.selected.state !== "rolled") {
      chosen.set(`${column.socketIndex}:${column.selected.plugHash}`, detailToChosen(column.selected));
    }
  }
  const chosenHashes = new Set(Array.from(chosen.values()).map((perk) => perk.plugHash));
  const intrinsic: ChosenPerk[] = (detail.intrinsicPerks ?? [])
    .filter((perk) => !chosenHashes.has(perk.perkHash))
    .map((perk) => ({
      plugHash: perk.perkHash, name: perk.name, description: perk.description ?? "",
      availability: "selected_on_item" as const, effectTags: perk.effectTags ?? [],
      effectOrigin: "inferred_from_description" as const,
    }));
  const stats = item.category === "armor" ? detail.armorStats : detail.stats;
  const proposed: SelectedGear = {
    slotHash: current.slotHash, item, isPreview: true, detailsLoaded: true,
    stats: stats?.length ? stats : null,
    selectedPerks: Array.from(chosen.values()), intrinsicPerks: intrinsic,
    recoilDirection: detail.recoilDirection ?? null,
    setBonuses: (detail.itemSet?.perks ?? []).map((perk) => ({
      setName: detail.itemSet?.name ?? "", perkName: perk.name,
      requiredPieces: perk.requiredSetCount, effectTags: perk.effectTags ?? [],
    })),
  };
  return {
    ...context,
    build: {
      ...context.build,
      gear: context.build.gear.map((part) => part === current ? proposed : part),
    },
  };
}

function mechanicSummary(mechanic: ResolvedMechanic): CandidateMechanicEvidence {
  return {
    id: mechanic.id, title: mechanic.title, configuration: mechanic.configuration,
    trigger: mechanic.trigger, effects: [...mechanic.effects],
    prerequisites: [...mechanic.prerequisites],
  };
}

function copyCount(part: ResolvedMechanic): number {
  return part.sources.reduce((sum, source) => sum + source.selectedCopies, 0);
}

function compareMechanics(before: MechanicsReport, after: MechanicsReport, incompleteBaseline: boolean): CandidateMechanicsComparison {
  const original = new Map(before.mechanics.map((part) => [part.id, part] as const));
  const hypothetical = new Map(after.mechanics.map((part) => [part.id, part] as const));
  const available = (state: MechanicConfiguration) => state === "eligible" || state === "preview";
  const added = after.mechanics.filter((part) => {
    const previous = original.get(part.id);
    return !previous || (!available(previous.configuration) && available(part.configuration));
  }).map(mechanicSummary);
  const lost = before.mechanics.filter((part) => {
    const next = hypothetical.get(part.id);
    return !next || (available(part.configuration) && !available(next.configuration));
  }).map(mechanicSummary);
  const beforeChains = new Map(before.chains.map((part) => [part.id, part] as const));
  const afterChains = new Map(after.chains.map((part) => [part.id, part] as const));
  const changedCopies = after.mechanics.flatMap((part) => {
    const prior = original.get(part.id);
    return prior && copyCount(prior) !== copyCount(part)
      ? [{ title: part.title, before: copyCount(prior), after: copyCount(part) }] : [];
  });
  return {
    added, lost,
    addedChains: after.chains.filter((part) => !beforeChains.has(part.id)).map((part) => part.title),
    lostChains: before.chains.filter((part) => !afterChains.has(part.id)).map((part) => part.title),
    changedCopies, incompleteBaseline,
  };
}

function focusFromMechanics(before: MechanicsReport, after: MechanicsReport,
  comparison: CandidateMechanicsComparison, focus: ReadonlySet<string>): string[] {
  const matches = new Set<string>();
  for (const mechanic of comparison.added) {
    for (const effect of VERIFIED_MECHANIC_EFFECTS[mechanic.id] ?? []) {
      if (focus.has(effect)) matches.add(effect);
    }
  }
  const previously = new Set(before.chains.map((part) => part.id));
  for (const chain of after.chains) {
    if (previously.has(chain.id)) continue;
    for (const effect of VERIFIED_CHAIN_EFFECTS[chain.id] ?? []) {
      if (focus.has(effect)) matches.add(effect);
    }
  }
  return Array.from(matches);
}

function mechanicReasons(comparison: CandidateMechanicsComparison): string[] {
  const reasons: string[] = [];
  if (comparison.added.length) reasons.push(`New catalog mechanics in hypothetical preview: ${comparison.added.map((part) =>
    `${part.title} (${part.configuration === "missing_requirement" ? `requirement missing: ${part.prerequisites.join("; ")}`
      : part.configuration === "unknown" ? "prerequisites not fully verified"
        : "configuration possible; in-game trigger NOT observed"})`).join(", ")}.`);
  if (comparison.addedChains.length) reasons.push(`New conditional route: ${comparison.addedChains.join("; ")}. Combat triggers remain unobserved.`);
  if (comparison.lost.length) reasons.push(`Would lose previously identified rule(s): ${comparison.lost.map((part) => part.title).join(", ")}.`);
  if (comparison.lostChains.length) reasons.push(`Would lose possible route(s): ${comparison.lostChains.join("; ")}.`);
  if (comparison.changedCopies.length) reasons.push(`Selected perk copy count changes: ${comparison.changedCopies.map((part) =>
    `${part.title} ${part.before}→${part.after}`).join(", ")}. No stacking benefit is assumed.`);
  if (comparison.incompleteBaseline) reasons.push("Some currently selected item details are missing; mechanics that could be lost are not fully known.");
  return reasons;
}

/** Armor must match class; unknown class is not silently assumed compatible. */
function compatibleArmor(item: KnownItem, classType: number | null | undefined): boolean {
  return item.classType === 3 || (classType !== null && classType !== undefined && item.classType === classType);
}

export function findGearRecommendations(
  context: BuildContext,
  detailsByInstanceId: Record<string, ItemDetail | null | undefined> = {},
  options: RecommendationOptions = {},
): RecommendationReport {
  const synergy = options.synergyReport ?? analyzeBuildSynergies(context);
  const selectedMechanics = resolveBuildMechanics(context);
  const incompleteBaseline = selectedMechanics.detailedGear !== selectedMechanics.scannedGear;
  const warnings: string[] = [];
  const recognizedGoalEffects = extractGoalEffectFocus(context.goal);
  // Explicit UI chips > recognized terms in Goal > effects observed in current build.
  // A goal can intentionally ask for an effect NOT yet present in the build.
  const focusSource: RecommendationReport["focusSource"] = options.focusEffectKeys !== undefined
    ? "manual" : recognizedGoalEffects.length ? "goal" : "current_build";
  const focusValues = focusSource === "manual" ? options.focusEffectKeys ?? []
    : focusSource === "goal" ? recognizedGoalEffects.map((effect) => effect.key)
      : synergy.effects.map((effect) => effect.key);
  const focus = new Set(focusValues.filter((key): key is string => typeof key === "string")
    .map(cleanEffect).filter(Boolean));
  const names = new Map<string, string>(GOAL_EFFECT_NAMES.map(([key, label]) => [key, label]));
  for (const effect of synergy.effects) names.set(cleanEffect(effect.key), effect.label);
  const maxResults = cap(options.maxResults, DEFAULT_RESULTS, MAX_RESULTS);
  const maxDetails = cap(options.maxDetailRequests, DEFAULT_DETAIL_REQUESTS, MAX_DETAIL_REQUESTS);
  const theoreticallyLocked = Boolean(context.build.subclass?.theoretical || context.mode === "theory");
  if (!context.account.complete) warnings.push("Account inventory is incomplete: comparisons cover only currently loaded alternatives.");
  if (theoreticallyLocked) warnings.push("The current build includes theory mode or a theoretical subclass; matches are theoretical context, not immediately equippable builds.");
  if (!focus.size) warnings.push("No named effect focus: only newly detected exact-catalog mechanics can surface alternatives. Load candidate details in bounded batches.");
  if (context.goal.trim() && !recognizedGoalEffects.length)
    warnings.push("Goal contains no recognized Destiny effect names. It remains context only; the engine uses observed build effects instead.");
  if (focusSource === "goal") {
    const missingInBuild = recognizedGoalEffects.filter((effect) =>
      !synergy.effects.some((current) => cleanEffect(current.key) === effect.key));
    if (missingInBuild.length) warnings.push(`Goal effect(s) ${missingInBuild.map((effect) => effect.label).join(", ")} are not observed in selected build descriptions. Alternatives may still mention them; no actual activation is assumed.`);
    warnings.push("Goal focus recognizes named effects only; other free-text instructions and activities do not become gameplay rules.");
  }
  if (focusSource === "manual" && recognizedGoalEffects.length)
    warnings.push("Manual Effect Focus takes precedence over the effects recognized in Goal.");
  if (context.activity !== "general") warnings.push("Activity is recorded but no PvE/PvP-specific perk performance model is available yet.");

  const slots = new Map<string, SelectedGear>();
  for (const gear of context.build.gear) {
    if (gear.item.category !== "weapon" && gear.item.category !== "armor") continue;
    slots.set(`${gear.item.category}:${gear.slotHash}`, gear);
  }

  let eligibleAlternatives = 0;
  let inspectedAlternatives = 0;
  let awaitingDetails = 0;
  let incompatibleArmor = 0;
  let uncertainPosition = 0;
  let nonInstanced = 0;
  let unmatchedInspected = 0;
  let mechanicsMatched = 0;
  const allCandidates: RecommendationCandidate[] = [];
  const requests: DetailRequest[] = [];
  const seenInstances = new Set<string>();

  for (const item of context.account.items) {
    const category: ItemCategory = item.category;
    if (category !== "weapon" && category !== "armor") continue;
    if (item.equipmentSlotHash === null) continue;
    const slot = slots.get(`${category}:${item.equipmentSlotHash}`);
    if (!slot || sameIdentity(item, slot.item)) continue;
    // Do not propose any item already selected in another slot either.
    if (context.build.gear.some((gear) => sameIdentity(gear.item, item))) continue;
    if (item.availability !== "owned" || item.positionStatus !== "confirmed" || !item.position || item.position.startsWith("unknown:")) {
      uncertainPosition += 1;
      continue;
    }
    if (category === "armor" && !compatibleArmor(item, context.guardian.classType)) {
      incompatibleArmor += 1;
      continue;
    }
    if (!item.itemInstanceId) { nonInstanced += 1; continue; }
    if (seenInstances.has(item.itemInstanceId)) continue;
    seenInstances.add(item.itemInstanceId);
    eligibleAlternatives += 1;
    const origin = originFor(item, context.guardian.characterId);
    const detail = validDetails(item, detailsByInstanceId);
    if (!detail) {
      awaitingDetails += 1;
      requests.push({
        itemHash: item.itemHash, itemInstanceId: item.itemInstanceId,
        name: item.name, origin, category, slotHash: item.equipmentSlotHash,
      });
      continue;
    }
    inspectedAlternatives += 1;
    const evidence = focus.size ? collectCandidateEvidence(detail, focus) : [];
    const hypothetical = hypotheticalReplacement(context, slot, item, detail);
    const afterMechanics = resolveBuildMechanics(hypothetical);
    const comparison = compareMechanics(selectedMechanics, afterMechanics, incompleteBaseline);
    // A new exact-catalog rule is a reason to INSPECT an alternative, never a
    // power rating or a guarantee its trigger can be activated in combat.
    const hasCatalogChange = comparison.added.length > 0 || comparison.addedChains.length > 0;
    const mappedKeys = focusFromMechanics(selectedMechanics, afterMechanics, comparison, focus);
    // Respect an explicit manual or Goal effect filter. In automatic mode,
    // additional exact-catalog mechanics are informative even without tags.
    const relevantMechanics = focusSource === "current_build" && hasCatalogChange || mappedKeys.length > 0;
    if (!evidence.length && !relevantMechanics) { unmatchedInspected += 1; continue; }
    if (relevantMechanics) mechanicsMatched += 1;
    const matchedEffectKeys = Array.from(new Set([
      ...evidence.map((part) => part.effectKey), ...mappedKeys,
    ])).sort();
    const statDeltas = compareStats(slot, detail);
    const provisional = !context.account.complete || theoreticallyLocked ||
      !slot.detailsLoaded || synergy.status !== "ready" || incompleteBaseline ||
      comparison.added.some((part) => part.configuration === "missing_requirement" || part.configuration === "unknown");
    const listed = matchedEffectKeys.map((key) => names.get(key) ?? key).join(", ");
    const focusReason = focusSource === "goal" ? " explicitly requested in Goal" :
      focusSource === "manual" ? " in the manual Effect Focus" : " observed in the current build";
    const thematic = evidence.length
      ? `Selected perk descriptions mention ${listed}${focusReason}; this is thematic evidence, not verified synergy. `
      : mappedKeys.length ? `Exact catalog mechanic/chain matches the requested effect(s): ${listed}. ` : "";
    const mechanicsText = mechanicReasons(comparison).join(" ");
    allCandidates.push({
      id: item.itemInstanceId, item, origin,
      replaceSlotHash: slot.slotHash, replaceItemInstanceId: slot.item.itemInstanceId,
      replaceItemName: slot.item.name, matchedEffectKeys, evidence, mechanics: comparison,
      statDeltas, provisional,
      explanation: `${thematic}${mechanicsText} This is a read-only hypothetical comparison, not a quality grade, a verified combat proc, or an equip action.`.trim(),
    });
  }

  // Exact-catalog additions first, then semantic text evidence. This is
  // INSPECTION priority only; blocked rules never outrank usable rule gains.
  const supportedGains = (candidate: RecommendationCandidate) =>
    candidate.mechanics.added.filter((part) => part.configuration === "eligible" || part.configuration === "preview").length;
  allCandidates.sort((a, b) => supportedGains(b) - supportedGains(a) ||
    b.mechanics.addedChains.length - a.mechanics.addedChains.length ||
    b.matchedEffectKeys.length - a.matchedEffectKeys.length ||
    originPriority(a.origin) - originPriority(b.origin) || a.item.name.localeCompare(b.item.name) ||
    a.id.localeCompare(b.id));
  requests.sort((a, b) => originPriority(a.origin) - originPriority(b.origin) ||
    a.name.localeCompare(b.name) || a.itemInstanceId.localeCompare(b.itemInstanceId));
  if (awaitingDetails > maxDetails) warnings.push(`${awaitingDetails} alternative items require detail inspection; only ${maxDetails} were placed in the next manual batch.`);
  if (allCandidates.length > maxResults) warnings.push(`${allCandidates.length} potential matches were found; the result list displays ${maxResults}.`);
  if (nonInstanced) warnings.push(`${nonInstanced} alternatives have no unambiguous item instance ID and cannot be verified for detailed roll inspection.`);
  if (uncertainPosition) warnings.push(`${uncertainPosition} alternatives have unknown or conflicting positions and were excluded.`);
  if (incompatibleArmor) warnings.push(`${incompatibleArmor} armor pieces were excluded because their Guardian class is incompatible or unverified.`);
  if (context.build.gear.some((item) => !item.detailsLoaded)) warnings.push("Some current-build gear lacks details; stat comparisons and potential mechanic losses may be incomplete.");
  if (mechanicsMatched) warnings.push(`Mechanics-aware comparisons use the limited ${selectedMechanics.catalogVersion} exact-hash catalog. Other meaningful perks, exotic equip limits and complete set-bonus effects are not yet modeled.`);
  if (selectedMechanics.warnings.length) warnings.push("Mechanic coverage remains subject to Conditional Mechanics warnings and missing prerequisites.");

  return {
    version: 1, guardianId: context.guardian.characterId,
    status: theoreticallyLocked ? "theoretical" : !focus.size && allCandidates.length === 0 ? "no_focus" :
      !context.account.complete || awaitingDetails > 0 || synergy.status !== "ready" ? "partial" : "ready",
    activity: context.activity, goal: context.goal, focusSource, recognizedGoalEffects,
    focusedEffects: Array.from(focus).sort().map((key) => ({ key, label: names.get(key) ?? key })),
    recommendations: allCandidates.slice(0, maxResults), detailQueue: requests.slice(0, maxDetails),
    coverage: { accountComplete: context.account.complete,
      eligibleAlternatives, inspectedAlternatives, awaitingDetails,
      incompatibleArmor, uncertainPosition, nonInstanced, unmatchedInspected },
    warnings: Array.from(new Set(warnings)),
  };
}
