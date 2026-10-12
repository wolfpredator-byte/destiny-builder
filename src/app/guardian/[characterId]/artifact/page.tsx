"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AppShell from "@/components/destiny-builder/AppShell";

type Character = {
  characterId: string;
  className: string;
  light: number;
  emblemPath: string;
  emblemBackgroundPath: string;
};

type ItemLocation = {
  type?: "equipped" | "characterInventory" | "vault" | "otherGuardian" | "missing" | string;
  className?: string | null;
  placement?: "equipped" | "inventory" | "vault" | null | string;
};

type DestinyItem = {
  itemHash: number;
  itemInstanceId: string | null;
  name: string;
  description?: string;
  icon: string | null;
  itemTypeDisplayName: string | null;
  itemType: number | null;
  power: number | null;
  isEquipped?: boolean;
  location?: ItemLocation | null;
};

type CombatEffectTag = {
  key: string;
  label: string;
  kind: "buff" | "debuff" | "effect";
};

type DetailPerkState = "selected" | "rolled" | "possible";

type DetailPerk = {
  socketIndex: number;
  plugHash: number;
  name: string;
  description: string;
  icon: string | null;
  plugCategoryIdentifier: string | null;
  type: string;
  state: DetailPerkState;
  effectTags: CombatEffectTag[];
};

type ItemDetail = {
  itemHash: number;
  itemInstanceId: string;
  name: string;
  description: string;
  icon: string | null;
  selectedPerks: DetailPerk[];
  perkColumns: Array<{
    socketIndex: number;
    selected: DetailPerk | null;
    rolled: DetailPerk[];
    possible: DetailPerk[];
    all: DetailPerk[];
  }>;
};

type ArtifactProgressionPerk = {
  itemHash: number;
  name: string;
  description: string;
  icon: string | null;
  isActive: boolean;
  isUnlocked: boolean;
};

type ArtifactProgression = {
  artifactHash?: number | null;
  name?: string | null;
  description?: string | null;
  icon?: string | null;
  pointsUsed?: number | null;
  resetCount?: number | null;
  tiers?: Array<{
    tierHash?: number | null;
    title?: string | null;
    minimumUnlockPointsUsedRequirement?: number | null;
    isUnlocked?: boolean;
    items?: ArtifactProgressionPerk[];
  }>;
};

type BuilderDraft = {
  previewArtifactIdentity?: string | null;
  previewArtifactPlugs?: Record<string, number>;
  [key: string]: unknown;
};

type InspectedArtifactPerk = {
  name: string;
  description: string;
  icon: string | null;
  effectTags: CombatEffectTag[];
  contextLabel: string;
};

function getItemIdentity(item: DestinyItem) {
  return item.itemInstanceId ?? String(item.itemHash);
}

function isArtifactItem(item: DestinyItem) {
  return (
    item.itemType === 28 ||
    item.itemTypeDisplayName?.toLowerCase().includes("artifact") === true
  );
}

function getItemLocationLabel(item: DestinyItem) {
  if (item.isEquipped || item.location?.type === "equipped") {
    return "Equipped in Destiny";
  }

  switch (item.location?.type) {
    case "characterInventory":
      return "Guardian inventory";
    case "vault":
      return "Vault";
    case "otherGuardian":
      return `${item.location.className ?? "Other Guardian"} · ${
        item.location.placement === "equipped" ? "Equipped" : "Inventory"
      }`;
    case "missing":
      return "Not owned";
    default:
      return "Guardian inventory";
  }
}

function isMeaningfulArtifactPerk(perk: DetailPerk | null | undefined) {
  if (!perk) return false;

  const name = perk.name.trim().toLowerCase();
  const identifier = perk.plugCategoryIdentifier?.trim().toLowerCase() ?? "";

  return !(
    !name ||
    name === "unknown plug" ||
    name === "empty" ||
    name.startsWith("empty ") ||
    identifier.includes("empty_socket") ||
    identifier.includes("empty.socket") ||
    identifier.endsWith(".empty") ||
    identifier.includes(".empty.")
  );
}

function effectClasses(kind: CombatEffectTag["kind"]) {
  if (kind === "buff") {
    return "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200";
  }
  if (kind === "debuff") {
    return "border-rose-400/25 bg-rose-400/[0.07] text-rose-200";
  }
  return "border-sky-400/25 bg-sky-400/[0.07] text-sky-200";
}

function getColumnLabel(
  column: ItemDetail["perkColumns"][number],
  visibleIndex: number
) {
  const identifier = column.all
    .map((perk) => perk.plugCategoryIdentifier ?? "")
    .join(" ")
    .toLowerCase();

  if (identifier.includes("column")) {
    return `Column ${visibleIndex + 1}`;
  }

  return `Artifact column ${visibleIndex + 1}`;
}

export default function ArtifactEditorPage() {
  const params = useParams();
  const characterId = String(params.characterId ?? "");

  const [characters, setCharacters] = useState<Character[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);
  const [inventory, setInventory] = useState<DestinyItem[]>([]);
  const [equipment, setEquipment] = useState<DestinyItem[]>([]);
  const [artifactProgression, setArtifactProgression] =
    useState<ArtifactProgression | null>(null);

  const [previewArtifactIdentity, setPreviewArtifactIdentity] =
    useState<string | null>(null);
  const [previewArtifactPlugs, setPreviewArtifactPlugs] =
    useState<Record<string, number>>({});

  const [itemDetails, setItemDetails] = useState<Record<string, ItemDetail>>({});
  const detailCacheRef = useRef<Record<string, ItemDetail>>({});
  const [detailLoadingIds, setDetailLoadingIds] =
    useState<Record<string, boolean>>({});

  const [inspectedPerk, setInspectedPerk] =
    useState<InspectedArtifactPerk | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const draftRestoredRef = useRef(false);

  async function fetchJson(url: string) {
    let response = await fetch(url, { cache: "no-store" });
    let data = await response.json().catch(() => null);

    if (response.status === 401) {
      const refresh = await fetch("/api/auth/refresh", { method: "POST" });
      if (refresh.ok) {
        response = await fetch(url, { cache: "no-store" });
        data = await response.json().catch(() => null);
      }
    }

    return { response, data };
  }

  async function ensureItemDetail(item: DestinyItem, force = false) {
    if (!item.itemInstanceId) return null;

    const key = item.itemInstanceId;
    const cached = detailCacheRef.current[key];
    if (!force && cached) return cached;
    if (detailLoadingIds[key]) return cached ?? null;

    setDetailLoadingIds((current) => ({ ...current, [key]: true }));

    try {
      const { response, data } = await fetchJson(
        `/api/destiny/characters/${characterId}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(
          item.itemInstanceId
        )}&itemHash=${item.itemHash}`
      );

      if (!response.ok || !data?.success || !data?.item) {
        throw new Error(data?.error || "Failed to load Artifact details");
      }

      const detail = data.item as ItemDetail;
      detailCacheRef.current[key] = detail;
      setItemDetails((current) => ({ ...current, [key]: detail }));
      return detail;
    } catch {
      return null;
    } finally {
      setDetailLoadingIds((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function loadPage(showSyncState = false) {
    try {
      if (showSyncState) setSyncing(true);
      else setLoading(true);
      setError("");

      const [charactersResult, coreResult] = await Promise.all([
        fetchJson("/api/destiny/characters"),
        fetchJson(`/api/destiny/characters/${characterId}/inventory?scope=core`),
      ]);

      if (!charactersResult.response.ok || !charactersResult.data?.success) {
        throw new Error(charactersResult.data?.error || "Failed to load Guardians");
      }

      if (!coreResult.response.ok || !coreResult.data?.success) {
        throw new Error(coreResult.data?.error || "Failed to load Artifact data");
      }

      const nextCharacters: Character[] = Array.isArray(
        charactersResult.data.characters
      )
        ? charactersResult.data.characters
        : [];
      const nextCharacter =
        nextCharacters.find((candidate) => candidate.characterId === characterId) ??
        null;

      if (!nextCharacter) throw new Error("Guardian not found");

      setCharacters(nextCharacters);
      setCharacter(nextCharacter);
      setInventory(
        Array.isArray(coreResult.data.inventory) ? coreResult.data.inventory : []
      );
      setEquipment(
        Array.isArray(coreResult.data.equipment) ? coreResult.data.equipment : []
      );
      setArtifactProgression(
        coreResult.data.artifact ?? coreResult.data.seasonalArtifact ?? null
      );

      if (!draftRestoredRef.current) {
        try {
          const raw = window.localStorage.getItem(
            `destiny-builder-draft:${characterId}`
          );
          if (raw) {
            const draft = JSON.parse(raw) as BuilderDraft;
            if (
              typeof draft.previewArtifactIdentity === "string" ||
              draft.previewArtifactIdentity === null
            ) {
              setPreviewArtifactIdentity(draft.previewArtifactIdentity ?? null);
            }
            if (
              draft.previewArtifactPlugs &&
              typeof draft.previewArtifactPlugs === "object"
            ) {
              setPreviewArtifactPlugs(draft.previewArtifactPlugs);
            }
          }
        } catch {
          // A malformed local draft should never block the editor.
        }
        draftRestoredRef.current = true;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Artifact editor");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    draftRestoredRef.current = false;
    void loadPage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  useEffect(() => {
    if (loading || !character || !draftRestoredRef.current) return;

    try {
      const key = `destiny-builder-draft:${characterId}`;
      const existingRaw = window.localStorage.getItem(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      window.localStorage.setItem(
        key,
        JSON.stringify({
          ...existing,
          previewArtifactIdentity,
          previewArtifactPlugs,
        })
      );
    } catch {
      // Local preview persistence is best-effort.
    }
  }, [
    character,
    characterId,
    loading,
    previewArtifactIdentity,
    previewArtifactPlugs,
  ]);

  useEffect(() => {
    if (loading) return;

    const sync = () => {
      if (document.visibilityState === "visible") void loadPage(true);
    };

    const interval = window.setInterval(sync, 30_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, characterId]);

  const equippedArtifact = useMemo(
    () => equipment.find((item) => isArtifactItem(item)) ?? null,
    [equipment]
  );

  const artifactCandidates = useMemo(
    () =>
      [
        ...(equippedArtifact ? [equippedArtifact] : []),
        ...inventory.filter((item) => isArtifactItem(item)),
      ].filter(
        (item, index, items) =>
          items.findIndex(
            (candidate) => getItemIdentity(candidate) === getItemIdentity(item)
          ) === index
      ),
    [equippedArtifact, inventory]
  );

  const selectedArtifactItem =
    artifactCandidates.find(
      (item) => getItemIdentity(item) === previewArtifactIdentity
    ) ??
    equippedArtifact ??
    artifactCandidates[0] ??
    null;

  useEffect(() => {
    if (!previewArtifactIdentity || artifactCandidates.length === 0) return;
    const stillExists = artifactCandidates.some(
      (item) => getItemIdentity(item) === previewArtifactIdentity
    );
    if (!stillExists) {
      setPreviewArtifactIdentity(null);
      setPreviewArtifactPlugs({});
    }
  }, [artifactCandidates, previewArtifactIdentity]);

  useEffect(() => {
    setInspectedPerk(null);
    if (selectedArtifactItem) {
      void ensureItemDetail(selectedArtifactItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArtifactItem?.itemInstanceId, selectedArtifactItem?.itemHash]);

  const selectedArtifactDetail =
    selectedArtifactItem?.itemInstanceId
      ? itemDetails[selectedArtifactItem.itemInstanceId] ?? null
      : null;

  const perkColumns = useMemo(
    () =>
      (selectedArtifactDetail?.perkColumns ?? [])
        .map((column) => ({
          ...column,
          selected:
            column.selected && isMeaningfulArtifactPerk(column.selected)
              ? column.selected
              : null,
          rolled: column.rolled.filter(isMeaningfulArtifactPerk),
          possible: column.possible.filter(isMeaningfulArtifactPerk),
          all: column.all.filter(isMeaningfulArtifactPerk),
        }))
        .filter((column) => column.all.length > 0),
    [selectedArtifactDetail]
  );

  const effectivePerks = useMemo(
    () =>
      perkColumns
        .map((column) => {
          const effectiveHash =
            previewArtifactPlugs[String(column.socketIndex)] ??
            column.selected?.plugHash ??
            null;
          if (typeof effectiveHash !== "number") return null;
          return (
            column.all.find((perk) => perk.plugHash === effectiveHash) ??
            column.selected ??
            null
          );
        })
        .filter(Boolean) as DetailPerk[],
    [perkColumns, previewArtifactPlugs]
  );

  const activeEffects = useMemo(() => {
    const effects = new Map<string, CombatEffectTag>();
    for (const perk of effectivePerks) {
      for (const effect of perk.effectTags ?? []) {
        effects.set(effect.key, effect);
      }
    }
    return Array.from(effects.values());
  }, [effectivePerks]);

  const hasArtifactPreview = Boolean(
    previewArtifactIdentity &&
      equippedArtifact &&
      previewArtifactIdentity !== getItemIdentity(equippedArtifact)
  );
  const previewPerkCount = Object.keys(previewArtifactPlugs).length;
  const hasPreviewChanges = hasArtifactPreview || previewPerkCount > 0;

  const progressionActivePerks = useMemo(
    () =>
      (artifactProgression?.tiers ?? [])
        .flatMap((tier) => tier.items ?? [])
        .filter((perk) => perk.isActive),
    [artifactProgression]
  );

  function chooseArtifact(item: DestinyItem) {
    const equippedIdentity = equippedArtifact
      ? getItemIdentity(equippedArtifact)
      : null;
    const nextIdentity = getItemIdentity(item);

    setPreviewArtifactIdentity(
      equippedIdentity && nextIdentity === equippedIdentity ? null : nextIdentity
    );
    setPreviewArtifactPlugs({});
    setInspectedPerk(null);
    void ensureItemDetail(item);
  }

  function choosePerk(
    column: ItemDetail["perkColumns"][number],
    perk: DetailPerk,
    blockedPlugHashes: Set<number>
  ) {
    setInspectedPerk({
      name: perk.name,
      description: perk.description,
      icon: perk.icon,
      effectTags: perk.effectTags ?? [],
      contextLabel: `Socket ${perk.socketIndex}`,
    });
    if (blockedPlugHashes.has(perk.plugHash)) return;

    const destinyHash = column.selected?.plugHash ?? null;
    setPreviewArtifactPlugs((current) => {
      const next = { ...current };
      if (destinyHash === perk.plugHash) {
        delete next[String(column.socketIndex)];
      } else {
        next[String(column.socketIndex)] = perk.plugHash;
      }
      return next;
    });
  }

  function resetSocket(column: ItemDetail["perkColumns"][number]) {
    setPreviewArtifactPlugs((current) => {
      const next = { ...current };
      delete next[String(column.socketIndex)];
      return next;
    });
  }

  function resetArtifactToDestiny() {
    setPreviewArtifactIdentity(null);
    setPreviewArtifactPlugs({});
    setInspectedPerk(null);
    if (equippedArtifact) void ensureItemDetail(equippedArtifact);
  }

  async function handleManualSync() {
    await loadPage(true);
    if (selectedArtifactItem) {
      await ensureItemDetail(selectedArtifactItem, true);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090d] text-white">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-cyan-200" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            Loading Artifact editor
          </p>
        </div>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090d] px-6 text-center text-white">
        <div>
          <h1 className="text-2xl font-bold">Artifact editor unavailable</h1>
          <p className="mt-2 text-sm text-white/45">
            {error || "Artifact data could not be loaded."}
          </p>
          <Link
            href={`/guardian/${characterId}`}
            className="mt-5 inline-block border border-white/15 px-4 py-2 text-sm text-white/70 hover:text-white"
          >
            Back to Build
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      activeSection="builder"
      guardianContextSection="artifact"
      currentBuildHref={`/guardian/${characterId}`}
      loadoutsHref={`/guardian/${characterId}/loadouts`}
      subclassHref={`/guardian/${characterId}/subclass`}
      artifactHref={`/guardian/${characterId}/artifact`}
      guardianId={characterId}
      guardianClassName={character.className}
      guardianSubclassName={
        selectedArtifactItem?.name ?? artifactProgression?.name ?? "Artifact"
      }
      guardianEmblemPath={character.emblemPath}
      guardianOptions={characters.map((guardian) => ({
        characterId: guardian.characterId,
        className: guardian.className,
        light: guardian.light,
        emblemPath: guardian.emblemPath,
        href: `/guardian/${guardian.characterId}/artifact`,
      }))}
      power={character.light}
      autoSync
      bungieSynced={!error}
      syncing={syncing}
      onSync={() => void handleManualSync()}
    >
      <main className="min-h-screen px-4 py-5 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-[1540px]">
          <section className="relative overflow-hidden border border-white/10 bg-[#0a0d12]">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-20"
              style={{
                backgroundImage: `url(https://www.bungie.net${character.emblemBackgroundPath})`,
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,rgba(103,232,249,0.10),transparent_28%),linear-gradient(90deg,rgba(5,7,11,0.98)_0%,rgba(8,9,15,0.86)_58%,rgba(5,7,11,0.96)_100%)]" />

            <div className="relative flex flex-col gap-6 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-7">
              <div className="flex items-center gap-5">
                <div className="flex h-20 w-20 items-center justify-center border border-cyan-200/20 bg-cyan-200/[0.04]">
                  {selectedArtifactItem?.icon ?? artifactProgression?.icon ? (
                    <img
                      src={`https://www.bungie.net${
                        selectedArtifactItem?.icon ?? artifactProgression?.icon
                      }`}
                      alt=""
                      className="h-14 w-14 object-contain"
                    />
                  ) : (
                    <span className="text-3xl text-cyan-100/60">◇</span>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35">
                    Artifact editor
                  </p>
                  <h1 className="mt-1 text-3xl font-black uppercase tracking-[0.05em] sm:text-4xl">
                    {selectedArtifactItem?.name ??
                      artifactProgression?.name ??
                      "Seasonal Artifact"}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em]">
                    <span className="text-cyan-200">
                      {selectedArtifactItem
                        ? getItemLocationLabel(selectedArtifactItem)
                        : "Bungie progression"}
                    </span>
                    <span className="text-white/20">·</span>
                    <span className="text-white/40">
                      {hasPreviewChanges
                        ? `${previewPerkCount + (hasArtifactPreview ? 1 : 0)} preview change${
                            previewPerkCount + (hasArtifactPreview ? 1 : 0) === 1
                              ? ""
                              : "s"
                          }`
                        : "Matches Destiny"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {hasPreviewChanges && (
                  <button
                    type="button"
                    onClick={resetArtifactToDestiny}
                    className="border border-white/10 bg-black/25 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/55 hover:border-white/20 hover:text-white"
                  >
                    Reset Artifact
                  </button>
                )}
                <Link
                  href={`/guardian/${characterId}`}
                  className="border border-cyan-200/30 bg-cyan-200/[0.07] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100 hover:bg-cyan-200/[0.12]"
                >
                  Back to Build →
                </Link>
              </div>
            </div>
          </section>

          {error && (
            <div className="mt-4 border border-amber-300/20 bg-amber-300/[0.04] px-4 py-3 text-xs text-amber-100/70">
              Last sync warning: {error}
            </div>
          )}

          <div className="mt-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
            <aside className="space-y-4">
              <section className="border border-white/10 bg-[#080b11] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                    Artifact
                  </h2>
                  <span className="text-[9px] uppercase tracking-[0.12em] text-white/25">
                    {artifactCandidates.length} available
                  </span>
                </div>

                {artifactCandidates.length > 0 ? (
                  <div className="space-y-2">
                    {artifactCandidates.map((item) => {
                      const selected =
                        selectedArtifactItem &&
                        getItemIdentity(item) ===
                          getItemIdentity(selectedArtifactItem);
                      const equipped =
                        equippedArtifact &&
                        getItemIdentity(item) === getItemIdentity(equippedArtifact);

                      return (
                        <button
                          key={getItemIdentity(item)}
                          type="button"
                          onClick={() => chooseArtifact(item)}
                          className={`flex w-full items-center gap-3 border p-3 text-left transition ${
                            selected
                              ? "border-cyan-200/35 bg-cyan-200/[0.06]"
                              : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.035]"
                          }`}
                        >
                          {item.icon ? (
                            <img
                              src={`https://www.bungie.net${item.icon}`}
                              alt=""
                              className="h-11 w-11 shrink-0 object-contain"
                            />
                          ) : (
                            <div className="h-11 w-11 shrink-0 border border-white/10 bg-white/[0.03]" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {item.name}
                            </span>
                            <span className="mt-1 block text-[10px] uppercase tracking-[0.1em] text-white/35">
                              {equipped ? "Destiny equipped" : getItemLocationLabel(item)}
                            </span>
                          </span>
                          {selected && (
                            <span className="text-xs text-cyan-200">●</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="border border-dashed border-white/10 p-3 text-xs leading-5 text-white/35">
                    No Artifact item is currently available in this Guardian&apos;s
                    inventory. Progression data can still be shown below when Bungie
                    provides it.
                  </p>
                )}
              </section>

              <section className="border border-white/10 bg-[#080b11] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                    Progression
                  </h2>
                  <span className="text-[9px] uppercase tracking-[0.12em] text-white/25">
                    Bungie
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2">
                    <span className="text-white/35">Points used</span>
                    <span className="font-semibold text-white/75">
                      {artifactProgression?.pointsUsed ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-2">
                    <span className="text-white/35">Resets</span>
                    <span className="font-semibold text-white/75">
                      {artifactProgression?.resetCount ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/35">Active perks</span>
                    <span className="font-semibold text-white/75">
                      {effectivePerks.length || progressionActivePerks.length}
                    </span>
                  </div>
                </div>
              </section>
            </aside>

            <section className="min-w-0 border border-white/10 bg-[#080b11] p-4 lg:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                    Perk configuration
                  </p>
                  <h2 className="mt-1 text-xl font-bold">Artifact columns</h2>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-white/40">
                    Cyan marks the perk currently selected in Destiny. A white outline
                    marks your local Builder preview. Changes here are never written to
                    Destiny.
                  </p>
                </div>
                {selectedArtifactItem?.itemInstanceId &&
                  detailLoadingIds[selectedArtifactItem.itemInstanceId] && (
                    <span className="flex items-center gap-2 text-xs text-white/35">
                      <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white" />
                      Reading Artifact sockets...
                    </span>
                  )}
              </div>

              {perkColumns.length > 0 ? (
                <div className="mt-5 space-y-5">
                  {perkColumns.map((column, columnIndex) => {
                    const effectiveHash =
                      previewArtifactPlugs[String(column.socketIndex)] ??
                      column.selected?.plugHash ??
                      null;

                    const blockedPlugHashes = new Set<number>(
                      perkColumns
                        .filter(
                          (otherColumn) =>
                            otherColumn.socketIndex !== column.socketIndex
                        )
                        .map(
                          (otherColumn) =>
                            previewArtifactPlugs[
                              String(otherColumn.socketIndex)
                            ] ??
                            otherColumn.selected?.plugHash ??
                            null
                        )
                        .filter(
                          (plugHash): plugHash is number =>
                            typeof plugHash === "number"
                        )
                    );

                    return (
                      <div
                        key={column.socketIndex}
                        className="border border-white/10 bg-black/20 p-4"
                      >
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                              {getColumnLabel(column, columnIndex)}
                            </p>
                            <p className="mt-1 text-xs text-white/30">
                              Socket {column.socketIndex} · {column.all.length} option
                              {column.all.length === 1 ? "" : "s"}
                            </p>
                          </div>
                          {previewArtifactPlugs[String(column.socketIndex)] !==
                            undefined && (
                            <button
                              type="button"
                              onClick={() => resetSocket(column)}
                              className="border border-white/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white/40 hover:border-white/20 hover:text-white"
                            >
                              Reset column
                            </button>
                          )}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                          {column.all.map((perk) => {
                            const destinySelected =
                              column.selected?.plugHash === perk.plugHash;
                            const previewSelected = effectiveHash === perk.plugHash;
                            const changed =
                              previewArtifactPlugs[
                                String(column.socketIndex)
                              ] === perk.plugHash;
                            const blocked =
                              blockedPlugHashes.has(perk.plugHash) &&
                              !previewSelected;

                            return (
                              <button
                                key={`${column.socketIndex}-${perk.plugHash}`}
                                type="button"
                                onClick={() =>
                                  choosePerk(column, perk, blockedPlugHashes)
                                }
                                title={
                                  blocked
                                    ? "Already selected in another Artifact column"
                                    : perk.description || perk.name
                                }
                                className={`group relative flex min-h-[76px] items-center gap-3 border p-3 text-left transition ${
                                  previewSelected
                                    ? "border-white/45 bg-white/[0.075]"
                                    : destinySelected
                                    ? "border-cyan-300/35 bg-cyan-300/[0.05]"
                                    : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                                } ${blocked ? "opacity-30" : ""}`}
                              >
                                {perk.icon ? (
                                  <img
                                    src={`https://www.bungie.net${perk.icon}`}
                                    alt=""
                                    className="h-11 w-11 shrink-0 object-cover"
                                  />
                                ) : (
                                  <div className="h-11 w-11 shrink-0 border border-white/10 bg-white/[0.03]" />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-semibold text-white/80">
                                    {perk.name}
                                  </span>
                                  <span className="mt-1 block text-[9px] uppercase tracking-[0.1em] text-white/30">
                                    {blocked
                                      ? "Used in another column"
                                      : changed
                                      ? "Builder preview"
                                      : destinySelected
                                      ? "Selected in Destiny"
                                      : "Available"}
                                  </span>
                                </span>
                                {changed && (
                                  <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-white" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (artifactProgression?.tiers ?? []).length > 0 ? (
                <div className="mt-5 space-y-4">
                  <p className="text-xs leading-5 text-white/40">
                    The Artifact instance has not exposed editable socket columns yet,
                    so this is the Bungie progression view.
                  </p>
                  {(artifactProgression?.tiers ?? []).map((tier, tierIndex) => (
                    <div
                      key={`${tier.tierHash ?? tierIndex}`}
                      className="border border-white/10 bg-black/20 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-white/55">
                          {tier.title ?? `Tier ${tierIndex + 1}`}
                        </h3>
                        <span className="text-[10px] text-white/30">
                          {tier.isUnlocked
                            ? "Unlocked"
                            : `Requires ${
                                tier.minimumUnlockPointsUsedRequirement ?? 0
                              } points`}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {(tier.items ?? []).map((perk) => (
                          <button
                            type="button"
                            key={perk.itemHash}
                            onClick={() =>
                              setInspectedPerk({
                                name: perk.name,
                                description: perk.description,
                                icon: perk.icon,
                                effectTags: [],
                                contextLabel: `${tier.title ?? `Tier ${tierIndex + 1}`} · ${
                                  perk.isActive
                                    ? "Active in Destiny"
                                    : perk.isUnlocked
                                    ? "Unlocked"
                                    : "Locked"
                                }`,
                              })
                            }
                            title={perk.description || perk.name}
                            className={`flex items-center gap-3 border p-3 text-left ${
                              perk.isActive
                                ? "border-cyan-300/35 bg-cyan-300/[0.05]"
                                : perk.isUnlocked
                                ? "border-white/15 bg-white/[0.03]"
                                : "border-white/10 bg-white/[0.015] opacity-45"
                            }`}
                          >
                            {perk.icon ? (
                              <img
                                src={`https://www.bungie.net${perk.icon}`}
                                alt=""
                                className="h-10 w-10 shrink-0 object-cover"
                              />
                            ) : (
                              <div className="h-10 w-10 shrink-0 border border-white/10" />
                            )}
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-semibold">
                                {perk.name}
                              </span>
                              <span className="mt-1 block text-[9px] uppercase tracking-[0.1em] text-white/30">
                                {perk.isActive
                                  ? "Active in Destiny"
                                  : perk.isUnlocked
                                  ? "Unlocked"
                                  : "Locked"}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-5 border border-dashed border-white/10 p-5 text-sm text-white/35">
                  {selectedArtifactItem
                    ? "Bungie returned the Artifact, but no perk columns could be resolved."
                    : "No Artifact data is available for this Guardian."}
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <section className="border border-white/10 bg-[#080b11] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                  Inspector
                </p>

                {inspectedPerk ? (
                  <div className="mt-4">
                    <div className="flex gap-4">
                      {inspectedPerk.icon ? (
                        <img
                          src={`https://www.bungie.net${inspectedPerk.icon}`}
                          alt=""
                          className="h-14 w-14 shrink-0 object-cover"
                        />
                      ) : (
                        <div className="h-14 w-14 shrink-0 border border-white/10" />
                      )}
                      <div className="min-w-0">
                        <h2 className="text-base font-bold">
                          {inspectedPerk.name}
                        </h2>
                        <p className="mt-1 text-[9px] uppercase tracking-[0.12em] text-white/30">
                          {inspectedPerk.contextLabel}
                        </p>
                      </div>
                    </div>

                    <p className="mt-4 text-sm leading-6 text-white/55">
                      {inspectedPerk.description ||
                        "No Bungie description is available for this perk."}
                    </p>

                    {(inspectedPerk.effectTags ?? []).length > 0 && (
                      <div className="mt-4 border-t border-white/10 pt-4">
                        <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/30">
                          Combat effects
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {inspectedPerk.effectTags.map((effect) => (
                            <span
                              key={effect.key}
                              className={`border px-2 py-1 text-[10px] font-semibold ${effectClasses(
                                effect.kind
                              )}`}
                            >
                              {effect.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 text-sm leading-6 text-white/40">
                    Select an Artifact perk to inspect its Bungie description and
                    detected Combat Effects.
                  </div>
                )}
              </section>

              <section className="border border-white/10 bg-[#080b11] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                    Active combat effects
                  </p>
                  <span className="text-[9px] uppercase tracking-[0.12em] text-white/25">
                    Current preview
                  </span>
                </div>

                {activeEffects.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {activeEffects.map((effect) => (
                      <span
                        key={effect.key}
                        className={`border px-2 py-1 text-[10px] font-semibold ${effectClasses(
                          effect.kind
                        )}`}
                      >
                        {effect.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-white/35">
                    No build-relevant Combat Effects were detected from the current
                    Artifact perk preview.
                  </p>
                )}
              </section>

              <section className="border border-cyan-200/15 bg-cyan-200/[0.025] p-4">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-100/55">
                  Preview only
                </p>
                <p className="mt-2 text-xs leading-5 text-white/40">
                  Artifact changes are saved only in the local Destiny Builder draft.
                  This editor does not equip perks or write anything to Bungie.
                </p>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
