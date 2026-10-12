"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppShell from "@/components/destiny-builder/AppShell";
import {
  createBuildContext,
  type ActivityKind,
  type AccountSnapshot,
  type BuildMode,
  type BuilderDraft,
  type CoreSnapshot,
  type GuardianInfo,
  type InventoryItem,
  type BuildContext,
  type ItemDetail,
} from "@/lib/destiny-builder/buildContext";
import { analyzeBuildSynergies, type SynergyEvidence, type SynergyFinding, type SynergyReport, type EffectCoverage } from "@/lib/destiny-builder/synergyEngine";
import {
  findGearRecommendations,
  type RecommendationCandidate,
  type RecommendationReport,
  type CandidateEvidence,
} from "@/lib/destiny-builder/recommendationEngine";
import {
  resolveBuildMechanics,
  type MechanicsReport,
  type ResolvedMechanic,
  type MechanicConfiguration,
} from "@/lib/destiny-builder/mechanicsResolver";
import {
  calculateGuardianArmorStats,
  collectCompatibilityFacts,
  validateBuildCompatibility,
  validateCandidateReplacement,
  type CompatibilityReport,
  type GuardianArmorStatsReport,
} from "@/lib/destiny-builder/compatibilityValidator";

import {
  optimizeOwnedArmor,
  ARMOR_3_STATS,
  ARMOR_SLOTS,
  type ArmorOptimizationRequest,
  type ArmorOptimizationReport,
} from "@/lib/destiny-builder/armorOptimizer";
import {
  createUniversalPlanningContext,
  type UniversalPlanningContext,
  type PlanningGearOption,
  type PlanningSubclassOption,
} from "@/lib/destiny-builder/universalPlanningContext";
import {
  generateFullBuildCandidates,
  evaluateFullBuildProposal,
  type FullBuildGenerationReport,
  type FullBuildGenerationRequest,
  type FullBuildProposalResult,
} from "@/lib/destiny-builder/fullBuildPlanner";
import { buildBudgetedAiContext, type SharedAiPacket } from "@/lib/destiny-builder/aiContextBudget";

type Guardian = GuardianInfo & {
  emblemPath?: string | null;
  emblemBackgroundPath?: string | null;
};

type ApiPayload = Record<string, unknown> & { success?: boolean; error?: string };

const ACTIVITY_OPTIONS: Array<{ value: ActivityKind; label: string }> = [
  { value: "general", label: "General" },
  { value: "pve", label: "PvE" },
  { value: "pvp", label: "PvP" },
  { value: "raid", label: "Raid" },
  { value: "nightfall", label: "Nightfall" },
  { value: "dungeon", label: "Dungeon" },
];

/** Never send the entire account's inventory to a view just for inspection. */
async function fetchJson(url: string): Promise<ApiPayload> {
  const perform = () => fetch(url, { cache: "no-store" });
  let response = await perform();
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) response = await perform();
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object") {
    const reported = data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : `Request failed (${response.status})`;
    throw new Error(reported);
  }
  const payload = data as ApiPayload;
  if (!payload.success) throw new Error(payload.error || "Bungie returned an unsuccessful response.");
  return payload;
}

/** This is the same per-Guardian draft used by the existing three editors. */
function readBuilderDraft(characterId: string): BuilderDraft | null {
  try {
    const raw = window.localStorage.getItem(`destiny-builder-draft:${characterId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as BuilderDraft;
  } catch {
    return null;
  }
}

/** 8R.4.4.A2c — Short-lived cache of supported, verified armor detail fields.
 * Session only (per browser tab), never account-wide persistent localStorage.
 * No Bungie tokens, raw account snapshots, or optimizer results are stored here.
 */
const ARMOR_DETAIL_CACHE_VERSION = 3;
const ARMOR_DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const ARMOR_DETAIL_CACHE_MAX_ENTRIES = 128;
// Bungie detail payloads can include much more than the ItemDetail contract.
// Persist the full supported ItemDetail shape (including perks, stats and sets),
// not unrelated API fields. Keep firm per-tab limits; do not persist tokens.
const ARMOR_DETAIL_CACHE_MAX_CHARS = 2 * 1024 * 1024;
const ARMOR_DETAIL_CACHE_MAX_ITEM_CHARS = 256 * 1024;

type ArmorCacheStatus = {
  stored: number;
  restored: number | null;
  skippedOversized: number;
  skippedInvalid: number;
  error: string | null;
};

type CachedArmorDetail = { savedAt: number; detail: ItemDetail };
type ArmorDetailCache = {
  version: number;
  characterId: string;
  entries: CachedArmorDetail[];
};

function armorDetailCacheKey(characterId: string): string {
  return `destiny-builder-armor-details:v${ARMOR_DETAIL_CACHE_VERSION}:${characterId}`;
}

function isVerifiableArmorDetail(value: unknown): value is ItemDetail {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const detail = value as Partial<ItemDetail>;
  return typeof detail.itemInstanceId === "string" && detail.itemInstanceId.length > 0 &&
    typeof detail.itemHash === "number" && Number.isSafeInteger(detail.itemHash) &&
    Array.isArray(detail.armorStats) && detail.armorStats.length > 0;
}

/** Retain ALL fields declared by ItemDetail, including nested perk and set data.
 * The live in-memory detail remains untouched. Discard only undocumented extra
 * API properties from the SESSION cache, which may be enormous per instance.
 * No synthetic stat, perk, modifier or mechanic is created.
 */
function compactArmorDetail(detail: ItemDetail): ItemDetail {
  type ArmorStat = NonNullable<ItemDetail["armorStats"]>[number];
  type ArmorPerk = NonNullable<ItemDetail["selectedPerks"]>[number];
  type ArmorTag = NonNullable<ArmorPerk["effectTags"]>[number];
  const tags = (values: ArmorTag[] | undefined): ArmorTag[] | undefined =>
    Array.isArray(values) ? values.map(({ key, label, kind }) => ({ key, label, kind })) : undefined;
  const stats = (values: ArmorStat[] | undefined): ArmorStat[] | undefined =>
    Array.isArray(values) ? values.map(({ statHash, name, value, description }) =>
      ({ statHash, name, value, description })) : undefined;
  const perk = ({ socketIndex, plugHash, name, description, state, effectTags }: ArmorPerk): ArmorPerk =>
    ({ socketIndex, plugHash, name, description, state, effectTags: tags(effectTags) });
  return {
    itemInstanceId: detail.itemInstanceId,
    itemHash: detail.itemHash,
    stats: stats(detail.stats),
    armorStats: stats(detail.armorStats),
    armorStatTotal: detail.armorStatTotal,
    selectedPerks: Array.isArray(detail.selectedPerks) ? detail.selectedPerks.map(perk) : undefined,
    intrinsicPerks: Array.isArray(detail.intrinsicPerks) ? detail.intrinsicPerks.map((value) => ({
      perkHash: value.perkHash, name: value.name,
      description: value.description, effectTags: tags(value.effectTags),
    })) : undefined,
    perkColumns: Array.isArray(detail.perkColumns) ? detail.perkColumns.map((column) => ({
      socketIndex: column.socketIndex,
      selected: column.selected ? perk(column.selected) : null,
      all: column.all.map(perk),
    })) : undefined,
    itemSet: detail.itemSet ? {
      name: detail.itemSet.name,
      perks: detail.itemSet.perks.map((value) => ({
        name: value.name, requiredSetCount: value.requiredSetCount,
        effectTags: tags(value.effectTags),
      })),
    } : detail.itemSet,
    recoilDirection: detail.recoilDirection,
  };
}

function readArmorCacheEntries(characterId: string): CachedArmorDetail[] {
  try {
    const raw = window.sessionStorage.getItem(armorDetailCacheKey(characterId));
    if (!raw || raw.length > ARMOR_DETAIL_CACHE_MAX_CHARS) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const cache = parsed as Partial<ArmorDetailCache>;
    if (cache.version !== ARMOR_DETAIL_CACHE_VERSION || cache.characterId !== characterId ||
        !Array.isArray(cache.entries)) return [];
    const now = Date.now();
    return cache.entries.slice(0, ARMOR_DETAIL_CACHE_MAX_ENTRIES).filter((value): value is CachedArmorDetail => {
      if (!value || typeof value !== "object") return false;
      const entry = value as CachedArmorDetail;
      return typeof entry.savedAt === "number" && Number.isFinite(entry.savedAt) &&
        entry.savedAt <= now && now - entry.savedAt <= ARMOR_DETAIL_CACHE_TTL_MS &&
        isVerifiableArmorDetail(entry.detail);
    });
  } catch {
    // Private browsing / disabled storage / corrupt cache: continue uncached.
    return [];
  }
}

/** Reconcile instance hashes against the NEW account snapshot, including moves between Vault
 * and guardians. Conflicting same-ID observations are never considered verified.
 */
function observedOwnedInstances(core: CoreSnapshot, account: AccountSnapshot): Map<string, {hash: number; category: string} | null> {
  const observed = new Map<string, {hash: number; category: string} | null>();
  for (const item of [...core.equipment, ...core.inventory, ...account.vault, ...account.otherGuardianItems]) {
    const id = item.itemInstanceId;
    if (!id || !Number.isSafeInteger(item.itemHash)) continue;
    const signature = {hash: item.itemHash, category: String(item.category)};
    if (!observed.has(id)) observed.set(id, signature);
    else {
      const previous = observed.get(id);
      if (previous && (previous.hash !== signature.hash || previous.category !== signature.category))
        observed.set(id, null);
    }
  }
  return observed;
}

function reconcileCurrentDetails(
  current: Record<string, ItemDetail>, observed: ReturnType<typeof observedOwnedInstances>,
): Record<string, ItemDetail> {
  const kept: Record<string, ItemDetail> = {};
  for (const [id, detail] of Object.entries(current)) {
    const identity = observed.get(id);
    // Unlike the persisted cache, this includes selected weapon/Artifact details in RAM.
    if (identity && detail.itemInstanceId === id && detail.itemHash === identity.hash)
      kept[id] = detail;
  }
  return kept;
}

/** Restore only exact owned armor instances, never an unrelated/hash-mismatched item. */
function restoreArmorDetailCache(
  characterId: string, core: CoreSnapshot, account: AccountSnapshot,
): {details: Record<string, ItemDetail>; stored: number; restored: number} {
  const observed = observedOwnedInstances(core, account);
  const entries = readArmorCacheEntries(characterId);
  const restored: Record<string, ItemDetail> = {};
  for (const { detail } of entries) {
    const identity = observed.get(detail.itemInstanceId);
    if (identity?.category === "armor" && identity.hash === detail.itemHash)
      restored[detail.itemInstanceId] = detail;
  }
  return { details: restored, stored: entries.length, restored: Object.keys(restored).length };
}

/** Persist successful detail responses within explicit limits. Return truthful cache status. */
function cacheFetchedArmorDetails(
  characterId: string, fetched: ReadonlyArray<ItemDetail | null | undefined>,
): {stored: number; skippedOversized: number; skippedInvalid: number; error: string | null} {
  let skippedOversized = 0;
  let skippedInvalid = 0;
  try {
    const byId = new Map<string, CachedArmorDetail>();
    for (const entry of readArmorCacheEntries(characterId))
      byId.set(entry.detail.itemInstanceId, entry);
    const now = Date.now();
    for (const detail of fetched) {
      if (detail == null) continue; // Failed requests are reported by the fetch path.
      // Other item types are handled in memory but never belong in the armor cache.
      if (!Array.isArray(detail.armorStats)) continue;
      if (!isVerifiableArmorDetail(detail)) { skippedInvalid++; continue; }
      try {
        const compact = compactArmorDetail(detail);
        const encoded = JSON.stringify(compact);
        if (encoded.length > ARMOR_DETAIL_CACHE_MAX_ITEM_CHARS) { skippedOversized++; continue; }
        byId.set(compact.itemInstanceId, { savedAt: now, detail: compact });
      } catch {
        // Malformed nested structures must not stop other details from caching.
        skippedInvalid++;
      }
    }
    const entries = [...byId.values()].sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, ARMOR_DETAIL_CACHE_MAX_ENTRIES);
    const cache: ArmorDetailCache = { version: ARMOR_DETAIL_CACHE_VERSION, characterId, entries };
    let serialized = JSON.stringify(cache);
    while (serialized.length > ARMOR_DETAIL_CACHE_MAX_CHARS && entries.length > 0) {
      entries.pop(); // Evict oldest first; the UI reports how many remain in storage.
      serialized = JSON.stringify(cache);
    }
    if (entries.length) window.sessionStorage.setItem(armorDetailCacheKey(characterId), serialized);
    else window.sessionStorage.removeItem(armorDetailCacheKey(characterId));
    // Verify that the browser actually accepted what we stored.
    const stored = readArmorCacheEntries(characterId).length;
    return {stored, skippedOversized, skippedInvalid, error: null};
  } catch (reason) {
    // An unavailable/full storage must not interrupt the actual Bungie item fetches.
    return {
      stored: readArmorCacheEntries(characterId).length,
      skippedOversized,
      skippedInvalid,
      error: reason instanceof Error ? reason.name : "sessionStorage unavailable",
    };
  }
}

/** Phase 8D.1: explicitly chosen preview changes only. No Bungie write operations. */
type PreviewFeedback = { kind: "success" | "error"; message: string };

type PreviewSource = "character" | "vault" | "otherGuardian";

function rawGearSlot(item: InventoryItem): number | null {
  return item.equipmentSlotHash ?? item.bucketHash ?? null;
}

/** The Builder needs the *complete* API item, never the engine's short KnownItem. */
function findRawCandidate(
  candidate: RecommendationCandidate,
  core: CoreSnapshot,
  account: AccountSnapshot | null,
): InventoryItem | null {
  const items = candidate.origin === "vault" ? account?.vault ?? []
    : candidate.origin === "other_guardian" ? account?.otherGuardianItems ?? []
      : [...core.equipment, ...core.inventory];
  return items.find((item) =>
    item.itemInstanceId === candidate.id &&
    item.itemHash === candidate.item.itemHash &&
    item.category === candidate.item.category &&
    rawGearSlot(item) === candidate.replaceSlotHash
  ) ?? null;
}

function previewApplyBlocker(
  candidate: RecommendationCandidate | null,
  context: BuildContext | null,
  core: CoreSnapshot | null,
  account: AccountSnapshot | null,
  details: Record<string, ItemDetail>,
  characterId: string,
  compatibility: CompatibilityReport | null,
): string | null {
  if (!candidate || !context || !core) return "Choose an inspected candidate first.";
  if (context.guardian.characterId !== characterId) return "Guardian context changed; refresh before applying.";
  if (!account || !context.account.complete) return "Wait for the account inventory to finish loading.";
  if (candidate.item.category !== "weapon" && candidate.item.category !== "armor") return "Only weapons and armor can be previewed.";
  if (!candidate.id || candidate.item.itemInstanceId !== candidate.id ||
      candidate.item.availability !== "owned" || candidate.item.positionStatus !== "confirmed" ||
      !candidate.item.position || candidate.item.position.startsWith("unknown:")) {
    return "Item identity or location is not verified.";
  }
  const current = context.build.gear.find((gear) =>
    gear.slotHash === candidate.replaceSlotHash && gear.item.category === candidate.item.category);
  if (!current || !candidate.replaceItemInstanceId ||
      current.item.itemInstanceId !== candidate.replaceItemInstanceId) {
    return "Current slot changed; inspect the build again before applying.";
  }
  if (context.build.gear.some((gear) => gear.slotHash !== candidate.replaceSlotHash &&
      gear.item.itemInstanceId === candidate.id)) {
    return "This exact item is already selected in another slot.";
  }
  if (candidate.item.category === "armor" &&
      candidate.item.classType !== 3 && candidate.item.classType !== context.guardian.classType) {
    return "This armor does not match the current Guardian class.";
  }
  const detail = details[candidate.id];
  if (!detail || detail.itemInstanceId !== candidate.id || detail.itemHash !== candidate.item.itemHash) {
    return "Load and verify this candidate's exact Bungie item details first.";
  }
  // A catalog-backed hypothetical gain is valid *inspection evidence*, even
  // when text effect tags are empty. Never allow possible/rolled plugs alone.
  const hasEvidence = candidate.evidence.length > 0 ||
    candidate.mechanics.added.length > 0 || candidate.mechanics.addedChains.length > 0;
  if (!hasEvidence) return "No selected-perk or exact-catalog evidence supports this preview.";
  // Block only documented hard conflicts. Unknown set data and conditional
  // mechanics stay visible in the UI and are NOT silently treated as invalid.
  const hardConflict = compatibility?.findings.find((finding) => finding.status === "incompatible");
  if (hardConflict) return `Compatibility conflict — ${hardConflict.subject}: ${hardConflict.reason}`;
  if (!compatibility) return "Compatibility report unavailable; reload the candidate details.";
  return findRawCandidate(candidate, core, account)
    ? null : "The original Bungie inventory item is unavailable; refresh the account data.";
}

/** Merge only the chosen slot; never overwrite other subclass/artifact/gear choices. */
function preparePreviewDraft(
  candidate: RecommendationCandidate,
  core: CoreSnapshot,
  account: AccountSnapshot,
  existing: BuilderDraft,
): { next: BuilderDraft; restoredEquipped: boolean } {
  const rawItem = findRawCandidate(candidate, core, account);
  if (!rawItem) throw new Error("Candidate item is no longer available in the original Bungie data.");
  const key = String(candidate.replaceSlotHash);
  const nextGear = { ...(existing.previewGear ?? {}) };
  if (Object.entries(nextGear).some(([slot, selected]) =>
    slot !== key && selected?.item?.itemInstanceId === candidate.id)) {
    throw new Error("This exact instance is already used in another preview slot.");
  }
  const equipped = core.equipment.find((item) =>
    rawGearSlot(item) === candidate.replaceSlotHash && item.category === candidate.item.category);
  const restoredEquipped = Boolean(equipped?.itemInstanceId === candidate.id);
  if (restoredEquipped) delete nextGear[key];
  else {
    const source: PreviewSource = candidate.origin === "vault" ? "vault"
      : candidate.origin === "other_guardian" ? "otherGuardian" : "character";
    nextGear[key] = { item: rawItem, source };
  }
  return { next: { ...existing, previewGear: nextGear }, restoredEquipped };
}

function getClassType(className: string): number | null {
  if (className === "Titan") return 0;
  if (className === "Hunter") return 1;
  if (className === "Warlock") return 2;
  return null;
}

function countDetails(context: ReturnType<typeof createBuildContext>): number {
  return context.build.gear.filter((gear) => gear.detailsLoaded).length;
}

const smallHeading = "text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/55";
const card = "border border-white/10 bg-[#0b0e14] p-4";

type ArmorSearchSnapshot = {
  baseline: {
    guardian: Guardian | null;
    core: CoreSnapshot | null;
    account: AccountSnapshot | null;
    draft: BuilderDraft | null;
    activity: ActivityKind;
    mode: BuildMode;
    goal: string;
  };
  context: BuildContext;
  details: Record<string, ItemDetail>;
  facts: ReturnType<typeof collectCompatibilityFacts>;
  request: ArmorOptimizationRequest;
  report: ArmorOptimizationReport;
};

/** B2: one user-initiated, capped progressive search. No background polling. */
type ArmorAutoStatus = "idle" | "running" | "stopping" | "complete" | "limit" | "stopped" | "failed";
type ArmorAutoProgress = {status: ArmorAutoStatus; attempted: number; successful: number; failures: number};
const ARMOR_AUTO_MAX_REQUESTS = 32; // At most four 8-item batches per click.
const ARMOR_AUTO_BATCH_SIZE = 8;
const ARMOR_AUTO_CONCURRENCY = 2;
const ARMOR_AUTO_BATCH_PAUSE_MS = 350;
type ArmorAutoRun = {
  cancelled: boolean;
  generation: number;
  characterId: string;
  guardian: Guardian;
  core: CoreSnapshot;
  account: AccountSnapshot;
  draft: BuilderDraft | null;
  activity: ActivityKind;
  mode: BuildMode;
  goal: string;
};

/** Locate ONLY a verified raw snapshot instance; never create a fake InventoryItem from KnownItem. */
function findOwnedArmorRaw(
  itemInstanceId: string,
  itemHash: number,
  slotHash: number,
  core: CoreSnapshot,
  account: AccountSnapshot,
): { item: InventoryItem; source: PreviewSource } | null {
  const collections: Array<{ items: InventoryItem[]; source: PreviewSource }> = [
    { items: [...core.equipment, ...core.inventory], source: "character" },
    { items: account.vault, source: "vault" },
    { items: account.otherGuardianItems, source: "otherGuardian" },
  ];
  for (const collection of collections) {
    const match = collection.items.find((item) =>
      item.itemInstanceId === itemInstanceId && item.itemHash === itemHash &&
      item.category === "armor" && rawGearSlot(item) === slotHash
    );
    if (match) return { item: match, source: collection.source };
  }
  return null;
}

export default function BuildEnginePreviewPage() {
  const params = useParams();
  const characterId = String(params.characterId ?? "");
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [guardian, setGuardian] = useState<Guardian | null>(null);
  const [core, setCore] = useState<CoreSnapshot | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [details, setDetails] = useState<Record<string, ItemDetail>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [exoticReplacementLoading, setExoticReplacementLoading] = useState(false);
  const [exoticReplacementError, setExoticReplacementError] = useState("");
  const [activity, setActivity] = useState<ActivityKind>("general");
  const [mode, setMode] = useState<BuildMode>("owned");
  const [goal, setGoal] = useState("");
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [findingFilter, setFindingFilter] = useState<"all" | "shared_effect" | "related_effects">("all");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [showAllEffects, setShowAllEffects] = useState(false);
  const [focusEffect, setFocusEffect] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [candidateDetailsLoading, setCandidateDetailsLoading] = useState(false);
  const [candidateDetailError, setCandidateDetailError] = useState("");
  const [candidateBatchProgress, setCandidateBatchProgress] = useState(0);
  const [pendingPreviewId, setPendingPreviewId] = useState<string | null>(null);
  const [previewFeedback, setPreviewFeedback] = useState<PreviewFeedback | null>(null);
  // Armor Optimizer is an explicit, bounded search; never run on every render.
  const [armorWeights, setArmorWeights] = useState<Record<number, number>>({
    1735777505: 5, 392767087: 3, 2996146975: 1,
  });
  const [armorMinimums, setArmorMinimums] = useState<Record<number, number>>({});
  // 8R.4.3: explicit trade-off preferences; omitted hash means NO protection,
  // whereas a configured value of 0 means NO LOSS is permitted for that stat.
  const [armorMaxStatLosses, setArmorMaxStatLosses] = useState<Record<number, number>>({});
  const [armorLossAversion, setArmorLossAversion] = useState(0);
  // 8R.4.4 — explicit, exact-catalog mechanical preferences.
  const [armorProtectedMechanicIds, setArmorProtectedMechanicIds] = useState<string[]>([]);
  const [armorProtectedChainIds, setArmorProtectedChainIds] = useState<string[]>([]);
  const [armorMechanicLossCost, setArmorMechanicLossCost] = useState(0);
  const [armorChainLossCost, setArmorChainLossCost] = useState(0);
  const [armorSetLossCost, setArmorSetLossCost] = useState(0);
  const [armorKeepExotic, setArmorKeepExotic] = useState(true);
  const [armorLockedIds, setArmorLockedIds] = useState<string[]>([]);
  const [armorRequiredSet, setArmorRequiredSet] = useState("");
  const [armorRequiredPieces, setArmorRequiredPieces] = useState(2);
  const [armorSearch, setArmorSearch] = useState<ArmorSearchSnapshot | null>(null);
  const [armorAutoProgress, setArmorAutoProgress] = useState<ArmorAutoProgress>({
    status: "idle", attempted: 0, successful: 0, failures: 0,
  });
  const [armorLoadError, setArmorLoadError] = useState("");
  const [armorPendingId, setArmorPendingId] = useState<string | null>(null);
  const [armorPreviewFeedback, setArmorPreviewFeedback] = useState<PreviewFeedback | null>(null);
  const [armorCacheStatus, setArmorCacheStatus] = useState<ArmorCacheStatus>({
    stored: 0, restored: null, skippedOversized: 0, skippedInvalid: 0, error: null,
  });
  const detailsGuardianRef = useRef(characterId);
  const updateArmorCacheStatus = useCallback((next: ReturnType<typeof cacheFetchedArmorDetails>) => {
    setArmorCacheStatus((previous) => ({
      stored: next.stored,
      restored: previous.restored,
      skippedOversized: previous.skippedOversized + next.skippedOversized,
      skippedInvalid: previous.skippedInvalid + next.skippedInvalid,
      error: next.error ?? previous.error,
    }));
  }, []);
  // Prevent simultaneous detail batches and late responses after a Guardian/context reload.
  const detailBusyRef = useRef(false);
  const contextGenerationRef = useRef(0);
  const armorAutoRunRef = useRef<ArmorAutoRun | null>(null);
  const cancelArmorAutoRun = useCallback(() => {
    const running = armorAutoRunRef.current;
    if (running) {
      running.cancelled = true;
      setArmorAutoProgress((old) => old.status === "running" ? {...old, status: "stopping"} : old);
    }
  }, []);
  // B1: automatically fetch selected-build details once per completed account
  // snapshot. No retry loop on failed/malformed responses; the manual button
  // remains available for a deliberate retry.
  const autoSelectedRunRef = useRef<{characterId: string; generation: number} | null>(null);
  const AUTO_SELECTED_DETAIL_LIMIT = 12;

  const loadSnapshots = useCallback(async () => {
    cancelArmorAutoRun();
    armorAutoRunRef.current = null;
    setArmorAutoProgress({status: "idle", attempted: 0, successful: 0, failures: 0});
    const generation = ++contextGenerationRef.current;
    setSyncing(true);
    setError("");
    setAccountError("");
    setAccount(null); // No stale account scope must masquerade as complete.
    setCore(null);
    // Preserve existing verified details in RAM for a same-Guardian refresh. The
    // finished snapshot will reconcile identity/hash before any results can use them.
    // On Guardian switch, never carry prior Guardian details into the new account.
    if (detailsGuardianRef.current !== characterId) {
      detailsGuardianRef.current = characterId;
      setDetails({});
    }
    setArmorSearch(null);
    setArmorPendingId(null);
    setArmorPreviewFeedback(null);
    // User-selected mechanic/chain preferences survive a voluntary context refresh.
    // Unknown IDs are already filtered when constructing a new search request.
    // Progress was already reset above via setArmorAutoProgress.
    setArmorLoadError("");
    setCandidateDetailError("");
    setCandidateBatchProgress(0);
    setSelectedCandidateId(null);
    setPendingPreviewId(null);
    setPreviewFeedback(null);
    setFocusEffect(null);
    setDraft(readBuilderDraft(characterId));
    try {
      const [guardiansData, coreData] = await Promise.all([
        fetchJson("/api/destiny/characters"),
        fetchJson(`/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=core`),
      ]);
      if (generation !== contextGenerationRef.current) return;
      const list = Array.isArray(guardiansData.characters) ? guardiansData.characters as Guardian[] : [];
      const selected = list.find((item) => item.characterId === characterId);
      if (!selected) throw new Error("The selected Guardian was not found in your Bungie account.");
      setGuardians(list);
      setGuardian(selected);
      const nextCore: CoreSnapshot = {
        equipment: Array.isArray(coreData.equipment) ? coreData.equipment as CoreSnapshot["equipment"] : [],
        inventory: Array.isArray(coreData.inventory) ? coreData.inventory as CoreSnapshot["inventory"] : [],
        subclasses: Array.isArray(coreData.subclasses) ? coreData.subclasses as CoreSnapshot["subclasses"] : [],
        subclassSetup: coreData.subclassSetup as CoreSnapshot["subclassSetup"] ?? null,
        artifact: (coreData.artifact ?? coreData.seasonalArtifact ?? null) as CoreSnapshot["artifact"],
      };
      setCore(nextCore);
      setLoading(false); // Core is ready; account scope loads separately.
      setAccountLoading(true);
      try {
        const accountData = await fetchJson(
          `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=account`
        );
        if (generation !== contextGenerationRef.current) return;
        const nextAccount: AccountSnapshot = {
          vault: Array.isArray(accountData.vault) ? accountData.vault as AccountSnapshot["vault"] : [],
          otherGuardianItems: Array.isArray(accountData.otherGuardianItems)
            ? accountData.otherGuardianItems as AccountSnapshot["otherGuardianItems"] : [],
        };
        const owned = observedOwnedInstances(nextCore, nextAccount);
        const restored = restoreArmorDetailCache(characterId, nextCore, nextAccount);
        setDetails((current) => ({
          ...restored.details,
          ...reconcileCurrentDetails(current, owned),
        }));
        setArmorCacheStatus({
          stored: restored.stored, restored: restored.restored,
          skippedOversized: 0, skippedInvalid: 0, error: null,
        });
        setAccount(nextAccount);
      } catch (reason) {
        if (generation === contextGenerationRef.current)
          setAccountError(reason instanceof Error ? reason.message : "Account inventory unavailable");
      } finally {
        if (generation === contextGenerationRef.current) setAccountLoading(false);
      }
    } catch (reason) {
      if (generation === contextGenerationRef.current)
        setError(reason instanceof Error ? reason.message : "Unable to build a Guardian snapshot");
    } finally {
      if (generation === contextGenerationRef.current) {
        setSyncing(false);
        setLoading(false);
      }
    }
  }, [characterId, cancelArmorAutoRun]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  // If the preview changes in another tab, read the latest draft. A focus event
  // alone must NOT replace an unchanged object: that would rebuild the context
  // and invalidate an otherwise current Armor Optimizer result.
  useEffect(() => {
    const storageKey = `destiny-builder-draft:${characterId}`;
    const readAgain = () => {
      let stored: string | null;
      try {
        stored = window.localStorage.getItem(storageKey);
      } catch {
        return; // Storage may be unavailable; do not discard the active preview.
      }
      setDraft((current) => {
        const currentSerialized = current === null ? null : JSON.stringify(current);
        return stored === currentSerialized ? current : readBuilderDraft(characterId);
      });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) readAgain();
    };
    window.addEventListener("focus", readAgain);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", readAgain);
      window.removeEventListener("storage", onStorage);
    };
  }, [characterId]);

  const context = useMemo(() => {
    if (!guardian || !core) return null;
    return createBuildContext({
      guardian: { characterId, className: guardian.className,
        classType: getClassType(guardian.className), light: guardian.light ?? null },
      core,
      account,
      draft,
      detailsByInstanceId: details,
      activity,
      mode,
      goal,
    });
  }, [guardian, characterId, core, account, draft, details, activity, mode, goal]);

  // Separate live-equipped reference: deliberately NO local preview draft.
  // Used for an optional side-by-side display, NEVER for ranking or for writes.
  const bungieEquippedContext = useMemo(() => {
    if (!guardian || !core) return null;
    return createBuildContext({
      guardian: { characterId, className: guardian.className,
        classType: getClassType(guardian.className), light: guardian.light ?? null },
      core, account, draft: null, detailsByInstanceId: details,
      activity, mode, goal,
    });
  }, [guardian, characterId, core, account, details, activity, mode, goal]);

  // Pure, synchronous analysis of selected BuildContext only.
  // It never starts an API request or mutates Bungie / Builder Preview.
  const synergyReport = useMemo(() => context ? analyzeBuildSynergies(context) : null, [context]);
  const mechanicsReport = useMemo(() => context ? resolveBuildMechanics(context) : null, [context]);
  // Read-only engine: only fully verified item instances can enter the candidate list.
  // Goal/activity are contextual metadata, not guessed gameplay ranking criteria.
  const recommendationReport = useMemo(() => context && synergyReport
    ? findGearRecommendations(context, details, {
        synergyReport,
        focusEffectKeys: focusEffect ? [focusEffect] : undefined,
        maxResults: 20,
        maxDetailRequests: 8,
      })
    : null, [context, details, synergyReport, focusEffect]);
  const chosenCandidate = recommendationReport?.recommendations.find((candidate) => candidate.id === selectedCandidateId)
    ?? recommendationReport?.recommendations[0] ?? null;
  // Only read observed core/account/detail metadata. Never infer rarity or
  // set membership from item names or an incomplete Manifest possibility list.
  const compatibilityFacts = useMemo(() => core
    ? collectCompatibilityFacts(core, account, details) : {}, [core, account, details]);
  // 8R.6.1B — Read-only planning coverage, updated from the same verified snapshots.
  // No fetches, storage, AI requests, or optimizer mutation are triggered here.
  const universalPlanningContext = useMemo(() => context && core
    ? createUniversalPlanningContext({
        context,
        core,
        detailsByInstanceId: details,
        armorFacts: compatibilityFacts,
        mechanicsReport,
      })
    : null, [context, core, details, compatibilityFacts, mechanicsReport]);
  const currentCompatibility = useMemo(() => context
    ? validateBuildCompatibility(context, compatibilityFacts, mechanicsReport ?? undefined)
    : null, [context, compatibilityFacts, mechanicsReport]);
  const candidateCompatibility = useMemo(() => context && chosenCandidate
    ? validateCandidateReplacement(context, {
        replaceSlotHash: chosenCandidate.replaceSlotHash,
        candidate: chosenCandidate.item,
        candidateDetail: details[chosenCandidate.id] ?? null,
      }, compatibilityFacts)
    : null, [context, chosenCandidate, details, compatibilityFacts]);
  const availableArmorSets = useMemo(() => {
    const known = new Map<number, string>();
    for (const fact of Object.values(compatibilityFacts)) {
      if (fact.conflicting || fact.setHash === null) continue;
      known.set(fact.setHash, fact.setName || `Bungie set ${fact.setHash}`);
    }
    return [...known].sort((a, b) => a[1].localeCompare(b[1]));
  }, [compatibilityFacts]);
  // Detail batches rebuild BuildContext, but other snapshot inputs stay fixed.
  // Never hide a result merely because React recreated a derived object.
  // Conversely, never keep a search after its Guardian/Preview/settings changed.
  const activeArmorSearch = armorSearch && context && armorSearch.details === details &&
    armorSearch.baseline.guardian === guardian &&
    armorSearch.baseline.core === core && armorSearch.baseline.account === account &&
    armorSearch.baseline.draft === draft && armorSearch.baseline.activity === activity &&
    armorSearch.baseline.mode === mode && armorSearch.baseline.goal === goal
    ? armorSearch : null;

  // A change to the preview or search context must stop a still-running search.
  // Detail updates made by the worker do NOT affect these baseline references.
  useEffect(() => {
    const run = armorAutoRunRef.current;
    if (run && (run.characterId !== characterId || run.guardian !== guardian ||
        run.core !== core || run.account !== account || run.draft !== draft ||
        run.activity !== activity || run.mode !== mode || run.goal !== goal)) {
      cancelArmorAutoRun();
    }
  }, [characterId, guardian, core, account, draft, activity, mode, goal, cancelArmorAutoRun]);

  useEffect(() => () => {
    // Unmount/route switch: stop scheduling requests and discard late responses.
    if (armorAutoRunRef.current) armorAutoRunRef.current.cancelled = true;
    armorAutoRunRef.current = null;
  }, []);

  const invalidateArmorSearch = () => {
    cancelArmorAutoRun();
    armorAutoRunRef.current = null;
    setArmorAutoProgress({status: "idle", attempted: 0, successful: 0, failures: 0});
    setArmorSearch(null);
    setArmorPendingId(null);
    setArmorPreviewFeedback(null);
  };

  const getArmorSearchRequest = (): ArmorOptimizationRequest | null => {
    if (!context) return null;
    const selectedSet = armorRequiredSet.trim();
    if (selectedSet && !availableArmorSets.some(([hash]) => String(hash) === selectedSet)) return null;
    return {
      context, detailsByInstanceId: details, facts: compatibilityFacts,
      priorities: ARMOR_3_STATS.map((stat) => ({ statHash: stat.statHash, weight: armorWeights[stat.statHash] ?? 0 })),
      minimums: ARMOR_3_STATS.filter((stat) => (armorMinimums[stat.statHash] ?? 0) > 0)
        .map((stat) => ({ statHash: stat.statHash, value: armorMinimums[stat.statHash] })),
      lossAversion: armorLossAversion,
      protectedMechanicIds: armorProtectedMechanicIds.filter((id) =>
        mechanicsReport?.mechanics.some((mechanic) => mechanic.id === id)),
      protectedChainIds: armorProtectedChainIds.filter((id) =>
        mechanicsReport?.chains.some((chain) => chain.id === id)),
      mechanicLossCost: armorMechanicLossCost,
      chainLossCost: armorChainLossCost,
      setThresholdLossCost: armorSetLossCost,
      equippedReferenceContext: bungieEquippedContext ?? undefined,
      maxStatLosses: ARMOR_3_STATS.filter((stat) =>
        Object.prototype.hasOwnProperty.call(armorMaxStatLosses, stat.statHash))
        .map((stat) => ({ statHash: stat.statHash, value: armorMaxStatLosses[stat.statHash] })),
      lockedInstanceIds: armorLockedIds,
      preserveCurrentExotic: armorKeepExotic,
      requiredSet: selectedSet ? { setHash: Number(selectedSet), minPieces: armorRequiredPieces } : undefined,
      maxResults: 5,
      maxSearchNodes: 150000,
    };
  };

  // Reruns only once per 8 newly verified armor details, not on every render.
  // The current user preferences are captured in the original request; each new
  // context/fact snapshot is rebuilt deterministically as details arrive.
  const startArmorAutoLoad = async (initialRequest: ArmorOptimizationRequest,
    initialReport: ArmorOptimizationReport) => {
    if (!guardian || !core || !account || detailBusyRef.current || armorAutoRunRef.current) return;
    const run: ArmorAutoRun = {
      cancelled: false, generation: contextGenerationRef.current, characterId,
      guardian, core, account, draft, activity, mode, goal,
    };
    armorAutoRunRef.current = run;
    detailBusyRef.current = true;
    setArmorAutoProgress({status: "running", attempted: 0, successful: 0, failures: 0});
    setArmorLoadError("");
    let attempted = 0;
    let successful = 0;
    let failures = 0;
    let nextDetails = initialRequest.detailsByInstanceId as Record<string, ItemDetail>;
    let report = initialReport;
    const tried = new Set<string>();
    const current = () => !run.cancelled && armorAutoRunRef.current === run &&
      run.generation === contextGenerationRef.current;
    let outcome: ArmorAutoStatus = "complete";
    try {
      while (current() && attempted < ARMOR_AUTO_MAX_REQUESTS) {
        const queue = report.missingDetails.filter((item) =>
          item.reason === "not_loaded" && !nextDetails[item.itemInstanceId] && !tried.has(item.itemInstanceId));
        if (!queue.length) break;
        const batch = queue.slice(0, Math.min(ARMOR_AUTO_BATCH_SIZE, ARMOR_AUTO_MAX_REQUESTS - attempted));
        const found: ItemDetail[] = [];
        for (let index = 0; index < batch.length && current(); index += ARMOR_AUTO_CONCURRENCY) {
          const pair = batch.slice(index, index + ARMOR_AUTO_CONCURRENCY);
          const responses = await Promise.all(pair.map(async (item): Promise<ItemDetail | null> => {
            try {
              const body = await fetchJson(
                `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(item.itemInstanceId)}&itemHash=${item.itemHash}`
              );
              const result = body.item as ItemDetail | undefined;
              return result && result.itemInstanceId === item.itemInstanceId &&
                result.itemHash === item.itemHash && Array.isArray(result.armorStats) &&
                result.armorStats.length > 0 ? result : null;
            } catch {
              return null;
            }
          }));
          if (!current()) break;
          for (let offset = 0; offset < pair.length; offset++) {
            tried.add(pair[offset].itemInstanceId);
            attempted++;
            if (responses[offset]) {
              found.push(responses[offset]!);
              successful++;
            } else failures++;
          }
          setArmorAutoProgress({status: "running", attempted, successful, failures});
        }
        if (!current()) break;
        if (found.length) {
          updateArmorCacheStatus(cacheFetchedArmorDetails(characterId, found));
          nextDetails = { ...nextDetails };
          for (const detail of found) nextDetails[detail.itemInstanceId] = detail;
          // No other detail loader is allowed while this worker holds the guard.
          setDetails(nextDetails);
          const identity = {
            characterId, className: run.guardian.className,
            classType: getClassType(run.guardian.className), light: run.guardian.light ?? null,
          };
          const nextContext = createBuildContext({
            guardian: identity, core: run.core, account: run.account, draft: run.draft,
            detailsByInstanceId: nextDetails, activity: run.activity, mode: run.mode, goal: run.goal,
          });
          const nextFacts = collectCompatibilityFacts(run.core, run.account, nextDetails);
          const nextEquippedContext = createBuildContext({
            guardian: identity, core: run.core, account: run.account, draft: null,
            detailsByInstanceId: nextDetails, activity: run.activity, mode: run.mode, goal: run.goal,
          });
          const request: ArmorOptimizationRequest = {
            ...initialRequest, context: nextContext, detailsByInstanceId: nextDetails,
            facts: nextFacts, equippedReferenceContext: nextEquippedContext,
          };
          report = optimizeOwnedArmor(request);
          if (!current()) break;
          setArmorSearch({baseline: run, context: nextContext, details: nextDetails, facts: nextFacts, request, report});
        }
        if (!current()) break;
        if (attempted < ARMOR_AUTO_MAX_REQUESTS &&
            report.missingDetails.some((part) => part.reason === "not_loaded" &&
              !nextDetails[part.itemInstanceId] && !tried.has(part.itemInstanceId))) {
          await new Promise<void>((resolve) => setTimeout(resolve, ARMOR_AUTO_BATCH_PAUSE_MS));
        }
      }
      if (current()) {
        const remaining = report.missingDetails.some((part) =>
          part.reason === "not_loaded" && !nextDetails[part.itemInstanceId] && !tried.has(part.itemInstanceId));
        outcome = remaining && attempted >= ARMOR_AUTO_MAX_REQUESTS ? "limit" :
          failures > 0 ? "failed" : "complete";
      } else outcome = "stopped";
    } catch (reason) {
      outcome = "failed";
      if (current()) {
        setArmorLoadError(reason instanceof Error ? reason.message : "Progressive armor search interrupted.");
        setArmorSearch(null); // Never present a report with mismatched context/detail inputs.
      }
    } finally {
      if (armorAutoRunRef.current === run) {
        armorAutoRunRef.current = null;
        setArmorAutoProgress({status: run.cancelled ? "stopped" : outcome, attempted, successful, failures});
        if (!run.cancelled && failures > 0)
          setArmorLoadError(`${failures} detail request(s) failed or returned invalid data. The remaining verified results were kept; you can retry explicitly.`);
      }
      detailBusyRef.current = false;
    }
  };

  const runArmorSearch = () => {
    if (detailBusyRef.current || armorAutoRunRef.current) return;
    setArmorPendingId(null);
    setArmorPreviewFeedback(null);
    if (!context || !core || !account || !context.account.complete) {
      setArmorLoadError("Wait for the Guardian and account inventory to finish loading before optimizing.");
      return;
    }
    const request = getArmorSearchRequest();
    if (!request) {
      setArmorLoadError("Select a verified Bungie set or choose No set requirement.");
      return;
    }
    setArmorLoadError("");
    try {
      const report = optimizeOwnedArmor(request);
      setArmorSearch({
        baseline: {guardian, core, account, draft, activity, mode, goal},
        context, details, facts: compatibilityFacts, request, report,
      });
      // Only an explicit search click starts the capped, progressive loader.
      if (report.missingDetails.some((part) => part.reason === "not_loaded" && !details[part.itemInstanceId]))
        void startArmorAutoLoad(request, report);
      else setArmorAutoProgress({status: "complete", attempted: 0, successful: 0, failures: 0});
    } catch (reason) {
      setArmorLoadError(reason instanceof Error ? reason.message : "Armor search could not complete.");
      setArmorSearch(null);
    }
  };

  const confirmArmorPreview = () => {
    if (detailBusyRef.current || armorAutoRunRef.current || !activeArmorSearch ||
        !context || !core || !account || !armorPendingId) return;
    if (!context.account.complete || context.guardian.characterId !== characterId) return;
    try {
      // Re-evaluate at the confirmation boundary; only currently valid, ranked,
      // exact-instance combinations may be previewed.
      const fresh = optimizeOwnedArmor(activeArmorSearch.request);
      const picked = fresh.results.find((result) => result.id === armorPendingId);
      if (!picked || picked.compatibility.status === "incompatible")
        throw new Error("This combination is no longer verifiable. Search again before previewing.");
      const storageKey = `destiny-builder-draft:${characterId}`;
      const stored = window.localStorage.getItem(storageKey);
      const latest = readBuilderDraft(characterId);
      if (stored !== null && !latest)
        throw new Error("Existing Builder Preview data is invalid; nothing was overwritten.");
      const currentBySlot = new Map(context.build.gear.filter((gear) => gear.item.category === "armor")
        .map((gear) => [gear.slotHash, gear.item.itemInstanceId]));
      const nextGear = { ...(latest?.previewGear ?? {}) };
      const used = new Set<string>();
      for (const part of picked.parts) {
        const slotKey = String(part.slotHash);
        const equipped = core.equipment.find((item) =>
          item.category === "armor" && rawGearSlot(item) === part.slotHash);
        const observed = latest?.previewGear?.[slotKey]?.item ?? equipped;
        if (!observed || observed.itemInstanceId !== currentBySlot.get(part.slotHash))
          throw new Error(`The Builder Preview changed in ${part.slotName}. Refresh and search again.`);
        if (used.has(part.itemInstanceId)) throw new Error("The same armor instance appears twice.");
        used.add(part.itemInstanceId);
        const raw = findOwnedArmorRaw(part.itemInstanceId, part.itemHash, part.slotHash, core, account);
        if (!raw) throw new Error(`${part.name} is no longer in a verified inventory location.`);
        const knownFact = compatibilityFacts[part.itemInstanceId];
        if (!knownFact || knownFact.conflicting || knownFact.exotic !== part.exotic)
          throw new Error(`${part.name} no longer has verified item metadata.`);
        if (equipped?.itemInstanceId === part.itemInstanceId) delete nextGear[slotKey];
        else nextGear[slotKey] = { item: raw.item, source: raw.source };
      }
      const next: BuilderDraft = { ...(latest ?? {}), previewGear: nextGear };
      const serialized = JSON.stringify(next);
      window.localStorage.setItem(storageKey, serialized);
      if (window.localStorage.getItem(storageKey) !== serialized)
        throw new Error("Unable to confirm that the Builder Preview was saved.");
      setDraft(next);
      setArmorPendingId(null);
      setArmorSearch(null);
      setArmorPreviewFeedback({ kind: "success", message: `Preview updated with ${picked.changes} armor swap(s). No Bungie equipment change was made.` });
    } catch (error) {
      setArmorPendingId(null);
      setArmorPreviewFeedback({ kind: "error", message: error instanceof Error ? error.message : "Unable to apply armor preview." });
    }
  };

  const previewBlocker = previewApplyBlocker(chosenCandidate, context, core, account, details, characterId, candidateCompatibility);

  // Deliberately requires a second, explicit click. Recheck the actual draft
  // at confirmation time to avoid clobbering a newer edit from another tab.
  const confirmCandidatePreview = () => {
    if (!chosenCandidate || pendingPreviewId !== chosenCandidate.id || !context || !core || !account) return;
    // Re-run the validator at the confirmation boundary, not just at render.
    const recheckedCompatibility = validateCandidateReplacement(context, {
      replaceSlotHash: chosenCandidate.replaceSlotHash,
      candidate: chosenCandidate.item,
      candidateDetail: details[chosenCandidate.id] ?? null,
    }, compatibilityFacts);
    const blocker = previewApplyBlocker(chosenCandidate, context, core, account, details, characterId, recheckedCompatibility);
    if (blocker) {
      setPreviewFeedback({ kind: "error", message: blocker });
      setPendingPreviewId(null);
      return;
    }
    try {
      const key = `destiny-builder-draft:${characterId}`;
      const raw = window.localStorage.getItem(key);
      const latestDraft = readBuilderDraft(characterId);
      if (raw !== null && !latestDraft) throw new Error("Existing Builder draft is invalid. Nothing was overwritten.");
      const originalEquipped = core.equipment.find((item) =>
        rawGearSlot(item) === chosenCandidate.replaceSlotHash && item.category === chosenCandidate.item.category);
      const latestBaseline = latestDraft?.previewGear?.[String(chosenCandidate.replaceSlotHash)]?.item ?? originalEquipped;
      if (!latestBaseline || latestBaseline.itemInstanceId !== chosenCandidate.replaceItemInstanceId) {
        setDraft(latestDraft);
        throw new Error("The Builder preview changed after this recommendation. Nothing was overwritten; inspect the current build and try again.");
      }
      const { next, restoredEquipped } = preparePreviewDraft(chosenCandidate, core, account, latestDraft ?? {});
      window.localStorage.setItem(key, JSON.stringify(next));
      // Read back the persisted result before reporting success.
      if (window.localStorage.getItem(key) !== JSON.stringify(next)) throw new Error("Builder draft could not be verified after saving.");
      setDraft(next);
      setPendingPreviewId(null);
      setPreviewFeedback({ kind: "success", message: restoredEquipped
        ? `${chosenCandidate.item.name}: restored the equipped item in Builder Preview. Other choices were preserved.`
        : `${chosenCandidate.item.name}: added to Builder Preview. Other gear, subclass and Artifact choices were preserved.` });
    } catch (reason) {
      setPendingPreviewId(null);
      setPreviewFeedback({ kind: "error", message: reason instanceof Error ? reason.message : "Unable to save Builder Preview." });
    }
  };

  const visibleFindings = useMemo(() => synergyReport?.findings.filter((finding) =>
    findingFilter === "all" || finding.kind === findingFilter) ?? [], [synergyReport, findingFilter]);
  const selectedFinding = visibleFindings.find((finding) => finding.id === selectedFindingId) ?? visibleFindings[0] ?? null;

  const missingDetails = useMemo(() => {
    if (!context) return [];
    const seen = new Set<string>();
    return [...context.build.gear.map((gear) => gear.item), context.build.artifact.item]
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .filter((item) => {
        if (!item.itemInstanceId || details[item.itemInstanceId] || seen.has(item.itemInstanceId)) return false;
        seen.add(item.itemInstanceId);
        return true;
      });
  }, [context, details]);

  const resolveSelectedDetails = useCallback(async (limit = Number.POSITIVE_INFINITY) => {
    const queued = missingDetails.slice(0, limit);
    if (detailBusyRef.current || !queued.length) return;
    detailBusyRef.current = true;
    const generation = contextGenerationRef.current;
    setDetailsLoading(true);
    setDetailError("");
    // Bounded batches: never fetch details for every Vault item on this page.
    let failures = 0;
    for (let index = 0; index < queued.length; index += 2) {
      const batch = queued.slice(index, index + 2);
      const results = await Promise.all(batch.map(async (item) => {
        try {
          const result = await fetchJson(
            `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(item.itemInstanceId ?? "")}&itemHash=${item.itemHash}`
          );
          const detail = result.item as ItemDetail | undefined;
          // Never persist or use a mismatched instance/hash response.
          if (!detail || detail.itemInstanceId !== item.itemInstanceId || detail.itemHash !== item.itemHash) {
            failures += 1;
            return undefined;
          }
          return detail;
        } catch {
          failures += 1;
          return undefined;
        }
      }));
      if (generation !== contextGenerationRef.current) break;
      updateArmorCacheStatus(cacheFetchedArmorDetails(characterId, results));
      setDetails((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result?.itemInstanceId) next[result.itemInstanceId] = result;
        }
        return next;
      });
    }
    if (failures && generation === contextGenerationRef.current) setDetailError(`${failures} item details could not be loaded. You can retry.`);
    setDetailsLoading(false);
    detailBusyRef.current = false;
  }, [characterId, missingDetails, updateArmorCacheStatus]);

  // Load details for exotic replacement candidates
  const resolveExoticReplacementDetails = useCallback(async (slotHash: number) => {
    if (!universalPlanningContext || exoticReplacementLoading) return;
    const generation = contextGenerationRef.current;
    const currentCharacterId = characterId;

    // Find items that meet all replacement criteria except detailCoverage
    const usedInstances = new Set(
      universalPlanningContext.gearOptions
        .filter((item) => item.selectedInBuild && item.itemInstanceId !== null)
        .map((item) => item.itemInstanceId!)
    );

    const selectedExotic = universalPlanningContext.gearOptions.find((item) =>
      item.category === "armor" && item.selectedInBuild && item.slotHash === slotHash &&
      item.armorMetadata?.exotic === true);

    if (!selectedExotic) return;

    const candidates = universalPlanningContext.gearOptions.filter((item) =>
      item.category === "armor" && item.slotHash === slotHash &&
      item.itemInstanceId !== selectedExotic.itemInstanceId &&
      item.itemInstanceId !== null &&
      !usedInstances.has(item.itemInstanceId) &&
      item.eligibility === "candidate" &&
      item.positionStatus === "confirmed" &&
      item.armorMetadata?.exotic === false &&
      item.detailCoverage !== "verified");

    // Limit to 4 candidates
    const toLoad = candidates.slice(0, 4);
    if (toLoad.length === 0) return;

    setExoticReplacementLoading(true);
    setExoticReplacementError("");

    // Check which details are already cached
    const missing: Array<{ itemInstanceId: string; itemHash: number }> = [];
    for (const item of toLoad) {
      if (item.itemInstanceId && !details[item.itemInstanceId]) {
        missing.push({ itemInstanceId: item.itemInstanceId, itemHash: item.itemHash });
      }
    }

    if (missing.length === 0) {
      setExoticReplacementLoading(false);
      return;
    }

    let failures = 0;
    const results: ItemDetail[] = [];

    for (const item of missing) {
      if (generation !== contextGenerationRef.current || currentCharacterId !== characterId) break;
      try {
        const result = await fetchJson(
          `/api/destiny/characters/${encodeURIComponent(currentCharacterId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(item.itemInstanceId)}&itemHash=${item.itemHash}`
        );
        const detail = result.item as ItemDetail | undefined;
        if (detail && detail.itemInstanceId === item.itemInstanceId && detail.itemHash === item.itemHash) {
          results.push(detail);
        } else {
          failures++;
        }
      } catch {
        failures++;
      }
    }

    if (generation !== contextGenerationRef.current || currentCharacterId !== characterId) {
      setExoticReplacementLoading(false);
      return;
    }

    updateArmorCacheStatus(cacheFetchedArmorDetails(currentCharacterId, results));
    setDetails((current) => {
      const next = { ...current };
      for (const result of results) {
        if (result.itemInstanceId) next[result.itemInstanceId] = result;
      }
      return next;
    });

    if (failures > 0) {
      setExoticReplacementError(`${failures} item detail${failures === 1 ? "" : "s"} could not be loaded. You can retry.`);
    }

    setExoticReplacementLoading(false);
  }, [universalPlanningContext, characterId, details, exoticReplacementLoading, updateArmorCacheStatus, setDetails]);

  // Start only AFTER core, Vault/other Guardians, and cache reconciliation finish.
  // Run at most once per snapshot generation, even as each detail response causes
  // a React re-render. A refresh may try missing items once again; cache hits cost
  // zero Bungie calls. Other detail loaders always share the same busy guard.
  useEffect(() => {
    if (!core || !account || !context?.account.complete || syncing || accountLoading ||
        loading || error || accountError || detailsLoading || detailBusyRef.current ||
        !missingDetails.length) return;
    const generation = contextGenerationRef.current;
    if (autoSelectedRunRef.current?.characterId === characterId &&
        autoSelectedRunRef.current.generation === generation) return;
    autoSelectedRunRef.current = {characterId, generation};
    void resolveSelectedDetails(AUTO_SELECTED_DETAIL_LIMIT);
  }, [characterId, core, account, context, syncing, accountLoading, loading,
      error, accountError, detailsLoading, missingDetails, resolveSelectedDetails]);

  const resolveCandidateDetails = async () => {
    if (detailBusyRef.current || !recommendationReport?.detailQueue.length) return;
    detailBusyRef.current = true;
    const generation = contextGenerationRef.current;
    // Fixed maximum of 8, supplied by the engine. Only a click triggers these calls.
    const batch = recommendationReport.detailQueue.slice(0, 8);
    setCandidateDetailsLoading(true);
    setCandidateDetailError("");
    setCandidateBatchProgress(0);
    let failed = 0;
    try {
      for (let index = 0; index < batch.length; index += 2) {
        const nextPair = batch.slice(index, index + 2);
        const results = await Promise.all(nextPair.map(async (item) => {
          try {
            const response = await fetchJson(
              `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(item.itemInstanceId)}&itemHash=${item.itemHash}`
            );
            const result = response.item as ItemDetail | undefined;
            // Never allow a detail response for another copy or hash to count.
            if (!result || result.itemInstanceId !== item.itemInstanceId || result.itemHash !== item.itemHash) {
              failed += 1;
              return null;
            }
            return result;
          } catch {
            failed += 1;
            return null;
          }
        }));
        if (generation !== contextGenerationRef.current) break;
        updateArmorCacheStatus(cacheFetchedArmorDetails(characterId, results));
        setDetails((current) => {
          const next = { ...current };
          for (const result of results) if (result) next[result.itemInstanceId] = result;
          return next;
        });
        setCandidateBatchProgress(index + nextPair.length);
      }
      if (failed && generation === contextGenerationRef.current) {
        setCandidateDetailError(`${failed} candidate detail request${failed === 1 ? "" : "s"} failed or returned a different instance. Unverified results were not used; retry the batch if needed.`);
      }
    } finally {
      detailBusyRef.current = false;
      setCandidateDetailsLoading(false);
    }
  };

  const inspection = context ? {
    version: context.version,
    guardian: context.guardian,
    activity: context.activity,
    mode: context.mode,
    goal: context.goal,
    account: { complete: context.account.complete, uniqueItems: context.account.items.length,
      conflictingPositions: context.account.items.filter((item) => item.positionStatus !== "confirmed").length },
    build: context.build,
    warnings: context.warnings,
    synergy: synergyReport,
    mechanics: mechanicsReport,
    recommendations: recommendationReport,
  } : null;

  return (
    <AppShell
      activeSection="builder"
      guardianContextSection="build"
      guardianId={characterId}
      guardianClassName={guardian?.className ?? "Guardian"}
      guardianEmblemPath={guardian?.emblemPath ?? null}
      guardianOptions={guardians.map((item) => ({
        characterId: item.characterId, className: item.className,
        light: item.light ?? 0, emblemPath: item.emblemPath,
        href: `/guardian/${item.characterId}/assistant`,
      }))}
      currentBuildHref={`/guardian/${characterId}`}
      loadoutsHref={`/guardian/${characterId}/loadouts`}
      subclassHref={`/guardian/${characterId}/subclass`}
      artifactHref={`/guardian/${characterId}/artifact`}
      power={guardian?.light ?? null}
      syncing={syncing}
      autoSync={false}
      bungieSynced={!error && !accountError}
      onSync={() => void loadSnapshots()}
    >
      <main className="min-h-screen px-4 py-6 text-white lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1450px] space-y-5">
          <section className="relative overflow-hidden border border-white/10 bg-[#0a0e14] p-5 lg:p-7">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(103,232,249,0.09),transparent_48%)]" />
            <div className="relative flex flex-wrap items-start justify-between gap-5">
              <div>
                <p className={smallHeading}>Build Engine / Phase 8D.1</p>
                <h1 className="mt-2 text-2xl font-black uppercase tracking-[0.08em] sm:text-3xl">Build Assistant · Analysis & Preview</h1>
                <p className="mt-2 max-w-3xl text-sm text-white/45">
                  Build synergy and evidence-based gear alternatives for your current Guardian and Builder Preview.
                  No Bungie equipment writes or invented quality ratings. Applying a candidate to local Builder Preview always requires confirmation.
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/guardian/${characterId}`} className="border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/65 hover:text-white">Back to Build</Link>
                <button type="button" onClick={() => void loadSnapshots()} disabled={syncing}
                  className="border border-cyan-200/30 bg-cyan-200/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-200/15 disabled:opacity-40">
                  {syncing ? "Syncing" : "Refresh Context"}
                </button>
              </div>
            </div>
          </section>

          {loading && <div className={card}><p className="animate-pulse text-sm text-white/55">Loading Guardian core data…</p></div>}
          {error && <div role="alert" className="border border-rose-400/25 bg-rose-400/5 p-4 text-sm text-rose-200">{error}</div>}
          {context && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Guardian" value={guardian?.className ?? "—"} hint={`Power ${guardian?.light ?? "—"}`} />
                <Metric label="Account inventory" value={accountLoading ? "Syncing" : context.account.complete ? "Complete" : "Partial"}
                  hint={`${context.account.items.length} known item records`} />
                <Metric label="Selected gear details" value={`${countDetails(context)} / ${context.build.gear.length}`}
                  hint="Only resolved details support reliable perk analysis" />
                <Metric label="Warnings" value={String(context.warnings.length)}
                  hint="Unverified data is not silently assumed" />
              </div>
              {universalPlanningContext && <PlanningCoveragePanel data={universalPlanningContext} />}
              {universalPlanningContext && <FullBuildCandidatesPanel key={characterId} data={universalPlanningContext} characterId={characterId} details={details} setDetails={setDetails} updateArmorCacheStatus={updateArmorCacheStatus} resolveExoticReplacementDetails={resolveExoticReplacementDetails} exoticReplacementLoading={exoticReplacementLoading} exoticReplacementError={exoticReplacementError} />}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
                <section className={`${card} space-y-4`}>
                  <p className={smallHeading}>Analysis context</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                      Activity
                      <select value={activity} onChange={(event: ChangeEvent<HTMLSelectElement>) => setActivity(event.target.value as ActivityKind)}
                        className="mt-2 w-full border border-white/15 bg-[#131a24] p-2.5 text-sm font-normal text-white">
                        {ACTIVITY_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                      Evaluation mode
                      <select value={mode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setMode(event.target.value as BuildMode)}
                        className="mt-2 w-full border border-white/15 bg-[#131a24] p-2.5 text-sm font-normal text-white">
                        <option value="owned">Owned / available</option>
                        <option value="theory">Theory (allow locked concepts)</option>
                      </select>
                    </label>
                  </div>
                  <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                    Goal (context only — no AI call yet)
                    <input value={goal} onChange={(event: ChangeEvent<HTMLInputElement>) => setGoal(event.target.value)}
                      placeholder="e.g. Void + Devour + Volatile, Nightfall PvE"
                      className="mt-2 w-full border border-white/15 bg-[#131a24] px-3 py-2.5 text-sm font-normal text-white placeholder:text-white/25" />
                  </label>
                </section>
                <section className={`${card} space-y-3`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className={smallHeading}>Current subclass</p>
                    <span className="text-[10px] uppercase tracking-wider text-white/45">{context.build.subclass?.unlockStatus ?? "unknown"}</span>
                  </div>
                  <h2 className="text-xl font-bold">{context.build.subclass?.name ?? "No subclass resolved"}</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {context.build.subclass?.theoretical && <Chip>Theoretical</Chip>}
                    {context.build.subclass?.isPreview && <Chip>Preview</Chip>}
                    <Chip>{context.build.subclass?.sockets.length ?? 0} sockets</Chip>
                  </div>
                  <p className="text-xs leading-relaxed text-white/40">Subclass and socket availability come from the existing Guardian data. Manifest-only plugs are not treated as unlocked.</p>
                </section>
              </div>

              {currentCompatibility && (
                <GuardianArmorPanel
                  report={currentCompatibility.armorStats}
                  inactiveBonuses={currentCompatibility.inactiveBonuses}
                  uncertainBonuses={currentCompatibility.uncertainBonuses}
                  detailsLoading={detailsLoading}
                  missingDetailCount={missingDetails.length}
                  onLoadDetails={() => void resolveSelectedDetails()}
                />
              )}

              <ArmorOptimizerPanel
                context={context}
                report={activeArmorSearch?.report ?? null}
                cacheStatus={armorCacheStatus}
                availableSets={availableArmorSets}
                weights={armorWeights}
                minimums={armorMinimums}
                maxStatLosses={armorMaxStatLosses}
                lossAversion={armorLossAversion}
                mechanicsReport={mechanicsReport}
                protectedMechanicIds={armorProtectedMechanicIds}
                protectedChainIds={armorProtectedChainIds}
                mechanicLossCost={armorMechanicLossCost}
                chainLossCost={armorChainLossCost}
                setLossCost={armorSetLossCost}
                onProtectedMechanicChange={(id, enabled) => {
                  setArmorProtectedMechanicIds((old) => enabled ? [...new Set([...old, id])] : old.filter((entry) => entry !== id));
                  invalidateArmorSearch();
                }}
                onProtectedChainChange={(id, enabled) => {
                  setArmorProtectedChainIds((old) => enabled ? [...new Set([...old, id])] : old.filter((entry) => entry !== id));
                  invalidateArmorSearch();
                }}
                onMechanicLossCost={(value) => { setArmorMechanicLossCost(value); invalidateArmorSearch(); }}
                onChainLossCost={(value) => { setArmorChainLossCost(value); invalidateArmorSearch(); }}
                onSetLossCost={(value) => { setArmorSetLossCost(value); invalidateArmorSearch(); }}
                keepExotic={armorKeepExotic}
                lockedIds={armorLockedIds}
                requiredSet={armorRequiredSet}
                requiredPieces={armorRequiredPieces}
                onWeightChange={(hash, value) => {
                  setArmorWeights((old) => ({ ...old, [hash]: value })); invalidateArmorSearch();
                }}
                onMinimumChange={(hash, value) => {
                  setArmorMinimums((old) => ({ ...old, [hash]: value })); invalidateArmorSearch();
                }}
                onLossAversion={(value) => {
                  setArmorLossAversion(value); invalidateArmorSearch();
                }}
                onMaxStatLossChange={(hash, value) => {
                  setArmorMaxStatLosses((old) => {
                    const next = { ...old };
                    if (value === null) delete next[hash];
                    else next[hash] = value;
                    return next;
                  });
                  invalidateArmorSearch();
                }}
                onKeepExotic={(value) => { setArmorKeepExotic(value); invalidateArmorSearch(); }}
                onLockedChange={(id, checked) => {
                  setArmorLockedIds((old) => checked ? [...new Set([...old, id])] : old.filter((current) => current !== id));
                  invalidateArmorSearch();
                }}
                onRequiredSet={(value) => { setArmorRequiredSet(value); invalidateArmorSearch(); }}
                onRequiredPieces={(value) => { setArmorRequiredPieces(value); invalidateArmorSearch(); }}
                onSearch={runArmorSearch}
                onContinue={runArmorSearch}
                onStop={cancelArmorAutoRun}
                autoProgress={armorAutoProgress}
                loading={armorAutoProgress.status === "running" || armorAutoProgress.status === "stopping"}
                detailsBusy={detailBusyRef.current || detailsLoading || candidateDetailsLoading}
                loadError={armorLoadError}
                accountReady={Boolean(context.account.complete && !accountLoading && account)}
                pendingId={armorPendingId}
                feedback={armorPreviewFeedback}
                onSelectResult={(id) => { setArmorPendingId(id); setArmorPreviewFeedback(null); }}
                onCancelResult={() => setArmorPendingId(null)}
                onConfirmResult={confirmArmorPreview}
              />

              {mechanicsReport && (
                <MechanicsExplorer
                  report={mechanicsReport}
                  theoryMode={context.mode === "theory"}
                  missingDetailCount={missingDetails.length}
                  detailsLoading={detailsLoading}
                  onLoadDetails={() => void resolveSelectedDetails()}
                />
              )}

              {synergyReport && (
                <SynergyExplorer
                  report={synergyReport}
                  findings={visibleFindings}
                  selectedFinding={selectedFinding}
                  filter={findingFilter}
                  onFilterChange={(next) => { setFindingFilter(next); setSelectedFindingId(null); }}
                  onSelectFinding={setSelectedFindingId}
                  showAllEffects={showAllEffects}
                  onToggleAllEffects={() => setShowAllEffects((current) => !current)}
                  detailsLoading={detailsLoading}
                  missingDetailCount={missingDetails.length}
                  onLoadDetails={() => void resolveSelectedDetails()}
                />
              )}

              {recommendationReport && synergyReport && (
                <RecommendationExplorer
                  report={recommendationReport}
                  effects={synergyReport.effects}
                  focusEffect={focusEffect}
                  onFocusEffect={(key) => { setFocusEffect((current) => current === key ? null : key); setSelectedCandidateId(null); }}
                  onResetFocus={() => { setFocusEffect(null); setSelectedCandidateId(null); }}
                  candidate={chosenCandidate}
                  currentCompatibility={currentCompatibility}
                  candidateCompatibility={candidateCompatibility}
                  onSelectCandidate={(id) => { setSelectedCandidateId(id); setPendingPreviewId(null); setPreviewFeedback(null); }}
                  pendingPreviewId={pendingPreviewId}
                  previewBlocker={previewBlocker}
                  previewFeedback={previewFeedback}
                  onRequestPreview={(id) => { setPendingPreviewId(id); setPreviewFeedback(null); }}
                  onCancelPreview={() => setPendingPreviewId(null)}
                  onConfirmPreview={confirmCandidatePreview}
                  buildHref={`/guardian/${characterId}`}
                  loading={candidateDetailsLoading}
                  progress={candidateBatchProgress}
                  detailError={candidateDetailError}
                  disabled={detailsLoading || syncing || accountLoading}
                  onLoadDetails={() => void resolveCandidateDetails()}
                />
              )}

              <section className={card}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className={smallHeading}>Effective Builder gear</p>
                    <h2 className="mt-1 text-lg font-bold">{context.build.gear.length} equipped slots resolved</h2>
                  </div>
                  <button type="button" onClick={() => void resolveSelectedDetails()}
                    disabled={detailsLoading || missingDetails.length === 0}
                    className="border border-cyan-200/30 bg-cyan-200/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-200/15 disabled:cursor-default disabled:opacity-35">
                    {detailsLoading ? "Reading selected items…" : `Load selected details (${missingDetails.length})`}
                  </button>
                </div>
                <p className="mt-2 text-xs text-white/40">Selected-build details load automatically after inventory sync, two instances at a time (maximum 12 per sync). Use the button to retry failures. No Vault-wide detail fanout.</p>
                {detailError && <p role="alert" className="mt-2 text-xs text-amber-200">{detailError}</p>}
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {context.build.gear.map((gear) => (
                    <div key={gear.slotHash} className="flex min-w-0 items-start justify-between gap-3 border border-white/10 bg-white/[0.025] p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{gear.item.name}</p>
                        <p className="mt-1 text-[10px] text-white/40">Slot {gear.slotHash} · Power {gear.item.power ?? "—"}</p>
                        <p className="mt-1 text-[10px] text-white/45">{gear.item.positionStatus === "confirmed" ? gear.item.position ?? "Position unknown" : "Position unverified"}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {gear.isPreview && <Chip>Preview</Chip>}
                        <span className={`text-[10px] uppercase ${gear.detailsLoaded ? "text-cyan-200" : "text-white/30"}`}>
                          {gear.detailsLoaded ? "Details ready" : "No details"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className={`${card} space-y-3`}>
                  <p className={smallHeading}>Artifact</p>
                  <h2 className="text-lg font-semibold">{context.build.artifact.name ?? "No artifact resolved"}</h2>
                  <div className="flex flex-wrap gap-2">
                    {context.build.artifact.isPreview && <Chip>Preview</Chip>}
                    <Chip>{context.build.artifact.selectedPerks?.length ?? 0} resolved perks</Chip>
                  </div>
                  {!context.build.artifact.selectedPerks && <p className="text-xs text-white/45">Perk information is pending item-detail resolution.</p>}
                </section>
                <section className={`${card} space-y-3`}>
                  <p className={smallHeading}>Data warnings</p>
                  {accountError && <p className="text-xs text-amber-200">Account scope: {accountError}</p>}
                  {context.warnings.length ? (
                    <ul className="space-y-2 text-xs leading-relaxed text-amber-100/75">
                      {context.warnings.slice(0, 12).map((warning, index) => <li key={`${index}:${warning}`}>• {warning}</li>)}
                      {context.warnings.length > 12 && <li>…and {context.warnings.length - 12} more</li>}
                    </ul>
                  ) : <p className="text-sm text-cyan-100/70">No context warnings.</p>}
                </section>
              </div>

              <section className={card}>
                <button type="button" onClick={() => setShowSnapshot((value) => !value)}
                  className="flex w-full items-center justify-between text-left text-xs font-bold uppercase tracking-[0.14em] text-white/60 hover:text-white">
                  <span>Technical context snapshot (selected build only)</span>
                  <span>{showSnapshot ? "Hide −" : "Show +"}</span>
                </button>
                {showSnapshot && <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-words border border-white/10 bg-black/30 p-3 text-[11px] leading-relaxed text-white/55">
                  {JSON.stringify(inspection, null, 2)}
                </pre>}
              </section>
              <p className="text-xs text-white/30">Phase 8C.2 surfaces possible gear alternatives based on selected Bungie perk descriptions. These matches do not confirm a gameplay interaction, superior roll, or activity performance. Build, Vault and editors remain unchanged.</p>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

/** 8R.6.1B — Universal planning coverage only. No generated build or AI inference. */
function PlanningCoveragePanel({ data }: { data: UniversalPlanningContext }) {
  const { coverage, gearOptions, subclasses, observedMechanics, artifact, warnings } = data;
  const weapons = gearOptions.filter((item) => item.category === "weapon");
  const armors = gearOptions.filter((item) => item.category === "armor");
  const selected = subclasses.find((option) => option.selectedInBuild);
  const possibleUnverified = subclasses.reduce((sum, subclass) => sum + subclass.sockets.reduce(
    (total, socket) => total + socket.options.filter((option) => option.status === "possible_unverified" || option.status === "unknown").length, 0), 0);
  const missingCount = coverage.itemDetailsMissing + coverage.subclassSetupsMissing;

  return <details className="group border border-white/10 bg-[#0b0e14] text-white">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 marker:hidden [&::-webkit-details-marker]:hidden hover:bg-white/[0.025]">
      <div className="min-w-0">
        <p className={smallHeading}>Phase 8R.6.1 · Universal Build Planning</p>
        <p className="mt-1 text-sm font-bold tracking-wide">Planning Coverage <span className="ml-1 font-normal text-white/40">(read-only)</span></p>
        <p className="mt-1 text-[11px] text-white/45">
          {coverage.ownedGearCount} weapon/armor records · {coverage.itemDetailsVerified} verified item details · {subclasses.length} subclasses observed
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${coverage.account === "verified" ? "border-cyan-200/25 text-cyan-100" : "border-amber-300/30 text-amber-200"}`}>
          Account {coverage.account}
        </span>
        <span className="text-xs text-white/50 group-open:hidden">Expand +</span>
        <span className="hidden text-xs text-white/50 group-open:inline">Collapse −</span>
      </div>
    </summary>
    <div className="border-t border-white/10 px-4 pb-4 pt-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">Owned gear records</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{weapons.length} <span className="text-xs font-normal text-white/40">weapons</span> / {armors.length} <span className="text-xs font-normal text-white/40">armor</span></p>
          <p className="text-[10px] text-white/40">{coverage.eligibleGearCount} potential class/slot candidates, not validated loadouts</p>
        </div>
        <div className="border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">Instance details</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{coverage.itemDetailsVerified} <span className="text-xs font-normal text-white/40">/ {coverage.ownedGearCount}</span></p>
          <p className="text-[10px] text-white/40">{coverage.itemDetailsMissing} not verified for this snapshot</p>
        </div>
        <div className="border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">Subclass setup data</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{coverage.subclassSetupsKnown} <span className="text-xs font-normal text-white/40">/ {subclasses.length}</span></p>
          <p className="text-[10px] text-white/40">{coverage.subclassSetupsMissing} setups unknown; available options may be incomplete</p>
        </div>
        <div className="border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">Observed knowledge</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{observedMechanics.mechanics.length} <span className="text-xs font-normal text-white/40">mechanics</span></p>
          <p className="text-[10px] text-white/40">{observedMechanics.interactions.length} interactions · Artifact {artifact.coverage}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,.9fr)]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-cyan-100/70">Subclass availability on this Guardian</p>
          {subclasses.length === 0 ? (
            <p className="mt-2 text-xs text-amber-200">No subclass catalog was returned in the current snapshot.</p>
          ) : <div className="mt-2 flex flex-wrap gap-1.5">
            {subclasses.map((subclass) => (
              <span key={subclass.itemHash} className={`border px-2 py-1.5 text-[11px] ${subclass.selectedInBuild ? "border-cyan-200/35 bg-cyan-200/[0.06] text-cyan-100" : "border-white/10 text-white/65"}`}>
                {subclass.name} · {subclass.status} · {subclass.setupCoverage === "unknown" ? "setup unknown" : `${subclass.sockets.length} sockets observed`}
                {subclass.selectedInBuild ? " · selected" : ""}
              </span>
            ))}
          </div>}
          {selected && <p className="mt-2 text-[11px] text-white/45">Selected: {selected.name}. {possibleUnverified} socket option(s) across known setups remain unverified or unknown.</p>}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-100/70">Data gaps to resolve</p>
          <p className="mt-2 text-xs text-white/55">{missingCount === 0 ? "No missing item-detail or subclass-setup records detected; gameplay coverage is still incomplete." : `${coverage.itemDetailsMissing} item details and ${coverage.subclassSetupsMissing} subclass setups are not verified.`}</p>
          <p className="mt-1.5 text-[11px] text-white/40">{warnings[0] ?? "No extra coverage warning."}</p>
        </div>
      </div>
      <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-white/40">
        Counts describe observed Bungie snapshots and the current exact-hash catalog, not every available Destiny 2 mechanic.
        Missing details, sockets or rules are unknown — not proof that an item or ability is unavailable.
        No AI-generated build or Bungie equipment changes are performed here.
      </p>
    </div>
  </details>;
}

/** AI output is untrusted: validate it again before using it as a planner preference. */
type BuildAiIntent = {
  guardianClass: "any" | "Titan" | "Hunter" | "Warlock";
  element: "any" | "Arc" | "Solar" | "Void" | "Stasis" | "Strand" | "Prismatic";
  activity: "general" | "pve" | "pvp" | "raid" | "nightfall" | "dungeon";
  playstyle: string;
  armorStatPriorities: string[];
  desiredMechanics: string[];
  mustKeep: string[];
  explanation: string;
};

function isBuildAiIntent(value: unknown): value is BuildAiIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const classOptions = ["any", "Titan", "Hunter", "Warlock"];
  const elements = ["any", "Arc", "Solar", "Void", "Stasis", "Strand", "Prismatic"];
  const activities = ["general", "pve", "pvp", "raid", "nightfall", "dungeon"];
  const strings = (field: string, max: number): boolean => typeof input[field] === "string" &&
    (input[field] as string).length <= max;
  const entries = (field: string, max: number): boolean => Array.isArray(input[field]) &&
    (input[field] as unknown[]).length <= max &&
    (input[field] as unknown[]).every((item) => typeof item === "string" && item.length <= 90);
  return classOptions.includes(String(input.guardianClass)) && elements.includes(String(input.element)) &&
    activities.includes(String(input.activity)) && strings("playstyle", 250) &&
    strings("explanation", 400) && entries("armorStatPriorities", 6) &&
    (input.armorStatPriorities as string[]).every((stat) => ARMOR_3_STATS.some((entry) => entry.name === stat)) &&
    entries("desiredMechanics", 8) && entries("mustKeep", 6);
}

/** A context hypothesis is untrusted even after server-side schema validation. */
type AiBuildHypothesis = {
  title: string;
  subclassHash: number | null;
  gearRefs: string[];
  reason: string;
  tradeoffs: string[];
  unknowns: string[];
  /** Optional explicit ability/aspect/fragment selections for the proposed subclass. */
  socketChoices?: Array<{ socketIndex: number; plugHash: number }>;
};

type CheckedAiHypothesis = {
  hypothesis: AiBuildHypothesis;
  selectedNames: string[];
  /** Additional owned armor swaps required to make an AI Exotic suggestion structurally legal. */
  automaticArmorSwaps: string[];
  /** Validated socket choices passed to the preflight validator. */
  socketPlugs: Record<string, number>;
  /** Human-readable explanation of socket validation outcomes. */
  socketValidationMessages: string[];
  validation: FullBuildProposalResult | null;
  blockedReason: string | null;
};

type AiContextResult = {
  intent: BuildAiIntent;
  hypotheses: CheckedAiHypothesis[];
  estimatedCost: number | null;
  gearSent: number;
  omitted: number;
  packetChars: number;
  truncated: boolean;
  notes: string[];
};

function isAiBuildHypothesis(value: unknown): value is AiBuildHypothesis {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  const shortArray = (part: unknown, maximum: number, length: number): part is string[] =>
    Array.isArray(part) && part.length <= maximum &&
    part.every((v: unknown) => typeof v === "string" && v.length <= length);
  const isValidSocketChoice = (choice: unknown): choice is { socketIndex: number; plugHash: number } => {
    if (typeof choice !== "object" || choice === null || Array.isArray(choice)) return false;
    const c = choice as Record<string, unknown>;
    return typeof c.socketIndex === "number" &&
      Number.isSafeInteger(c.socketIndex) &&
      c.socketIndex >= 0 &&
      typeof c.plugHash === "number" &&
      Number.isSafeInteger(c.plugHash) &&
      c.plugHash > 0;
  };
  const isValidSocketChoices = (choices: unknown): boolean =>
    choices === undefined ||
    (Array.isArray(choices) && choices.length <= 20 && choices.every(isValidSocketChoice));
  return typeof x.title === "string" && x.title.length <= 90 &&
    (x.subclassHash === null || (typeof x.subclassHash === "number" && Number.isSafeInteger(x.subclassHash))) &&
    shortArray(x.gearRefs, 8, 3) && new Set(x.gearRefs).size === x.gearRefs.length &&
    typeof x.reason === "string" && x.reason.length <= 420 &&
    shortArray(x.tradeoffs, 4, 150) && shortArray(x.unknowns, 4, 150) &&
    isValidSocketChoices(x.socketChoices);
}

/** Detail fetches may update object references while an AI request is pending.
 * Only a change to actual selected instances/subclass invalidates this fingerprint. */
function selectedBuildSignature(data: UniversalPlanningContext): string {
  return JSON.stringify({
    guardian: data.guardian.characterId,
    subclass: data.subclasses.find((entry) => entry.selectedInBuild)?.itemHash ?? null,
    gear: data.gearOptions.filter((entry) => entry.selectedInBuild)
      .map((entry) => [entry.slotHash, entry.itemInstanceId, entry.itemHash])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

/**
 * 8R.6.3C5C1 — Validate AI-proposed socket choices against observed context.
 * Only accept choices that were present in the AI packet and remain available
 * in the live context. Reject locked/unknown abilities, duplicates, and
 * invalid plug hashes. Never treat missing packet data as evidence of unavailability.
 */
function validateAiSocketChoices(
  choices: AiBuildHypothesis["socketChoices"],
  targetSubclass: PlanningSubclassOption | null,
  aiPacket: SharedAiPacket,
  liveContext: UniversalPlanningContext,
): {
  socketPlugs: Record<string, number>;
  validationMessages: string[];
  blockedReason: string | null;
} {
  const socketPlugs: Record<string, number> = {};
  const validationMessages: string[] = [];
  const blockedReasons: string[] = [];

  if (!choices || choices.length === 0) {
    return { socketPlugs, validationMessages, blockedReason: null };
  }

  if (!targetSubclass) {
    return { socketPlugs, validationMessages, blockedReason: "Socket choices require a valid target subclass." };
  }

  // Build a map of observed socket options from the AI packet for verification
  const packetSocketMap = new Map<number, Map<number, { name: string; status: string }>>();
  for (const subclass of aiPacket.subclasses) {
    if (subclass.hash !== targetSubclass.itemHash) continue;
    for (const socket of subclass.sockets) {
      const optionMap = new Map<number, { name: string; status: string }>();
      for (const option of socket.options) {
        optionMap.set(option.hash, { name: option.name, status: option.status });
      }
      packetSocketMap.set(socket.index, optionMap);
    }
  }

  // Build a map of live socket options for duplicate/ambiguity checks
  const liveSocketMap = new Map<number, Map<number, { name: string; status: string }>>();
  for (const socket of targetSubclass.sockets) {
    const optionMap = new Map<number, { name: string; status: string }>();
    for (const option of socket.options) {
      optionMap.set(option.plugHash, { name: option.name, status: option.status });
    }
    liveSocketMap.set(socket.socketIndex, optionMap);
  }

  const seenPlugHashes = new Set<number>();
  const socketIndicesUsed = new Set<number>();

  for (const choice of choices) {
    const { socketIndex, plugHash } = choice;

    // Check if socket was in the AI packet
    const packetOptions = packetSocketMap.get(socketIndex);
    if (!packetOptions) {
      blockedReasons.push(`Socket ${socketIndex} was not observed in the AI packet for this subclass.`);
      continue;
    }

    // Check if plug was in the AI packet
    const packetOption = packetOptions.get(plugHash);
    if (!packetOption) {
      blockedReasons.push(`Plug ${plugHash} was not observed in socket ${socketIndex} in the AI packet.`);
      continue;
    }

    // Check if still available in live context
    const liveOptions = liveSocketMap.get(socketIndex);
    if (!liveOptions) {
      blockedReasons.push(`Socket ${socketIndex} is no longer available in the live context.`);
      continue;
    }

    const liveOption = liveOptions.get(plugHash);
    if (!liveOption) {
      blockedReasons.push(`Plug ${plugHash} is no longer available in socket ${socketIndex} in the live context.`);
      continue;
    }

    // Reject locked or unknown abilities
    if (liveOption.status !== "equipped" && liveOption.status !== "unlocked") {
      blockedReasons.push(`Plug ${liveOption.name} (${plugHash}) is ${liveOption.status} and cannot be selected.`);
      continue;
    }

    // Check for duplicate plug hashes (aspects/fragments that appear only once)
    const slotType = targetSubclass.sockets.find((s: { socketIndex: number; slotType: string }) => s.socketIndex === socketIndex)?.slotType ?? "";
    const isUniqueSlot = /aspect|fragment/i.test(slotType);
    if (isUniqueSlot && seenPlugHashes.has(plugHash)) {
      blockedReasons.push(`Plug ${liveOption.name} (${plugHash}) is selected twice; ${slotType} plugs must be unique.`);
      continue;
    }

    // Check for duplicate socket indices
    if (socketIndicesUsed.has(socketIndex)) {
      blockedReasons.push(`Socket ${socketIndex} is selected multiple times.`);
      continue;
    }

    // All checks passed
    socketPlugs[String(socketIndex)] = plugHash;
    validationMessages.push(`Selected ${liveOption.name} in ${slotType} socket ${socketIndex}.`);
    seenPlugHashes.add(plugHash);
    socketIndicesUsed.add(socketIndex);
  }

  return {
    socketPlugs,
    validationMessages,
    blockedReason: blockedReasons.length > 0 ? blockedReasons.join(" ") : null,
  };
}

/**
 * 8R.6.3C5A2 — An AI may cite the currently selected item alongside the
 * replacement for the SAME slot. Treat that as a tentative swap only when
 * identity, baseline selection and replacement eligibility are unambiguous.
 * Two unselected alternatives (or an explicit keep request) remain BLOCKED.
 * This interpretation is always visible and never applies changes to Bungie.
 */
function reconcileAiSameSlotReferences(
  referenced: readonly PlanningGearOption[],
  mustKeep: readonly string[],
): {
  gearBySlot: Record<string, { itemInstanceId: string; itemHash: number }>;
  selectedNames: string[];
  explainedSwaps: string[];
  blockedReason: string | null;
} {
  const gearBySlot: Record<string, { itemInstanceId: string; itemHash: number }> = {};
  const selectedNames: string[] = [];
  const explainedSwaps: string[] = [];
  const groups = new Map<number, PlanningGearOption[]>();
  for (const item of referenced) {
    if (item.slotHash === null || item.itemInstanceId === null) return {
      gearBySlot, selectedNames, explainedSwaps,
      blockedReason: "Uno degli oggetti AI non ha uno slot o un'identità di istanza verificabile.",
    };
    const group = groups.get(item.slotHash) ?? [];
    group.push(item);
    groups.set(item.slotHash, group);
  }
  for (const [slotHash, group] of groups) {
    let finalChoice: PlanningGearOption;
    if (group.length === 1) finalChoice = group[0];
    else {
      const baseline = group.filter((item) => item.selectedInBuild);
      const alternatives = group.filter((item) => !item.selectedInBuild);
      const original = baseline[0];
      const replacement = alternatives[0];
      const explicitlyProtected = Boolean(original && mustKeep.some((value) => {
        const key = value.trim().toLocaleLowerCase();
        const name = original.name.trim().toLocaleLowerCase();
        return key.length >= 3 && (key === name || key.includes(name));
      }));
      if (group.length !== 2 || baseline.length !== 1 || alternatives.length !== 1 ||
          !original || !replacement || original.category !== replacement.category ||
          replacement.eligibility !== "candidate" || replacement.positionStatus !== "confirmed" ||
          explicitlyProtected) {
        return { gearBySlot, selectedNames, explainedSwaps,
          blockedReason: `La proposta cita più oggetti nello slot ${slotHash} senza una sostituzione inequivocabile e verificabile. L'AI deve scegliere una sola alternativa.`,
        };
      }
      finalChoice = replacement;
      const slotName = ARMOR_SLOTS.find((part) => part.slotHash === slotHash)?.name ?? `slot ${slotHash}`;
      explainedSwaps.push(`${original.name} → ${replacement.name} (${slotName}; l'AI ha citato sia il pezzo selezionato sia l'alternativa: interpretato come sostituzione, non come due oggetti equipaggiati)`);
    }
    gearBySlot[String(slotHash)] = { itemInstanceId: finalChoice.itemInstanceId!, itemHash: finalChoice.itemHash };
    selectedNames.push(finalChoice.name);
  }
  return { gearBySlot, selectedNames, explainedSwaps, blockedReason: null };
}

/**
 * 8R.6.3C5A — reconcile an AI-suggested Exotic with the LIVE selected armor.
 * The model may mention only a handful of gear refs; all other equipment slots
 * are inherited from the current Builder Preview by evaluateFullBuildProposal.
 * Hence a new Exotic can silently leave a second Exotic in another armor slot.
 *
 * Only an explicitly requested, exactly identified Exotic may trigger a swap.
 * Never replace another explicitly selected item, guess rarity, or create items.
 * This remains a read-only HYPOTHESIS; the live validator stays authoritative.
 */
function reconcileAiArmorExotics(
  context: UniversalPlanningContext,
  explicitGearBySlot: Readonly<Record<string, { itemInstanceId: string; itemHash: number }>>,
): {
  gearBySlot: Record<string, { itemInstanceId: string; itemHash: number }>;
  automaticArmorSwaps: string[];
  blockedReason: string | null;
} {
  const gearBySlot = { ...explicitGearBySlot };
  const automaticArmorSwaps: string[] = [];
  const current = new Map<number, PlanningGearOption>();
  for (const item of context.gearOptions) {
    if (item.selectedInBuild && item.slotHash !== null && !current.has(item.slotHash))
      current.set(item.slotHash, item);
  }
  for (const [slot, identity] of Object.entries(gearBySlot)) {
    const slotHash = Number(slot);
    const exact = context.gearOptions.find((item) => item.slotHash === slotHash &&
      item.itemInstanceId === identity.itemInstanceId && item.itemHash === identity.itemHash);
    if (!exact) return { gearBySlot, automaticArmorSwaps,
      blockedReason: "Un oggetto proposto non è più verificabile nell'inventario corrente." };
    current.set(slotHash, exact);
  }
  const armorExotics = [...current].filter(([, item]) =>
    item.category === "armor" && item.armorMetadata?.exotic === true);
  if (armorExotics.length <= 1) return { gearBySlot, automaticArmorSwaps, blockedReason: null };

  const explicitlyChosenExotics = armorExotics.filter(([slot]) =>
    Object.prototype.hasOwnProperty.call(explicitGearBySlot, String(slot)));
  if (explicitlyChosenExotics.length !== 1) {
    return { gearBySlot, automaticArmorSwaps, blockedReason:
      "La proposta contiene più armature esotiche: non è possibile scegliere automaticamente quale conservare." };
  }

  const usedInstances = new Set([...current.values()].map((item) => item.itemInstanceId)
    .filter((id): id is string => Boolean(id)));
  for (const [slot, previous] of armorExotics) {
    if (Object.prototype.hasOwnProperty.call(explicitGearBySlot, String(slot))) continue;
    // Be deliberately strict: even a merely 'owned' item is not enough for a
    // verified replacement. We need class, slot, location, rarity and detail.
    const alternatives = context.gearOptions.filter((item) =>
      item.category === "armor" && item.slotHash === slot && item.itemInstanceId !== null &&
      !usedInstances.has(item.itemInstanceId) && item.eligibility === "candidate" &&
      item.positionStatus === "confirmed" && item.armorMetadata?.exotic === false &&
      item.detailCoverage === "verified");
    if (!alternatives.length) return { gearBySlot: { ...explicitGearBySlot },
      automaticArmorSwaps: [], blockedReason:
      `Per usare l'esotica proposta occorre sostituire ${previous.name}, ma non trovo un'armatura non esotica dello stesso slot con identità, rarità e dettagli verificati.` };

    // Minimize observed Armor 3.0 stat disruption, not in-game combat performance.
    // If exact six-stat coverage is unavailable, use stable item identity order.
    const distance = (candidate: PlanningGearOption): number => {
      const original = previous.armorStats;
      const proposed = candidate.armorStats;
      if (!original || !proposed || original.length < 6 || proposed.length < 6)
        return Number.POSITIVE_INFINITY;
      const byHash = new Map(proposed.map((stat) => [stat.statHash, stat.value]));
      if (original.some((stat) => !byHash.has(stat.statHash))) return Number.POSITIVE_INFINITY;
      return original.reduce((sum, stat) => sum + Math.abs(stat.value - byHash.get(stat.statHash)!), 0);
    };
    alternatives.sort((a, b) => distance(a) - distance(b) ||
      a.name.localeCompare(b.name) || (a.itemInstanceId ?? "").localeCompare(b.itemInstanceId ?? ""));
    const replacement = alternatives[0];
    gearBySlot[String(slot)] = { itemInstanceId: replacement.itemInstanceId!, itemHash: replacement.itemHash };
    const slotName = ARMOR_SLOTS.find((part) => part.slotHash === slot)?.name ?? `slot ${slot}`;
    automaticArmorSwaps.push(`${previous.name} → ${replacement.name} (${slotName}; alternativa non esotica verificata, scelta per vicinanza delle statistiche osservate, non per efficacia di combattimento)`);
    if (previous.itemInstanceId) usedInstances.delete(previous.itemInstanceId);
    usedInstances.add(replacement.itemInstanceId!);
  }
  return { gearBySlot, automaticArmorSwaps, blockedReason: null };
}

/**
 * 8R.6.3C5E1a — Read-only diagnostics for exotic armor replacement availability.
 * Distinguishes truly absent items from owned items excluded due to missing data.
 * No Bungie calls, no detail fetches, no Preview modifications.
 * Only considers items with confirmed exotic status (exotic === true).
 */
function exoticReplacementDiagnostics(context: UniversalPlanningContext): Array<{
  exoticName: string;
  slotName: string;
  slotHash: number;
  // Progressive counts
  totalAlternatives: number;
  withInstanceId: number;
  notAlreadyUsed: number;
  eligibleCandidate: number;
  positionConfirmed: number;
  confirmedNonExotic: number;
  detailVerified: number;
  fullyQualified: number;
  // Independent exclusion reasons
  excludedInstanceId: number;
  excludedAlreadyUsed: number;
  excludedNotCandidate: number;
  excludedNotConfirmed: number;
  excludedUnknownRarity: number;
  excludedNotVerified: number;
}> {
  const diagnostics: ReturnType<typeof exoticReplacementDiagnostics> = [];
  // Collect all item instance IDs currently used in the build
  const usedInstances = new Set(
    context.gearOptions
      .filter((item) => item.selectedInBuild && item.itemInstanceId !== null)
      .map((item) => item.itemInstanceId!)
  );

  // Only consider armor with confirmed exotic status
  const selectedExotics = context.gearOptions.filter((item) =>
    item.category === "armor" && item.selectedInBuild && item.slotHash !== null &&
    item.armorMetadata?.exotic === true);

  for (const exotic of selectedExotics) {
    const slotHash = exotic.slotHash;
    const slotName = ARMOR_SLOTS.find((part) => part.slotHash === slotHash)?.name ?? `slot ${slotHash}`;

    // All armor in the same slot, excluding the selected exotic
    const allAlternatives = context.gearOptions.filter((item) =>
      item.category === "armor" && item.slotHash === slotHash &&
      item.itemInstanceId !== exotic.itemInstanceId);

    // Progressive filters
    const withInstanceId = allAlternatives.filter((item) => item.itemInstanceId !== null);
    const notAlreadyUsed = withInstanceId.filter((item) => !usedInstances.has(item.itemInstanceId!));
    const eligibleCandidate = notAlreadyUsed.filter((item) => item.eligibility === "candidate");
    const positionConfirmed = eligibleCandidate.filter((item) => item.positionStatus === "confirmed");
    const confirmedNonExotic = positionConfirmed.filter((item) => item.armorMetadata?.exotic === false);
    const detailVerified = confirmedNonExotic.filter((item) => item.detailCoverage === "verified");
    const fullyQualified = detailVerified; // All requirements applied

    // Independent exclusion reasons (for diagnostics, starting from allAlternatives)
    const excludedInstanceId = allAlternatives.filter((item) => item.itemInstanceId === null).length;
    const excludedAlreadyUsed = allAlternatives.filter((item) =>
      item.itemInstanceId !== null && usedInstances.has(item.itemInstanceId)).length;
    const excludedNotCandidate = allAlternatives.filter((item) => item.eligibility !== "candidate").length;
    const excludedNotConfirmed = allAlternatives.filter((item) => item.positionStatus !== "confirmed").length;
    const excludedUnknownRarity = allAlternatives.filter((item) => item.armorMetadata?.exotic === null).length;
    const excludedNotVerified = allAlternatives.filter((item) => item.detailCoverage !== "verified").length;

    diagnostics.push({
      exoticName: exotic.name,
      slotName,
      slotHash: slotHash!,
      totalAlternatives: allAlternatives.length,
      withInstanceId: withInstanceId.length,
      notAlreadyUsed: notAlreadyUsed.length,
      eligibleCandidate: eligibleCandidate.length,
      positionConfirmed: positionConfirmed.length,
      confirmedNonExotic: confirmedNonExotic.length,
      detailVerified: detailVerified.length,
      fullyQualified: fullyQualified.length,
      excludedInstanceId,
      excludedAlreadyUsed,
      excludedNotCandidate,
      excludedNotConfirmed,
      excludedUnknownRarity,
      excludedNotVerified,
    });
  }

  return diagnostics;
}

/**
 * 8R.6.3C5A — bounded AI hypotheses + local exotic legality reconciliation.
 * Builder Preview apply remains disabled: a preflight is NOT whole-build validation.
 * Calls are user-triggered; incomplete coverage remains explicit.
 */
function FullBuildCandidatesPanel({ data, characterId, details, setDetails, updateArmorCacheStatus, resolveExoticReplacementDetails, exoticReplacementLoading, exoticReplacementError }: {
  data: UniversalPlanningContext;
  characterId: string;
  details: Record<string, ItemDetail>;
  setDetails: React.Dispatch<React.SetStateAction<Record<string, ItemDetail>>>;
  updateArmorCacheStatus: (status: ReturnType<typeof cacheFetchedArmorDetails>) => void;
  resolveExoticReplacementDetails: (slotHash: number) => Promise<void>;
  exoticReplacementLoading: boolean;
  exoticReplacementError: string;
}) {
  const [subclassChoice, setSubclassChoice] = useState("any");
  const [perkChoice, setPerkChoice] = useState("none");
  const [statChoice, setStatChoice] = useState("none");
  const [preserveExotic, setPreserveExotic] = useState(true);
  // Explicitly choose either inexpensive text-only intent or bounded C1 context.
  // The temporary ref -> Bungie instance mapping stays local to the browser.
  const [aiGoal, setAiGoal] = useState("");
  const goalRef = useRef("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResult, setAiResult] = useState<{
    intent: BuildAiIntent;
    notes: string[];
    estimatedCost: number | null;
  } | null>(null);
  const [aiContextResult, setAiContextResult] = useState<AiContextResult | null>(null);
  const aiRequestRef = useRef<AbortController | null>(null);
  const aiInFlightRef = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => () => { aiRequestRef.current?.abort(); }, []);
  const [generated, setGenerated] = useState<{
    source: UniversalPlanningContext;
    selectionKey: string;
    report: FullBuildGenerationReport;
  } | null>(null);
  // Parent keys the panel by Guardian ID: switching Guardians remounts it,
  // resetting filter state and discarding prior character candidates.

  const subclasses = useMemo(() => data.subclasses.filter((subclass) =>
    subclass.status === "equipped" || subclass.status === "unlocked"), [data.subclasses]);
  const perks = useMemo(() => {
    const unique = new Map<number, string>();
    for (const gear of data.gearOptions) {
      if (gear.category !== "weapon" || gear.eligibility !== "candidate" ||
          gear.detailCoverage !== "verified") continue;
      for (const perk of gear.perks) {
        if ((perk.origin === "selected" || perk.origin === "intrinsic") &&
            Number.isInteger(perk.plugHash) && perk.plugHash > 0 && !unique.has(perk.plugHash))
          unique.set(perk.plugHash, perk.name);
      }
    }
    return [...unique].sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0]);
  }, [data.gearOptions]);
  const selectedKey = `${data.guardian.characterId}|${subclassChoice}|${perkChoice}|${statChoice}|${preserveExotic}`;
  const visibleGeneration = generated?.report.guardianId === data.guardian.characterId ? generated : null;
  const stale = Boolean(visibleGeneration &&
    (visibleGeneration.source !== data || visibleGeneration.selectionKey !== selectedKey));
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;

  const interpretAndGenerate = async () => {
    const goal = aiGoal.trim();
    if (aiInFlightRef.current) return;
    if (goal.length < 8 || goal.length > 600) {
      setAiError("Descrivi la build desiderata in 8–600 caratteri.");
      return;
    }
    if (data.coverage.account !== "verified") {
      setAiError("Attendi il caricamento completo dell'inventario prima di generare proposte.");
      return;
    }
    aiInFlightRef.current = true;
    const controller = new AbortController();
    aiRequestRef.current = controller;
    const originalGuardian = data.guardian.characterId;
    const originalSelections = selectedKey;
    setAiBusy(true);
    setAiError("");
    setAiResult(null);
    setAiContextResult(null);
    try {
      // Legacy cheap mode: goal text only, then deterministic local candidates.
      const response = await fetch("/api/destiny/assistant/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
        signal: controller.signal,
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
        const error = payload && typeof payload === "object" && "error" in payload &&
          typeof payload.error === "string" ? payload.error : `AI request failed (${response.status}).`;
        throw new Error(error);
      }
      const body = payload as Record<string, unknown>;
      if (body.success !== true || !isBuildAiIntent(body.intent))
        throw new Error("La risposta AI non rispetta i campi di pianificazione previsti.");
      const intent = body.intent;
      const fresh = dataRef.current;
      if (fresh.guardian.characterId !== originalGuardian || selectedKeyRef.current !== originalSelections ||
          goalRef.current.trim() !== goal)
        throw new Error("Il Guardian o i filtri sono cambiati: ripeti la ricerca per evitare risultati obsoleti.");
      const notes: string[] = [];
      const className = fresh.guardian.className.toLowerCase();
      if (intent.guardianClass !== "any" && intent.guardianClass.toLowerCase() !== className) {
        notes.push(`Hai richiesto ${intent.guardianClass}, ma questa pagina mostra ${fresh.guardian.className}. Apri il Guardian giusto per generare proposte.`);
        setGenerated(null);
      } else if (intent.mustKeep.length > 0) {
        // No exact-item name -> instance-id matching here: would be unsafe to
        // silently ignore a requested item lock and present a proposal as valid.
        notes.push(`Oggetti da mantenere: ${intent.mustKeep.join(", ")}. Il Planner non supporta ancora vincoli nominativi certi: non ho generato proposte ignorandoli.`);
        setGenerated(null);
      } else {
        const allowed = fresh.subclasses.filter((entry) => entry.status === "equipped" || entry.status === "unlocked");
        const match = intent.element === "any" ? null : allowed.find((entry) =>
          entry.element.toLowerCase() === intent.element.toLowerCase());
        if (intent.element !== "any" && !match) {
          notes.push(`Nessuna sottoclasse ${intent.element} è verificata come sbloccata su ${fresh.guardian.className}. Non seleziono una sottoclasse bloccata o sconosciuta.`);
          setGenerated(null);
        } else {
          const request: FullBuildGenerationRequest = {
            maxProposals: 5,
            preserveCurrentExotic: preserveExotic,
            ...(match ? { targetSubclassHash: match.itemHash } : {}),
          };
          // A language preference is NOT proof that a stat improves the desired
          // gameplay loop. Try an observed one-piece gain as an OPTIONAL variant,
          // and always fall back to an unranked starting point if it cannot be met.
          const firstExplicitStat = intent.armorStatPriorities.find((name) =>
            ARMOR_3_STATS.some((stat) => stat.name === name));
          const suggestedStat = firstExplicitStat ??
            (intent.desiredMechanics.some((part) => /granat|grenade/i.test(part)) ? "Grenade" :
              intent.desiredMechanics.some((part) => /sopravvivenza|health|surviv|resisten/i.test(part)) ? "Health" : null);
          const stat = ARMOR_3_STATS.find((item) => item.name === suggestedStat);
          let generatedReport: FullBuildGenerationReport;
          if (stat) {
            generatedReport = generateFullBuildCandidates(fresh, {
              ...request, preferredArmorStatHash: stat.statHash,
            });
            notes.push(`Tentativo di miglioramento Armor 3.0: ${stat.name} (preferenza, non garanzia di efficacia).`);
            if (!generatedReport.candidates.length) {
              notes.push(`Nessun miglioramento verificato di ${stat.name} trovato: mostro soltanto punti di partenza, senza dichiarare soddisfatta questa preferenza.`);
              generatedReport = generateFullBuildCandidates(fresh, request);
            }
          } else generatedReport = generateFullBuildCandidates(fresh, request);
          notes.push("Stile, attività e meccaniche richieste non sono ancora valutate come sinergie o efficacia in combattimento.");
          if (intent.desiredMechanics.length)
            notes.push(`Obiettivi NON verificati dal Planner: ${intent.desiredMechanics.join(", ")}.`);
          setGenerated({ source: fresh, selectionKey: originalSelections, report: generatedReport });
        }
      }
      const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : null;
      setAiResult({ intent, notes, estimatedCost: typeof usage?.costEstimateUsd === "number" &&
        Number.isFinite(usage.costEstimateUsd) ? usage.costEstimateUsd : null });
    } catch (reason) {
      if (!controller.signal.aborted) setAiError(reason instanceof Error ? reason.message : "Richiesta AI non riuscita.");
    } finally {
      aiInFlightRef.current = false;
      if (aiRequestRef.current === controller) aiRequestRef.current = null;
      if (!controller.signal.aborted) setAiBusy(false);
    }
  };

  /** C3: the only new paid request, triggered by an explicit click. */
  const analyzeOwnedGearWithAi = async () => {
    const goal = aiGoal.trim();
    if (aiInFlightRef.current) return;
    if (goal.length < 8 || goal.length > 600) {
      setAiError("Descrivi la build desiderata in 8–600 caratteri.");
      return;
    }
    if (data.coverage.account !== "verified") {
      setAiError("Attendi la sincronizzazione completa dell'inventario.");
      return;
    }

    // Construct + bound BEFORE consuming a paid API call.
    let budget: ReturnType<typeof buildBudgetedAiContext>;
    try {
      budget = buildBudgetedAiContext(data, goal);
      if (!budget.packet.gear.length) throw new Error("Non ci sono oggetti osservati da inviare per questa analisi.");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Contesto AI incompleto.");
      return;
    }

    const originalGuardian = data.guardian.characterId;
    const originalSelections = selectedKey;
    const originalSignature = selectedBuildSignature(data);
    const controller = new AbortController();
    aiRequestRef.current = controller;
    aiInFlightRef.current = true;
    setAiBusy(true);
    setAiError("");
    setAiResult(null);
    setAiContextResult(null);
    setGenerated(null); // Don't mix deterministic candidates with unvalidated hypotheses.

    try {
      const response = await fetch("/api/destiny/assistant/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // NEVER send budget.privateItemRefs or the UniversalPlanningContext.
        body: JSON.stringify({ goal, packet: budget.packet }),
        signal: controller.signal,
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error(`Risposta AI non valida (HTTP ${response.status}).`);
      const result = payload as Record<string, unknown>;
      if (!response.ok || result.success !== true) throw new Error(
        typeof result.error === "string" ? result.error : `Richiesta AI fallita (HTTP ${response.status}).`);
      if (result.mode !== "context_hypotheses" || !isBuildAiIntent(result.intent) ||
          !Array.isArray(result.hypotheses) || result.hypotheses.length > 3 ||
          !result.hypotheses.every(isAiBuildHypothesis))
        throw new Error("La risposta AI non rispetta il formato delle ipotesi richiesto.");

      const fresh = dataRef.current;
      if (fresh.guardian.characterId !== originalGuardian ||
          selectedKeyRef.current !== originalSelections || goalRef.current.trim() !== goal ||
          selectedBuildSignature(fresh) !== originalSignature)
        throw new Error("La build o i filtri sono cambiati durante l'analisi. Ripeti per usare dati aggiornati.");

      const notes: string[] = [];
      const intent = result.intent;
      const classMatches = intent.guardianClass === "any" ||
        intent.guardianClass.toLowerCase() === fresh.guardian.className.toLowerCase();
      if (!classMatches) notes.push(`La richiesta indica ${intent.guardianClass} ma stai visualizzando ${fresh.guardian.className}: nessuna ipotesi verrà convalidata.`);
      if (budget.diagnostics.truncated || budget.diagnostics.gearOmitted > 0)
        notes.push("L'AI ha ricevuto solo un sottoinsieme degli oggetti posseduti. Gli altri non sono stati esclusi dalla tua collezione.");
      notes.push("Le spiegazioni AI sono ipotesi, non prove di sinergie o di efficacia. La verifica è solo strutturale e resta parziale dove mancano dati.");

      const knownRefs = new Set(budget.packet.gear.map((item) => item.ref));
      const unlockedSubclassHashes = new Set(fresh.subclasses
        .filter((entry) => entry.status === "equipped" || entry.status === "unlocked")
        .map((entry) => entry.itemHash));
      const checked = (result.hypotheses as AiBuildHypothesis[]).map((hypothesis): CheckedAiHypothesis => {
        let gearBySlot: Record<string, { itemInstanceId: string; itemHash: number }> = {};
        let selectedNames: string[] = [];
        let explainedSwaps: string[] = [];
        const referencedItems: PlanningGearOption[] = [];
        let blockedReason: string | null = null;
        if (!classMatches) blockedReason = "La classe richiesta non coincide con questo Guardian.";
        if (hypothesis.subclassHash !== null && !unlockedSubclassHashes.has(hypothesis.subclassHash))
          blockedReason = "La sottoclasse proposta non è verificata come sbloccata.";
        // The model's own intent is not a proof: never label an unrelated
        // subclass as a match for a specifically requested element.
        const targetSubclass = hypothesis.subclassHash === null
          ? fresh.subclasses.find((entry) => entry.selectedInBuild)
          : fresh.subclasses.find((entry) => entry.itemHash === hypothesis.subclassHash);
        if (intent.element !== "any" && targetSubclass?.element.toLowerCase() !== intent.element.toLowerCase())
          blockedReason = `La proposta non usa la sottoclasse ${intent.element} richiesta.`;
        for (const ref of hypothesis.gearRefs) {
          if (!knownRefs.has(ref) || !budget.privateItemRefs[ref]) {
            blockedReason = `Riferimento ${ref} senza identità verificabile nell'inventario corrente.`;
            break;
          }
          const identity = budget.privateItemRefs[ref];
          const observed = fresh.gearOptions.find((item) =>
            item.itemInstanceId === identity.itemInstanceId && item.itemHash === identity.itemHash &&
            item.slotHash === identity.slotHash);
          if (!observed || observed.eligibility === "wrong_class") {
            blockedReason = `Riferimento ${ref} non disponibile per questo Guardian.`;
            break;
          }
          referencedItems.push(observed);
        }
        // Do not silently interpret every repeated slot as a valid loadout.
        // Only a verified replacement of the CURRENT selection is unambiguous.
        if (!blockedReason) {
          const slots = reconcileAiSameSlotReferences(referencedItems, intent.mustKeep);
          gearBySlot = slots.gearBySlot;
          selectedNames = slots.selectedNames;
          explainedSwaps = slots.explainedSwaps;
          blockedReason = slots.blockedReason;
        }
        // Validate socket choices against the AI packet and live context.
        const socketValidation = blockedReason ? null : validateAiSocketChoices(
          hypothesis.socketChoices,
          targetSubclass ?? null,
          budget.packet,
          fresh,
        );
        if (!blockedReason && socketValidation?.blockedReason)
          blockedReason = socketValidation.blockedReason;
        // Missing gear slots inherit the live Builder selection; resolve the
        // implicit second Exotic BEFORE handing the selection to the validator.
        // Never weaken or bypass the independent legality checks.
        const armorResolution = blockedReason ? null : reconcileAiArmorExotics(fresh, gearBySlot);
        if (!blockedReason && armorResolution?.blockedReason)
          blockedReason = armorResolution.blockedReason;
        const validation = blockedReason ? null : evaluateFullBuildProposal(fresh, {
          ...(hypothesis.subclassHash !== null ? { subclassHash: hypothesis.subclassHash } : {}),
          gearBySlot: armorResolution?.gearBySlot ?? gearBySlot,
          socketPlugs: socketValidation?.socketPlugs ?? {},
        });
        return { hypothesis, selectedNames,
          automaticArmorSwaps: [...explainedSwaps, ...(armorResolution?.automaticArmorSwaps ?? [])],
          socketPlugs: socketValidation?.socketPlugs ?? {},
          socketValidationMessages: socketValidation?.validationMessages ?? [],
          validation, blockedReason };
      });

      const usage = result.usage && typeof result.usage === "object" ?
        result.usage as Record<string, unknown> : null;
      setAiContextResult({
        intent, hypotheses: checked, notes,
        gearSent: budget.diagnostics.gearSent,
        omitted: budget.diagnostics.gearOmitted,
        packetChars: budget.diagnostics.packetChars,
        truncated: budget.diagnostics.truncated,
        estimatedCost: typeof usage?.costEstimateUsd === "number" &&
          Number.isFinite(usage.costEstimateUsd) ? usage.costEstimateUsd : null,
      });
    } catch (reason) {
      if (!controller.signal.aborted) setAiError(reason instanceof Error ? reason.message : "Analisi AI non riuscita.");
    } finally {
      aiInFlightRef.current = false;
      if (aiRequestRef.current === controller) aiRequestRef.current = null;
      if (!controller.signal.aborted) setAiBusy(false);
    }
  };

  const generate = () => {
    setAiContextResult(null);
    setAiResult(null); // Manual candidates must not inherit an earlier AI interpretation.
    const request: FullBuildGenerationRequest = {
      maxProposals: 5,
      preserveCurrentExotic: preserveExotic,
    };
    if (subclassChoice !== "any") request.targetSubclassHash = Number(subclassChoice);
    if (perkChoice !== "none") request.preferredWeaponPerkHash = Number(perkChoice);
    if (statChoice !== "none") request.preferredArmorStatHash = Number(statChoice);
    setGenerated({ source: data, selectionKey: selectedKey,
      report: generateFullBuildCandidates(data, request) });
  };

  const report = visibleGeneration?.report;
  // Next.js Fast Refresh may preserve C3 AI hypotheses created BEFORE C5A
  // introduced automaticArmorSwaps. Those older evaluations did not run the
  // Exotic reconciliation, so do not render them as newly validated results.
  const legacyAiHypotheses = Boolean(aiContextResult?.hypotheses.some((entry) =>
    !Array.isArray(entry.automaticArmorSwaps) || !Array.isArray(entry.socketValidationMessages)));
  return <details className="group border border-cyan-200/20 bg-[#0b1017] text-white">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 marker:hidden [&::-webkit-details-marker]:hidden hover:bg-white/[0.025]">
      <div className="min-w-0">
        <p className={smallHeading}>Phase 8R.6.2 · Full Build Planning</p>
        <p className="mt-1 text-sm font-bold tracking-wide">Build Candidates <span className="ml-1 font-normal text-white/40">(AI hypotheses + local preflight)</span></p>
        <p className="mt-1 text-[11px] text-white/45">Compact inventory context · read-only proposals · no Bungie equipment writes</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/60">Up to 5</span>
        <span className="text-xs text-white/50 group-open:hidden">Expand +</span>
        <span className="hidden text-xs text-white/50 group-open:inline">Collapse −</span>
      </div>
    </summary>
    <div className="space-y-3 border-t border-white/10 px-4 pb-4 pt-3">
      <div className="space-y-2 border-b border-white/10 pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/80">AI-assisted starting points · 8R.6.3C5A</p>
          <span className="text-[10px] text-white/40">One explicit, low-cost request · local development only</span>
        </div>
        <label className="block text-xs text-white/60">
          Describe your goal (Italian or English)
          <textarea rows={2} maxLength={600} value={aiGoal}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { goalRef.current = event.target.value; setAiGoal(event.target.value); setAiError(""); setAiResult(null); setAiContextResult(null); }}
            disabled={aiBusy}
            placeholder="Es. Voglio una build Solar per Titan, aggressiva, con granate frequenti e buona sopravvivenza."
            className="mt-1.5 w-full resize-y border border-white/15 bg-[#131a24] px-3 py-2 text-sm text-white placeholder:text-white/25" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void analyzeOwnedGearWithAi()}
            disabled={aiBusy || data.coverage.account !== "verified" || aiGoal.trim().length < 8}
            className="border border-cyan-200/35 bg-cyan-200/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-200/15 disabled:cursor-default disabled:opacity-35">
            {aiBusy ? "Analyzing…" : "Analyze my gear with AI"}
          </button>
          <button type="button" onClick={() => void interpretAndGenerate()}
            disabled={aiBusy || data.coverage.account !== "verified" || aiGoal.trim().length < 8}
            className="border border-white/20 bg-white/[0.03] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white/65 hover:text-white disabled:opacity-35">
            {aiBusy ? "Please wait…" : "Text only (cheaper)"}
          </button>
        </div>
        <p className="text-[10px] leading-relaxed text-white/40">Gear analysis sends your request plus up to 26 relevant item names, selected perks, stats, subclasses and limited mechanic descriptions to OpenAI. Temporary refs only: no Bungie IDs, secrets or full inventory. Text only sends just the goal. Each click may incur API usage.</p>
        {aiError && <p role="alert" className="text-xs text-rose-200">{aiError}</p>}
        {legacyAiHypotheses && <p role="status" className="border border-amber-200/20 p-3 text-xs text-amber-100/80">
          Risultati AI conservati dalla versione precedente tramite Fast Refresh: le sostituzioni esotiche non erano ancora riconciliate. Aggiorna la pagina (F5) per eliminare lo stato precedente. Nessuna chiamata AI parte automaticamente.
        </p>}
        {aiContextResult && !legacyAiHypotheses && <div className="space-y-3 border border-cyan-200/15 bg-black/20 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-cyan-100">AI hypotheses · {aiContextResult.hypotheses.length} proposed · not validated builds</p>
            <span className="text-[10px] text-white/40">{aiContextResult.gearSent} gear sent · {aiContextResult.omitted} omitted</span>
          </div>
          <p className="text-white/60">Interpreted: {aiContextResult.intent.guardianClass} · {aiContextResult.intent.element} · {aiContextResult.intent.playstyle || "unspecified"}</p>
          <p className="text-white/50">Goals: {aiContextResult.intent.desiredMechanics.join(", ") || "not specified"} · Preferred stats: {aiContextResult.intent.armorStatPriorities.join(", ") || "not specified"}</p>
          {aiContextResult.notes.map((note, index) => <p key={`${index}:${note}`} className="text-[11px] leading-relaxed text-amber-100/75">• {note}</p>)}
          {!aiContextResult.hypotheses.length && <p className="border border-white/10 p-2 text-white/60">L'AI non ha trovato ipotesi sufficientemente supportate in questo sottoinsieme. Puoi provare una richiesta più specifica.</p>}
          <div className="space-y-2">
            {aiContextResult.hypotheses.map((entry, index) => {
              const evaluation = entry.validation;
              const unknowns = evaluation?.checks.filter((check) => check.status === "unknown").length ?? 0;
              const status = entry.blockedReason ? "BLOCKED" : evaluation?.status === "invalid" ? "INVALID" :
                evaluation?.status === "partial" ? "PARTIAL" : "PREFLIGHT ONLY";
              return <details key={`${index}:${entry.hypothesis.title}`} className="border border-white/10 bg-[#0b1017]">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="font-semibold text-white/90">{index + 1}. {entry.hypothesis.title}</span>
                  <span className={`shrink-0 border px-2 py-1 text-[10px] ${entry.blockedReason || evaluation?.status === "invalid" ?
                    "border-rose-300/30 text-rose-200" : "border-amber-200/25 text-amber-100"}`}>{status}</span>
                </summary>
                <div className="space-y-2 border-t border-white/10 p-3">
                  <p className="leading-relaxed text-white/75">{entry.hypothesis.reason}</p>
                  <p className="text-white/50">Referenced owned items: {entry.selectedNames.join(", ") || "none; current equipment retained"}.</p>
                  {(entry.automaticArmorSwaps ?? []).length > 0 && <div className="border border-amber-200/20 bg-amber-100/[0.035] p-2 text-amber-100/80">
                    <p className="font-semibold">Sostituzioni interpretate o necessarie per rispettare i vincoli di equipaggiamento:</p>
                    {(entry.automaticArmorSwaps ?? []).map((swap) => <p key={swap} className="mt-1">• {swap}</p>)}
                    <p className="mt-1 text-amber-100/60">Solo ipotesi locale: nessun oggetto viene equipaggiato. Non è una raccomandazione di prestazioni.</p>
                  </div>}
                  {(entry.socketValidationMessages ?? []).length > 0 && <div className="border border-cyan-200/20 bg-cyan-100/[0.035] p-2 text-cyan-100/80">
                    <p className="font-semibold">Ability selections validated:</p>
                    {entry.socketValidationMessages.map((msg) => <p key={msg} className="mt-1">• {msg}</p>)}
                  </div>}
                  {entry.blockedReason && <p className="text-rose-200">Blocked: {entry.blockedReason}</p>}
                  {evaluation && <>
                    <p className="text-white/60">Local structural preflight: {evaluation.status.replaceAll("_", " ")} · {unknowns} unknown checks · {evaluation.changesFromCurrent.gearSlots} gear changes.</p>
                    <p className="text-white/45">Subclass: {evaluation.targetSubclass?.name ?? "unknown"} · Artifact unchanged: {evaluation.artifact.name ?? "unknown"}</p>
                    <details className="border-t border-white/10 pt-2">
                      <summary className="cursor-pointer text-white/65">Validation checks ({evaluation.checks.length})</summary>
                      <div className="mt-2 space-y-1">
                        {evaluation.checks.map((check) => <p key={check.id} className="text-white/60">
                          <span className={check.status === "not_met" ? "text-rose-200" : check.status === "unknown" ? "text-amber-200" : "text-cyan-100"}>{check.status.toUpperCase()}</span> · {check.message}
                        </p>)}
                      </div>
                    </details>
                  </>}
                  {entry.hypothesis.tradeoffs.map((tradeoff, i) => <p key={`trade:${i}`} className="text-white/60">Trade-off (AI hypothesis): {tradeoff}</p>)}
                  {entry.hypothesis.unknowns.map((unknown, i) => <p key={`unknown:${i}`} className="text-amber-100/70">Unverified: {unknown}</p>)}
                  <p className="border-t border-white/10 pt-2 text-[11px] text-white/40">Not a verified gameplay build; suggestions are read-only. No Builder Preview or Bungie changes.</p>
                </div>
              </details>;
            })}
          </div>
          {aiContextResult.estimatedCost !== null && <p className="text-[10px] text-white/40">Estimated API cost: ${aiContextResult.estimatedCost.toFixed(6)} USD · {aiContextResult.packetChars} JSON characters of shared context. Dashboard is authoritative.</p>}
        </div>}
        <details className="border border-white/10 bg-[#0b1017] text-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 marker:hidden [&::-webkit-details-marker]:hidden hover:bg-white/[0.025]">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100/80">Exotic Replacement Diagnostics (local)</p>
            <span className="text-xs text-white/50 group-open:hidden">Expand +</span>
            <span className="hidden text-xs text-white/50 group-open:inline">Collapse −</span>
          </summary>
          <div className="border-t border-white/10 p-4 text-xs">
            {data.coverage.account !== "verified" && <p className="mb-3 text-amber-100/70">Account inventory coverage is incomplete; diagnostics are based on partial data.</p>}
            {(() => {
              const diagnostics = exoticReplacementDiagnostics(data);
              if (diagnostics.length === 0) {
                return <p className="text-white/50">No exotic armor currently selected.</p>;
              }
              return <div className="space-y-3">
                {diagnostics.map((diag) => (
                  <div key={diag.slotHash} className="border border-white/10 p-3">
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <p className="font-semibold text-white/90">{diag.exoticName}</p>
                      <p className="text-white/50">{diag.slotName}</p>
                    </div>
                    <div className="space-y-1 text-white/60">
                      <p className="font-semibold text-white/90 mt-2">Progressive filters:</p>
                      <p>Total alternatives observed: <span className="text-white/90">{diag.totalAlternatives}</span></p>
                      <p>→ With itemInstanceId: <span className={diag.withInstanceId === diag.totalAlternatives ? "text-cyan-100" : "text-amber-200"}>{diag.withInstanceId}</span></p>
                      <p>→ Not already used in build: <span className={diag.notAlreadyUsed === diag.withInstanceId ? "text-cyan-100" : "text-amber-200"}>{diag.notAlreadyUsed}</span></p>
                      <p>→ Eligible candidate: <span className={diag.eligibleCandidate === diag.notAlreadyUsed ? "text-cyan-100" : "text-amber-200"}>{diag.eligibleCandidate}</span></p>
                      <p>→ Position confirmed: <span className={diag.positionConfirmed === diag.eligibleCandidate ? "text-cyan-100" : "text-amber-200"}>{diag.positionConfirmed}</span></p>
                      <p>→ Confirmed non-exotic: <span className={diag.confirmedNonExotic === diag.positionConfirmed ? "text-cyan-100" : "text-amber-200"}>{diag.confirmedNonExotic}</span></p>
                      <p>→ Detail verified: <span className={diag.detailVerified === diag.confirmedNonExotic ? "text-cyan-100" : "text-amber-200"}>{diag.detailVerified}</span></p>
                      <p className="font-semibold text-white/90 mt-2">Fully qualified for replacement: <span className={diag.fullyQualified > 0 ? "text-cyan-100" : "text-rose-200"}>{diag.fullyQualified}</span></p>
                      {diag.fullyQualified === 0 && <div className="mt-2 space-y-1 text-amber-100/70">
                        <p className="font-semibold">Independent exclusion reasons:</p>
                        {diag.excludedInstanceId > 0 && <p>• Missing itemInstanceId: {diag.excludedInstanceId}</p>}
                        {diag.excludedAlreadyUsed > 0 && <p>• Already used in another slot: {diag.excludedAlreadyUsed}</p>}
                        {diag.excludedNotCandidate > 0 && <p>• Not eligible candidate: {diag.excludedNotCandidate}</p>}
                        {diag.excludedNotConfirmed > 0 && <p>• Position not confirmed: {diag.excludedNotConfirmed}</p>}
                        {diag.excludedUnknownRarity > 0 && <p>• Rarity unknown: {diag.excludedUnknownRarity}</p>}
                        {diag.excludedNotVerified > 0 && <p>• Detail not verified: {diag.excludedNotVerified}</p>}
                      </div>}
                      {diag.confirmedNonExotic > 0 && diag.detailVerified < diag.confirmedNonExotic && (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => void resolveExoticReplacementDetails(diag.slotHash)}
                            disabled={exoticReplacementLoading}
                            className="border border-cyan-200/30 bg-cyan-200/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-200/15 disabled:cursor-default disabled:opacity-35"
                          >
                            {exoticReplacementLoading ? "Loading…" : `Load Missing Replacement Details (${diag.confirmedNonExotic - diag.detailVerified})`}
                          </button>
                          {exoticReplacementError && <p role="alert" className="mt-2 text-xs text-rose-200">{exoticReplacementError}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>;
            })()}
          </div>
        </details>
        {aiResult && <div className="space-y-1.5 border border-white/10 bg-black/20 p-3 text-xs">
          <p className="font-semibold text-white/85">Interpreted: {aiResult.intent.guardianClass} · {aiResult.intent.element} · {aiResult.intent.playstyle || "unspecified style"}</p>
          <p className="text-white/55">Activity: {aiResult.intent.activity} · Stat preferences: {aiResult.intent.armorStatPriorities.join(", ") || "not specified"}</p>
          <p className="text-white/55">Desired mechanics: {aiResult.intent.desiredMechanics.join(", ") || "not specified"}</p>
          {aiResult.notes.map((note, index) => <p key={`${index}:${note}`} className="text-amber-100/75">• {note}</p>)}
          {aiResult.estimatedCost !== null && <p className="text-[10px] text-white/40">Indicative provider cost for interpreting this request: ${aiResult.estimatedCost.toFixed(6)} USD. See provider dashboard for actual usage.</p>}
        </div>}
      </div>
      <p className="text-xs leading-relaxed text-white/50">
        Manual mode: generate observed starting points from this Guardian's eight-slot build. Targets are strict filters,
        not combat ratings. Unverified effects, seasonal perks and performance remain unknown.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
          Subclass
          <select value={subclassChoice} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSubclassChoice(event.target.value)}
            className="mt-1.5 w-full border border-white/15 bg-[#131a24] p-2.5 text-xs font-normal text-white">
            <option value="any">Any observed unlocked subclass</option>
            {subclasses.map((subclass) => <option key={subclass.itemHash} value={String(subclass.itemHash)}>{subclass.name} ({subclass.element})</option>)}
          </select>
        </label>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
          Weapon perk (optional)
          <select value={perkChoice} onChange={(event: ChangeEvent<HTMLSelectElement>) => setPerkChoice(event.target.value)}
            className="mt-1.5 w-full border border-white/15 bg-[#131a24] p-2.5 text-xs font-normal text-white">
            <option value="none">No perk target</option>
            {perks.map(([hash, name]) => <option key={hash} value={String(hash)}>{name} · {hash}</option>)}
          </select>
        </label>
        <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
          Armor stat improvement (optional)
          <select value={statChoice} onChange={(event: ChangeEvent<HTMLSelectElement>) => setStatChoice(event.target.value)}
            className="mt-1.5 w-full border border-white/15 bg-[#131a24] p-2.5 text-xs font-normal text-white">
            <option value="none">No stat target</option>
            {ARMOR_3_STATS.map((stat) => <option key={stat.statHash} value={String(stat.statHash)}>{stat.name}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/70">
          <input type="checkbox" checked={preserveExotic} onChange={(event: ChangeEvent<HTMLInputElement>) => setPreserveExotic(event.target.checked)}
            className="accent-cyan-300" />Keep selected exotic armor
        </label>
        <button type="button" onClick={generate} disabled={aiBusy || data.coverage.account !== "verified" || subclasses.length === 0}
          className="border border-cyan-200/35 bg-cyan-200/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-200/15 disabled:cursor-default disabled:opacity-35">
          Generate candidates
        </button>
      </div>
      {data.coverage.account !== "verified" &&
        <p role="status" className="text-xs text-amber-200">Wait for complete Guardian + account inventory before generating owned-build candidates.</p>}
      {data.coverage.account === "verified" && !subclasses.length &&
        <p role="status" className="text-xs text-amber-200">No unlocked subclass was verified in this snapshot.</p>}
      {report && <div className="space-y-3 border-t border-white/10 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className={smallHeading}>Generated starting points</p>
            <p className="mt-1 text-sm font-semibold">{report.candidates.length} candidate(s) · {report.status.replaceAll("_", " ")}</p>
          </div>
          {stale && <span className="border border-amber-300/30 px-2 py-1 text-[10px] text-amber-200">Inputs changed · regenerate</span>}
        </div>
        {report.warnings.slice(0, 4).map((warning, index) => <p key={`${index}:${warning}`} className="text-[11px] leading-relaxed text-amber-100/75">• {warning}</p>)}
        {!report.candidates.length && <p className="border border-white/10 bg-black/20 p-3 text-xs text-white/55">
          No eligible candidate for these exact targets and loaded details. Try a different subclass/perk target,
          or wait for item details to finish loading. This does not prove that no viable Destiny build exists.
        </p>}
        <div className="grid gap-2 xl:grid-cols-2">
          {report.candidates.map((candidate, index) => {
            const validation = candidate.validation;
            const unknown = validation.checks.filter((check) => check.status === "unknown").length;
            const changed = validation.changesFromCurrent;
            return <details key={candidate.id} className="group/candidate min-w-0 border border-white/10 bg-black/20">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 marker:hidden [&::-webkit-details-marker]:hidden hover:bg-white/[0.025]">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-100/65">Option {index + 1} · {candidate.kind.replaceAll("_", " ")}</p>
                  <p className="mt-1 text-sm font-semibold">{candidate.title}</p>
                  <p className="mt-1 text-[11px] text-white/50">
                    {changed.subclass ? "Subclass variant" : "Same subclass"} · {changed.gearSlots} gear change(s) · {changed.socketSelections} socket change(s)
                  </p>
                </div>
                <span className={`shrink-0 border px-2 py-1 text-[10px] uppercase ${validation.status === "partial" ?
                  "border-amber-200/25 text-amber-100" : "border-cyan-200/25 text-cyan-100"}`}>
                  {validation.status === "partial" ? `Partial · ${unknown} unknown` : "Preflight passed"}
                </span>
              </summary>
              <div className="space-y-3 border-t border-white/10 p-3 text-xs">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">Subclass & Artifact</p>
                  <p className="mt-1 font-medium">{validation.targetSubclass?.name ?? "Unknown subclass"} ({validation.targetSubclass?.element ?? "unknown"}) · {validation.sockets.length} observed socket choices</p>
                  <p className="mt-1 text-white/50">Artifact: {validation.artifact.name ?? "unknown"} · {validation.artifact.coverage} · unchanged</p>
                </div>
                {candidate.evidence.armorStatDelta && <p className="text-cyan-100/80">
                  Verified one-piece {ARMOR_3_STATS.find((stat) => stat.statHash === candidate.evidence.armorStatDelta?.statHash)?.name ?? "armor"} gain:
                  +{candidate.evidence.armorStatDelta.delta} item points. Other stats may decrease.
                </p>}
                {candidate.evidence.matchingWeaponPerkHash !== null && <p className="text-cyan-100/80">
                  Requested weapon perk verified (hash {candidate.evidence.matchingWeaponPerkHash}).
                </p>}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">Full proposed gear selection</p>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {validation.gear.map((item) => <div key={`${item.slotHash}:${item.itemInstanceId}`} className="flex min-w-0 flex-col border border-white/10 px-2.5 py-2">
                      <span className="truncate font-medium" title={item.name}>{item.name}</span>
                      <span className="text-[10px] text-white/40">{item.category} · slot {item.slotHash} · details {item.detailCoverage}</span>
                    </div>)}
                  </div>
                </div>
                <details className="border-t border-white/10 pt-2">
                  <summary className="cursor-pointer text-[11px] font-bold text-white/65">Validation evidence · {unknown} unknown check(s)</summary>
                  <div className="mt-2 space-y-1.5">
                    {validation.checks.map((check) => <p key={check.id} className="text-[11px] text-white/60">
                      <span className={check.status === "met" ? "text-cyan-100" : check.status === "not_met" ? "text-rose-200" : "text-amber-200"}>{check.status.toUpperCase()}</span> · {check.message}
                    </p>)}
                  </div>
                </details>
                <p className="border-t border-white/10 pt-2 text-[11px] leading-relaxed text-amber-100/70">
                  Read-only inspection. This is not an AI ranking or a certified whole-build loadout.
                  Direct Builder Preview application is disabled until live compatibility checks are implemented.
                </p>
              </div>
            </details>;
          })}
        </div>
      </div>}
    </div>
  </details>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="border border-white/10 bg-[#0b0e14] p-4">
    <p className={smallHeading}>{label}</p>
    <p className="mt-2 text-xl font-bold">{value}</p>
    <p className="mt-1 text-xs text-white/35">{hint}</p>
  </div>;
}

/** 8R.2: observed instance perks + curated sample rules, not simulated activations. */
function displayedMechanicStatus(mechanic: ResolvedMechanic, theoryMode: boolean): MechanicConfiguration {
  // The first Resolver catalog leaves selected-grenade checks as eligible even
  // in preview/theory. Present these sources conservatively without changing
  // the underlying report or implying real equipment/activation.
  if (mechanic.configuration === "eligible" && theoryMode) return "theoretical";
  if (mechanic.configuration === "eligible" && mechanic.sources.some((source) => source.preview)) {
    return "preview";
  }
  return mechanic.configuration;
}

function mechanicsStatusLabel(status: MechanicConfiguration): string {
  switch (status) {
    case "eligible": return "Configuration compatible";
    case "missing_requirement": return "Missing requirement";
    case "unknown": return "Not fully verified";
    case "preview": return "Builder preview";
    case "theoretical": return "Theoretical / unverified";
  }
}

function MechanicsExplorer({
  report, theoryMode, missingDetailCount, detailsLoading, onLoadDetails,
}: {
  report: MechanicsReport;
  theoryMode: boolean;
  missingDetailCount: number;
  detailsLoading: boolean;
  onLoadDetails: () => void;
}) {
  const eligible = report.mechanics.filter((mechanic) => displayedMechanicStatus(mechanic, theoryMode) === "eligible").length;
  const incomplete = report.detailedGear < report.scannedGear;

  return <section aria-labelledby="mechanics-heading" className="min-w-0 overflow-hidden border border-cyan-200/20 bg-[#0b1017]">
    <div className="border-b border-white/10 bg-[radial-gradient(circle_at_84%_10%,rgba(34,211,238,0.08),transparent_55%)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={smallHeading}>Phase 8R.5.5 · Mechanics Knowledge Base</p>
          <h2 id="mechanics-heading" className="mt-1.5 text-xl font-black uppercase tracking-[0.06em] text-white sm:text-2xl">Conditional Mechanics</h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-white/50">
            Exact selected perk hashes and a small, reviewed rules catalog. These are configuration checks, not live combat activations or performance ratings.
          </p>
        </div>
        <button type="button" onClick={onLoadDetails} disabled={detailsLoading || missingDetailCount === 0}
          className="shrink-0 border border-cyan-200/25 bg-cyan-200/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.11em] text-cyan-100 hover:bg-cyan-200/15 disabled:cursor-default disabled:opacity-35">
          {detailsLoading ? "Loading selected details…" : `Load missing details (${missingDetailCount})`}
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Recognized mechanics</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-white">{report.mechanics.length}</p>
        </div>
        <div className="border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Compatible configurations</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-cyan-100">{eligible}</p>
        </div>
        <div className="border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/40">Detailed selected gear</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-white">{report.detailedGear} / {report.scannedGear}</p>
        </div>
      </div>
      {incomplete && <p className="mt-3 text-xs text-amber-100/75">Partial coverage: not every selected gear item has instance details. Load selected details to inspect more mechanics.</p>}
    </div>

    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(250px,0.85fr)] sm:p-5">
      <div className="min-w-0 space-y-3">
        <p className={smallHeading}>Selected sources and requirements</p>
        {report.mechanics.length ? report.mechanics.map((mechanic) => {
          const status = displayedMechanicStatus(mechanic, theoryMode);
          return <details key={mechanic.id} className="group min-w-0 border border-white/10 bg-white/[0.025] p-3 open:border-cyan-200/20">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block break-words text-sm font-bold text-white/90">{mechanic.title}</span>
                <span className="mt-1 block text-[10px] text-white/40">
                  {mechanic.sources.map((source) => `${source.itemName}${source.selectedCopies > 1 ? ` ×${source.selectedCopies}` : ""}`).join(" · ")}
                </span>
                <span className="mt-1 block text-[10px] text-white/45">
                  {mechanic.requirementChecks.filter((check) => check.status === "met").length}/{mechanic.requirementChecks.length} requirements met
                  {mechanic.requirementChecks.some((check) => check.status === "unknown")
                    ? ` · ${mechanic.requirementChecks.filter((check) => check.status === "unknown").length} unknown` : ""}
                  {mechanic.requirementChecks.some((check) => check.status === "not_met")
                    ? ` · ${mechanic.requirementChecks.filter((check) => check.status === "not_met").length} not met` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.06em] ${
                  status === "eligible" ? "border-cyan-200/25 bg-cyan-100/[0.05] text-cyan-100"
                    : status === "missing_requirement" ? "border-rose-300/25 text-rose-200"
                      : "border-amber-200/20 text-amber-100/75"
                }`}>{mechanicsStatusLabel(status)}</span>
                <span aria-hidden="true" className="text-white/35 transition-transform group-open:rotate-90">›</span>
              </span>
            </summary>
            <div className="mt-3 space-y-3 border-t border-white/10 pt-3 text-xs leading-relaxed text-white/65">
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-cyan-100/60">Trigger in combat</p><p className="mt-1">{mechanic.trigger}</p></div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-100/60">Potential effects</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">{mechanic.effects.map((effect, index) => <li key={`${index}:${effect}`}>{effect}</li>)}</ul>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-100/60">Requirement checks</p>
                <ul className="mt-2 space-y-2">
                  {mechanic.requirementChecks.map((check, index) => <li key={`${index}:${check.kind}`} className="border-l border-white/15 pl-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${
                        check.status === "met" ? "text-cyan-100/80" : check.status === "not_met" ? "text-rose-200" : "text-amber-200"
                      }`}>{check.status === "met" ? "Met" : check.status === "not_met" ? "Not met" : "Unknown"}</span>
                      <span className="text-white/75">{check.description}</span>
                      {check.preview && <span className="text-[10px] text-amber-100/75">Preview</span>}
                      {check.theoretical && <span className="text-[10px] text-amber-100/75">Theoretical</span>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-white/40">{check.reason}</p>
                  </li>)}
                </ul>
              </div>
              <p className="text-amber-100/75">{mechanic.explanation}</p>
              <details className="border-t border-white/10 pt-2">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-white/55">Rule provenance · patch unverified</summary>
                <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-white/50">
                  <p>Evidence basis: {mechanic.provenance.basis === "observed_bungie_detail" ? "Bungie item-detail sample" : "Reviewed Void description"}.</p>
                  <p>Audit: {mechanic.provenance.audit === "oct-2026-sample" ? "October 2026 sample" : "Reviewed Void description"}. Scope: {mechanic.provenance.scope === "selected_perk_observation" ? "observed selected perk" : "reviewed behavior description"}.</p>
                  <p>Current gameplay patch not verified. Combat activation not observed; stacking strength not verified.</p>
                </div>
              </details>
            </div>
          </details>;
        }) : <div className="border border-white/10 p-4 text-xs leading-relaxed text-white/50">
          No catalogued mechanics detected yet. The sample catalog is intentionally small; an empty result does not mean this build has no synergy. Load selected gear details if available.
        </div>}
      </div>

      <div className="min-w-0 space-y-4">
        <div>
          <p className={smallHeading}>Potential mechanics chains</p>
          {report.chains.length ? <div className="mt-2 space-y-2">
            {report.chains.map((chain) => <div key={chain.id} className="border border-cyan-100/15 bg-cyan-100/[0.025] p-3">
              <p className="text-xs font-bold leading-snug text-cyan-100">{chain.title}</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-[11px] leading-relaxed text-white/65">
                {chain.steps.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}
              </ol>
              <p className="mt-3 text-[11px] leading-relaxed text-white/40">{chain.explanation}</p>
              <details className="mt-2 border-t border-white/10 pt-2">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-white/55">Dependencies &amp; provenance ({chain.dependencyChecks.length})</summary>
                <ul className="mt-2 space-y-1 text-[11px] text-white/60">
                  {chain.dependencyChecks.map((check) => <li key={check.mechanicId} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                    <span>{report.mechanics.find((mechanic) => mechanic.id === check.mechanicId)?.title ?? check.mechanicId}</span>
                    <span className="text-white/45">{mechanicsStatusLabel(check.configuration)}</span>
                  </li>)}
                </ul>
                <p className="mt-2 text-[10px] leading-relaxed text-white/45">Reviewed catalog linkage ({chain.provenance.audit === "reviewed-void-description" ? "Void description" : "item-detail sample"}); current patch unverified. Dependencies are selected in the build, not observed triggering in combat.</p>
              </details>
              <p className="mt-2 text-[10px] text-amber-100/75">Potential sequence only: every in-game trigger still needs to occur.</p>
            </div>)}
          </div> : <p className="mt-2 text-xs leading-relaxed text-white/45">No supported multi-source chain detected in the current selection.</p>}
        </div>

        {/* 8R.5.5C — Read-only reviewed interaction findings. These are NOT optimization chains. */}
        {report.interactions.length > 0 && <details className="group border border-cyan-100/15 bg-cyan-100/[0.025] p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left [&::-webkit-details-marker]:hidden">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-100/80">
              Reviewed interactions ({report.interactions.length})
            </span>
            <span aria-hidden="true" className="text-white/45 transition-transform group-open:rotate-90">›</span>
          </summary>
          <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
            <p className="text-[11px] leading-relaxed text-white/45">
              Sources selected together do not prove a combat activation. Stacking and overlap claims have separate evidence levels and are not scored by the Armor Optimizer.
            </p>
            {report.interactions.map((interaction) => <div key={interaction.id} className="min-w-0 border border-white/10 bg-black/20 p-3">
              <p className="break-words text-xs font-bold leading-snug text-white/90">{interaction.title}</p>
              <p className={`mt-1 text-[10px] font-semibold ${interaction.configuration === "eligible" ? "text-cyan-100/80" : "text-amber-100/80"}`}>
                {mechanicsStatusLabel(interaction.configuration)} · Activation not observed
              </p>
              <details className="mt-2 border-t border-white/10 pt-2">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-white/55">
                  Selected dependencies ({interaction.dependencyChecks.length})
                </summary>
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-white/60">
                  {interaction.dependencyChecks.map((dependency) => <li key={dependency.mechanicId} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                    <span>{report.mechanics.find((mechanic) => mechanic.id === dependency.mechanicId)?.title ?? dependency.mechanicId}</span>
                    <span className="text-white/45">{mechanicsStatusLabel(dependency.configuration)}</span>
                  </li>)}
                </ul>
              </details>
              <ul className="mt-3 space-y-3">
                {interaction.claims.map((claim) => <li key={claim.id} className="border-l border-cyan-100/20 pl-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-wide">
                    <span className={claim.relation === "overlaps" ? "text-amber-100/80" : "text-cyan-100/80"}>
                      {claim.relation === "stacks" ? "Reported stacking" : claim.relation === "overlaps" ? "Effect overlap" : "Conditional effect"}
                    </span>
                    <span className="font-medium text-white/40">
                      {claim.evidenceLevel === "bungie_patch_notes" ? "Bungie patch notes" : "Community research"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/70">{claim.description}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] text-white/45 hover:text-white/70">
                      Sources ({claim.sourceUrls.length}) · Current patch unverified
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px]">
                      {claim.sourceUrls.map((url, index) => <li key={`${claim.id}:${url}`}>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-cyan-100/75 underline decoration-cyan-200/20 underline-offset-2 hover:text-cyan-100">
                          Source {index + 1}
                        </a>
                      </li>)}
                    </ul>
                    <p className="mt-2 text-[10px] leading-relaxed text-amber-100/65">
                      The cited research or patch notes describe the claim; this app has not independently verified the current gameplay patch or observed the effect activate.
                    </p>
                  </details>
                </li>)}
              </ul>
              <p className="mt-3 border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/45">{interaction.explanation}</p>
            </div>)}
          </div>
        </details>}

        {report.rejectedTags.length > 0 && <div className="border border-amber-200/20 bg-amber-100/[0.025] p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-100/80">Rejected false positives</p>
          <ul className="mt-3 space-y-3">{report.rejectedTags.map((rejected, index) => <li key={`${index}:${rejected.itemName}:${rejected.plugName}`} className="text-[11px] leading-relaxed text-white/65">
            <span className="font-bold text-white/85">{rejected.plugName}</span> · {rejected.itemName}<br />{rejected.reason}
          </li>)}</ul>
        </div>}
        {report.warnings.length > 0 && <details className="border border-white/10 p-3">
          <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-amber-100/75">Data coverage warnings ({report.warnings.length})</summary>
          <ul className="mt-3 list-disc space-y-2 pl-4 text-[11px] leading-relaxed text-amber-100/65">{report.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>
        </details>}
        <p className="text-[10px] leading-relaxed text-white/35">Catalog: {report.catalogVersion}. Only documented sample hashes are recognized; non-catalogued perks are not classified as ineffective. No gear is equipped or changed here.</p>
      </div>
    </div>
  </section>;
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">{children}</span>;
}


type FindingFilter = "all" | "shared_effect" | "related_effects";

function SynergyExplorer({
  report, findings, selectedFinding, filter, onFilterChange, onSelectFinding,
  showAllEffects, onToggleAllEffects, detailsLoading, missingDetailCount, onLoadDetails,
}: {
  report: SynergyReport;
  findings: SynergyFinding[];
  selectedFinding: SynergyFinding | null;
  filter: FindingFilter;
  onFilterChange: (filter: FindingFilter) => void;
  onSelectFinding: (id: string) => void;
  showAllEffects: boolean;
  onToggleAllEffects: () => void;
  detailsLoading: boolean;
  missingDetailCount: number;
  onLoadDetails: () => void;
}) {
  const statusText = report.status === "ready" ? "Data ready" : report.status === "theoretical" ? "Theory involved" : "Partial data";
  const statusStyle = report.status === "ready"
    ? "border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-100"
    : report.status === "theoretical"
      ? "border-violet-300/20 bg-violet-300/[0.06] text-violet-200"
      : "border-amber-300/20 bg-amber-300/[0.06] text-amber-200";
  const effectsToShow = showAllEffects ? report.effects : report.effects.slice(0, 8);

  return <section aria-labelledby="synergy-heading" className="overflow-hidden border border-cyan-200/15 bg-[#0a0e15]">
    <div className="border-b border-white/10 bg-[radial-gradient(circle_at_85%_10%,rgba(103,232,249,0.07),transparent_45%)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={smallHeading}>Phase 8B · Evidence engine</p>
          <h2 id="synergy-heading" className="mt-1 text-xl font-black uppercase tracking-[0.07em] sm:text-2xl">Synergy Analysis</h2>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/50">
            Effect mentions from your selected subclass, weapons, armor and Artifact. Connections are observational, not verified game mechanics.
          </p>
        </div>
        <span className={`border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] ${statusStyle}`}>{statusText}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SynergyStat label="Connections" value={report.findings.length} hint="Not scored or ranked" />
        <SynergyStat label="Recognized effects" value={report.effects.length} hint="Description-derived" />
        <SynergyStat label="Effect mentions" value={report.coverage.evidenceSources} hint="Across selected perks" />
        <SynergyStat label="Detailed gear" value={`${report.coverage.detailedGear}/${report.coverage.selectedGear}`} hint="For perk evidence" />
      </div>
      {missingDetailCount > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-amber-200/10 bg-amber-200/[0.035] px-3 py-2.5">
        <p className="text-xs text-amber-100/65">{missingDetailCount} selected item detail{missingDetailCount === 1 ? "" : "s"} not loaded. Results may be incomplete.</p>
        <button type="button" onClick={onLoadDetails} disabled={detailsLoading}
          className="border border-cyan-200/30 bg-cyan-200/[0.07] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-200/15 disabled:opacity-40">
          {detailsLoading ? "Loading details…" : `Load selected details (${missingDetailCount})`}
        </button>
      </div>}
    </div>

    <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(310px,0.9fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 border-b border-white/10 lg:border-b-0 lg:border-r">
        <div className="border-b border-white/10 px-4 py-3 sm:px-5">
          <p className={smallHeading}>Observed connections</p>
          <div role="group" aria-label="Filter synergy connections" className="mt-3 flex flex-wrap gap-1.5">
            {([ ["all", "All"], ["shared_effect", "Shared effect"], ["related_effects", "Related effects"] ] as const).map(([value, label]) =>
              <button type="button" key={value} aria-pressed={filter === value} onClick={() => onFilterChange(value)}
                className={`border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] transition ${filter === value ? "border-cyan-200/40 bg-cyan-200/[0.1] text-cyan-100" : "border-white/10 text-white/45 hover:border-white/20 hover:text-white/75"}`}>
                {label}{value === "all" ? ` (${report.findings.length})` : ""}
              </button>
            )}
          </div>
        </div>
        {findings.length ? <div className="max-h-[490px] space-y-1.5 overflow-y-auto p-3 sm:p-4">
          {findings.map((finding) => <button key={finding.id} type="button"
            aria-pressed={selectedFinding?.id === finding.id} onClick={() => onSelectFinding(finding.id)}
            className={`w-full border p-3 text-left transition ${selectedFinding?.id === finding.id ? "border-cyan-200/35 bg-cyan-200/[0.07]" : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]"}`}>
            <span className="flex items-center justify-between gap-3">
              <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-cyan-200/70">{finding.kind === "shared_effect" ? "Shared effect" : "Related effects"}</span>
              <EvidenceFlag certainty={finding.certainty} />
            </span>
            <span className="mt-1.5 block text-sm font-semibold leading-snug text-white/90">{finding.title}</span>
            <span className="mt-2 block text-[10px] text-white/40">{finding.evidence.length} effect mention{finding.evidence.length === 1 ? "" : "s"} · View evidence →</span>
          </button>)}
        </div> : <div className="p-6 text-sm text-white/45">
          <p className="font-semibold text-white/70">No connections in this filter</p>
          <p className="mt-2 text-xs leading-relaxed">{report.findings.length ? "Try another filter to inspect the observed effects." : missingDetailCount > 0 ? "Load the selected item details to include their perks in the analysis." : "No qualifying links were detected in the available descriptions. This does not mean the build has no gameplay synergies."}</p>
        </div>}
      </div>

      <div aria-live="polite" aria-atomic="false" className="min-w-0 p-4 sm:p-5">
        {selectedFinding ? <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={smallHeading}>Connection evidence</p>
            <EvidenceFlag certainty={selectedFinding.certainty} />
          </div>
          <h3 className="mt-2 text-lg font-bold leading-snug text-white">{selectedFinding.title}</h3>
          <p className="mt-2 text-xs leading-relaxed text-white/55">{selectedFinding.explanation}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {selectedFinding.effectKeys.map((key) => <span key={key} className="border border-cyan-200/15 bg-cyan-200/[0.05] px-2 py-1 text-[10px] font-semibold text-cyan-100/80">{report.effects.find((effect) => effect.key === key)?.label ?? key}</span>)}
          </div>
          <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.17em] text-white/40">Sources · {selectedFinding.evidence.length}</p>
          <div className="mt-2 max-h-[445px] space-y-2 overflow-y-auto pr-1">
            {selectedFinding.evidence.map((source) => <EvidenceCard key={source.id} evidence={source} />)}
          </div>
        </div> : <div className="flex min-h-44 flex-col items-center justify-center text-center">
          <p className="text-sm font-semibold text-white/65">No selected connection</p>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/35">Choose a connection on the left to inspect the perk and ability descriptions that mention its effects.</p>
        </div>}
      </div>
    </div>

    <div className="border-t border-white/10 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={smallHeading}>Effect coverage</p>
          <p className="mt-1 text-xs text-white/40">Effect terms found across selected perk and ability descriptions.</p>
        </div>
        {report.effects.length > 8 && <button type="button" onClick={onToggleAllEffects} className="border border-white/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60 hover:text-white">
          {showAllEffects ? "Show less" : `Show all (${report.effects.length})`}
        </button>}
      </div>
      {effectsToShow.length > 0 ? <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {effectsToShow.map((effect) => <EffectRow key={effect.key} effect={effect} />)}
      </div> : <p className="mt-3 text-xs leading-relaxed text-white/40">No tagged effects found in the current selected data. Try loading the chosen item details.</p>}
      {report.warnings.length > 0 && <details className="mt-4 border border-amber-200/10 bg-amber-200/[0.03] p-3">
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.1em] text-amber-100/65">Data limitations and warnings ({report.warnings.length})</summary>
        <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto pl-4 text-xs leading-relaxed text-amber-100/60">
          {report.warnings.map((warning, index) => <li key={`${index}:${warning}`} className="list-disc">{warning}</li>)}
        </ul>
      </details>}
      <p className="mt-4 text-[11px] leading-relaxed text-white/35">
        <strong className="font-semibold text-white/55">Evidence rule:</strong> a description mentioning an effect does not prove the item grants it, triggers it, or stacks with another perk. No Bungie write calls or ratings are performed here.
      </p>
    </div>
  </section>;
}

function SynergyStat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return <div className="min-w-0 border border-white/10 bg-black/15 px-3 py-2.5">
    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/45">{label}</p>
    <p className="mt-1 text-xl font-bold tabular-nums text-white/90">{value}</p>
    <p className="mt-0.5 text-[10px] text-white/30">{hint}</p>
  </div>;
}

function EvidenceFlag({ certainty }: { certainty: SynergyFinding["certainty"] }) {
  return <span className={`shrink-0 border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${
    certainty === "selected" ? "border-cyan-200/15 text-cyan-200/65"
      : certainty === "theoretical" ? "border-violet-300/20 text-violet-200"
        : "border-amber-300/20 text-amber-200"
  }`}>{certainty === "selected" ? "Selected" : certainty === "theoretical" ? "Theoretical" : "Position unverified"}</span>;
}

function EvidenceCard({ evidence }: { evidence: SynergyEvidence }) {
  const kind = evidence.sourceKind === "subclass" ? "Subclass" : evidence.sourceKind === "weapon" ? "Weapon" : evidence.sourceKind === "armor" ? "Armor" : "Artifact";
  return <div className="min-w-0 border border-white/10 bg-white/[0.025] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-100/55">{kind}</span>
      <span className="text-[9px] uppercase tracking-wide text-white/35">{evidence.isPreview ? "Builder preview" : "Bungie selection"}{evidence.availability === "possible" ? " · possible only" : ""}</span>
    </div>
    <p className="mt-1.5 break-words text-[11px] text-white/55">{evidence.sourceName}</p>
    <p className="mt-1 text-sm font-semibold leading-snug text-white/85">{evidence.perkName}</p>
    <p className="mt-1 text-[10px] font-semibold text-cyan-200/65">Mentions: {evidence.effect.label}</p>
    {evidence.description ? <p className="mt-2 whitespace-pre-line break-words text-[11px] leading-relaxed text-white/50">{evidence.description}</p> : <p className="mt-2 text-[11px] italic text-white/35">Description unavailable. Effect tag alone is not sufficient to explain activation.</p>}
    {evidence.certainty !== "selected" && <p className="mt-2 text-[10px] text-amber-100/65">{evidence.certainty === "theoretical" ? "This selection may not be unlocked or usable." : "The item location is not confirmed."}</p>}
  </div>;
}

function EffectRow({ effect }: { effect: EffectCoverage }) {
  return <div className="flex min-w-0 items-center justify-between gap-2 border border-white/10 bg-white/[0.025] px-3 py-2">
    <span className="min-w-0 truncate text-xs font-semibold text-white/70" title={effect.label}>{effect.label}</span>
    <span className="shrink-0 border border-cyan-100/15 px-1.5 py-0.5 text-[10px] tabular-nums text-cyan-100/65">{effect.sourceCount}</span>
  </div>;
}

/** Phase 8D.1: evidence-first inspections + explicit local preview selection. */
function RecommendationExplorer({
  report, effects, focusEffect, onFocusEffect, onResetFocus, candidate,
  currentCompatibility, candidateCompatibility, onSelectCandidate,
  loading, progress, detailError, disabled, onLoadDetails,
  pendingPreviewId, previewBlocker, previewFeedback, onRequestPreview,
  onCancelPreview, onConfirmPreview, buildHref,
}: {
  report: RecommendationReport;
  effects: SynergyReport["effects"];
  focusEffect: string | null;
  onFocusEffect: (key: string) => void;
  onResetFocus: () => void;
  candidate: RecommendationCandidate | null;
  currentCompatibility: CompatibilityReport | null;
  candidateCompatibility: CompatibilityReport | null;
  onSelectCandidate: (id: string) => void;
  loading: boolean;
  progress: number;
  detailError: string;
  disabled: boolean;
  onLoadDetails: () => void;
  pendingPreviewId: string | null;
  previewBlocker: string | null;
  previewFeedback: PreviewFeedback | null;
  onRequestPreview: (id: string) => void;
  onCancelPreview: () => void;
  onConfirmPreview: () => void;
  buildHref: string;
}) {
  const status = report.status === "ready" ? "Inspected" : report.status === "theoretical"
    ? "Theory context" : report.status === "no_focus" ? "No effect focus" : "Partial inspection";
  const source = (origin: RecommendationCandidate["origin"]) =>
    origin === "guardian" ? "This Guardian" : origin === "vault" ? "Vault" : "Other Guardian";
  const queueSize = report.detailQueue.length;

  return <section aria-labelledby="recommendations-heading" className="min-w-0 overflow-hidden border border-violet-300/20 bg-[#0b0d15]">
    <div className="relative border-b border-white/10 bg-[radial-gradient(circle_at_82%_16%,rgba(167,139,250,0.11),transparent_52%)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-200/70">Phase 8R.3 · Mechanics-aware comparisons</p>
          <h2 id="recommendations-heading" className="mt-1.5 text-xl font-black uppercase tracking-[0.06em] text-white sm:text-2xl">Gear Candidates</h2>
          <p className="mt-2 text-xs leading-relaxed text-white/50">Compare a single owned gear swap against your current Builder Preview. See <strong className="font-semibold text-white/80">mechanics gained, lost, and conditional paths</strong> before trying it locally. Candidates are not ranked by combat performance.</p>
        </div>
        <span className={`shrink-0 border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] ${
          report.status === "ready" ? "border-cyan-200/25 bg-cyan-200/[0.06] text-cyan-100"
            : report.status === "theoretical" ? "border-violet-200/25 bg-violet-200/[0.08] text-violet-100"
              : "border-amber-200/20 bg-amber-200/[0.05] text-amber-100"
        }`}>{status}</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <RecommendationMetric label="Eligible alternatives" value={report.coverage.eligibleAlternatives} hint="Compatible owned instances" />
        <RecommendationMetric label="Inspected" value={report.coverage.inspectedAlternatives} hint="Verified roll details" />
        <RecommendationMetric label="Potential matches" value={report.recommendations.length} hint="Selected text or exact catalog rules" />
        <RecommendationMetric label="Waiting for details" value={report.coverage.awaitingDetails} hint="Not assumed to be unmatched" />
      </div>
      <div className="mt-4 border-t border-white/[0.07] pt-4">
        <p className={smallHeading}>Effect focus</p>
        <p className="mt-1.5 text-[11px] text-white/40">Automatic mode includes new exact-catalog mechanics even without a matching keyword. Selecting a focus narrows results to that named effect. Activity is context only; no performance score is inferred.</p>
        <div role="group" aria-label="Focus recommendations by observed effect" className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={onResetFocus} aria-pressed={focusEffect === null}
            className={`border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${focusEffect === null ? "border-violet-200/40 bg-violet-200/10 text-violet-100" : "border-white/10 text-white/50 hover:text-white"}`}>All effects</button>
          {effects.map((effect) => <button key={effect.key} type="button" aria-pressed={focusEffect === effect.key}
            onClick={() => onFocusEffect(effect.key)}
            className={`border px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.04em] transition ${focusEffect === effect.key ? "border-violet-200/50 bg-violet-200/15 text-violet-100" : "border-white/10 bg-white/[0.025] text-white/55 hover:border-violet-200/30 hover:text-white"}`}>
            {effect.label}
          </button>)}
        </div>
        {effects.length === 0 && <p className="mt-3 text-xs text-amber-100/70">No text effect tags detected. Automatic matching can still inspect exact-catalog mechanic gains once the candidate details are loaded.</p>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-violet-200/15 bg-violet-200/[0.035] p-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/75">Inspect more owned rolls</p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/45">Up to 8 details per click, 2 parallel requests. Only these instances are inspected; no Vault-wide background scan.</p>
        </div>
        <button type="button" onClick={onLoadDetails} disabled={disabled || loading || !queueSize}
          className="shrink-0 border border-violet-200/35 bg-violet-200/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.13em] text-violet-100 transition hover:bg-violet-200/20 disabled:cursor-default disabled:opacity-35">
          {loading ? `Inspecting ${progress} / ${queueSize}…` : queueSize ? `Inspect next ${queueSize} item${queueSize === 1 ? "" : "s"}` : report.coverage.awaitingDetails ? "No queued items" : "All alternatives inspected"}
        </button>
      </div>
      {detailError && <p role="alert" className="mt-3 text-xs leading-relaxed text-amber-100">{detailError}</p>}
      {previewFeedback && <div role="status" className={`mt-3 flex flex-wrap items-center justify-between gap-3 border p-3 text-xs ${previewFeedback.kind === "success" ? "border-cyan-200/30 bg-cyan-200/[0.055] text-cyan-100" : "border-amber-200/25 bg-amber-200/[0.05] text-amber-100"}`}>
        <span className="min-w-0 flex-1">{previewFeedback.message}</span>
        {previewFeedback.kind === "success" && <Link href={buildHref} className="shrink-0 border border-cyan-200/35 px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-cyan-200/10">Open updated Build →</Link>}
      </div>}
    </div>

    <div className="grid min-w-0 lg:grid-cols-[minmax(285px,0.82fr)_minmax(0,1.18fr)]">
      <div className="min-w-0 border-b border-white/10 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 sm:px-5">
          <p className={smallHeading}>Inspected matches</p>
          <span className="text-[10px] text-white/40">{report.recommendations.length} visible</span>
        </div>
        {report.recommendations.length > 0 ? <div className="max-h-[555px] space-y-2 overflow-y-auto p-3 sm:p-4">
          {report.recommendations.map((item) => <button type="button" key={item.id}
            onClick={() => onSelectCandidate(item.id)} aria-pressed={candidate?.id === item.id}
            className={`group w-full border p-3 text-left transition ${candidate?.id === item.id ? "border-violet-200/40 bg-violet-200/[0.075]" : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]"}`}>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.13em] text-violet-100/70">{item.item.category} · {source(item.origin)}</span>
              <span className="text-[9px] font-semibold uppercase text-white/35">{item.provisional ? "Partial" : "Inspected"}</span>
            </span>
            <span className="mt-2 block break-words text-sm font-bold text-white/90">{item.item.name}</span>
            <span className="mt-1 block text-[10px] text-white/35">Power {item.item.power ?? "—"} · Replaces {item.replaceItemName}</span>
            <span className="mt-2 flex flex-wrap gap-1">
              {item.matchedEffectKeys.map((effectKey) => <span key={effectKey} className="border border-violet-200/15 bg-violet-200/[0.065] px-1.5 py-0.5 text-[10px] font-medium text-violet-100/85">{report.focusedEffects.find((effect) => effect.key === effectKey)?.label ?? effectKey}</span>)}
            </span>
            <span className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              {item.mechanics.added.length > 0 && <span className="border border-cyan-200/20 bg-cyan-200/[0.06] px-1.5 py-0.5 font-semibold text-cyan-100/85">+{item.mechanics.added.length} mechanics</span>}
              {item.mechanics.lost.length > 0 && <span className="border border-amber-200/20 bg-amber-200/[0.055] px-1.5 py-0.5 font-semibold text-amber-100/85">−{item.mechanics.lost.length} mechanics</span>}
              {(item.mechanics.addedChains.length > 0 || item.mechanics.lostChains.length > 0) && <span className="border border-violet-200/20 bg-violet-200/[0.06] px-1.5 py-0.5 font-semibold text-violet-100/85">Chains +{item.mechanics.addedChains.length}/−{item.mechanics.lostChains.length}</span>}
              {item.mechanics.added.length === 0 && item.mechanics.lost.length === 0 && item.mechanics.addedChains.length === 0 && item.mechanics.lostChains.length === 0 && <span className="border border-white/10 px-1.5 py-0.5 text-white/45">Text evidence only</span>}
            </span>
            <span className="mt-2 block text-[10px] text-white/40">{item.evidence.length} thematic perk reference{item.evidence.length === 1 ? "" : "s"} · Inspect trade-offs →</span>
          </button>)}
        </div> : <div className="p-5 text-xs leading-relaxed text-white/45">
          <p className="text-sm font-semibold text-white/75">No verified matches yet</p>
          <p className="mt-2">{report.status === "no_focus"
            ? "No effect focus is available from the current build. Load the selected gear details first."
            : report.coverage.awaitingDetails > 0
              ? "Most alternatives still need detail inspection. Use the manual batch button above; unseen rolls are not treated as mismatches."
              : report.coverage.eligibleAlternatives === 0
                ? "No compatible, confidently located alternatives were found in the currently loaded account inventory."
                : "Inspected alternative perks do not mention the selected effect focus. This is not proof they have no useful gameplay synergies."}</p>
        </div>}
      </div>

      <div className="min-w-0 p-4 sm:p-5" aria-live="polite">
        {candidate ? <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={smallHeading}>Candidate evidence · no Bungie writes</p>
            {candidate.provisional && <span className="border border-amber-200/20 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-100/70">Partial / theoretical</span>}
          </div>
          <h3 className="mt-2 text-xl font-bold text-white/95">{candidate.item.name}</h3>
          <p className="mt-1 break-words text-[11px] leading-relaxed text-white/45">{source(candidate.origin)} · Slot {candidate.replaceSlotHash} · Instance {candidate.id}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="border border-white/10 bg-white/[0.02] p-3">
              <p className={smallHeading}>Current Builder gear</p>
              <p className="mt-1.5 text-sm font-semibold text-white/75">{candidate.replaceItemName}</p>
              <p className="mt-1 text-[10px] text-white/35">{candidate.replaceItemInstanceId ? "Real item instance" : "Instance unavailable"} · Current baseline</p>
            </div>
            <div className="border border-violet-200/20 bg-violet-200/[0.04] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-200/60">Candidate</p>
              <p className="mt-1.5 text-sm font-semibold text-white/90">{candidate.item.name}</p>
              <p className="mt-1 text-[10px] text-white/40">Power {candidate.item.power ?? "—"} · {source(candidate.origin)}</p>
            </div>
          </div>
          <MechanicsTradeoff comparison={candidate.mechanics} />
          {candidateCompatibility && <>
            <CompatibilityCheck
              current={currentCompatibility}
              proposed={candidateCompatibility}
            />
            <ArmorStatsComparison
              before={currentCompatibility?.armorStats ?? null}
              after={candidateCompatibility.armorStats}
              candidateIsArmor={candidate.item.category === "armor"}
            />
          </>}
          <details className="mt-4 border border-white/10 bg-white/[0.015] p-3">
            <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">Why this candidate appeared · explanation &amp; evidence</summary>
            <p className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-white/55">{candidate.explanation}</p>
            <div className="mt-3">
              <p className={smallHeading}>Thematic selected-perk references ({candidate.evidence.length})</p>
              {candidate.evidence.length ? <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                {candidate.evidence.map((evidence, index) => <CandidateEvidenceCard key={`${evidence.plugHash}:${evidence.effectKey}:${index}`} evidence={evidence} />)}
              </div> : <p className="mt-2 text-[11px] text-white/45">No keyword-based matches. This candidate is present because of exact-catalog mechanics and/or a new conditional chain.</p>}
            </div>
          </details>
          <div className="mt-5">
            <p className={smallHeading}>Numeric stat comparison</p>
            <p className="mt-1 text-[10px] leading-relaxed text-white/35">Candidate minus current preview. A positive value is a numeric increase, not necessarily a better build. Only overlapping known stats appear.</p>
            {candidate.statDeltas.length > 0 ? <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {candidate.statDeltas.map((stat) => <div key={stat.statHash} className="grid grid-cols-[minmax(0,1fr)_52px_52px_54px] items-center gap-2 border-b border-white/[0.07] py-2 text-[11px]">
                <span className="min-w-0 truncate text-white/65" title={stat.name}>{stat.name}</span>
                <span className="text-right tabular-nums text-white/45">{stat.currentValue}</span>
                <span className="text-right tabular-nums font-semibold text-white/85">{stat.candidateValue}</span>
                <span className={`text-right tabular-nums ${stat.difference === 0 ? "text-white/35" : "text-cyan-100/85"}`}>{stat.difference > 0 ? "+" : ""}{stat.difference}</span>
              </div>)}
              <div className="grid grid-cols-[minmax(0,1fr)_52px_52px_54px] gap-2 text-[9px] font-bold uppercase tracking-wider text-white/25"><span /> <span className="text-right">Current</span><span className="text-right">New</span><span className="text-right">Delta</span></div>
            </div> : <p className="mt-2 text-xs leading-relaxed text-white/40">No comparable stat values available for the selected gear and this candidate. Load the current build details first if they are missing.</p>}
          </div>
          <div className="mt-5 border border-cyan-200/20 bg-cyan-200/[0.035] p-3 sm:p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/70">Try this gear in your Build</p>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              Applies this <strong className="font-semibold text-white/80">exact owned instance</strong> to the local Builder Preview only.
              {candidate.origin !== "guardian" ? " It remains physically on its current Guardian / in the Vault until you transfer it yourself." : " No item will be equipped in Destiny."}
            </p>
            {previewBlocker && <p className="mt-3 text-[11px] leading-relaxed text-amber-100/80">{previewBlocker}</p>}
            {pendingPreviewId === candidate.id && !previewBlocker ? <div className="mt-3 border border-cyan-200/25 bg-black/20 p-3">
              <p className="text-xs font-semibold text-white/85">Confirm Builder Preview change?</p>
              <p className="mt-1 text-xs text-white/55">Slot {candidate.replaceSlotHash}: <strong>{candidate.replaceItemName}</strong> → <strong>{candidate.item.name}</strong>. The remaining draft stays unchanged.</p>
              <p className="mt-1 text-[10px] leading-relaxed text-white/45">This is a local hypothetical preview, not a performance guarantee, combat activation or Bungie equip action. Review mechanics lost and missing prerequisites above.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={onConfirmPreview} className="border border-cyan-200/45 bg-cyan-200/15 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-200/25">Confirm preview</button>
                <button type="button" onClick={onCancelPreview} className="border border-white/15 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white/60 hover:text-white">Cancel</button>
              </div>
            </div> : <button type="button" disabled={Boolean(previewBlocker)} onClick={() => onRequestPreview(candidate.id)}
              className="mt-3 border border-cyan-200/40 bg-cyan-200/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-200/20 disabled:cursor-not-allowed disabled:opacity-35">
              Review preview change →
            </button>}
          </div>
        </> : <div className="flex min-h-72 flex-col items-center justify-center text-center">
          <p className="text-sm font-semibold text-white/65">Awaiting a matching roll</p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-white/35">Load selected build details, then inspect a small batch of owned alternatives. Matching exact-catalog mechanics appear here even if text tags are empty.</p>
        </div>}
      </div>
    </div>

    {report.warnings.length > 0 && <details className="border-t border-white/10 p-4 sm:p-5">
      <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.13em] text-amber-100/75">Recommendation limitations & excluded items ({report.warnings.length})</summary>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/40">
        {report.coverage.incompatibleArmor > 0 && <Chip>{report.coverage.incompatibleArmor} incompatible armor</Chip>}
        {report.coverage.uncertainPosition > 0 && <Chip>{report.coverage.uncertainPosition} unverified positions</Chip>}
        {report.coverage.nonInstanced > 0 && <Chip>{report.coverage.nonInstanced} non-instanced items</Chip>}
        {report.coverage.unmatchedInspected > 0 && <Chip>{report.coverage.unmatchedInspected} inspected without matching evidence</Chip>}
      </div>
      <ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-amber-100/65">
        {report.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}
      </ul>
    </details>}
  </section>;
}

/** Phase 8R.4.3 — explicit trade-off-aware, bounded, owned-only Armor Optimizer interface.
 * UI is an inspection and explicit local-preview surface, never an equip action.
 */
function ArmorOptimizerPanel({ context, report, cacheStatus, availableSets, weights, minimums, maxStatLosses,
  lossAversion, mechanicsReport, protectedMechanicIds, protectedChainIds,
  mechanicLossCost, chainLossCost, setLossCost,
  onProtectedMechanicChange, onProtectedChainChange,
  onMechanicLossCost, onChainLossCost, onSetLossCost, keepExotic, lockedIds,
  requiredSet, requiredPieces, onWeightChange, onMinimumChange, onMaxStatLossChange,
  onLossAversion, onKeepExotic, onLockedChange,
  onRequiredSet, onRequiredPieces, onSearch, onContinue, onStop, autoProgress, loading, detailsBusy,
  loadError, accountReady, pendingId, feedback, onSelectResult, onCancelResult, onConfirmResult,
}: {
  context: BuildContext;
  report: ArmorOptimizationReport | null;
  cacheStatus: ArmorCacheStatus;
  availableSets: Array<[number, string]>;
  weights: Record<number, number>;
  minimums: Record<number, number>;
  maxStatLosses: Record<number, number>;
  lossAversion: number;
  mechanicsReport: MechanicsReport | null;
  protectedMechanicIds: string[];
  protectedChainIds: string[];
  mechanicLossCost: number;
  chainLossCost: number;
  setLossCost: number;
  onProtectedMechanicChange: (id: string, enabled: boolean) => void;
  onProtectedChainChange: (id: string, enabled: boolean) => void;
  onMechanicLossCost: (value: number) => void;
  onChainLossCost: (value: number) => void;
  onSetLossCost: (value: number) => void;
  keepExotic: boolean;
  lockedIds: string[];
  requiredSet: string;
  requiredPieces: number;
  onWeightChange: (hash: number, weight: number) => void;
  onMinimumChange: (hash: number, value: number) => void;
  onMaxStatLossChange: (hash: number, value: number | null) => void;
  onLossAversion: (value: number) => void;
  onKeepExotic: (next: boolean) => void;
  onLockedChange: (id: string, checked: boolean) => void;
  onRequiredSet: (next: string) => void;
  onRequiredPieces: (next: number) => void;
  onSearch: () => void;
  onContinue: () => void;
  onStop: () => void;
  autoProgress: ArmorAutoProgress;
  loading: boolean;
  detailsBusy: boolean;
  loadError: string;
  accountReady: boolean;
  pendingId: string | null;
  feedback: PreviewFeedback | null;
  onSelectResult: (id: string) => void;
  onCancelResult: () => void;
  onConfirmResult: () => void;
}) {
  const currentArmor = ARMOR_SLOTS.map((slot) => ({ slot, gear: context.build.gear.find((gear) =>
    gear.slotHash === slot.slotHash && gear.item.category === "armor") }));
  const readyForMore = Boolean(report?.missingDetails.some((item) => item.reason === "not_loaded"));
  const baselineArmor = calculateGuardianArmorStats(context);
  const baselineReady = baselineArmor.complete;
  const hasLossRules = lossAversion > 0 || Object.keys(maxStatLosses).length > 0;
  const activeMechanicIds = new Set(mechanicsReport?.mechanics.map((m) => m.id) ?? []);
  const activeChainIds = new Set(mechanicsReport?.chains.map((m) => m.id) ?? []);
  const protectedCount = protectedMechanicIds.filter((id) => activeMechanicIds.has(id)).length +
    protectedChainIds.filter((id) => activeChainIds.has(id)).length;
  const optionalCosts = mechanicLossCost + chainLossCost + setLossCost;
  const tradeoffReady = baselineReady || !hasLossRules;
  const phaseTitle = "text-[10px] font-black uppercase tracking-[0.15em] text-cyan-200/65";
  return <section id="armor-optimizer" aria-labelledby="armor-opt-heading" className="min-w-0 border border-cyan-200/25 bg-[#091119]">
    <div className="border-b border-white/10 bg-[radial-gradient(circle_at_90%_10%,rgba(45,212,191,0.10),transparent_55%)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={phaseTitle}>Phase 8R.4.4 · Armor & Mechanics</p>
          <h2 id="armor-opt-heading" className="mt-1 text-xl font-black uppercase tracking-[0.07em] text-white sm:text-2xl">Create your armor build</h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-white/55">Choose stat priorities, preserve important mechanics, then compare real owned armor combinations. Ranking is preference math, not combat performance.</p>
        </div>
        <span className="border border-cyan-200/25 px-3 py-2 text-[10px] font-black uppercase text-cyan-100/75">Preview only · No equip</span>
      </div>
    </div>
    <div className="space-y-4 p-4 sm:p-5">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-white/80">
        <input type="checkbox" checked={keepExotic} onChange={(event: ChangeEvent<HTMLInputElement>) => onKeepExotic(event.target.checked)} className="accent-cyan-300"/>
        Preserve selected Exotic armor
      </label>
      <div className="space-y-3">
        <div className="min-w-0 space-y-3 border border-white/10 bg-black/15 p-3">
          <p className={phaseTitle}>Stat priorities &amp; minimum armor-item totals</p>
          <p className="text-[11px] text-white/40">0 ignores a stat. Higher numbers prioritize it; minimums are optional.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ARMOR_3_STATS.map((stat) => <label key={stat.statHash} className="flex items-center justify-between gap-3 border border-white/10 bg-[#0c131c] px-3 py-2 text-xs">
              <span className="font-semibold text-white/80">{stat.name}</span>
              <select aria-label={`${stat.name} importance`} value={weights[stat.statHash] ?? 0}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => onWeightChange(stat.statHash, Number(event.target.value))}
                className="w-16 shrink-0 border border-white/15 bg-[#131c28] px-2 py-1.5 text-xs font-bold text-white">
                {Array.from({length: 11}, (_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>)}
          </div>
          <details className="border-t border-white/10 pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-white/65">Minimum stat requirements · optional</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ARMOR_3_STATS.map((stat) => <label key={stat.statHash} className="flex items-center justify-between gap-3 border border-white/10 p-2 text-xs text-white/70">
                {stat.name}
                <input type="number" min={0} max={500} step={1} value={minimums[stat.statHash] ?? 0}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const parsed = Number(event.target.value);
                    onMinimumChange(stat.statHash, Number.isFinite(parsed) ? Math.max(0, Math.min(500, Math.trunc(parsed))) : 0);
                  }}
                  className="w-20 border border-white/15 bg-[#131c28] p-1.5 text-xs tabular-nums text-white"/>
              </label>)}
            </div>
            <p className="mt-2 text-[10px] text-white/40">Zero means no minimum. These are item-level armor totals, not final Guardian stats.</p>
          </details>
        </div>
        <details className="min-w-0 border border-white/10 bg-black/15 p-3">
          <summary className="cursor-pointer text-xs font-bold text-white/80">Locked armor &amp; set requirements <span className="font-normal text-white/45">· optional</span></summary>
          <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            {currentArmor.map(({slot, gear}) => <label key={slot.slotHash} className="flex items-center justify-between gap-2 border border-white/[0.07] px-2.5 py-2 text-xs">
              <span className="min-w-0"><span className="block text-[10px] text-white/40">{slot.name}</span><span className="block truncate text-white/80">{gear?.item.name ?? "Unknown"}</span></span>
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-white/50"><input type="checkbox"
                checked={Boolean(gear?.item.itemInstanceId && lockedIds.includes(gear.item.itemInstanceId))}
                disabled={!gear?.item.itemInstanceId}
                onChange={(event: ChangeEvent<HTMLInputElement>) => { if (gear?.item.itemInstanceId) onLockedChange(gear.item.itemInstanceId, event.target.checked); }}
                className="accent-cyan-300"/>Lock</span>
            </label>)}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
            <label className="text-[10px] text-white/45">Required Bungie armor set
              <select value={requiredSet} onChange={(event: ChangeEvent<HTMLSelectElement>) => onRequiredSet(event.target.value)} className="mt-1 w-full min-w-0 border border-white/15 bg-[#131c28] px-2 py-2 text-xs text-white">
                <option value="">No set requirement</option>
                {availableSets.map(([hash, name]) => <option key={hash} value={String(hash)}>{name}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-white/45">Pieces
              <select value={requiredPieces} onChange={(event: ChangeEvent<HTMLSelectElement>) => onRequiredPieces(Number(event.target.value))} disabled={!requiredSet} className="mt-1 w-full border border-white/15 bg-[#131c28] px-2 py-2 text-xs text-white disabled:opacity-35">
                {[2,4].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-white/35">Set options require a verified Bungie set hash.</p>
          </div>
        </details>
      </div>
      <section aria-label="Protected mechanics" className="border border-cyan-200/20 bg-cyan-200/[0.025] p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={phaseTitle}>Keep your playstyle</p>
            <h3 className="mt-1 text-sm font-bold text-white">Mechanics &amp; chains</h3>
          </div>
          <span className="text-[11px] text-cyan-100/75">{protectedCount} protected</span>
        </div>
        {mechanicsReport && (mechanicsReport.mechanics.length || mechanicsReport.chains.length) ? <>
          {mechanicsReport.chains.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {mechanicsReport.chains.map((chain) => <label key={chain.id} className="flex cursor-pointer items-start gap-2 border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-white/85">
              <input type="checkbox" checked={protectedChainIds.includes(chain.id)} onChange={(event: ChangeEvent<HTMLInputElement>) => onProtectedChainChange(chain.id, event.target.checked)} className="mt-0.5 accent-cyan-300"/>
              <span className="min-w-0"><span className="block font-semibold">{chain.title}</span><span className="block text-[10px] text-white/45">Keep this conditional chain in every result</span></span>
            </label>)}
          </div>}
          <details className="mt-3 border-t border-white/10 pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-white/65">Individual mechanics ({mechanicsReport.mechanics.length})</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {mechanicsReport.mechanics.map((mechanic) => <label key={mechanic.id} className="flex cursor-pointer items-start gap-2 border border-white/10 p-2.5 text-xs text-white/75">
                <input type="checkbox" checked={protectedMechanicIds.includes(mechanic.id)} onChange={(event: ChangeEvent<HTMLInputElement>) => onProtectedMechanicChange(mechanic.id, event.target.checked)} className="mt-0.5 accent-cyan-300"/>
                <span><span className="block font-semibold">{mechanic.title}</span><span className="block text-[10px] text-white/40">{mechanic.configuration.replaceAll("_", " ")}</span></span>
              </label>)}
            </div>
          </details>
        </> : <p className="mt-2 text-[11px] text-white/45">No exact-catalog mechanics found in this preview. Unknown effects are not treated as absent.</p>}
        <p className="mt-3 text-[10px] leading-relaxed text-white/40">Protection preserves recognized rules or potential chains, not observed combat activations. Other, unrecognized effects may still change.</p>
      </section>
      <details className="min-w-0 border border-white/10 bg-black/15 p-3 sm:p-4" aria-label="Advanced stat and mechanics loss preferences">
        <summary className="cursor-pointer text-xs font-bold text-white/80">Advanced trade-offs <span className="ml-2 font-normal text-white/45">Loss aversion {lossAversion} · {Object.keys(maxStatLosses).length} stat limits · {optionalCosts ? "mechanic loss costs active" : "no mechanic penalties"}</span></summary>
        <div className="mt-4 space-y-4">
          <div className="min-w-0 space-y-4 border border-white/10 bg-black/10 p-3" aria-label="Stat loss protection and trade-off preferences">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={phaseTitle}>8R.4.4 · Advanced preferences</p>
            <h3 className="mt-1 text-base font-black text-white">Protect your current build</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-white/50">Choose how much you care about losses, or set strict limits on individual stats. All comparisons use observed armor-item totals.</p>
          </div>
          <span className={`border px-2.5 py-1.5 text-[10px] font-bold ${baselineReady ? "border-cyan-200/30 text-cyan-100/80" : "border-amber-200/30 text-amber-100/80"}`}>
            {baselineReady ? "5/5 BASELINE VERIFIED" : "BASELINE INCOMPLETE"}
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          <div className="border border-white/10 bg-black/20 p-3">
            <label htmlFor="opt-loss-aversion" className="block text-xs font-bold text-white/85">Loss Aversion</label>
            <select id="opt-loss-aversion" value={lossAversion} onChange={(event: ChangeEvent<HTMLSelectElement>) => onLossAversion(Number(event.target.value))}
              className="mt-2 w-full border border-white/15 bg-[#131c28] px-2 py-2 text-xs text-white">
              {Array.from({length: 11}, (_, i) => <option key={i} value={i}>{i === 0 ? "0 — No loss penalty" : `${i} — ${i === 1 ? "Light" : i <= 3 ? "Balanced" : i <= 6 ? "Protective" : "Very protective"}`}</option>)}
            </select>
            <p className="mt-2 text-[11px] leading-relaxed text-white/50">Each stat point lost below your current five-piece totals subtracts <strong className="text-white/80">{lossAversion}</strong> from the ranking score. Gains are still rewarded by your weights.</p>
            <p className="mt-2 text-[10px] text-white/35">0 keeps the original ranking. This coefficient is your preference, not an in-game damage modifier.</p>
          </div>
          <div className="min-w-0 border border-white/10 bg-black/20 p-3">
            <p className="text-xs font-bold text-white/85">Maximum allowed loss per stat</p>
            <p className="mt-1 text-[11px] text-white/45">Turn on a stat to set a hard limit versus the current armor. A limit of <strong className="text-white/70">0</strong> means that stat cannot decrease.</p>
            <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
              {ARMOR_3_STATS.map((stat) => {
                const enabled = Object.prototype.hasOwnProperty.call(maxStatLosses, stat.statHash);
                const baselineValue = baselineArmor.stats.find((entry) => entry.statHash === stat.statHash)?.value ?? null;
                const allowance = maxStatLosses[stat.statHash] ?? 0;
                return <div key={stat.statHash} className={`border p-2 ${enabled ? "border-cyan-200/30 bg-cyan-200/[0.035]" : "border-white/10"}`}>
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-white/80">
                    <input type="checkbox" checked={enabled} onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onMaxStatLossChange(stat.statHash, event.target.checked ? 5 : null)} className="accent-cyan-300"/>
                    {stat.name}
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-[10px] text-white/45">Max −</span>
                    <input type="number" min={0} max={500} step={1} disabled={!enabled} aria-label={`Maximum ${stat.name} stat points allowed to lose`}
                      value={enabled ? allowance : ""} placeholder="Off"
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const num = Number(event.target.value);
                        onMaxStatLossChange(stat.statHash, Number.isFinite(num) ? Math.max(0, Math.min(500, Math.trunc(num))) : 0);
                      }}
                      className="w-full min-w-0 border border-white/15 bg-[#131c28] px-2 py-1.5 text-xs tabular-nums text-white disabled:opacity-35"/>
                  </div>
                  <p className="mt-1 text-[10px] text-white/35">Current {baselineValue === null ? "unverified" : baselineValue}{enabled && baselineValue !== null ? ` · Floor ${Math.max(0, baselineValue - allowance)}` : ""}</p>
                </div>;
              })}
            </div>
          </div>
        </div>
        {!tradeoffReady && <p role="status" className="border border-amber-200/25 bg-amber-200/[0.05] px-3 py-2 text-[11px] leading-relaxed text-amber-100/85">Loss protection needs all five current armor pieces verified. Load selected armor details before searching, or turn off loss protection to run the original stat search.</p>}
        {tradeoffReady && hasLossRules && <p className="text-[11px] text-cyan-100/65">Protection enabled · {Object.keys(maxStatLosses).length} hard limit(s) · loss penalty ×{lossAversion}. A stricter search may return fewer combinations.</p>}
          </div>
          <div className="border border-white/10 p-3">
            <p className="text-xs font-bold text-white/80">Optional loss costs · preference points</p>
            <p className="mt-1 text-[11px] text-white/45">If a recognized mechanic, chain or verified set bonus disappears, subtract the selected amount from the ranking. No damage estimates.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {([ {name:"Mechanic",value:mechanicLossCost,change:onMechanicLossCost},
                  {name:"Chain",value:chainLossCost,change:onChainLossCost},
                  {name:"Set threshold",value:setLossCost,change:onSetLossCost} ]).map((field) => <label key={field.name} className="text-[11px] text-white/60">{field.name}
                <select value={field.value} onChange={(e:ChangeEvent<HTMLSelectElement>) => field.change(Number(e.target.value))} className="mt-1 block w-full border border-white/15 bg-[#131c28] p-2 text-xs text-white">
                  {[0,25,50,100,250].map((v) => <option key={v} value={v}>{v === 0 ? "Off" : `−${v} per loss`}</option>)}
                </select>
              </label>)}
            </div>
          </div>
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!accountReady || loading || detailsBusy || !tradeoffReady}
          onClick={onSearch} className="border border-cyan-200/35 bg-cyan-200/15 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.11em] text-cyan-50 hover:bg-cyan-200/25 disabled:cursor-not-allowed disabled:opacity-35">Find combinations</button>
        {report && readyForMore && !loading && (
          <button type="button" disabled={detailsBusy || !accountReady || !tradeoffReady}
            onClick={onContinue} className="border border-white/20 bg-white/[0.05] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.09em] text-white/75 hover:bg-white/10 disabled:opacity-35">Load more automatically</button>
        )}
        {loading && <button type="button" disabled={autoProgress.status === "stopping"} onClick={onStop}
          className="border border-amber-200/35 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-amber-100 disabled:opacity-35">
          {autoProgress.status === "stopping" ? "Stopping…" : "Stop loading"}
        </button>}
        {!accountReady && <span className="text-xs text-amber-100/70">Waiting for complete account inventory.</span>}
        {loading && <span className="text-xs text-cyan-100/70">{autoProgress.status === "stopping" ? "Finishing in-flight requests…" : `Auto-loading: ${autoProgress.attempted}/${ARMOR_AUTO_MAX_REQUESTS} checked · ${autoProgress.successful} verified · ${autoProgress.failures} failed`}</span>}
        {!loading && autoProgress.status !== "idle" && (
          <span role="status" className="text-[11px] text-white/55">
            {autoProgress.status === "limit" ? "Paused at the safe request limit; load more when ready." :
              autoProgress.status === "stopped" ? "Stopped; verified results kept." :
              autoProgress.status === "failed" ? "Partial coverage; some details could not be loaded." :
              "Automatic detail scan finished."}
          </span>
        )}
      </div>
      {loadError && <p role="status" className="border border-amber-300/20 bg-amber-200/[0.04] px-3 py-2 text-xs text-amber-100/85">{loadError}</p>}
      {feedback && <p role="status" className={`border px-3 py-2 text-xs ${feedback.kind === "success" ? "border-cyan-200/25 text-cyan-100" : "border-rose-300/25 text-rose-200"}`}>{feedback.message}</p>}
      {report && <div className="space-y-4 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={phaseTitle}>Search results · {report.status.replaceAll("_", " ")}</p>
            <p className="mt-1 text-sm font-bold text-white">{report.results.length} loadout(s) found from verified armor</p>
            <p className="mt-1 text-[11px] text-white/50">{report.globallyExhaustive ? "All eligible owned armor covered within search limits." : "Partial coverage: best verified results found, not guaranteed global optimum."}</p>
            <p className="mt-1 text-[11px] text-white/45">Ranking baseline: {report.reference.rankingBaseline === "builder_preview" ? "current Builder Preview" : report.reference.rankingBaseline === "bungie_equipped_snapshot" ? "Bungie equipped" : "not fully verified"} · Bungie side-by-side: {report.reference.equippedReference === "verified" ? "available" : "unavailable"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="border border-white/10 px-2 py-1.5 text-[10px] text-white/55">{report.totalOwnedArmorConsidered} owned armor records</span>
            <span className="border border-white/10 px-2 py-1.5 text-[10px] text-white/55">{report.missingDetailCount} missing details</span>
            <span className="border border-white/10 px-2 py-1.5 text-[10px] text-white/55">{report.nodesVisited} nodes</span>
            <span className="border border-white/10 px-2 py-1.5 text-[10px] text-white/55" title="Session cache retains the supported armor detail fields; already loaded same-tab details also survive Refresh Context.">
              Detail cache: {cacheStatus.stored} saved{cacheStatus.restored !== null ? ` · ${cacheStatus.restored} restored` : ""}
              {cacheStatus.skippedOversized > 0 ? ` · ${cacheStatus.skippedOversized} too large` : ""}
              {cacheStatus.skippedInvalid > 0 ? ` · ${cacheStatus.skippedInvalid} invalid` : ""}
              {cacheStatus.error ? ` · storage error (${cacheStatus.error})` : ""}
            </span>
          </div>
        </div>
        <details className="border border-white/10 p-2.5">
          <summary className="cursor-pointer text-xs font-semibold text-white/65">Verified armor coverage by slot</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-5">
          {ARMOR_SLOTS.map((slot) => <div key={slot.slotHash} className="min-w-0 border border-white/10 bg-white/[0.025] p-2">
            <p className="text-[10px] text-white/40">{slot.name}</p>
            <p className="mt-1 text-lg font-black text-cyan-100">{report.verifiedCandidatesBySlot[String(slot.slotHash)] ?? 0}</p>
            <p className="text-[10px] text-white/40">verified options</p>
          </div>)}
          </div>
        </details>
        {report.warnings.length > 0 && <details className="border border-amber-200/20 p-3 text-[11px] text-amber-100/75">
          <summary className="cursor-pointer font-semibold">Coverage &amp; validation notes ({report.warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">{report.warnings.map((message, i) => <li key={`${i}:${message}`}>{message}</li>)}</ul>
        </details>}
        {report.results.length === 0 && <p className="border border-white/10 p-3 text-xs text-white/65">No fully verified five-piece combination meets the chosen rules yet. Load more armor details or loosen your minimums; no missing stat is treated as zero.</p>}
        <div className="grid gap-3 xl:grid-cols-2">
          {report.results.map((result, index) => <div key={result.id} className="min-w-0 space-y-3 border border-cyan-200/15 bg-[#0c131c] p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className={phaseTitle}>Option {index + 1}</p><h3 className="mt-1 text-base font-extrabold">{result.changes} armor change(s)</h3></div>
              <div className="text-right"><p className="text-[10px] text-white/45">{result.lossPenalty > 0 || lossAversion > 0 || optionalCosts > 0 ? "Preference ranking" : "Weighted stat score"}</p><p className="text-lg font-black tabular-nums text-cyan-100">{result.rankingScore}</p>{(result.lossPenalty > 0 || lossAversion > 0 || optionalCosts > 0) && <p className="text-[10px] tabular-nums text-white/45">{result.objectiveScore} base − {result.lossPenalty} penalties</p>}</div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {result.stats.map((stat) => <div key={stat.statHash} className="border border-white/10 px-2 py-1.5">
                <p className="text-[10px] text-white/40">{stat.name}</p><p className="text-sm font-bold tabular-nums">{stat.itemTotal} <span className="text-[10px] font-normal text-white/40">{stat.deltaFromCurrent !== null ? `(${stat.deltaFromCurrent > 0 ? "+" : ""}${stat.deltaFromCurrent})` : "(n/a)"}</span></p>
              </div>)}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-y border-white/10 py-2 text-[11px]">
              <span className="text-emerald-100/80">↑ {result.tradeoffs.gains.length ? result.tradeoffs.gains.map((gain) => `${gain.name} +${gain.delta}`).join(" · ") : "No stat gains"}</span>
              <span className="text-amber-100/80">↓ {result.tradeoffs.losses.length ? result.tradeoffs.losses.map((loss) => `${loss.name} ${loss.delta}`).join(" · ") : "No stat losses"}</span>
            </div>
            {result.versusEquipped && <details className="border border-white/10 p-2.5 text-[11px] text-white/65">
              <summary className="cursor-pointer font-semibold text-white/75">Compare against Bungie-equipped · {result.versusEquipped.armorChanges} different slot(s)</summary>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">{result.versusEquipped.stats.map((stat) => <div key={stat.statHash}>
                <p className="text-[10px] text-white/40">{stat.name}</p><p className="font-bold tabular-nums">{stat.deltaFromCurrent === null ? "Unknown" : `${stat.deltaFromCurrent > 0 ? "+" : ""}${stat.deltaFromCurrent}`}</p>
              </div>)}</div>
              <p className="mt-2 text-white/40">Bungie snapshot is a separate reference. Ranking still compares to your current Preview.</p>
            </details>}
            <details className="border border-white/10 p-2.5 text-[11px]">
              <summary className="cursor-pointer font-semibold text-white/75">Mechanics, set thresholds &amp; explanation</summary>
              <div className="mt-3 space-y-3 text-white/60">
                <div>
                  <p className="font-bold text-white/75">Verified set thresholds</p>
                  {result.setThresholdChanges.gained.length > 0 && <p className="mt-1 text-emerald-100/75">Newly reached: {result.setThresholdChanges.gained.map((set) => `${set.setName} · ${set.perkName} (${set.requiredPieces} pieces)`).join("; ")}</p>}
                  {result.setThresholdChanges.lost.length > 0 && <p className="mt-1 text-amber-100/75">No longer reached: {result.setThresholdChanges.lost.map((set) => `${set.setName} · ${set.perkName} (${set.requiredPieces} pieces)`).join("; ")}</p>}
                  {!result.setThresholdChanges.gained.length && !result.setThresholdChanges.lost.length && <p className="mt-1 text-white/40">No threshold changes recognized from loaded set hashes.</p>}
                </div>
                <div>
                  <p className="font-bold text-white/75">Catalogued mechanics</p>
                  {result.mechanicsChanges.newlyRecognized.length > 0 && <p className="mt-1 text-emerald-100/75">Added: {result.mechanicsChanges.newlyRecognized.join(", ")}</p>}
                  {result.mechanicsChanges.noLongerRecognized.length > 0 && <p className="mt-1 text-amber-100/75">No longer recognized: {result.mechanicsChanges.noLongerRecognized.join(", ")}</p>}
                  {result.mechanicsChanges.newlyRecognizedChains.length > 0 && <p className="mt-1">New potential chains: {result.mechanicsChanges.newlyRecognizedChains.join(", ")}</p>}
                  {result.mechanicsChanges.noLongerRecognizedChains.length > 0 && <p className="mt-1">Potential chains lost: {result.mechanicsChanges.noLongerRecognizedChains.join(", ")}</p>}
                  {result.mechanicsChanges.missingRequirements.length > 0 && <p className="mt-1 text-amber-100/75">Still requires: {result.mechanicsChanges.missingRequirements.join(", ")}</p>}
                  {!result.mechanicsChanges.newlyRecognized.length && !result.mechanicsChanges.noLongerRecognized.length && !result.mechanicsChanges.newlyRecognizedChains.length && !result.mechanicsChanges.noLongerRecognizedChains.length && <p className="mt-1 text-white/40">No catalog differences recognized; the rules catalog is still incomplete.</p>}
                </div>
                <div>
                  <p className="font-bold text-white/75">Why this combination appears</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">{result.explanations.map((explanation, i) => <li key={`${i}:${explanation}`}>{explanation}</li>)}</ul>
                </div>
              </div>
            </details>
            <details className="border border-white/10 p-2.5 text-xs">
              <summary className="cursor-pointer font-semibold text-white/75">Armor pieces · {result.changes} swap(s)</summary>
              <ul className="mt-3 space-y-1.5">
              {result.parts.map((part) => <li key={part.slotHash} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] pb-1.5 last:border-0">
                <span className="min-w-0"><span className="text-white/45">{part.slotName}: </span><span className="font-semibold text-white/80">{part.name}</span><span className="ml-1 text-[10px] text-white/40">({part.position === "vault" ? "Vault" : part.position.startsWith(`${context.guardian.characterId}:`) ? "This Guardian" : "Other Guardian"})</span> {part.exotic && <span className="text-amber-100/80">· Exotic</span>}</span>
                <span className={`text-[10px] font-bold uppercase ${part.changesCurrentSelection ? "text-cyan-100" : "text-white/35"}`}>{part.changesCurrentSelection ? "Swap" : "Keep"}</span>
              </li>)}
              </ul>
            </details>
            <p className="text-[11px] text-white/50">Compatibility: {result.compatibility.status}. Stats include observed item modifiers; subclass and temporary modifiers not certified.</p>
            {pendingId === result.id ? <div className="space-y-2 border border-amber-200/25 bg-amber-200/[0.04] p-3">
              <p className="text-xs font-bold text-amber-100">Confirm local Builder Preview?</p>
              <p className="text-[11px] text-white/60">This will change up to five armor slots in your saved Builder Preview. It will NOT equip, transfer, or dismantle anything in Destiny.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={loading} onClick={onConfirmResult} className="border border-cyan-200/35 bg-cyan-200/15 px-3 py-2 text-[11px] font-bold text-cyan-50 disabled:opacity-35">Confirm preview</button>
                <button type="button" onClick={onCancelResult} className="border border-white/20 px-3 py-2 text-[11px] text-white/65">Cancel</button>
              </div>
            </div> : <button type="button" disabled={loading} onClick={() => onSelectResult(result.id)}
              className="w-full border border-white/20 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-white/75 hover:border-cyan-200/30 hover:text-cyan-100 disabled:opacity-35">Review full armor preview</button>}
          </div>)}
        </div>
      </div>}
      {!report && <p className="text-xs text-white/40">Choose priorities, optionally protect a recognized chain, then search. Results use the current Preview as reference; combat effectiveness is not estimated.</p>}
    </div>
  </section>;
}

/** Phase 8R.3.4 — item-level Armor 3.0 visualization.
 * These numbers are observed in detailed Bungie gear snapshots.
 * They do not include unverified subclass, temporary buff or external modifiers.
 */
function armorStatText(value: number | null, partial: number): string {
  return value === null ? `≥${partial}` : String(value);
}

function GuardianArmorPanel({report, inactiveBonuses, uncertainBonuses, detailsLoading, missingDetailCount, onLoadDetails}: {
  report: GuardianArmorStatsReport;
  inactiveBonuses: CompatibilityReport["inactiveBonuses"];
  uncertainBonuses: CompatibilityReport["uncertainBonuses"];
  detailsLoading: boolean;
  missingDetailCount: number;
  onLoadDetails: () => void;
}) {
  const maxShown = Math.max(1, ...report.stats.map((stat) => stat.knownPartial));
  const missing = [...new Set(report.stats.flatMap((stat) => stat.missingSlots))];
  return <section className="border border-cyan-200/15 bg-[#091219] p-4 sm:p-5" aria-label="Armor 3.0 selected gear statistics">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/65">Phase 8R.3.4 · Armor 3.0</p>
        <h2 className="mt-1 text-xl font-black uppercase tracking-[0.04em] text-white">Selected Armor Stats</h2>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/50">Sum of the five armor pieces in your current Builder Preview, based on loaded Bungie instance details — not your certified final Guardian stats.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider ${report.complete ? "border-cyan-200/30 text-cyan-100" : "border-amber-200/25 text-amber-100"}`}>
          {report.complete ? "5/5 armor verified" : `${report.loadedSlots}/5 details loaded`}
        </span>
        <button type="button" onClick={onLoadDetails} disabled={detailsLoading || missingDetailCount===0}
          className="border border-cyan-200/25 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-100/80 hover:bg-cyan-200/[0.08] disabled:cursor-default disabled:opacity-35">
          {detailsLoading ? "Loading…" : `Load details (${missingDetailCount})`}
        </button>
      </div>
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_225px]">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {report.stats.map((stat) => (
          <div key={stat.statHash} className="border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-white/70">{stat.name}</span>
              <span className="text-base font-black tabular-nums text-cyan-100">{armorStatText(stat.value, stat.knownPartial)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-cyan-300/65" style={{width: `${Math.min(100, (stat.knownPartial / maxShown) * 100)}%`}} />
            </div>
            <p className="mt-1.5 text-[10px] text-white/40">{stat.complete ? "Five armor slots covered" : `Partial · ${stat.coveredSlots}/5 slots`}</p>
            {!stat.complete && <p className="mt-1 text-[10px] text-amber-100/60">Missing: {stat.missingSlots.join(", ") || "unverified value"}</p>}
          </div>
        ))}
      </div>
      <div className="flex flex-col justify-between border border-white/10 bg-white/[0.02] p-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/45">Armor item total</p>
          <p className="mt-2 text-3xl font-black tabular-nums text-white">{report.armorItemTotal ?? "—"}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/50">{report.complete ? "Complete sum of armor-item values, including any modifiers already reflected by Bungie." : "Incomplete coverage — no full total is asserted."}</p>
        </div>
        <div className="mt-4 border-t border-white/10 pt-3 text-[11px] text-white/45">
          {report.complete ? "All five armor items were read." : `${missing.length} armor slot(s) still missing one or more values.`}
          <p className="mt-1">Final Guardian totals are <strong className="font-semibold text-white/70">not verified</strong>: subclass modifiers and other sources are excluded.</p>
        </div>
      </div>
    </div>
    {(inactiveBonuses.length > 0 || uncertainBonuses.length > 0) && (
      <details className="mt-3 border border-white/10 p-3">
        <summary className="cursor-pointer text-[11px] font-semibold text-white/75">Optional set bonuses: {inactiveBonuses.length} inactive · {uncertainBonuses.length} unverified</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {inactiveBonuses.map((set,index)=><div key={`inactive:${set.setName}:${set.perkName}:${index}`} className="border border-white/10 bg-white/[0.02] p-2.5 text-[11px]">
            <p className="font-semibold text-white/75">{set.setName} · {set.perkName}</p>
            <p className="mt-1 text-white/45">Inactive threshold · {set.confirmedPieces}/{set.requiredPieces} confirmed pieces</p>
          </div>)}
          {uncertainBonuses.map((set,index)=><div key={`unknown:${set.setName}:${set.perkName}:${index}`} className="border border-white/10 bg-white/[0.02] p-2.5 text-[11px]">
            <p className="font-semibold text-white/75">{set.setName} · {set.perkName}</p>
            <p className="mt-1 text-white/45">Unverified threshold · {set.confirmedPieces}/{set.requiredPieces} confirmed, {set.uncertainPieces} uncertain</p>
          </div>)}
        </div>
        <p className="mt-3 text-[10px] text-white/40">Optional bonuses do not make equipment incompatible. Threshold met does not prove in-combat activation.</p>
      </details>
    )}
    <details className="mt-3 border border-white/10 p-3">
      <summary className="cursor-pointer text-[11px] font-semibold text-white/60">Stat coverage and calculation limits</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] leading-relaxed text-white/45">{report.warnings.map((warning,index)=><li key={`${index}:${warning}`}>{warning}</li>)}</ul>
      <p className="mt-2 text-[10px] text-white/35">Bars compare the six displayed item-level sums relative to the largest known one; they are not in-game tier indicators. ≥ means a known subtotal, not a final value.</p>
    </details>
  </section>;
}

/** Conservative full-build before/after; no delta on partial evidence. */
function ArmorStatsComparison({before, after, candidateIsArmor}: {
  before: GuardianArmorStatsReport | null;
  after: GuardianArmorStatsReport;
  candidateIsArmor: boolean;
}) {
  const beforeByHash = new Map((before?.stats ?? []).map((stat) => [stat.statHash, stat]));
  const reliable = Boolean(before?.complete && after.complete);
  return <section className="mt-4 border border-cyan-200/15 bg-[#091219] p-3 sm:p-4" aria-label="Armor 3.0 stats before and after candidate replacement">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-cyan-100/65">Armor 3.0 · before / after</p>
        <h4 className="mt-1 text-base font-bold text-white/90">Whole-build armor stat comparison</h4>
      </div>
      <span className={`border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider ${reliable?"border-cyan-200/25 text-cyan-100":"border-amber-200/25 text-amber-100"}`}>{reliable?"Complete item data":"Partial item data"}</span>
    </div>
    <p className="mt-2 text-[11px] leading-relaxed text-white/50">{candidateIsArmor ? "Shows the whole armor configuration if you preview this piece." : "Weapon substitution leaves the five armor pieces unchanged."} Only loaded instance values count; no subclass or temporary modifiers are calculated.</p>
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_55px_55px_57px] gap-2 border-b border-white/10 pb-2 text-[9px] font-bold uppercase tracking-wider text-white/40">
      <span>Stat</span><span className="text-right">Current</span><span className="text-right">After</span><span className="text-right">Delta</span>
    </div>
    {after.stats.map((stat) => {
      const current = beforeByHash.get(stat.statHash);
      const canDiff = current?.value !== null && current?.value !== undefined && stat.value !== null;
      const delta = canDiff ? stat.value! - current!.value! : null;
      return <div key={stat.statHash} className="grid grid-cols-[minmax(0,1fr)_55px_55px_57px] items-center gap-2 border-b border-white/[0.06] py-2 text-[11px]">
        <span className="font-semibold text-white/70">{stat.name}</span>
        <span className="text-right tabular-nums text-white/50">{armorStatText(current?.value ?? null, current?.knownPartial ?? 0)}</span>
        <span className="text-right tabular-nums text-white/80">{armorStatText(stat.value, stat.knownPartial)}</span>
        <span className={`text-right font-semibold tabular-nums ${delta===null?"text-white/35":delta>0?"text-cyan-100":delta<0?"text-amber-100":"text-white/40"}`}>{delta===null?"—":delta>0?`+${delta}`:String(delta)}</span>
      </div>;
    })}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
      <span className="font-semibold text-white/65">All armor items · sum of six stats</span>
      <span className="tabular-nums font-bold text-white/80">{before?.armorItemTotal ?? "—"} → {after.armorItemTotal ?? "—"}</span>
    </div>
    {!reliable && <p className="mt-2 text-[11px] text-amber-100/70">Some armor values are still missing. Partial numbers are marked ≥ and full-build deltas remain unknown until the affected slots have valid details.</p>}
    <p className="mt-3 text-[10px] leading-relaxed text-white/40">A higher stat is not automatically a better build. These are armor-item totals, not final in-game Guardian stats or gameplay performance estimates.</p>
  </section>;
}

/** Phase 8R.3.3 — read-only compatibility check for the full hypothetical build.
 * Red / hard conflicts block the local preview. Conditional and unknown facts
 * remain inspectable and do not become invented proof of incompatibility.
 */
function CompatibilityCheck({current, proposed}: {
  current: CompatibilityReport | null;
  proposed: CompatibilityReport;
}) {
  const appearance: Record<CompatibilityReport["status"], { label: string; style: string; description: string }> = {
    compatible: {
      label: "Compatible",
      style: "border-cyan-200/30 bg-cyan-200/[0.07] text-cyan-100",
      description: "No recognized structural conflicts in the available data. This is not proof of every gameplay requirement.",
    },
    conditional: {
      label: "Conditional",
      style: "border-amber-200/30 bg-amber-200/[0.06] text-amber-100",
      description: "Some selected mechanics have requirements this configuration does not yet satisfy. Inactive optional set bonuses are listed separately.",
    },
    unverified: {
      label: "Unverified",
      style: "border-white/20 bg-white/[0.04] text-white/75",
      description: "Some required facts are missing. Do not interpret unknown rarity, set membership or mechanics as valid or invalid.",
    },
    incompatible: {
      label: "Incompatible",
      style: "border-rose-300/35 bg-rose-300/[0.08] text-rose-100",
      description: "At least one hard equipment conflict is proven. This replacement cannot be added to Builder Preview.",
    },
  };
  const after = appearance[proposed.status];
  const before = current ? appearance[current.status] : null;
  const issueCounts = {
    hard: proposed.findings.filter((issue) => issue.status === "incompatible").length,
    conditional: proposed.findings.filter((issue) => issue.status === "conditional").length,
    unknown: proposed.findings.filter((issue) => issue.status === "unverified").length,
  };
  const severity: Record<"incompatible" | "conditional" | "unverified", string> = {
    incompatible: "text-rose-100/85 border-rose-300/20",
    conditional: "text-amber-100/85 border-amber-300/20",
    unverified: "text-white/65 border-white/10",
  };
  return <section className="mt-4 border border-white/15 bg-[#0d1118] p-3 sm:p-4" aria-label="Compatibility check for hypothetical gear swap">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-cyan-100/65">Build compatibility · after hypothetical swap</p>
        <h4 className="mt-1 text-base font-bold text-white/90">Can this item fit the whole build?</h4>
      </div>
      <span className={`shrink-0 border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider ${after.style}`}>{after.label}</span>
    </div>
    <p className="mt-2 text-[11px] leading-relaxed text-white/55">{after.description}</p>
    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
      <div className="border border-white/10 p-2"><p className="text-[9px] uppercase tracking-wider text-white/45">Current build</p><p className={`mt-1 font-bold ${before?.style.includes("rose") ? "text-rose-100" : "text-white/75"}`}>{before?.label ?? "Unknown"}</p></div>
      <div className="border border-rose-300/15 p-2"><p className="text-[9px] uppercase tracking-wider text-white/45">Hard conflicts</p><p className="mt-1 text-base font-bold tabular-nums text-rose-100/85">{issueCounts.hard}</p></div>
      <div className="border border-amber-200/15 p-2"><p className="text-[9px] uppercase tracking-wider text-white/45">Conditional</p><p className="mt-1 text-base font-bold tabular-nums text-amber-100/85">{issueCounts.conditional}</p></div>
      <div className="border border-white/10 p-2"><p className="text-[9px] uppercase tracking-wider text-white/45">Unverified</p><p className="mt-1 text-base font-bold tabular-nums text-white/75">{issueCounts.unknown}</p></div>
    </div>
    {proposed.findings.length ? <details className="mt-3 border border-white/10 p-3" open={proposed.status === "incompatible"}>
      <summary className="cursor-pointer text-[11px] font-semibold text-white/80">Inspect findings ({proposed.findings.length})</summary>
      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
        {proposed.findings.map((finding) => <div key={finding.id} className={`min-w-0 border-l-2 bg-white/[0.018] py-2 pl-3 pr-1 ${severity[finding.status]}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="min-w-0 break-words text-xs font-bold">{finding.subject}</span>
            <span className="text-[9px] font-bold uppercase tracking-wider">{finding.status} · {finding.area}</span>
          </div>
          <p className="mt-1 break-words text-[11px] leading-relaxed text-white/50">{finding.reason}</p>
          <p className="mt-1 text-[9px] text-white/30">Evidence: {finding.evidence.split("_").join(" ")}</p>
        </div>)}
      </div>
    </details> : <p className="mt-3 text-[11px] text-cyan-100/70">No recognized compatibility findings for this hypothetical configuration.</p>}
    {proposed.inactiveBonuses.length > 0 && (
      <section className="mt-3 border border-white/10 bg-white/[0.018] p-3" aria-label="Inactive optional armor bonuses">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">Inactive optional set bonuses ({proposed.inactiveBonuses.length})</p>
        <p className="mt-1 text-[11px] text-white/40">Missing an optional set threshold is not a compatibility conflict.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {proposed.inactiveBonuses.map((set, index) => (
            <div key={`${set.setName}:${set.perkName}:${index}`} className="border border-white/10 p-2.5 text-[11px]">
              <p className="font-semibold text-white/75">{set.setName} · {set.perkName}</p>
              <p className="mt-1 text-white/45">{set.confirmedPieces}/{set.requiredPieces} pieces identified · threshold not met</p>
            </div>
          ))}
        </div>
      </section>
    )}
    {proposed.uncertainBonuses.length > 0 && <p className="mt-2 text-[11px] text-white/45">{proposed.uncertainBonuses.length} set bonus threshold(s) cannot be verified with current set identity or coverage.</p>}
    {proposed.sets.length > 0 && <details className="mt-2 border border-white/10 p-3">
      <summary className="cursor-pointer text-[11px] font-semibold text-white/70">All armor set thresholds ({proposed.sets.length})</summary>
      <div className="mt-2 space-y-2">{proposed.sets.map((set, index) => <div key={`${set.setName}:${set.perkName}:${set.requiredPieces}:${index}`} className="border border-white/10 p-2 text-[11px] text-white/60">
        <p className="font-semibold text-white/75">{set.setName} · {set.perkName}</p>
        <p className="mt-1">{set.confirmedPieces}/{set.requiredPieces} identified · {set.uncertainPieces} uncertain · {set.state === "met" ? "Threshold met" : set.state === "not_met" ? "Threshold not met" : "Unknown threshold"}</p>
        <p className="mt-1 text-[10px] text-white/35">Identity: {set.identity === "bungie_set_hash" ? "Bungie set hash" : "Set name only (not conclusive)"}. Combat activation not measured.</p>
      </div>)}</div>
    </details>}
    {proposed.warnings.length > 0 && <details className="mt-2 border border-white/10 p-3">
      <summary className="cursor-pointer text-[11px] font-semibold text-white/60">Validation limits ({proposed.warnings.length})</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] leading-relaxed text-white/45">{proposed.warnings.map((warning, i) => <li key={`${i}:${warning}`}>{warning}</li>)}</ul>
    </details>}
    <p className="mt-3 text-[10px] leading-relaxed text-white/40">Hard conflicts disable the preview. Conditional and unverified findings are shown for review, not silently blocked. This check does not equip items in Destiny or observe combat procs.</p>
  </section>;
}

/** Phase 8R.3.2: compare one hypothetical owned swap; never infer combat activations. */
function MechanicsTradeoff({ comparison }: {comparison: RecommendationCandidate["mechanics"]}) {
  const limited = comparison.incompleteBaseline;
  return <section className="mt-5 border border-violet-200/15 bg-[#0b1118] p-3 sm:p-4" aria-label="Mechanics comparison before and after hypothetical swap">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-200/75">Mechanics · before / after</p>
        <h4 className="mt-1 text-base font-bold text-white/90">What changes if you try this item?</h4>
      </div>
      <span className="border border-white/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-white/55">Hypothetical swap</span>
    </div>
    <div className="mt-3 grid grid-cols-3 gap-2">
      <div className="border border-cyan-200/20 bg-cyan-200/[0.035] p-2.5"><p className="text-[9px] uppercase tracking-wider text-cyan-100/65">Gained</p><p className="mt-1 text-xl font-bold tabular-nums text-cyan-100">+{comparison.added.length}</p></div>
      <div className="border border-amber-200/20 bg-amber-200/[0.035] p-2.5"><p className="text-[9px] uppercase tracking-wider text-amber-100/65">Lost</p><p className="mt-1 text-xl font-bold tabular-nums text-amber-100">−{comparison.lost.length}</p></div>
      <div className="border border-violet-200/20 bg-violet-200/[0.035] p-2.5"><p className="text-[9px] uppercase tracking-wider text-violet-100/65">New chains</p><p className="mt-1 text-xl font-bold tabular-nums text-violet-100">+{comparison.addedChains.length}</p></div>
    </div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <MechanicChangeList title="Potential gains" parts={comparison.added} empty="No newly recognized catalog mechanics." gain />
      <MechanicChangeList title="Potential losses" parts={comparison.lost} empty="No losses recognized in the current catalog." gain={false} />
    </div>
    {(comparison.addedChains.length > 0 || comparison.lostChains.length > 0) && <div className="mt-3 border border-violet-200/15 bg-violet-200/[0.025] p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-violet-100/75">Conditional mechanic chains</p>
      {comparison.addedChains.map((chain) => <p key={`a:${chain}`} className="mt-2 break-words text-[11px] text-cyan-100/80">+ {chain}</p>)}
      {comparison.lostChains.map((chain) => <p key={`l:${chain}`} className="mt-2 break-words text-[11px] text-amber-100/80">− {chain}</p>)}
      <p className="mt-2 text-[10px] leading-relaxed text-white/40">Chains are potential sequences. In-game activation was not observed.</p>
    </div>}
    {comparison.changedCopies.length > 0 && <div className="mt-3 border border-white/10 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/55">Selected mod copies (not stacking strength)</p>
      <div className="mt-2 flex flex-wrap gap-2">{comparison.changedCopies.map((copy) => <span key={copy.title} className="border border-white/10 px-2 py-1 text-[11px] text-white/65">{copy.title}: {copy.before} → {copy.after}</span>)}</div>
    </div>}
    {limited && <p role="note" className="mt-3 border border-amber-200/20 bg-amber-200/[0.045] p-3 text-[11px] leading-relaxed text-amber-100/80">Incomplete baseline: some selected gear details are missing. Additional losses may be undiscovered. Load selected details before treating this as a complete trade-off.</p>}
    <p className="mt-3 text-[10px] leading-relaxed text-white/40">Only rules in the current exact-hash sample catalog are compared. Numeric damage and proc probability are not scored. The separate Compatibility Check below inspects exotic limits and known set thresholds. A zero here means <em>no recognized change</em>, not no gameplay effect.</p>
  </section>;
}

function MechanicChangeList({title, parts, empty, gain}: {
  title: string;
  parts: RecommendationCandidate["mechanics"]["added"];
  empty: string;
  gain: boolean;
}) {
  const tone = gain ? "text-cyan-100/80" : "text-amber-100/80";
  return <div className="min-w-0 border border-white/10 bg-black/20 p-3">
    <p className={`text-[10px] font-bold uppercase tracking-[0.12em] ${tone}`}>{title} ({parts.length})</p>
    {parts.length ? <div className="mt-2 space-y-2">{parts.map((part) => <details key={part.id} className="group border border-white/10 bg-white/[0.02] p-2.5">
      <summary className="cursor-pointer list-none text-[11px] font-semibold text-white/85 [&::-webkit-details-marker]:hidden">
        <span className="flex items-start justify-between gap-2"><span className="min-w-0 break-words">{part.title}</span><span className={`shrink-0 text-[9px] font-semibold uppercase ${part.configuration === "missing_requirement" || part.configuration === "unknown" ? "text-amber-100/80" : "text-white/40"}`}>{mechanicCandidateStatus(part.configuration)}</span></span>
      </summary>
      <div className="mt-2 space-y-2 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-white/55">
        <p><strong className="text-white/65">Trigger:</strong> {part.trigger}</p>
        {part.effects.length > 0 && <div><p className="text-[10px] font-bold uppercase text-white/45">Potential effects</p><ul className="mt-1 list-disc space-y-1 pl-4">{part.effects.map((effect, i) => <li key={`${i}:${effect}`}>{effect}</li>)}</ul></div>}
        {part.prerequisites.length > 0 && <div><p className="text-[10px] font-bold uppercase text-white/45">Prerequisites</p><ul className="mt-1 list-disc space-y-1 pl-4">{part.prerequisites.map((req, i) => <li key={`${i}:${req}`}>{req}</li>)}</ul></div>}
      </div>
    </details>)}</div> : <p className="mt-2 text-[11px] leading-relaxed text-white/40">{empty}</p>}
  </div>;
}

function mechanicCandidateStatus(status: import("@/lib/destiny-builder/mechanicsResolver").MechanicConfiguration): string {
  switch (status) {
    case "eligible": return "Compatible";
    case "preview": return "Preview";
    case "missing_requirement": return "Needs setup";
    case "unknown": return "Unverified";
    case "theoretical": return "Theory";
  }
}

function RecommendationMetric({label, value, hint}: {label:string; value:number; hint:string}) {
  return <div className="min-w-0 border border-white/10 bg-black/15 p-3">
    <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-violet-100/55">{label}</p>
    <p className="mt-1 text-xl font-bold tabular-nums text-white/90">{value}</p>
    <p className="mt-1 text-[10px] text-white/35">{hint}</p>
  </div>;
}

function CandidateEvidenceCard({ evidence }: {evidence: CandidateEvidence}) {
  return <div className="border border-violet-200/10 bg-violet-200/[0.025] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-violet-200/65">{evidence.source === "intrinsic_perk" ? "Intrinsic perk" : "Selected perk"}</p>
      <span className="text-[9px] font-medium text-white/40">Mentions {evidence.effectLabel}</span>
    </div>
    <p className="mt-1.5 text-sm font-semibold text-white/85">{evidence.perkName}</p>
    <p className="mt-1.5 whitespace-pre-line break-words text-[11px] leading-relaxed text-white/50">{evidence.description || "Perk description unavailable; tagged effect requires further verification."}</p>
  </div>;
}
 