"use client";

/**
 * Destiny Builder — Engine-B0.3a focused blocker-evidence diagnostic harness.
 * NEW independent page. Pure read-only browser requests, explicit user triggers.
 * Never equips/transfers/dismantles; never calls OpenAI or saves a Builder Preview.
 * A reconciled roll is a candidate, NOT optimizer-certified.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ARMOR_3_STAT_IDS,
  resolveArmorBaseStats,
  type ArmorBaseResolution,
  type ArmorResolverInput,
  type ArmorStatEvidenceV1,
} from "@/lib/destiny-builder/armorBaseStatsResolver";
import type { InventoryItem } from "@/lib/destiny-builder/buildContext";
import { assessArmorModifierAvailability } from "@/lib/destiny-builder/armorModifierAvailability";

type Source = "equipaggiata" | "inventario" | "deposito" | "altro Guardian";
type Tier = "Esotica" | "Leggendaria" | "Non verificata";
type SourceItem = InventoryItem & { tierTypeName?: string | null };
type Candidate = { item: SourceItem; source: Source; tier: Tier; slot: number };
type Row = {
  candidate: Candidate;
  detailTier: Tier;
  resolution: ArmorBaseResolution | null;
  blockerEvidence: BlockerEvidence | null;
  modifierAvailability: ReturnType<typeof summarizeModifierAvailability>;
  availabilityAssessment: ReturnType<typeof summarizeAvailabilityAssessment>;
  sharedPlugSetAssessment: ReturnType<typeof summarizeSharedPlugSets>;
  error: string | null;
};
type Snapshot = { equipment: SourceItem[]; inventory: SourceItem[]; vault: SourceItem[]; otherGuardianItems: SourceItem[] };
type ApiPayload = Record<string, unknown> & { success?: boolean; error?: string };

/** Deliberately excludes item/character/membership IDs and the raw API payload.
 * Static plug hashes are PUBLIC Bungie definition identifiers, not personal IDs.
 * The values remain untrusted *declarations*: NEVER apply them as actual buffs here.
 */
type BlockerEvidence = {
  itemDefinitionInvestmentStats: ArmorStatEvidenceV1["itemDefinitionInvestmentStats"];
  definitionInvestmentStatsState: "missing" | "empty" | "nonempty";
  socketCountFromManifest: number;
  blockingSocketIndices: number[];
  selectedStatRelatedSockets: Array<{
    socketIndex: number;
    selectedPlugHash: number | null;
    plugName: string | null;
    plugCategoryIdentifier: string | null;
    plugDefinitionResolved: boolean;
    isEnabled: boolean | null;
    isVisible: boolean | null;
    declaredInvestmentStats: ArmorStatEvidenceV1["configuredSockets"][number]["declaredInvestmentStats"];
  }>;
};

/** Engine-B0.5b1: compact, sanitized availability evidence from scope=detail.
 * Public Manifest plug hashes are safe; NEVER copy instance/account IDs.
 * A "live_can_insert" signal does not prove a complete legal configuration.
 */
function summarizeModifierAvailability(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const evidence = raw as Record<string, unknown>;
  if (evidence.schemaVersion !== 1 || !Array.isArray(evidence.sockets)) return null;
  const states = ["selected", "live_can_insert", "live_cannot_insert", "live_status_unknown", "manifest_only"] as const;
  const stateSet = new Set<string>(states);
  const sockets = evidence.sockets.map((rawSocket: unknown) => {
    if (!rawSocket || typeof rawSocket !== "object") return null;
    const socket = rawSocket as Record<string, unknown>;
    if (!Number.isSafeInteger(socket.socketIndex) || !Array.isArray(socket.options)) return null;
    const options = socket.options.filter((option: unknown): option is Record<string, unknown> =>
      !!option && typeof option === "object" &&
      Number.isSafeInteger((option as Record<string, unknown>).plugHash));
    const statusCounts = Object.fromEntries(states.map((state) => [state,
      options.filter((option) => option.evidenceState === state).length])) as Record<typeof states[number], number>;
    const priority: Record<typeof states[number], number> = {
      selected: 0, live_can_insert: 1, live_cannot_insert: 2,
      live_status_unknown: 3, manifest_only: 4,
    };
    const sorted = [...options].sort((a, b) => {
      const stateA = typeof a.evidenceState === "string" && stateSet.has(a.evidenceState)
        ? a.evidenceState as typeof states[number] : "manifest_only";
      const stateB = typeof b.evidenceState === "string" && stateSet.has(b.evidenceState)
        ? b.evidenceState as typeof states[number] : "manifest_only";
      return priority[stateA] - priority[stateB];
    });
    // Diagnostic sample, NOT the complete availability catalog. Count all,
    // disclose the truncation, and never use this projection for equipping.
    const sample = sorted.slice(0, 12).map((option) => ({
      plugHash: option.plugHash,
      name: typeof option.name === "string" ? option.name : null,
      category: typeof option.plugCategoryIdentifier === "string" ? option.plugCategoryIdentifier : null,
      evidenceState: option.evidenceState,
      sources: Array.isArray(option.sources) ? option.sources : [],
      liveCanInsert: typeof option.liveCanInsert === "boolean" ? option.liveCanInsert : null,
      liveEnabled: typeof option.liveEnabled === "boolean" ? option.liveEnabled : null,
      plugDefinitionResolved: option.plugDefinitionResolved === true,
      declaredInvestmentStats: option.declaredInvestmentStats ?? null,
      declaredEnergyCost: option.declaredEnergyCost ?? null,
    }));
    // B0.5b4: report Bungie's socket PlugSources flags. These are SOURCE
    // DECLARATIONS, not live insertion approvals. No additional Bungie calls.
    const plugSources = typeof socket.plugSources === "number" &&
      Number.isSafeInteger(socket.plugSources) && socket.plugSources >= 0
      ? socket.plugSources : null;
    const sourceKinds = plugSources === null ? ["unknown"] : [
      ...(plugSources & 1 ? ["inventory_sourced"] : []),
      ...(plugSources & 2 ? ["item_reusable"] : []),
      ...(plugSources & 4 ? ["profile_plug_set"] : []),
      ...(plugSources & 8 ? ["character_plug_set"] : []),
      ...(plugSources & ~15 ? ["unrecognized_flags"] : []),
      ...(!plugSources ? ["none_declared"] : []),
    ];
    return {
      socketIndex: socket.socketIndex,
      socketTypeHash: typeof socket.socketTypeHash === "number" &&
        Number.isSafeInteger(socket.socketTypeHash) && socket.socketTypeHash > 0
        ? socket.socketTypeHash : null,
      plugSources, sourceKinds,
      manifestReusablePlugSetPresent: socket.manifestReusablePlugSetPresent === true,
      manifestRandomizedPlugSetPresent: socket.manifestRandomizedPlugSetPresent === true,
      liveSocketEnabled: typeof socket.liveSocketEnabled === "boolean" ? socket.liveSocketEnabled : null,
      liveReusableDataPresent: socket.liveReusableDataPresent === true,
      selectedPlugHash: typeof socket.selectedPlugHash === "number" ? socket.selectedPlugHash : null,
      optionsCount: options.length,
      statusCounts,
      sample,
      sampleTruncated: options.length > sample.length,
    };
  }).filter((socket) => socket !== null);
  return {
    schemaVersion: 1,
    source: typeof evidence.source === "string" ? evidence.source : "unknown",
    installabilityVerified: false as const,
    socketCountFromManifest: evidence.socketCountFromManifest,
    socketCountFromLive: evidence.socketCountFromLive,
    itemEnergyEvidence: evidence.itemEnergyEvidence ?? null,
    sockets,
    note: "Diagnostic samples only; live canInsert does not verify total configuration cost, socket rules or upgrade requirements.",
  };
}

/** Engine-B0.5b6: use the COMPLETE B0.5b1 item evidence and the matching
 * B0.5b5 core shared evidence through the conservative availability model.
 * The model owns conflict resolution. No UI-side promotion or Bungie writes.
 * Only public Manifest hashes and aggregate counts enter this summary.
 */
function summarizeAvailabilityAssessment(raw: unknown, sharedCoreEvidence: unknown) {
  if (!raw) return null;
  const assessed = assessArmorModifierAvailability(raw, sharedCoreEvidence);
  const summary = assessed.summary;
  const sockets = assessed.sockets.map((socket) => {
    const counts = {
      installed: 0, live_candidate: 0, live_blocked: 0,
      manifest_candidate: 0, unknown: 0,
    };
    let mathReady = 0;
    let mathReadyLive = 0;
    let unknownEffect = 0;
    let sharedPositive = 0;
    let sharedConflict = 0;
    let sharedIncomplete = 0;
    let sharedLiveCandidates = 0;
    // Evaluate the COMPLETE socket, not its sampled display options.
    const whitelistCounts = { allowed: 0, excluded: 0, unknown: 0 };
    let whitelistLiveConflicts = 0;
    for (const opt of socket.options) {
      whitelistCounts[opt.socketWhitelistCheck]++;
      // The Availability model emits this reason only when an initially live
      // candidate is downgraded due to contradictory Manifest whitelist data.
      if (opt.reasons.includes("Contradictory live candidate and Manifest category exclusion.")) {
        whitelistLiveConflicts++;
      }
      counts[opt.availability]++;
      if (opt.simulationMode !== "not_supported") {
        mathReady++;
        if (opt.availability === "live_candidate") mathReadyLive++;
      }
      if (opt.effectKind === "unknown_effect") unknownEffect++;
      if (opt.sharedSignal.state === "positive") sharedPositive++;
      if (opt.sharedSignal.state === "conflict") sharedConflict++;
      if (opt.sharedSignal.state === "incomplete") sharedIncomplete++;
      // Avoid double-counting item-reusable signals as shared-derived candidates.
      if (opt.availability === "live_candidate" && opt.sharedSignal.state === "positive" &&
          !opt.evidenceSources.includes("live_item_reusable")) sharedLiveCandidates++;
    }
    // Small representative examples, NOT a substitute for the complete source.
    const sample = (["installed", "live_candidate", "live_blocked", "manifest_candidate", "unknown"] as const)
      .flatMap((status) => socket.options.filter((o) => o.availability === status)
        .slice(0, status === "installed" ? 1 : 2)
        .map((o) => ({
          plugHash: o.plugHash, name: o.name, availability: o.availability,
          effectKind: o.effectKind, simulationMode: o.simulationMode,
          declaredEnergyCost: o.declaredEnergyCost,
          sharedSignal: o.sharedSignal, // public set hashes, no private IDs
          reasons: o.reasons,
        })));
    // B0.5c3d2c: limited audit examples, prioritized independently from
    // availability samples so excluded categories cannot be hidden by truncation.
    const whitelistExamples = (["excluded", "unknown", "allowed"] as const)
      .flatMap((check) => socket.options.filter((o) => o.socketWhitelistCheck === check)
        .sort((a, b) => Number(b.reasons.includes("Contradictory live candidate and Manifest category exclusion.")) -
                        Number(a.reasons.includes("Contradictory live candidate and Manifest category exclusion.")))
        .slice(0, 2)
        .map((o) => ({
          plugHash: o.plugHash, name: o.name, plugCategoryHash: o.plugCategoryHash ?? null,
          whitelistCheck: o.socketWhitelistCheck, availability: o.availability,
          liveConflict: o.reasons.includes("Contradictory live candidate and Manifest category exclusion."),
        })));
    return {
      socketIndex: socket.socketIndex,
      category: socket.category,
      socketWhitelistEvidenceState: socket.socketWhitelistEvidenceState,
      // null means missing/invalid; 0 explicitly means a verified allow-all rule.
      socketWhitelistCategoryCount: socket.socketWhitelistCategoryHashes?.length ?? null,
      socketWhitelistAllowAll: socket.socketWhitelistEvidenceState === "verified" &&
        socket.socketWhitelistCategoryHashes?.length === 0,
      whitelistCounts, whitelistLiveConflicts, whitelistExamples,
      liveSocketPresent: socket.liveSocketPresent,
      liveSocketEnabled: socket.liveSocketEnabled,
      liveReusableDataPresent: socket.liveReusableDataPresent,
      sharedReferencedSetCount: socket.sharedReferencedSetCount,
      sharedMatchedSetCount: socket.sharedMatchedSetCount,
      sharedComponentIncomplete: socket.sharedComponentIncomplete,
      sharedPositive, sharedConflict, sharedIncomplete, sharedLiveCandidates,
      totalOptions: socket.options.length,
      counts, mathReady, mathReadyLive, unknownEffect,
      sample, sampleTruncated: socket.options.length > sample.length,
      note: socket.note,
    };
  });
  return {
    schemaVersion: 1 as const,
    source: "B0.5b6_item_plus_shared_assessment" as const,
    validEvidence: assessed.validEvidence,
    installabilityVerified: false as const,
    reason: assessed.reason,
    sharedEvidenceState: assessed.sharedEvidenceState,
    sharedEvidenceReason: assessed.sharedEvidenceReason,
    energyEvidence: assessed.energyEvidence,
    summary,
    mathReadyLiveCandidates: sockets.reduce((sum, socket) => sum + socket.mathReadyLive, 0),
    whitelistSummary: {
      verifiedSockets: sockets.filter((s) => s.socketWhitelistEvidenceState === "verified").length,
      missingSockets: sockets.filter((s) => s.socketWhitelistEvidenceState === "missing").length,
      invalidSockets: sockets.filter((s) => s.socketWhitelistEvidenceState === "invalid").length,
      allowed: sockets.reduce((sum, s) => sum + s.whitelistCounts.allowed, 0),
      excluded: sockets.reduce((sum, s) => sum + s.whitelistCounts.excluded, 0),
      unknown: sockets.reduce((sum, s) => sum + s.whitelistCounts.unknown, 0),
      liveConflicts: sockets.reduce((sum, s) => sum + s.whitelistLiveConflicts, 0),
    },
    sharedLiveCandidates: sockets.reduce((sum, socket) => sum + socket.sharedLiveCandidates, 0),
    sharedConflicts: sockets.reduce((sum, socket) => sum + socket.sharedConflict, 0),
    sockets,
    note: "Shared Profile/Character PlugSets refer to the requested Guardian, even for Vault armor. Live candidates are not certified installs.",
  };
}

/** Engine-B0.5b5. Join *exact public Manifest set hashes* between an item
 * detail and the existing scope=core GetProfile component. No network calls.
 * Per-character evidence refers to the currently selected Guardian, including
 * when evaluating a Vault item. Shared plugs are not installation approvals.
 */
function summarizeSharedPlugSets(itemEvidence: unknown, coreEvidence: unknown) {
  const obj = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  const hash = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) &&
      value > 0 && value <= 0xffffffff ? value : null;
  const item = obj(itemEvidence);
  const shared = obj(coreEvidence);
  if (!item || item.schemaVersion !== 1 || !Array.isArray(item.sockets) ||
      !shared || shared.schemaVersion !== 1 ||
      shared.source !== "bungie_profile_item_sockets_shared_plug_sets" ||
      shared.readOnly !== true || shared.scopedToRequestedGuardian !== true ||
      !Array.isArray(shared.sets)) return null;
  const setMap = new Map<number, Record<string, unknown>>();
  for (const raw of shared.sets) {
    const record = obj(raw);
    const id = hash(record?.setHash);
    if (record && id !== null && !setMap.has(id)) setMap.set(id, record);
  }
  const sockets = item.sockets.flatMap((rawSocket: unknown) => {
    const socket = obj(rawSocket);
    if (!socket || typeof socket.socketIndex !== "number" ||
        !Number.isSafeInteger(socket.socketIndex) || !Array.isArray(socket.options)) return [];
    const flags = typeof socket.plugSources === "number" &&
      Number.isSafeInteger(socket.plugSources) ? socket.plugSources : 0;
    if (!(flags & 12)) return [];
    const hashes = [...new Set([hash(socket.reusablePlugSetHash),
      hash(socket.randomizedPlugSetHash)].filter((v): v is number => v !== null))];
    const catalog = new Set<number>();
    for (const option of socket.options) {
      const id = hash(obj(option)?.plugHash);
      if (id !== null) catalog.add(id);
    }
    const profile = new Map<number, { canInsert: boolean | null; enabled: boolean | null }>();
    const character = new Map<number, { canInsert: boolean | null; enabled: boolean | null }>();
    let matchedSets = 0;
    let profileSetMatches = 0;
    let characterSetMatches = 0;
    for (const id of hashes) {
      const set = setMap.get(id);
      if (!set) continue;
      matchedSets++;
      if (set.profileSetPresent === true) profileSetMatches++;
      if (set.characterSetPresent === true) characterSetMatches++;
      for (const [field, target] of [["profilePlugs", profile], ["characterPlugs", character]] as const) {
        const plugs = set[field];
        if (!Array.isArray(plugs)) continue;
        for (const rawPlug of plugs) {
          const plug = obj(rawPlug);
          const plugHash = hash(plug?.plugHash);
          if (plugHash === null) continue;
          const canInsert = typeof plug?.canInsert === "boolean" ? plug.canInsert : null;
          const enabled = typeof plug?.enabled === "boolean" ? plug.enabled : null;
          // Preserve negative and unknown evidence if any duplicated set entry
          // disagrees. Never turn a conflict into an approval.
          const previous = target.get(plugHash);
          target.set(plugHash, {
            canInsert: previous && previous.canInsert !== canInsert ? null : canInsert,
            enabled: previous && previous.enabled !== enabled ? null : enabled,
          });
        }
      }
    }
    const approvedSignal = (value: { canInsert: boolean | null; enabled: boolean | null }) =>
      value.canInsert === true && value.enabled === true;
    const both = new Set([...profile.keys(), ...character.keys()]);
    const signalHashes = [...both].filter((id) =>
      (profile.has(id) && approvedSignal(profile.get(id)!)) ||
      (character.has(id) && approvedSignal(character.get(id)!)));
    return [{
      socketIndex: socket.socketIndex,
      plugSources: flags,
      setReferences: hashes.length,
      matchedSets,
      profileSetMatches,
      characterSetMatches,
      profileOptions: profile.size,
      characterOptions: character.size,
      uniqueOptions: both.size,
      withTrueLiveSignal: signalHashes.length,
      inManifestCatalog: signalHashes.filter((id) => catalog.has(id)).length,
      outsideManifestCatalog: signalHashes.filter((id) => !catalog.has(id)).length,
      examples: signalHashes.slice(0, 4),
      missingSharedComponent: (flags & 4 ? shared.profileComponentPresent !== true : false) ||
        (flags & 8 ? shared.characterComponentPresent !== true : false),
    }];
  });
  return {
    source: "B0.5b5_core_shared_plug_sets_join" as const,
    installabilityVerified: false as const,
    sharedDataFor: "requested_guardian_not_necessarily_item_owner" as const,
    sockets,
    note: "Profile/character shared PlugSet canInsert and enabled are live clues only. Socket restrictions, unlocks, energy and inventory-sourced plugs remain unverified.",
  };
}

function collectBlockerEvidence(
  input: ArmorResolverInput, result: ArmorBaseResolution,
): BlockerEvidence | null {
  if (result.status === "reconciled_roll_candidate") return null;
  const evidence = input.armorStatEvidence;
  if (!evidence || evidence.schemaVersion !== 1 || !Array.isArray(evidence.configuredSockets)) return null;
  const blocked = new Set<number>();
  for (const reason of result.reasons) {
    for (const match of reason.matchAll(/\bsocket\s+(\d+)\b/gi)) {
      const index = Number(match[1]);
      if (Number.isSafeInteger(index) && index >= 0) blocked.add(index);
    }
  }
  const relevant = evidence.configuredSockets.filter((socket) => {
    const category = socket.plugCategoryIdentifier;
    const isBaseRoll = category === "armor_stats";
    const isNumericMod = category === "enhancements.v2_general" ||
      category === "core.gear_systems.armor_tiering.plugs.tuning.mods";
    const hasDeclaredValues = Array.isArray(socket.declaredInvestmentStats) && socket.declaredInvestmentStats.length > 0;
    const unresolvedSelectedPlug = socket.selectedPlugHash != null && !socket.plugDefinitionResolved;
    return blocked.has(socket.socketIndex) || isBaseRoll || isNumericMod ||
      hasDeclaredValues || unresolvedSelectedPlug;
  });
  const definitionValues = evidence.itemDefinitionInvestmentStats;
  return {
    itemDefinitionInvestmentStats: definitionValues,
    definitionInvestmentStatsState: !Array.isArray(definitionValues) ? "missing" :
      definitionValues.length ? "nonempty" : "empty",
    socketCountFromManifest: evidence.socketCountFromManifest,
    blockingSocketIndices: [...blocked].sort((a, b) => a - b),
    selectedStatRelatedSockets: relevant.map((socket) => ({
      socketIndex: socket.socketIndex,
      selectedPlugHash: socket.selectedPlugHash,
      plugName: socket.plugName,
      plugCategoryIdentifier: socket.plugCategoryIdentifier,
      plugDefinitionResolved: socket.plugDefinitionResolved,
      isEnabled: socket.isEnabled,
      isVisible: socket.isVisible,
      declaredInvestmentStats: socket.declaredInvestmentStats,
    })),
  };
}

const SLOT_LABELS = new Map<number, string>([
  [3448274439, "Casco"], [3551918588, "Guanti"], [14239492, "Torace"],
  [20886954, "Gambe"], [1585787867, "Oggetto di classe"],
]);
const STAT_NAMES = ["Armi", "Salute", "Classe", "Granata", "Super", "Mischia"];
const COLORS: Record<ArmorBaseResolution["status"], string> = {
  reconciled_roll_candidate: "text-emerald-300",
  insufficient_evidence: "text-amber-300",
  unreconciled: "text-rose-300",
};
const STATUS: Record<ArmorBaseResolution["status"], string> = {
  reconciled_roll_candidate: "Roll candidato riconciliato",
  insufficient_evidence: "Dati insufficienti",
  unreconciled: "Somme non riconciliate",
};
const SOURCES: readonly Source[] = ["equipaggiata", "inventario", "deposito", "altro Guardian"];

function tierOf(value: unknown): Tier {
  if (typeof value !== "string") return "Non verificata";
  if (value.trim().toLowerCase() === "exotic") return "Esotica";
  if (value.trim().toLowerCase() === "legendary") return "Leggendaria";
  return "Non verificata";
}

function selectSample(snapshot: Snapshot, classType: number | null, maxCount: number): Candidate[] {
  const pools: Record<Source, SourceItem[]> = {
    equipaggiata: snapshot.equipment, inventario: snapshot.inventory,
    deposito: snapshot.vault, "altro Guardian": snapshot.otherGuardianItems,
  };
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const source of SOURCES) {
    for (const item of pools[source]) {
      if (item.category !== "armor" || !item.itemInstanceId || !Number.isSafeInteger(item.itemHash)) continue;
      const slot = item.equipmentSlotHash ?? item.bucketHash ?? -1;
      if (!SLOT_LABELS.has(slot)) continue;
      if (classType !== null && item.classType !== null && item.classType !== undefined &&
          item.classType !== 3 && item.classType !== classType) continue;
      if (seen.has(item.itemInstanceId)) continue;
      seen.add(item.itemInstanceId);
      candidates.push({ item, source, tier: tierOf(item.tierTypeName), slot });
    }
  }
  const selected: Candidate[] = [];
  const selectedIds = new Set<string>();
  const add = (candidate: Candidate | undefined) => {
    if (!candidate || selected.length >= maxCount || !candidate.item.itemInstanceId ||
        selectedIds.has(candidate.item.itemInstanceId)) return;
    selectedIds.add(candidate.item.itemInstanceId);
    selected.push(candidate);
  };
  // Stratify across sources, rarities and slots instead of auditing only already-equipped armor.
  const targets: Array<[Source, Tier | null]> = [
    ["equipaggiata", "Esotica"], ["equipaggiata", "Leggendaria"],
    ["inventario", "Leggendaria"], ["deposito", "Esotica"],
    ["deposito", "Leggendaria"], ["altro Guardian", "Leggendaria"],
    ["inventario", "Esotica"], ["altro Guardian", "Esotica"],
  ];
  for (const [source, tier] of targets) {
    const choices = candidates.filter((c) => c.source === source && (tier === null || c.tier === tier) &&
      !selectedIds.has(c.item.itemInstanceId!));
    const usedSlots = new Set(selected.map((c) => c.slot));
    add(choices.find((c) => !usedSlots.has(c.slot)) ?? choices[0]);
  }
  // If tier metadata is absent or a source has no items, fill from distinct slots first.
  while (selected.length < maxCount) {
    const remaining = candidates.filter((c) => !selectedIds.has(c.item.itemInstanceId!));
    if (!remaining.length) break;
    const sourceCounts = new Map(SOURCES.map((s) => [s, selected.filter((c) => c.source === s).length]));
    const slotCounts = new Map([...SLOT_LABELS.keys()].map((s) => [s, selected.filter((c) => c.slot === s).length]));
    remaining.sort((a, b) =>
      (sourceCounts.get(a.source) ?? 0) - (sourceCounts.get(b.source) ?? 0) ||
      (slotCounts.get(a.slot) ?? 0) - (slotCounts.get(b.slot) ?? 0) ||
      a.item.name.localeCompare(b.item.name));
    add(remaining[0]);
  }
  return selected;
}

async function readJson(url: string, signal: AbortSignal): Promise<ApiPayload> {
  const attempt = () => fetch(url, { cache: "no-store", signal, credentials: "same-origin" });
  let response = await attempt();
  if (response.status === 401 && !signal.aborted) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST", signal, credentials: "same-origin" });
    if (refreshed.ok) response = await attempt();
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok || !parsed || typeof parsed !== "object") throw new Error(`Risposta API non valida (HTTP ${response.status}).`);
  const result = parsed as ApiPayload;
  if (!result.success) throw new Error(result.error || "La richiesta non ha restituito dati validi.");
  return result;
}

function list(value: unknown): SourceItem[] { return Array.isArray(value) ? value as SourceItem[] : []; }
function statVector(values: ArmorBaseResolution["rollStats"]): string {
  return values ? ARMOR_3_STAT_IDS.map((hash) => values.find((s) => s.statHash === hash)?.value ?? "?").join(" / ") : "—";
}
function reportData(rows: readonly Row[]) {
  // Only item names and aggregated stat vectors. No member IDs, instance IDs, tokens or raw Bungie payloads.
  return {
    test: "Engine-B0.5c3d2c", time: new Date().toISOString(), note: "Audit whitelist socket Manifest e PlugSet live; installabilita non certificata",
    sampleSize: rows.length,
    counts: {
      reconciled: rows.filter((r) => r.resolution?.status === "reconciled_roll_candidate").length,
      insufficient: rows.filter((r) => r.resolution?.status === "insufficient_evidence").length,
      unreconciled: rows.filter((r) => r.resolution?.status === "unreconciled").length,
      requestErrors: rows.filter((r) => r.error).length,
      statModsPresent: rows.filter((r) => (r.resolution?.modifiers.length ?? 0) > 0).length,
      statModsNotDetected: rows.filter((r) => r.resolution && r.resolution.modifiers.length === 0).length,
    },
    items: rows.map((r) => ({
      name: r.candidate.item.name, source: r.candidate.source,
      tier: r.detailTier === "Non verificata" ? r.candidate.tier : r.detailTier,
      slot: SLOT_LABELS.get(r.candidate.slot), status: r.resolution?.status ?? "request_error",
      observedStats: r.resolution?.observedStats ?? null,
      rollCandidate: r.resolution?.rollStats ?? null,
      modifiers: r.resolution?.modifiers ?? [],
      mismatches: r.resolution?.mismatches ?? [],
      reasons: r.resolution?.reasons ?? (r.error ? [r.error] : []),
      ...(r.blockerEvidence ? { blockerEvidence: r.blockerEvidence } : {}),
      // B0.5b1 compact counts only: full truncated 12-option samples stay in the UI.
      modifierAvailability: r.modifierAvailability ? {
        source: r.modifierAvailability.source,
        socketCountFromManifest: r.modifierAvailability.socketCountFromManifest,
        socketCountFromLive: r.modifierAvailability.socketCountFromLive,
        sockets: r.modifierAvailability.sockets.map((s) => ({
          socketIndex: s.socketIndex, socketTypeHash: s.socketTypeHash,
          plugSources: s.plugSources, sourceKinds: s.sourceKinds,
          manifestReusablePlugSetPresent: s.manifestReusablePlugSetPresent,
          manifestRandomizedPlugSetPresent: s.manifestRandomizedPlugSetPresent,
          optionsCount: s.optionsCount,
          statusCounts: s.statusCounts, sampleTruncated: s.sampleTruncated,
        })),
      } : { status: "missing_from_detail_api" },
      availabilityModel: r.availabilityAssessment ? {
        validEvidence: r.availabilityAssessment.validEvidence,
        installabilityVerified: false,
        reason: r.availabilityAssessment.reason,
        sharedEvidenceState: r.availabilityAssessment.sharedEvidenceState,
        sharedEvidenceReason: r.availabilityAssessment.sharedEvidenceReason,
        summary: r.availabilityAssessment.summary,
        mathReadyLiveCandidates: r.availabilityAssessment.mathReadyLiveCandidates,
        sharedLiveCandidates: r.availabilityAssessment.sharedLiveCandidates,
        sharedConflicts: r.availabilityAssessment.sharedConflicts,
        whitelistSummary: r.availabilityAssessment.whitelistSummary,
        energyEvidence: r.availabilityAssessment.energyEvidence,
        sockets: r.availabilityAssessment.sockets.map((s) => ({
          socketIndex: s.socketIndex, category: s.category,
          socketWhitelistEvidenceState: s.socketWhitelistEvidenceState,
          socketWhitelistCategoryCount: s.socketWhitelistCategoryCount,
          socketWhitelistAllowAll: s.socketWhitelistAllowAll,
          whitelistCounts: s.whitelistCounts,
          whitelistLiveConflicts: s.whitelistLiveConflicts,
          whitelistExamples: s.whitelistExamples,
          liveSocketPresent: s.liveSocketPresent, liveSocketEnabled: s.liveSocketEnabled,
          liveReusableDataPresent: s.liveReusableDataPresent,
          sharedReferencedSetCount: s.sharedReferencedSetCount,
          sharedMatchedSetCount: s.sharedMatchedSetCount,
          sharedComponentIncomplete: s.sharedComponentIncomplete,
          sharedPositive: s.sharedPositive, sharedConflict: s.sharedConflict,
          sharedIncomplete: s.sharedIncomplete, sharedLiveCandidates: s.sharedLiveCandidates,
          totalOptions: s.totalOptions, counts: s.counts,
          mathReady: s.mathReady, mathReadyLive: s.mathReadyLive,
          unknownEffect: s.unknownEffect,
          examples: s.sample.filter((o) => o.availability !== "installed").slice(0, 3)
            .map((o) => ({plugHash: o.plugHash, name: o.name,
              availability: o.availability, effectKind: o.effectKind,
              simulationMode: o.simulationMode,
              sharedSignal: o.sharedSignal})),
        })),
      } : { status: "missing_from_detail_api" },
      sharedPlugSetEvidence: r.sharedPlugSetAssessment ?? { status: "not_available" },
      certifiedForOptimization: false,
    })),
  };
}

export default function ArmorAuditPage() {
  const params = useParams();
  const characterId = String(params.characterId ?? "");
  // Remount the isolated tester when switching Guardian: no stale cross-character samples.
  return <ArmorAuditContent key={characterId} characterId={characterId} />;
}

function ArmorAuditContent({ characterId }: { characterId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sharedPlugSetCoreEvidence, setSharedPlugSetCoreEvidence] = useState<unknown>(null);
  const [classType, setClassType] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [maxCount, setMaxCount] = useState<4 | 6 | 8>(8);
  const [phase, setPhase] = useState<"idle" | "snapshot" | "details">("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [characterId]);

  const sample = useMemo(() => snapshot ? selectSample(snapshot, classType, maxCount) : [], [snapshot, classType, maxCount]);
  const counts = useMemo(() => reportData(rows).counts, [rows]);
  const report = useMemo(() => rows.length ? JSON.stringify(reportData(rows), null, 2) : "", [rows]);

  const begin = () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    return { signal: next.signal, run: ++generation.current };
  };

  const loadSnapshot = async () => {
    if (phase !== "idle" || !characterId) return;
    const { signal, run } = begin();
    setError(""); setCopyStatus(""); setRows([]); setSnapshot(null);
    setSharedPlugSetCoreEvidence(null);
    setPhase("snapshot"); setProgress("Caricamento inventario e deposito…");
    try {
      const [core, account] = await Promise.all([
        readJson(`/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=core`, signal),
        readJson(`/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=account`, signal),
      ]);
      if (signal.aborted || run !== generation.current) return;
      // The core response already contains this Guardian's Bungie classType.
      const resolvedClass = typeof core.classType === "number" && [0, 1, 2].includes(core.classType)
        ? core.classType : null;
      setClassType(resolvedClass);
      setSharedPlugSetCoreEvidence(core.sharedModifierPlugSetEvidence ?? null);
      setSnapshot({ equipment: list(core.equipment), inventory: list(core.inventory),
        vault: list(account.vault), otherGuardianItems: list(account.otherGuardianItems) });
      setProgress("Inventario pronto. Avvia il test manualmente.");
    } catch (caught) {
      if (!signal.aborted && run === generation.current) setError(caught instanceof Error ? caught.message : "Caricamento fallito.");
    } finally {
      if (run === generation.current) setPhase("idle");
    }
  };

  const runAudit = async () => {
    if (phase !== "idle" || !snapshot || !sample.length) return;
    const { signal, run } = begin();
    setPhase("details"); setRows([]); setError(""); setCopyStatus("");
    let completed = 0;
    const accumulated: Row[] = [];
    try {
      // Strict concurrency cap of TWO. Never request more than the selected 4/6/8 items.
      for (let i = 0; i < sample.length && !signal.aborted; i += 2) {
        setProgress(`Dettagli ${completed}/${sample.length} · max 2 richieste contemporanee`);
        const pair = sample.slice(i, i + 2);
        const next = await Promise.all(pair.map(async (candidate): Promise<Row> => {
          try {
            const { item } = candidate;
            const payload = await readJson(
              `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(item.itemInstanceId!)}&itemHash=${item.itemHash}`,
              signal,
            );
            const detail = payload.item as (ArmorResolverInput & { itemHash?: number; itemInstanceId?: string; tierTypeName?: string }) | undefined;
            if (!detail || detail.itemInstanceId !== item.itemInstanceId || detail.itemHash !== item.itemHash) {
              throw new Error("Identità istanza/hash non corrispondente: dettaglio scartato.");
            }
            const resolution = resolveArmorBaseStats(detail);
            return { candidate, detailTier: tierOf(detail.tierTypeName),
              resolution, blockerEvidence: collectBlockerEvidence(detail, resolution),
              modifierAvailability: summarizeModifierAvailability(
                (detail as Record<string, unknown>).armorModifierAvailabilityEvidence),
              availabilityAssessment: summarizeAvailabilityAssessment(
                (detail as Record<string, unknown>).armorModifierAvailabilityEvidence,
                sharedPlugSetCoreEvidence),
              sharedPlugSetAssessment: summarizeSharedPlugSets(
                (detail as Record<string, unknown>).armorModifierAvailabilityEvidence,
                sharedPlugSetCoreEvidence), error: null };
          } catch (caught) {
            return { candidate, detailTier: "Non verificata", resolution: null, blockerEvidence: null,
              modifierAvailability: null, availabilityAssessment: null,
              sharedPlugSetAssessment: null, error: signal.aborted ? "Annullato" : caught instanceof Error ? caught.message : "Errore sconosciuto" };
          }
        }));
        if (signal.aborted || run !== generation.current) return;
        accumulated.push(...next);
        completed = accumulated.length;
        setRows([...accumulated]);
      }
      if (!signal.aborted && run === generation.current) setProgress(`Test completato: ${completed}/${sample.length} dettagli.`);
    } finally {
      if (run === generation.current) setPhase("idle");
    }
  };

  const cancel = () => {
    controller.current?.abort();
    generation.current += 1;
    setPhase("idle"); setProgress("Operazione annullata. I risultati parziali restano visibili.");
  };

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus("Rapporto copiato, senza identificativi dell'account o delle istanze.");
    } catch {
      setCopyStatus("Copia automatica non disponibile: seleziona il testo del rapporto qui sotto.");
    }
  };

  return <main className="min-h-screen bg-[#080d13] px-4 py-8 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-300/75">Destiny Builder · Engine-B0.5c3d2c</p>
          <h1 className="mt-1 text-2xl font-bold">Audit statistiche base Armor 3.0</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">Diagnostica read-only: riconcilia le statistiche e classifica le opzioni dei socket usando tutte le evidenze Bungie, senza certificare l’installabilità.</p>
        </div>
        <Link href={`/guardian/${encodeURIComponent(characterId)}/assistant-v2`} className="border border-cyan-300/30 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-white/5">← Armor Optimizer v2</Link>
      </div>

      <section className="space-y-3 border border-white/10 bg-[#101924] p-4">
        <p className="text-xs text-amber-200">Solo lettura · Nessun equipaggiamento/modifica su Bungie · Nessuna chiamata OpenAI · Roll riconciliati NON ancora certificati per l’Optimizer.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={phase !== "idle"} onClick={() => void loadSnapshot()}
            className="border border-cyan-200/35 bg-cyan-200/10 px-4 py-2 text-xs font-bold text-cyan-100 disabled:opacity-40">{snapshot ? "Ricarica inventario" : "1. Carica inventario"}</button>
          <label className="flex items-center gap-2 text-xs text-slate-300">Campione massimo
            <select value={maxCount} disabled={phase !== "idle"} onChange={(e: ChangeEvent<HTMLSelectElement>) => { setMaxCount(Number(e.target.value) as 4 | 6 | 8); setRows([]); }}
              className="border border-white/20 bg-[#0b111a] px-2 py-2 text-white">
              <option value={4}>4 armature</option><option value={6}>6 armature</option><option value={8}>8 armature</option>
            </select>
          </label>
          <button type="button" disabled={phase !== "idle" || !sample.length} onClick={() => void runAudit()}
            className="border border-emerald-200/40 bg-emerald-200/10 px-4 py-2 text-xs font-bold text-emerald-200 disabled:opacity-35">2. Verifica campione</button>
          {phase !== "idle" && <button type="button" onClick={cancel}
            className="border border-rose-300/35 px-3 py-2 text-xs text-rose-200">Annulla</button>}
        </div>
        <p className="text-xs text-slate-400" role="status">{progress || "In attesa di avvio. Le richieste di dettaglio partono solo al punto 2."}</p>
        {error && <p className="border border-rose-300/35 bg-rose-950/20 p-2 text-sm text-rose-200" role="alert">{error}</p>}
        {snapshot && <p className="text-xs text-slate-300">Candidati selezionati: <strong>{sample.length}</strong> · equipaggiati {sample.filter((s) => s.source === "equipaggiata").length} · inventario {sample.filter((s) => s.source === "inventario").length} · Deposito {sample.filter((s) => s.source === "deposito").length} · altri Guardian {sample.filter((s) => s.source === "altro Guardian").length}. Il campione può essere parziale se alcune categorie non sono disponibili.</p>}
        {snapshot && <details className="text-xs text-slate-400"><summary className="cursor-pointer">Anteprima del campione (nessuna richiesta di dettaglio)</summary>
          <div className="mt-2 flex flex-wrap gap-2">{sample.map((s) => <span key={s.item.itemInstanceId} className="border border-white/10 px-2 py-1">{s.item.name} · {s.source} · {s.tier}</span>)}</div>
        </details>}
      </section>

      {rows.length > 0 && <>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {([
            ["Riconciliati", counts.reconciled], ["Dati insufficienti", counts.insufficient],
            ["Non riconciliati", counts.unreconciled], ["Errori richieste", counts.requestErrors],
            ["Con modificatori riconosciuti", counts.statModsPresent],
          ] as const).map(([label, number]) => <div key={label} className="border border-white/10 bg-[#101924] p-3">
            <p className="text-[11px] text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{number}</p>
          </div>)}
        </section>
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-bold">Risultati reali ({rows.length})</h2>
            <span className="text-xs text-slate-400">Vettori nell’ordine: {STAT_NAMES.join(" / ")}</span>
          </div>
          {rows.map((row, index) => {
            const result = row.resolution;
            return <article key={`${row.candidate.item.itemInstanceId}-${index}`} className="border border-white/10 bg-[#101924] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="text-sm font-semibold">{row.candidate.item.name}</h3>
                  <p className="mt-0.5 text-xs text-slate-400">{SLOT_LABELS.get(row.candidate.slot)} · {row.candidate.source} · {row.detailTier !== "Non verificata" ? row.detailTier : row.candidate.tier}</p></div>
                <strong className={`text-xs ${result ? COLORS[result.status] : "text-rose-300"}`}>{result ? STATUS[result.status] : "Errore richiesta"}</strong>
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="border border-white/10 p-2"><span className="text-slate-400">Osservato Bungie</span><p className="mt-1 font-mono tabular-nums">{statVector(result?.observedStats ?? null)}</p></div>
                <div className="border border-white/10 p-2"><span className="text-slate-400">Roll iniziale candidato</span><p className="mt-1 font-mono tabular-nums">{statVector(result?.rollStats ?? null)}</p></div>
              </div>
              {result?.modifiers.length ? <p className="mt-2 text-xs text-cyan-200/80">Modificatori dichiarati: {result.modifiers.map((m) => `${m.name} (${m.contributions.map((c) => `${c.name} ${c.value >= 0 ? "+" : ""}${c.value}`).join(", ")})`).join(" · ")}</p>
                : <p className="mt-2 text-xs text-slate-500">Nessun modificatore numerico riconosciuto (non prova che l’armatura sia priva di modifiche).</p>}
              {result?.mismatches.length ? <p className="mt-2 text-xs text-rose-200">Differenze: {result.mismatches.map((m) => `${m.name}: Bungie ${m.observed}, calcolato ${m.expected}`).join(" · ")}</p> : null}
              {(row.error || result?.reasons.length) && <p className="mt-2 text-xs text-slate-400">{row.error || result?.reasons.join(" · ")}</p>}
              {row.availabilityAssessment ? <section className="mt-3 space-y-2 border border-violet-400/20 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-violet-200">B0.5c3d2c · Disponibilità mod + whitelist socket</strong>
                  <span className="text-amber-200">Installabilità NON verificata</span>
                </div>
                {!row.availabilityAssessment.validEvidence ? <p className="text-rose-200">Evidenze rifiutate: {row.availabilityAssessment.reason}</p> : <>
                  <p className="text-slate-300">Installate: {row.availabilityAssessment.summary.installed} · Candidate live: {row.availabilityAssessment.summary.live_candidate} · Bloccate: {row.availabilityAssessment.summary.live_blocked} · Solo Manifest: {row.availabilityAssessment.summary.manifest_candidate} · Incerte: {row.availabilityAssessment.summary.unknown}.</p>
                  <p className="text-slate-300">PlugSet condivisi: <strong className="text-cyan-200">{row.availabilityAssessment.sharedEvidenceState === "valid" ? "evidenza letta" : row.availabilityAssessment.sharedEvidenceState === "invalid" ? "evidenza non valida" : "non disponibile"}</strong> · Candidate live sostenute da segnali shared (non da reusable item): <strong className="text-cyan-200">{row.availabilityAssessment.sharedLiveCandidates}</strong> · Conflitti shared: <strong className="text-amber-200">{row.availabilityAssessment.sharedConflicts}</strong>.</p>
                  {row.availabilityAssessment.sharedEvidenceState !== "valid" && <p className="text-amber-200">{row.availabilityAssessment.sharedEvidenceReason} Nessuna promozione shared in assenza di evidenze valide.</p>}
                  <p className="text-slate-300">Whitelist Manifest: {row.availabilityAssessment.whitelistSummary.verifiedSockets} socket verificati · {row.availabilityAssessment.whitelistSummary.missingSockets} mancanti · {row.availabilityAssessment.whitelistSummary.invalidSockets} non validi. Opzioni per categoria: {row.availabilityAssessment.whitelistSummary.allowed} ammesse · {row.availabilityAssessment.whitelistSummary.excluded} escluse · {row.availabilityAssessment.whitelistSummary.unknown} sconosciute. Conflitti con candidate live: {row.availabilityAssessment.whitelistSummary.liveConflicts}.</p>
                  <p className="text-slate-400">Alternative live con effetti matematicamente modellabili: <strong className="text-cyan-200">{row.availabilityAssessment.mathReadyLiveCandidates}</strong>. Non equivale alla possibilità di inserirle realmente.</p>
                  <div className="grid gap-2 sm:grid-cols-2">{row.availabilityAssessment.sockets.map((socket) => <div key={socket.socketIndex} className="border border-white/10 bg-white/[0.02] p-2">
                    <div className="font-semibold text-slate-200">Socket {socket.socketIndex} · {socket.category === "enhancements.v2_general" ? "Mod statistica" : socket.category?.includes("tuning") ? "Tuning" : "Tipo non verificato"}</div>
                    <div className="mt-1 text-slate-400">{socket.totalOptions} opzioni · {socket.counts.live_candidate} candidate live · {socket.counts.manifest_candidate} solo Manifest · {socket.mathReady} modellabili</div>
                    <div className="mt-1 text-slate-300">Whitelist: {socket.socketWhitelistEvidenceState === "verified" ? (socket.socketWhitelistAllowAll ? "verificata (nessun filtro di categoria)" : `verificata (${socket.socketWhitelistCategoryCount} categorie)`) : socket.socketWhitelistEvidenceState === "missing" ? "non disponibile" : "evidenza non valida"} · ammesse {socket.whitelistCounts.allowed} · escluse {socket.whitelistCounts.excluded} · sconosciute {socket.whitelistCounts.unknown} · conflitti live {socket.whitelistLiveConflicts}.</div>
                    <div className="mt-1 text-slate-300">PlugSet collegati: {socket.sharedMatchedSetCount}/{socket.sharedReferencedSetCount} · Segnali shared positivi: {socket.sharedPositive} · Candidate da shared: {socket.sharedLiveCandidates} · Conflitti: {socket.sharedConflict}</div>
                    {socket.sharedComponentIncomplete && <div className="mt-1 text-amber-200">Evidenza condivisa incompleta: alcune opzioni restano incerte.</div>}
                    {socket.category === "enhancements.v2_general" && !socket.liveReusableDataPresent && <div className="mt-1 text-amber-200">Nessun reusable item live: eventuali candidate da PlugSet condivisi restano NON installabili con certezza.</div>}
                    {row.modifierAvailability?.sockets.filter((entry) => entry.socketIndex === socket.socketIndex).map((entry) => <div key={String(entry.socketIndex)} className="mt-1 text-slate-400">
                      Sorgenti Bungie: {entry.plugSources === null ? "non dichiarate / sconosciute" : `${entry.plugSources} (${entry.sourceKinds.join(", ")})`} · PlugSet Manifest: {entry.manifestReusablePlugSetPresent ? "presente" : "non indicato"}. Questi flag non certificano installabilità.
                    </div>)}
                    <details className="mt-2 text-slate-400"><summary className="cursor-pointer">Esempi whitelist (max 2 per esito)</summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[10px]">{JSON.stringify(socket.whitelistExamples, null, 2)}</pre>
                    </details>
                    <details className="mt-2 text-slate-400"><summary className="cursor-pointer">Esempi classificati e motivi</summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[10px]">{JSON.stringify(socket.sample, null, 2)}</pre>
                    </details>
                  </div>)}</div>
                </>}
              </section> : <p className="mt-2 text-xs text-amber-300">B0.5b6: modello non disponibile; controllare le evidenze API e armorModifierAvailability.ts.</p>}
              {row.sharedPlugSetAssessment ? <details className="mt-3 border border-cyan-400/20 p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-cyan-200">Dettagli tecnici B0.5b5 · PlugSet condivisi (sola lettura)</summary>
                <p className="text-amber-200">Segnali live, NON autorizzazione a inserire mod o verificare energia.</p>
                {row.sharedPlugSetAssessment.sockets.map((socket) => <div key={String(socket.socketIndex)} className="border border-white/10 p-2">
                  <strong>Socket {socket.socketIndex}</strong> · Set collegati: {socket.matchedSets}/{socket.setReferences} · Profilo: {socket.profileOptions} plug · Personaggio: {socket.characterOptions} plug · Segnali live positivi: {socket.withTrueLiveSignal} · Non presenti nel catalogo dell'item: {socket.outsideManifestCatalog}
                  {socket.missingSharedComponent && <div className="text-amber-200">Componente condiviso assente: risultati incompleti.</div>}
                  <div className="text-slate-400">Questi dati sono del Guardian attualmente selezionato, anche per le armature nel Deposito.</div>
                </div>)}
              </details> : <p className="mt-3 text-xs text-amber-300">B0.5b5: dati condivisi non disponibili. Ricarica l'inventario se il dato manca.</p>}
              {row.modifierAvailability ? <details className="mt-3 border border-cyan-400/20 p-2 text-xs text-cyan-200">
                <summary className="cursor-pointer">B0.5b · Evidenze disponibilità mod ({row.modifierAvailability.sockets.length} socket, installabilità NON verificata)</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-slate-300">{JSON.stringify(row.modifierAvailability, null, 2)}</pre>
              </details> : <p className="mt-2 text-xs text-amber-300">B0.5b: evidenze di disponibilità assenti; verificare installazione patch API.</p>}
              {row.blockerEvidence && <details className="mt-3 border border-amber-400/20 p-2 text-xs text-amber-200">
                <summary className="cursor-pointer">Evidenze del blocco (sola lettura, senza ID account)</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-slate-300">{JSON.stringify(row.blockerEvidence, null, 2)}</pre>
              </details>}
            </article>;
          })}
        </section>
        <section className="space-y-2 border border-white/10 bg-[#101924] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Rapporto per la prossima verifica</h2>
            <button type="button" onClick={() => void copyReport()} className="border border-cyan-300/35 px-3 py-2 text-xs font-bold text-cyan-200">Copia rapporto senza ID</button></div>
          <p className="text-xs text-slate-400">Rapporto compatto, senza token o ID di account/istanza. Conta TUTTE le opzioni e include esempi limitati; nessuna viene dichiarata installabile automaticamente.</p>
          {copyStatus && <p className="text-xs text-emerald-200" role="status">{copyStatus}</p>}
          <textarea readOnly value={report} aria-label="Rapporto diagnostico JSON" className="h-48 w-full resize-y border border-white/15 bg-[#050a10] p-2 font-mono text-[11px] text-slate-300" />
        </section>
      </>}
    </div>
  </main>;
}
