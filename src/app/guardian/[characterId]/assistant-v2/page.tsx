"use client";

/**
 * Destiny Builder — UI v2 / UI-Armor-A1 real optimizer connection.
 * Route: src/app/guardian/[characterId]/assistant-v2/page.tsx
 *
 * Isolated DIM-inspired layout, read-only Bungie-equipped snapshot.
 * UI-Armor-A1 legacy search remains intact and separately opt-in.
 * SYNC-2c hydrates authenticated SQLite details, then fetches bounded missing gear.
 * B0.6a2 uses individually reconciled item detail, fixed mods, and real Min/Max.
 * No preview save, equip, transfer or paid AI calls. The legacy route is unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppShell from "@/components/destiny-builder/AppShell";
import { ARMOR_3_STATS, ARMOR_SLOTS, optimizeOwnedArmor, type ArmorOptimizationReport } from "@/lib/destiny-builder/armorOptimizer";
import { collectCompatibilityFacts } from "@/lib/destiny-builder/compatibilityValidator";
import { createBuildContext, type InventoryItem, type CoreSnapshot, type AccountSnapshot, type ItemDetail } from "@/lib/destiny-builder/buildContext";
import { ARMOR_3_STAT_IDS } from "@/lib/destiny-builder/armorBaseStatsResolver";
import {
  runDetailClientSync, selectAccountDetailKeys, type DetailSyncProgress,
} from "@/lib/destiny-builder/itemDetailClientSync";
import { searchArmorCombinations, type ArmorCombinationSearch, type ArmorRanges, type ArmorWeights } from "@/lib/destiny-builder/armorCombinationEngine";
import { prepareArmorCombinationUi } from "@/lib/destiny-builder/armorCombinationUiBridge";
import {
  ARMOR_DETAIL_BATCH_LIMIT, selectMissingArmorDetailBatch,
  summarizeEquippedArmorSnapshot, type EquippedArmorSnapshot,
} from "@/lib/destiny-builder/armorEquippedSnapshot";

type GuardianOption = {
  characterId: string;
  className: string;
  light?: number | null;
  emblemPath?: string | null;
};

type Payload = Record<string, unknown> & { success?: boolean; error?: string };
type VisibleItem = InventoryItem & { icon?: string | null };
type StatChoice = { statHash: number; active: boolean; minimum: number; maximum: number };

const STAT_DEFAULTS: readonly StatChoice[] = [
  { statHash: 1735777505, active: true, minimum: 0, maximum: 200 }, // Grenade
  { statHash: 144602215, active: true, minimum: 0, maximum: 200 }, // Super
  { statHash: 2996146975, active: true, minimum: 0, maximum: 200 }, // Weapons
  { statHash: 4244567218, active: true, minimum: 0, maximum: 200 }, // Melee
  { statHash: 392767087, active: true, minimum: 0, maximum: 200 }, // Health
  { statHash: 1943323491, active: true, minimum: 0, maximum: 200 }, // Class
];

const PANEL = "min-w-0 border border-white/10 bg-[#0b1119]";
const TITLE = "text-[10px] font-black uppercase tracking-[0.17em] text-cyan-200/65";
const STAT_LABELS: Record<number, string> = {
  2996146975: "Armi", 392767087: "Salute", 1943323491: "Classe",
  1735777505: "Granata", 144602215: "Super", 4244567218: "Mischia",
};
const SLOT_LABELS: Record<number, string> = {
  3448274439: "Casco", 3551918588: "Guanti", 14239492: "Torace",
  20886954: "Gambe", 1585787867: "Oggetto di classe",
};

function classTypeOf(className: string): number | null {
  if (className === "Titan") return 0;
  if (className === "Hunter") return 1;
  if (className === "Warlock") return 2;
  return null;
}
function equipmentSlot(item: InventoryItem): number | null {
  return item.equipmentSlotHash ?? item.bucketHash ?? null;
}
function bungieIcon(value: string | null | undefined): string | null {
  if (!value || !/^\/common\/destiny2_content\/[a-zA-Z0-9_./-]+$/.test(value) || value.includes("..")) return null;
  return `https://www.bungie.net${value}`;
}
async function fetchSnapshot(url: string, signal: AbortSignal): Promise<Payload> {
  const perform = () => fetch(url, { cache: "no-store", signal });
  let response = await perform();
  if (response.status === 401 && !signal.aborted) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST", signal });
    if (refreshed.ok) response = await perform();
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object") {
    const error = data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error) : `Richiesta fallita (${response.status})`;
    throw new Error(error);
  }
  const payload = data as Payload;
  if (!payload.success) throw new Error(payload.error ?? "Bungie non ha restituito dati validi.");
  return payload;
}

function ItemPicture({ item, mark }: { item: VisibleItem | null; mark: string }) {
  const src = bungieIcon(item?.icon);
  return <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-[#15212e] text-lg text-cyan-100/70">
    {src ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span aria-hidden="true">{mark}</span>}
  </span>;
}

function ArmorStatList({ snapshot }: { snapshot: EquippedArmorSnapshot }) {
  // Only FULL scope=detail + six-stat reconcilations count as verified.
  // Incomplete sums are not lower bounds: a fixed tuning can have negative effects.
  const complete = snapshot.verifiedSlots === ARMOR_SLOTS.length && snapshot.observedGearTotals.every((x) => x !== null);
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className={TITLE}>Statistiche Armor 3.0</h3>
      <span className={`text-[10px] ${complete ? "text-emerald-200/75" : "text-amber-200/70"}`}>
        {snapshot.verifiedSlots}/5 dettagli riconciliati
      </span>
    </div>
    {ARMOR_3_STATS.map((stat) => {
      const index = ARMOR_3_STAT_IDS.indexOf(stat.statHash);
      const value = index < 0 ? null : snapshot.observedGearTotals[index];
      const partial = index < 0 ? null : snapshot.partialSums?.[index] ?? null;
      return <div key={stat.statHash} className="grid grid-cols-[72px_1fr_60px] items-center gap-2 text-xs">
        <span className="text-white/70">{STAT_LABELS[stat.statHash] ?? stat.name}</span>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full ${complete ? "bg-cyan-300/80" : "bg-white/30"}`}
            style={{width:`${value === null ? 0 : Math.max(0, Math.min(100, value / 2))}%`}} />
        </div>
        <span className="text-right font-bold tabular-nums text-white/80"
          title={complete ? "Totale delle cinque armature riconciliate" : `Somma parziale di ${snapshot.verifiedSlots}/5 armature riconciliate`}>
          {value !== null ? value : partial !== null && snapshot.verifiedSlots > 0 ? `Σ ${partial}` : "—"}
        </span>
      </div>;
    })}
    {!complete && <p className="text-[10px] text-amber-100/65">
      Mancano dettagli per: {snapshot.missingSlotHashes.map((slot) => SLOT_LABELS[slot] ?? String(slot)).join(", ")}.
      Le somme Σ sono parziali, non minimi garantiti.
    </p>}
    <p className="text-[10px] leading-relaxed text-white/40">
      Totali delle armature equipaggiate con mod/tuning già installati; non sono statistiche finali certificate del Guardian.
    </p>
  </div>;
}

export default function AssistantV2FoundationPage() {
  const params = useParams();
  const characterId = String(params.characterId ?? "");
  const [guardians, setGuardians] = useState<GuardianOption[]>([]);
  const [guardian, setGuardian] = useState<GuardianOption | null>(null);
  const [equipment, setEquipment] = useState<VisibleItem[]>([]);
  const [core, setCore] = useState<CoreSnapshot | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [details, setDetails] = useState<Record<string, ItemDetail>>({});
  const [report, setReport] = useState<ArmorOptimizationReport | null>(null);
  const [fixedReport, setFixedReport] = useState<ArmorCombinationSearch | null>(null);
  const [searchError, setSearchError] = useState("");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailFeedback, setDetailFeedback] = useState("");
  const [detailProgress, setDetailProgress] = useState<{done:number; total:number; loaded:number; failed:number} | null>(null);
  // SYNC-2c: separate non-blocking auto hydrate; manual loader stays available.
  const [backgroundProgress, setBackgroundProgress] = useState<DetailSyncProgress | null>(null);
  const [backgroundRun, setBackgroundRun] = useState(0);
  const [backgroundError, setBackgroundError] = useState("");
  const [failedDetailIds, setFailedDetailIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [statChoices, setStatChoices] = useState<StatChoice[]>(() => STAT_DEFAULTS.map((entry) => ({ ...entry })));
  // DIM-style explicit constraint: the user chooses whether to require the equipped exotic.
  const [keepCurrentExotic, setKeepCurrentExotic] = useState(true);
  const [draggedHash, setDraggedHash] = useState<number | null>(null);
  const requestGeneration = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const detailBusy = useRef(false);
  const backgroundController = useRef<AbortController | null>(null);
  const detailsRef = useRef<Record<string,ItemDetail>>({});

  const load = useCallback(async () => {
    backgroundController.current?.abort();
    backgroundController.current = null;
    setBackgroundProgress(null);
    setBackgroundError("");
    detailsRef.current = {};
    detailController.current?.abort();
    detailBusy.current = false;
    setDetailsLoading(false);
    setDetailFeedback("");
    setDetailProgress(null);
    setFailedDetailIds(new Set());
    setReport(null);
    setFixedReport(null);
    setSearchError("");
    setCore(null);
    setAccount(null);
    setAccountError("");
    setAccountLoading(false);
    setDetails({});
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const generation = ++requestGeneration.current;
    setLoading(true);
    setSyncing(true);
    setError("");
    setGuardian(null);
    setEquipment([]);
    try {
      const [characters, inventory] = await Promise.all([
        fetchSnapshot("/api/destiny/characters", controller.signal),
        fetchSnapshot(`/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=core`, controller.signal),
      ]);
      if (generation !== requestGeneration.current || controller.signal.aborted) return;
      const list = Array.isArray(characters.characters) ? characters.characters as GuardianOption[] : [];
      const chosen = list.find((candidate) => candidate.characterId === characterId);
      if (!chosen) throw new Error("Guardian non trovato nell'account Bungie.");
      setGuardians(list);
      setGuardian(chosen);
      const nextCore: CoreSnapshot = {
        equipment: Array.isArray(inventory.equipment) ? inventory.equipment as InventoryItem[] : [],
        inventory: Array.isArray(inventory.inventory) ? inventory.inventory as InventoryItem[] : [],
        subclasses: Array.isArray(inventory.subclasses) ? inventory.subclasses as CoreSnapshot["subclasses"] : [],
        subclassSetup: (inventory.subclassSetup ?? null) as CoreSnapshot["subclassSetup"],
        artifact: (inventory.artifact ?? inventory.seasonalArtifact ?? null) as CoreSnapshot["artifact"],
      };
      setCore(nextCore);
      setEquipment(nextCore.equipment as VisibleItem[]);
      setLoading(false); // Show Bungie equipped snapshot before account scope finishes.
      setAccountLoading(true);
      try {
        const payload = await fetchSnapshot(
          `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=account`,
          controller.signal,
        );
        if (generation !== requestGeneration.current || controller.signal.aborted) return;
        setAccount({
          vault: Array.isArray(payload.vault) ? payload.vault as InventoryItem[] : [],
          otherGuardianItems: Array.isArray(payload.otherGuardianItems) ? payload.otherGuardianItems as InventoryItem[] : [],
        });
      } catch (reason) {
        if (generation === requestGeneration.current && !controller.signal.aborted)
          setAccountError(reason instanceof Error ? reason.message : "Inventario Vault non disponibile.");
      } finally {
        if (generation === requestGeneration.current && !controller.signal.aborted) setAccountLoading(false);
      }
    } catch (reason) {
      if (generation === requestGeneration.current && !controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "Impossibile caricare il Guardian.");
    } finally {
      if (generation === requestGeneration.current && !controller.signal.aborted) {
        setLoading(false);
        setSyncing(false);
      }
    }
  }, [characterId]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
      activeController.current?.abort();
      detailController.current?.abort();
      backgroundController.current?.abort();
    };
  }, [load]);

  // Keep the current snapshot across async callback boundaries without restarting
  // the background task after every successfully hydrated item.
  useEffect(() => { detailsRef.current = details; }, [details]);

  const armor = useMemo(() => equipment.filter((part) => part.category === "armor"), [equipment]);
  const weapons = useMemo(() => equipment.filter((part) => part.category === "weapon"), [equipment]);
  const enabled = statChoices.filter((choice) => choice.active);
  const maxConstraints = statChoices.filter((choice) => choice.maximum < 200);
  // This context uses only the actual Bungie-equipped snapshot (never a local draft).
  const context = useMemo(() => core && guardian ? createBuildContext({
    guardian: { characterId, className: guardian.className,
      classType: classTypeOf(guardian.className), light: guardian.light ?? null },
    core, account, draft: null, detailsByInstanceId: details,
    activity: "general", mode: "owned", goal: "",
  }) : null, [characterId, core, account, guardian, details]);
  const facts = useMemo(() => core ? collectCompatibilityFacts(core, account, details) : {}, [core, account, details]);
  const ownedItems = useMemo(() => core ? [...core.equipment, ...core.inventory,
    ...(account?.vault ?? []), ...(account?.otherGuardianItems ?? [])] as VisibleItem[] : [], [core, account]);
  // Pure boundary: never turns core-only summaries into fully reconciled armor.
  const fixedInput = useMemo(() => prepareArmorCombinationUi({
    equipped: core?.equipment ?? [], inventory: core?.inventory ?? [],
    vault: account?.vault ?? [], otherGuardian: account?.otherGuardianItems ?? [],
  }, details), [core, account, details]);
  const equippedStatSnapshot = useMemo(() => summarizeEquippedArmorSnapshot(fixedInput.items), [fixedInput]);

  // SYNC-2c: run only once per loaded Guardian/account snapshot, or when user
  // explicitly presses Resume. API authentication and per-account isolation are
  // enforced by the server; this page never handles membership secrets.
  useEffect(() => {
    if (!core || !account || accountLoading || loading) return;
    const keys = selectAccountDetailKeys({
      equipped: core.equipment, inventory: core.inventory,
      vault: account.vault, otherGuardian: account.otherGuardianItems,
    });
    const generation = requestGeneration.current;
    const controller = new AbortController();
    backgroundController.current = controller;
    setBackgroundError("");
    const accepted = () => !controller.signal.aborted && generation === requestGeneration.current;
    void (async () => {
      try {
        await runDetailClientSync(keys, {
          signal:controller.signal,
          // On manual resume, reread server-side freshness hints. In-memory
          // copies must not suppress soft refresh forever.
          existing:backgroundRun > 0 ? {} : detailsRef.current,
          requestCache:async (batch,signal) => {
            const items = batch.map((entry)=>`${entry.itemInstanceId}:${entry.itemHash}`).join(",");
            return await fetchSnapshot(
              `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=cached-details&items=${encodeURIComponent(items)}`,
              signal,
            );
          },
          requestLive:async (entry,signal) => {
            const response=await fetchSnapshot(
              `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(entry.itemInstanceId)}&itemHash=${entry.itemHash}`,
              signal,
            );
            return response.item;
          },
          onDetails:(batch,origin)=> {
            if (!accepted()) return;
            setDetails(previous => {
              if (!accepted()) return previous;
              const next={...previous};
              let changed=false;
              for (const raw of batch) {
                const cached=next[raw.itemInstanceId];
                // A cache hit must never replace a fresher same-instance detail.
                if (origin === "cache" && cached?.itemHash === raw.itemHash) continue;
                next[raw.itemInstanceId]=raw as unknown as ItemDetail;
                changed=true;
              }
              if (!changed) return previous;
              detailsRef.current=next;
              return next;
            });
            // Results from an older detail snapshot cannot remain on screen.
            setReport(null);
            setFixedReport(null);
          },
          onProgress:(progress)=>{if(accepted())setBackgroundProgress(progress);},
        });
      } catch {
        if(accepted())setBackgroundError("Sincronizzazione locale non disponibile; usa il caricamento manuale.");
      } finally {
        if (backgroundController.current === controller) backgroundController.current = null;
      }
    })();
    return () => { controller.abort(); if(backgroundController.current === controller) backgroundController.current=null; };
  }, [core,account,accountLoading,loading,characterId,backgroundRun]);

  const equippedIds = useMemo(() => armor.map((item) => item.itemInstanceId).filter((id): id is string => !!id), [armor]);
  const pendingDetailCount = fixedInput.missingDetails.filter((item) => !failedDetailIds.has(item.itemInstanceId)).length;
  const equippedMissingDetailCount = fixedInput.missingDetails.filter((item) =>
    equippedIds.includes(item.itemInstanceId) && !failedDetailIds.has(item.itemInstanceId)).length;
  const ownedById = useMemo(() => {
    const result = new Map<string, VisibleItem>();
    for (const item of ownedItems) {
      if (item.itemInstanceId && !result.has(item.itemInstanceId)) result.set(item.itemInstanceId, item);
    }
    return result;
  }, [ownedItems]);
  const invalidateSearch = () => { setReport(null); setFixedReport(null); setSearchError(""); setDetailFeedback(""); };
  const selectedExotic = context?.build.gear.find((part) =>
    part.item.category === "armor" && Boolean(part.item.itemInstanceId) &&
    facts[part.item.itemInstanceId!]?.exotic === true) ?? null;
  const selectedExoticId = selectedExotic?.item.itemInstanceId ?? null;
  const lockedExoticWarning = report && selectedExoticId && keepCurrentExotic &&
    report.warnings.some((message) => message.startsWith(`Locked instance ${selectedExoticId} `));
  const lockedExoticProblem = lockedExoticWarning && report
    ? report.missingDetails.find((item) => item.itemInstanceId === selectedExoticId) ?? null : null;
  // Display the factual reason rather than treating HTTP 200 or a partially present response as verified.
  const selectedExoticDetail = selectedExoticId ? details[selectedExoticId] : null;
  const selectedExoticMissingStats = selectedExoticDetail
    ? ARMOR_3_STATS.filter((stat) => !selectedExoticDetail.armorStats?.some((value) =>
        value.statHash === stat.statHash && Number.isInteger(value.value) && value.value >= 0))
    : [];

  const findCombinations = () => {
    setFixedReport(null);
    setReport(null);
    setSearchError("");
    setDetailFeedback("");
    if (detailsLoading || detailBusy.current) return;
    if (!context || !core || !account || accountLoading) {
      setSearchError("Attendi il caricamento completo di Guardian, inventario e Vault.");
      return;
    }
    if (maxConstraints.length > 0) {
      setSearchError("I massimi assoluti non sono ancora supportati dal motore. Riporta i massimi a 200 per cercare senza ignorare i tuoi vincoli.");
      return;
    }
    const activeChoices = statChoices.filter((choice) => choice.active);
    const weights = new Map(activeChoices.map((choice, index) => [choice.statHash, activeChoices.length - index]));
    try {
      const next = optimizeOwnedArmor({
        context, detailsByInstanceId: details, facts,
        priorities: ARMOR_3_STATS.map((stat) => ({
          statHash: stat.statHash, weight: weights.get(stat.statHash) ?? 0,
        })),
        minimums: statChoices.filter((choice) => choice.minimum > 0).map((choice) => ({
          statHash: choice.statHash as (typeof ARMOR_3_STATS)[number]["statHash"], value: choice.minimum,
        })),
        preserveCurrentExotic: keepCurrentExotic,
        maxResults: 5,
        maxSearchNodes: 150000,
      });
      setReport(next);
      if (next.status === "invalid_request") setSearchError(next.warnings.at(-1) ?? "Richiesta non valida.");
    } catch (reason) {
      setSearchError(reason instanceof Error ? reason.message : "Ricerca interrotta.");
    }
  };

  const findFixedCombinations = () => {
    setReport(null);
    setFixedReport(null);
    setSearchError("");
    setDetailFeedback("");
    if (detailsLoading || detailBusy.current) return;
    const cls = guardian ? classTypeOf(guardian.className) : null;
    if (!core || !account || accountLoading || cls === null) {
      setSearchError("Attendi Guardian, inventario, Vault e classe verificata.");
      return;
    }
    const equippedExotics = fixedInput.items.filter((entry) => entry.source === "equipped" && entry.rarity === "exotic");
    const pinned = selectedExoticId ?? (equippedExotics.length === 1 ? equippedExotics[0].itemInstanceId : null);
    if (keepCurrentExotic && !pinned) {
      setSearchError("Esotica equipaggiata non identificata con certezza. Carica i dettagli o disattiva esplicitamente il vincolo esotica.");
      return;
    }
    const active = statChoices.filter((choice) => choice.active);
    const weights = Object.fromEntries(statChoices.map((choice) => [choice.statHash,
      choice.active ? active.length - active.findIndex((value) => value.statHash === choice.statHash) : 0])) as ArmorWeights;
    const ranges = Object.fromEntries(active.map((choice) => [choice.statHash,
      {min:choice.minimum,max:choice.maximum}])) as ArmorRanges;
    try {
      const next = searchArmorCombinations({
        classType: cls as 0 | 1 | 2,
        items: fixedInput.items,
        weights, ranges,
        lockedItemInstanceIds: keepCurrentExotic && pinned ? [pinned] : [],
        includeTransfers: true,
        maxResults: 5, maxEvaluations: 100_000,
      });
      setFixedReport(next);
      if (next.status === "invalid_request") setSearchError(next.reasons.join(" ") || "Richiesta non valida.");
    } catch (reason) {
      setSearchError(reason instanceof Error ? reason.message : "Ricerca B0.6 interrotta.");
    }
  };

  // Explicit, bounded read-only loader. Progress and successfully fetched details
  // are kept after cancellation; per-iteration concurrency NEVER exceeds two.
  const loadDetailsBatch = async (queue: readonly {itemInstanceId:string;itemHash:number}[]) => {
    if (!core || !account || detailBusy.current || detailsLoading || !queue.length ||
        (backgroundController.current && !backgroundController.current.signal.aborted)) return;
    const batch = queue.slice(0, ARMOR_DETAIL_BATCH_LIMIT);
    detailBusy.current = true;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    detailController.current = controller;
    setDetailsLoading(true);
    setReport(null);
    setFixedReport(null);
    setSearchError("");
    setDetailFeedback("");
    let done = 0;
    let loaded = 0;
    let failed = 0;
    setDetailProgress({done, total:batch.length, loaded, failed});
    try {
      for (let i = 0; i < batch.length && !controller.signal.aborted; i += 2) {
        const pair = batch.slice(i, i + 2);
        const fetched = await Promise.all(pair.map(async (item) => {
          try {
            const response = await fetchSnapshot(
              `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(item.itemInstanceId)}&itemHash=${item.itemHash}`,
              controller.signal,
            );
            const detail = response.item as ItemDetail | undefined;
            return detail && detail.itemInstanceId === item.itemInstanceId &&
              detail.itemHash === item.itemHash && Array.isArray(detail.armorStats) &&
              detail.armorStats.length > 0 ? detail : null;
          } catch { return null; }
        }));
        if (generation !== requestGeneration.current || controller.signal.aborted) break;
        const valid: ItemDetail[] = [];
        const failures: string[] = [];
        fetched.forEach((item, index) => {
          if (item) valid.push(item);
          else failures.push(pair[index].itemInstanceId);
        });
        if (valid.length) setDetails((previous) => {
          const next = {...previous};
          for (const item of valid) next[item.itemInstanceId] = item;
          return next;
        });
        if (failures.length) setFailedDetailIds((previous) => new Set([...previous, ...failures]));
        done += pair.length;
        loaded += valid.length;
        failed += failures.length;
        setDetailProgress({done, total:batch.length, loaded, failed});
      }
    } finally {
      if (detailController.current === controller) {
        detailController.current = null;
        detailBusy.current = false;
      }
      if (generation === requestGeneration.current) {
        setDetailsLoading(false);
        setDetailFeedback(controller.signal.aborted
          ? `Caricamento annullato: ${done}/${batch.length} richieste concluse; ${loaded} dettagli conservati.`
          : `Blocco completato: ${loaded}/${batch.length} dettagli ricevuti, ${failed} non disponibili. Premi Cerca B0.6 per aggiornare i risultati.`);
      }
    }
  };

  const loadMissingDetails = async () => {
    if (!report) return;
    const legacyMissing = report.missingDetails.filter((entry) => entry.reason === "not_loaded" &&
      !details[entry.itemInstanceId]);
    const queue = selectMissingArmorDetailBatch(
      legacyMissing.map((entry) => {
        const sourceItem = ownedById.get(entry.itemInstanceId);
        return {...entry, equipmentSlotHash: sourceItem ? equipmentSlot(sourceItem) ?? 0 : 0,
          name: sourceItem?.name ?? "Armatura"};
      }),
      equippedIds, failedDetailIds,
    );
    await loadDetailsBatch(queue);
  };
  const loadFixedMissingDetails = async (equippedOnly = false) => {
    const missing = equippedOnly
      ? fixedInput.missingDetails.filter((item) => equippedIds.includes(item.itemInstanceId))
      : fixedInput.missingDetails;
    await loadDetailsBatch(selectMissingArmorDetailBatch(missing, equippedIds, failedDetailIds));
  };
  const cancelDetailLoad = () => {
    detailController.current?.abort();
  };

  const moveStat = (hash: number, to: number) => {
    invalidateSearch();
    setStatChoices((previous) => {
      const from = previous.findIndex((choice) => choice.statHash === hash);
      if (from < 0 || to < 0 || to >= previous.length || from === to) return previous;
      const copy = [...previous];
      const [entry] = copy.splice(from, 1);
      copy.splice(to, 0, entry);
      return copy;
    });
  };
  const toggleStat = (hash: number, next: boolean) => {
    invalidateSearch();
    setStatChoices((previous) => {
      if (!next && previous.filter((entry) => entry.active).length <= 1) return previous;
      return previous.map((entry) => entry.statHash === hash ? { ...entry, active: next } : entry);
    });
  };
  // B0.6 applies both bounds. The unchanged legacy path still blocks custom maximums.
  const boundedStatValue = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.min(200, Math.trunc(value))) : 0;
  const setMinimum = (hash: number, next: number) => {
    invalidateSearch();
    const bounded = boundedStatValue(next);
    setStatChoices((previous) => previous.map((entry) => entry.statHash === hash
      ? { ...entry, minimum: bounded, maximum: Math.max(bounded, entry.maximum) } : entry));
  };
  const setMaximum = (hash: number, next: number) => {
    invalidateSearch();
    const bounded = boundedStatValue(next);
    setStatChoices((previous) => previous.map((entry) => entry.statHash === hash
      ? { ...entry, maximum: bounded, minimum: Math.min(bounded, entry.minimum) } : entry));
  };
  const onDragStart = (event: DragEvent<HTMLButtonElement>, hash: number) => {
    setDraggedHash(hash);
    event.dataTransfer.setData("application/x-destiny-armor-stat", String(hash));
    event.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault();
    if (!event.dataTransfer.types.includes("application/x-destiny-armor-stat")) return;
    const input = Number(event.dataTransfer.getData("application/x-destiny-armor-stat"));
    if (statChoices.some((entry) => entry.statHash === input)) moveStat(input, targetIndex);
    setDraggedHash(null);
  };

  return <AppShell
    activeSection="builder"
    guardianContextSection="build"
    guardianId={characterId}
    guardianClassName={guardian?.className ?? "Guardian"}
    guardianEmblemPath={guardian?.emblemPath ?? null}
    guardianOptions={guardians.map((entry) => ({ characterId: entry.characterId, className: entry.className,
      light: entry.light ?? 0, emblemPath: entry.emblemPath,
      href: `/guardian/${entry.characterId}/assistant-v2` }))}
    currentBuildHref={`/guardian/${characterId}`}
    loadoutsHref={`/guardian/${characterId}/loadouts`}
    subclassHref={`/guardian/${characterId}/subclass`}
    artifactHref={`/guardian/${characterId}/artifact`}
    power={guardian?.light ?? null}
    syncing={syncing}
    autoSync={false}
    bungieSynced={!loading && !error && Boolean(guardian)}
    onSync={() => { void load(); }}
  >
    <style>{`
      input.armor-v2-range { appearance: none; -webkit-appearance: none; background: transparent; pointer-events: none; margin: 0; }
      input.armor-v2-range::-webkit-slider-runnable-track { height: 4px; background: transparent; }
      input.armor-v2-range::-moz-range-track { height: 4px; background: transparent; }
      input.armor-v2-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border: 2px solid #081018; border-radius: 50%; background: #67e8f9; cursor: ew-resize; pointer-events: auto; margin-top: -5px; }
      input.armor-v2-range::-moz-range-thumb { width: 12px; height: 12px; border: 2px solid #081018; border-radius: 50%; background: #67e8f9; cursor: ew-resize; pointer-events: auto; }
      input.armor-v2-range:focus-visible { outline: none; }
      input.armor-v2-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px #0b1119, 0 0 0 5px #67e8f9; }
      input.armor-v2-range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px #0b1119, 0 0 0 5px #67e8f9; }
    `}</style>
    <main className="min-h-screen bg-[#080d13] px-3 pb-16 pt-5 text-white sm:px-5 lg:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <p className={TITLE}>Destiny Builder / UI v2 · Armor-A1</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Armor Optimizer</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
            UI v2: B0.6 applica Min/Max assoluti alle cinque armature possedute, mantenendo mod e tuning attuali. Il motore precedente resta disponibile.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/guardian/${characterId}/assistant`} className="border border-white/15 px-3 py-2 text-[11px] font-bold text-white/70 transition hover:border-white/40 hover:text-white">
            ← Apri Assistant classico
          </Link>
          <span className="border border-cyan-200/20 bg-cyan-200/[0.07] px-3 py-2 text-[10px] font-black tracking-wider text-cyan-100/70">ANTEPRIMA UI · NO EQUIP</span>
        </div>
      </header>

      {error && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-rose-300/30 bg-rose-900/10 p-3 text-xs text-rose-100">
        <span>Impossibile caricare dati Bungie: {error}</span>
        <button type="button" onClick={() => void load()} className="border border-rose-300/30 px-3 py-1 font-bold">Riprova</button>
      </div>}

      <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(215px,0.92fr)_minmax(310px,1.24fr)_minmax(340px,2.1fr)]">
        <aside className={`${PANEL} space-y-5 p-3.5 sm:p-4`} aria-label="Guardian attualmente equipaggiato">
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="flex h-11 w-11 items-center justify-center border border-cyan-200/25 bg-cyan-200/10 text-xl text-cyan-100">◇</div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold">{guardian?.className ?? (loading ? "Caricamento…" : "Guardian")}</p>
              <p className="text-[10px] text-white/45">{loading ? "Sincronizzazione" : guardian ? `Potere ${guardian.light ?? "—"} · Equipaggiato Bungie` : "Dati non disponibili"}</p>
            </div>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2"><h2 className={TITLE}>Armi equipaggiate</h2><span className="text-[9px] text-white/35">READ ONLY</span></div>
            {loading ? <p className="py-4 text-xs text-white/45">Caricamento armi…</p> : weapons.length ? weapons.map((item, index) => <div key={item.itemInstanceId ?? `${item.itemHash}-${index}`} className="flex min-w-0 items-center gap-2 border border-white/[0.08] bg-white/[0.02] p-2">
              <ItemPicture item={item} mark="⚔" />
              <div className="min-w-0"><p className="truncate text-[11px] font-semibold" title={item.name}>{item.name}</p><p className="mt-0.5 text-[10px] text-white/45">Potere {item.power ?? "—"}</p></div>
            </div>) : <p className="py-3 text-[11px] text-white/45">Nessuna arma verificata nello snapshot.</p>}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2"><h2 className={TITLE}>Armatura equipaggiata</h2><span className="text-[9px] text-white/35">READ ONLY</span></div>
            {ARMOR_SLOTS.map((slot, index) => {
              const item = armor.find((part) => equipmentSlot(part) === slot.slotHash) ?? null;
              return <div key={slot.slotHash} className="flex min-w-0 items-center gap-2 border border-white/[0.08] bg-white/[0.02] p-2">
                <ItemPicture item={item} mark={["♜", "◈", "◇", "♢", "✧"][index]} />
                <div className="min-w-0"><p className="text-[9px] uppercase tracking-wide text-white/35">{SLOT_LABELS[slot.slotHash]}</p><p className="truncate text-[11px] font-semibold" title={item?.name ?? ""}>{loading ? "Caricamento…" : item?.name ?? "Dato non disponibile"}</p><p className="mt-0.5 text-[10px] text-white/45">Potere {item?.power ?? "—"}</p></div>
              </div>;
            })}
          </section>
          <div className="border-t border-white/10 pt-4"><ArmorStatList snapshot={equippedStatSnapshot} /></div>
          <p className="border border-cyan-200/10 bg-cyan-200/[0.03] p-2.5 text-[10px] leading-relaxed text-white/50">
            Snapshot equipaggiato, senza cambiare oggetti. Nessun trasferimento, equip o salvataggio della Builder Preview.
          </p>
        </aside>

        <aside className={PANEL} aria-label="Controlli Armor Optimizer">
          <div className="border-b border-white/10 px-4 py-3">
            <h2 className="text-xs font-black uppercase tracking-[0.1em]">Stat Priorities &amp; Ranges</h2>
            <p className="mt-1 text-[10px] text-white/40">Trascina dai pallini ⠿ o usa ↑ ↓. Il nuovo motore applica Min e Max assoluti; il motore precedente supporta solo i minimi.</p>
          </div>
          <div className="space-y-1.5 p-3">
            {statChoices.map((choice, index) => {
              const label = STAT_LABELS[choice.statHash] ?? String(choice.statHash);
              const order = statChoices.slice(0, index + 1).filter((entry) => entry.active).length;
              const weight = choice.active ? enabled.length - order + 1 : 0;
              return <div key={choice.statHash}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("application/x-destiny-armor-stat")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => onDrop(event, index)}
                className={`border p-2.5 ${draggedHash === choice.statHash ? "border-cyan-200/60 bg-cyan-200/10" : choice.active ? "border-cyan-200/20 bg-[#101a24]" : "border-white/10 bg-[#0c121a] opacity-75"}`}>
                <div className="flex items-center gap-2">
                  <button type="button" draggable onDragStart={(event) => onDragStart(event, choice.statHash)}
                    onDragEnd={() => setDraggedHash(null)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); moveStat(choice.statHash, index - 1); }
                      if (event.key === "ArrowDown" && index < statChoices.length - 1) { event.preventDefault(); moveStat(choice.statHash, index + 1); }
                    }}
                    aria-label={`Trascina ${label} dai pallini o usa le frecce per riordinare`}
                    title="Trascina solo da qui · oppure usa ↑ ↓"
                    className="select-none cursor-grab touch-none border border-transparent px-1 text-lg leading-none text-white/45 transition hover:border-cyan-200/30 hover:text-cyan-100 active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">⠿</button>
                  <input aria-label={`Includi ${label} nelle priorità`} type="checkbox" checked={choice.active}
                    disabled={choice.active && enabled.length === 1}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => toggleStat(choice.statHash, event.target.checked)}
                    className="h-3.5 w-3.5 accent-cyan-300" />
                  <span className="min-w-0 flex-1 text-[11px] font-bold">{label}</span>
                  <span className="shrink-0 text-[9px] tabular-nums text-white/45">{choice.active ? `Priorità ${order} · Peso ${weight}` : "Esclusa"}</span>
                  <div className="flex gap-1">
                    <button type="button" aria-label={`Sposta ${label} sopra`} disabled={index === 0} onClick={() => moveStat(choice.statHash, index - 1)} className="border border-white/15 px-1.5 py-0.5 text-xs hover:border-cyan-200/35 disabled:opacity-25">↑</button>
                    <button type="button" aria-label={`Sposta ${label} sotto`} disabled={index === statChoices.length - 1} onClick={() => moveStat(choice.statHash, index + 1)} className="border border-white/15 px-1.5 py-0.5 text-xs hover:border-cyan-200/35 disabled:opacity-25">↓</button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[48px_minmax(0,1fr)_48px] items-end gap-2" role="group" aria-label={`Intervallo per ${label}`}>
                  <label htmlFor={`v2-min-${choice.statHash}`} className="block min-w-0">
                    <span className="mb-1 block text-[9px] uppercase tracking-wide text-white/45">Min</span>
                    <input id={`v2-min-${choice.statHash}`} type="number" min={0} max={200} step={1} value={choice.minimum}
                      onChange={(event) => setMinimum(choice.statHash, Number(event.target.value))}
                      className="w-full min-w-0 border border-white/20 bg-[#080f17] px-1 py-1 text-center text-[11px] tabular-nums text-white" />
                  </label>
                  <div className="relative mb-2 h-5 min-w-0" aria-label={`Intervallo ${choice.minimum}–${choice.maximum} su 200`}>
                    <div className="pointer-events-none absolute inset-x-0 top-[9px] h-1 rounded-full bg-white/15" />
                    <div className="pointer-events-none absolute top-[9px] h-1 rounded-full bg-cyan-300/85"
                      style={{ left: `${choice.minimum / 2}%`, right: `${100 - choice.maximum / 2}%` }} />
                    <input aria-label={`Trascina minimo ${label}`} type="range" min={0} max={200} step={1}
                      value={choice.minimum} onChange={(event) => setMinimum(choice.statHash, Number(event.target.value))}
                      className="armor-v2-range absolute inset-x-0 top-0 z-20 h-5 w-full" />
                    <input aria-label={`Trascina massimo ${label}`} type="range" min={0} max={200} step={1}
                      value={choice.maximum} onChange={(event) => setMaximum(choice.statHash, Number(event.target.value))}
                      className="armor-v2-range absolute inset-x-0 top-0 z-10 h-5 w-full" />
                  </div>
                  <label htmlFor={`v2-max-${choice.statHash}`} className="block min-w-0">
                    <span className="mb-1 block text-[9px] uppercase tracking-wide text-white/45">Max</span>
                    <input id={`v2-max-${choice.statHash}`} type="number" min={0} max={200} step={1} value={choice.maximum}
                      onChange={(event) => setMaximum(choice.statHash, Number(event.target.value))}
                      className="w-full min-w-0 border border-white/20 bg-[#080f17] px-1 py-1 text-center text-[11px] tabular-nums text-white" />
                  </label>
                </div>
              </div>;
            })}
            <button type="button" onClick={() => { setStatChoices(STAT_DEFAULTS.map((entry) => ({ ...entry }))); invalidateSearch(); }}
              className="mt-2 w-full border border-white/15 px-3 py-2 text-[10px] font-semibold text-white/65 hover:border-white/35">Reimposta priorità</button>
          </div>
          <div className="space-y-3 border-t border-white/10 p-3">
            <div className="border border-cyan-200/20 bg-cyan-200/[0.035] p-3">
              <p className="text-[11px] font-bold">Armatura esotica equipaggiata</p>
              <p className="mt-1 text-[11px] text-white/65">{selectedExotic?.item.name ?? "Nessuna esotica verificata nel contesto"}</p>
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] text-white/75">
                <input type="checkbox" checked={keepCurrentExotic}
                  onChange={(event) => { setKeepCurrentExotic(event.target.checked); invalidateSearch(); }}
                  className="mt-0.5 accent-cyan-300" />
                <span>Mantieni obbligatoriamente l'esotica attualmente equipaggiata</span>
              </label>
              <p className="mt-1.5 text-[10px] leading-relaxed text-white/40">Se disattivi il vincolo, il motore può proporre combinazioni diverse, anche senza esotica. Nessun oggetto viene equipaggiato o spostato.</p>
            </div>
            {[
              ["Assumi Masterwork", "Calcolo e validazione da integrare"],
              ["Bonus set e mod", "Solo effetti e valori verificabili"],
              ["Oggetti bloccati / esclusi", "Gestione istanze e Vault"],
            ].map(([title, subtitle]) => <div key={title} className="border border-white/[0.08] bg-white/[0.02] p-3">
              <p className="text-[11px] font-semibold text-white/70">{title}</p>
              <p className="mt-1 text-[10px] text-white/40">{subtitle}</p>
              <p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-amber-200/55">Da collegare</p>
            </div>)}
          </div>
        </aside>

        <section className={`${PANEL} min-h-[540px]`} aria-label="Risultati Armor Optimizer">
          <div className="border-b border-white/10 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black uppercase tracking-wider">Combinazioni armatura</h2>
              <span className="border border-cyan-200/20 px-2 py-1 text-[9px] font-semibold text-cyan-100/75">RICERCA LOCALE · NO EQUIP</span>
            </div>
            <p className="mt-2 text-xs text-white/45">B0.6: cinque pezzi riconciliati singolarmente, mod e tuning invariati. Totali degli oggetti, non statistiche finali del Guardian.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={findFixedCombinations}
                disabled={!account || accountLoading || loading || detailsLoading}
                className="border border-cyan-200/40 bg-cyan-200/10 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-cyan-50 hover:bg-cyan-200/20 disabled:cursor-not-allowed disabled:opacity-35">
                {accountLoading ? "Caricamento Vault…" : "Cerca B0.6 · Min/Max"}
              </button>
              <button type="button" onClick={findCombinations}
                disabled={!account || accountLoading || loading || detailsLoading || maxConstraints.length > 0}
                className="border border-white/20 px-3 py-2 text-[10px] font-semibold text-white/65 disabled:opacity-30">
                Motore precedente
              </button>
              <button type="button" onClick={() => { void loadFixedMissingDetails(true); }}
                disabled={!account || accountLoading || loading || detailsLoading ||
                  backgroundProgress?.stage === "cache" || backgroundProgress?.stage === "live" || equippedMissingDetailCount === 0}
                className="border border-cyan-200/30 px-3 py-2 text-[10px] font-semibold text-cyan-100 disabled:opacity-30">
                {`Equipaggiate · ${equippedMissingDetailCount} da verificare`}
              </button>
              <button type="button" onClick={() => { void loadFixedMissingDetails(); }}
                disabled={!account || accountLoading || loading || detailsLoading ||
                  backgroundProgress?.stage === "cache" || backgroundProgress?.stage === "live" || pendingDetailCount === 0}
                className="border border-white/15 px-3 py-2 text-[10px] font-semibold text-white/65 disabled:opacity-30">
                {`Carica ${Math.min(ARMOR_DETAIL_BATCH_LIMIT,pendingDetailCount)} dettagli · ${pendingDetailCount} in coda`}
              </button>
              {backgroundProgress && (backgroundProgress.stage === "cache" || backgroundProgress.stage === "live") &&
                <button type="button" onClick={()=>{backgroundController.current?.abort();
                  setBackgroundProgress(previous=>previous ? {...previous,stage:"paused"} : previous);}}
                  className="border border-amber-200/35 px-3 py-2 text-[10px] font-semibold text-amber-100">Pausa sync automatica</button>}
              {backgroundProgress && (backgroundProgress.stage === "paused" || backgroundProgress.stage === "cache_unavailable") &&
                backgroundProgress.pending > 0 &&
                <button type="button" onClick={()=>setBackgroundRun(value=>value+1)}
                  className="border border-cyan-200/30 px-3 py-2 text-[10px] font-semibold text-cyan-100">Riprendi sync</button>}
              {detailsLoading && <button type="button" onClick={cancelDetailLoad}
                className="border border-amber-200/35 px-3 py-2 text-[10px] font-semibold text-amber-100">Annulla</button>}
              {failedDetailIds.size > 0 && !detailsLoading && <button type="button" onClick={() => setFailedDetailIds(new Set())}
                className="border border-amber-200/25 px-3 py-2 text-[10px] text-amber-100">Riprova {failedDetailIds.size} falliti</button>}
              <span className="text-[10px] text-white/45">{account ? "Guardian + Vault + altri Guardian disponibili" : "Attendo inventario account completo"}</span>
            </div>
            {maxConstraints.length > 0 && <p className="mt-2 text-[11px] text-amber-100/85" role="status">
              I massimi {maxConstraints.map((c) => STAT_LABELS[c.statHash]).join(", ")} funzionano in B0.6; bloccano soltanto il motore precedente.
            </p>}
            {accountError && <p className="mt-2 text-[11px] text-amber-100/85" role="alert">Vault/altri Guardian non disponibili: {accountError} · Riprova con Sync Bungie.</p>}
            {searchError && <p className="mt-2 text-[11px] text-rose-200" role="alert">{searchError}</p>}
            {backgroundProgress && <div className="mt-2 space-y-1 border border-white/10 p-2.5" role="status" aria-live="polite">
              <p className="text-[11px] font-semibold text-cyan-100/85">
                {backgroundProgress.stage === "cache" ? "Lettura dettagli SQLite…" :
                 backgroundProgress.stage === "live" ? "Sincronizzazione automatica Bungie in background…" :
                 backgroundProgress.stage === "complete" ? "Dettagli disponibili per lo snapshot attuale" :
                 backgroundProgress.stage === "cache_unavailable" ? "Cache SQLite non disponibile: download automatici disattivati" :
                 "Sincronizzazione in pausa o limite per sessione raggiunto"}
              </p>
              <p className="text-[10px] text-white/50">
                Cache: {backgroundProgress.cacheHits} · Risposte live: {backgroundProgress.liveLoaded}/{backgroundProgress.liveDone} · Restanti: {backgroundProgress.pending} · Errori: {backgroundProgress.failed}
              </p>
              {backgroundProgress.refreshDue > 0 && <p className="text-[10px] text-cyan-100/60">
                Verifica periodica: {backgroundProgress.refreshDone}/{backgroundProgress.refreshDue} tentativi · {backgroundProgress.refreshRemaining} differiti.
                I dettagli non ricontrollati rimangono disponibili dalla cache, non confermati live.
              </p>}
              {backgroundProgress.stage === "complete" && backgroundProgress.refreshRemaining > 0 &&
                <button type="button" onClick={()=>setBackgroundRun(value=>value+1)}
                  className="border border-cyan-200/30 px-2 py-1 text-[10px] font-semibold text-cyan-100">Ricontrolla altri 8 dettagli</button>}
              <progress max={Math.max(1,backgroundProgress.total)}
                value={Math.min(backgroundProgress.total,backgroundProgress.total-backgroundProgress.pending)}
                className="h-1.5 w-full accent-cyan-300" />
              <p className="text-[10px] text-white/40">
                Massimo 256 richieste live per avvio, di cui fino a 8 ricontrolli periodici; 2 in parallelo. Nessuna certificazione live o di installabilità.
              </p>
            </div>}
            {backgroundError && <p className="mt-2 text-[11px] text-amber-100" role="alert">{backgroundError}</p>}
            {detailProgress && <div className="mt-2 space-y-1" role="status" aria-live="polite">
              <p className="text-[11px] text-cyan-100/85">Dettagli: {detailProgress.done}/{detailProgress.total} · ricevuti {detailProgress.loaded} · falliti {detailProgress.failed}</p>
              <progress max={detailProgress.total} value={detailProgress.done} className="h-1.5 w-full accent-cyan-300" />
            </div>}
            {detailFeedback && <p className="mt-2 text-[11px] text-cyan-100/85" role="status">{detailFeedback}</p>}
          </div>
          {fixedReport ? <div className="space-y-3 p-3 sm:p-4">
             <div className="border border-cyan-200/20 bg-cyan-200/[0.035] p-3 text-[11px] text-white/75">
               <div className="flex flex-wrap items-center justify-between gap-2">
                 <strong className="text-cyan-100">B0.6 · {fixedReport.results.length} combinazioni candidate</strong>
                 <span className="text-amber-200">Installabilità NON certificata</span>
               </div>
               <p className="mt-2">Stato: {fixedReport.status} · {fixedReport.eligibleItems} istanze idonee · {fixedReport.evaluatedCombinations} combinazioni valutate.</p>
               <p className="mt-1">{fixedReport.searchComplete ? "Ricerca completa sui dettagli già verificati (non su tutto il Vault)." : "Ricerca incompleta: graduatoria provvisoria."}</p>
               {fixedReport.missingSlotHashes.length > 0 && <p className="mt-2 text-amber-200">Mancano candidati riconciliati: {fixedReport.missingSlotHashes.map((id) => SLOT_LABELS[id] ?? String(id)).join(", ")}.</p>}
               <p className="mt-2">Dettagli da richiedere: {pendingDetailCount} · richieste fallite in attesa di un eventuale retry: {failedDetailIds.size}. I caricamenti sono sempre manuali e a blocchi di massimo {ARMOR_DETAIL_BATCH_LIMIT}.</p>
               <details className="mt-3 text-white/50"><summary className="cursor-pointer">Motivi ed esclusioni</summary>
                 <div className="mt-2 space-y-1">{Object.entries(fixedReport.rejectedItems).map(([reason,count]) => <p key={reason}>{reason}: {count}</p>)}
                   {fixedReport.reasons.map((reason,index) => <p key={index}>{reason}</p>)}</div>
               </details>
             </div>
             {fixedReport.results.map((combination,index) => <article key={combination.pieces.map((piece) => piece.itemInstanceId).join("|")}
               className="min-w-0 space-y-3 border border-white/10 bg-[#0e1823] p-3">
               <div className="flex flex-wrap items-center justify-between gap-2">
                 <h3 className="text-xs font-bold">Combinazione {index+1} · punteggio {combination.weightedScore}</h3>
                 <span className="text-[10px] text-white/50">{combination.requiresTransfer ? "Richiede trasferimento manuale" : "Nessun trasferimento necessario"}</span>
               </div>
               <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                 {ARMOR_3_STAT_IDS.map((id,i) => <div key={id} className="border border-white/10 p-2">
                   <p className="text-[9px] text-white/45">{STAT_LABELS[id]}</p>
                   <p className="mt-1 text-sm font-bold tabular-nums">{combination.observedGearStats[i]}</p>
                   <p className="text-[9px] text-white/40">Roll base {combination.baseRollStats[i]}</p>
                 </div>)}
               </div>
               <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 2xl:grid-cols-5">
                 {combination.pieces.map((piece,i) => {
                   const raw = ownedById.get(piece.itemInstanceId);
                   const display = raw?.itemHash === piece.itemHash ? raw : null;
                   return <div key={piece.itemInstanceId} className="min-w-0 border border-white/10 p-2">
                     <div className="flex items-center gap-2"><ItemPicture item={display} mark={["♜","◈","◇","♢","✧"][i] ?? "◇"}/>
                       <div className="min-w-0"><p className="text-[9px] text-white/40">{SLOT_LABELS[piece.equipmentSlotHash]}</p>
                         <p className="truncate text-[11px] font-semibold" title={display?.name ?? ""}>{display?.name ?? "Armatura"}</p>
                         <p className="text-[9px] text-white/45">{piece.rarity === "exotic" ? "Esotica · " : ""}{piece.source === "vault" ? "Deposito" : piece.source === "other_guardian" ? "Altro Guardian" : piece.source === "inventory" ? "Inventario" : "Equipaggiata"}</p>
                       </div>
                     </div>
                   </div>;
                 })}
               </div>
               <p className="text-[10px] text-white/40">Mod e tuning attualmente installati invariati · Nessun equipaggiamento/Preview salvata · Valori del solo equipaggiamento.</p>
             </article>)}
             {!fixedReport.results.length && <p className="text-xs text-amber-200">Nessuna combinazione completa: controlla copertura slot, esotica bloccata, Min/Max e dettagli non caricati.</p>}
           </div> : !report ? <div className="flex min-h-[260px] flex-col items-center justify-center px-5 py-10 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center border border-cyan-200/20 bg-cyan-200/[0.06] text-2xl text-cyan-100/70" aria-hidden="true">▦</div>
            <p className="text-base font-bold">Imposta le priorità e avvia la ricerca</p>
            <p className="mt-2 max-w-md text-xs leading-relaxed text-white/45">
              Avvia B0.6 per Min/Max assoluti con modificatori invariati, oppure il motore precedente. I dettagli mancanti si caricano soltanto premendo il pulsante.
            </p>
          </div> : <div className="space-y-3 p-3 sm:p-4">
            <div className="border border-white/10 bg-white/[0.025] p-3 text-[11px] text-white/70">
              <strong className="text-cyan-100">{report.results.length} combinazioni verificate</strong>
              <span className="ml-2">· {report.totalOwnedArmorConsidered} armature possedute osservate</span>
              <span className="ml-2">· {report.missingDetailCount} dettagli assenti o incompleti</span>
              <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5" aria-label="Candidati utilizzabili per slot">
                {ARMOR_SLOTS.map((slot) => {
                  const count = report.verifiedCandidatesBySlot[String(slot.slotHash)] ?? 0;
                  return <div key={slot.slotHash} className={`border px-2 py-1.5 ${count ? "border-white/10 text-white/70" : "border-amber-200/30 bg-amber-200/[0.06] text-amber-100"}`}>
                    <span className="block text-[9px]">{SLOT_LABELS[slot.slotHash]}</span>
                    <strong className="text-xs tabular-nums">{count} verificati</strong>
                  </div>;
                })}
              </div>
              {lockedExoticWarning && <div className="mt-3 border border-amber-200/30 bg-amber-200/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-100/90" role="alert">
                <strong>Esotica obbligatoria non utilizzabile: {selectedExotic?.item.name}.</strong>
                <p className="mt-1">{lockedExoticProblem?.reason === "not_loaded"
                  ? "Il dettaglio esatto dell'istanza non è ancora disponibile. Carica i dettagli mancanti prima di cercare."
                  : lockedExoticProblem?.reason === "invalid_or_incomplete"
                    ? "Il dettaglio è presente, ma non supera la verifica completa dei sei valori Armor 3.0."
                    : "Questa istanza non ha superato uno dei controlli del motore: verifica proprietà, classe, posizione e identità tramite i conteggi e la diagnostica sottostante."}</p>
                {selectedExoticMissingStats.length > 0 && <p className="mt-1">Statistiche assenti o non valide: {selectedExoticMissingStats.map((entry) => STAT_LABELS[entry.statHash]).join(", ")}.</p>}
                <p className="mt-1">Puoi disattivare volontariamente «Mantieni esotica» per verificare se gli altri pezzi producono combinazioni; il motore non inventerà valori mancanti.</p>
              </div>}
              <details className="mt-3 text-[10px] text-white/55">
                <summary className="cursor-pointer">Diagnostica esclusioni e copertura ({Object.keys(report.rejected).length} categorie)</summary>
                <div className="mt-2 space-y-1">{Object.entries(report.rejected).sort((a,b)=>b[1]-a[1]).map(([reason,count]) =>
                  <p key={reason}><span className="tabular-nums">{count}</span> · {reason}</p>)}</div>
                <p className="mt-2">Dettagli mancanti: {report.missingDetails.filter((entry) => entry.reason === "not_loaded").length} da caricare · {report.missingDetails.filter((entry) => entry.reason === "invalid_or_incomplete").length} presenti ma incompleti. La ricerca resta conservativa.</p>
              </details>
              <p className="mt-1 text-[10px] text-white/45">{report.globallyExhaustive
                ? "Ricerca esaustiva sui candidati disponibili e verificati."
                : "Copertura parziale: i risultati non garantiscono il miglior assetto globale."}</p>
              {report.missingDetails.some((item) => item.reason === "not_loaded" && !details[item.itemInstanceId] && !failedDetailIds.has(item.itemInstanceId)) &&
                <button type="button" onClick={() => { void loadMissingDetails(); }} disabled={detailsLoading}
                  className="mt-3 border border-cyan-200/35 bg-cyan-200/[0.08] px-3 py-2 text-[10px] font-semibold text-cyan-100 disabled:opacity-40">
                  {detailsLoading ? "Caricamento dettagli…" : `Carica fino a ${ARMOR_DETAIL_BATCH_LIMIT} dettagli mancanti (Bungie, sola lettura)`}
                </button>}
              {report.results.length === 0 && <p className="mt-2 text-[11px] text-amber-100/75">
                Nessuna combinazione completa verificata. Controlla i candidati disponibili per slot e gli avvisi: potrebbe trattarsi di una esotica obbligatoria non verificata, di slot senza candidati, di dati incompleti o di minimi non raggiungibili.
              </p>}
            </div>
            {report.results.map((result, index) => <article key={result.id} className="min-w-0 space-y-3 border border-cyan-200/15 bg-[#0e1823] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold">Combinazione {index + 1}</h3>
                <span className="text-[10px] text-white/55">{result.changes} slot diversi · Totale armatura {result.armorItemTotal}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {result.stats.map((entry) => <div key={entry.statHash} className="border border-white/10 bg-black/15 px-2 py-1.5">
                  <p className="text-[9px] text-white/45">{STAT_LABELS[entry.statHash] ?? entry.name}</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">{entry.itemTotal}</p>
                  <p className={`text-[9px] tabular-nums ${entry.deltaFromCurrent === null ? "text-white/35" : entry.deltaFromCurrent >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                    {entry.deltaFromCurrent === null ? "Δ n/d" : `${entry.deltaFromCurrent >= 0 ? "+" : ""}${entry.deltaFromCurrent}`}
                  </p>
                </div>)}
              </div>
              <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 2xl:grid-cols-5">
                {result.parts.map((part, i) => {
                  const raw = ownedById.get(part.itemInstanceId);
                  const safeIcon = raw?.itemHash === part.itemHash ? raw : null;
                  return <div key={part.itemInstanceId} className="min-w-0 border border-white/10 bg-white/[0.02] p-2">
                    <div className="flex items-center gap-2">
                      <ItemPicture item={safeIcon} mark={["♜", "◈", "◇", "♢", "✧"][i] ?? "◇"} />
                      <div className="min-w-0"><p className="text-[9px] text-white/45">{SLOT_LABELS[part.slotHash] ?? part.slotName}</p>
                        <p className="truncate text-[11px] font-semibold" title={part.name}>{part.name}</p>
                        <p className="text-[9px] text-white/50">{part.exotic ? "Esotico · " : ""}{part.changesCurrentSelection ? "Sostituzione" : "Invariato"}</p>
                      </div>
                    </div>
                  </div>;
                })}
              </div>
              <p className="text-[10px] text-white/40">{result.compatibility.status === "incompatible" ? "Incompatibile" : "Ipotesi verificata per proprietà note"} · Nessun equipaggiamento o preview salvata · Statistiche osservate sui pezzi, non valori finali.</p>
            </article>)}
            <details className="border border-white/10 p-3 text-[10px] text-white/55">
              <summary className="cursor-pointer font-semibold">Limiti e avvisi del motore ({report.warnings.length})</summary>
              <div className="mt-2 space-y-1">{report.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>
            </details>
          </div>}
          <div className="border-t border-white/10 px-4 py-3 text-[10px] text-white/35 sm:px-5">
            UI-Armor-A1 / B0.6a3 · Min/Max nel nuovo motore · mod fisse · risultati read-only
            <Link href={`/guardian/${characterId}/assistant#armor-optimizer`} className="ml-2 text-cyan-100/75 hover:text-cyan-100">Apri Legacy per la Builder Preview →</Link>
          </div>
        </section>
      </div>
    </main>
  </AppShell>;
}
