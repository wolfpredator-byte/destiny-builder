"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/destiny-builder/AppShell";

type Character = {
  characterId: string;
  className: string;
  light: number;
  emblemPath: string;
  emblemBackgroundPath: string;
};

type ItemLocation = {
  type?: string;
  className?: string | null;
  placement?: string | null;
};

type DestinyItem = {
  itemHash: number;
  itemInstanceId: string | null;
  name: string;
  icon: string | null;
  category: string;
  itemTypeDisplayName: string | null;
  power: number | null;
  tierTypeName: string | null;
  equipmentSlotHash: number | null;
  bucketHash: number | null;
  location?: ItemLocation | null;
};

type BuilderLoadout = {
  id: string;
  name: string;
  createdAt?: string | null;
  favorite?: boolean;
  className?: string | null;
  subclassHash?: number | null;
  subclassName?: string | null;
  subclassPlugs?: Array<{ socketIndex: number; plugHash: number | null }>;
  gear?: Array<{
    slotHash: number;
    itemHash: number;
    itemInstanceId: string | null;
    name: string;
  }>;
  artifact?: {
    itemHash?: number | null;
    itemInstanceId?: string | null;
    artifactHash?: number | null;
    name?: string | null;
    socketOverrides?: Array<{ socketIndex: number; plugHash: number }>;
  } | null;
};

type SelectedLoadout =
  | { kind: "builder"; loadout: BuilderLoadout }
  | { kind: "ingame"; loadout: any };

const SLOT_NAMES: Record<number, string> = {
  1498876634: "Weapon Slot 1",
  2465295065: "Weapon Slot 2",
  953998645: "Power Weapon",
  3448274439: "Helmet",
  3551918588: "Gauntlets",
  14239492: "Chest Armor",
  20886954: "Leg Armor",
  1585787867: "Class Item",
};

export default function GuardianLoadoutsPage() {
  const params = useParams();
  const router = useRouter();
  const characterId = String(params.characterId ?? "");

  const [characters, setCharacters] = useState<Character[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);
  const [equipment, setEquipment] = useState<DestinyItem[]>([]);
  const [inventory, setInventory] = useState<DestinyItem[]>([]);
  const [vaultItems, setVaultItems] = useState<DestinyItem[]>([]);
  const [otherGuardianItems, setOtherGuardianItems] = useState<DestinyItem[]>([]);
  const [inGameLoadouts, setInGameLoadouts] = useState<any[]>([]);
  const [builderLoadouts, setBuilderLoadouts] = useState<BuilderLoadout[]>([]);
  const [selected, setSelected] = useState<SelectedLoadout | null>(null);
  const [tab, setTab] = useState<"builder" | "ingame">("builder");
  const [showAllBuilder, setShowAllBuilder] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [accountGearLoading, setAccountGearLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadBuilderSaves();
    void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  function loadBuilderSaves() {
    try {
      const raw = window.localStorage.getItem("destiny-builder-loadouts");
      const parsed = raw ? JSON.parse(raw) : [];
      setBuilderLoadouts(Array.isArray(parsed) ? parsed : []);
    } catch {
      setBuilderLoadouts([]);
    }
  }

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
        throw new Error(coreResult.data?.error || "Failed to load loadouts");
      }

      const nextCharacters: Character[] = charactersResult.data.characters ?? [];
      const nextCharacter = nextCharacters.find((candidate) => candidate.characterId === characterId) ?? null;
      if (!nextCharacter) throw new Error("Guardian not found");

      setCharacters(nextCharacters);
      setCharacter(nextCharacter);
      setEquipment(Array.isArray(coreResult.data.equipment) ? coreResult.data.equipment : []);
      setInventory(Array.isArray(coreResult.data.inventory) ? coreResult.data.inventory : []);
      setInGameLoadouts(Array.isArray(coreResult.data.inGameLoadouts) ? coreResult.data.inGameLoadouts : []);

      // Core data makes the page usable immediately. Account gear resolves
      // Vault / cross-Guardian loadout items in the background, matching the
      // progressive-loading strategy used by the Builder.
      if (!showSyncState) setLoading(false);
      void loadAccountGear();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load loadouts");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  async function loadAccountGear() {
    try {
      setAccountGearLoading(true);
      const accountResult = await fetchJson(
        `/api/destiny/characters/${characterId}/inventory?scope=account`
      );
      if (accountResult.response.ok && accountResult.data?.success) {
        setVaultItems(Array.isArray(accountResult.data.vault) ? accountResult.data.vault : []);
        setOtherGuardianItems(
          Array.isArray(accountResult.data.otherGuardianItems)
            ? accountResult.data.otherGuardianItems
            : []
        );
      }
    } finally {
      setAccountGearLoading(false);
    }
  }

  const allKnownGear = useMemo(
    () => [...equipment, ...inventory, ...vaultItems, ...otherGuardianItems],
    [equipment, inventory, vaultItems, otherGuardianItems]
  );

  const itemByInstance = useMemo(() => {
    const map = new Map<string, DestinyItem>();
    for (const item of allKnownGear) {
      if (item.itemInstanceId) map.set(String(item.itemInstanceId), item);
    }
    return map;
  }, [allKnownGear]);

  const itemByHash = useMemo(() => {
    const map = new Map<number, DestinyItem>();
    for (const item of allKnownGear) {
      if (!map.has(item.itemHash)) map.set(item.itemHash, item);
    }
    return map;
  }, [allKnownGear]);

  const visibleBuilderLoadouts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return builderLoadouts
      .filter((loadout) =>
        showAllBuilder || !character?.className || !loadout.className
          ? true
          : loadout.className === character.className
      )
      .filter((loadout) => !favoritesOnly || loadout.favorite === true)
      .filter((loadout) => {
        if (!normalized) return true;
        return [loadout.name, loadout.className, loadout.subclassName, loadout.artifact?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => {
        if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return bTime - aTime;
      });
  }, [builderLoadouts, character?.className, favoritesOnly, query, showAllBuilder]);

  const visibleInGameLoadouts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return inGameLoadouts.filter((loadout, index) => {
      if (!normalized) return true;
      return String(loadout?.name ?? `Loadout ${index + 1}`)
        .toLowerCase()
        .includes(normalized);
    });
  }, [inGameLoadouts, query]);

  useEffect(() => {
    if (selected) return;
    if (tab === "builder" && visibleBuilderLoadouts[0]) {
      setSelected({ kind: "builder", loadout: visibleBuilderLoadouts[0] });
    } else if (tab === "ingame" && visibleInGameLoadouts[0]) {
      setSelected({ kind: "ingame", loadout: visibleInGameLoadouts[0] });
    }
  }, [selected, tab, visibleBuilderLoadouts, visibleInGameLoadouts]);

  function resolveSavedBuilderGear(loadout: BuilderLoadout) {
    return (loadout.gear ?? []).map((saved) => ({
      saved,
      item:
        (saved.itemInstanceId ? itemByInstance.get(String(saved.itemInstanceId)) : null) ??
        itemByHash.get(saved.itemHash) ??
        null,
    }));
  }

  function resolveInGameGear(
    loadout: any
  ): Array<{ saved: any; index: number; item: DestinyItem | null }> {
    const items: any[] = Array.isArray(loadout?.items) ? loadout.items : [];
    return items.map((saved: any, index: number) => ({
      saved,
      index,
      item: itemByInstance.get(String(saved?.itemInstanceId ?? "")) ?? null,
    }));
  }

  function openBuilderLoadout(loadout: BuilderLoadout) {
    const targetCharacter =
      characters.find((candidate) => candidate.className === loadout.className) ?? character;
    if (!targetCharacter) return;

    window.localStorage.setItem(
      "destiny-builder-pending-loadout",
      JSON.stringify({ id: loadout.id, characterId: targetCharacter.characterId })
    );
    router.push(`/guardian/${targetCharacter.characterId}`);
  }

  function toggleFavorite(loadout: BuilderLoadout) {
    const next = builderLoadouts.map((candidate) =>
      candidate.id === loadout.id
        ? { ...candidate, favorite: !candidate.favorite }
        : candidate
    );
    setBuilderLoadouts(next);
    window.localStorage.setItem("destiny-builder-loadouts", JSON.stringify(next));
    if (selected?.kind === "builder" && selected.loadout.id === loadout.id) {
      const updated = next.find((candidate) => candidate.id === loadout.id);
      if (updated) setSelected({ kind: "builder", loadout: updated });
    }
  }

  function deleteBuilderLoadout(loadout: BuilderLoadout) {
    const next = builderLoadouts.filter((candidate) => candidate.id !== loadout.id);
    setBuilderLoadouts(next);
    window.localStorage.setItem("destiny-builder-loadouts", JSON.stringify(next));
    if (selected?.kind === "builder" && selected.loadout.id === loadout.id) {
      setSelected(next[0] ? { kind: "builder", loadout: next[0] } : null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090d] text-white">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-cyan-200" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-white/40">
            Loading loadouts
          </p>
        </div>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090d] px-6 text-center text-white">
        <div>
          <h1 className="text-2xl font-bold">Loadouts unavailable</h1>
          <p className="mt-2 text-sm text-white/45">{error || "Guardian could not be loaded."}</p>
        </div>
      </div>
    );
  }

  const currentListCount = tab === "builder" ? visibleBuilderLoadouts.length : visibleInGameLoadouts.length;

  return (
    <AppShell
      activeSection="loadouts"
      currentBuildHref={`/guardian/${characterId}`}
      loadoutsHref={`/guardian/${characterId}/loadouts`}
      subclassHref={`/guardian/${characterId}/subclass`}
      artifactHref={`/guardian/${characterId}#artifact-panel`}
      guardianId={characterId}
      guardianClassName={character.className}
      guardianEmblemPath={character.emblemPath}
      guardianOptions={characters.map((guardian) => ({
        characterId: guardian.characterId,
        className: guardian.className,
        light: guardian.light,
        emblemPath: guardian.emblemPath,
        href: `/guardian/${guardian.characterId}/loadouts`,
      }))}
      power={character.light}
      autoSync
      bungieSynced={!error}
      syncing={syncing}
      onSync={() => void loadPage(true)}
    >
      <main className="min-h-screen px-4 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1540px]">
          <section className="relative overflow-hidden border border-white/10 bg-[#0a0d12]">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-35"
              style={{ backgroundImage: `url(https://www.bungie.net${character.emblemBackgroundPath})` }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,8,12,0.97)_0%,rgba(6,8,12,0.76)_55%,rgba(6,8,12,0.94)_100%)]" />
            <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-end lg:justify-between lg:p-7">
              <div className="flex items-center gap-4">
                <img
                  src={`https://www.bungie.net${character.emblemPath}`}
                  alt=""
                  className="h-16 w-16 border border-white/15 object-cover"
                />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-200/55">Account loadout manager</p>
                  <h1 className="mt-1 text-3xl font-black uppercase tracking-[0.05em] sm:text-4xl">Loadouts</h1>
                  <p className="mt-2 text-sm text-white/45">
                    Viewing {character.className}. Switch Guardian without leaving this workspace; Builder loadouts can also be viewed account-wide.
                  </p>
                </div>
              </div>

              <div className="flex gap-2 text-xs">
                <div className="border border-white/10 bg-black/25 px-4 py-3">
                  <span className="block text-[9px] uppercase tracking-[0.18em] text-white/35">Builder</span>
                  <strong className="mt-1 block text-xl">{builderLoadouts.filter((l) => !l.className || l.className === character.className).length}</strong>
                </div>
                <div className="border border-white/10 bg-black/25 px-4 py-3">
                  <span className="block text-[9px] uppercase tracking-[0.18em] text-white/35">In-game</span>
                  <strong className="mt-1 block text-xl">{inGameLoadouts.length}</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-5 border border-white/10 bg-[#080b11]">
            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
              <span className="mr-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">
                {tab === "builder" ? "Class scope" : "Guardian scope"}
              </span>

              {tab === "builder" ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowAllBuilder(true);
                    setSelected(null);
                  }}
                  className={`border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.13em] transition ${
                    showAllBuilder
                      ? "border-cyan-200/30 bg-cyan-200/[0.07] text-cyan-100"
                      : "border-white/10 text-white/35 hover:text-white/70"
                  }`}
                >
                  All Classes
                </button>
              ) : (
                <span className="border border-white/10 bg-white/[0.025] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-white/28">
                  Per Guardian
                </span>
              )}

              {characters.map((guardian) => {
                const activeGuardian =
                  (tab === "ingame" || !showAllBuilder) &&
                  guardian.characterId === characterId;

                return (
                  <button
                    key={guardian.characterId}
                    type="button"
                    onClick={() => {
                      setShowAllBuilder(false);
                      setSelected(null);
                      if (guardian.characterId !== characterId) {
                        router.push(`/guardian/${guardian.characterId}/loadouts`);
                      }
                    }}
                    className={`flex items-center gap-2 border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] transition ${
                      activeGuardian
                        ? "border-white/25 bg-white/[0.07] text-white"
                        : "border-white/10 text-white/35 hover:text-white/70"
                    }`}
                  >
                    {guardian.emblemPath && (
                      <img
                        src={`https://www.bungie.net${guardian.emblemPath}`}
                        alt=""
                        className="h-5 w-5 object-cover"
                      />
                    )}
                    {guardian.className}
                    <span className="text-white/25">{guardian.light}</span>
                  </button>
                );
              })}

              <span className="ml-auto hidden text-[10px] text-white/28 lg:inline">
                {tab === "builder"
                  ? showAllBuilder
                    ? "Showing Builder saves from every class"
                    : `Showing ${character.className} Builder saves`
                  : `In-game loadouts belong to ${character.className}`}
              </span>
            </div>

            <div className="flex flex-col gap-3 border-b border-white/10 p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setTab("builder"); setSelected(null); }}
                  className={`border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${tab === "builder" ? "border-cyan-200/35 bg-cyan-200/[0.08] text-cyan-100" : "border-white/10 text-white/45 hover:text-white"}`}
                >
                  Destiny Builder ({builderLoadouts.length})
                </button>
                <button
                  type="button"
                  onClick={() => { setTab("ingame"); setShowAllBuilder(false); setSelected(null); }}
                  className={`border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${tab === "ingame" ? "border-cyan-200/35 bg-cyan-200/[0.08] text-cyan-100" : "border-white/10 text-white/45 hover:text-white"}`}
                >
                  In-game ({inGameLoadouts.length})
                </button>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2 lg:max-w-xl lg:justify-end">
                {tab === "builder" && (
                  <button
                    type="button"
                    onClick={() => setFavoritesOnly((current) => !current)}
                    className={`shrink-0 border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${favoritesOnly ? "border-amber-200/35 bg-amber-200/[0.08] text-amber-100" : "border-white/10 text-white/40 hover:text-white"}`}
                  >
                    ★ Favorites
                  </button>
                )}
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search loadouts..."
                  className="min-w-0 flex-1 border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-cyan-200/30"
                />
              </div>
            </div>

            <div className="grid min-h-[620px] lg:grid-cols-[minmax(0,1fr)_430px]">
              <div className="border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
                    {tab === "builder" ? "Saved theorycrafted builds" : "Bungie loadout slots"}
                  </p>
                  <span className="text-xs text-white/30">{currentListCount} visible</span>
                </div>

                {tab === "builder" ? (
                  visibleBuilderLoadouts.length > 0 ? (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {visibleBuilderLoadouts.map((loadout) => {
                        const resolved = resolveSavedBuilderGear(loadout);
                        const active = selected?.kind === "builder" && selected.loadout.id === loadout.id;
                        return (
                          <button
                            key={loadout.id}
                            type="button"
                            onClick={() => setSelected({ kind: "builder", loadout })}
                            className={`border p-4 text-left transition ${active ? "border-cyan-200/35 bg-cyan-200/[0.055]" : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.025]"}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-base font-bold">{loadout.name}</p>
                                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-white/40">
                                  {loadout.className ?? "Any class"} · {loadout.subclassName ?? "No subclass"}
                                </p>
                              </div>
                              <span className="flex shrink-0 items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-white/25">
                                {loadout.favorite && <span className="text-amber-200" title="Favorite loadout">★</span>}
                                {(loadout.gear ?? []).length} gear
                              </span>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-1.5">
                              {resolved.slice(0, 8).map(({ saved, item }) => (
                                item?.icon ? (
                                  <img key={`${saved.slotHash}-${saved.itemInstanceId ?? saved.itemHash}`} src={`https://www.bungie.net${item.icon}`} alt="" className="h-9 w-9 border border-white/10 object-cover" />
                                ) : (
                                  <div key={`${saved.slotHash}-${saved.itemInstanceId ?? saved.itemHash}`} className="flex h-9 w-9 items-center justify-center border border-white/10 bg-white/[0.03] text-[9px] text-white/25">?</div>
                                )
                              ))}
                            </div>
                            {loadout.artifact?.name && (
                              <p className="mt-3 truncate text-xs text-amber-200/55">Artifact · {loadout.artifact.name}</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState text="No Builder loadouts match this view. Save a build from Current Build first." />
                  )
                ) : visibleInGameLoadouts.length > 0 ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {visibleInGameLoadouts.map((loadout, index) => {
                      const entries = resolveInGameGear(loadout);
                      const active = selected?.kind === "ingame" && selected.loadout === loadout;
                      return (
                        <button
                          key={`${loadout.index ?? index}-${loadout.nameHash ?? "loadout"}`}
                          type="button"
                          onClick={() => setSelected({ kind: "ingame", loadout })}
                          className={`border p-4 text-left transition ${active ? "border-cyan-200/35 bg-cyan-200/[0.055]" : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.025]"}`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-white/5"
                              style={loadout.colorImage ? { backgroundImage: `url(https://www.bungie.net${loadout.colorImage})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                            >
                              {loadout.icon ? <img src={`https://www.bungie.net${loadout.icon}`} alt="" className="h-8 w-8 object-contain" /> : <span className="text-xs text-white/35">{index + 1}</span>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-bold">{loadout.name || `Loadout ${index + 1}`}</p>
                              <p className="mt-1 text-xs text-white/40">{entries.filter((entry) => entry.item).length}/{entries.length} items resolved</p>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {entries.slice(0, 8).map(({ item, index: entryIndex }) =>
                              item?.icon ? (
                                <img key={`${item.itemInstanceId ?? item.itemHash}-${entryIndex}`} src={`https://www.bungie.net${item.icon}`} alt="" className="h-9 w-9 border border-white/10 object-cover" />
                              ) : (
                                <div key={`missing-${entryIndex}`} className="h-9 w-9 border border-dashed border-white/10 bg-white/[0.02]" />
                              )
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState text="No in-game loadouts were returned for this Guardian." />
                )}
              </div>

              <aside className="bg-black/15 p-5">
                {selected ? (
                  selected.kind === "builder" ? (
                    <BuilderLoadoutInspector
                      loadout={selected.loadout}
                      resolvedGear={resolveSavedBuilderGear(selected.loadout)}
                      onOpen={() => openBuilderLoadout(selected.loadout)}
                      onToggleFavorite={() => toggleFavorite(selected.loadout)}
                      onDelete={() => deleteBuilderLoadout(selected.loadout)}
                    />
                  ) : (
                    <InGameInspector
                      loadout={selected.loadout}
                      entries={resolveInGameGear(selected.loadout)}
                      accountGearLoading={accountGearLoading}
                    />
                  )
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center text-center">
                    <div>
                      <p className="text-sm font-semibold">Select a loadout</p>
                      <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/35">Its equipment, subclass and Artifact summary will appear here.</p>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-white/10 p-8 text-center text-sm text-white/35">
      {text}
    </div>
  );
}

function BuilderLoadoutInspector({
  loadout,
  resolvedGear,
  onOpen,
  onToggleFavorite,
  onDelete,
}: {
  loadout: BuilderLoadout;
  resolvedGear: Array<{ saved: NonNullable<BuilderLoadout["gear"]>[number]; item: DestinyItem | null }>;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/55">Destiny Builder loadout</p>
        <h2 className="mt-2 text-2xl font-black uppercase tracking-[0.04em]">{loadout.name}</h2>
        <p className="mt-2 text-sm text-white/45">
          {loadout.className ?? "Any class"} · {loadout.subclassName ?? "No subclass saved"}
        </p>
        {loadout.createdAt && (
          <p className="mt-1 text-xs text-white/25">Saved {formatDate(loadout.createdAt)}</p>
        )}
      </div>

      <div className="mt-6">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Equipment</p>
        <div className="space-y-2">
          {resolvedGear.map(({ saved, item }) => (
            <div key={`${saved.slotHash}-${saved.itemInstanceId ?? saved.itemHash}`} className="flex items-center gap-3 border border-white/10 bg-black/20 p-2.5">
              {item?.icon ? (
                <img src={`https://www.bungie.net${item.icon}`} alt="" className="h-11 w-11 border border-white/10 object-cover" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center border border-dashed border-white/10 text-xs text-white/25">?</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item?.name ?? saved.name}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/30">{SLOT_NAMES[saved.slotHash] ?? "Equipment"}{item?.power != null ? ` · ${item.power}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 border border-white/10 bg-white/[0.025] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/55">Artifact</p>
        <p className="mt-2 text-sm font-semibold">{loadout.artifact?.name ?? "No Artifact saved"}</p>
        {loadout.artifact?.socketOverrides && (
          <p className="mt-1 text-xs text-white/35">{loadout.artifact.socketOverrides.length} perk selections saved</p>
        )}
      </div>

      <div className="mt-auto pt-6">
        <button
          type="button"
          onClick={onToggleFavorite}
          className={`mb-2 w-full border px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] transition ${loadout.favorite ? "border-amber-200/30 bg-amber-200/[0.06] text-amber-100" : "border-white/10 text-white/45 hover:border-amber-200/25 hover:text-amber-100"}`}
        >
          {loadout.favorite ? "★ Favorite loadout" : "☆ Add to favorites"}
        </button>
        <button type="button" onClick={onOpen} className="w-full bg-cyan-300 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-black hover:bg-cyan-200">
          Open in Builder
        </button>
        <button type="button" onClick={onDelete} className="mt-2 w-full border border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-white/40 hover:border-rose-300/25 hover:text-rose-200">
          Delete local loadout
        </button>
      </div>
    </div>
  );
}

function InGameInspector({
  loadout,
  entries,
  accountGearLoading,
}: {
  loadout: any;
  entries: Array<{ saved: any; index: number; item: DestinyItem | null }>;
  accountGearLoading: boolean;
}) {
  const resolvedCount = entries.filter((entry) => entry.item).length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-white/5"
          style={loadout?.colorImage ? { backgroundImage: `url(https://www.bungie.net${loadout.colorImage})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        >
          {loadout?.icon ? <img src={`https://www.bungie.net${loadout.icon}`} alt="" className="h-10 w-10 object-contain" /> : <span className="text-sm text-white/30">L</span>}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/55">In-game loadout</p>
          <h2 className="mt-2 truncate text-2xl font-black uppercase tracking-[0.04em]">{loadout?.name ?? "Destiny Loadout"}</h2>
          <p className="mt-2 text-xs text-white/35">{resolvedCount}/{entries.length} saved items resolved from the account</p>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {entries.map(({ item, saved, index }) => (
          <div key={`${String(saved?.itemInstanceId ?? "missing")}-${index}`} className="flex items-center gap-3 border border-white/10 bg-black/20 p-2.5">
            {item?.icon ? (
              <img src={`https://www.bungie.net${item.icon}`} alt="" className="h-11 w-11 border border-white/10 object-cover" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center border border-dashed border-white/10 text-xs text-white/20">?</div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white/75">{item?.name ?? "Saved item"}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/30">
                {item?.itemTypeDisplayName ?? (accountGearLoading ? "Resolving account gear" : "Unresolved")}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto border border-white/10 bg-white/[0.025] p-4 text-xs leading-relaxed text-white/40">
        Bungie loadouts are read-only in the current MVP. This page inspects their saved equipment without changing anything in Destiny.
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
