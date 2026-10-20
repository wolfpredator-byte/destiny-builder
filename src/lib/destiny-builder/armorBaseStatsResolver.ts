/**
 * Destiny Builder — Engine-B0.3c: conservative Armor 3.0 base-component resolver.
 *
 * PURE, read-only and evidence-only. No Bungie API calls, writes, lookups or
 * configuration changes. Consumes the `armorStatEvidence` returned by B0.1.
 *
 * A numerically reconciled base-component candidate is NOT yet a guarantee
 * that every Armor 3.0 modifier type (masterwork, subclass, set bonuses, etc.)
 * has been modeled. Do not present this as a certified final Guardian stat distribution
 * or feed it into the existing optimizer without a separate validation phase.
 */

export const ARMOR_3_STAT_IDS = [
  2996146975, // Weapons
  392767087, // Health
  1943323491, // Class
  1735777505, // Grenade
  144602215, // Super
  4244567218, // Melee
] as const;

const ARMOR_HASH_SET = new Set<number>(ARMOR_3_STAT_IDS);
export const STAT_NAMES: Record<number, string> = {
  2996146975: "Weapons",
  392767087: "Health",
  1943323491: "Class",
  1735777505: "Grenade",
  144602215: "Super",
  4244567218: "Melee",
};

export interface ArmorStatInput {
  statHash: number;
  value: number;
  name?: string;
}

export interface DeclaredStatContribution {
  statHash: number;
  value: number;
  isConditionallyActive?: boolean | null;
}

export interface ArmorEvidenceSocket {
  socketIndex: number;
  selectedPlugHash: number | null;
  plugDefinitionResolved: boolean;
  plugName: string | null;
  plugCategoryIdentifier: string | null;
  declaredInvestmentStats: readonly DeclaredStatContribution[] | null;
  isEnabled: boolean | null;
  isVisible: boolean | null;
}

/** Shape from the B0.1 detail response. The baseStats field is not trusted. */
export interface ArmorStatEvidenceV1 {
  schemaVersion: number;
  observedStatsSource: string;
  presentStatHashes: readonly number[];
  missingStatHashes: readonly number[];
  invalidStatHashes: readonly number[];
  complete: boolean;
  baseStats?: unknown;
  baseStatsStatus?: string;
  itemDefinitionInvestmentStats: readonly DeclaredStatContribution[] | null;
  socketCountFromManifest: number;
  configuredSockets: readonly ArmorEvidenceSocket[];
  modifierContributionStatus?: string;
}

export interface ArmorResolverInput {
  armorStats?: readonly ArmorStatInput[] | null;
  armorStatTotal?: number | null;
  armorStatEvidence?: ArmorStatEvidenceV1 | null;
}

export type ArmorBaseResolutionStatus =
  | "reconciled_roll_candidate"
  | "insufficient_evidence"
  | "unreconciled";

export interface ArmorResolvedStat {
  statHash: number;
  name: string;
  value: number;
}

export interface ArmorResolvedModifier {
  socketIndex: number;
  selectedPlugHash: number;
  name: string;
  kind: "stat_mod" | "tuning";
  /** Observed-build contribution supported by the selected plug. For Balanced
   * Tuning this is the three-stat +1 effect derived from Bungie's documented
   * lowest-three rule, NOT the six conditional Manifest candidates. */
  contributions: ArmorResolvedStat[];
  /** Only the explicit six-conditional +1 Balanced Tuning plug uses this rule. */
  rule?: "balanced_lowest_three";
}

export interface ArmorStatMismatch {
  statHash: number;
  name: string;
  observed: number;
  expected: number;
}

export interface ArmorBaseResolution {
  version: 1;
  status: ArmorBaseResolutionStatus;
  /** Base *candidate* from item-definition stats and selected armor_stats/
   * intrinsics plugs, prior to configured stat mods and tuning. */
  rollStats: ArmorResolvedStat[] | null;
  /** Component provenance. Populated ONLY for a fully reconciled candidate. */
  baseComponents: {
    itemDefinition: ArmorResolvedStat[];
    armorStatsPlugs: ArmorResolvedStat[];
    intrinsicPlugs: ArmorResolvedStat[];
  } | null;
  observedStats: ArmorResolvedStat[] | null;
  rollTotal: number | null;
  observedTotal: number | null;
  modifiers: ArmorResolvedModifier[];
  mismatches: ArmorStatMismatch[];
  /** Deliberately false until independently validated on different armor cases. */
  certifiedForOptimization: false;
  reasons: string[];
}

function validInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function emptyVector(): Map<number, number> {
  return new Map<number, number>(ARMOR_3_STAT_IDS.map((id) => [id, 0]));
}

function toStats(values: ReadonlyMap<number, number>): ArmorResolvedStat[] {
  return ARMOR_3_STAT_IDS.map((statHash) => ({
    statHash, name: STAT_NAMES[statHash], value: values.get(statHash) ?? 0,
  }));
}

function addVector(target: Map<number, number>, contributions: readonly ArmorResolvedStat[]): boolean {
  for (const s of contributions) {
    const sum = (target.get(s.statHash) ?? 0) + s.value;
    if (!Number.isSafeInteger(sum)) return false;
    target.set(s.statHash, sum);
  }
  return true;
}

/**
 * Analyze a B0.1 scope=detail item. No fallback to definition base stats,
 * item-level observed stats, or guessed modifier effect is ever performed.
 *
 * `rollStats` is returned only if the entire observed six-stat vector
 * reconciles exactly against verified static item-definition contributions,
 * selected armor_stats/intrinsics plugs, and supported installed modifiers. This is a candidate for cross-item validation, not a certified roll.
 */
export function resolveArmorBaseStats(input: ArmorResolverInput): ArmorBaseResolution {
  const out: ArmorBaseResolution = {
    version: 1, status: "insufficient_evidence", rollStats: null, baseComponents: null,
    observedStats: null, rollTotal: null, observedTotal: null,
    modifiers: [], mismatches: [], certifiedForOptimization: false, reasons: [],
  };
  const fail = (reason: string, status: ArmorBaseResolutionStatus = "insufficient_evidence") => {
    out.status = status;
    out.rollStats = null;
    out.baseComponents = null;
    out.rollTotal = null;
    out.reasons.push(reason);
    return out;
  };

  const evidence = input.armorStatEvidence;
  if (!evidence || evidence.schemaVersion !== 1 ||
      evidence.observedStatsSource !== "bungie_item_stats_component") {
    return fail("No supported B0.1 Bungie item-stat evidence is available.");
  }
  if (!Array.isArray(input.armorStats)) return fail("Observed armorStats are missing.");
  const observed = new Map<number, number>();
  for (const s of input.armorStats) {
    if (!s || !ARMOR_HASH_SET.has(s.statHash)) continue;
    if (!validInt(s.value) || observed.has(s.statHash)) {
      return fail(`Observed stat ${s.statHash} is duplicated or malformed.`);
    }
    observed.set(s.statHash, s.value);
  }
  if (observed.size !== ARMOR_3_STAT_IDS.length || !evidence.complete ||
      !Array.isArray(evidence.presentStatHashes) ||
      !Array.isArray(evidence.missingStatHashes) || evidence.missingStatHashes.length ||
      !Array.isArray(evidence.invalidStatHashes) || evidence.invalidStatHashes.length ||
      new Set(evidence.presentStatHashes).size !== ARMOR_3_STAT_IDS.length ||
      evidence.presentStatHashes.some((hash) => !observed.has(hash))) {
    return fail("All six actual Bungie stats must be present, unique, and valid; evidence must agree.");
  }
  out.observedStats = toStats(observed);
  out.observedTotal = [...observed.values()].reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(out.observedTotal) ||
      (input.armorStatTotal != null && input.armorStatTotal !== out.observedTotal)) {
    return fail("The observed armorStatTotal does not match its six-component vector.");
  }
  // Item-definition static investments are separate from roll plugs. We only
  // accept observed Armor 3.0 hashes and unconditional nonnegative integers.
  // No value is inferred from a name, tooltip, or unselected plug.
  if (!Array.isArray(evidence.itemDefinitionInvestmentStats)) {
    return fail("Item-definition investmentStats are missing.");
  }
  const definition = emptyVector();
  const validateBaseEntries = (entries: readonly DeclaredStatContribution[], source: string): ArmorResolvedStat[] | null => {
    const converted: ArmorResolvedStat[] = [];
    const seen = new Set<number>();
    for (const entry of entries) {
      if (!entry || !ARMOR_HASH_SET.has(entry.statHash) || seen.has(entry.statHash) ||
          !validInt(entry.value) || entry.value < 0 || entry.isConditionallyActive !== false) {
        out.reasons.push(`${source} contains duplicate, unsupported, conditional or malformed base stats.`);
        return null;
      }
      seen.add(entry.statHash);
      converted.push({statHash: entry.statHash, name: STAT_NAMES[entry.statHash], value: entry.value});
    }
    return converted;
  };
  const definitionEntries = validateBaseEntries(evidence.itemDefinitionInvestmentStats, "Item definition");
  if (!definitionEntries || !addVector(definition, definitionEntries)) {
    return fail("Item-definition base contributions cannot be verified.");
  }
  if (!Array.isArray(evidence.configuredSockets) ||
      !validInt(evidence.socketCountFromManifest) ||
      evidence.socketCountFromManifest !== evidence.configuredSockets.length) {
    return fail("Manifest and observed socket counts are incomplete or inconsistent.");
  }

  const roll = emptyVector();
  const intrinsics = emptyVector();
  const declaredMods = emptyVector();
  const seenSockets = new Set<number>();
  let basePlugs = 0;
  let nonStatIntrinsicPlugs = 0;
  let balanced: {socketIndex: number; selectedPlugHash: number; name: string} | null = null;
  for (const socket of evidence.configuredSockets) {
    if (!socket || !validInt(socket.socketIndex) || socket.socketIndex < 0 ||
        socket.socketIndex >= evidence.socketCountFromManifest ||
        seenSockets.has(socket.socketIndex)) {
      return fail("Socket identities are missing or duplicated.");
    }
    seenSockets.add(socket.socketIndex);
    if (socket.isEnabled === false) continue;
    if (socket.isEnabled !== true) return fail(`Socket ${socket.socketIndex} has unknown enabled state.`);
    if (socket.selectedPlugHash == null) continue; // Verified empty live socket.
    if (!validInt(socket.selectedPlugHash) || socket.selectedPlugHash <= 0 ||
        !socket.plugDefinitionResolved ||
        !Array.isArray(socket.declaredInvestmentStats)) {
      return fail(`Enabled socket ${socket.socketIndex} has unresolved contribution data.`);
    }
    const category = socket.plugCategoryIdentifier;
    if (typeof category !== "string" || !category.trim()) {
      return fail(`Enabled socket ${socket.socketIndex} lacks a recognized category.`);
    }

    // One precisely identified conditional plug is supported. Bungie's
    // Balanced Tuning applies +1 to the three LOWEST stats, not all six.
    // The Manifest lists six conditional alternatives. Never add them all.
    if (socket.selectedPlugHash === 3122197216 &&
        category === "core.gear_systems.armor_tiering.plugs.tuning.mods") {
      if (balanced !== null) return fail("Multiple Balanced Tuning plugs cannot be evaluated safely.");
      const entries: readonly DeclaredStatContribution[] = socket.declaredInvestmentStats;
      if (entries.length !== 6 || new Set(entries.map((s) => s.statHash)).size !== 6 ||
          entries.some((s) => !s || !ARMOR_HASH_SET.has(s.statHash) ||
            s.value !== 1 || s.isConditionallyActive !== true)) {
        return fail(`Balanced Tuning socket ${socket.socketIndex} has unexpected Manifest evidence.`);
      }
      balanced = {socketIndex: socket.socketIndex, selectedPlugHash: socket.selectedPlugHash,
        name: socket.plugName?.trim() || "Balanced Tuning"};
      continue;
    }

    const investments: ArmorResolvedStat[] = [];
    const seenStats = new Set<number>();
    for (const entry of socket.declaredInvestmentStats) {
      if (!entry || !ARMOR_HASH_SET.has(entry.statHash) || seenStats.has(entry.statHash) ||
          !validInt(entry.value) || entry.isConditionallyActive !== false) {
        return fail(`Socket ${socket.socketIndex} has unknown, conditional, duplicated or malformed stat effects.`);
      }
      seenStats.add(entry.statHash);
      investments.push({statHash: entry.statHash, name: STAT_NAMES[entry.statHash], value: entry.value});
    }
    if (category === "armor_stats" || category === "intrinsics") {
      // An intrinsic perk such as Conduction Tines, Scatter Charge or Helium
      // Spirals may have no declared Armor 3.0 investmentStats. When Bungie
      // resolves its selected plug and explicitly returns an empty array,
      // it contributes no *declared numeric armor stats*. It is NOT a roll
      // component and does not imply the intrinsic has no gameplay effect.
      // Missing/unresolved contribution data has already been rejected above.
      if (category === "intrinsics" && investments.length === 0) {
        nonStatIntrinsicPlugs += 1;
        continue;
      }
      // In contrast, an armor_stats plug with no numeric contribution is
      // incomplete evidence and must never be silently accepted.
      if (!investments.length || investments.some((entry) => entry.value < 0)) {
        return fail(`Base socket ${socket.socketIndex} lacks nonnegative stat contributions.`);
      }
      if (!addVector(category === "armor_stats" ? roll : intrinsics, investments)) {
        return fail("Intrinsic base-stat addition overflowed.");
      }
      basePlugs += 1;
    } else if (category === "enhancements.v2_general" ||
               category === "core.gear_systems.armor_tiering.plugs.tuning.mods") {
      if (!addVector(declaredMods, investments)) return fail("Modifier-stat addition overflowed.");
      if (investments.length) {
        out.modifiers.push({
          socketIndex: socket.socketIndex, selectedPlugHash: socket.selectedPlugHash,
          name: socket.plugName?.trim() || `Plug ${socket.selectedPlugHash}`,
          kind: category === "enhancements.v2_general" ? "stat_mod" : "tuning",
          contributions: investments,
        });
      }
    } else if (investments.length) {
      return fail(`Unsupported stat-producing category at socket ${socket.socketIndex}: ${category}.`);
    }
    // Non-stat plugs with no declared Armor 3.0 investmentStats are ignored.
  }
  if (seenSockets.size !== evidence.socketCountFromManifest || basePlugs === 0) {
    return fail("A full socket snapshot and at least one selected armor_stats/intrinsics base plug are required.");
  }
  const base = emptyVector();
  const expected = emptyVector();
  if (!addVector(base, toStats(definition)) || !addVector(base, toStats(roll)) ||
      !addVector(base, toStats(intrinsics)) ||
      !addVector(expected, toStats(base)) || !addVector(expected, toStats(declaredMods))) {
    return fail("Calculated armor stat totals overflowed.");
  }

  if (balanced) {
    // Evaluate AFTER explicit static stat mods and the base roll. A tie at
    // the third/fourth position cannot be disambiguated without additional
    // game-specific order rules, so we reject rather than guess.
    const ranking = ARMOR_3_STAT_IDS.map((statHash) => ({statHash, value: expected.get(statHash)!}))
      .sort((a, b) => a.value - b.value || a.statHash - b.statHash);
    if (ranking[2].value === ranking[3].value) {
      return fail("Balanced Tuning's third-lowest stat is tied: its three destinations cannot be independently verified.");
    }
    const contribution = ranking.slice(0, 3).map(({statHash}) =>
      ({statHash, name: STAT_NAMES[statHash], value: 1}));
    if (!addVector(expected, contribution)) return fail("Balanced Tuning calculation overflowed.");
    out.modifiers.push({
      socketIndex: balanced.socketIndex, selectedPlugHash: balanced.selectedPlugHash,
      name: balanced.name, kind: "tuning", rule: "balanced_lowest_three",
      contributions: contribution,
    });
  }
  out.mismatches = ARMOR_3_STAT_IDS.flatMap((statHash) => {
    const received = observed.get(statHash)!;
    const calculated = expected.get(statHash)!;
    return received === calculated ? [] : [{
      statHash, name: STAT_NAMES[statHash], observed: received, expected: calculated,
    }];
  });
  if (out.mismatches.length) {
    return fail("The installed modifiers and intrinsic roll plugs do not reproduce all six observed stats.", "unreconciled");
  }
  out.rollStats = toStats(base);
  out.baseComponents = {
    itemDefinition: toStats(definition),
    armorStatsPlugs: toStats(roll),
    intrinsicPlugs: toStats(intrinsics),
  };
  out.rollTotal = out.rollStats.reduce((sum, stat) => sum + stat.value, 0);
  out.status = "reconciled_roll_candidate";
  out.reasons.push("Six Bungie observed stats exactly match the static item-definition/selected base plugs and modeled installed stat mods/tuning.");
  if (balanced) out.reasons.push("Balanced Tuning applied +1 to the unique three lowest pre-tuning stats, per Bungie's published Armor 3.0 rule.");
  if (basePlugs > 0) out.reasons.push("The candidate includes armor_stats/intrinsics base components only from selected, resolved plugs.");
  if (nonStatIntrinsicPlugs > 0) out.reasons.push(`${nonStatIntrinsicPlugs} resolved intrinsic perk(s) declared no Armor 3.0 stat contributions; their gameplay effects were not evaluated.`);
  out.reasons.push("Evidence-only candidate: unmodeled implicit effects and other armor cases still require separate checks before optimizer use.");
  return out;
}
