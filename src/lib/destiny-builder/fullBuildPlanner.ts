/**
 * Destiny Builder — 8R.6.2B: universal full-build preflight + bounded proposal generation.
 * Install as src/lib/destiny-builder/fullBuildPlanner.ts
 *
 * Read-only, deterministic planning stage for ALL Guardian classes/subclasses.
 * It evaluates proposed selections against observed UniversalPlanningContext facts.
 * This is NOT an AI, gameplay ranking, complete Bungie compatibility check, or
 * an equipment writer. Proposals with unobserved requirements remain PARTIAL.
 * Before applying a proposal to Builder Preview, re-validate against the LIVE
 * Bungie inventory, compatibility validator, and current draft on the server/UI.
 */
import type {
  PlanningGearOption, PlanningSocketChoice, PlanningSubclassOption,
  UniversalPlanningContext,
} from "./universalPlanningContext";
// Six Armor 3.0 stat hashes, matching the public optimizer contract. Kept local
// so an inexpensive planning operation does not import the search engine.
const PLANNER_ARMOR_STAT_HASHES: readonly number[] = [
  2996146975, 392767087, 1943323491, 1735777505, 144602215, 4244567218,
];

export interface PlannerGearIdentity {
  itemInstanceId: string;
  itemHash: number;
}

export interface FullBuildProposalInput {
  /** Default: the currently selected subclass. Never auto-select a locked subclass. */
  subclassHash?: number;
  /** Exact observed instances, indexed by observed equipment slot hash. */
  gearBySlot?: Readonly<Record<string, PlannerGearIdentity>>;
  /** Socket index -> exact plug hash on the selected subclass. */
  socketPlugs?: Readonly<Record<string, number>>;
}

export type PlannerCheckStatus = "met" | "not_met" | "unknown";

export interface PlannerCheck {
  id: string;
  status: PlannerCheckStatus;
  message: string;
}

export interface FullBuildProposalResult {
  version: 1;
  guardianId: string;
  /** 'structurally_compatible' means ONLY that the evaluated checks passed. */
  status: "structurally_compatible" | "partial" | "invalid";
  targetSubclass: { itemHash: number; name: string; element: string } | null;
  gear: Array<{
    slotHash: number;
    itemInstanceId: string;
    itemHash: number;
    name: string;
    category: PlanningGearOption["category"];
    detailCoverage: PlanningGearOption["detailCoverage"];
  }>;
  sockets: Array<{ socketIndex: number; slotType: string; plugHash: number; name: string }>;
  artifact: {
    name: string | null;
    selectedPerkHashes: number[];
    coverage: UniversalPlanningContext["artifact"]["coverage"];
    /** Artifact mutations are NOT supported by this first preflight. */
    editable: false;
  };
  checks: PlannerCheck[];
  changesFromCurrent: {
    subclass: boolean;
    gearSlots: number;
    socketSelections: number;
  };
  /** A new full proposal always needs the live compatibility/preview validator. */
  readyToApplyDirectly: false;
  limits: string[];
}

function intHash(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function pickSocketChoice(
  options: PlanningSocketChoice[], chosenPlug: number | undefined,
): PlanningSocketChoice | undefined {
  return chosenPlug === undefined
    ? options.find((o) => o.selectedInBuild)
    : options.find((o) => o.plugHash === chosenPlug);
}

/**
 * Assess a full-build selection: subclass, sockets, weapons, armor, Artifact
 * coverage and evidence gaps. Strict instance identity prevents confusing
 * two copies of the same gun/armor. Nothing is auto-equipped or scored.
 */
export function evaluateFullBuildProposal(
  context: UniversalPlanningContext,
  input: FullBuildProposalInput = {},
): FullBuildProposalResult {
  const checks: PlannerCheck[] = [];
  const limits: string[] = [...context.warnings];
  const add = (id: string, status: PlannerCheckStatus, message: string) => {
    checks.push({ id, status, message });
  };
  if (context.coverage.account !== "verified")
    add("account-coverage", "unknown", "Vault/other Guardian inventory is not fully verified.");
  else add("account-coverage", "met", "Account scope is loaded.");

  const chosenSubclass = input.subclassHash === undefined
    ? context.subclasses.find((s) => s.selectedInBuild) ?? null
    : context.subclasses.find((s) => s.itemHash === input.subclassHash) ?? null;
  if (input.subclassHash !== undefined && !intHash(input.subclassHash))
    add("subclass-hash", "not_met", "Invalid subclass hash.");
  if (!chosenSubclass) add("subclass", input.subclassHash === undefined ? "unknown" : "not_met",
    input.subclassHash === undefined ? "No selected subclass is available." : "Requested subclass is not in this Guardian snapshot.");
  else {
    add("subclass", chosenSubclass.status === "locked" ? "not_met" :
      chosenSubclass.status === "unknown" ? "unknown" : "met",
    `${chosenSubclass.name}: ${chosenSubclass.status} on this Guardian.`);
    if (chosenSubclass.setupCoverage === "unknown")
      add("subclass-setup", "unknown", `Ability/aspect/fragment options for ${chosenSubclass.name} have not been observed.`);
  }

  const selectedGear = new Map<number, PlanningGearOption>();
  const observedSlots = new Set<number>();
  for (const item of context.gearOptions) {
    if (!item.selectedInBuild || item.slotHash === null) continue;
    if (selectedGear.has(item.slotHash))
      add(`baseline-slot-${item.slotHash}`, "unknown", "Multiple baseline records claim the same selected slot.");
    else selectedGear.set(item.slotHash, item);
    observedSlots.add(item.slotHash);
  }

  const overrides = input.gearBySlot ?? {};
  for (const [slotKey, identity] of Object.entries(overrides)) {
    const slotHash = Number(slotKey);
    if (!intHash(slotHash) || String(slotHash) !== slotKey) {
      add(`slot-key-${slotKey}`, "not_met", `Invalid equipment slot key: ${slotKey}.`);
      continue;
    }
    if (observedSlots.size > 0 && !observedSlots.has(slotHash)) {
      add(`gear-slot-${slotKey}`, "not_met", `Equipment slot ${slotHash} is not observed in the selected Guardian build.`);
      continue;
    }
    if (!identity || typeof identity.itemInstanceId !== "string" || !identity.itemInstanceId || !intHash(identity.itemHash)) {
      add(`gear-identity-${slotKey}`, "not_met", "A gear change requires an exact item instance ID and hash.");
      continue;
    }
    const found = context.gearOptions.find((item) => item.itemInstanceId === identity.itemInstanceId &&
      item.itemHash === identity.itemHash);
    if (!found) {
      add(`gear-${slotKey}`, "not_met", "Requested exact gear instance was not found in the observed inventory.");
      continue;
    }
    if (found.slotHash !== slotHash) {
      add(`gear-${slotKey}`, "not_met", `${found.name} does not belong to equipment slot ${slotHash}.`);
      continue;
    }
    if (selectedGear.has(slotHash) && selectedGear.get(slotHash)?.category !== found.category) {
      add(`gear-${slotKey}`, "not_met", "Replacement category is incompatible with the selected slot.");
      continue;
    }
    selectedGear.set(slotHash, found);
  }

  const gear = [...selectedGear].sort(([a], [b]) => a - b).map(([slotHash, item]) => ({
    slotHash, itemInstanceId: item.itemInstanceId ?? "", itemHash: item.itemHash,
    name: item.name, category: item.category, detailCoverage: item.detailCoverage,
  }));
  if (!gear.length) add("gear-coverage", "unknown", "No selected weapon/armor slots were found in the current snapshot.");
  const seen = new Set<string>();
  let armorExotics = 0;
  let unknownExoticArmor = 0;
  for (const [slot, item] of selectedGear) {
    if (!item.itemInstanceId || seen.has(item.itemInstanceId))
      add(`gear-unique-${slot}`, "not_met", "An item instance must be present exactly once in a proposed build.");
    if (item.itemInstanceId) seen.add(item.itemInstanceId);
    if (item.eligibility === "wrong_class")
      add(`gear-class-${slot}`, "not_met", `${item.name} belongs to a different Guardian class.`);
    else if (item.eligibility === "unverified")
      add(`gear-eligible-${slot}`, "unknown", `Ownership/location/class of ${item.name} is not fully verified.`);
    if (item.detailCoverage !== "verified")
      add(`gear-detail-${slot}`, "unknown", `Perks/stats for ${item.name} are not fully verified.`);
    if (item.category === "armor") {
      if (item.armorMetadata?.exotic === true) armorExotics++;
      if (item.armorMetadata?.exotic == null) unknownExoticArmor++;
    }
  }
  if (armorExotics > 1)
    add("armor-exotic-limit", "not_met", "More than one verified Exotic armor is selected.");
  else if (unknownExoticArmor > 0)
    add("armor-exotic-limit", "unknown", "Exotic identity of some selected armor is not verified.");
  else add("armor-exotic-limit", "met", "Selected armor respects the verified one-Exotic limit.");
  // The current universal context does not carry verified Exotic-weapon identity.
  add("weapon-exotic-limit", "unknown", "Exotic weapon identities/limit cannot be certified from this planning context.");
  add("gear-slot-completeness", gear.length >= 8 ? "met" : "unknown",
    gear.length >= 8 ? "Eight weapon/armor slots are represented." :
      `Only ${gear.length} weapon/armor slots are represented; a complete loadout is not confirmed.`);

  const sockets: FullBuildProposalResult["sockets"] = [];
  const requestedPlugs = input.socketPlugs ?? {};
  if (chosenSubclass) {
    const availableSockets = new Set(chosenSubclass.sockets.map((s) => s.socketIndex));
    for (const [key, hash] of Object.entries(requestedPlugs)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || String(idx) !== key || !availableSockets.has(idx) || !intHash(hash))
        add(`socket-override-${key}`, "not_met", `Unknown socket or invalid plug selection at ${key}.`);
    }
    const chosenDuplicates = new Set<string>();
    for (const socket of chosenSubclass.sockets) {
      const key = String(socket.socketIndex);
      const specified = hasOwn(requestedPlugs, key) ? requestedPlugs[key] : undefined;
      const selected = pickSocketChoice(socket.options, specified);
      if (!selected) {
        add(`socket-${key}`, specified === undefined ? "unknown" : "not_met",
          specified === undefined ? `${socket.slotType} socket selection is unavailable.` :
            `Plug ${specified} was not observed in ${socket.slotType} socket ${key}.`);
        continue;
      }
      if (specified !== undefined && selected.status === "possible_unverified")
        add(`socket-${key}`, "unknown", `${selected.name} is only a possible, not verified-unlocked, option.`);
      else if (specified !== undefined && selected.status === "unknown")
        add(`socket-${key}`, "unknown", `Unlock state of ${selected.name} is unknown.`);
      const duplicateGroup = /aspect|fragment/i.test(socket.slotType) ? socket.slotType.toLowerCase().replace(/\d+/g, "").trim() : null;
      if (duplicateGroup) {
        const distinctKey = `${duplicateGroup}:${selected.plugHash}`;
        if (chosenDuplicates.has(distinctKey))
          add(`socket-duplicate-${key}`, "not_met", `${selected.name} is selected twice in ${duplicateGroup} slots.`);
        chosenDuplicates.add(distinctKey);
      }
      sockets.push({ socketIndex: socket.socketIndex, slotType: socket.slotType,
        plugHash: selected.plugHash, name: selected.name });
    }
  } else if (Object.keys(requestedPlugs).length)
    add("socket-subclass", "not_met", "Cannot choose ability plugs without a verified target subclass.");

  if (context.artifact.coverage === "unknown")
    add("artifact", "unknown", "Artifact perks/options are not available in the current snapshot.");
  else add("artifact", "unknown", "Artifact data is partial; changing seasonal perks is not yet supported by this preflight.");
  if (context.coverage.mechanics !== "verified")
    add("mechanics-coverage", "unknown", "The current mechanics catalog cannot prove all cross-item interactions.");

  const baselineSubclass = context.subclasses.find((s) => s.selectedInBuild)?.itemHash ?? null;
  const changedSlots = [...selectedGear].filter(([slot, item]) =>
    !context.gearOptions.some((gearItem) => gearItem.selectedInBuild && gearItem.slotHash === slot &&
      gearItem.itemInstanceId === item.itemInstanceId)).length;
  const changedSockets = chosenSubclass ? sockets.filter((socket) =>
    !chosenSubclass.sockets.find((s) => s.socketIndex === socket.socketIndex)?.options.some((o) =>
      o.selectedInBuild && o.plugHash === socket.plugHash)).length : 0;
  const changedSubclass = chosenSubclass?.itemHash !== baselineSubclass;
  if (changedSlots || changedSockets || changedSubclass)
    limits.push("Changed selections need a fresh whole-build mechanics/compatibility evaluation. Baseline mechanic reports do not certify a hypothetical build.");
  limits.push("No known damage, DPS, cooldown, proc frequency or activity performance is calculated.");
  limits.push("This is a read-only preflight, not a verified preview: selected items must be rechecked against fresh Bungie snapshots before use.");
  const status: FullBuildProposalResult["status"] = checks.some((c) => c.status === "not_met") ? "invalid" :
    checks.some((c) => c.status === "unknown") ? "partial" : "structurally_compatible";
  return {
    version: 1, guardianId: context.guardian.characterId, status,
    targetSubclass: chosenSubclass ? { itemHash: chosenSubclass.itemHash,
      name: chosenSubclass.name, element: chosenSubclass.element } : null,
    gear, sockets,
    artifact: { name: context.artifact.name, selectedPerkHashes: context.artifact.selectedPerks.map((p) => p.plugHash),
      coverage: context.artifact.coverage, editable: false },
    checks, changesFromCurrent: { subclass: Boolean(changedSubclass), gearSlots: changedSlots,
      socketSelections: changedSockets }, readyToApplyDirectly: false, limits,
  };
}

/** Non-ranked, deterministic starting points to test any available subclass. */
export function listSubclassStartingPoints(context: UniversalPlanningContext): Array<{
  subclassHash: number; name: string; element: string; status: PlanningSubclassOption["status"];
  setupCoverage: PlanningSubclassOption["setupCoverage"];
}> {
  return context.subclasses
    .filter((subclass) => subclass.status === "equipped" || subclass.status === "unlocked")
    .map((subclass) => ({ subclassHash: subclass.itemHash, name: subclass.name,
      element: subclass.element, status: subclass.status, setupCoverage: subclass.setupCoverage }));
}


/**
 * 8R.6.2B — Deterministic, bounded FULL-build candidate generator.
 *
 * It is a safe intermediate step towards an AI planner, NOT an AI model or a
 * semantic evaluator of the user's free-text goal. We only act on explicit
 * exact-hash targets. A generated candidate contains the complete observed
 * eight-slot selection and the observed subclass/socket selections, subject
 * to the preflight's UNKNOWN coverage. Seasonal Artifact stays unchanged.
 */
export interface FullBuildGenerationRequest {
  /** Exact observed, unlocked subclass. Overrides targetElement if provided. */
  targetSubclassHash?: number;
  /** Element preference (e.g. Arc, Solar, Prismatic), NOT a combat rating. */
  targetElement?: string;
  /** Selected or intrinsic perk hash required on one proposed weapon. */
  preferredWeaponPerkHash?: number;
  /** One of the six exact Armor 3.0 stat hashes. */
  preferredArmorStatHash?: number;
  /** Default true: never replace the current Exotic armor instance. */
  preserveCurrentExotic?: boolean;
  /** 1..5; bounded to keep browser work deterministic. Default 5. */
  maxProposals?: number;
}

export type GeneratedBuildKind = "starting_point" | "subclass_variant" | "weapon_perk_variant" |
  "armor_stat_variant" | "combined_variant";

export interface GeneratedFullBuildCandidate {
  id: string;
  kind: GeneratedBuildKind;
  title: string;
  /** Exact evidence for the choice; never inferred combat strength. */
  reasons: string[];
  input: FullBuildProposalInput;
  validation: FullBuildProposalResult;
  /** Shows what was actually chosen, not an efficiency rating. */
  evidence: {
    matchingWeaponPerkHash: number | null;
    armorStatDelta: { statHash: number; delta: number } | null;
  };
}

export interface FullBuildGenerationReport {
  version: 1;
  scope: "observed_owned_explicit_targets_only";
  guardianId: string;
  status: "candidates_found" | "no_eligible_candidate" | "invalid_request";
  candidates: GeneratedFullBuildCandidate[];
  warnings: string[];
  /** No candidate is auto-applied, certified optimal or represented as AI output. */
  readyToApplyDirectly: false;
}

interface GearSwap {
  slotHash: number;
  item: PlanningGearOption;
  evidence: GeneratedFullBuildCandidate["evidence"];
}

function selectedGearBySlot(context: UniversalPlanningContext): Map<number, PlanningGearOption> {
  const selected = new Map<number, PlanningGearOption>();
  for (const item of context.gearOptions) {
    if (item.selectedInBuild && item.slotHash !== null && !selected.has(item.slotHash))
      selected.set(item.slotHash, item);
  }
  return selected;
}

function exactOwnedCandidate(item: PlanningGearOption): boolean {
  return item.eligibility === "candidate" && item.positionStatus === "confirmed" &&
    !!item.position && item.itemInstanceId !== null && item.itemInstanceId.length > 0 &&
    item.slotHash !== null && item.detailCoverage === "verified";
}

function completeArmorStats(item: PlanningGearOption): Map<number, number> | null {
  if (!item.armorStats) return null;
  const values = new Map<number, number>();
  for (const stat of item.armorStats) {
    if (!PLANNER_ARMOR_STAT_HASHES.includes(stat.statHash)) continue;
    if (values.has(stat.statHash) || !Number.isInteger(stat.value) || stat.value < 0) return null;
    values.set(stat.statHash, stat.value);
  }
  return values.size === PLANNER_ARMOR_STAT_HASHES.length ? values : null;
}

function findWeaponPerkSwaps(
  context: UniversalPlanningContext, selected: Map<number, PlanningGearOption>, plugHash: number,
): GearSwap[] {
  const options: GearSwap[] = [];
  const usedIds = new Set([...selected.values()].map((item) => item.itemInstanceId));
  for (const item of context.gearOptions) {
    if (item.category !== "weapon" || !exactOwnedCandidate(item) ||
        usedIds.has(item.itemInstanceId) || !selected.has(item.slotHash!)) continue;
    const current = selected.get(item.slotHash!)!;
    if (current.category !== "weapon" ||
        !item.perks.some((perk) => perk.plugHash === plugHash &&
          (perk.origin === "selected" || perk.origin === "intrinsic"))) continue;
    options.push({ slotHash: item.slotHash!, item, evidence: {
      matchingWeaponPerkHash: plugHash, armorStatDelta: null,
    } });
  }
  return options.sort((a, b) => a.slotHash - b.slotHash || a.item.itemInstanceId!.localeCompare(b.item.itemInstanceId!)).slice(0, 3);
}

function findArmorStatSwaps(
  context: UniversalPlanningContext, selected: Map<number, PlanningGearOption>,
  statHash: number, preserveExotic: boolean,
): GearSwap[] {
  const options: GearSwap[] = [];
  const usedIds = new Set([...selected.values()].map((item) => item.itemInstanceId));
  const baselineArmor = [...selected.values()].filter((item) => item.category === "armor");
  // Reject uncertain rarity in the baseline rather than guessing exotic legality.
  if (baselineArmor.some((item) => item.armorMetadata?.exotic == null)) return [];
  const baselineHasExotic = baselineArmor.some((item) => item.armorMetadata?.exotic === true);
  for (const item of context.gearOptions) {
    if (item.category !== "armor" || !exactOwnedCandidate(item) ||
        usedIds.has(item.itemInstanceId) || !selected.has(item.slotHash!) ||
        item.armorMetadata?.exotic == null) continue;
    const current = selected.get(item.slotHash!)!;
    if (current.category !== "armor" ||
        (preserveExotic && current.armorMetadata?.exotic === true) ||
        (item.armorMetadata.exotic === true && baselineHasExotic && current.armorMetadata?.exotic !== true)) continue;
    const before = completeArmorStats(current)?.get(statHash);
    const after = completeArmorStats(item)?.get(statHash);
    // Never treat an unknown stat as zero. The comparison requires both complete sets.
    if (before === undefined || after === undefined || after <= before) continue;
    options.push({ slotHash: item.slotHash!, item, evidence: {
      matchingWeaponPerkHash: null, armorStatDelta: { statHash, delta: after - before },
    } });
  }
  return options.sort((a, b) =>
    b.evidence.armorStatDelta!.delta - a.evidence.armorStatDelta!.delta ||
    a.slotHash - b.slotHash || a.item.itemInstanceId!.localeCompare(b.item.itemInstanceId!)).slice(0, 3);
}

/**
 * Generate an intentionally small group of complete, *evaluated* starting
 * points, irrespective of Guardian class/element. No guessed perk activations,
 * text-based pseudo-synergy, random gear swaps or implicit unlocks.
 *
 * Returned candidates may have status "partial": that is not authorization
 * to equip them. UI must re-check the live draft, inventory and compatibility.
 */
export function generateFullBuildCandidates(
  context: UniversalPlanningContext,
  request: FullBuildGenerationRequest = {},
): FullBuildGenerationReport {
  const warnings: string[] = [];
  const report: FullBuildGenerationReport = {
    version: 1, scope: "observed_owned_explicit_targets_only",
    guardianId: context.guardian.characterId, status: "no_eligible_candidate",
    candidates: [], warnings, readyToApplyDirectly: false,
  };
  const invalid = (message: string): FullBuildGenerationReport => {
    warnings.push(message);
    report.status = "invalid_request";
    return report;
  };
  const max = request.maxProposals ?? 5;
  if (!Number.isInteger(max) || max < 1 || max > 5) return invalid("maxProposals must be an integer from 1 to 5.");
  if (request.targetSubclassHash !== undefined && !intHash(request.targetSubclassHash))
    return invalid("targetSubclassHash must be a positive Bungie hash.");
  if (request.preferredWeaponPerkHash !== undefined && !intHash(request.preferredWeaponPerkHash))
    return invalid("preferredWeaponPerkHash must be a positive selected-perk hash.");
  if (request.preferredArmorStatHash !== undefined &&
      !PLANNER_ARMOR_STAT_HASHES.includes(request.preferredArmorStatHash))
    return invalid("preferredArmorStatHash must identify one of the six Armor 3.0 stats.");
  if (request.targetElement !== undefined &&
      (typeof request.targetElement !== "string" || !/^[a-z -]{1,32}$/i.test(request.targetElement.trim())))
    return invalid("targetElement must be a recognized element name, not a free-text goal.");
  if (request.preserveCurrentExotic !== undefined && typeof request.preserveCurrentExotic !== "boolean")
    return invalid("preserveCurrentExotic must be a boolean.");

  const starts = listSubclassStartingPoints(context);
  const normalizedElement = request.targetElement?.trim().toLowerCase();
  const targetClasses = starts.filter((s) =>
    request.targetSubclassHash !== undefined ? s.subclassHash === request.targetSubclassHash :
    normalizedElement ? s.element.toLowerCase() === normalizedElement : true)
    .sort((a, b) => Number(context.subclasses.some((s) => s.itemHash === b.subclassHash && s.selectedInBuild)) -
      Number(context.subclasses.some((s) => s.itemHash === a.subclassHash && s.selectedInBuild)) ||
      a.name.localeCompare(b.name));
  if (!targetClasses.length) {
    warnings.push("No observed unlocked subclass matches the target. Locked/unknown subclasses are never silently selected.");
    return report;
  }
  const selected = selectedGearBySlot(context);
  if (selected.size !== 8 || [...selected.values()].filter((item) => item.category === "weapon").length !== 3 ||
      [...selected.values()].filter((item) => item.category === "armor").length !== 5) {
    warnings.push("Three observed weapon and five armor slots are required for a complete build starting point.");
    return report;
  }
  const baselineMatchesWeaponTarget = request.preferredWeaponPerkHash !== undefined &&
    [...selected.values()].some((item) => item.category === "weapon" &&
      item.detailCoverage === "verified" && item.perks.some((perk) =>
        perk.plugHash === request.preferredWeaponPerkHash &&
        (perk.origin === "selected" || perk.origin === "intrinsic")));
  const weaponSwaps = request.preferredWeaponPerkHash === undefined ? [] :
    findWeaponPerkSwaps(context, selected, request.preferredWeaponPerkHash);
  const armorSwaps = request.preferredArmorStatHash === undefined ? [] :
    findArmorStatSwaps(context, selected, request.preferredArmorStatHash,
      request.preserveCurrentExotic !== false);
  if (request.preferredWeaponPerkHash !== undefined && !weaponSwaps.length && !baselineMatchesWeaponTarget)
    warnings.push("No current or alternate exact-instance weapon has the requested verified selected/intrinsic perk.");
  if (request.preferredArmorStatHash !== undefined && !armorSwaps.length)
    warnings.push("No verified one-slot armor stat improvement was found under the exotic and data-coverage limits.");

  const seen = new Set<string>();
  const emit = (kind: GeneratedBuildKind, label: string, subclassHash: number, swaps: GearSwap[]) => {
    if (report.candidates.length >= max) return;
    const gearBySlot: Record<string, PlannerGearIdentity> = {};
    for (const swap of swaps) {
      gearBySlot[String(swap.slotHash)] = { itemInstanceId: swap.item.itemInstanceId!, itemHash: swap.item.itemHash };
    }
    const key = `${subclassHash}/${Object.entries(gearBySlot).sort(([a], [b]) => Number(a)-Number(b))
      .map(([slot, item]) => `${slot}:${item.itemInstanceId}:${item.itemHash}`).join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    const input: FullBuildProposalInput = { subclassHash, gearBySlot };
    const validation = evaluateFullBuildProposal(context, input);
    // Never show an invalid candidate just because it is statically enumerable.
    if (validation.status === "invalid") return;
    const evidence: GeneratedFullBuildCandidate["evidence"] = {
      matchingWeaponPerkHash: swaps.find((s) => s.evidence.matchingWeaponPerkHash !== null)?.evidence.matchingWeaponPerkHash ?? null,
      armorStatDelta: swaps.find((s) => s.evidence.armorStatDelta !== null)?.evidence.armorStatDelta ?? null,
    };
    const reasons = [`${validation.targetSubclass?.name ?? "Observed subclass"} is observed as unlocked or equipped.`];
    // Both requested targets have already been enforced before emission.
    if (evidence.matchingWeaponPerkHash !== null)
      reasons.push(`Exact selected/intrinsic weapon plug ${evidence.matchingWeaponPerkHash} is verified on the proposed instance.`);
    if (evidence.armorStatDelta)
      reasons.push(`One observed armor-slot substitution gains +${evidence.armorStatDelta.delta} item points in stat ${evidence.armorStatDelta.statHash}; other stats can decrease.`);
    if (validation.status === "partial")
      reasons.push("Partial coverage: unverified constraints and interactions are not certified.");
    report.candidates.push({ id: key, kind, title: label, input, validation, reasons, evidence });
  };

  for (const subclass of targetClasses) {
    if (report.candidates.length >= max) break;
    const isSelected = context.subclasses.some((s) => s.itemHash === subclass.subclassHash && s.selectedInBuild);
    const kind: GeneratedBuildKind = isSelected ? "starting_point" : "subclass_variant";
    const needsWeaponSwap = request.preferredWeaponPerkHash !== undefined && !baselineMatchesWeaponTarget;
    const needsArmorGain = request.preferredArmorStatHash !== undefined;
    // Every returned proposal must meet all explicit targets, not just pass preflight.
    if (!needsWeaponSwap && !needsArmorGain)
      emit(kind, isSelected ? "Current configuration" : `${subclass.name} starting point`, subclass.subclassHash, []);
    if (needsWeaponSwap && !needsArmorGain && weaponSwaps.length)
      emit("weapon_perk_variant", `${subclass.name} · verified weapon-perk alternative`, subclass.subclassHash, [weaponSwaps[0]]);
    if (needsArmorGain && !needsWeaponSwap && armorSwaps.length)
      emit("armor_stat_variant", `${subclass.name} · observed armor-stat alternative`, subclass.subclassHash, [armorSwaps[0]]);
    if (needsWeaponSwap && needsArmorGain && weaponSwaps.length && armorSwaps.length)
      emit("combined_variant", `${subclass.name} · combined observed alternatives`, subclass.subclassHash, [weaponSwaps[0], armorSwaps[0]]);
  }
  if (report.candidates.length) report.status = "candidates_found";
  else warnings.push("No structurally non-invalid candidate survived preflight; see account, subclass and equipment coverage.");
  warnings.push("Proposals are observed starting points, NOT AI recommendations, gameplay rankings, simulated effects or proof of whole-build legality.");
  return report;
}
