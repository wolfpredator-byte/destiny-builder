/**
 * Destiny Builder — 8R.3.4: compatibility refinement + conservative Armor 3.0 item-stat aggregation.
 * Place at: src/lib/destiny-builder/compatibilityValidator.ts
 *
 * No Bungie calls, game writes, inferred numerical bonuses, or hidden rolls.
 * Distinguishes HARD loadout conflicts, CONDITIONAL effects, and UNVERIFIED facts.
 * All exotic / exact set identifiers come from observed Bungie snapshots/details.
 */
import type {
  AccountSnapshot, BuildContext, ChosenPerk, CoreSnapshot, DetailPerk,
  InventoryItem, ItemDetail, KnownItem, SelectedGear,
} from "./buildContext";
import { resolveBuildMechanics, type MechanicsReport } from "./mechanicsResolver";

export type CompatibilityStatus = "compatible" | "conditional" | "unverified" | "incompatible";
export type CompatibilityArea = "ownership" | "slot" | "class" | "exotic" | "subclass" | "set" | "mechanic" | "coverage";

export interface CompatibilityFinding {
  id: string;
  area: CompatibilityArea;
  status: Exclude<CompatibilityStatus, "compatible">;
  subject: string;
  reason: string;
  evidence: "bungie_snapshot" | "bungie_detail" | "build_context" | "curated_mechanics";
}

export interface SetThresholdCheck {
  setName: string;
  requiredPieces: number;
  /** Definite membership by set hash, or lower-bound membership by exact name. */
  confirmedPieces: number;
  /** Other selected armor pieces with insufficient detail/identity. */
  uncertainPieces: number;
  /** 'met' does NOT assert the in-combat trigger took place. */
  state: "met" | "not_met" | "unknown";
  identity: "bungie_set_hash" | "set_name_only";
  perkName: string;
}

/**
 * Item-level Armor 3.0 values in the Bungie instance detail response.
 * These are NOT certified final Guardian stats: fragment stat effects, temporary
 * buffs and other contributions are not yet modelled in BuildContext v1.
 */
export interface ArmorStatCoverage {
  statHash: number;
  name: string;
  /** Complete sum of the five selected armor slots; null if any slot/stat is unknown. */
  value: number | null;
  /** Only values witnessed in loaded matching detail snapshots. Never treat this as the final stat. */
  knownPartial: number;
  coveredSlots: number;
  expectedSlots: number;
  complete: boolean;
  missingSlots: string[];
}

export interface GuardianArmorStatsReport {
  version: 1;
  scope: "selected_armor_item_stats_only";
  complete: boolean;
  loadedSlots: number;
  expectedSlots: number;
  stats: ArmorStatCoverage[];
  /** Sum of all six armor item values only, or null with incomplete evidence. */
  armorItemTotal: number | null;
  /** Never claim this equals the final in-game Guardian totals. */
  finalGuardianStatsVerified: false;
  warnings: string[];
}

/** Exact six Armor 3.0 hash IDs found in the real 2026 Bungie details. */
const ARMOR_3_STATS = [
  { statHash: 2996146975, name: "Weapons" },
  { statHash: 392767087, name: "Health" },
  { statHash: 1943323491, name: "Class" },
  { statHash: 1735777505, name: "Grenade" },
  { statHash: 144602215, name: "Super" },
  { statHash: 4244567218, name: "Melee" },
] as const;

/** The five Destiny 2 armor equipment buckets: helmet, arms, chest, legs, class item. */
const ARMOR_SLOTS = [
  { slotHash: 3448274439, label: "Helmet" },
  { slotHash: 3551918588, label: "Gauntlets" },
  { slotHash: 14239492, label: "Chest" },
  { slotHash: 20886954, label: "Legs" },
  { slotHash: 1585787867, label: "Class item" },
] as const;

/** Read-only. Uses the same already-selected/previewed items as the Validator.
 * Never sums arbitrary inventory, weapon stats, possible mods or perk descriptions.
 */
export function calculateGuardianArmorStats(context: BuildContext): GuardianArmorStatsReport {
  const warnings: string[] = [];
  const armor = context.build.gear.filter((part) => part.item.category === "armor");
  const bySlot = new Map<number, SelectedGear[]>();
  for (const part of armor) bySlot.set(part.slotHash, [...(bySlot.get(part.slotHash) ?? []), part]);
  const extraSlots = [...bySlot.keys()].filter((hash) => !ARMOR_SLOTS.some((slot) => slot.slotHash === hash));
  if (extraSlots.length) warnings.push(`${extraSlots.length} unfamiliar armor slot(s) are not counted; inspect the equip bucket mapping.`);
  if ([...bySlot.values()].some((parts) => parts.length > 1))
    warnings.push("Duplicate armor pieces in a slot are excluded from totals until the conflict is fixed.");

  const loadedSlots = ARMOR_SLOTS.filter(({slotHash}) => {
    const selected = bySlot.get(slotHash) ?? [];
    return selected.length === 1 && selected[0].detailsLoaded && Array.isArray(selected[0].stats) && selected[0].stats.length > 0;
  }).length;
  const stats: ArmorStatCoverage[] = ARMOR_3_STATS.map(({statHash, name}) => {
    let knownPartial = 0;
    let coveredSlots = 0;
    const missingSlots: string[] = [];
    for (const {slotHash, label} of ARMOR_SLOTS) {
      const selected = bySlot.get(slotHash) ?? [];
      if (selected.length !== 1 || !selected[0].detailsLoaded || !Array.isArray(selected[0].stats)) {
        missingSlots.push(label);
        continue;
      }
      const statMatches = selected[0].stats!.filter((stat) => stat.statHash === statHash);
      if (statMatches.length !== 1 || !Number.isFinite(statMatches[0].value)) {
        missingSlots.push(label);
        continue;
      }
      // Explicit zero in scope=detail is a legitimate zero; missing is not.
      knownPartial += statMatches[0].value;
      coveredSlots += 1;
    }
    const complete = coveredSlots === ARMOR_SLOTS.length;
    return {statHash, name, value: complete ? knownPartial : null, knownPartial,
      coveredSlots, expectedSlots: ARMOR_SLOTS.length, complete, missingSlots};
  });
  const complete = stats.every((stat) => stat.complete) && extraSlots.length === 0 &&
    [...bySlot.values()].every((parts) => parts.length === 1);
  if (!complete) warnings.push("Some armor item-level stat values are missing. Partial sums are not final totals.");
  warnings.push("Armor item values may already reflect applied mods/tuning; do not add selected mod values a second time.");
  warnings.push("Subclass fragment modifiers and other non-item effects are not included. Final Guardian stats are unverified.");
  return {version: 1, scope: "selected_armor_item_stats_only", complete,
    loadedSlots, expectedSlots: ARMOR_SLOTS.length, stats,
    armorItemTotal: complete ? stats.reduce((sum, stat) => sum + stat.knownPartial, 0) : null,
    finalGuardianStatsVerified: false, warnings};
}

export interface CompatibilityReport {
  version: 1;
  status: CompatibilityStatus;
  guardianId: string;
  evaluatedGear: number;
  /** Read-only evaluation, never a promise an item can be equipped in-game. */
  hypothetical: boolean;
  findings: CompatibilityFinding[];
  sets: SetThresholdCheck[];
  /** Informational: bonuses from known sets whose threshold is not met. NOT a loadout conflict. */
  inactiveBonuses: SetThresholdCheck[];
  /** Informational: insufficient set identity/coverage to certify the threshold. */
  uncertainBonuses: SetThresholdCheck[];
  /** Six numeric Armor 3.0 item sums, explicit about incomplete evidence. */
  armorStats: GuardianArmorStatsReport;
  /** Reports from the exact-hash rule catalog, not observed combat procs. */
  mechanics: { compatible: number; conditional: number; unverified: number };
  warnings: string[];
}

export interface InstanceCompatibilityFacts {
  itemHash: number;
  /** Unknown if tier was not returned by Bungie. */
  exotic: boolean | null;
  /** Null means the set identity was not confirmed (NOT "has no set"). */
  setHash: number | null;
  setName: string | null;
  /** Null means no damage type fact was supplied. */
  damageType: number | null;
  /** True if snapshots disagree about immutable item identity or rarity. */
  conflicting: boolean;
}
export type CompatibilityFacts = Readonly<Record<string, InstanceCompatibilityFacts>>;

interface DetailWithMetadata extends ItemDetail {
  tierTypeName?: string;
  damageType?: number;
  itemSet?: (NonNullable<ItemDetail["itemSet"]> & { hash?: number }) | null;
}
interface InventoryWithMetadata extends InventoryItem {
  tierTypeName?: string;
  damageType?: number;
}

function observedTier(tier: unknown): boolean | null {
  if (typeof tier !== "string") return null;
  const value = tier.trim().toLowerCase();
  if (value === "exotic") return true;
  if (["legendary", "rare", "uncommon", "common", "basic"].includes(value)) return false;
  return null;
}
function observedNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Collect ONLY observed metadata from existing scope=core/account and detail.
 * BuildContext v1 intentionally loses `tierTypeName` and `itemSet.hash`.
 * This helper restores them without modifying BuildContext or asking for new API calls.
 */
export function collectCompatibilityFacts(
  core: CoreSnapshot,
  account?: AccountSnapshot | null,
  detailsByInstanceId?: Readonly<Record<string, ItemDetail | null | undefined>>,
): CompatibilityFacts {
  const facts: Record<string, InstanceCompatibilityFacts> = {};
  const inventory = [
    ...(core.equipment ?? []), ...(core.inventory ?? []),
    ...(account?.vault ?? []), ...(account?.otherGuardianItems ?? []),
  ];
  for (const raw of inventory) {
    if (!raw.itemInstanceId || !Number.isFinite(raw.itemHash)) continue;
    const item = raw as InventoryWithMetadata;
    const id = raw.itemInstanceId;
    const exotic = observedTier(item.tierTypeName);
    const damageType = observedNumber(item.damageType);
    const existing = facts[id];
    if (!existing) {
      facts[id] = { itemHash: item.itemHash, exotic, setHash: null, setName: null,
        damageType, conflicting: false };
    } else {
      if (existing.itemHash !== item.itemHash ||
          (existing.exotic !== null && exotic !== null && existing.exotic !== exotic) ||
          (existing.damageType !== null && damageType !== null && existing.damageType !== damageType)) {
        existing.conflicting = true;
      }
      if (existing.exotic === null) existing.exotic = exotic;
      if (existing.damageType === null) existing.damageType = damageType;
    }
  }
  for (const [id, raw] of Object.entries(detailsByInstanceId ?? {})) {
    if (!raw) continue;
    const detail = raw as DetailWithMetadata;
    const fact = facts[id];
    // Never trust an unrelated detail response or an arbitrary orphan detail.
    if (!fact || detail.itemInstanceId !== id || detail.itemHash !== fact.itemHash) {
      if (fact) fact.conflicting = true;
      continue;
    }
    const tier = observedTier(detail.tierTypeName);
    if (tier !== null) {
      if (fact.exotic !== null && fact.exotic !== tier) fact.conflicting = true;
      else fact.exotic = tier;
    }
    const hash = observedNumber(detail.itemSet?.hash);
    if (hash !== null) fact.setHash = hash;
    if (typeof detail.itemSet?.name === "string" && detail.itemSet.name.trim()) {
      fact.setName = detail.itemSet.name.trim();
    }
    if (detail.damageType !== undefined) {
      const damageType = observedNumber(detail.damageType);
      if (fact.damageType !== null && damageType !== null && fact.damageType !== damageType)
        fact.conflicting = true;
      else if (fact.damageType === null) fact.damageType = damageType;
    }
  }
  return facts;
}

function sameItem(a: KnownItem, b: KnownItem): boolean {
  return a.itemInstanceId !== null && b.itemInstanceId !== null
    ? a.itemInstanceId === b.itemInstanceId
    : a.identity === b.identity;
}

const rank: Record<CompatibilityStatus, number> = {
  compatible: 0, conditional: 1, unverified: 2, incompatible: 3,
};
function statusFrom(findings: readonly CompatibilityFinding[]): CompatibilityStatus {
  let result: CompatibilityStatus = "compatible";
  for (const finding of findings) if (rank[finding.status] > rank[result]) result = finding.status;
  return result;
}

function selectedSetChecks(context: BuildContext, facts: CompatibilityFacts): {
  checks: SetThresholdCheck[];
} {
  const armor = context.build.gear.filter((gear) => gear.item.category === "armor");
  const checks: SetThresholdCheck[] = [];
  const emitted = new Set<string>();
  for (const gear of armor) {
    for (const perk of gear.setBonuses ?? []) {
      if (!perk.setName.trim() || !Number.isInteger(perk.requiredPieces) || perk.requiredPieces < 1) continue;
      const ownFact = gear.item.itemInstanceId ? facts[gear.item.itemInstanceId] : undefined;
      const hash = ownFact && !ownFact.conflicting ? ownFact.setHash : null;
      const lowerName = perk.setName.trim().toLocaleLowerCase("en-US");
      const key = `${hash ?? `name:${lowerName}`}:${perk.requiredPieces}:${perk.perkName}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      let confirmed = 0;
      let uncertain = 0;
      for (const part of armor) {
        const fact = part.item.itemInstanceId ? facts[part.item.itemInstanceId] : undefined;
        if (!part.detailsLoaded || !fact || fact.conflicting) {
          uncertain += 1;
          continue;
        }
        // Do not merge different set hashes even if the display name matches.
        if (hash !== null && fact.setHash !== null) {
          if (fact.setHash === hash) confirmed += 1;
          continue;
        }
        const otherNames = (part.setBonuses ?? []).map((bonus) => bonus.setName.trim().toLocaleLowerCase("en-US"));
        if (hash !== null && fact.setHash === null && otherNames.includes(lowerName)) {
          uncertain += 1; // potential membership by name is NOT proven by hash
        } else if (hash === null && otherNames.includes(lowerName)) {
          confirmed += 1; // lower bound from exact Manifest set name only
        } else if (hash === null && !part.setBonuses?.length && fact.setHash === null) {
          uncertain += 1;
        }
      }
      let state: SetThresholdCheck["state"];
      if (hash === null && confirmed >= perk.requiredPieces) state = "unknown"; // name != proven identity
      else if (confirmed >= perk.requiredPieces) state = "met";
      else if (confirmed + uncertain < perk.requiredPieces) state = "not_met";
      else state = "unknown";
      checks.push({ setName: perk.setName, requiredPieces: perk.requiredPieces,
        confirmedPieces: confirmed, uncertainPieces: uncertain, state,
        identity: hash !== null ? "bungie_set_hash" : "set_name_only", perkName: perk.perkName });
    }
  }
  // Optional set thresholds are INFORMATION, never evidence the entire loadout is invalid.
  return { checks };
}

/** Validate the currently selected BuildContext, including local previews. */
export function validateBuildCompatibility(
  context: BuildContext,
  facts: CompatibilityFacts = {},
  mechanicsReport?: MechanicsReport,
): CompatibilityReport {
  const findings: CompatibilityFinding[] = [];
  const warnings: string[] = [];
  const gear = context.build.gear;
  const selectedIds = new Set<string>();
  const selectedSlots = new Set<number>();
  const exotics = { armor: 0, weapon: 0 };
  const unknownRarity = { armor: 0, weapon: 0 };
  for (const part of gear) {
    const { item } = part;
    const id = item.itemInstanceId;
    if (selectedSlots.has(part.slotHash)) findings.push({
      id: `slot:duplicate:${part.slotHash}`, area: "slot", status: "incompatible", subject: item.name,
      reason: "Two selected items occupy the same equipment slot.", evidence: "build_context",
    });
    selectedSlots.add(part.slotHash);
    if (id) {
      if (selectedIds.has(id)) findings.push({
        id: `item:duplicate:${id}`, area: "slot", status: "incompatible", subject: item.name,
        reason: "The same item instance is selected more than once.", evidence: "build_context",
      });
      selectedIds.add(id);
    }
    if (item.equipmentSlotHash === null) findings.push({
      id: `slot:unknown:${part.slotHash}`, area: "slot", status: "unverified", subject: item.name,
      reason: "The equipment slot hash is missing from the item metadata.", evidence: "build_context",
    });
    else if (item.equipmentSlotHash !== part.slotHash) findings.push({
      id: `slot:mismatch:${part.slotHash}`, area: "slot", status: "incompatible", subject: item.name,
      reason: "Selected item belongs to a different equipment slot.", evidence: "build_context",
    });
    if (item.availability !== "owned" || item.positionStatus === "conflicting") findings.push({
      id: `ownership:${id ?? item.identity}`, area: "ownership", status: "unverified", subject: item.name,
      reason: "Ownership or actual inventory location cannot be confirmed.", evidence: "build_context",
    });
    if (item.classType === null || context.guardian.classType === null || context.guardian.classType === undefined) {
      findings.push({ id: `class:unknown:${id ?? item.identity}`, area: "class", status: "unverified", subject: item.name,
        reason: "Cannot validate Guardian class because class metadata is missing.", evidence: "build_context" });
    } else if (item.classType !== 3 && item.classType !== context.guardian.classType) {
      findings.push({ id: `class:wrong:${id ?? item.identity}`, area: "class", status: "incompatible", subject: item.name,
        reason: "Item is restricted to another Guardian class.", evidence: "build_context" });
    }
    if (item.category !== "armor" && item.category !== "weapon") continue;
    const fact = id ? facts[id] : undefined;
    if (!fact || fact.itemHash !== item.itemHash || fact.conflicting || fact.exotic === null) {
      unknownRarity[item.category] += 1;
      continue;
    }
    if (fact.exotic) exotics[item.category] += 1;
  }
  for (const category of ["weapon", "armor"] as const) {
    if (exotics[category] > 1) findings.push({
      id: `exotic:limit:${category}`, area: "exotic", status: "incompatible", subject: `${category} exotic limit`,
      reason: `${exotics[category]} known Exotic ${category} items are selected; only one Exotic of this category may be equipped.`,
      evidence: "bungie_snapshot",
    });
    if (unknownRarity[category] > 0) findings.push({
      id: `exotic:unknown:${category}`, area: "exotic", status: "unverified", subject: `${category} exotic limit`,
      reason: `${unknownRarity[category]} selected ${category} item(s) lack verified tier metadata; the Exotic limit cannot be certified.`,
      evidence: "bungie_snapshot",
    });
  }
  const subclass = context.build.subclass;
  if (!subclass) findings.push({ id: "subclass:missing", area: "subclass", status: "unverified", subject: "Subclass",
    reason: "No subclass setup is available.", evidence: "build_context" });
  else if (subclass.unlockStatus === "locked" && context.mode !== "theory") findings.push({
    id: "subclass:locked", area: "subclass", status: "incompatible", subject: subclass.name,
    reason: "Selected subclass is locked in an owned/equippable build.", evidence: "build_context",
  });
  else if (subclass.theoretical || context.mode === "theory") findings.push({
    id: "subclass:theory", area: "subclass", status: "conditional", subject: subclass.name,
    reason: "Subclass configuration is theoretical or includes locked/Manifest-only selections.", evidence: "build_context",
  });
  else if (subclass.unlockStatus === "unknown") findings.push({
    id: "subclass:unknown", area: "subclass", status: "unverified", subject: subclass.name,
    reason: "Selected subclass unlock status cannot be verified.", evidence: "build_context",
  });

  const { checks } = selectedSetChecks(context, facts);
  const mechanics = mechanicsReport ?? resolveBuildMechanics(context);
  let compatibleMechanics = 0;
  let conditionalMechanics = 0;
  let unverifiedMechanics = 0;
  for (const part of mechanics.mechanics) {
    if (part.configuration === "missing_requirement") {
      conditionalMechanics += 1;
      findings.push({ id: `mechanic:missing:${part.id}`, area: "mechanic", status: "conditional", subject: part.title,
        reason: `Mechanic is present but its selected prerequisites are not satisfied: ${part.prerequisites.join("; ")}.`,
        evidence: "curated_mechanics" });
    } else if (part.configuration === "unknown" || part.configuration === "theoretical") {
      unverifiedMechanics += 1;
      findings.push({ id: `mechanic:unknown:${part.id}`, area: "mechanic", status: "unverified", subject: part.title,
        reason: part.explanation, evidence: "curated_mechanics" });
    } else if (part.configuration === "preview") conditionalMechanics += 1;
    else compatibleMechanics += 1;
  }
  const incomplete = gear.filter((part) => !part.detailsLoaded).length;
  if (incomplete) {
    findings.push({ id: "coverage:missing_details", area: "coverage", status: "unverified", subject: "Mechanics coverage",
      reason: `${incomplete} selected gear items lack scope=detail. Unknown effects and set memberships cannot be ruled out.`,
      evidence: "build_context" });
  }
  if (!context.account.complete) warnings.push("Account inventory has not finished loading; candidate coverage is incomplete.");
  if (mechanics.rejectedTags.length) warnings.push(`${mechanics.rejectedTags.length} unsafe inferred tag(s) were rejected by the Mechanics Resolver.`);
  warnings.push("A compatible configuration does not prove that a perk actually activated in combat.");
  return {
    version: 1, guardianId: context.guardian.characterId, hypothetical: gear.some((part) => part.isPreview) ||
      Boolean(context.build.subclass?.isPreview), status: statusFrom(findings), evaluatedGear: gear.length,
    findings, sets: checks,
    inactiveBonuses: checks.filter((check) => check.state === "not_met"),
    uncertainBonuses: checks.filter((check) => check.state === "unknown"),
    armorStats: calculateGuardianArmorStats(context),
    mechanics: { compatible: compatibleMechanics, conditional: conditionalMechanics, unverified: unverifiedMechanics },
    warnings,
  };
}

export interface ReplacementRequest {
  replaceSlotHash: number;
  candidate: KnownItem;
  /** Only selected details from the candidate's actual instance; optional. */
  candidateDetail?: ItemDetail | null;
}

function toChosen(perk: DetailPerk): ChosenPerk {
  return { plugHash: perk.plugHash, name: perk.name, description: perk.description ?? "",
    availability: "selected_on_item", effectTags: perk.effectTags ?? [], effectOrigin: "inferred_from_description" };
}

/** Validate a single hypothetical replacement, with no write to game or draft. */
export function validateCandidateReplacement(
  context: BuildContext,
  request: ReplacementRequest,
  facts: CompatibilityFacts = {},
): CompatibilityReport {
  const current = context.build.gear.find((part) => part.slotHash === request.replaceSlotHash);
  const candidate = request.candidate;
  const early: CompatibilityFinding[] = [];
  if (!current) early.push({ id: "candidate:slot_missing", area: "slot", status: "incompatible", subject: candidate.name,
    reason: "No selected gear item occupies the slot to be replaced.", evidence: "build_context" });
  if (current && (candidate.equipmentSlotHash !== request.replaceSlotHash || candidate.category !== current.item.category))
    early.push({ id: "candidate:slot_mismatch", area: "slot", status: "incompatible", subject: candidate.name,
      reason: "Candidate does not match the target slot/category.", evidence: "build_context" });
  if (!candidate.itemInstanceId || candidate.availability !== "owned" || candidate.positionStatus !== "confirmed" ||
      !candidate.position || candidate.position.startsWith("unknown:"))
    early.push({ id: "candidate:unverified_owned", area: "ownership", status: "unverified", subject: candidate.name,
      reason: "Candidate must be a confirmed, owned Bungie item instance before applying a preview.", evidence: "build_context" });
  if (context.build.gear.some((part) => part.slotHash !== request.replaceSlotHash && sameItem(part.item, candidate)))
    early.push({ id: "candidate:already_selected", area: "slot", status: "incompatible", subject: candidate.name,
      reason: "This item instance is already selected in another slot.", evidence: "build_context" });
  const canonical = candidate.itemInstanceId
    ? context.account.items.find((part) => part.itemInstanceId === candidate.itemInstanceId) : undefined;
  if (!canonical || canonical.itemHash !== candidate.itemHash) {
    early.push({ id: "candidate:missing_in_snapshot", area: "ownership", status: "unverified", subject: candidate.name,
      reason: "This exact item instance/hash is not present in the reconciled Bungie inventory snapshot.", evidence: "build_context" });
  } else if (canonical.category !== candidate.category ||
      canonical.equipmentSlotHash !== candidate.equipmentSlotHash || canonical.classType !== candidate.classType) {
    early.push({ id: "candidate:metadata_conflict", area: "ownership", status: "incompatible", subject: candidate.name,
      reason: "Candidate metadata conflicts with the known Bungie item instance; do not use stale preview data.", evidence: "build_context" });
  }
  const detail = request.candidateDetail;
  if (detail && (detail.itemHash !== candidate.itemHash || detail.itemInstanceId !== candidate.itemInstanceId))
    early.push({ id: "candidate:wrong_detail", area: "coverage", status: "incompatible", subject: candidate.name,
      reason: "Candidate detail response does not belong to the selected item instance.", evidence: "bungie_detail" });
  if (early.some((issue) => issue.status === "incompatible") || !current) {
    const base = validateBuildCompatibility(context, facts);
    return { ...base, hypothetical: false, status: "incompatible", findings: [...early, ...base.findings],
      warnings: [...base.warnings, "Hypothetical replacement was NOT evaluated: the candidate failed a hard precheck. Sets/mechanics above describe the current build."] };
  }
  const selected = new Map<string, ChosenPerk>();
  if (detail) {
    for (const perk of detail.selectedPerks ?? []) if (perk.state !== "possible" && perk.state !== "rolled")
      selected.set(`${perk.socketIndex}:${perk.plugHash}`, toChosen(perk));
    for (const column of detail.perkColumns ?? []) if (column.selected &&
      column.selected.state !== "possible" && column.selected.state !== "rolled")
      selected.set(`${column.socketIndex}:${column.selected.plugHash}`, toChosen(column.selected));
  }
  const selectedHashes = new Set(Array.from(selected.values()).map((perk) => perk.plugHash));
  const intrinsic: ChosenPerk[] | null = detail ? (detail.intrinsicPerks ?? [])
    .filter((perk) => !selectedHashes.has(perk.perkHash))
    .map((perk) => ({ plugHash: perk.perkHash, name: perk.name, description: perk.description ?? "",
      availability: "selected_on_item" as const, effectTags: perk.effectTags ?? [],
      effectOrigin: "inferred_from_description" as const })) : null;
  const stats = candidate.category === "armor" ? detail?.armorStats : detail?.stats;
  const proposed: SelectedGear = {
    slotHash: request.replaceSlotHash, item: candidate, isPreview: true, detailsLoaded: Boolean(detail),
    stats: stats?.length ? stats : null, selectedPerks: detail ? Array.from(selected.values()) : null,
    intrinsicPerks: intrinsic, recoilDirection: detail?.recoilDirection ?? null,
    setBonuses: detail ? (detail.itemSet?.perks ?? []).map((bonus) => ({
      setName: detail.itemSet?.name ?? "", perkName: bonus.name,
      requiredPieces: bonus.requiredSetCount, effectTags: bonus.effectTags ?? [],
    })) : null,
  };
  const hypothetical: BuildContext = { ...context, build: { ...context.build,
    gear: context.build.gear.map((part) => part.slotHash === request.replaceSlotHash ? proposed : part) } };
  const report = validateBuildCompatibility(hypothetical, facts);
  const findings = [...early, ...report.findings];
  return { ...report, hypothetical: true, status: statusFrom(findings), findings };
}
