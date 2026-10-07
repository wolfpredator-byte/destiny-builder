"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type AppSection = "guardians" | "builder" | "loadouts" | "vault";
type GuardianContextSection = "build" | "subclass" | "artifact";

type GuardianSwitchOption = {
  characterId: string;
  className: string;
  light: number;
  emblemPath?: string | null;
  subtitle?: string | null;
  href: string;
};

type AppShellProps = {
  activeSection: AppSection;
  children: ReactNode;
  currentBuildHref?: string;
  loadoutsHref?: string;
  vaultHref?: string;
  subclassHref?: string;
  artifactHref?: string;
  guardianContextSection?: GuardianContextSection;
  guardianId?: string | null;
  guardianLabel?: string | null;
  guardianClassName?: string | null;
  guardianSubclassName?: string | null;
  guardianEmblemPath?: string | null;
  guardianOptions?: GuardianSwitchOption[];
  power?: number | null;
  autoSync?: boolean;
  bungieSynced?: boolean;
  syncing?: boolean;
  onSync?: () => void;
};

const globalNavItems: Array<{
  key: Exclude<AppSection, "builder">;
  label: string;
  href: string;
}> = [
  { key: "guardians", label: "Guardians", href: "/" },
  { key: "vault", label: "Vault", href: "/vault" },
  { key: "loadouts", label: "Loadouts", href: "/" },
];

export default function AppShell({
  activeSection,
  children,
  currentBuildHref,
  loadoutsHref,
  vaultHref,
  subclassHref,
  artifactHref,
  guardianContextSection = "build",
  guardianId,
  guardianLabel,
  guardianClassName,
  guardianSubclassName,
  guardianEmblemPath,
  guardianOptions = [],
  power,
  autoSync = true,
  bungieSynced = true,
  syncing = false,
  onSync,
}: AppShellProps) {
  const router = useRouter();
  const [guardianMenuOpen, setGuardianMenuOpen] = useState(false);
  const hasGuardianContext = Boolean(guardianId || guardianClassName || guardianLabel);
  const displayClassName = guardianClassName ?? guardianLabel ?? "Guardian";
  const displaySubtitle = guardianSubclassName ?? null;

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <div className="pointer-events-none fixed inset-0 -z-0 bg-[radial-gradient(circle_at_50%_0%,rgba(90,74,145,0.12),transparent_38%),linear-gradient(180deg,#080a0f_0%,#07090d_48%,#05070a_100%)]" />

      <header className="sticky top-0 z-[70] border-b border-white/10 bg-[#080a0f]/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 w-full max-w-[1540px] items-center gap-4 px-5 lg:px-8">
          <Link href="/" className="group flex min-w-fit items-center gap-3">
            <span className="relative flex h-9 w-9 rotate-45 items-center justify-center border border-cyan-300/35 bg-cyan-300/[0.05] transition group-hover:border-cyan-300/70">
              <span className="h-2.5 w-2.5 bg-cyan-300 -rotate-45" />
            </span>
            <span className="hidden sm:block">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.32em] text-cyan-200/70">
                Destiny
              </span>
              <span className="block text-sm font-bold uppercase tracking-[0.08em]">
                Builder
              </span>
            </span>
          </Link>

          <div className="hidden h-8 w-px bg-white/10 lg:block" />

          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {globalNavItems.map((item) => {
              const active = item.key === activeSection;
              const href =
                item.key === "loadouts" && loadoutsHref
                  ? loadoutsHref
                  : item.key === "vault" && vaultHref
                  ? vaultHref
                  : item.href;

              return (
                <Link
                  key={item.key}
                  href={href}
                  className={`whitespace-nowrap border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                    active
                      ? "border-white/15 bg-white/10 text-white"
                      : "border-transparent text-white/45 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/80"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}

            <button
              type="button"
              disabled
              title="Build Assistant arrives with the Build Engine phase"
              className="whitespace-nowrap border border-violet-400/10 bg-violet-400/[0.04] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200/45"
            >
              Build Assistant
              <span className="ml-2 rounded-sm bg-violet-400/10 px-1 py-0.5 text-[9px]">AI</span>
            </button>
          </nav>

          <div className="hidden items-center gap-2 xl:flex">
            <span className="border border-white/10 bg-black/25 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Auto sync
              <span className={`ml-2 ${autoSync ? "text-cyan-300" : "text-white/25"}`}>
                {autoSync ? "On" : "Off"}
              </span>
            </span>

            <button
              type="button"
              onClick={onSync}
              disabled={!onSync || syncing}
              className="border border-white/10 bg-black/25 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/45 transition hover:border-white/20 hover:text-white/75 disabled:cursor-default"
              title={onSync ? "Sync Bungie now" : undefined}
            >
              <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${bungieSynced ? "bg-cyan-300" : "bg-amber-300"}`} />
              {syncing ? "Syncing" : bungieSynced ? "Bungie synced" : "Bungie"}
            </button>
          </div>
        </div>

        {hasGuardianContext && (
          <div className="border-t border-white/[0.06] bg-black/15">
            <div className="mx-auto flex min-h-12 w-full max-w-[1540px] items-center gap-3 px-5 lg:px-8">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setGuardianMenuOpen((current) => !current)}
                  className="group flex min-w-[190px] items-center gap-2.5 border border-transparent px-2 py-1.5 text-left transition hover:border-white/10 hover:bg-white/[0.03]"
                  aria-expanded={guardianMenuOpen}
                >
                  {guardianEmblemPath ? (
                    <img
                      src={`https://www.bungie.net${guardianEmblemPath}`}
                      alt=""
                      className="h-7 w-7 border border-white/10 object-cover"
                    />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center border border-white/10 bg-white/[0.04] text-[10px] text-white/35">
                      ◇
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-bold uppercase tracking-[0.14em] text-white/80">
                      {displayClassName}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] uppercase tracking-[0.12em] text-white/30">
                      {displaySubtitle ?? "Guardian"}
                      {typeof power === "number" ? ` · Power ${power}` : ""}
                    </span>
                  </span>
                  <span className="text-[10px] text-white/30 transition group-hover:text-white/60">⌄</span>
                </button>

                {guardianMenuOpen && guardianOptions.length > 0 && (
                  <div className="absolute left-0 top-[calc(100%+6px)] z-[90] w-72 border border-white/15 bg-[#0b0e13]/98 p-2 shadow-2xl backdrop-blur-xl">
                    <p className="px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">
                      Switch Guardian
                    </p>
                    <div className="mt-1 space-y-1">
                      {guardianOptions.map((guardian) => {
                        const current = guardian.characterId === guardianId;
                        return (
                          <button
                            key={guardian.characterId}
                            type="button"
                            onClick={() => {
                              setGuardianMenuOpen(false);
                              if (!current) {
                                router.push(guardian.href);
                              }
                            }}
                            className={`flex w-full items-center gap-3 border px-2.5 py-2 text-left transition ${
                              current
                                ? "cursor-default border-cyan-200/25 bg-cyan-200/[0.05]"
                                : "border-transparent hover:border-white/10 hover:bg-white/[0.035]"
                            }`}
                          >
                            {guardian.emblemPath ? (
                              <img
                                src={`https://www.bungie.net${guardian.emblemPath}`}
                                alt=""
                                className="h-9 w-9 border border-white/10 object-cover"
                              />
                            ) : (
                              <span className="h-9 w-9 border border-white/10 bg-white/[0.04]" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-bold uppercase tracking-[0.08em]">
                                {guardian.className}
                              </span>
                              <span className="mt-0.5 block truncate text-[10px] text-white/35">
                                {guardian.subtitle ?? "Guardian"} · Power {guardian.light}
                              </span>
                            </span>
                            {current && <span className="text-cyan-200">●</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="h-6 w-px bg-white/10" />

              <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <ContextLink
                  label="Build"
                  href={currentBuildHref}
                  active={activeSection === "builder" && guardianContextSection === "build"}
                />
                <ContextLink
                  label="Subclass"
                  href={subclassHref}
                  active={guardianContextSection === "subclass"}
                />
                <ContextLink
                  label="Artifact"
                  href={artifactHref}
                  active={guardianContextSection === "artifact"}
                />
              </nav>

              {typeof power === "number" && (
                <div className="hidden shrink-0 items-baseline gap-2 border-l border-white/10 pl-4 md:flex">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-amber-300/45">Power</span>
                  <span className="text-sm font-black text-amber-100">{power}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {guardianMenuOpen && (
        <button
          type="button"
          aria-label="Close Guardian switcher"
          className="fixed inset-0 z-[60] cursor-default"
          onClick={() => setGuardianMenuOpen(false)}
        />
      )}

      <div className="relative z-10">{children}</div>
    </div>
  );
}

function ContextLink({
  label,
  href,
  active,
}: {
  label: string;
  href?: string;
  active: boolean;
}) {
  const classes = `whitespace-nowrap border-b-2 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.15em] transition ${
    active
      ? "border-cyan-200 text-white"
      : href
      ? "border-transparent text-white/38 hover:border-white/20 hover:text-white/75"
      : "cursor-not-allowed border-transparent text-white/18"
  }`;

  if (!href) {
    return (
      <span className={classes} title={`${label} editor is the next UI step`}>
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className={classes}>
      {label}
    </Link>
  );
}
