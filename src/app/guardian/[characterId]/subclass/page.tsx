"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/destiny-builder/AppShell";

type Character = {
  characterId: string;
  className: string;
  light: number;
  emblemPath: string;
  emblemBackgroundPath: string;
};

type CombatEffectTag = {
  key: string;
  label: string;
  kind: "buff" | "debuff" | "effect";
};

type SubclassPlug = {
  plugHash: number;
  name: string;
  description: string;
  icon: string | null;
  plugCategoryIdentifier: string | null;
  fragmentSlots: number | null;
  statEffects: {
    statHash: number;
    name: string;
    description: string;
    value: number;
    isConditionallyActive: boolean;
  }[];
  effectTags: CombatEffectTag[];
  possible: boolean;
  unlocked: boolean;
  equipped: boolean;
};

type SubclassSlot = {
  socketIndex: number;
  slotType: string;
  equipped: SubclassPlug | null;
  available: SubclassPlug[];
};

type SubclassSetup = {
  itemHash: number;
  name: string;
  icon: string | null;
  source?: "live" | "manifest";
  theoretical?: boolean;
  super: SubclassSlot | null;
  classAbility: SubclassSlot | null;
  movement: SubclassSlot | null;
  melee: SubclassSlot | null;
  grenade: SubclassSlot | null;
  aspects: SubclassSlot[];
  fragments: SubclassSlot[];
  other: SubclassSlot[];
};

type GuardianSubclass = {
  itemHash: number;
  name: string;
  icon: string | null;
  element: "arc" | "solar" | "void" | "stasis" | "strand" | "prismatic";
  classType: number;
  status: "equipped" | "unlocked" | "locked";
  equipped: boolean;
  unlocked: boolean;
  locked: boolean;
  usableNow: boolean;
  itemInstanceId: string | null;
  setup: SubclassSetup | null;
};

type ActiveSlot = {
  slot: SubclassSlot;
  label: string;
};

type BuilderDraft = {
  selectedSubclassHash?: number | null;
  previewSubclassPlugs?: Record<string, SubclassPlug>;
  previewGear?: unknown;
  previewArtifactIdentity?: string | null;
  previewArtifactPlugs?: Record<string, number>;
  [key: string]: unknown;
};

const ELEMENT_STYLE: Record<GuardianSubclass["element"], { accent: string; soft: string; border: string }> = {
  arc: { accent: "text-sky-200", soft: "bg-sky-300/10", border: "border-sky-300/35" },
  solar: { accent: "text-orange-200", soft: "bg-orange-300/10", border: "border-orange-300/35" },
  void: { accent: "text-violet-200", soft: "bg-violet-300/10", border: "border-violet-300/35" },
  stasis: { accent: "text-cyan-100", soft: "bg-cyan-200/10", border: "border-cyan-200/35" },
  strand: { accent: "text-emerald-200", soft: "bg-emerald-300/10", border: "border-emerald-300/35" },
  prismatic: { accent: "text-fuchsia-100", soft: "bg-fuchsia-300/10", border: "border-fuchsia-300/35" },
};

function normalizeOptions(slot: SubclassSlot | null) {
  if (!slot) return [];
  return [...(slot.equipped ? [slot.equipped] : []), ...(slot.available ?? [])]
    .filter((option) => {
      const name = option.name.trim().toLowerCase();
      const identifier = option.plugCategoryIdentifier?.trim().toLowerCase() ?? "";
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
    })
    .filter(
      (option, index, all) =>
        all.findIndex((candidate) => candidate.plugHash === option.plugHash) === index
    );
}

function effectClasses(kind: CombatEffectTag["kind"]) {
  if (kind === "buff") return "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200";
  if (kind === "debuff") return "border-rose-400/25 bg-rose-400/[0.07] text-rose-200";
  return "border-sky-400/25 bg-sky-400/[0.07] text-sky-200";
}

export default function SubclassEditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const characterId = String(params.characterId ?? "");

  const [characters, setCharacters] = useState<Character[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);
  const [subclasses, setSubclasses] = useState<GuardianSubclass[]>([]);
  const [fallbackSetup, setFallbackSetup] = useState<SubclassSetup | null>(null);
  const [selectedSubclassHash, setSelectedSubclassHash] = useState<number | null>(null);
  const [previewSubclassPlugs, setPreviewSubclassPlugs] = useState<Record<string, SubclassPlug>>({});
  const [activeSlot, setActiveSlot] = useState<ActiveSlot | null>(null);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"status" | "name">("status");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const draftRestoredRef = useRef(false);
  const deepLinkHandledRef = useRef(false);

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
        throw new Error(coreResult.data?.error || "Failed to load subclass data");
      }

      const nextCharacters: Character[] = charactersResult.data.characters ?? [];
      const nextCharacter =
        nextCharacters.find((candidate) => candidate.characterId === characterId) ?? null;
      if (!nextCharacter) throw new Error("Guardian not found");

      const nextSubclasses: GuardianSubclass[] = Array.isArray(coreResult.data.subclasses)
        ? coreResult.data.subclasses
        : [];

      setCharacters(nextCharacters);
      setCharacter(nextCharacter);
      setSubclasses(nextSubclasses);
      setFallbackSetup(coreResult.data.subclassSetup ?? null);

      if (!showSyncState && !draftRestoredRef.current) {
        let restoredHash: number | null = null;
        let restoredPlugs: Record<string, SubclassPlug> = {};
        try {
          const raw = window.localStorage.getItem(`destiny-builder-draft:${characterId}`);
          if (raw) {
            const draft = JSON.parse(raw) as BuilderDraft;
            if (typeof draft.selectedSubclassHash === "number") {
              restoredHash = draft.selectedSubclassHash;
            }
            if (draft.previewSubclassPlugs && typeof draft.previewSubclassPlugs === "object") {
              restoredPlugs = draft.previewSubclassPlugs;
            }
          }
        } catch {
          // Malformed local preview should never block the editor.
        }

        const restoredSubclass = nextSubclasses.find((item) => item.itemHash === restoredHash);
        const equippedSubclass = nextSubclasses.find((item) => item.equipped);
        setSelectedSubclassHash(
          restoredSubclass?.itemHash ?? equippedSubclass?.itemHash ?? nextSubclasses[0]?.itemHash ?? null
        );
        setPreviewSubclassPlugs(restoredPlugs);
        draftRestoredRef.current = true;
      } else {
        setSelectedSubclassHash((current) => {
          if (current && nextSubclasses.some((item) => item.itemHash === current)) return current;
          return nextSubclasses.find((item) => item.equipped)?.itemHash ?? nextSubclasses[0]?.itemHash ?? null;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load subclass editor");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    draftRestoredRef.current = false;
    deepLinkHandledRef.current = false;
    void loadPage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  useEffect(() => {
    if (!character || loading || !draftRestoredRef.current) return;
    try {
      const key = `destiny-builder-draft:${characterId}`;
      const existingRaw = window.localStorage.getItem(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      window.localStorage.setItem(
        key,
        JSON.stringify({
          ...existing,
          selectedSubclassHash,
          previewSubclassPlugs,
        })
      );
    } catch {
      // Local preview persistence is best-effort.
    }
  }, [character, characterId, loading, selectedSubclassHash, previewSubclassPlugs]);

  useEffect(() => {
    if (loading) return;
    const sync = () => {
      if (document.visibilityState === "visible") void loadPage(true);
    };
    const interval = window.setInterval(sync, 30_000);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, characterId]);

  const selectedSubclass =
    subclasses.find((subclass) => subclass.itemHash === selectedSubclassHash) ??
    subclasses.find((subclass) => subclass.equipped) ??
    null;

  const setup = selectedSubclass?.setup ?? fallbackSetup;
  const equippedSubclass = subclasses.find((subclass) => subclass.equipped) ?? null;
  const style = selectedSubclass ? ELEMENT_STYLE[selectedSubclass.element] : ELEMENT_STYLE.void;

  const getPreviewKey = (slot: SubclassSlot) =>
    selectedSubclass ? `${selectedSubclass.itemHash}:${slot.socketIndex}` : null;

  const getSelectedPlug = (slot: SubclassSlot | null) => {
    if (!slot || !selectedSubclass) return null;
    return previewSubclassPlugs[`${selectedSubclass.itemHash}:${slot.socketIndex}`] ?? slot.equipped;
  };

  const hasAspectCapacityMetadata = Boolean(
    setup?.aspects.some((slot) =>
      normalizeOptions(slot).some((plug) => typeof plug.fragmentSlots === "number")
    )
  );

  const getFragmentCapacity = (previewState: Record<string, SubclassPlug>) => {
    if (!setup || !selectedSubclass) return 0;
    if (!hasAspectCapacityMetadata) return setup.fragments.length;
    return setup.aspects.reduce((total, slot) => {
      const selected = previewState[`${selectedSubclass.itemHash}:${slot.socketIndex}`] ?? slot.equipped;
      return total + Math.max(0, typeof selected?.fragmentSlots === "number" ? selected.fragmentSlots : 0);
    }, 0);
  };

  const activeFragmentSlotCount = setup
    ? Math.min(setup.fragments.length, getFragmentCapacity(previewSubclassPlugs))
    : 0;
  const visibleFragmentSlots = setup?.fragments.slice(0, activeFragmentSlotCount) ?? [];

  useEffect(() => {
    if (loading || deepLinkHandledRef.current || !setup) return;
    const socketParam = searchParams.get("socket");
    if (!socketParam) {
      deepLinkHandledRef.current = true;
      return;
    }
    const socketIndex = Number(socketParam);
    if (!Number.isFinite(socketIndex)) {
      deepLinkHandledRef.current = true;
      return;
    }
    const allSlots = [
      setup.super,
      setup.classAbility,
      setup.movement,
      setup.melee,
      setup.grenade,
      ...setup.aspects,
      ...setup.fragments,
    ].filter(Boolean) as SubclassSlot[];
    const target = allSlots.find((slot) => slot.socketIndex === socketIndex) ?? null;
    if (target) {
      const fallbackLabel =
        target.slotType === "aspect" ? "Aspect" :
        target.slotType === "fragment" ? "Fragment" :
        target.slotType === "super" ? "Super" :
        target.slotType === "classAbility" ? "Class Ability" :
        target.slotType === "movement" ? "Movement" :
        target.slotType === "melee" ? "Melee" :
        target.slotType === "grenade" ? "Grenade" : "Subclass option";
      setActiveSlot({ slot: target, label: searchParams.get("label") ?? fallbackLabel });
    }
    deepLinkHandledRef.current = true;
  }, [loading, searchParams, setup]);

  const trimHiddenFragmentPreviews = (previewState: Record<string, SubclassPlug>) => {
    if (!setup || !selectedSubclass || !hasAspectCapacityMetadata) return previewState;
    const capacity = Math.min(setup.fragments.length, getFragmentCapacity(previewState));
    const next = { ...previewState };
    setup.fragments.forEach((slot, index) => {
      if (index >= capacity) delete next[`${selectedSubclass.itemHash}:${slot.socketIndex}`];
    });
    return next;
  };

  const siblingSlots = (slot: SubclassSlot) => {
    if (!setup) return [];
    if (slot.slotType === "aspect") return setup.aspects;
    if (slot.slotType === "fragment") return visibleFragmentSlots;
    return [];
  };

  const blockedHashes = (slot: SubclassSlot) => {
    const blocked = new Set<number>();
    for (const sibling of siblingSlots(slot)) {
      if (sibling.socketIndex === slot.socketIndex) continue;
      const selected = getSelectedPlug(sibling);
      if (selected) blocked.add(selected.plugHash);
    }
    return blocked;
  };

  const selectPlug = (slot: SubclassSlot, plug: SubclassPlug) => {
    const key = getPreviewKey(slot);
    if (!key) return;
    const duplicate = siblingSlots(slot).some(
      (sibling) =>
        sibling.socketIndex !== slot.socketIndex && getSelectedPlug(sibling)?.plugHash === plug.plugHash
    );
    if (duplicate) return;

    setPreviewSubclassPlugs((current) => {
      const next = { ...current };
      if (slot.equipped?.plugHash === plug.plugHash) delete next[key];
      else next[key] = plug;
      return slot.slotType === "aspect" ? trimHiddenFragmentPreviews(next) : next;
    });
  };

  const resetSlot = (slot: SubclassSlot) => {
    const key = getPreviewKey(slot);
    if (!key) return;
    setPreviewSubclassPlugs((current) => {
      const next = { ...current };
      delete next[key];
      return slot.slotType === "aspect" ? trimHiddenFragmentPreviews(next) : next;
    });
  };

  const allDisplayedSlots = useMemo(() => {
    if (!setup) return [] as Array<{ slot: SubclassSlot; label: string }>;
    return [
      ...(setup.super ? [{ slot: setup.super, label: "Super" }] : []),
      ...(setup.classAbility ? [{ slot: setup.classAbility, label: "Class Ability" }] : []),
      ...(setup.movement ? [{ slot: setup.movement, label: "Movement" }] : []),
      ...(setup.melee ? [{ slot: setup.melee, label: "Melee" }] : []),
      ...(setup.grenade ? [{ slot: setup.grenade, label: "Grenade" }] : []),
      ...setup.aspects.map((slot, index) => ({ slot, label: `Aspect ${index + 1}` })),
      ...visibleFragmentSlots.map((slot, index) => ({ slot, label: `Fragment ${index + 1}` })),
    ];
  }, [setup, visibleFragmentSlots]);

  const combatEffects = useMemo(() => {
    const map = new Map<string, CombatEffectTag>();
    for (const { slot } of allDisplayedSlots) {
      for (const effect of getSelectedPlug(slot)?.effectTags ?? []) map.set(effect.key, effect);
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDisplayedSlots, previewSubclassPlugs, selectedSubclassHash]);

  const statEffects = useMemo(() => {
    const list: Array<SubclassPlug["statEffects"][number] & { source: string }> = [];
    for (const { slot, label } of allDisplayedSlots) {
      for (const effect of getSelectedPlug(slot)?.statEffects ?? []) list.push({ ...effect, source: label });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDisplayedSlots, previewSubclassPlugs, selectedSubclassHash]);

  const activeOptions = activeSlot ? normalizeOptions(activeSlot.slot) : [];
  const blocked = activeSlot ? blockedHashes(activeSlot.slot) : new Set<number>();
  const filteredOptions = activeOptions
    .filter((option) => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return true;
      return `${option.name} ${option.description}`.toLowerCase().includes(normalized);
    })
    .sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      const current = activeSlot ? getSelectedPlug(activeSlot.slot)?.plugHash : null;
      const equipped = activeSlot?.slot.equipped?.plugHash ?? null;
      const rank = (option: SubclassPlug) => {
        if (option.plugHash === current) return 0;
        if (option.plugHash === equipped) return 1;
        if (option.unlocked) return 2;
        return 3;
      };
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

  const hasSubclassPreview = Boolean(
    selectedSubclass && equippedSubclass && selectedSubclass.itemHash !== equippedSubclass.itemHash
  );
  const previewCount = Object.keys(previewSubclassPlugs).filter((key) =>
    selectedSubclass ? key.startsWith(`${selectedSubclass.itemHash}:`) : false
  ).length;

  function chooseSubclass(subclass: GuardianSubclass) {
    setSelectedSubclassHash(subclass.itemHash);
    setActiveSlot(null);
    setQuery("");
  }

  function resetSubclassToDestiny() {
    if (!equippedSubclass) return;
    setSelectedSubclassHash(equippedSubclass.itemHash);
    setActiveSlot(null);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090d] text-white">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-violet-200" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-white/40">Loading subclass editor</p>
        </div>
      </div>
    );
  }

  if (!character || !selectedSubclass) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07090d] px-6 text-center text-white">
        <div>
          <h1 className="text-2xl font-bold">Subclass editor unavailable</h1>
          <p className="mt-2 text-sm text-white/45">{error || "Subclass data could not be loaded."}</p>
          <Link href={`/guardian/${characterId}`} className="mt-5 inline-block border border-white/15 px-4 py-2 text-sm text-white/70 hover:text-white">
            Back to Build
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      activeSection="builder"
      guardianContextSection="subclass"
      currentBuildHref={`/guardian/${characterId}`}
      loadoutsHref={`/guardian/${characterId}/loadouts`}
      subclassHref={`/guardian/${characterId}/subclass`}
      artifactHref={`/guardian/${characterId}#artifact-panel`}
      guardianId={characterId}
      guardianClassName={character.className}
      guardianSubclassName={selectedSubclass.name}
      guardianEmblemPath={character.emblemPath}
      guardianOptions={characters.map((guardian) => ({
        characterId: guardian.characterId,
        className: guardian.className,
        light: guardian.light,
        emblemPath: guardian.emblemPath,
        href: `/guardian/${guardian.characterId}/subclass`,
      }))}
      power={character.light}
      autoSync
      bungieSynced={!error}
      syncing={syncing}
      onSync={() => void loadPage(true)}
    >
      <main className="min-h-screen px-4 py-5 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-[1540px]">
          <section className="relative overflow-hidden border border-white/10 bg-[#0a0d12]">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-25"
              style={{ backgroundImage: `url(https://www.bungie.net${character.emblemBackgroundPath})` }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,11,0.98)_0%,rgba(8,9,15,0.82)_58%,rgba(5,7,11,0.96)_100%)]" />
            <div className="relative flex flex-col gap-6 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-7">
              <div className="flex items-center gap-5">
                <div className={`flex h-20 w-20 items-center justify-center border ${style.border} ${style.soft}`}>
                  {selectedSubclass.icon ? (
                    <img src={`https://www.bungie.net${selectedSubclass.icon}`} alt="" className="h-14 w-14 object-contain" />
                  ) : (
                    <span className={`text-3xl ${style.accent}`}>◇</span>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35">Subclass editor</p>
                  <h1 className="mt-1 text-3xl font-black uppercase tracking-[0.06em] sm:text-4xl">{selectedSubclass.name}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em]">
                    <span className={style.accent}>{selectedSubclass.element}</span>
                    <span className="text-white/20">·</span>
                    <span className="text-white/40">
                      {selectedSubclass.equipped
                        ? "Equipped in Destiny"
                        : selectedSubclass.locked
                        ? "Theory mode · locked"
                        : "Builder preview"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {(hasSubclassPreview || previewCount > 0) && (
                  <button
                    type="button"
                    onClick={resetSubclassToDestiny}
                    className="border border-white/10 bg-black/25 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/55 hover:border-white/20 hover:text-white"
                  >
                    Reset subclass
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

          <section className="mt-4 border border-white/10 bg-[#080b11] p-3">
            <div className="flex flex-wrap gap-2">
              {subclasses.map((subclass) => {
                const selected = subclass.itemHash === selectedSubclass.itemHash;
                const s = ELEMENT_STYLE[subclass.element];
                return (
                  <button
                    key={subclass.itemHash}
                    type="button"
                    onClick={() => chooseSubclass(subclass)}
                    className={`group flex min-w-[160px] flex-1 items-center gap-3 border px-3 py-2.5 text-left transition ${
                      selected ? `${s.border} ${s.soft}` : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.03]"
                    }`}
                  >
                    {subclass.icon ? (
                      <img src={`https://www.bungie.net${subclass.icon}`} alt="" className="h-9 w-9 object-contain" />
                    ) : (
                      <span className="h-9 w-9 border border-white/10" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold uppercase tracking-[0.08em]">{subclass.name}</span>
                      <span className="mt-1 block text-[9px] uppercase tracking-[0.1em] text-white/35">
                        {subclass.equipped ? "Equipped" : subclass.unlocked ? "Unlocked" : "Locked · Theory"}
                      </span>
                    </span>
                    {subclass.locked && <span className="text-white/25">🔒</span>}
                  </button>
                );
              })}
            </div>
          </section>

          {selectedSubclass.locked && (
            <div className="mt-4 border border-amber-300/20 bg-amber-300/[0.05] px-4 py-3 text-sm text-amber-100/75">
              This subclass is not unlocked on this Guardian. You can inspect and theorycraft it here, but it cannot be applied in Destiny yet.
            </div>
          )}

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
            <section className="min-w-0 space-y-4">
              <EditorSection title="Abilities" meta="Select a slot to edit it in the inspector">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <SlotTile label="Super" slot={setup?.super ?? null} selected={getSelectedPlug(setup?.super ?? null)} active={activeSlot?.slot.socketIndex === setup?.super?.socketIndex} onOpen={(slot) => setActiveSlot({ slot, label: "Super" })} />
                  <SlotTile label="Class" slot={setup?.classAbility ?? null} selected={getSelectedPlug(setup?.classAbility ?? null)} active={activeSlot?.slot.socketIndex === setup?.classAbility?.socketIndex} onOpen={(slot) => setActiveSlot({ slot, label: "Class Ability" })} />
                  <SlotTile label="Movement" slot={setup?.movement ?? null} selected={getSelectedPlug(setup?.movement ?? null)} active={activeSlot?.slot.socketIndex === setup?.movement?.socketIndex} onOpen={(slot) => setActiveSlot({ slot, label: "Movement" })} />
                  <SlotTile label="Melee" slot={setup?.melee ?? null} selected={getSelectedPlug(setup?.melee ?? null)} active={activeSlot?.slot.socketIndex === setup?.melee?.socketIndex} onOpen={(slot) => setActiveSlot({ slot, label: "Melee" })} />
                  <SlotTile label="Grenade" slot={setup?.grenade ?? null} selected={getSelectedPlug(setup?.grenade ?? null)} active={activeSlot?.slot.socketIndex === setup?.grenade?.socketIndex} onOpen={(slot) => setActiveSlot({ slot, label: "Grenade" })} />
                </div>
              </EditorSection>

              {setup && setup.aspects.length > 0 && (
                <EditorSection title="Aspects" meta={`${activeFragmentSlotCount} Fragment slots`}>
                  <div className="grid gap-2 md:grid-cols-2">
                    {setup.aspects.map((slot, index) => (
                      <SlotTile
                        key={slot.socketIndex}
                        label={`Aspect ${index + 1}`}
                        slot={slot}
                        selected={getSelectedPlug(slot)}
                        active={activeSlot?.slot.socketIndex === slot.socketIndex}
                        wide
                        onOpen={(value) => setActiveSlot({ slot: value, label: `Aspect ${index + 1}` })}
                      />
                    ))}
                  </div>
                </EditorSection>
              )}

              {setup && setup.fragments.length > 0 && (
                <EditorSection title="Fragments" meta={`${activeFragmentSlotCount} active`}>
                  {visibleFragmentSlots.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {visibleFragmentSlots.map((slot, index) => (
                        <SlotTile
                          key={slot.socketIndex}
                          label={`Fragment ${index + 1}`}
                          slot={slot}
                          selected={getSelectedPlug(slot)}
                          active={activeSlot?.slot.socketIndex === slot.socketIndex}
                          onOpen={(value) => setActiveSlot({ slot: value, label: `Fragment ${index + 1}` })}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="border border-dashed border-white/10 bg-black/15 p-5 text-sm text-white/35">
                      Select Aspects to grant Fragment slots.
                    </div>
                  )}
                </EditorSection>
              )}

              <EditorSection title="Build impact" meta="Subclass-only effects detected from Bungie descriptions">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="border border-white/10 bg-black/20 p-4">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Combat effects</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {combatEffects.length > 0 ? (
                        combatEffects.map((effect) => (
                          <span key={effect.key} className={`border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${effectClasses(effect.kind)}`}>
                            {effect.label}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-white/30">No classified combat effects in the current subclass preview.</span>
                      )}
                    </div>
                  </div>

                  <div className="border border-white/10 bg-black/20 p-4">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Stat effects</p>
                    <div className="mt-3 space-y-2">
                      {statEffects.length > 0 ? (
                        statEffects.map((effect, index) => (
                          <div key={`${effect.source}-${effect.statHash}-${effect.value}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                            <span className="truncate text-white/45">{effect.source} · {effect.name}</span>
                            <span className={effect.value > 0 ? "text-emerald-200" : "text-rose-200"}>
                              {effect.value > 0 ? "+" : ""}{effect.value}{effect.isConditionallyActive ? "*" : ""}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-sm text-white/30">No stat modifiers in the current subclass preview.</span>
                      )}
                    </div>
                  </div>
                </div>
              </EditorSection>
            </section>

            <aside className="min-w-0 xl:sticky xl:top-[132px] xl:self-start">
              <div className="border border-white/10 bg-[#0a0d12]">
                {activeSlot ? (
                  <>
                    <div className="border-b border-white/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Edit slot</p>
                          <h2 className="mt-1 text-xl font-bold">{activeSlot.label}</h2>
                        </div>
                        <button type="button" onClick={() => setActiveSlot(null)} className="border border-white/10 px-2.5 py-1.5 text-xs text-white/45 hover:text-white">Close</button>
                      </div>

                      <div className="mt-4 flex gap-2">
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Search options..."
                          className="min-w-0 flex-1 border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-white/20 focus:border-white/25"
                        />
                        <select
                          value={sortMode}
                          onChange={(event) => setSortMode(event.target.value as "status" | "name")}
                          className="border border-white/10 bg-[#101318] px-2 py-2 text-xs text-white/60 outline-none"
                        >
                          <option value="status">Status</option>
                          <option value="name">A-Z</option>
                        </select>
                      </div>
                    </div>

                    <div className="max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto p-3">
                      {filteredOptions.map((option) => {
                        const current = getSelectedPlug(activeSlot.slot)?.plugHash === option.plugHash;
                        const destinyEquipped = activeSlot.slot.equipped?.plugHash === option.plugHash;
                        const duplicate = blocked.has(option.plugHash) && !current;
                        return (
                          <button
                            key={option.plugHash}
                            type="button"
                            disabled={duplicate}
                            onClick={() => selectPlug(activeSlot.slot, option)}
                            className={`w-full border p-3 text-left transition ${
                              current
                                ? `${style.border} ${style.soft}`
                                : duplicate
                                ? "cursor-not-allowed border-white/5 bg-white/[0.015] opacity-35"
                                : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.03]"
                            }`}
                          >
                            <div className="flex gap-3">
                              {option.icon ? (
                                <img src={`https://www.bungie.net${option.icon}`} alt="" className="h-11 w-11 shrink-0 object-contain" />
                              ) : (
                                <span className="h-11 w-11 shrink-0 border border-white/10" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="font-semibold">{option.name}</p>
                                  {current && <span className="text-[9px] uppercase tracking-[0.12em] text-cyan-200">Selected</span>}
                                </div>
                                <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-white/30">
                                  {duplicate
                                    ? "Already used in another slot"
                                    : destinyEquipped
                                    ? "Equipped in Destiny"
                                    : option.unlocked
                                    ? "Unlocked"
                                    : "Locked · Theory only"}
                                </p>
                                {option.description && <p className="mt-2 line-clamp-3 text-xs leading-5 text-white/45">{option.description}</p>}
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {typeof option.fragmentSlots === "number" && (
                                    <span className="border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-white/45">+{option.fragmentSlots} Fragment slots</span>
                                  )}
                                  {(option.statEffects ?? []).map((effect) => (
                                    <span key={`${option.plugHash}-${effect.statHash}-${effect.value}`} className={`border px-1.5 py-0.5 text-[10px] ${effect.value > 0 ? "border-emerald-400/20 text-emerald-200" : "border-rose-400/20 text-rose-200"}`}>
                                      {effect.value > 0 ? "+" : ""}{effect.value} {effect.name}
                                    </span>
                                  ))}
                                  {(option.effectTags ?? []).map((effect) => (
                                    <span key={`${option.plugHash}-${effect.key}`} className={`border px-1.5 py-0.5 text-[10px] ${effectClasses(effect.kind)}`}>
                                      {effect.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {getSelectedPlug(activeSlot.slot) &&
                      activeSlot.slot.equipped?.plugHash !== getSelectedPlug(activeSlot.slot)?.plugHash && (
                        <div className="border-t border-white/10 p-3">
                          <button
                            type="button"
                            onClick={() => resetSlot(activeSlot.slot)}
                            className="w-full border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45 hover:border-white/20 hover:text-white"
                          >
                            Reset slot to Destiny
                          </button>
                        </div>
                      )}
                  </>
                ) : (
                  <div className="p-5">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Subclass overview</p>
                    <h2 className="mt-1 text-xl font-bold">{selectedSubclass.name}</h2>
                    <p className="mt-3 text-sm leading-6 text-white/45">
                      Select an Ability, Aspect, or Fragment on the left to inspect every available option without leaving this page.
                    </p>
                    <div className="mt-5 space-y-3 border-t border-white/10 pt-4 text-xs">
                      <div className="flex justify-between gap-3"><span className="text-white/35">State</span><span>{selectedSubclass.equipped ? "Equipped" : selectedSubclass.locked ? "Theory" : "Preview"}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-white/35">Fragment slots</span><span>{activeFragmentSlotCount}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-white/35">Preview changes</span><span>{previewCount + (hasSubclassPreview ? 1 : 0)}</span></div>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function EditorSection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="border border-white/10 bg-[#080b11] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">{title}</h2>
        {meta && <span className="text-[9px] uppercase tracking-[0.12em] text-white/25">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function SlotTile({
  label,
  slot,
  selected,
  active,
  wide = false,
  onOpen,
}: {
  label: string;
  slot: SubclassSlot | null;
  selected: SubclassPlug | null;
  active: boolean;
  wide?: boolean;
  onOpen: (slot: SubclassSlot) => void;
}) {
  if (!slot) {
    return (
      <div className="min-h-[112px] border border-dashed border-white/10 bg-black/10 p-3 text-xs text-white/25">
        {label} unavailable
      </div>
    );
  }

  const changed = Boolean(selected && slot.equipped?.plugHash !== selected.plugHash);
  return (
    <button
      type="button"
      onClick={() => onOpen(slot)}
      className={`relative min-h-[112px] border p-3 text-left transition ${wide ? "sm:min-h-[96px]" : ""} ${
        active
          ? "border-cyan-200/35 bg-cyan-200/[0.05]"
          : "border-white/10 bg-black/20 hover:border-white/22 hover:bg-white/[0.025]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/30">{label}</span>
        {changed && <span className="h-1.5 w-1.5 rounded-full bg-cyan-200" title="Preview changed" />}
      </div>
      <div className={`mt-3 ${wide ? "flex items-center gap-3" : ""}`}>
        {selected?.icon ? (
          <img src={`https://www.bungie.net${selected.icon}`} alt="" className={`${wide ? "h-11 w-11" : "h-12 w-12"} object-contain`} />
        ) : (
          <span className="block h-12 w-12 border border-white/10" />
        )}
        <div className={wide ? "min-w-0" : "mt-2 min-w-0"}>
          <p className="truncate text-sm font-semibold">{selected?.name ?? "Choose option"}</p>
          {wide && typeof selected?.fragmentSlots === "number" && (
            <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-white/30">+{selected.fragmentSlots} Fragment slots</p>
          )}
        </div>
      </div>
    </button>
  );
}
