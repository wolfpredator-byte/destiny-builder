/**
 * Destiny Builder — 8R.5.5B: evidence-gated Voidwalker interactions.
 *
 * Install at: src/lib/destiny-builder/mechanicsResolver.ts
 * Pure/read-only: no Bungie calls, writes, hidden perk rolls, simulations,
 * damage scores, or assumptions that a combat trigger actually occurred.
 *
 * Catalog contains audited user samples, reviewed Voidwalker aspects and
 * source-backed interactions. Interactions do NOT become optimization chains.
 * Unlisted hashes never become mechanics through effect-tag text matching.
 */

import type { BuildContext, ChosenPerk } from "./buildContext";

export type MechanicsSourceKind = "subclass" | "armor" | "weapon" | "artifact";
export type MechanicConfiguration = "eligible" | "missing_requirement" | "unknown" | "preview" | "theoretical";
export type MechanicEvidence = "observed_bungie_detail" | "curated_void_rule";

export interface MechanicsSource {
  kind: MechanicsSourceKind;
  itemHash: number;
  itemInstanceId: string | null;
  itemName: string;
  plugHash: number;
  plugName: string;
  /** Socket count for identical selected perks; NOT a stacking multiplier. */
  selectedCopies: number;
  preview: boolean;
}

/** A requirement may be unmet, unobservable, or supported by selected configuration. */
export type RequirementCheckStatus = "met" | "not_met" | "unknown";
export type RequirementEvidenceKind = "exact_selected_hash" | "selected_subclass_setup" | "not_in_build_context";

export interface MechanicRequirementCheck {
  kind: "source_selected" | "subclass_element" | "selected_grenade" | "unavailable_context";
  description: string;
  status: RequirementCheckStatus;
  reason: string;
  evidence: RequirementEvidenceKind;
  /** Configuration provenance: neither flag means the trigger was observed. */
  preview: boolean;
  theoretical: boolean;
}

/** Catalog provenance is NOT verification of the live gameplay patch. */
export interface MechanicRuleProvenance {
  basis: MechanicEvidence;
  audit: "oct-2026-sample" | "reviewed-void-description";
  verifiedPatch: null;
  patchStatus: "unverified";
  scope: "selected_perk_observation" | "reviewed_behavior_description";
  /** Source links for newly reviewed rules, not a claim of current-patch verification. */
  sourceUrls?: string[];
}

export interface ChainDependencyCheck {
  mechanicId: string;
  configuration: MechanicConfiguration;
  /** Present means selected in the configuration, NOT activated in combat. */
  present: true;
}

export interface ResolvedMechanic {
  id: string;
  title: string;
  /** The event must occur in-game; Bungie snapshots do not observe it. */
  trigger: string;
  effects: string[];
  prerequisites: string[];
  configuration: MechanicConfiguration;
  explanation: string;
  evidence: MechanicEvidence;
  sources: MechanicsSource[];
  /** Per-condition audit; never interpret unknown as satisfied or missing. */
  requirementChecks: MechanicRequirementCheck[];
  provenance: MechanicRuleProvenance;
  /** True means we KNOW the trigger happened, not that it *could* happen. */
  activationObserved: false;
  stackingVerified: false;
}

export interface MechanicsChain {
  id: string;
  title: string;
  steps: string[];
  configuration: "eligible" | "preview" | "theoretical" | "unknown";
  dependencyChecks: ChainDependencyCheck[];
  /** Provenance of the catalog linkage, not evidence of an actual activation. */
  provenance: MechanicRuleProvenance;
  /** Chains describe potential sequences, never measured proc frequency. */
  activationObserved: false;
  explanation: string;
}

/**
 * Relationships are deliberately separate from Chains. The Armor Optimizer
 * currently treats chains as preservation objectives; evidence about stacking
 * or overlapping effects must not silently become a scored synergy.
 */
export type InteractionRelation = "stacks" | "overlaps" | "conditional";
export type InteractionEvidenceLevel = "bungie_patch_notes" | "community_research";

export interface MechanicInteractionClaim {
  id: string;
  /** What the two sources do together, not a claim of combat activation. */
  relation: InteractionRelation;
  description: string;
  evidenceLevel: InteractionEvidenceLevel;
  sourceUrls: string[];
  /** Current gameplay has not been independently tested in this app. */
  currentPatchVerified: false;
}

export interface MechanicsInteraction {
  id: string;
  title: string;
  requiredMechanicIds: string[];
  /** Derived only from the exact selected mechanics and their requirements. */
  configuration: MechanicConfiguration;
  dependencyChecks: ChainDependencyCheck[];
  claims: MechanicInteractionClaim[];
  /** No Bungie combat event or stack count can be observed by BuildContext. */
  activationObserved: false;
  stackingObserved: false;
  explanation: string;
}

export interface RejectedMechanicTag {
  itemName: string;
  plugName: string;
  tag: string;
  reason: string;
}

export interface MechanicsReport {
  version: 1;
  catalogVersion: "8R.5.5-void-interactions-1";
  guardianId: string;
  scannedGear: number;
  detailedGear: number;
  /** Includes only selected perks, never rolled or Manifest-only options. */
  mechanics: ResolvedMechanic[];
  chains: MechanicsChain[];
  /** Inspected relationships; NOT optimization chains or observed combat buffs. */
  interactions: MechanicsInteraction[];
  rejectedTags: RejectedMechanicTag[];
  warnings: string[];
}

/**
 * 8R.5.3 — typed, evidence-gated knowledge rules.
 * These are catalog descriptions, NOT runtime evidence of combat activations.
 * All patch-dependent numerical values remain unknown until sourced and verified.
 */
type TriggerEvent =
  | "grenade_use_or_final_blow" | "grenade_final_blow" | "void_ability_final_blow"
  | "orb_or_void_breach_pickup" | "weapon_final_blow"
  | "weapon_final_blow_or_damage"
  | "grenade_charge_or_passive" | "rift_cast_then_weapon_damage"
  | "powered_melee_hit_then_activation";
type MechanicEffectKey =
  | "extra_scatter_charge" | "scatter_tracking" | "scatter_projectiles"
  | "orb_of_power" | "devour" | "volatile_rounds"
  | "elemental_explosion" | "weapon_tracking" | "reload_speed"
  | "extra_grenade_charge" | "grenade_specific_enhancement"
  | "weaken" | "suppress" | "class_ability_energy"
  | "void_damage" | "void_overshield";
type EffectRecipient = "guardian" | "weapon" | "projectiles" | "environment" | "nearby_enemies" | "grenade";

type CatalogRequirement =
  | { kind: "source_selected"; description: string }
  | { kind: "subclass_element"; element: "void"; description?: string }
  | { kind: "selected_grenade"; plugHash: number; description: string }
  | { kind: "unavailable_context"; field: "weapon_damage_type"; description: string };

interface CatalogEffect {
  key: MechanicEffectKey;
  recipient: EffectRecipient;
  description: string;
  /** Null means UNKNOWN, never zero. */
  durationSeconds: number | null;
  cooldownSeconds: number | null;
}

interface CatalogRule {
  id: string;
  title: string;
  sourceKind: MechanicsSourceKind;
  plugHash: number;
  /** An item-specific hash must be matched exactly. */
  itemHash?: number;
  trigger: { event: TriggerEvent; description: string };
  effects: readonly CatalogEffect[];
  requirements: readonly CatalogRequirement[];
  provenance: {
    basis: MechanicEvidence;
    /** Historical evidence source, not proof the current patch is identical. */
    audit: "oct-2026-sample" | "reviewed-void-description";
    verifiedPatch: null;
    sourceUrls?: readonly string[];
  };
  stacking?: boolean;
}

interface CatalogChainRule {
  id: string;
  title: string;
  requiredMechanicIds: readonly string[];
  /** Reviewed linkage: do not infer chains merely from matching text or tags. */
  links: readonly { producerId: string; effectKey: MechanicEffectKey; consumerId: string }[];
  steps: readonly string[];
  explanation: string;
}

function effect(key: MechanicEffectKey, recipient: EffectRecipient, description: string): CatalogEffect {
  return { key, recipient, description, durationSeconds: null, cooldownSeconds: null };
}

/**
 * Seven historical sample rules plus three reviewed Voidwalker aspects.
 * New aspect hash IDs are public Destiny manifest entries; none implies
 * that a specific Guardian has unlocked or equipped that aspect.
 */
const CATALOG: readonly CatalogRule[] = [
  {
    id: "void.scatter-charge", title: "Scatter Charge — Nothing Manacles",
    sourceKind: "armor", itemHash: 3982932616, plugHash: 395373724,
    trigger: { event: "grenade_use_or_final_blow", description: "Scatter Grenade usage; Scatter Grenade final blow for extra projectiles" },
    effects: [
      effect("extra_scatter_charge", "guardian", "Extra Scatter Grenade charge"),
      effect("scatter_tracking", "projectiles", "Scatter projectile tracking"),
      effect("scatter_projectiles", "projectiles", "Additional projectiles following a Scatter Grenade final blow"),
    ],
    requirements: [
      { kind: "source_selected", description: "Nothing Manacles selected" },
      { kind: "selected_grenade", plugHash: 1514173218, description: "Scatter Grenade selected" },
    ],
    provenance: { basis: "observed_bungie_detail", audit: "oct-2026-sample", verifiedPatch: null },
  },
  {
    id: "armor.firepower", title: "Firepower", sourceKind: "armor", plugHash: 2485657760,
    trigger: { event: "grenade_final_blow", description: "Grenade final blow" },
    effects: [effect("orb_of_power", "environment", "Creates an Orb of Power")],
    requirements: [{ kind: "source_selected", description: "Firepower armor mod selected" }],
    provenance: { basis: "observed_bungie_detail", audit: "oct-2026-sample", verifiedPatch: null },
    stacking: true,
  },
  {
    id: "void.feed-the-void", title: "Feed the Void", sourceKind: "subclass", plugHash: 2321824284,
    trigger: { event: "void_ability_final_blow", description: "Void ability final blow" },
    effects: [effect("devour", "guardian", "Grants Devour")],
    requirements: [
      { kind: "source_selected", description: "Feed the Void aspect selected on Voidwalker" },
      { kind: "subclass_element", element: "void" },
    ],
    provenance: { basis: "curated_void_rule", audit: "reviewed-void-description", verifiedPatch: null },
  },
  // 2026 Destiny manifest: https://www.light.gg/db/items/2321824285/chaos-accelerant/
  // Bungie dev insight on additional grenade charge:
  // https://origin-static01.bungie.net/7/en/News/Article/dev_insights_abilities_armor_preview
  {
    id: "void.chaos-accelerant", title: "Chaos Accelerant", sourceKind: "subclass", plugHash: 2321824285,
    trigger: { event: "grenade_charge_or_passive", description: "Passive bonus while the aspect is selected; hold the grenade input to overcharge a Void grenade" },
    effects: [
      effect("extra_grenade_charge", "guardian", "Grants an additional grenade charge"),
      effect("grenade_specific_enhancement", "grenade", "Overcharging enhances the selected grenade; the specific behavior depends on the grenade type"),
    ],
    requirements: [
      { kind: "source_selected", description: "Chaos Accelerant aspect selected" },
      { kind: "subclass_element", element: "void" },
    ],
    provenance: {
      basis: "curated_void_rule", audit: "reviewed-void-description", verifiedPatch: null,
      sourceUrls: [
        "https://www.light.gg/db/items/2321824285/chaos-accelerant/",
        "https://origin-static01.bungie.net/7/en/News/Article/dev_insights_abilities_armor_preview",
      ],
    },
  },
  // 2026 Destiny manifest and Bungie Update 9.7.0 (new suppression behavior):
  // https://www.light.gg/db/items/2321824287/child-of-the-old-gods/
  // https://origin-static01.bungie.net/7/en/News/Article/destiny_update_9_7_0
  {
    id: "void.child-of-the-old-gods", title: "Child of the Old Gods", sourceKind: "subclass", plugHash: 2321824287,
    trigger: { event: "rift_cast_then_weapon_damage", description: "Cast a Rift to summon a Void Soul, then damage an enemy with a weapon to send the Soul to that target" },
    effects: [
      effect("weaken", "nearby_enemies", "Void Soul drains and weakens affected targets"),
      effect("suppress", "nearby_enemies", "Void Soul suppresses combatants briefly after initial attachment"),
      effect("class_ability_energy", "guardian", "Defeating targets being drained by the Void Soul restores class ability energy"),
    ],
    requirements: [
      { kind: "source_selected", description: "Child of the Old Gods aspect selected" },
      { kind: "subclass_element", element: "void" },
    ],
    provenance: {
      basis: "curated_void_rule", audit: "reviewed-void-description", verifiedPatch: null,
      sourceUrls: [
        "https://www.light.gg/db/items/2321824287/child-of-the-old-gods/",
        "https://origin-static01.bungie.net/7/en/News/Article/destiny_update_9_7_0",
      ],
    },
  },
  // Introduced in Destiny 2 Update 9.7.0 (2026):
  // https://origin-static01.bungie.net/7/en/News/Article/destiny_update_9_7_0
  // https://www.light.gg/db/items/2321824286/soul-siphon/
  {
    id: "void.soul-siphon", title: "Soul Siphon", sourceKind: "subclass", plugHash: 2321824286,
    trigger: { event: "powered_melee_hit_then_activation", description: "Strike a target with a powered melee to ready Soul Siphon, then activate it using the melee input" },
    effects: [
      effect("void_damage", "nearby_enemies", "Siphons energy and damages enemies in front of the Guardian"),
      effect("void_overshield", "guardian", "Grants Void Overshield while siphoning"),
      effect("class_ability_energy", "guardian", "Grants class ability energy while siphoning"),
    ],
    requirements: [
      { kind: "source_selected", description: "Soul Siphon aspect selected" },
      { kind: "subclass_element", element: "void" },
    ],
    provenance: {
      basis: "curated_void_rule", audit: "reviewed-void-description", verifiedPatch: null,
      sourceUrls: [
        "https://www.light.gg/db/items/2321824286/soul-siphon/",
        "https://origin-static01.bungie.net/7/en/News/Article/destiny_update_9_7_0",
      ],
    },
  },
  {
    id: "void.echo-starvation", title: "Echo of Starvation", sourceKind: "subclass", plugHash: 2661180603,
    trigger: { event: "orb_or_void_breach_pickup", description: "Pick up an Orb of Power or Void Breach" },
    effects: [effect("devour", "guardian", "Grants Devour")],
    requirements: [
      { kind: "source_selected", description: "Echo of Starvation fragment selected" },
      { kind: "subclass_element", element: "void" },
    ],
    provenance: { basis: "curated_void_rule", audit: "reviewed-void-description", verifiedPatch: null },
  },
  {
    id: "void.echo-instability", title: "Echo of Instability", sourceKind: "subclass", plugHash: 2661180600,
    trigger: { event: "grenade_final_blow", description: "Grenade final blow" },
    effects: [effect("volatile_rounds", "weapon", "Grants Volatile Rounds (usable by qualifying Void weapons)")],
    requirements: [
      { kind: "source_selected", description: "Echo of Instability selected" },
      { kind: "subclass_element", element: "void" },
      { kind: "unavailable_context", field: "weapon_damage_type", description: "A qualifying Void weapon to exploit Volatile Rounds — NOT verifiable from BuildContext v1" },
    ],
    provenance: { basis: "curated_void_rule", audit: "reviewed-void-description", verifiedPatch: null },
  },
  {
    id: "weapon.chain-reaction", title: "Chain Reaction", sourceKind: "weapon", plugHash: 598607952,
    trigger: { event: "weapon_final_blow", description: "Final blow with this weapon" },
    effects: [effect("elemental_explosion", "nearby_enemies", "Creates an elemental damage explosion")],
    requirements: [{ kind: "source_selected", description: "Chain Reaction selected on the active weapon" }],
    provenance: { basis: "observed_bungie_detail", audit: "oct-2026-sample", verifiedPatch: null },
  },
  {
    id: "weapon.beacon-rounds", title: "Beacon Rounds", sourceKind: "weapon", plugHash: 1135494563,
    trigger: { event: "weapon_final_blow_or_damage", description: "Final blow with this weapon; additional damage extends duration" },
    effects: [
      effect("weapon_tracking", "projectiles", "Improves projectile tracking"),
      effect("reload_speed", "weapon", "Increases reload speed for a limited duration"),
    ],
    requirements: [{ kind: "source_selected", description: "Beacon Rounds selected on the active weapon" }],
    provenance: { basis: "observed_bungie_detail", audit: "oct-2026-sample", verifiedPatch: null },
  },
];

/** Declarative reviewed chain: not a text-derived or inferred combination. */
const CHAIN_CATALOG: readonly CatalogChainRule[] = [
  {
    id: "void.firepower-orb-starvation-devour",
    title: "Firepower → Orb of Power → Echo of Starvation → Devour",
    requiredMechanicIds: ["armor.firepower", "void.echo-starvation"],
    links: [{ producerId: "armor.firepower", effectKey: "orb_of_power", consumerId: "void.echo-starvation" }],
    steps: [
      "Grenade final blow while Firepower is equipped",
      "Firepower creates an Orb of Power",
      "Guardian picks up that Orb of Power",
      "Echo of Starvation grants Devour",
    ],
    explanation: "This is a conditional two-source sequence, not a permanent buff or proof of a proc. Multiple Firepower copies do not imply multiplied Orb output.",
  },
];

/**
 * Sources are reviewed individually; we never derive stacking from matching
 * effect names, text tags or the number of selected copies.
 *
 * Bungie Update 9.1.5 documents Chaos Accelerant's extra grenade charge.
 * Bungie Update 9.7.0 supersedes the older Renegades seekers chaining text:
 * Nothing Manacles' extra seekers are now three and cannot chain themselves.
 * light.gg's July 2026 research describes charge stacking and tracking overlap;
 * those two claims remain COMMUNITY evidence, not certified live gameplay.
 */
interface CatalogInteractionRule {
  id: string;
  title: string;
  requiredMechanicIds: readonly string[];
  claims: readonly {
    id: string;
    relation: InteractionRelation;
    description: string;
    evidenceLevel: InteractionEvidenceLevel;
    sourceUrls: readonly string[];
  }[];
  explanation: string;
}

const INTERACTION_CATALOG: readonly CatalogInteractionRule[] = [
  {
    id: "void.nothing-manacles-chaos-accelerant",
    title: "Nothing Manacles + Chaos Accelerant — Scatter Grenade",
    requiredMechanicIds: ["void.scatter-charge", "void.chaos-accelerant"],
    claims: [
      {
        id: "grenade-charge-stacking", relation: "stacks",
        description: "The additional Scatter Grenade charge from Nothing Manacles and the additional grenade charge from Chaos Accelerant are reported to stack. Actual charges are not measured here.",
        evidenceLevel: "community_research",
        sourceUrls: [
          "https://www.light.gg/db/items/300502917/nothing-manacles/",
          "https://origin-static01.bungie.net/7/en/News/Article/destiny_update_9_1_5",
        ],
      },
      {
        id: "scatter-tracking-overlap", relation: "overlaps",
        description: "Scatter Grenade tracking supplied by Nothing Manacles overlaps Chaos Accelerant tracking; do not double-count it.",
        evidenceLevel: "community_research",
        sourceUrls: ["https://www.light.gg/db/items/300502917/nothing-manacles/"],
      },
      {
        id: "scatter-extra-seekers", relation: "conditional",
        description: "Nothing Manacles can create three extra seekers after a Scatter Grenade final blow. As of Bungie Update 9.7.0, these extra seekers cannot chain off themselves; no trigger was observed.",
        evidenceLevel: "bungie_patch_notes",
        sourceUrls: ["https://www.bungie.net/7/en-us/News/Article/destiny_update_9_7_0"],
      },
    ],
    explanation: "Both sources and Scatter Grenade must be selected. Relationships summarize reviewed descriptions, not measured gameplay, damage bonuses, cooldowns or current-patch certification.",
  },
];

interface ScannedPerk {
  kind: MechanicsSourceKind;
  itemHash: number;
  itemInstanceId: string | null;
  itemName: string;
  perk: ChosenPerk;
  preview: boolean;
  theoretical: boolean;
}

function selectedPerks(context: BuildContext): ScannedPerk[] {
  const result: ScannedPerk[] = [];
  const subclass = context.build.subclass;
  if (subclass) {
    const unverified = subclass.theoretical || subclass.unlockStatus === "locked" || subclass.unlockStatus === "unknown";
    for (const socket of subclass.sockets) {
      if (!socket.perk) continue;
      result.push({
        kind: "subclass", itemHash: subclass.itemHash, itemInstanceId: null,
        itemName: subclass.name, perk: socket.perk,
        preview: subclass.isPreview || socket.isPreview,
        theoretical: unverified || socket.perk.availability === "possible",
      });
    }
  }
  for (const gear of context.build.gear) {
    // No fallback to item name or inferred effect tags if details are absent.
    if (!gear.detailsLoaded) continue;
    const kind: MechanicsSourceKind = gear.item.category === "armor" ? "armor" : "weapon";
    const perks = [...(gear.selectedPerks ?? []), ...(gear.intrinsicPerks ?? [])];
    for (const perk of perks) {
      result.push({
        kind, itemHash: gear.item.itemHash, itemInstanceId: gear.item.itemInstanceId,
        itemName: gear.item.name, perk, preview: gear.isPreview,
        theoretical: gear.item.positionStatus !== "confirmed" || perk.availability === "possible",
      });
    }
  }
  if (context.build.artifact.selectedPerks) {
    for (const perk of context.build.artifact.selectedPerks) {
      result.push({
        kind: "artifact", itemHash: context.build.artifact.item?.itemHash ?? 0,
        itemInstanceId: context.build.artifact.item?.itemInstanceId ?? null,
        itemName: context.build.artifact.name ?? "Artifact", perk,
        preview: context.build.artifact.isPreview,
        theoretical: perk.availability === "possible" || context.build.artifact.item?.positionStatus === "conflicting",
      });
    }
  }
  return result;
}

function sourcesFor(rule: CatalogRule, scanned: readonly ScannedPerk[]): ScannedPerk[] {
  return scanned.filter((part) =>
    part.kind === rule.sourceKind && part.perk.plugHash === rule.plugHash &&
    (rule.itemHash === undefined || part.itemHash === rule.itemHash));
}

/** Full evidence trace, evaluated independently from display-order and config status. */
function evaluateRequirements(
  rule: CatalogRule, context: BuildContext, parts: readonly ScannedPerk[],
): MechanicRequirementCheck[] {
  const subclass = context.build.subclass;
  return rule.requirements.map((requirement): MechanicRequirementCheck => {
    switch (requirement.kind) {
      case "source_selected":
        // Caller found the exact plug hash, type and (where required) item hash.
        // Does not imply the source is equipped in-game when it is a Preview.
        return {
          kind: requirement.kind, description: requirement.description,
          status: parts.length ? "met" : "unknown",
          reason: parts.length
            ? "Selected plug and source identity matched the reviewed catalog rule."
            : "No selected source could be verified.",
          evidence: "exact_selected_hash",
          preview: parts.some((part) => part.preview),
          theoretical: context.mode === "theory" || parts.some((part) => part.theoretical),
        };
      case "subclass_element": {
        const status: RequirementCheckStatus = !subclass ? "unknown"
          : subclass.element.toLowerCase() === requirement.element ? "met" : "not_met";
        return {
          kind: requirement.kind,
          description: requirement.description ?? `Subclass element: ${requirement.element}`,
          status,
          reason: status === "unknown" ? "Selected subclass is not available in BuildContext."
            : status === "not_met" ? `Selected subclass element is ${subclass?.element ?? "unknown"}.`
              : "Selected subclass element matches the rule.",
          evidence: "selected_subclass_setup",
          preview: Boolean(subclass?.isPreview),
          theoretical: Boolean(subclass?.theoretical || subclass?.unlockStatus === "locked" ||
            subclass?.unlockStatus === "unknown"),
        };
      }
      case "selected_grenade": {
        const grenades = subclass?.sockets.filter((socket) => /grenade/i.test(socket.slotType)) ?? [];
        const selected = grenades.find((socket) => socket.perk?.plugHash === requirement.plugHash);
        const status: RequirementCheckStatus = !subclass || !grenades.length ? "unknown"
          : selected ? "met" : "not_met";
        return {
          kind: requirement.kind, description: requirement.description, status,
          reason: status === "unknown"
            ? "No selected grenade socket is available; absence cannot be established."
            : status === "not_met" ? "The required grenade is not selected."
              : "The required grenade plug hash is selected.",
          evidence: "selected_subclass_setup",
          preview: Boolean(selected && (subclass?.isPreview || selected.isPreview)),
          theoretical: Boolean(selected && (subclass?.theoretical || subclass?.unlockStatus === "locked" ||
            subclass?.unlockStatus === "unknown" || selected.perk?.availability === "possible")),
        };
      }
      case "unavailable_context":
        return {
          kind: requirement.kind, description: requirement.description,
          status: "unknown",
          reason: `${requirement.field} is not available in BuildContext v1; it must not be assumed.`,
          evidence: "not_in_build_context", preview: false, theoretical: false,
        };
    }
  });
}

function configuredRule(
  context: BuildContext, parts: readonly ScannedPerk[], checks: readonly MechanicRequirementCheck[],
): MechanicConfiguration {
  // Explicit failed requirements supersede unknown requirements; unknown
  // prevents an otherwise valid preview/theory config from being certified.
  if (checks.some((check) => check.status === "not_met")) return "missing_requirement";
  if (checks.some((check) => check.status === "unknown")) return "unknown";
  if (context.mode === "theory" || parts.some((part) => part.theoretical) ||
      checks.some((check) => check.theoretical)) return "theoretical";
  if (parts.some((part) => part.preview) || checks.some((check) => check.preview)) return "preview";
  return "eligible";
}

function mechanicProvenance(rule: CatalogRule): MechanicRuleProvenance {
  return {
    basis: rule.provenance.basis,
    audit: rule.provenance.audit,
    verifiedPatch: rule.provenance.verifiedPatch,
    patchStatus: "unverified",
    scope: rule.provenance.basis === "observed_bungie_detail"
      ? "selected_perk_observation" : "reviewed_behavior_description",
    ...(rule.provenance.sourceUrls ? { sourceUrls: [...rule.provenance.sourceUrls] } : {}),
  };
}

function readableSources(parts: ScannedPerk[]): MechanicsSource[] {
  const byItem = new Map<string, MechanicsSource>();
  for (const part of parts) {
    const key = [part.kind, part.itemInstanceId ?? String(part.itemHash), part.perk.plugHash].join(":");
    const current = byItem.get(key);
    if (current) {
      current.selectedCopies += 1;
    } else {
      byItem.set(key, {
        kind: part.kind, itemHash: part.itemHash, itemInstanceId: part.itemInstanceId,
        itemName: part.itemName, plugHash: part.perk.plugHash,
        plugName: part.perk.name, selectedCopies: 1, preview: part.preview,
      });
    }
  }
  return Array.from(byItem.values());
}

/** Pure resolver: safe to run repeatedly as preview and item details change. */
export function resolveBuildMechanics(context: BuildContext): MechanicsReport {
  const warnings: string[] = [];
  const scanned = selectedPerks(context);
  const mechanics: ResolvedMechanic[] = [];
  const rejectedTags: RejectedMechanicTag[] = [];
  const missing = context.build.gear.filter((gear) => !gear.detailsLoaded).length;
  if (missing) warnings.push(`${missing} selected gear item(s) lack scope=detail data; mechanic coverage is incomplete.`);
  if (!context.build.subclass) warnings.push("No selected subclass setup; grenade prerequisites cannot be checked.");
  if (context.build.artifact.name && !context.build.artifact.selectedPerks)
    warnings.push("Artifact perks are not yet available in BuildContext v1.");

  // Concrete known false positive in the observed Bungie-derived text tags.
  // Does NOT remove/modify source data or create gameplay effect evidence.
  for (const part of scanned) {
    if (/\bvolatile launch\b/i.test(part.perk.name) &&
        (part.perk.effectTags ?? []).some((tag) => tag.key === "volatile" || tag.key === "volatile-rounds")) {
      rejectedTags.push({
        itemName: part.itemName, plugName: part.perk.name, tag: "volatile",
        reason: "Volatile Launch changes launcher stats; it does not apply the Void Volatile debuff.",
      });
    }
  }

  for (const rule of CATALOG) {
    const parts = sourcesFor(rule, scanned);
    if (!parts.length) continue;
    const requirementChecks = evaluateRequirements(rule, context, parts);
    const configuration = configuredRule(context, parts, requirementChecks);
    const copies = parts.length;
    const stackingWarning = rule.stacking && copies > 1
      ? ` ${copies} selected copies were observed; stacking effectiveness has NOT been verified.` : "";
    mechanics.push({
      id: rule.id, title: rule.title, trigger: rule.trigger.description,
      effects: rule.effects.map((entry) => entry.description),
      prerequisites: rule.requirements.flatMap((entry) => entry.description ? [entry.description] : []),
      configuration, evidence: rule.provenance.basis,
      sources: readableSources(parts), requirementChecks, provenance: mechanicProvenance(rule),
      activationObserved: false, stackingVerified: false,
      explanation: configuration === "eligible"
        ? `Configuration prerequisites supported; the combat trigger has not been observed.${stackingWarning}`
        : configuration === "missing_requirement"
          ? `At least one required selected ability/subclass does not match.${stackingWarning}`
          : configuration === "preview"
            ? `Owned/selected preview: this is not currently equipped in-game.${stackingWarning}`
            : configuration === "theoretical"
              ? `This involves theoretical, locked or position-unverified data.${stackingWarning}`
              : `Available BuildContext data cannot verify every requirement.${stackingWarning}`,
    });
  }

  // Links are reviewed and enumerated in CHAIN_CATALOG. This does NOT
  // automatically infer interactions from strings, effects or shared tags.
  const chains: MechanicsChain[] = [];
  for (const chainRule of CHAIN_CATALOG) {
    const required = chainRule.requiredMechanicIds.map((id) => mechanics.find((part) => part.id === id));
    if (required.some((entry) => !entry)) continue;
    // A stale/mistyped catalog edge must not silently produce a chain.
    const linked = chainRule.links.every((link) => {
      const producer = CATALOG.find((entry) => entry.id === link.producerId);
      return chainRule.requiredMechanicIds.includes(link.producerId) &&
        chainRule.requiredMechanicIds.includes(link.consumerId) &&
        Boolean(producer?.effects.some((entry) => entry.key === link.effectKey));
    });
    if (!linked) continue;
    const observed = required.filter((entry): entry is ResolvedMechanic => entry !== undefined);
    const configuration: MechanicsChain["configuration"] = observed.every((entry) => entry.configuration === "eligible")
      ? "eligible"
      : observed.some((entry) => entry.configuration === "theoretical") ? "theoretical"
        : observed.some((entry) => entry.configuration === "preview") ? "preview" : "unknown";
    chains.push({
      id: chainRule.id, title: chainRule.title, steps: [...chainRule.steps],
      configuration,
      dependencyChecks: observed.map((part) => ({
        mechanicId: part.id, configuration: part.configuration, present: true as const,
      })),
      provenance: {
        basis: "curated_void_rule", audit: "reviewed-void-description", verifiedPatch: null,
        patchStatus: "unverified", scope: "reviewed_behavior_description",
      },
      activationObserved: false, explanation: chainRule.explanation,
    });
  }

  // Independent evidence channel: never inject these findings into Chains.
  // In particular, the armor scoring/preservation logic must not treat
  // documented overlap as an additional chain or inferred DPS improvement.
  const interactions: MechanicsInteraction[] = [];
  const mechanicsById = new Map(mechanics.map((entry) => [entry.id, entry]));
  for (const interactionRule of INTERACTION_CATALOG) {
    const required = interactionRule.requiredMechanicIds.map((id) => mechanicsById.get(id));
    // The knowledge rule exists even if a source is absent, but we only emit
    // a finding when all exact source hashes are represented in the build.
    if (required.some((entry) => !entry)) continue;
    const present = required.filter((entry): entry is ResolvedMechanic => entry !== undefined);
    const configurations = present.map((entry) => entry.configuration);
    const configuration: MechanicConfiguration = configurations.includes("missing_requirement")
      ? "missing_requirement"
      : configurations.includes("unknown") ? "unknown"
        : configurations.includes("theoretical") ? "theoretical"
          : configurations.includes("preview") ? "preview" : "eligible";
    interactions.push({
      id: interactionRule.id, title: interactionRule.title,
      requiredMechanicIds: [...interactionRule.requiredMechanicIds], configuration,
      dependencyChecks: present.map((entry) => ({
        mechanicId: entry.id, configuration: entry.configuration, present: true as const,
      })),
      claims: interactionRule.claims.map((claim) => ({
        id: claim.id, relation: claim.relation, description: claim.description,
        evidenceLevel: claim.evidenceLevel, sourceUrls: [...claim.sourceUrls],
        currentPatchVerified: false as const,
      })),
      activationObserved: false, stackingObserved: false,
      explanation: interactionRule.explanation,
    });
  }

  // Distinct from number of selected armor stats. No numeric stat aggregation
  // or active set bonus evaluation occurs in this v1 report.
  return {
    version: 1, catalogVersion: "8R.5.5-void-interactions-1", guardianId: context.guardian.characterId,
    scannedGear: context.build.gear.length,
    detailedGear: context.build.gear.length - missing,
    mechanics, chains, interactions, rejectedTags, warnings,
  };
}
