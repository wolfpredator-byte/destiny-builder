/**
 * Destiny Builder — Phase 8B.1: evidence-first Synergy Engine.
 *
 * Pure analysis of the currently SELECTED BuildContext. No network calls,
 * Bungie writes, ranking, invented effects, or automatic recommendations.
 * Effect tags are inferred from Bungie text (not Bungie mechanic relations).
 * Shared tags and curated thematic pairs are therefore OBSERVATIONS, not
 * proofs that a gameplay interaction will actually trigger.
 */

import type {
  ActivityKind,
  BuildContext,
  BuildMode,
  ChosenPerk,
  EffectTag,
  PerkAvailability,
} from "./buildContext";

export type SynergySourceKind = "subclass" | "weapon" | "armor" | "artifact";
export type SynergyFindingKind = "shared_effect" | "related_effects";
export type EvidenceCertainty = "selected" | "theoretical" | "unverified_position";

export interface SynergyEvidence {
  id: string;
  sourceKind: SynergySourceKind;
  /** Item, subclass socket, or Artifact. */
  sourceName: string;
  /** Perk or ability containing the effect reference. */
  perkName: string;
  plugHash: number;
  description: string;
  effect: EffectTag;
  availability: PerkAvailability;
  isPreview: boolean;
  certainty: EvidenceCertainty;
  itemInstanceId: string | null;
}

export interface EffectCoverage {
  key: string;
  label: string;
  kind: EffectTag["kind"];
  /** Number of distinct selected perk/ability sources mentioning the effect. */
  sourceCount: number;
  evidence: SynergyEvidence[];
}

export interface SynergyFinding {
  id: string;
  kind: SynergyFindingKind;
  title: string;
  /** Explain only what the data proves; do not assert a verified game combo. */
  explanation: string;
  effectKeys: string[];
  evidence: SynergyEvidence[];
  certainty: EvidenceCertainty;
  mechanicVerified: false;
}

export interface SynergyReport {
  version: 1;
  guardianId: string;
  activity: ActivityKind;
  mode: BuildMode;
  status: "ready" | "partial" | "theoretical";
  effects: EffectCoverage[];
  findings: SynergyFinding[];
  coverage: {
    selectedGear: number;
    detailedGear: number;
    missingGearDetails: number;
    artifactDetailsAvailable: boolean;
    accountComplete: boolean;
    evidenceSources: number;
  };
  warnings: string[];
}

/**
 * Related effects in Destiny terminology. This DOES NOT model triggers,
 * duration, stack strength, damage, or specific game mechanics.
 */
const RELATED_EFFECTS: ReadonlyArray<{
  left: string;
  right: string;
  label: string;
}> = [
  { left: "devour", right: "volatile", label: "Devour / Volatile" },
  { left: "devour", right: "volatile-rounds", label: "Devour / Volatile Rounds" },
  { left: "scorch", right: "ignition", label: "Scorch / Ignition" },
  { left: "slow", right: "freeze", label: "Slow / Freeze" },
  { left: "freeze", right: "shatter", label: "Freeze / Shatter" },
  { left: "volatile", right: "volatile-rounds", label: "Volatile / Volatile Rounds" },
  { left: "unravel", right: "unraveling-rounds", label: "Unravel / Unraveling Rounds" },
];

/**
 * Phase 8E.2 semantic guard.
 *
 * Bungie descriptions are initially tagged by text matching in the inventory
 * adapter. A tag therefore is NOT automatically evidence for the gameplay
 * mechanic it names. Reject only cases for which we have a clear contradiction
 * or missing semantic support; never manufacture new tags.
 *
 * Exported for reuse by the Recommendation Engine in the next checkpoint, so
 * both engines can eventually apply exactly the same evidence policy.
 */
export function isSupportedEffectTag(
  tag: EffectTag,
  perkName: string,
  description: string,
): boolean {
  const key = tag.key.trim().toLowerCase();
  const name = perkName.trim();
  const detail = description.trim();

  if (key === "volatile" || key === "volatile-rounds") {
    // Launcher-barrel stat perk; its name is NOT the Void debuff. This applies
    // to the normal and enhanced names, if present in the current Manifest.
    if (/\bvolatile launch\b/i.test(name)) return false;

    if (key === "volatile-rounds") {
      // Merely calling something 'volatile' is not Volatile Rounds.
      return /\bvolatile rounds\b/i.test(detail) ||
        (!detail && /^volatile rounds$/i.test(name));
    }

    // Volatile Rounds is a separate (related) effect. A lone occurrence in
    // 'volatile rounds' does not prove an additional Volatile-debuff source.
    if (/\bvolatile\b(?!\s+rounds\b)/i.test(detail)) return true;
    // A canonical one-word ability name can be meaningful without body text;
    // other perk titles alone cannot establish a gameplay mechanic.
    return !detail && /^volatile$/i.test(name);
  }

  if (key === "weapon-damage") {
    // 'bonus damage resistance' used to match the broad 'bonus damage' API
    // regex. Require text about OFFENSIVE damage and exclude following words
    // such as resistance/reduction/taken. Do not infer from a title alone.
    const offensive = [
      /\b(?:increas(?:e|es|ed|ing)|bonus|more|additional|extra|greater|boost(?:s|ed)?|improv(?:e|es|ed))\s+(?:(?:your|this|the|all|own|outgoing|weapon|weapons?|precision|melee|grenade)\s+){0,4}damage\b(?!\s+(?:resistance|reduction|taken))/i,
      /\b(?:weapon|weapons?)\s+damage\s+(?:is\s+)?(?:increas(?:ed|es|ing)|boosted)\b/i,
      /\b(?:deal|deals|dealing)\s+(?:more|increased|bonus|additional|extra|greater)\s+damage\b(?!\s+(?:resistance|reduction|taken))/i,
    ];
    // 'Targets take increased damage' describes a vulnerability on enemies,
    // not necessarily a weapon damage buff. Strip such phrases before looking
    // for independent evidence of offensive weapon bonuses.
    const offensiveText = detail.replace(
      /\b(?:targets?|enemies|combatants?)\s+(?:take|takes|receive|receives)\s+(?:more|increased|extra|additional|bonus)\s+damage\b/gi,
      "",
    );
    return offensive.some((pattern) => pattern.test(offensiveText));
  }

  // All other text-inferred tags retain their previous behaviour. Their
  // mechanic accuracy still needs dedicated validation and is not guaranteed.
  return true;
}

function certaintyFor(availability: PerkAvailability, uncertainPosition: boolean): EvidenceCertainty {
  if (uncertainPosition) return "unverified_position";
  if (availability === "possible") return "theoretical";
  return "selected";
}

function certaintyForFinding(evidence: SynergyEvidence[]): EvidenceCertainty {
  if (evidence.some((part) => part.certainty === "unverified_position")) return "unverified_position";
  if (evidence.some((part) => part.certainty === "theoretical")) return "theoretical";
  return "selected";
}

function uniqueEvidence(parts: SynergyEvidence[]): SynergyEvidence[] {
  const used = new Set<string>();
  return parts.filter((part) => {
    if (used.has(part.id)) return false;
    used.add(part.id);
    return true;
  });
}

/** Only makes findings from tag references actually present on selected perks. */
export function analyzeBuildSynergies(context: BuildContext): SynergyReport {
  const warnings: string[] = [];
  const evidence: SynergyEvidence[] = [];
  const seen = new Set<string>();
  let rejectedEvidenceCount = 0;

  function collect(
    sourceKind: SynergySourceKind,
    sourceName: string,
    sourceId: string,
    perk: ChosenPerk,
    isPreview: boolean,
    itemInstanceId: string | null,
    uncertainPosition: boolean,
  ): void {
    if (!perk.name.trim() || !Number.isFinite(perk.plugHash)) return;
    // Unlike Manifest possibilities listed as options, ChosenPerk represents
    // an effective socket selection. Possible = selected THEORY, not owned.
    for (const tag of perk.effectTags ?? []) {
      if (!tag || !tag.key?.trim() || !tag.label?.trim()) continue;
      if (tag.kind !== "buff" && tag.kind !== "debuff" && tag.kind !== "effect") continue;
      const effectKey = tag.key.trim().toLowerCase();
      if (!isSupportedEffectTag(tag, perk.name, perk.description ?? "")) {
        rejectedEvidenceCount += 1;
        continue;
      }
      const id = `${sourceKind}:${sourceId}:${perk.plugHash}:${effectKey}`;
      if (seen.has(id)) continue;
      seen.add(id);
      evidence.push({
        id, sourceKind, sourceName, perkName: perk.name,
        plugHash: perk.plugHash, description: perk.description ?? "",
        effect: { key: effectKey, label: tag.label, kind: tag.kind },
        availability: perk.availability, isPreview,
        certainty: certaintyFor(perk.availability, uncertainPosition),
        itemInstanceId,
      });
    }
  }

  const subclass = context.build.subclass;
  if (subclass) {
    const subclassTheoretical = subclass.unlockStatus === "locked" || subclass.unlockStatus === "unknown";
    for (const socket of subclass.sockets) {
      if (!socket.perk) continue;
      // Force provisional classification for all plugs on an unowned subclass,
      // even when its individual plug is marked equipped/unlocked.
      const perk = subclassTheoretical
        ? { ...socket.perk, availability: "possible" as const }
        : socket.perk;
      collect("subclass", `${subclass.name} · ${socket.slotType}`, `subclass:${subclass.itemHash}:${socket.socketIndex}`,
        perk, subclass.isPreview || socket.isPreview, null, false);
    }
  } else {
    warnings.push("Selected subclass data is missing; ability synergies cannot be evaluated.");
  }

  for (const gear of context.build.gear) {
    const kind: SynergySourceKind = gear.item.category === "armor" ? "armor" : "weapon";
    const id = gear.item.identity;
    const uncertain = gear.item.positionStatus !== "confirmed";
    if (uncertain) warnings.push(`${gear.item.name}: item position is unverified; its evidence is provisional.`);
    if (!gear.detailsLoaded) {
      warnings.push(`${gear.item.name}: detailed perk data has not been loaded.`);
      continue;
    }
    for (const perk of gear.selectedPerks ?? []) {
      collect(kind, gear.item.name, `${id}:socket`, perk, gear.isPreview, gear.item.itemInstanceId, uncertain);
    }
    for (const perk of gear.intrinsicPerks ?? []) {
      collect(kind, gear.item.name, `${id}:intrinsic`, perk, gear.isPreview, gear.item.itemInstanceId, uncertain);
    }
    // Item-set bonuses are not included as active evidence. BuildContext
    // currently knows their required count, but not whether the set activates.
  }

  const artifact = context.build.artifact;
  if (artifact.selectedPerks) {
    const uncertain = Boolean(artifact.item && artifact.item.positionStatus !== "confirmed");
    for (const perk of artifact.selectedPerks) {
      collect("artifact", artifact.name ?? "Artifact", `artifact:${artifact.item?.identity ?? "seasonal"}`,
        perk, artifact.isPreview, artifact.item?.itemInstanceId ?? null, uncertain);
    }
  } else if (artifact.name) {
    warnings.push("Artifact perk details are unavailable; Artifact interactions may be missing.");
  }

  // A tag means "the official description mentions this effect", NOT
  // "this perk grants or triggers it". The UI must keep this distinction.
  const effectMap = new Map<string, EffectCoverage>();
  for (const part of evidence) {
    const item = effectMap.get(part.effect.key);
    if (item) item.evidence.push(part);
    else effectMap.set(part.effect.key, {
      key: part.effect.key, label: part.effect.label, kind: part.effect.kind,
      sourceCount: 0, evidence: [part],
    });
  }
  const effects = Array.from(effectMap.values());
  for (const effect of effects) effect.sourceCount = effect.evidence.length;
  effects.sort((a, b) => b.sourceCount - a.sourceCount || a.label.localeCompare(b.label));

  const findings: SynergyFinding[] = [];
  for (const effect of effects) {
    // Two independent selected perks/abilities mention the same effect.
    if (effect.evidence.length < 2) continue;
    const sources = uniqueEvidence(effect.evidence);
    findings.push({
      id: `shared:${effect.key}`, kind: "shared_effect", title: `${effect.label}: shared focus`,
      explanation: `${sources.length} selected perk/ability descriptions mention ${effect.label}. This is overlapping effect coverage, not proof of additive bonuses or a verified activation loop.`,
      effectKeys: [effect.key], evidence: sources,
      certainty: certaintyForFinding(sources), mechanicVerified: false,
    });
  }
  for (const rule of RELATED_EFFECTS) {
    const left = effectMap.get(rule.left);
    const right = effectMap.get(rule.right);
    if (!left || !right) continue;
    const sources = uniqueEvidence([...left.evidence, ...right.evidence]);
    // If both tags came only from a single description, one description
    // mentions a pair; do NOT misrepresent that as cross-source synergy.
    if (new Set(sources.map((part) => `${part.sourceKind}:${part.sourceName}:${part.plugHash}`)).size < 2) continue;
    findings.push({
      id: `related:${rule.left}:${rule.right}`, kind: "related_effects",
      title: `${rule.label}: related effects`,
      explanation: `Selected descriptions mention both ${left.label} and ${right.label}. These are related Destiny effects; their actual interaction, prerequisites and activation must be checked, not assumed from tags.`,
      effectKeys: [left.key, right.key], evidence: sources,
      certainty: certaintyForFinding(sources), mechanicVerified: false,
    });
  }
  findings.sort((a, b) => Number(b.certainty === "selected") - Number(a.certainty === "selected") ||
    b.evidence.length - a.evidence.length || a.title.localeCompare(b.title));

  const detailedGear = context.build.gear.filter((gear) => gear.detailsLoaded).length;
  const missingGearDetails = context.build.gear.length - detailedGear;
  if (!context.account.complete) warnings.push("Account inventory is still partial; do not recommend account-wide alternatives yet.");
  if (context.build.gear.some((gear) => (gear.setBonuses ?? []).length > 0))
    warnings.push("Armor set bonus requirements are known, but activation has not been verified and is excluded from findings.");
  if (rejectedEvidenceCount > 0) {
    warnings.push(`${rejectedEvidenceCount} inferred effect tag(s) excluded: their perk descriptions do not support the claimed mechanic.`);
  }
  // Keep original adapter warnings for transparent diagnostics.
  warnings.push(...context.warnings);

  const theory = Boolean(subclass?.theoretical ||
    evidence.some((part) => part.certainty === "theoretical"));
  const partial = !subclass || missingGearDetails > 0 || !context.account.complete ||
    (Boolean(artifact.name) && artifact.selectedPerks === null) ||
    warnings.some((w) => w.includes("unverified"));

  return {
    version: 1, guardianId: context.guardian.characterId,
    activity: context.activity, mode: context.mode,
    status: theory ? "theoretical" : partial ? "partial" : "ready",
    effects, findings,
    coverage: {
      selectedGear: context.build.gear.length, detailedGear,
      missingGearDetails, artifactDetailsAvailable: artifact.selectedPerks !== null,
      accountComplete: context.account.complete,
      evidenceSources: evidence.length,
    },
    warnings: Array.from(new Set(warnings)),
  };
}
