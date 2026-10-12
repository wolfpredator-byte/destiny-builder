/**
 * Destiny Builder — 8R.6.1: universal planning context (first, read-only adapter).
 * Install at src/lib/destiny-builder/universalPlanningContext.ts
 *
 * A conservative inventory of observed build alternatives for any Guardian class.
 * No API requests, AI calls, scoring, Bungie writes, search, or local storage.
 * Unknown subclass setups and missing item details remain UNKNOWN, never absent.
 * This is a local planning contract, NOT a finished Full Build Planner.
 */
import type {
  BuildContext,
  CoreSnapshot,
  GuardianSubclass,
  ItemDetail,
  KnownItem,
  StatValue,
  SubclassPlug,
  SubclassSetup,
  SubclassSlot,
} from "./buildContext";
import type { MechanicsReport } from "./mechanicsResolver";

export type PlanningCoverage = "verified" | "partial" | "unknown";
export type PlanningOptionStatus = "equipped" | "unlocked" | "possible_unverified" | "unknown";
export type PlanningSubclassStatus = "equipped" | "unlocked" | "locked" | "unknown";
export type PlanningItemEligibility = "candidate" | "wrong_class" | "unverified";

export interface PlanningPerk {
  plugHash: number;
  name: string;
  description: string;
  origin: "selected" | "intrinsic";
}

export interface PlanningGearOption {
  itemHash: number;
  itemInstanceId: string | null;
  name: string;
  category: "armor" | "weapon";
  slotHash: number | null;
  classType: number | null;
  power: number | null;
  position: string | null;
  positionStatus: KnownItem["positionStatus"];
  /** "candidate" validates only identity, location, slot, and class; NOT overall build legality. */
  eligibility: PlanningItemEligibility;
  selectedInPreview: boolean;
  selectedInBuild: boolean;
  detailCoverage: PlanningCoverage;
  /** Never use detail contents unless the exact instance ID AND item hash match. */
  perks: PlanningPerk[];
  armorStats: StatValue[] | null;
  /** Derived only from observed compatibility facts, never names or rarity guesses. */
  armorMetadata: { exotic: boolean | null; setHash: number | null } | null;
}

export interface PlanningSocketChoice {
  plugHash: number;
  name: string;
  description: string;
  status: PlanningOptionStatus;
  /** True only when currently chosen in the local Builder Preview or Bungie setup. */
  selectedInBuild: boolean;
}

export interface PlanningSocket {
  socketIndex: number;
  slotType: string;
  options: PlanningSocketChoice[];
}

export interface PlanningSubclassOption {
  itemHash: number;
  name: string;
  element: string;
  status: PlanningSubclassStatus;
  selectedInBuild: boolean;
  setupCoverage: PlanningCoverage;
  /** Empty when setupCoverage is unknown; NOT evidence that the subclass has no abilities. */
  sockets: PlanningSocket[];
}

export interface PlanningArtifact {
  name: string | null;
  selectedPerks: PlanningPerk[];
  availableTierEntries: Array<{ itemHash: number; name: string; unlocked: boolean; active: boolean }>;
  coverage: PlanningCoverage;
}

export interface UniversalPlanningContext {
  version: 1;
  guardian: BuildContext["guardian"];
  activity: BuildContext["activity"];
  mode: BuildContext["mode"];
  goal: string;
  /** Full scoped inventory when account coverage is complete, including vault and other Guardians. */
  gearOptions: PlanningGearOption[];
  subclasses: PlanningSubclassOption[];
  artifact: PlanningArtifact;
  observedMechanics: {
    catalogVersion: string | null;
    /** Reported mechanics are recognized configurations, NOT combat activations. */
    mechanics: Array<{
      id: string; title: string; configuration: string;
      trigger: string; effects: string[];
      requirements: Array<{ description: string; status: string }>;
      evidence: string; sourceUrls: string[]; patchVerified: false;
    }>;
    chains: Array<{ id: string; title: string; configuration: string; steps: string[] }>;
    interactions: Array<{
      id: string; title: string; configuration: string;
      claims: Array<{ relation: string; description: string; evidenceLevel: string; sourceUrls: string[] }>;
    }>;
  };
  coverage: {
    account: PlanningCoverage;
    ownedGearCount: number;
    eligibleGearCount: number;
    itemDetailsVerified: number;
    itemDetailsMissing: number;
    subclassSetupsKnown: number;
    subclassSetupsMissing: number;
    artifact: PlanningCoverage;
    mechanics: PlanningCoverage;
  };
  /** Explanations of limits; use these before asking an LLM to propose a build. */
  warnings: string[];
}

/** Narrow observed facts from the existing compatibility validator. */
export interface PlanningObservedArmorFact {
  itemHash: number;
  conflicting: boolean;
  exotic: boolean | null;
  setHash: number | null;
}

export interface UniversalPlanningInput {
  context: BuildContext;
  core: CoreSnapshot;
  detailsByInstanceId: Readonly<Record<string, ItemDetail | null | undefined>>;
  armorFacts?: Readonly<Record<string, PlanningObservedArmorFact | undefined>>;
  mechanicsReport?: Pick<MechanicsReport, "catalogVersion" | "mechanics" | "chains" | "interactions"> | null;
}

function subclassStatus(subclass: GuardianSubclass): PlanningSubclassStatus {
  if (subclass.equipped || subclass.status === "equipped") return "equipped";
  if (subclass.unlocked || subclass.status === "unlocked") return "unlocked";
  if (subclass.locked || subclass.status === "locked") return "locked";
  return "unknown";
}

function socketList(setup: SubclassSetup): SubclassSlot[] {
  return [setup.super, setup.classAbility, setup.movement, setup.melee, setup.grenade,
    ...(setup.aspects ?? []), ...(setup.fragments ?? []), ...(setup.other ?? [])]
    .filter((slot): slot is SubclassSlot => slot != null);
}

function optionStatus(plug: SubclassPlug, equippedHash: number | null): PlanningOptionStatus {
  if (plug.plugHash === equippedHash || plug.equipped) return "equipped";
  if (plug.unlocked) return "unlocked";
  if (plug.possible) return "possible_unverified";
  return "unknown";
}

function planningSubclasses(context: BuildContext, core: CoreSnapshot): PlanningSubclassOption[] {
  return core.subclasses.map((subclass) => {
    const isSelected = context.build.subclass?.itemHash === subclass.itemHash;
    // core.subclassSetup may describe ONLY its own subclass. Never borrow it for another element.
    const setup = subclass.setup ??
      (core.subclassSetup?.itemHash === subclass.itemHash ? core.subclassSetup : null);
    const sockets = setup ? socketList(setup).map((slot) => {
      const previewHash = isSelected ? context.build.subclass?.sockets.find((s) => s.socketIndex === slot.socketIndex)?.perk?.plugHash : undefined;
      const selectedHash = previewHash ?? slot.equipped?.plugHash ?? null;
      const choices = new Map<number, SubclassPlug>();
      for (const option of [slot.equipped, ...(slot.available ?? [])]) {
        if (option && Number.isInteger(option.plugHash)) choices.set(option.plugHash, option);
      }
      return {
        socketIndex: slot.socketIndex,
        slotType: slot.slotType,
        options: [...choices.values()].map((plug) => ({
          plugHash: plug.plugHash,
          name: plug.name,
          description: plug.description ?? "",
          status: optionStatus(plug, slot.equipped?.plugHash ?? null),
          selectedInBuild: plug.plugHash === selectedHash,
        })),
      };
    }) : [];
    return {
      itemHash: subclass.itemHash, name: subclass.name, element: subclass.element,
      status: subclassStatus(subclass), selectedInBuild: isSelected,
      setupCoverage: setup ? "partial" as const : "unknown" as const,
      sockets,
    };
  });
}

function verifiedDetail(item: KnownItem, details: UniversalPlanningInput["detailsByInstanceId"]): ItemDetail | null {
  const id = item.itemInstanceId;
  const detail = id ? details[id] : null;
  return detail && detail.itemInstanceId === id && detail.itemHash === item.itemHash ? detail : null;
}

function observedPerks(detail: ItemDetail): PlanningPerk[] {
  const found = new Map<string, PlanningPerk>();
  const add = (socketIndex: number, plugHash: number, name: string, description: string | undefined,
    origin: PlanningPerk["origin"]) => {
    if (!Number.isInteger(plugHash)) return;
    found.set(`${origin}:${socketIndex}:${plugHash}`, { plugHash, name, description: description ?? "", origin });
  };
  for (const perk of detail.selectedPerks ?? []) {
    // Preserve the confirmed selected-perk filtering from 8R.5.2; rolled != selected.
    if (perk.state === undefined || perk.state === "selected")
      add(perk.socketIndex, perk.plugHash, perk.name, perk.description, "selected");
  }
  for (const col of detail.perkColumns ?? []) {
    if (col.selected && (col.selected.state === undefined || col.selected.state === "selected"))
      add(col.selected.socketIndex, col.selected.plugHash, col.selected.name, col.selected.description, "selected");
  }
  for (const perk of detail.intrinsicPerks ?? [])
    add(-1, perk.perkHash, perk.name, perk.description, "intrinsic");
  return [...found.values()];
}

function planningGear(input: UniversalPlanningInput): PlanningGearOption[] {
  const { context, detailsByInstanceId, armorFacts } = input;
  const selectedIds = new Set(context.build.gear.map((gear) => gear.item.itemInstanceId).filter((x): x is string => Boolean(x)));
  const selectedPreviewIds = new Set(context.build.gear.filter((gear) => gear.isPreview)
    .map((gear) => gear.item.itemInstanceId).filter((x): x is string => Boolean(x)));
  return context.account.items.filter((item) => item.category === "armor" || item.category === "weapon")
    .map((item): PlanningGearOption => {
      const detail = verifiedDetail(item, detailsByInstanceId);
      const classMatch = item.classType === 3 || (context.guardian.classType != null && item.classType === context.guardian.classType);
      const eligibility: PlanningItemEligibility = item.classType !== null && context.guardian.classType !== null &&
        context.guardian.classType !== undefined && !classMatch ? "wrong_class" :
        item.availability === "owned" && item.itemInstanceId && item.positionStatus === "confirmed" &&
        item.position && !item.position.startsWith("unknown:") &&
        item.equipmentSlotHash !== null && classMatch ? "candidate" : "unverified";
      const fact = item.itemInstanceId ? armorFacts?.[item.itemInstanceId] : undefined;
      const checkedFact = item.category === "armor" && fact && !fact.conflicting &&
        fact.itemHash === item.itemHash && typeof fact.exotic === "boolean" ? fact : null;
      return {
        itemHash: item.itemHash, itemInstanceId: item.itemInstanceId, name: item.name,
        category: item.category as "armor" | "weapon", slotHash: item.equipmentSlotHash,
        classType: item.classType, power: item.power, position: item.position,
        positionStatus: item.positionStatus, eligibility,
        selectedInPreview: Boolean(item.itemInstanceId && selectedPreviewIds.has(item.itemInstanceId)),
        selectedInBuild: Boolean(item.itemInstanceId && selectedIds.has(item.itemInstanceId)),
        detailCoverage: detail ? "verified" : "unknown",
        perks: detail ? observedPerks(detail) : [],
        armorStats: item.category === "armor" && detail?.armorStats ? detail.armorStats.map((stat) => ({ ...stat })) : null,
        armorMetadata: item.category === "armor" ? {
          exotic: checkedFact ? checkedFact.exotic : null,
          setHash: checkedFact ? checkedFact.setHash : null,
        } : null,
      };
    });
}

function planningArtifact(context: BuildContext, core: CoreSnapshot): PlanningArtifact {
  const tiers = core.artifact?.tiers ?? [];
  const entries = tiers.flatMap((tier) => tier.items ?? []).map((item) => ({
    itemHash: item.itemHash, name: item.name, unlocked: item.isUnlocked, active: item.isActive,
  }));
  const selectedPerks = (context.build.artifact.selectedPerks ?? []).filter((p) =>
    p.availability === "selected_on_item" || p.availability === "equipped").map((p) => ({
      plugHash: p.plugHash, name: p.name, description: p.description, origin: "selected" as const,
    }));
  return { name: context.build.artifact.name, selectedPerks, availableTierEntries: entries,
    coverage: selectedPerks.length || entries.length ? "partial" : "unknown" };
}

export function createUniversalPlanningContext(input: UniversalPlanningInput): UniversalPlanningContext {
  const gearOptions = planningGear(input);
  const subclasses = planningSubclasses(input.context, input.core);
  const artifact = planningArtifact(input.context, input.core);
  const detailCount = gearOptions.filter((item) => item.detailCoverage === "verified").length;
  const unknownSetups = subclasses.filter((s) => s.setupCoverage === "unknown").length;
  const warnings: string[] = [];
  if (!input.context.account.complete)
    warnings.push("Account inventory is incomplete; missing alternatives cannot be treated as unowned.");
  if (gearOptions.length > detailCount)
    warnings.push("Some owned gear has no verified per-instance details; its perks/stat interactions remain unknown.");
  if (unknownSetups)
    warnings.push(`${unknownSetups} subclass setup(s) are unavailable; empty ability options must not be interpreted as locked or absent.`);
  if (artifact.coverage === "unknown")
    warnings.push("Artifact options are not fully observable in this snapshot.");
  if (input.mechanicsReport)
    warnings.push("Mechanic recognition is catalog-limited; unrecognized interactions are NOT proven absent.");
  else warnings.push("No exact-hash mechanics report was supplied; mechanical compatibility cannot be inferred here.");
  warnings.push("Weapon elements, ammo economy, full mod choices, activity modifiers and damage/performance cannot be verified from BuildContext v1 alone.");
  return {
    version: 1, guardian: { ...input.context.guardian }, activity: input.context.activity,
    mode: input.context.mode, goal: input.context.goal,
    gearOptions, subclasses, artifact,
    observedMechanics: {
      catalogVersion: input.mechanicsReport?.catalogVersion ?? null,
      mechanics: input.mechanicsReport?.mechanics.map((m) => ({
        id: m.id, title: m.title, configuration: m.configuration, trigger: m.trigger,
        effects: [...m.effects], requirements: m.requirementChecks.map((r) => ({
          description: r.description, status: r.status,
        })), evidence: m.evidence,
        sourceUrls: [...(m.provenance.sourceUrls ?? [])], patchVerified: false as const,
      })) ?? [],
      chains: input.mechanicsReport?.chains.map((c) => ({
        id: c.id, title: c.title, configuration: c.configuration, steps: [...c.steps],
      })) ?? [],
      interactions: input.mechanicsReport?.interactions.map((i) => ({
        id: i.id, title: i.title, configuration: i.configuration,
        claims: i.claims.map((c) => ({ relation: c.relation, description: c.description,
          evidenceLevel: c.evidenceLevel, sourceUrls: [...c.sourceUrls] })),
      })) ?? [],
    },
    coverage: {
      account: input.context.account.complete ? "verified" : "partial",
      ownedGearCount: gearOptions.length,
      eligibleGearCount: gearOptions.filter((item) => item.eligibility === "candidate").length,
      itemDetailsVerified: detailCount,
      itemDetailsMissing: gearOptions.length - detailCount,
      subclassSetupsKnown: subclasses.length - unknownSetups,
      subclassSetupsMissing: unknownSetups,
      artifact: artifact.coverage,
      mechanics: input.mechanicsReport ? "partial" : "unknown",
    },
    warnings,
  };
}
