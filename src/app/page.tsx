"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/destiny-builder/AppShell";

type Guardian = {
  characterId: string;
  className: string;
  light: number;
  emblemPath?: string | null;
  emblemBackgroundPath?: string | null;
  dateLastPlayed?: string | null;
};

type BuilderLoadout = {
  id?: string;
  name?: string;
  className?: string;
  favorite?: boolean;
};

const ACTIVE_GUARDIAN_KEY = "destiny-builder-active-guardian";
const LOADOUTS_KEY = "destiny-builder-loadouts";
const CLASS_ORDER: Record<string, number> = { Titan: 0, Hunter: 1, Warlock: 2 };

function safeReadActiveGuardian(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_GUARDIAN_KEY);
  } catch {
    return null;
  }
}

function readBuilderLoadouts(): BuilderLoadout[] {
  try {
    const raw = window.localStorage.getItem(LOADOUTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is BuilderLoadout =>
      Boolean(entry && typeof entry === "object" && "name" in entry)
    );
  } catch {
    return [];
  }
}

function powerLabel(power: number | undefined): string {
  return typeof power === "number" && Number.isFinite(power)
    ? String(power)
    : "—";
}

function lastPlayedLabel(dateValue: string | null | undefined): string {
  if (!dateValue) return "Activity unavailable";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Activity unavailable";
  return `Last played ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

function classAccent(className: string) {
  if (className === "Warlock") return {
    line: "bg-cyan-200", border: "border-cyan-200/35", tint: "from-cyan-400/12",
    text: "text-cyan-100", glow: "bg-cyan-300/10",
  };
  if (className === "Hunter") return {
    line: "bg-emerald-200", border: "border-emerald-200/35", tint: "from-emerald-400/12",
    text: "text-emerald-100", glow: "bg-emerald-300/10",
  };
  return {
    line: "bg-amber-200", border: "border-amber-200/35", tint: "from-amber-400/12",
    text: "text-amber-100", glow: "bg-amber-300/10",
  };
}

function Arrow() {
  return <span aria-hidden="true" className="ml-2 inline-block transition-transform group-hover:translate-x-1">→</span>;
}

export default function HomePage() {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadouts, setLoadouts] = useState<BuilderLoadout[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);

  const fetchGuardians = useCallback(async (manual = false) => {
    if (manual) setSyncing(true);
    try {
      let response = await fetch("/api/destiny/characters", { cache: "no-store" });
      if (response.status === 401) {
        const refresh = await fetch("/api/auth/refresh", { method: "POST" });
        if (refresh.ok) {
          response = await fetch("/api/destiny/characters", { cache: "no-store" });
        }
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        if (response.status === 401) {
          setNeedsLogin(true);
          setGuardians([]);
          setError("");
          return;
        }
        throw new Error(data?.error ?? "Could not load your Guardians from Bungie.");
      }

      const next: Guardian[] = Array.isArray(data.characters)
        ? data.characters.filter((entry: unknown): entry is Guardian =>
            typeof entry === "object" && entry !== null &&
            "characterId" in entry && typeof entry.characterId === "string" &&
            "className" in entry && typeof entry.className === "string"
          )
        : [];
      setGuardians(next);
      setNeedsLogin(false);
      setError("");
      setActiveId((previous) => {
        const candidate = previous ?? safeReadActiveGuardian();
        return next.some((guardian) => guardian.characterId === candidate)
          ? candidate
          : next[0]?.characterId ?? null;
      });
      setLoadouts(readBuilderLoadouts());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect to Bungie.");
    } finally {
      setLoading(false);
      if (manual) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    setActiveId(safeReadActiveGuardian());
    setLoadouts(readBuilderLoadouts());
    void fetchGuardians();
  }, [fetchGuardians]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void fetchGuardians();
    };
    const interval = window.setInterval(refresh, 90_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [fetchGuardians]);

  const sortedGuardians = useMemo(() => [...guardians].sort((a, b) =>
    (CLASS_ORDER[a.className] ?? 9) - (CLASS_ORDER[b.className] ?? 9)
  ), [guardians]);
  const activeGuardian = guardians.find((guardian) => guardian.characterId === activeId) ?? guardians[0] ?? null;
  const activeHref = activeGuardian ? `/guardian/${activeGuardian.characterId}` : "/";
  const favoriteLoadouts = loadouts.filter((entry) => entry.favorite === true);
  const activeFavorites = favoriteLoadouts.filter((entry) => !entry.className || entry.className === activeGuardian?.className).slice(0, 3);
  const highestPower = guardians.length ? Math.max(...guardians.map((guardian) => Number.isFinite(guardian.light) ? guardian.light : 0)) : null;

  function activateGuardian(guardian: Guardian) {
    setActiveId(guardian.characterId);
    try {
      window.localStorage.setItem(ACTIVE_GUARDIAN_KEY, guardian.characterId);
    } catch {
      // Private mode can disable localStorage; navigation must still work.
    }
  }

  return (
    <AppShell
      activeSection="guardians"
      currentBuildHref={activeHref}
      loadoutsHref={activeGuardian ? `/guardian/${activeGuardian.characterId}/loadouts` : "/"}
      vaultHref="/vault"
      autoSync
      syncing={syncing}
      bungieSynced={!needsLogin && !error}
      onSync={() => void fetchGuardians(true)}
    >
      <main className="min-h-[calc(100vh-5rem)] px-4 pb-14 pt-7 sm:px-6 lg:px-8 lg:pt-10">
        <div className="mx-auto max-w-[1540px] space-y-7 lg:space-y-8">
          <section className="relative isolate overflow-hidden border border-white/10 bg-[#090e15]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_75%_30%,rgba(58,192,219,0.08),transparent_52%),linear-gradient(120deg,rgba(11,28,36,0.65),transparent_66%)]" />
            {activeGuardian?.emblemBackgroundPath && (
              <div className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.16]"
                style={{ backgroundImage: `url(https://www.bungie.net${activeGuardian.emblemBackgroundPath})` }} />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#090e15]/95 via-[#090e15]/80 to-[#090e15]/65" />
            <div className="relative flex flex-col gap-8 px-5 py-8 sm:px-8 sm:py-10 lg:flex-row lg:items-end lg:justify-between lg:px-11 lg:py-12">
              <div className="max-w-3xl">
                <div className="flex items-center gap-3">
                  <span className="h-px w-8 bg-cyan-200/70" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-100/65">Account command center</p>
                </div>
                <h1 className="mt-5 text-[clamp(2rem,5vw,4rem)] font-black uppercase leading-[0.99] tracking-[0.06em] text-white">
                  Your <span className="text-cyan-100">Guardians</span>
                </h1>
                <p className="mt-5 max-w-xl text-sm leading-6 text-white/48">
                  One account. Three legends. Continue your current build, explore your equipment, or jump straight into an editor.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]">
                  <span className="border border-cyan-300/20 bg-cyan-200/[0.055] px-3 py-2 text-cyan-100/75">{loading ? "Connecting to Bungie" : needsLogin ? "Bungie login required" : error ? "Connection interrupted" : "Bungie connected"}</span>
                  <span className="border border-white/10 bg-white/[0.025] px-3 py-2 text-white/45">Account-wide workspace</span>
                </div>
              </div>
              {activeGuardian && (
                <div className="flex min-w-[230px] flex-col gap-3 border-l-2 border-cyan-200/65 bg-black/35 px-5 py-4 backdrop-blur-sm lg:max-w-xs">
                  <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-100/55">Active Guardian</span>
                  <div className="flex items-center gap-3">
                    {activeGuardian.emblemPath ? (
                      <img src={`https://www.bungie.net${activeGuardian.emblemPath}`} alt="" className="h-12 w-12 border border-white/20 object-cover" />
                    ) : <span className="h-12 w-12 border border-white/20 bg-white/5" />}
                    <div>
                      <p className="font-black uppercase tracking-[0.08em]">{activeGuardian.className}</p>
                      <p className="mt-1 text-xs text-amber-200/90">Power {powerLabel(activeGuardian.light)}</p>
                    </div>
                  </div>
                  <Link href={activeHref} onClick={() => activateGuardian(activeGuardian)}
                    className="group mt-1 flex items-center justify-between border border-cyan-200/35 bg-cyan-200/[0.10] px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-cyan-100 transition hover:bg-cyan-200/[0.17]">
                    Continue Build <Arrow />
                  </Link>
                </div>
              )}
            </div>
          </section>

          {error && (
            <div role="alert" className="border border-rose-400/30 bg-rose-400/[0.07] px-5 py-4 text-sm text-rose-100">
              {error} <button type="button" onClick={() => void fetchGuardians(true)} className="ml-3 font-bold underline">Retry</button>
            </div>
          )}

          {needsLogin && !loading ? (
            <section className="border border-white/10 bg-[#0b1017] px-6 py-12 text-center sm:px-10">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-100/50">Secure connection</p>
              <h2 className="mt-3 text-2xl font-black uppercase tracking-[0.08em]">Connect to Bungie</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-white/45">
                Sign in to load your Guardians, view real inventory data and continue your saved Builder previews.
              </p>
              <Link href="/api/auth/bungie" className="mt-7 inline-flex border border-cyan-200/40 bg-cyan-200/10 px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-200/20">Login with Bungie →</Link>
            </section>
          ) : (
            <>
              <section aria-label="Account overview" className="grid grid-cols-2 gap-px overflow-hidden border border-white/10 bg-white/10 lg:grid-cols-4">
                {[
                  { label: "Connected Guardians", value: loading ? "—" : String(guardians.length), note: "Playable characters" },
                  { label: "Highest Power", value: highestPower === null ? "—" : String(highestPower), note: "Across your Guardians" },
                  { label: "Builder Loadouts", value: String(loadouts.length), note: "Saved locally" },
                  { label: "Favorites", value: String(favoriteLoadouts.length), note: "Quick access builds" },
                ].map((stat) => (
                  <div key={stat.label} className="bg-[#0b0f16] px-4 py-5 sm:px-6">
                    <p className="text-[9px] font-bold uppercase tracking-[0.19em] text-white/35">{stat.label}</p>
                    <p className="mt-2 text-3xl font-black tabular-nums tracking-tight text-white/90 sm:text-4xl">{stat.value}</p>
                    <p className="mt-1 text-[10px] text-white/25">{stat.note}</p>
                  </div>
                ))}
              </section>

              <section aria-labelledby="roster-heading">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-cyan-100/50">Guardian roster</p>
                    <h2 id="roster-heading" className="mt-1 text-xl font-black uppercase tracking-[0.1em] text-white/90 sm:text-2xl">Choose your Guardian</h2>
                  </div>
                  <p className="text-xs text-white/35">Set one active, or jump directly into a workspace.</p>
                </div>
                {loading ? (
                  <div className="grid gap-4 lg:grid-cols-3">
                    {[0, 1, 2].map((slot) => <div key={slot} className="h-[350px] animate-pulse border border-white/10 bg-white/[0.025]" />)}
                  </div>
                ) : sortedGuardians.length ? (
                  <div className="grid gap-4 lg:grid-cols-3">
                    {sortedGuardians.map((guardian) => {
                      const active = guardian.characterId === activeGuardian?.characterId;
                      const accent = classAccent(guardian.className);
                      const url = `/guardian/${guardian.characterId}`;
                      const savedForClass = loadouts.filter((item) => !item.className || item.className === guardian.className).length;
                      return (
                        <article key={guardian.characterId}
                          className={`group relative isolate flex min-h-[340px] flex-col overflow-hidden border bg-[#0b1017] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/30 ${active ? accent.border : "border-white/10"}`}>
                          {guardian.emblemBackgroundPath && <div className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-35 transition-opacity duration-200 group-hover:opacity-50"
                            style={{ backgroundImage: `url(https://www.bungie.net${guardian.emblemBackgroundPath})` }} />}
                          <div className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${accent.tint} via-[#0b1017]/55 to-[#0b1017]`} />
                          <span className={`absolute left-0 top-0 h-1 w-20 ${accent.line}`} />
                          <div className="relative flex items-start justify-between gap-3 p-5">
                            {guardian.emblemPath ? <img src={`https://www.bungie.net${guardian.emblemPath}`} alt="" className="h-14 w-14 border border-white/20 object-cover shadow-lg" /> : <div className="h-14 w-14 border border-white/20 bg-white/10" />}
                            <button type="button" onClick={() => activateGuardian(guardian)}
                              aria-label={active ? `${guardian.className} is active` : `Set ${guardian.className} as active Guardian`}
                              className={`border px-3 py-2 text-[9px] font-bold uppercase tracking-[0.13em] transition ${active ? "border-cyan-200/40 bg-cyan-200/10 text-cyan-100" : "border-white/20 bg-black/50 text-white/70 hover:border-cyan-200/40 hover:text-white"}`}>
                              {active ? "● Active" : "Set active"}
                            </button>
                          </div>
                          <div className="relative mt-auto px-5 pt-9">
                            <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/40">Guardian / {guardian.className}</p>
                            <h3 className="mt-2 text-[clamp(1.6rem,3vw,2.2rem)] font-black uppercase tracking-[0.06em]">{guardian.className}</h3>
                            <div className="mt-3 flex items-baseline gap-2">
                              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-amber-200/50">Power</span>
                              <span className="text-xl font-black tabular-nums text-amber-100">{powerLabel(guardian.light)}</span>
                            </div>
                            <p className="mt-2 text-[10px] text-white/35">{lastPlayedLabel(guardian.dateLastPlayed)}</p>
                            <p className="mt-1 text-[10px] text-white/30">{savedForClass} Builder loadout{savedForClass === 1 ? "" : "s"} available</p>
                          </div>
                          <div className="relative mt-5 grid grid-cols-3 gap-px border-t border-white/10 bg-white/10">
                            <Link href={url} onClick={() => activateGuardian(guardian)}
                              className="group flex items-center justify-center bg-[#101820] px-2 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-cyan-100 transition hover:bg-[#182b34]">Build <Arrow /></Link>
                            <Link href={`${url}/subclass`} onClick={() => activateGuardian(guardian)}
                              className="flex items-center justify-center bg-[#101820] px-2 py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-white/65 transition hover:bg-[#182b34] hover:text-white">Subclass</Link>
                            <Link href={`${url}/artifact`} onClick={() => activateGuardian(guardian)}
                              className="flex items-center justify-center bg-[#101820] px-2 py-3 text-[10px] font-bold uppercase tracking-[0.07em] text-white/65 transition hover:bg-[#182b34] hover:text-white">Artifact</Link>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border border-white/10 bg-white/[0.025] p-8 text-center text-sm text-white/50">
                    No Guardians found for this Bungie account. <Link href="/api/auth/bungie" className="ml-2 text-cyan-100 underline">Reconnect Bungie</Link>
                  </div>
                )}
              </section>

              <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
                <div className="border border-white/10 bg-[#0b1017] p-5 sm:p-6">
                  <div className="mb-5">
                    <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-100/50">Shortcuts</p>
                    <h2 className="mt-1 text-lg font-black uppercase tracking-[0.06em]">Your workspaces</h2>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Link href="/vault" className="group flex min-h-[110px] flex-col justify-between border border-white/10 bg-white/[0.025] p-4 transition hover:border-cyan-200/30 hover:bg-cyan-200/[0.05]">
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">Account inventory</span>
                      <span className="text-sm font-black uppercase tracking-[0.05em]">Vault <Arrow /></span>
                    </Link>
                    <Link href={activeGuardian ? `/guardian/${activeGuardian.characterId}/loadouts` : "/"} onClick={() => { if (activeGuardian) activateGuardian(activeGuardian); }}
                      className="group flex min-h-[110px] flex-col justify-between border border-white/10 bg-white/[0.025] p-4 transition hover:border-cyan-200/30 hover:bg-cyan-200/[0.05]">
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">Saved & in-game</span>
                      <span className="text-sm font-black uppercase tracking-[0.05em]">Loadouts <Arrow /></span>
                    </Link>
                    <Link href={activeHref} onClick={() => { if (activeGuardian) activateGuardian(activeGuardian); }}
                      className="group flex min-h-[110px] flex-col justify-between border border-white/10 bg-white/[0.025] p-4 transition hover:border-cyan-200/30 hover:bg-cyan-200/[0.05]">
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">Current preview</span>
                      <span className="text-sm font-black uppercase tracking-[0.05em]">Builder <Arrow /></span>
                    </Link>
                  </div>
                  <p className="mt-4 text-[11px] text-white/28">All workspaces use your real Bungie account. Builder previews remain local unless an action explicitly says it changes Destiny.</p>
                </div>
                <div className="border border-white/10 bg-[#0b1017] p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-100/50">Pinned builds</p>
                      <h2 className="mt-1 text-lg font-black uppercase tracking-[0.06em]">Favorites</h2>
                    </div>
                    <span className="text-xl text-amber-200/80">★</span>
                  </div>
                  {activeFavorites.length ? (
                    <div className="mt-5 space-y-2">
                      {activeFavorites.map((loadout, index) => (
                        <Link key={`${loadout.id ?? loadout.name ?? "favorite"}-${index}`}
                          href={activeGuardian ? `/guardian/${activeGuardian.characterId}/loadouts` : "/"}
                          onClick={() => { if (activeGuardian) activateGuardian(activeGuardian); }}
                          className="group flex items-center justify-between gap-3 border border-white/10 bg-white/[0.025] px-4 py-3 text-xs hover:border-white/20 hover:bg-white/[0.05]">
                          <span className="min-w-0 truncate font-semibold text-white/70"><span className="mr-2 text-amber-200">★</span>{loadout.name ?? "Unnamed loadout"}</span>
                          <span className="shrink-0 text-white/30 transition group-hover:text-white/70">→</span>
                        </Link>
                      ))}
                    </div>
                  ) : <p className="mt-5 text-xs leading-5 text-white/35">Your favorite Builder loadouts will appear here for the active Guardian.</p>}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
