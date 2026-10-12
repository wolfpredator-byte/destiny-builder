"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import AppShell from "@/components/destiny-builder/AppShell";

type Guardian = {
  characterId: string;
  className: string;
  light: number;
  emblemPath: string | null;
};

type ItemLocation = {
  type: "equipped" | "characterInventory" | "vault" | "otherGuardian" | "missing";
  characterId: string | null;
  className: string | null;
  placement: "equipped" | "inventory" | "vault" | null;
};

type ItemStat = {
  statHash: number;
  name: string;
  description?: string;
  value: number;
};

type CombatEffect = {
  key: string;
  label: string;
  kind: "buff" | "debuff" | "effect";
};

type Perk = {
  plugHash: number;
  socketIndex: number;
  name: string;
  description: string;
  icon: string | null;
  plugCategoryIdentifier?: string | null;
  type?: string;
  state?: "selected" | "rolled" | "possible";
  effectTags?: CombatEffect[];
};

type WeaponPerkColumn = {
  socketIndex: number;
  selected: Perk | null;
  rolled: Perk[];
  possible: Perk[];
  all: Perk[];
};

type DestinyItem = {
  itemHash: number;
  itemInstanceId: string | null;
  bucketHash: number | null;
  equipmentSlotHash?: number | null;
  quantity: number;
  name: string;
  description: string;
  icon: string | null;
  itemTypeDisplayName: string | null;
  itemType: number | null;
  itemSubType: number | null;
  tierTypeName: string | null;
  equippable?: boolean;
  category: string;
  classType?: number | null;
  power?: number | null;
  damageType?: number | null;
  gearTier?: number | null;
  isEquipped?: boolean;
  location?: ItemLocation | null;
  stats?: ItemStat[];
  armorStats?: ItemStat[];
  armorStatTotal?: number | null;
};

type BrowseItem = DestinyItem & { browserId: string; location: ItemLocation };

type ItemDetail = {
  itemInstanceId: string;
  itemHash: number;
  name: string;
  description?: string;
  category: string;
  power: number | null;
  damageType?: number | null;
  gearTier: number | null;
  stats: ItemStat[];
  armorStats: ItemStat[];
  armorStatTotal: number | null;
  recoilDirection: number | null;
  selectedPerks: Perk[];
  perkColumns?: WeaponPerkColumn[];
  intrinsicPerks: Array<{
    perkHash: number;
    name: string;
    description: string;
    icon: string | null;
    effectTags?: CombatEffect[];
  }>;
  itemSet: {
    name: string;
    perks: Array<{
      requiredSetCount: number;
      name: string;
      description: string;
      icon: string | null;
      effectTags?: CombatEffect[];
    }>;
  } | null;
};

type ApiBase = { success: boolean; error?: string };
type GuardiansResponse = ApiBase & { characters?: Guardian[] };
type CoreResponse = ApiBase & { inventory?: DestinyItem[]; equipment?: DestinyItem[] };
type AccountResponse = ApiBase & { vault?: DestinyItem[]; otherGuardianItems?: DestinyItem[] };
type DetailResponse = ApiBase & { item?: ItemDetail };
type SyncScope = "core" | "account";
type CategoryFilter = "all" | "weapon" | "armor" | "artifact";
type SortMode = "name" | "power" | "tier";
type ComparableCategory = "weapon" | "armor";
const COMPARE_LIMIT = 5;
const COMPARE_STORAGE_KEY = "destiny-builder-compare-tray-v1";
const ACTIVE_GUARDIAN_KEY = "destiny-builder-active-guardian";

function comparableCategory(item: BrowseItem): ComparableCategory | null {
  const category = getCategory(item);
  return (category === "weapon" || category === "armor") && item.itemInstanceId && getSlotHash(item) !== null
    ? category : null;
}

function isComparableForTray(first: BrowseItem, candidate: BrowseItem): boolean {
  const category = comparableCategory(first);
  return category !== null && category === comparableCategory(candidate) &&
    getSlotHash(first) === getSlotHash(candidate) &&
    (category !== "armor" || first.classType == null || candidate.classType == null ||
      first.classType === 3 || candidate.classType === 3 || first.classType === candidate.classType);
}

type CompareEntry = {
  id: string;
  item: BrowseItem | null;
  detail: ItemDetail | null;
  loading: boolean;
  error: string | null;
};

type TransferDestination = { type: "vault" } | { type: "guardian"; characterId: string };
type TransferFeedback = { kind: "success" | "pending"; message: string };
type AwaitingTransfer = { itemId: string; itemName: string; destination: TransferDestination; targetLabel: string };
type VerifiedTransfer = { itemId: string; destination: TransferDestination };
const TRANSFER_VERIFY_DELAYS_MS = [1500, 2500, 4000, 6500, 10000] as const;

function isAtTransferDestination(location: ItemLocation, destination: TransferDestination): boolean {
  return destination.type === "vault"
    ? location.type === "vault"
    : location.characterId === destination.characterId &&
      location.type !== "vault" && location.placement !== "equipped";
}

function isTransferableInFirstPhase(item: BrowseItem): boolean {
  return (item.category === "weapon" || item.category === "armor") &&
    typeof item.itemInstanceId === "string" && /^[1-9]\d{0,24}$/.test(item.itemInstanceId) &&
    item.quantity === 1 &&
    !item.isEquipped && item.location.placement !== "equipped" &&
    item.location.type !== "equipped" &&
    (item.location.type === "vault" || item.location.type === "characterInventory" || item.location.type === "otherGuardian");
}

function canReceiveItem(guardian: Guardian, item: BrowseItem): boolean {
  if (item.category !== "armor" || item.classType === null || item.classType === undefined || item.classType === 3) return true;
  const type = guardian.className.toLowerCase() === "titan" ? 0 : guardian.className.toLowerCase() === "hunter" ? 1 : guardian.className.toLowerCase() === "warlock" ? 2 : -1;
  return item.classType === type;
}

// Bungie itemInstanceId identifies one physical roll across every inventory.
// Normalize string representation before reconciling independent API scopes.
function normalizedInstanceId(value: string | null | undefined): string | null {
  if (!value) return null;
  const id = String(value).trim();
  return /^[0-9]+$/.test(id) ? id.replace(/^0+(?=\d)/, "") : id;
}

type LocatedInstance = { item: DestinyItem; location: ItemLocation };

function collectInstanceLocations(
  itemId: string,
  referenceGuardianId: string,
  guardianClass: string,
  core: CoreResponse,
  account: AccountResponse
): LocatedInstance[] {
  const result: LocatedInstance[] = [];
  const expectedId = normalizedInstanceId(itemId);
  const from = (items: DestinyItem[], fallback: ItemLocation) => {
    for (const item of items) {
      if (normalizedInstanceId(item.itemInstanceId) === expectedId) {
        result.push({ item, location: itemLocation(item, fallback) });
      }
    }
  };
  from(core.inventory ?? [], {
    type: "characterInventory", characterId: referenceGuardianId,
    className: guardianClass, placement: "inventory",
  });
  from(core.equipment ?? [], {
    type: "equipped", characterId: referenceGuardianId,
    className: guardianClass, placement: "equipped",
  });
  from(account.vault ?? [], {
    type: "vault", characterId: null, className: null, placement: "vault",
  });
  from(account.otherGuardianItems ?? [], {
    type: "otherGuardian", characterId: null,
    className: "Other Guardian", placement: "inventory",
  });
  return result;
}

function verifyItemDestination(
  itemId: string,
  destination: TransferDestination,
  referenceGuardianId: string,
  core: CoreResponse,
  account: AccountResponse
): boolean {
  const locations = collectInstanceLocations(itemId, referenceGuardianId, "Guardian", core, account);
  // A positive destination hit is NOT sufficient: the other scope may still
  // report the same physical instance at its old location. Wait until both
  // Bungie reads agree before announcing a verified transfer.
  return locations.length > 0 && locations.every(({ location }) =>
    isAtTransferDestination(location, destination)
  );
}

const SLOT_NAMES: Record<number, string> = {
  1498876634: "Kinetic slot",
  2465295065: "Energy slot",
  953998645: "Power slot",
  3448274439: "Helmet",
  3551918588: "Gauntlets",
  14239492: "Chest armor",
  20886954: "Leg armor",
  1585787867: "Class item",
};

const ARMOR_STAT_ORDER = [2996146975, 392767087, 1943323491, 1735777505, 144602215, 4244567218];

function getSlotHash(item: DestinyItem): number | null {
  return item.equipmentSlotHash ?? item.bucketHash ?? null;
}

function getSlotName(item: DestinyItem): string {
  const hash = getSlotHash(item);
  return hash !== null ? SLOT_NAMES[hash] ?? (item.itemTypeDisplayName || "Other slot") : item.itemTypeDisplayName || "Other";
}

function isArtifact(item: DestinyItem): boolean {
  return item.itemType === 28 || item.itemTypeDisplayName?.toLowerCase().includes("artifact") === true;
}

function getCategory(item: DestinyItem): Exclude<CategoryFilter, "all"> | "other" {
  return isArtifact(item) ? "artifact" : item.category === "weapon" ? "weapon" : item.category === "armor" ? "armor" : "other";
}

function isBrowseable(item: DestinyItem): boolean {
  return getCategory(item) !== "other";
}

function itemLocation(item: DestinyItem, fallback: ItemLocation): ItemLocation {
  return item.location?.type ? item.location : fallback;
}

function sourceName(item: BrowseItem): string {
  if (item.location.type === "vault") return "Vault";
  const owner = item.location.className ?? "Guardian";
  return item.location.placement === "equipped" || item.location.type === "equipped"
    ? `${owner} · Equipped`
    : `${owner} · Inventory`;
}

function itemImage(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return icon.startsWith("/") ? `https://www.bungie.net${icon}` : icon;
}

// The core/account requests can encounter the same expired access token at
// once. Coalesce the refresh to avoid racing Bungie's token rotation.
let sessionRefreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!sessionRefreshPromise) {
    sessionRefreshPromise = fetch("/api/auth/refresh", { method: "POST" })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { sessionRefreshPromise = null; });
  }
  return sessionRefreshPromise;
}

async function getApi<T extends ApiBase>(url: string): Promise<T> {
  let response = await fetch(url, { cache: "no-store" });
  if (response.status === 401) {
    if (await refreshSession()) response = await fetch(url, { cache: "no-store" });
  }
  const data: T | null = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
}

function GearTier({ value }: { value: number | null | undefined }) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    return <span className="text-white/35">Tier —</span>;
  }
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Gear tier ${value} of 5`} title={`Gear tier ${value}`}>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={`h-1.5 w-1.5 rounded-full ${index < value ? "bg-cyan-200" : "bg-white/15"}`} />
      ))}
    </span>
  );
}

function StatRows({ stats }: { stats: ItemStat[] }) {
  if (!stats.length) return <p className="text-xs text-white/35">No detailed stats returned by Bungie.</p>;
  return (
    <div className="space-y-2.5">
      {stats.map((stat) => (
        <div key={stat.statHash} title={stat.description || undefined}>
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-white/55">{stat.name}</span>
            <span className="font-semibold tabular-nums text-white/85">{stat.value}</span>
          </div>
          <div className="h-1 overflow-hidden bg-white/10">
            <div className="h-full bg-cyan-300/75" style={{ width: `${Math.max(0, Math.min(100, stat.value))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PerkRow({ perk }: { perk: { name: string; description: string; icon: string | null; effectTags?: CombatEffect[] } }) {
  return (
    <div className="flex gap-3 border border-white/[0.07] bg-black/20 p-2.5">
      {itemImage(perk.icon) ? (
        <img src={itemImage(perk.icon)!} alt="" className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <div className="h-10 w-10 shrink-0 border border-white/10 bg-white/[0.03]" />
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white/85">{perk.name}</p>
        {perk.description ? <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-white/45">{perk.description}</p> : null}
        {perk.effectTags?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {perk.effectTags.map((effect) => (
              <span key={effect.key} className={`border px-1.5 py-0.5 text-[9px] ${effect.kind === "buff" ? "border-emerald-400/20 text-emerald-200" : effect.kind === "debuff" ? "border-rose-400/20 text-rose-200" : "border-sky-400/20 text-sky-200"}`}>
                {effect.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Inspector({
  item,
  detail,
  loading,
  error,
  onClose,
  onTransfer,
  onOpenWeapon,
  onOpenArmor,
  onToggleCompare,
  inCompare,
  canCompare,
  transferBusy,
  transferBlocked = false,
}: {
  item: BrowseItem | null;
  detail: ItemDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onTransfer: (item: BrowseItem) => void;
  onOpenWeapon: (item: BrowseItem) => void;
  onOpenArmor: (item: BrowseItem) => void;
  onToggleCompare: (item: BrowseItem) => void;
  inCompare: boolean;
  canCompare: boolean;
  transferBusy: boolean;
  transferBlocked?: boolean;
}) {
  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-7 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center border border-cyan-300/15 bg-cyan-300/[0.035] text-3xl text-cyan-200/40">◇</div>
        <p className="text-xs font-bold uppercase tracking-[0.19em] text-white/60">Item Inspector</p>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/35">Select a weapon or armor piece to inspect it and, if eligible, transfer it between the shared Vault and a Guardian.</p>
      </div>
    );
  }

  const stats = (getCategory(item) === "armor" ? detail?.armorStats : detail?.stats) ?? [];
  const sortedStats = getCategory(item) === "armor"
    ? [...stats].sort((a, b) => {
        const aIndex = ARMOR_STAT_ORDER.indexOf(a.statHash);
        const bIndex = ARMOR_STAT_ORDER.indexOf(b.statHash);
        return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex);
      })
    : stats;
  const baseDescription = detail?.description?.trim() || item.description?.trim();
  const selectedPerks = (detail?.selectedPerks ?? []).filter((perk) => {
    const name = perk.name?.trim().toLowerCase() ?? "";
    const category = perk.plugCategoryIdentifier?.toLowerCase() ?? "";
    return name !== "unknown plug" && !name.startsWith("empty ") &&
      !["shader", "ornament", "tracker", "memento", "crafting.recipes.empty_socket"].some((marker) => category.includes(marker));
  });

  return (
    <div className="h-full overflow-y-auto [scrollbar-width:thin]">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#0c1017]/95 px-4 py-3 backdrop-blur-md">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Item inspector</p>
        <button type="button" onClick={onClose} aria-label="Close item inspector" className="border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:text-white">✕</button>
      </div>
      <div className="space-y-5 p-4">
        <div className="flex gap-4">
          {itemImage(item.icon) ? (
            <img src={itemImage(item.icon)!} alt="" className="h-20 w-20 shrink-0 border border-white/10 bg-white/[0.04] object-contain" />
          ) : <div className="h-20 w-20 shrink-0 border border-white/10 bg-white/[0.04]" />}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black leading-tight tracking-wide text-white">{item.name}</h2>
            <p className="mt-1 text-xs text-white/45">{item.itemTypeDisplayName || getSlotName(item)}</p>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-cyan-200/75">{sourceName(item)}</p>
            <div className="mt-2"><GearTier value={detail?.gearTier ?? item.gearTier} /></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-white/10 bg-black/20 p-3">
            <p className="text-[9px] uppercase tracking-[0.15em] text-white/35">Power</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-100">{detail?.power ?? item.power ?? "—"}</p>
          </div>
          <div className="border border-white/10 bg-black/20 p-3">
            <p className="text-[9px] uppercase tracking-[0.15em] text-white/35">Slot</p>
            <p className="mt-2 text-xs font-semibold text-white/80">{getSlotName(item)}</p>
          </div>
        </div>
        {getCategory(item) === "weapon" && (
          <button
            type="button"
            onClick={() => onOpenWeapon(item)}
            className="w-full border border-violet-300/35 bg-violet-300/[0.08] px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-violet-100 transition hover:border-violet-300/60 hover:bg-violet-300/[0.14]"
          >
            Open Weapon Details →
          </button>
        )}
        {getCategory(item) === "armor" && (
          <button type="button" onClick={() => onOpenArmor(item)} className="w-full border border-violet-300/35 bg-violet-300/[0.08] px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-violet-100 transition hover:border-violet-300/60 hover:bg-violet-300/[0.14]">
            Open Armor Details →
          </button>
        )}
        {comparableCategory(item) && (
          <button type="button" onClick={() => onToggleCompare(item)} disabled={!canCompare && !inCompare}
            className={`w-full border px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] ${inCompare ? "border-cyan-200/45 bg-cyan-200/[0.13] text-cyan-50" : "border-violet-200/30 bg-violet-200/[0.05] text-violet-100 hover:border-violet-200/50"} disabled:cursor-not-allowed disabled:opacity-30`}>
            {inCompare ? "✓ In Compare Tray · Remove" : "+ Add to Compare Tray"}
          </button>
        )}
        {(getCategory(item) === "weapon" || getCategory(item) === "armor") && (
          <div className="space-y-2">
            <button
              type="button"
              disabled={!isTransferableInFirstPhase(item) || transferBusy || transferBlocked}
              onClick={() => onTransfer(item)}
              className="w-full border border-cyan-200/40 bg-cyan-200/[0.1] px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100 transition hover:bg-cyan-200/[0.17] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.02] disabled:text-white/30"
            >
              {item.location.type === "vault" ? "Transfer to Guardian →" : "Transfer to Vault →"}
            </button>
            {transferBlocked && (
              <p className="text-[11px] leading-relaxed text-amber-100/65">Bungie reports two locations for this same instance. Wait for the inventory to synchronize before transferring it again.</p>
            )}
            {!isTransferableInFirstPhase(item) && (
              <p className="text-[11px] leading-relaxed text-amber-100/65">{item.isEquipped || item.location.placement === "equipped" || item.location.type === "equipped" ? "Unequip this item in Destiny before transferring it." : "Only non-equipped, individually instanced weapons and armor are transferable in this first phase."}</p>
            )}
          </div>
        )}
        {baseDescription ? <p className="whitespace-pre-line text-xs leading-6 text-white/55">{baseDescription}</p> : null}
        {loading && <div className="flex items-center gap-3 border border-white/10 p-3 text-xs text-white/50"><span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/20 border-t-cyan-200" />Loading Bungie item details…</div>}
        {error && <p className="border border-amber-400/20 bg-amber-400/[0.05] p-3 text-xs text-amber-200">{error}</p>}
        {!detail && !loading && !error && <p className="text-xs text-white/35">Detailed sockets and stats are unavailable for this item.</p>}
        {detail && (
          <>
            <section className="border-t border-white/10 pt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">Stats</h3>
                {getCategory(item) === "armor" && typeof detail.armorStatTotal === "number" && <span className="text-xs font-bold text-cyan-100">Total {detail.armorStatTotal}</span>}
              </div>
              <StatRows stats={sortedStats} />
              {typeof detail.recoilDirection === "number" && getCategory(item) === "weapon" && (
                <p className="mt-3 text-[11px] text-white/40">Recoil direction: <span className="font-semibold text-white/75">{detail.recoilDirection}</span></p>
              )}
            </section>
            {selectedPerks.length > 0 && (
              <section className="border-t border-white/10 pt-4">
                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">Selected Destiny perks</h3>
                <div className="space-y-2">{selectedPerks.map((perk) => <PerkRow key={`${perk.socketIndex}:${perk.plugHash}`} perk={perk} />)}</div>
              </section>
            )}
            {detail.intrinsicPerks?.length > 0 && (
              <section className="border-t border-white/10 pt-4">
                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">Intrinsic perks</h3>
                <div className="space-y-2">{detail.intrinsicPerks.map((perk) => <PerkRow key={perk.perkHash} perk={perk} />)}</div>
              </section>
            )}
            {detail.itemSet?.perks?.length ? (
              <section className="border-t border-white/10 pt-4">
                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">{detail.itemSet.name}</h3>
                <div className="space-y-2">{detail.itemSet.perks.map((perk, index) => <PerkRow key={`${perk.requiredSetCount}:${index}`} perk={{ ...perk, name: `${perk.requiredSetCount} pieces · ${perk.name}` }} />)}</div>
              </section>
            ) : null}
          </>
        )}
        <div className="border-t border-white/10 pt-4">
          <p className="text-[10px] leading-relaxed text-white/30">Item stats and perks are read from Bungie. Transfers are real account actions; socket, mod and perk changes are not enabled yet.</p>
        </div>
      </div>
    </div>
  );
}

// Full weapon inspection is a local preview. Never call Bungie's transfer or
// socket write endpoints from this component. The selected roll remains intact.
function meaningfulWeaponPerk(perk: Perk | null | undefined): perk is Perk {
  if (!perk || !perk.name?.trim()) return false;
  const name = perk.name.trim().toLowerCase();
  const category = (perk.plugCategoryIdentifier ?? "").toLowerCase();
  return name !== "unknown plug" && name !== "empty" && !name.startsWith("empty ") &&
    !["empty_socket", "empty.socket", "shader", "ornament", "skin", "tracker", "kill_tracker", "memento", "crafting.recipes.empty_socket"].some((marker) => category.includes(marker));
}

function labelWeaponSocket(column: WeaponPerkColumn): string {
  const perk = column.selected ?? column.rolled[0] ?? column.possible[0] ?? null;
  const identity = `${perk?.type ?? ""} ${perk?.plugCategoryIdentifier ?? ""}`.toLowerCase();
  if (identity.includes("barrel") || identity.includes("scope") || identity.includes("sight")) return "Barrel / Sight";
  if (identity.includes("magazine") || identity.includes("battery") || identity.includes("arrow")) return "Magazine / Battery";
  if (identity.includes("origin")) return "Origin Trait";
  if (identity.includes("intrinsic") || identity.includes("frame")) return "Intrinsic / Frame";
  if (identity.includes("masterwork") || /\bmasterwork\b/i.test(perk?.name ?? "")) return "Masterwork";
  if (identity.includes("mod")) return "Weapon Mod";
  if (identity.includes("trait") || identity.includes("perk")) return "Weapon Trait";
  return `Socket ${column.socketIndex + 1}`;
}

const DAMAGE_TYPE_NAMES: Record<number, string> = {
  1: "Kinetic", 2: "Arc", 3: "Solar", 4: "Void", 5: "Raid", 6: "Stasis", 7: "Strand",
};

type WeaponSocketChoice = {
  key: string;
  label: string;
  perk: Perk;
  variants: Perk[];
  manifestOnly: boolean;
};

function isMasterworkSocket(column: WeaponPerkColumn): boolean {
  return labelWeaponSocket(column) === "Masterwork" ||
    [...column.all, ...column.rolled, ...column.possible, ...(column.selected ? [column.selected] : [])].some(
      (perk) => /masterwork/i.test(`${perk.plugCategoryIdentifier ?? ""} ${perk.type ?? ""} ${perk.name ?? ""}`)
    );
}

// The tier is read only from explicit Bungie perk metadata/text. It is never
// synthesized from the item's unrelated 1–5 Gear Tier stat.
function masterworkStage(perk: Perk | null | undefined): number | null {
  if (!perk) return null;
  const sources = [perk.name, perk.plugCategoryIdentifier ?? ""];
  for (const value of sources) {
    const match = value.match(/(?:^|[^a-z])(?:tier|level|lvl|rank|stage)[\s._:\-]*0?(\d{1,2})(?!\d)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

const MASTERWORK_STATS = [
  "Reload Speed", "Blast Radius", "Charge Time", "Draw Time", "Airborne Effectiveness",
  "Aim Assistance", "Shield Duration", "Projectile Speed", "Handling", "Stability",
  "Range", "Velocity", "Impact", "Accuracy", "Magazine", "Recoil Direction",
];

function masterworkStatLabel(perk: Perk): string {
  const original = perk.name.trim();
  const lower = original.toLowerCase();
  const stat = MASTERWORK_STATS.find((name) => lower.includes(name.toLowerCase()));
  if (stat) return stat;
  // Some Bungie stages carry a generic display name but encode the upgraded
  // stat in the plug category (for example masterwork.reload_speed.tier5).
  const identifier = (perk.plugCategoryIdentifier ?? "").toLowerCase().replace(/[._-]+/g, " ");
  const categoryStat = MASTERWORK_STATS.find((name) => identifier.includes(name.toLowerCase()));
  if (categoryStat) return categoryStat;
  // The manifest can name the same stat at multiple upgrade stages. Collapse
  // only *explicit* stage/masterwork wording; preserve unfamiliar names.
  const cleaned = original
    .replace(/\b(?:tier|level|lvl|rank|stage)\s*[.:#\-]*\s*\d{1,2}\b/gi, "")
    .replace(/\b(?:masterwork|masterworked)\b/gi, "")
    .replace(/[\s:·—–()\-]+/g, " ")
    .trim();
  return cleaned || original;
}

function socketPerks(column: WeaponPerkColumn): Perk[] {
  const seen = new Set<number>();
  return [...(column.selected ? [column.selected] : []), ...column.rolled, ...column.all, ...column.possible]
    .filter(meaningfulWeaponPerk)
    .filter((perk) => {
      if (seen.has(perk.plugHash)) return false;
      seen.add(perk.plugHash);
      return true;
    });
}

function onThisWeaponRoll(column: WeaponPerkColumn, perk: Perk): boolean {
  return column.selected?.plugHash === perk.plugHash ||
    column.rolled.some((rolled) => rolled.plugHash === perk.plugHash);
}

function socketChoices(column: WeaponPerkColumn, showManifest: boolean, previewHash?: number): WeaponSocketChoice[] {
  const candidates = socketPerks(column).filter((perk) =>
    showManifest || onThisWeaponRoll(column, perk) || previewHash === perk.plugHash
  );
  if (!isMasterworkSocket(column)) {
    return candidates.map((perk) => ({
      key: String(perk.plugHash), label: perk.name, perk, variants: [perk],
      manifestOnly: !onThisWeaponRoll(column, perk),
    }));
  }

  const groups = new Map<string, Perk[]>();
  for (const perk of candidates) {
    const label = masterworkStatLabel(perk);
    const group = groups.get(label) ?? [];
    group.push(perk);
    groups.set(label, group);
  }

  const active = candidates.find((perk) => perk.plugHash === previewHash) ?? column.selected;
  const activeTier = masterworkStage(active);
  return [...groups.entries()].map(([label, variants]) => {
    // Prefer the currently inspected stat/stage, then preserve the actual
    // equipped masterwork tier if an alternative stat has that same tier.
    const ranked = [...variants].sort((a, b) => {
      const score = (perk: Perk) => {
        if (perk.plugHash === previewHash) return -1000;
        if (perk.plugHash === column.selected?.plugHash) return -900;
        const isRoll = onThisWeaponRoll(column, perk);
        const tier = masterworkStage(perk);
        const stagePenalty = activeTier !== null && tier !== null ? Math.abs(tier - activeTier) * 10 : activeTier !== null ? 200 : 0;
        return stagePenalty + (isRoll ? 0 : 100);
      };
      return score(a) - score(b);
    });
    const perk = ranked[0];
    return {
      key: label, label, perk, variants,
      manifestOnly: variants.every((candidate) => !onThisWeaponRoll(column, candidate)),
    };
  });
}

function PerkOrb({ perk, selected, theory = false, size = "md" }: {
  perk: Perk | null;
  selected: boolean;
  theory?: boolean;
  size?: "md" | "lg";
}) {
  const width = size === "lg" ? "h-[66px] w-[66px]" : "h-12 w-12";
  return (
    <span className={`relative flex ${width} shrink-0 items-center justify-center rounded-full border-[2px] bg-[#101a2c] p-1 transition ${selected ? "border-cyan-200 shadow-[0_0_0_3px_rgba(80,180,230,0.13),0_0_24px_rgba(70,166,227,0.14)]" : theory ? "border-amber-200/35" : "border-sky-200/35 group-hover:border-sky-100/70"}`}>
      {itemImage(perk?.icon) ? <img src={itemImage(perk?.icon)!} alt="" className="h-full w-full rounded-full object-contain" /> : <span className="text-[11px] font-black uppercase tracking-wide text-cyan-100/55">{perk?.name?.trim().slice(0, 2) || "◇"}</span>}
      <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-[2px] border-[#101724] ${theory ? "bg-amber-300/75" : selected ? "bg-cyan-200" : "bg-sky-500"}`} />
    </span>
  );
}
function WeaponDetails({
  item,
  detail,
  loading,
  error,
  onClose,
}: {
  item: BrowseItem;
  detail: ItemDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [inspected, setInspected] = useState<Perk | null>(null);
  const [showManifest, setShowManifest] = useState(false);
  const [openSocket, setOpenSocket] = useState<number | null>(null);

  const columns = (detail?.perkColumns ?? [])
    .map((column) => ({
      ...column,
      selected: meaningfulWeaponPerk(column.selected) ? column.selected : null,
      rolled: (column.rolled ?? []).filter(meaningfulWeaponPerk),
      possible: (column.possible ?? []).filter(meaningfulWeaponPerk),
      all: (column.all ?? []).filter(meaningfulWeaponPerk),
    }))
    .filter((column) => column.selected || column.rolled.length || column.possible.length);

  const effectivePerks = columns.map((column) => {
    const overrideHash = overrides[String(column.socketIndex)];
    const active = overrideHash === undefined ? column.selected :
      socketPerks(column).find((candidate) => candidate.plugHash === overrideHash) ?? column.selected;
    return active ? { ...active, socketIndex: column.socketIndex } : null;
  }).filter((perk): perk is Perk => perk !== null);
  const previewCount = columns.filter((column) =>
    overrides[String(column.socketIndex)] !== undefined &&
    overrides[String(column.socketIndex)] !== column.selected?.plugHash
  ).length;
  const hasManifestPreview = columns.some((column) => {
    const override = overrides[String(column.socketIndex)];
    return override !== undefined && override !== column.selected?.plugHash &&
      !column.rolled.some((perk) => perk.plugHash === override);
  });
  const effects = Array.from(new Map(
    effectivePerks.flatMap((perk) => (perk.effectTags ?? []).map((effect) => [effect.key, effect] as const))
  ).values());

  function previewPerk(column: WeaponPerkColumn, perk: Perk) {
    setInspected(perk);
    setOverrides((current) => {
      const next = { ...current };
      if (column.selected?.plugHash === perk.plugHash) delete next[String(column.socketIndex)];
      else next[String(column.socketIndex)] = perk.plugHash;
      return next;
    });
  }

  const activeColumn = columns.find((column) => column.socketIndex === openSocket) ?? null;
  const activeChoices = activeColumn ? socketChoices(activeColumn, showManifest, overrides[String(activeColumn.socketIndex)]) : [];
  const focusedPerk = inspected ?? (activeColumn ? effectivePerks.find((perk) => perk.socketIndex === activeColumn.socketIndex) : null) ?? effectivePerks[0] ?? null;
  const focusColumn = focusedPerk ? columns.find((column) => column.socketIndex === focusedPerk.socketIndex) ?? null : null;
  const focusManifest = focusedPerk && focusColumn ? !onThisWeaponRoll(focusColumn, focusedPerk) : false;
  const focusPreview = focusedPerk && focusColumn ? (overrides[String(focusColumn.socketIndex)] ?? focusColumn.selected?.plugHash) === focusedPerk.plugHash : false;
  const focusStages = focusedPerk && focusColumn && isMasterworkSocket(focusColumn) ?
    socketPerks(focusColumn)
      .filter((perk) => masterworkStatLabel(perk) === masterworkStatLabel(focusedPerk))
      .filter((perk) => showManifest || onThisWeaponRoll(focusColumn, perk) || overrides[String(focusColumn.socketIndex)] === perk.plugHash)
      .map((perk) => ({ perk, tier: masterworkStage(perk) }))
      .filter((entry): entry is { perk: Perk; tier: number } => entry.tier !== null)
    : [];
  const distinctFocusStages = focusStages.filter((entry, index, all) => all.findIndex((candidate) => candidate.tier === entry.tier) === index)
    .sort((a, b) => a.tier - b.tier);
  const description = detail?.description?.trim() || item.description?.trim();
  const stats = detail?.stats ?? item.stats ?? [];

  return (
    <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/85 p-0 backdrop-blur-md sm:p-4" role="presentation" onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="weapon-details-title" className="flex h-full w-full max-w-[1480px] flex-col overflow-hidden border border-cyan-300/20 bg-[#090c13] shadow-2xl sm:h-[min(94vh,950px)]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0d1019] px-4 py-3 sm:px-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200/65">Destiny Builder · Weapon Inspector 2.1</p>
            <p className="mt-1 text-xs text-white/40">Bungie item detail · Local perk preview · No socket writes</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close weapon details" className="shrink-0 border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white/65 hover:border-cyan-300/40 hover:text-white">Close ✕</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
          <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
            <section className="relative overflow-hidden border border-white/10 bg-[linear-gradient(115deg,#161529_0%,#0e1420_54%,#0b111a_100%)] p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-5">
                {itemImage(item.icon) ? <img src={itemImage(item.icon)!} alt="" className="h-20 w-20 shrink-0 border border-white/20 bg-black/20 object-contain sm:h-24 sm:w-24" /> : <div className="h-20 w-20 border border-white/20 bg-black/20" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">{item.itemTypeDisplayName ?? "Weapon"} · {getSlotName(item)}</p>
                  <h2 id="weapon-details-title" className="mt-1 text-2xl font-black uppercase tracking-[0.04em] text-white sm:text-3xl">{detail?.name || item.name}</h2>
                  <p className="mt-2 text-xs text-cyan-100/65">{sourceName(item)} <span className="mx-2 text-white/20">·</span> {item.tierTypeName ?? "Weapon"}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3"><GearTier value={detail?.gearTier ?? item.gearTier} /><span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Gear Tier</span></div>
                </div>
                <div className="border-l border-white/15 pl-5 text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-100/50">Power</p>
                  <p className="mt-1 text-3xl font-black tabular-nums text-amber-100">{detail?.power ?? item.power ?? "—"}</p>
                  {typeof (detail?.damageType ?? item.damageType) === "number" && (detail?.damageType ?? item.damageType) !== 0 && (
                    <p className="mt-2 text-xs text-white/55">{DAMAGE_TYPE_NAMES[(detail?.damageType ?? item.damageType)!] ?? `Damage type ${(detail?.damageType ?? item.damageType)!}`}</p>
                  )}
                </div>
              </div>
              {description && <p className="mt-5 whitespace-pre-line border-t border-white/10 pt-4 text-xs leading-relaxed text-white/50">{description}</p>}
            </section>

            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
              <div className="min-w-0 space-y-4">
                <section className="border border-white/10 bg-[#0e121b] p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-[0.15em] text-white/85">Weapon Perks</h3>
                      <p className="mt-1 text-xs text-white/40">Select a blue socket to view its options. Hover or focus an icon to inspect its Bungie description.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${previewCount ? "border-cyan-300/40 text-cyan-100" : "border-white/10 text-white/35"}`}>{previewCount ? `${previewCount} preview change${previewCount === 1 ? "" : "s"}` : "Destiny roll"}</span>
                      {previewCount > 0 && <button type="button" onClick={() => { setOverrides({}); setInspected(null); }} className="border border-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/65 hover:text-white">Reset preview</button>}
                    </div>
                  </div>
                  <p className="mb-5 border-l-2 border-cyan-300/40 bg-cyan-300/[0.04] px-3 py-2 text-[11px] leading-relaxed text-cyan-100/65">All choices below are preview-only. Blue indicators mark perk sockets/roll choices; amber marks Manifest-only theory, not proven available on this copy.{hasManifestPreview ? " Your preview currently includes theoretical perks." : ""}</p>
                  {loading && <p className="flex items-center gap-2 text-xs text-white/45"><span className="h-3 w-3 animate-spin rounded-full border border-white/10 border-t-cyan-200" />Loading Bungie weapon sockets…</p>}
                  {error && <p role="alert" className="border border-amber-300/25 bg-amber-300/[0.045] px-3 py-2 text-xs text-amber-100">{error}</p>}
                  {!loading && !error && !columns.length && <p className="border border-dashed border-white/10 px-4 py-8 text-center text-xs text-white/40">Bungie did not provide selectable socket columns for this weapon.</p>}

                  <div className="flex flex-wrap items-start gap-x-2 gap-y-5 sm:gap-x-3">
                    {columns.map((column) => {
                      const active = effectivePerks.find((perk) => perk.socketIndex === column.socketIndex) ?? column.selected;
                      const selectedPreview = overrides[String(column.socketIndex)] !== undefined && overrides[String(column.socketIndex)] !== column.selected?.plugHash;
                      const isOpen = openSocket === column.socketIndex;
                      const actualChoices = socketChoices(column, false);
                      return (
                        <button type="button" key={column.socketIndex} aria-expanded={isOpen} aria-label={`${labelWeaponSocket(column)}. ${active?.name ?? "No selected perk"}. View perk options`} onClick={() => { setOpenSocket(isOpen ? null : column.socketIndex); if (active) setInspected(active); }} onMouseEnter={() => { if (active) setInspected(active); }} onFocus={() => { if (active) setInspected(active); }} className={`group flex w-[88px] shrink-0 flex-col items-center px-1 py-2 text-center transition sm:w-[104px] ${isOpen ? "bg-cyan-200/[0.06] ring-1 ring-cyan-200/35" : "hover:bg-white/[0.035]"}`}>
                          <PerkOrb perk={active} selected={isOpen || selectedPreview} theory={active ? !onThisWeaponRoll(column, active) : false} size="lg" />
                          <span className="mt-2 min-h-[26px] text-[10px] font-bold uppercase leading-snug tracking-[0.08em] text-white/65">{labelWeaponSocket(column)}</span>
                          <span className="mt-0.5 max-w-full truncate text-[10px] text-cyan-100/60">{active && isMasterworkSocket(column) ? masterworkStatLabel(active) : active?.name ?? "Empty"}</span>
                          <span className="mt-2 flex h-2 items-center gap-1" aria-hidden="true">
                            {Array.from({ length: Math.max(1, Math.min(5, actualChoices.length)) }, (_, index) => <span key={index} className={`h-[5px] w-[5px] rounded-full ${actualChoices.length ? "bg-sky-400/70" : "bg-white/15"}`} />)}
                            {actualChoices.length > 5 && <span className="text-[9px] text-sky-200/50">+</span>}
                          </span>
                          {selectedPreview && <span className="mt-1 text-[9px] font-bold uppercase tracking-wide text-cyan-200/75">Preview</span>}
                        </button>
                      );
                    })}
                  </div>

                  {activeColumn && (
                    <div className="mt-5 border-t border-cyan-200/15 bg-[#101827] px-3 pb-4 pt-3 sm:px-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-200/55">Socket {activeColumn.socketIndex + 1}</p>
                          <h4 className="mt-1 text-xs font-bold uppercase tracking-wider text-white/80">{labelWeaponSocket(activeColumn)} · Available choices</h4>
                        </div>
                        <button type="button" onClick={() => setOpenSocket(null)} aria-label="Close socket choices" className="border border-white/10 px-2.5 py-1 text-xs text-white/50 hover:text-white">✕</button>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-4">
                        {activeChoices.map((choice) => {
                          const isEquipped = choice.variants.some((perk) => perk.plugHash === activeColumn.selected?.plugHash);
                          const isPreview = choice.variants.some((perk) => perk.plugHash === (overrides[String(activeColumn.socketIndex)] ?? activeColumn.selected?.plugHash));
                          return (
                            <button type="button" key={choice.key} aria-pressed={isPreview} onMouseEnter={() => setInspected(choice.perk)} onFocus={() => setInspected(choice.perk)} onClick={() => previewPerk(activeColumn, choice.perk)} title={choice.perk.description || choice.label} className={`group flex w-[98px] shrink-0 flex-col items-center px-1.5 py-2 text-center transition ${isPreview ? "bg-cyan-200/[0.06] ring-1 ring-cyan-200/25" : "hover:bg-white/[0.04]"}`}>
                              <PerkOrb perk={choice.perk} selected={isPreview} theory={choice.manifestOnly} />
                              <span className="mt-2 line-clamp-2 min-h-[28px] text-[11px] font-semibold leading-snug text-white/75">{choice.label}</span>
                              <span className={`mt-1 text-[9px] font-bold uppercase leading-tight ${choice.manifestOnly ? "text-amber-200/70" : isEquipped ? "text-cyan-200/60" : "text-sky-200/45"}`}>{choice.manifestOnly ? "Theory" : isEquipped ? "Destiny" : "On roll"}</span>
                            </button>
                          );
                        })}
                        {!activeChoices.length && <p className="py-2 text-xs text-white/40">No choices in this category. You can show Manifest possibilities below.</p>}
                      </div>
                      {isMasterworkSocket(activeColumn) && <p className="mt-3 text-[10px] text-white/35">Masterwork choices are grouped by stat rather than by upgrade tier. Known tier variants remain accessible in the Perk Inspector.</p>}
                    </div>
                  )}
                  {columns.some((column) => column.possible.length > 0) && (
                    <button type="button" onClick={() => setShowManifest((current) => !current)} className="mt-4 w-full border border-white/10 px-3 py-2.5 text-xs font-semibold text-white/60 hover:border-cyan-300/30 hover:text-white">
                      {showManifest ? "Hide Manifest-only possibilities" : "Show Manifest-only possibilities (theory)"}
                    </button>
                  )}
                </section>
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="border border-white/10 bg-[#0e121b] p-4 sm:p-5">
                    <h3 className="mb-4 text-xs font-black uppercase tracking-[0.15em] text-white/75">Weapon Stats</h3>
                    {!loading && <StatRows stats={stats} />}
                    {loading && <p className="text-xs text-white/40">Reading current stats…</p>}
                    {previewCount > 0 && <p className="mt-4 text-[11px] leading-relaxed text-amber-100/65">These are the real stats returned by Bungie for the current roll. Previewing alternate perks does not recalculate stat values.</p>}
                    {typeof detail?.recoilDirection === "number" && <div className="mt-4 border-t border-white/10 pt-3 text-xs text-white/50">Recoil Direction <span className="float-right font-bold tabular-nums text-white/85">{detail.recoilDirection}</span></div>}
                  </section>
                  <section className="border border-white/10 bg-[#0e121b] p-4 sm:p-5">
                    <h3 className="mb-4 text-xs font-black uppercase tracking-[0.15em] text-white/75">Intrinsic Perks</h3>
                    {detail?.intrinsicPerks?.length ? detail.intrinsicPerks.map((perk) => <PerkRow key={perk.perkHash} perk={perk} />) : <p className="text-xs text-white/35">No intrinsic perk data available.</p>}
                  </section>
                </div>
              </div>
              <aside className="order-first min-w-0 space-y-4 xl:order-last xl:sticky xl:top-4 xl:self-start">
                <section className="relative overflow-hidden border border-cyan-200/30 bg-[linear-gradient(165deg,#14243a_0%,#101926_42%,#0c121d_100%)] p-4 shadow-[inset_0_1px_0_rgba(180,233,255,0.04)] sm:p-5">
                  <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-cyan-200/75 via-sky-400/35 to-transparent" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-black uppercase tracking-[0.15em] text-cyan-100/90">Perk Inspector</h3>
                    <span className="text-[9px] uppercase tracking-[0.14em] text-white/35">Hover to inspect · Click to preview</span>
                  </div>
                  {focusedPerk ? (
                    <div className="mt-5">
                      <div className="flex items-center gap-4">
                        <PerkOrb perk={focusedPerk} selected={Boolean(focusPreview)} theory={Boolean(focusManifest)} size="lg" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-200/55">{focusColumn ? labelWeaponSocket(focusColumn) : `Socket ${focusedPerk.socketIndex + 1}`}</p>
                          <h4 className="mt-1 text-xl font-black leading-tight text-white">{focusColumn && isMasterworkSocket(focusColumn) ? masterworkStatLabel(focusedPerk) : focusedPerk.name}</h4>
                          <p className={`mt-1.5 text-[10px] font-bold uppercase tracking-wider ${focusManifest ? "text-amber-100/70" : focusPreview ? "text-cyan-100/70" : "text-sky-200/55"}`}>{focusManifest ? "Manifest only · theory" : focusedPerk.plugHash === focusColumn?.selected?.plugHash ? "Selected in Destiny" : "On this roll"}{focusPreview && focusedPerk.plugHash !== focusColumn?.selected?.plugHash ? " · Local preview" : ""}</p>
                        </div>
                      </div>
                      {focusColumn && isMasterworkSocket(focusColumn) && masterworkStage(focusedPerk) !== null && <p className="mt-4 border-t border-white/10 pt-3 text-xs text-white/55">Masterwork tier <span className="ml-2 font-bold tabular-nums text-white/80">{masterworkStage(focusedPerk)}</span> <span className="ml-2 text-[10px] text-white/30">from Bungie perk data</span></p>}
                      {focusedPerk.description ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-white/70">{focusedPerk.description}</p> : <p className="mt-4 text-sm text-white/35">No Bungie description is available for this perk.</p>}
                      {distinctFocusStages.length > 1 && focusColumn && <div className="mt-4 border-t border-white/10 pt-3">
                        <label htmlFor="weapon-masterwork-tier" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.13em] text-white/45">Preview masterwork tier</label>
                        <select id="weapon-masterwork-tier" value={masterworkStage(focusedPerk) ?? ""} onChange={(event: ChangeEvent<HTMLSelectElement>) => { const stage = distinctFocusStages.find((entry) => entry.tier === Number(event.target.value)); if (stage) previewPerk(focusColumn, stage.perk); }} className="w-full border border-white/20 bg-[#141d2d] px-3 py-2 text-sm text-white/80">
                          {distinctFocusStages.map(({ tier }) => <option key={tier} value={tier}>Tier {tier}</option>)}
                        </select>
                        <p className="mt-2 text-[10px] leading-relaxed text-white/35">Only levels returned by Bungie are offered. This is a local preview; it does not upgrade your weapon.</p>
                      </div>}
                      {focusedPerk.effectTags?.length ? <div className="mt-4 flex flex-wrap gap-1.5">{focusedPerk.effectTags.map((effect) => <span key={effect.key} className={`border px-2 py-1 text-[10px] ${effect.kind === "buff" ? "border-emerald-300/25 text-emerald-200" : effect.kind === "debuff" ? "border-rose-300/25 text-rose-200" : "border-sky-300/25 text-sky-200"}`}>{effect.label}</span>)}</div> : null}
                    </div>
                  ) : <p className="mt-5 text-sm leading-6 text-white/40">Choose a socket on the weapon. The description of each perk you hover or focus will appear here, like an in-game inspection panel.</p>}
                </section>
                <section className="border border-white/10 bg-[#111521] p-4 sm:p-5">
                  <h3 className="text-xs font-black uppercase tracking-[0.15em] text-white/75">Effective Preview Perks</h3>
                  {effectivePerks.length > 0 ? <div className="mt-3 space-y-2">{effectivePerks.map((perk) => <div key={`${perk.socketIndex}:${perk.plugHash}`} className="flex items-center gap-2 text-[11px] text-white/65">{itemImage(perk.icon) ? <img src={itemImage(perk.icon)!} alt="" className="h-7 w-7 shrink-0 object-contain" /> : <div className="h-7 w-7 bg-white/5" />}<span className="min-w-0 flex-1 truncate">{perk.name}</span></div>)}</div> : <p className="mt-3 text-xs text-white/35">No selected perk data available.</p>}
                </section>
                <section className="border border-white/10 bg-[#111521] p-4 sm:p-5">
                  <h3 className="text-xs font-black uppercase tracking-[0.15em] text-white/75">Combat Effects</h3>
                  <p className="mt-2 text-[10px] leading-relaxed text-white/35">Derived from Bungie perk descriptions. Not official Bungie classifications.</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">{effects.length ? effects.map((effect) => <span key={effect.key} className={`border px-2 py-1 text-[10px] ${effect.kind === "buff" ? "border-emerald-300/25 text-emerald-200" : effect.kind === "debuff" ? "border-rose-300/25 text-rose-200" : "border-sky-300/25 text-sky-200"}`}>{effect.label}</span>) : <p className="text-xs text-white/35">No combat effects recognized in this perk selection.</p>}</div>
                </section>
                {detail?.itemSet?.perks?.length ? (
                  <section className="border border-white/10 bg-[#111521] p-4 sm:p-5">
                    <h3 className="mb-3 text-xs font-black uppercase tracking-[0.15em] text-white/75">{detail.itemSet.name || "Item Set"}</h3>
                    <div className="space-y-2">{detail.itemSet.perks.map((perk, index) => <PerkRow key={`${perk.requiredSetCount}:${index}`} perk={{ ...perk, name: `${perk.requiredSetCount} pieces · ${perk.name}` }} />)}</div>
                  </section>
                ) : null}
                <section className="border border-white/10 bg-[#111521] p-4 sm:p-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/45">Item Identity</p>
                  <p className="mt-2 break-all text-[11px] tabular-nums text-white/60">Instance {item.itemInstanceId ?? "—"}</p>
                  <p className="mt-1 break-all text-[11px] text-white/35">Hash {item.itemHash}</p>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Armor Inspector uses the same compact socket interactions as Weapon Inspector.
// This screen is an ephemeral preview: none of its socket choices call Bungie write APIs.
type ArmorSocketSection = "mods" | "appearance" | "other";

type ArmorSocketColumn = WeaponPerkColumn & { section: ArmorSocketSection; label: string };

function armorPerkIsVisible(perk: Perk | null | undefined): perk is Perk {
  if (!perk || !perk.name?.trim()) return false;
  const name = perk.name.toLowerCase().trim();
  const category = (perk.plugCategoryIdentifier ?? "").toLowerCase();
  return name !== "unknown plug" && name !== "empty" &&
    !name.startsWith("empty ") &&
    !category.includes("empty_socket") && !category.includes("empty.socket") &&
    !category.includes("tracker") && !category.includes("memento");
}

function armorColumnKind(column: WeaponPerkColumn): ArmorSocketSection {
  const sample = [column.selected, ...column.rolled, ...column.possible].filter(armorPerkIsVisible);
  const meta = sample.map((perk) => `${perk.plugCategoryIdentifier ?? ""} ${perk.type ?? ""}`).join(" ").toLowerCase();
  const names = sample.map((perk) => perk.name).join(" ").toLowerCase();
  if (/shader|ornament|cosmetic|transmog|skin|appearance/.test(meta) || /shader|ornament/.test(names)) return "appearance";
  if (/mod|armor\.v|armor\.2|armor\.3|armor\.4/.test(meta) || /mod\b/.test(names)) return "mods";
  return "other";
}

function armorColumnLabel(column: WeaponPerkColumn): string {
  const sample = [column.selected, ...column.rolled, ...column.possible].filter(armorPerkIsVisible);
  const meta = sample.map((perk) => `${perk.plugCategoryIdentifier ?? ""} ${perk.type ?? ""}`).join(" ").toLowerCase();
  const names = sample.map((perk) => perk.name).join(" ").toLowerCase();
  if (meta.includes("shader") || names.includes("shader")) return "Shader";
  if (/ornament|skin|transmog/.test(meta) || names.includes("ornament")) return "Ornament";
  if (meta.includes("intrinsic") || meta.includes("exotic")) return "Intrinsic";
  if (meta.includes("artifice")) return "Artifice Slot";
  if (meta.includes("masterwork") || meta.includes("upgrade")) return "Upgrade";
  if (meta.includes("combat") || meta.includes("artifact")) return "Combat Mod";
  if (meta.includes("stat")) return "Stat Mod";
  if (meta.includes("mod") || names.includes("mod")) return "Armor Mod";
  return `Socket ${column.socketIndex + 1}`;
}

function normalizeArmorColumn(column: WeaponPerkColumn): ArmorSocketColumn {
  const selected = armorPerkIsVisible(column.selected) ? column.selected : null;
  const rolled = (column.rolled ?? []).filter(armorPerkIsVisible);
  const possible = (column.possible ?? []).filter(armorPerkIsVisible);
  const all = [...(selected ? [selected] : []), ...rolled, ...possible].filter(
    (perk, index, entries) => entries.findIndex((entry) => entry.plugHash === perk.plugHash) === index
  );
  const result = { ...column, selected, rolled, possible, all };
  return { ...result, section: armorColumnKind(result), label: armorColumnLabel(result) };
}

function armorOnThisItem(column: WeaponPerkColumn, perk: Perk): boolean {
  return column.selected?.plugHash === perk.plugHash ||
    column.rolled.some((candidate) => candidate.plugHash === perk.plugHash);
}

function armorSocketOptions(column: ArmorSocketColumn, manifestVisible: boolean, previewHash?: number): Perk[] {
  return column.all.filter((perk) =>
    manifestVisible || armorOnThisItem(column, perk) || previewHash === perk.plugHash
  );
}

function ArmorDetails({
  item,
  detail,
  loading,
  error,
  onClose,
}: {
  item: BrowseItem;
  detail: ItemDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [openSocket, setOpenSocket] = useState<number | null>(null);
  const [inspected, setInspected] = useState<Perk | null>(null);
  const [showManifest, setShowManifest] = useState(false);

  const columns = (detail?.perkColumns ?? []).map(normalizeArmorColumn)
    .filter((column) => column.all.length > 0);

  const effectivePerks = columns.map((column) => {
    const hash = overrides[String(column.socketIndex)];
    const active = hash === undefined ? column.selected :
      column.all.find((candidate) => candidate.plugHash === hash) ?? column.selected;
    return active ? { ...active, socketIndex: column.socketIndex } : null;
  }).filter((perk): perk is Perk => perk !== null);

  const previewCount = columns.filter((column) =>
    overrides[String(column.socketIndex)] !== undefined &&
    overrides[String(column.socketIndex)] !== column.selected?.plugHash
  ).length;

  const previewHasTheory = columns.some((column) => {
    const hash = overrides[String(column.socketIndex)];
    return hash !== undefined && hash !== column.selected?.plugHash &&
      !column.rolled.some((perk) => perk.plugHash === hash);
  });

  const activeColumn = columns.find((column) => column.socketIndex === openSocket) ?? null;
  const choices = activeColumn ? armorSocketOptions(activeColumn, showManifest, overrides[String(activeColumn.socketIndex)]) : [];
  const focusPerk = inspected ?? (activeColumn ? effectivePerks.find((perk) => perk.socketIndex === activeColumn.socketIndex) : null) ?? effectivePerks[0] ?? null;
  const focusColumn = focusPerk ? columns.find((column) => column.socketIndex === focusPerk.socketIndex) ?? null : null;
  const focusedIsPreview = Boolean(focusPerk && focusColumn &&
    (overrides[String(focusColumn.socketIndex)] ?? focusColumn.selected?.plugHash) === focusPerk.plugHash);
  const focusedIsTheory = Boolean(focusPerk && focusColumn && !armorOnThisItem(focusColumn, focusPerk));

  const statRows = (detail?.armorStats?.length ? detail.armorStats : item.armorStats ?? [])
    .filter((stat) => Number.isFinite(stat.value))
    .sort((a, b) => {
      const ai = ARMOR_STAT_ORDER.indexOf(a.statHash);
      const bi = ARMOR_STAT_ORDER.indexOf(b.statHash);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
  const statTotal = detail?.armorStatTotal ?? item.armorStatTotal ?? null;
  const description = detail?.description?.trim() || item.description?.trim();
  const effects = Array.from(new Map<string, CombatEffect>(
    effectivePerks.flatMap((perk) => (perk.effectTags ?? []).map((effect): [string, CombatEffect] => [effect.key, effect]))
  ).values());

  function choosePerk(column: ArmorSocketColumn, perk: Perk) {
    setInspected(perk);
    setOverrides((current) => {
      const next = { ...current };
      if (perk.plugHash === column.selected?.plugHash) delete next[String(column.socketIndex)];
      else next[String(column.socketIndex)] = perk.plugHash;
      return next;
    });
  }

  const socketSections: Array<{ kind: ArmorSocketSection; heading: string; summary: string }> = [
    { kind: "mods", heading: "Armor Mods", summary: "Mod sockets and choices from this armor's Bungie definitions." },
    { kind: "appearance", heading: "Appearance", summary: "Ornaments and shaders, only when returned for this item." },
    { kind: "other", heading: "Other Sockets", summary: "Additional sockets for this armor; unrecognized types retain their original Bungie names." },
  ];

  return (
    <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/85 p-0 backdrop-blur-md sm:p-4" role="presentation" onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="armor-details-title" className="flex h-full w-full max-w-[1480px] flex-col overflow-hidden border border-cyan-300/20 bg-[#090c13] shadow-2xl sm:h-[min(94vh,950px)]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0d1019] px-4 py-3 sm:px-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200/65">Destiny Builder · Armor Inspector 2.0</p>
            <p className="mt-1 text-xs text-white/40">Bungie armor details · Local socket preview · No real mod changes</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close armor details" className="shrink-0 border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white/65 hover:border-cyan-300/40 hover:text-white">Close ✕</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
          <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
            <section className="relative overflow-hidden border border-white/10 bg-[linear-gradient(115deg,#172132_0%,#101723_54%,#0b111a_100%)] p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-5">
                {itemImage(item.icon) ? <img src={itemImage(item.icon)!} alt="" className="h-20 w-20 shrink-0 border border-white/20 bg-black/20 object-contain sm:h-24 sm:w-24" /> : <div className="h-20 w-20 border border-white/20 bg-black/20" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">{item.itemTypeDisplayName ?? "Armor"} · {getSlotName(item)}</p>
                  <h2 id="armor-details-title" className="mt-1 text-2xl font-black uppercase tracking-[0.04em] text-white sm:text-3xl">{detail?.name || item.name}</h2>
                  <p className="mt-2 text-xs text-cyan-100/65">{sourceName(item)} <span className="mx-2 text-white/20">·</span> {item.tierTypeName ?? "Armor"}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3"><GearTier value={detail?.gearTier ?? item.gearTier} /><span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Gear Tier</span></div>
                </div>
                <div className="border-l border-white/15 pl-5 text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-100/50">Power</p>
                  <p className="mt-1 text-3xl font-black tabular-nums text-amber-100">{detail?.power ?? item.power ?? "—"}</p>
                  {typeof statTotal === "number" && <p className="mt-2 text-[11px] text-white/60">Armor stats <span className="font-bold text-cyan-100">{statTotal}</span> total</p>}
                </div>
              </div>
              {description && <p className="mt-5 whitespace-pre-line border-t border-white/10 pt-4 text-xs leading-relaxed text-white/50">{description}</p>}
            </section>

            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
              <div className="min-w-0 space-y-4">
                <section className="border border-white/10 bg-[#0e121b] p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-[0.15em] text-white/85">Armor Sockets</h3>
                      <p className="mt-1 text-xs text-white/40">Click a socket to choose. Hover a perk to see its description in the Inspector.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${previewCount ? "border-cyan-300/40 text-cyan-100" : "border-white/10 text-white/35"}`}>{previewCount ? `${previewCount} preview change${previewCount === 1 ? "" : "s"}` : "Destiny setup"}</span>
                      {previewCount > 0 && <button type="button" onClick={() => { setOverrides({}); setInspected(null); }} className="border border-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/65 hover:text-white">Reset preview</button>}
                    </div>
                  </div>
                  <p className="mb-5 border-l-2 border-cyan-300/40 bg-cyan-300/[0.04] px-3 py-2 text-[11px] leading-relaxed text-cyan-100/65">All changes on this screen are local to this inspection window. Blue marks the equipped or roll options; amber marks Manifest-only theory. The selections are not applied to Destiny or saved to the Builder draft.{previewHasTheory ? " Your preview currently includes theoretical options." : ""}</p>
                  {loading && <p className="flex items-center gap-2 text-xs text-white/45"><span className="h-3 w-3 animate-spin rounded-full border border-white/10 border-t-cyan-200" />Loading Bungie armor sockets…</p>}
                  {error && <p role="alert" className="border border-amber-300/25 bg-amber-300/[0.045] px-3 py-2 text-xs text-amber-100">{error}</p>}
                  {!loading && !error && columns.length === 0 && <p className="border border-dashed border-white/10 px-4 py-8 text-center text-xs text-white/40">Bungie did not return any meaningful socket choices for this armor item.</p>}

                  {socketSections.map((section) => {
                    const sectionColumns = columns.filter((column) => column.section === section.kind);
                    if (!sectionColumns.length) return null;
                    return (
                      <div key={section.kind} className="mt-5 border-t border-white/10 pt-4 first:mt-0 first:border-t-0 first:pt-0">
                        <div className="mb-3">
                          <h4 className="text-[11px] font-bold uppercase tracking-[0.13em] text-white/75">{section.heading} <span className="ml-2 text-white/35">{sectionColumns.length}</span></h4>
                          <p className="mt-1 text-[11px] text-white/35">{section.summary}</p>
                        </div>
                        <div className="flex flex-wrap items-start gap-x-2 gap-y-4 sm:gap-x-3">
                          {sectionColumns.map((column) => {
                            const active = effectivePerks.find((perk) => perk.socketIndex === column.socketIndex) ?? column.selected;
                            const isOpen = column.socketIndex === openSocket;
                            const previewing = overrides[String(column.socketIndex)] !== undefined && overrides[String(column.socketIndex)] !== column.selected?.plugHash;
                            const available = armorSocketOptions(column, false);
                            return <button type="button" key={column.socketIndex} aria-expanded={isOpen} aria-label={`${column.label}: ${active?.name ?? "Empty"}. Inspect choices`} onClick={() => { setOpenSocket(isOpen ? null : column.socketIndex); if (active) setInspected(active); }} onMouseEnter={() => { if (active) setInspected(active); }} onFocus={() => { if (active) setInspected(active); }} className={`group flex w-[88px] shrink-0 flex-col items-center px-1 py-2 text-center transition sm:w-[104px] ${isOpen ? "bg-cyan-200/[0.06] ring-1 ring-cyan-200/35" : "hover:bg-white/[0.035]"}`}>
                              <PerkOrb perk={active ?? null} selected={isOpen || previewing} theory={Boolean(active && !armorOnThisItem(column, active))} size="lg" />
                              <span className="mt-2 min-h-[25px] text-[10px] font-bold uppercase leading-snug tracking-[0.08em] text-white/65">{column.label}</span>
                              <span className="mt-0.5 max-w-full truncate text-[10px] text-cyan-100/60">{active?.name ?? "Empty"}</span>
                              <span className="mt-2 flex h-2 items-center gap-1" aria-hidden="true">{Array.from({ length: Math.max(1, Math.min(5, available.length)) }, (_, index) => <span key={index} className={`h-[5px] w-[5px] rounded-full ${available.length ? "bg-sky-400/70" : "bg-white/15"}`} />)}{available.length > 5 && <span className="text-[9px] text-sky-200/50">+</span>}</span>
                              {previewing && <span className="mt-1 text-[9px] font-bold uppercase tracking-wide text-cyan-200/75">Preview</span>}
                            </button>;
                          })}
                        </div>
                        {activeColumn?.section === section.kind && (
                          <div className="mt-5 border-t border-cyan-200/15 bg-[#101827] px-3 pb-4 pt-3 sm:px-4">
                            <div className="flex items-center justify-between gap-3">
                              <div><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-cyan-200/55">Socket {activeColumn.socketIndex + 1}</p><h5 className="mt-1 text-xs font-bold uppercase tracking-wider text-white/80">{activeColumn.label} · Choices</h5></div>
                              <button type="button" onClick={() => setOpenSocket(null)} aria-label="Close socket options" className="border border-white/10 px-2.5 py-1 text-xs text-white/50 hover:text-white">✕</button>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-4">
                              {choices.map((perk) => {
                                const isDestiny = perk.plugHash === activeColumn.selected?.plugHash;
                                const previewed = (overrides[String(activeColumn.socketIndex)] ?? activeColumn.selected?.plugHash) === perk.plugHash;
                                const theory = !armorOnThisItem(activeColumn, perk);
                                return <button type="button" key={perk.plugHash} aria-pressed={previewed} onMouseEnter={() => setInspected(perk)} onFocus={() => setInspected(perk)} onClick={() => choosePerk(activeColumn, perk)} title={perk.description || perk.name} className={`group flex w-[98px] shrink-0 flex-col items-center px-1.5 py-2 text-center transition ${previewed ? "bg-cyan-200/[0.06] ring-1 ring-cyan-200/25" : "hover:bg-white/[0.04]"}`}>
                                  <PerkOrb perk={perk} selected={previewed} theory={theory} />
                                  <span className="mt-2 line-clamp-2 min-h-[28px] text-[11px] font-semibold leading-snug text-white/75">{perk.name}</span>
                                  <span className={`mt-1 text-[9px] font-bold uppercase leading-tight ${theory ? "text-amber-200/70" : isDestiny ? "text-cyan-200/60" : "text-sky-200/45"}`}>{theory ? "Theory" : isDestiny ? "Destiny" : "On item"}</span>
                                </button>;
                              })}
                              {!choices.length && <p className="py-2 text-xs text-white/40">No item choices in this socket. Enable Manifest possibilities if Bungie supplied them.</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {columns.some((column) => column.possible.length > 0) && <button type="button" onClick={() => setShowManifest((current) => !current)} className="mt-5 w-full border border-white/10 px-3 py-2.5 text-xs font-semibold text-white/60 hover:border-cyan-300/30 hover:text-white">{showManifest ? "Hide Manifest-only possibilities" : "Show Manifest-only possibilities (theory)"}</button>}
                </section>

                <div className="grid gap-4 md:grid-cols-2">
                  <section className="border border-white/10 bg-[#0e121b] p-4 sm:p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-black uppercase tracking-[0.15em] text-white/75">Armor 3.0 Stats</h3>{typeof statTotal === "number" && <span className="text-xs font-bold text-cyan-100">Total {statTotal}</span>}</div>
                    {statRows.length ? <StatRows stats={statRows} /> : <p className="text-xs text-white/35">No armor stat values returned by Bungie for this item.</p>}
                    {previewCount > 0 && <p className="mt-4 text-[11px] leading-relaxed text-amber-100/65">These are the real current armor stats. Mod previews do not recalculate or alter the values.</p>}
                  </section>
                  <section className="border border-white/10 bg-[#0e121b] p-4 sm:p-5">
                    <h3 className="mb-4 text-xs font-black uppercase tracking-[0.15em] text-white/75">Intrinsic Perks</h3>
                    {detail?.intrinsicPerks?.length ? detail.intrinsicPerks.map((perk) => <PerkRow key={perk.perkHash} perk={perk} />) : <p className="text-xs text-white/35">No intrinsic armor perks returned by Bungie.</p>}
                  </section>
                </div>
              </div>

              <aside className="order-first min-w-0 space-y-4 xl:order-last xl:sticky xl:top-4 xl:self-start">
                <section className="relative overflow-hidden border border-cyan-200/30 bg-[linear-gradient(165deg,#14243a_0%,#101926_42%,#0c121d_100%)] p-4 shadow-[inset_0_1px_0_rgba(180,233,255,0.04)] sm:p-5">
                  <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-cyan-200/75 via-sky-400/35 to-transparent" />
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-black uppercase tracking-[0.15em] text-cyan-100/90">Mod & Perk Inspector</h3><span className="text-[9px] uppercase tracking-[0.14em] text-white/35">Hover to inspect · Click to preview</span></div>
                  {focusPerk ? (
                    <div className="mt-5">
                      <div className="flex items-center gap-4">
                        <PerkOrb perk={focusPerk} selected={focusedIsPreview} theory={focusedIsTheory} size="lg" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-200/55">{focusColumn?.label ?? `Socket ${focusPerk.socketIndex + 1}`}</p>
                          <h4 className="mt-1 text-xl font-black leading-tight text-white">{focusPerk.name}</h4>
                          <p className={`mt-1.5 text-[10px] font-bold uppercase tracking-wider ${focusedIsTheory ? "text-amber-100/70" : focusedIsPreview ? "text-cyan-100/70" : "text-sky-200/55"}`}>{focusedIsTheory ? "Manifest only · theory" : focusPerk.plugHash === focusColumn?.selected?.plugHash ? "Selected in Destiny" : "On this item"}{focusedIsPreview && focusPerk.plugHash !== focusColumn?.selected?.plugHash ? " · Local preview" : ""}</p>
                        </div>
                      </div>
                      {focusPerk.description ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-white/70">{focusPerk.description}</p> : <p className="mt-4 text-sm text-white/35">Bungie did not provide a description for this option.</p>}
                      {focusPerk.effectTags?.length ? <div className="mt-4 flex flex-wrap gap-1.5">{focusPerk.effectTags.map((effect) => <span key={effect.key} className={`border px-2 py-1 text-[10px] ${effect.kind === "buff" ? "border-emerald-300/25 text-emerald-200" : effect.kind === "debuff" ? "border-rose-300/25 text-rose-200" : "border-sky-300/25 text-sky-200"}`}>{effect.label}</span>)}</div> : null}
                    </div>
                  ) : <p className="mt-5 text-sm leading-6 text-white/40">Select a socket or hover an option to inspect the corresponding armor mod, perk, ornament or shader.</p>}
                </section>

                <section className="border border-white/10 bg-[#111521] p-4 sm:p-5">
                  <h3 className="text-xs font-black uppercase tracking-[0.15em] text-white/75">Effective Preview Sockets</h3>
                  {effectivePerks.length ? <div className="mt-3 space-y-2">{effectivePerks.map((perk) => <div key={`${perk.socketIndex}:${perk.plugHash}`} className="flex items-center gap-2 text-[11px] text-white/65">{itemImage(perk.icon) ? <img src={itemImage(perk.icon)!} alt="" className="h-7 w-7 shrink-0 object-contain" /> : <div className="h-7 w-7 shrink-0 border border-white/10 bg-white/[0.03]" />}<span className="min-w-0 flex-1 truncate">{perk.name}</span></div>)}</div> : <p className="mt-3 text-xs text-white/35">No active armor socket selections were supplied.</p>}
                </section>

                <section className="border border-white/10 bg-[#111521] p-4 sm:p-5">
                  <h3 className="text-xs font-black uppercase tracking-[0.15em] text-white/75">Combat Effects</h3>
                  <p className="mt-2 text-[10px] leading-relaxed text-white/35">Inferred from Bungie perk descriptions; not an official Bungie classification.</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">{effects.length ? effects.map((effect) => <span key={effect.key} className={`border px-2 py-1 text-[10px] ${effect.kind === "buff" ? "border-emerald-300/25 text-emerald-200" : effect.kind === "debuff" ? "border-rose-300/25 text-rose-200" : "border-sky-300/25 text-sky-200"}`}>{effect.label}</span>) : <p className="text-xs text-white/35">No combat effect keywords detected for the effective sockets.</p>}</div>
                </section>
                {detail?.itemSet?.perks?.length ? <section className="border border-white/10 bg-[#111521] p-4 sm:p-5"><h3 className="mb-3 text-xs font-black uppercase tracking-[0.15em] text-white/75">{detail.itemSet.name || "Armor Set Bonus"}</h3><div className="space-y-2">{detail.itemSet.perks.map((perk, index) => <PerkRow key={`${perk.requiredSetCount}:${index}`} perk={{ ...perk, name: `${perk.requiredSetCount} pieces · ${perk.name}` }} />)}</div><p className="mt-3 text-[10px] leading-relaxed text-white/35">Set thresholds are Bungie definitions; this view does not claim you have every bonus active.</p></section> : null}
                <section className="border border-white/10 bg-[#111521] p-4 sm:p-5"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/45">Item Identity</p><p className="mt-2 break-all text-[11px] tabular-nums text-white/60">Instance {item.itemInstanceId ?? "—"}</p><p className="mt-1 break-all text-[11px] text-white/35">Hash {item.itemHash}</p></section>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function validComparePerk(perk: Perk): boolean {
  const name = perk.name?.trim().toLowerCase() ?? "";
  const category = perk.plugCategoryIdentifier?.toLowerCase() ?? "";
  return Boolean(name) && name !== "unknown plug" && name !== "empty" && !name.startsWith("empty ") &&
    !["empty_socket", "ornament", "shader", "tracker", "kill_tracker", "memento", "crafting.recipes"].some((marker) => category.includes(marker));
}

function comparePerks(detail: ItemDetail | null): Perk[] {
  if (!detail) return [];
  const fromColumns = (detail.perkColumns ?? []).flatMap((column) => column.selected ? [column.selected] : []);
  // Prefer the selected socket where Bungie provides a column, but keep
  // selected perks from sockets not represented by perkColumns.
  const source = [...fromColumns, ...(detail.selectedPerks ?? [])];
  const seen = new Set<number>();
  return source.filter((perk) => {
    if (!validComparePerk(perk) || seen.has(perk.socketIndex)) return false;
    seen.add(perk.socketIndex);
    return true;
  }).sort((a,b) => a.socketIndex - b.socketIndex);
}

function CompareTrayDialog({ entries, onClose, onRemove, onInspect, onRetry }: {
  entries: CompareEntry[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onInspect: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const category = entries.find((entry) => entry.item)?.item?.category ?? "weapon";
  const armor = category === "armor";
  const statsByEntry = entries.map(({item, detail}) => {
    const source = armor ? (detail?.armorStats?.length ? detail.armorStats : item?.armorStats ?? [])
      : (detail?.stats?.length ? detail.stats : item?.stats ?? []);
    return new Map(source.filter((stat) => Number.isFinite(stat.value)).map((stat) => [stat.statHash, stat]));
  });
  const statNames = new Map<number,string>();
  for (const statMap of statsByEntry) {
    for (const [hash, stat] of statMap) if (!statNames.has(hash)) statNames.set(hash, stat.name);
  }
  const statHashes = Array.from(statNames.keys()).sort((a,b) => armor
    ? ((ARMOR_STAT_ORDER.indexOf(a) < 0 ? 999 : ARMOR_STAT_ORDER.indexOf(a)) -
       (ARMOR_STAT_ORDER.indexOf(b) < 0 ? 999 : ARMOR_STAT_ORDER.indexOf(b))) || statNames.get(a)!.localeCompare(statNames.get(b)!)
    : statNames.get(a)!.localeCompare(statNames.get(b)!));
  const perksByEntry = entries.map(({detail}) => new Map(comparePerks(detail).map((perk) => [perk.socketIndex, perk])));
  const socketIndices = Array.from(new Set(perksByEntry.flatMap((map) => [...map.keys()]))).sort((a,b) => a-b);
  const templateColumns = `minmax(130px,170px) repeat(${entries.length},minmax(215px,1fr))`;
  const minimumWidth = 160 + entries.length * 215;
  const cell = "min-w-0 border-b border-white/[0.07] px-3 py-3 text-xs";
  const label = `${cell} sticky left-0 z-[2] bg-[#101521] font-semibold text-white/55`;
  const placeholder = (entry: CompareEntry) => entry.error ? "Detail unavailable" : entry.loading ? "Loading Bungie…" : entry.item ? "No Bungie data" : "Item unavailable";
  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/90 p-0 backdrop-blur-md sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="compare-tray-title" className="flex h-full w-full max-w-[1620px] flex-col overflow-hidden border border-cyan-200/25 bg-[#090c13] shadow-2xl sm:h-[min(95vh,1050px)]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#111726] px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/65">Destiny Builder · Account-wide</p>
            <h2 id="compare-tray-title" className="mt-1 text-xl font-black uppercase tracking-[0.05em] text-white sm:text-2xl">Compare Tray <span className="text-cyan-100/50">{entries.length}/{COMPARE_LIMIT}</span></h2>
            <p className="mt-1 text-xs leading-relaxed text-white/45">Real Bungie roll, aligned stats and socket perks · Read-only comparison · No equip or transfer actions</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white/70 hover:border-cyan-200/35 hover:text-white">Close ✕</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto [scrollbar-width:thin]">
          <div className="p-4 sm:p-6">
            <div className="overflow-x-auto border border-white/10">
              <div style={{ minWidth: minimumWidth }}>
                <div className="grid" style={{ gridTemplateColumns: templateColumns }}>
                  <div className="sticky left-0 z-[3] flex items-end border-b border-white/10 bg-[#111725] px-3 py-4"><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Compare instances</span></div>
                  {entries.map((entry) => (
                    <div key={entry.id} className="min-w-0 border-b border-l border-white/10 bg-[#111725] p-3">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-200/55">{entry.item ? sourceName(entry.item) : "No longer found"}</span>
                        <button type="button" aria-label={`Remove ${entry.item?.name ?? "missing item"} from compare`} onClick={() => onRemove(entry.id)} className="shrink-0 border border-white/10 px-2 py-0.5 text-xs text-white/50 hover:text-white">✕</button>
                      </div>
                      <div className="flex items-start gap-3">
                        {entry.item && itemImage(entry.item.icon) ? <img src={itemImage(entry.item.icon)!} alt="" className="h-12 w-12 shrink-0 border border-white/10 bg-white/5 object-contain"/> : <div className="h-12 w-12 shrink-0 bg-white/5"/>}
                        <div className="min-w-0"><p className="text-xs font-bold leading-snug text-white" title={entry.item?.name}>{entry.item?.name ?? "Missing item"}</p><p className="mt-1 break-all text-[9px] tabular-nums text-white/35">{entry.item?.itemInstanceId ?? "—"}</p></div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <GearTier value={entry.detail?.gearTier ?? entry.item?.gearTier}/>
                        {entry.item && <button type="button" onClick={() => onInspect(entry.id)} className="border border-white/15 px-2 py-1 text-[10px] font-semibold text-cyan-100/85 hover:border-cyan-200/40">Inspect ↗</button>}
                      </div>
                      {entry.loading && <p className="mt-3 text-[10px] text-cyan-100/55">Reading detailed roll…</p>}
                      {entry.error && <div className="mt-3"><p className="text-[10px] text-amber-200/75">{entry.error}</p><button type="button" onClick={() => onRetry(entry.id)} className="mt-1 text-[10px] font-semibold text-cyan-200 underline">Retry details</button></div>}
                    </div>
                  ))}
                  <div className={label}>Power</div>
                  {entries.map((entry) => <div key={`${entry.id}:power`} className={`${cell} border-l border-white/[0.05] bg-[#0b111a] text-lg font-black tabular-nums text-amber-100`}>{entry.detail?.power ?? entry.item?.power ?? "—"}</div>)}
                  <div className={label}>Gear Tier</div>
                  {entries.map((entry) => <div key={`${entry.id}:gear-tier`} className={`${cell} border-l border-white/[0.05] bg-[#0b111a]`}><GearTier value={entry.detail?.gearTier ?? entry.item?.gearTier}/></div>)}
                </div>
                <div className="grid border-t border-cyan-200/20 bg-cyan-200/[0.045]" style={{gridTemplateColumns:templateColumns}}>
                  <div className="col-span-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/85">{armor ? "Armor 3.0" : "Weapon"} stats · Original Bungie values</div>
                </div>
                <div className="grid" style={{gridTemplateColumns:templateColumns}}>
                  {statHashes.length ? statHashes.map((hash) => (
                    <div key={`stat:${hash}`} className="contents">
                      <div className={label}>{statNames.get(hash)}</div>
                      {entries.map((entry, index) => {
                        const stat = statsByEntry[index].get(hash);
                        const values = statsByEntry.map((map) => map.get(hash)?.value).filter((v):v is number => typeof v === "number");
                        const max = values.length ? Math.max(...values) : null;
                        return <div key={`${entry.id}:stat:${hash}`} className={`${cell} border-l border-white/[0.05] bg-[#0b111a]`} title={stat?.description || undefined}>
                          {stat ? <div className="flex items-center gap-3"><span className={`w-8 shrink-0 font-bold tabular-nums ${max !== null && stat.value === max && entries.length > 1 ? "text-cyan-100" : "text-white/75"}`}>{stat.value}</span><div className="h-1.5 flex-1 overflow-hidden bg-white/10"><div className="h-full bg-cyan-300/70" style={{width:`${Math.min(100,Math.max(0,stat.value))}%`}}/></div></div> : <span className="text-white/30">{placeholder(entry)}</span>}
                        </div>;
                      })}
                    </div>
                  )) : <div className="col-span-full px-4 py-8 text-xs text-white/40">No comparable stats have been returned yet. Open the comparison after the detail requests finish.</div>}
                </div>
                <div className="grid border-t border-cyan-200/20 bg-cyan-200/[0.045]" style={{gridTemplateColumns:templateColumns}}><div className="col-span-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/85">Selected socket perks · Real roll (not Manifest possibilities)</div></div>
                <div className="grid" style={{gridTemplateColumns:templateColumns}}>
                  {socketIndices.length ? socketIndices.map((socket) => (
                    <div key={`socket:${socket}`} className="contents">
                      <div className={label}>Socket {socket+1}</div>
                      {entries.map((entry, index) => {
                        const perk = perksByEntry[index].get(socket);
                        return <div key={`${entry.id}:socket:${socket}`} className={`${cell} border-l border-white/[0.05] bg-[#0b111a]`}>
                          {perk ? <div className="flex items-start gap-2" title={perk.description || undefined}>{itemImage(perk.icon) ? <img src={itemImage(perk.icon)!} alt="" className="h-8 w-8 shrink-0 object-contain"/> : <div className="h-8 w-8 shrink-0 bg-white/5"/>}<div className="min-w-0"><p className="text-[11px] font-semibold text-white/80">{perk.name}</p>{perk.description && <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-white/40">{perk.description}</p>}</div></div> : <span className="text-white/30">{placeholder(entry)}</span>}
                        </div>;
                      })}
                    </div>
                  )) : <div className="col-span-full px-4 py-8 text-xs text-white/40">No selected perk sockets available in the compared item details yet.</div>}
                </div>
                <div className="grid border-t border-cyan-200/20 bg-cyan-200/[0.045]" style={{gridTemplateColumns:templateColumns}}><div className="col-span-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100/85">Intrinsic perk</div></div>
                <div className="grid" style={{gridTemplateColumns:templateColumns}}>
                  <div className={label}>Intrinsic</div>
                  {entries.map((entry) => <div key={`${entry.id}:intrinsic`} className={`${cell} border-l border-white/[0.05] bg-[#0b111a] text-white/65`}>{entry.detail?.intrinsicPerks?.length ? entry.detail.intrinsicPerks.map((perk) => <p key={perk.perkHash} title={perk.description} className="mb-1 text-[11px]">{perk.name}</p>) : <span className="text-white/30">{placeholder(entry)}</span>}</div>)}
                </div>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-white/40">Blue numbers indicate the highest reported value among these copies, not a global roll rating. Missing Bungie fields stay blank; comparisons do not compute perk bonuses or change gear.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemCard({ item, selected, copies, compact, onInspect, compared, canCompare, onToggleCompare }: {
  item: BrowseItem;
  selected: boolean;
  copies: number;
  compact: boolean;
  onInspect: () => void;
  compared: boolean;
  canCompare: boolean;
  onToggleCompare: () => void;
}) {
  return (
    <div className="relative">
    <button
      type="button"
      onClick={onInspect}
      aria-pressed={selected}
      className={`group relative w-full border text-left transition ${selected ? "border-cyan-200/60 bg-cyan-200/[0.07]" : "border-white/10 bg-[#0c1016] hover:border-cyan-200/25 hover:bg-white/[0.04]"} ${compact ? "flex items-center gap-3 p-2.5" : "p-3"}`}
    >
      <div className={`relative shrink-0 overflow-hidden border border-white/10 bg-white/[0.035] ${compact ? "h-12 w-12" : "h-16 w-16"}`}>
        {itemImage(item.icon) ? <img src={itemImage(item.icon)!} alt="" className="h-full w-full object-contain" /> : <div className="h-full w-full bg-white/5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate pr-20 text-xs font-bold text-white/85 group-hover:text-white" title={item.name}>{item.name}</p>
        <p className="mt-1 truncate text-[10px] text-white/40">{getSlotName(item)}</p>
        <p className="mt-1 truncate text-[10px] text-cyan-200/55">{sourceName(item)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          {typeof item.power === "number" && <span className="font-bold tabular-nums text-amber-100/75">{item.power}</span>}
          <GearTier value={item.gearTier} />
          {copies > 1 && <span className="font-semibold text-violet-200/70">×{copies} copies</span>}
          {item.location.placement === "equipped" && <span className="font-bold uppercase tracking-wider text-emerald-200/70">Equipped</span>}
        </div>
      </div>
      {compact && <span className="shrink-0 text-sm text-white/25 group-hover:text-cyan-200">›</span>}
    </button>
    {comparableCategory(item) && (
      <button type="button" onClick={onToggleCompare} disabled={!canCompare && !compared} aria-label={compared ? `Remove ${item.name} from Compare Tray` : `Add ${item.name} to Compare Tray`} aria-pressed={compared} title={compared ? "Remove from Compare Tray" : canCompare ? "Add to Compare Tray" : "Compare weapons/armor of the same slot, up to 5 items"}
        className={`absolute right-2 top-2 z-10 border px-2 py-1 text-[10px] font-black uppercase tracking-wider transition ${compared ? "border-cyan-200/50 bg-cyan-200/20 text-cyan-50" : "border-white/20 bg-[#111a25] text-cyan-100 hover:border-cyan-200/50"} disabled:cursor-not-allowed disabled:opacity-35`}>
        {compared ? "✓ Compare" : "+ Compare"}
      </button>
    )}
    </div>
  );
}

export default function VaultPage() {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [sourceGuardianId, setSourceGuardianId] = useState<string | null>(null);
  const [activeGuardianId, setActiveGuardianId] = useState<string | null>(null);
  const [guardiansLoading, setGuardiansLoading] = useState(true);
  const [guardiansError, setGuardiansError] = useState("");
  const [coreItems, setCoreItems] = useState<{ inventory: DestinyItem[]; equipment: DestinyItem[] }>({ inventory: [], equipment: [] });
  const [accountItems, setAccountItems] = useState<{ vault: DestinyItem[]; others: DestinyItem[] }>({ vault: [], others: [] });
  const [coreLoading, setCoreLoading] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [coreError, setCoreError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const mounted = useRef(false);
  const busy = useRef<Record<SyncScope, boolean>>({ core: false, account: false });
  const lastSynced = useRef<Record<SyncScope, number>>({ core: 0, account: 0 });

  const [category, setCategory] = useState<CategoryFilter>("all");
  // Show the shared in-game Vault by default; All Account is a separate view.
  const [location, setLocation] = useState("vault");
  const [slot, setSlot] = useState("all");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [copiesOnly, setCopiesOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  const [renderLimit, setRenderLimit] = useState(120);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [weaponDetailsOpen, setWeaponDetailsOpen] = useState(false);
  const [armorDetailsOpen, setArmorDetailsOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const compareHydrated = useRef(false);
  const [details, setDetails] = useState<Record<string, ItemDetail>>({});
  const [detailBusy, setDetailBusy] = useState<Record<string, boolean>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const pendingDetails = useRef(new Set<string>());
  const [transferItemId, setTransferItemId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(window.sessionStorage.getItem(COMPARE_STORAGE_KEY) ?? "[]");
      if (Array.isArray(parsed)) setCompareIds(parsed.filter((id): id is string => typeof id === "string" && /^instance:[1-9]\d{0,24}$/.test(id)).slice(0, COMPARE_LIMIT));
    } catch { /* Comparison is optional when session storage is disabled. */ }
    compareHydrated.current = true;
  }, []);
  useEffect(() => {
    if (!compareHydrated.current) return;
    try { window.sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(compareIds)); } catch { /* Private browsing. */ }
  }, [compareIds]);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferFeedback, setTransferFeedback] = useState<TransferFeedback | null>(null);
  const [awaitingTransfer, setAwaitingTransfer] = useState<AwaitingTransfer | null>(null);
  // Set only after a Bungie GET confirms the destination; resolves mixed snapshots
  // where scope=core briefly still lists an item that scope=account has moved.
  const [verifiedTransfer, setVerifiedTransfer] = useState<VerifiedTransfer | null>(null);
  const transferLock = useRef(false);
  const syncRevision = useRef(0);
  const conflictRetryCount = useRef(0);

  const refreshScope = useCallback(async (scope: SyncScope, guardianId: string) => {
    if (busy.current[scope] || transferLock.current) return;
    busy.current[scope] = true;
    const startingRevision = syncRevision.current;
    if (scope === "core") setCoreLoading(true);
    else setAccountLoading(true);
    try {
      const endpoint = `/api/destiny/characters/${encodeURIComponent(guardianId)}/inventory?scope=${scope}`;
      if (scope === "core") {
        const result = await getApi<CoreResponse>(endpoint);
        if (mounted.current && startingRevision === syncRevision.current && !transferLock.current) {
          setCoreItems({ inventory: result.inventory ?? [], equipment: result.equipment ?? [] });
          setCoreError("");
        }
      } else {
        const result = await getApi<AccountResponse>(endpoint);
        if (mounted.current && startingRevision === syncRevision.current && !transferLock.current) {
          setAccountItems({ vault: result.vault ?? [], others: result.otherGuardianItems ?? [] });
          setAccountError("");
        }
      }
      if (startingRevision === syncRevision.current && !transferLock.current) lastSynced.current[scope] = Date.now();
    } catch (cause) {
      if (mounted.current && startingRevision === syncRevision.current && !transferLock.current) {
        const message = cause instanceof Error ? cause.message : "Could not sync Bungie inventory";
        if (scope === "core") setCoreError(message);
        else setAccountError(message);
      }
    } finally {
      busy.current[scope] = false;
      if (mounted.current) {
        if (scope === "core") setCoreLoading(false);
        else setAccountLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const result = await getApi<GuardiansResponse>("/api/destiny/characters");
        if (!mounted.current) return;
        const next = result.characters ?? [];
        setGuardians(next);
        if (!next.length) setGuardiansError("No Destiny Guardians were found on this account.");
        else {
          let savedGuardianId: string | null = null;
          try { savedGuardianId = window.localStorage.getItem(ACTIVE_GUARDIAN_KEY); } catch { /* optional */ }
          const remembered = next.find((guardian) => guardian.characterId === savedGuardianId);
          const resolved = remembered?.characterId ?? next[0].characterId;
          setSourceGuardianId(resolved);
          setActiveGuardianId(resolved);
        }
      } catch (cause) {
        if (mounted.current) setGuardiansError(cause instanceof Error ? cause.message : "Could not load Guardians");
      } finally {
        if (mounted.current) setGuardiansLoading(false);
      }
    })();
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!sourceGuardianId) return;
    void refreshScope("core", sourceGuardianId);
    void refreshScope("account", sourceGuardianId);
    const coreTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshScope("core", sourceGuardianId);
    }, 30_000);
    const accountTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshScope("account", sourceGuardianId);
    }, 90_000);
    const syncWhenActive = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSynced.current.core >= 30_000) void refreshScope("core", sourceGuardianId);
      if (Date.now() - lastSynced.current.account >= 90_000) void refreshScope("account", sourceGuardianId);
    };
    window.addEventListener("focus", syncWhenActive);
    document.addEventListener("visibilitychange", syncWhenActive);
    return () => {
      window.clearInterval(coreTimer);
      window.clearInterval(accountTimer);
      window.removeEventListener("focus", syncWhenActive);
      document.removeEventListener("visibilitychange", syncWhenActive);
    };
  }, [refreshScope, sourceGuardianId]);

  const { allItems, conflictingIds } = useMemo(() => {
    const referenceClass = guardians.find((g) => g.characterId === sourceGuardianId)?.className ?? "Guardian";
    const entries: LocatedInstance[] = [
      ...coreItems.equipment.map((item) => ({ item, location: itemLocation(item, {
        type: "equipped", characterId: sourceGuardianId,
        className: referenceClass, placement: "equipped",
      } as ItemLocation) })),
      ...coreItems.inventory.map((item) => ({ item, location: itemLocation(item, {
        type: "characterInventory", characterId: sourceGuardianId,
        className: referenceClass, placement: "inventory",
      } as ItemLocation) })),
      ...accountItems.vault.map((item) => ({ item, location: itemLocation(item, {
        type: "vault", characterId: null, className: null, placement: "vault",
      } as ItemLocation) })),
      ...accountItems.others.map((item) => ({ item, location: itemLocation(item, {
        type: "otherGuardian", characterId: null,
        className: "Other Guardian", placement: "inventory",
      } as ItemLocation) })),
    ];
    const itemIndex = new Map<string, number>();
    const locationById = new Map<string, string>();
    const conflicts = new Set<string>();
    const output: BrowseItem[] = [];

    for (const [index, { item, location: resolved }] of entries.entries()) {
      if (!isBrowseable(item)) continue;
      const instanceId = normalizedInstanceId(item.itemInstanceId);
      const id = instanceId ? `instance:${instanceId}` : `stack:${resolved.type}:${item.itemHash}:${index}`;
      const locationKey = `${resolved.type}:${resolved.characterId ?? ""}:${resolved.placement ?? ""}`;
      if (instanceId) {
        const previous = locationById.get(instanceId);
        if (previous && previous !== locationKey) conflicts.add(instanceId);
        else if (!previous) locationById.set(instanceId, locationKey);
      }

      const existingIndex = itemIndex.get(id);
      if (existingIndex !== undefined) {
        // Exactly one card for each physical instance, even when Bungie's
        // core/account snapshots temporarily disagree. Prefer a *reported*
        // destination for the most recent real transfer, not a made-up location.
        const preferredDestination = verifiedTransfer?.itemId === instanceId
          ? verifiedTransfer.destination
          : awaitingTransfer?.itemId === instanceId ? awaitingTransfer.destination : null;
        if (preferredDestination && isAtTransferDestination(resolved, preferredDestination) &&
            !isAtTransferDestination(output[existingIndex].location, preferredDestination)) {
          output[existingIndex] = { ...item, browserId: id, location: resolved };
        }
        continue;
      }
      itemIndex.set(id, output.length);
      output.push({ ...item, browserId: id, location: resolved });
    }
    return { allItems: output, conflictingIds: conflicts };
  }, [coreItems, accountItems, guardians, sourceGuardianId, verifiedTransfer, awaitingTransfer]);

  const countsByHash = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of allItems) counts.set(item.itemHash, (counts.get(item.itemHash) ?? 0) + 1);
    return counts;
  }, [allItems]);

  const slots = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of allItems) {
      const hash = getSlotHash(item);
      if (hash !== null) map.set(String(hash), getSlotName(item));
    }
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allItems]);

  const visibleItems = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return allItems.filter((item) => {
      // During inconsistent Bungie snapshots, do not present a disputed roll
      // as belonging to either Guardian or Vault. It remains inspectable once
      // in All Account until both scope reads converge.
      if (location !== "all" && item.itemInstanceId &&
          conflictingIds.has(normalizedInstanceId(item.itemInstanceId)!)) return false;
      if (category !== "all" && getCategory(item) !== category) return false;
      if (location === "vault" && item.location.type !== "vault") return false;
      if (location !== "all" && location !== "vault" && item.location.characterId !== location) return false;
      if (slot !== "all" && String(getSlotHash(item)) !== slot) return false;
      if (copiesOnly && (countsByHash.get(item.itemHash) ?? 0) < 2) return false;
      if (search && ![item.name, item.itemTypeDisplayName, item.tierTypeName, getSlotName(item), sourceName(item)].filter(Boolean).join(" ").toLocaleLowerCase().includes(search)) return false;
      return true;
    }).sort((a, b) => {
      if (sortMode === "power") return (b.power ?? -1) - (a.power ?? -1) || a.name.localeCompare(b.name);
      if (sortMode === "tier") return (b.gearTier ?? -1) - (a.gearTier ?? -1) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name) || (b.power ?? 0) - (a.power ?? 0);
    });
  }, [allItems, category, location, slot, copiesOnly, query, countsByHash, sortMode, conflictingIds]);

  const displayedItems = visibleItems.slice(0, renderLimit);
  const selectedItem = allItems.find((item) => item.browserId === selectedId) ?? null;
  const selectedInstanceId = selectedItem?.itemInstanceId ?? null;
  const selectedHash = selectedItem?.itemHash ?? null;
  const selectedDetail = selectedInstanceId ? details[selectedInstanceId] ?? null : null;
  const selectedLoading = selectedInstanceId ? Boolean(detailBusy[selectedInstanceId]) : false;
  const selectedError = selectedInstanceId ? detailErrors[selectedInstanceId] ?? null : null;
  const transferItem = transferItemId ? allItems.find((item) => item.browserId === transferItemId) ?? null : null;
  const transferGuardians = transferItem ? guardians.filter((guardian) => canReceiveItem(guardian, transferItem)) : [];
  const compareItems = compareIds.map((id) => allItems.find((item) => item.browserId === id) ?? null);
  const compareAnchor = compareItems.find((item): item is BrowseItem => item !== null) ?? null;
  const compareEntries: CompareEntry[] = compareIds.map((id, index) => {
    const item = compareItems[index];
    const itemId = item?.itemInstanceId ?? null;
    return { id, item, detail: itemId ? details[itemId] ?? null : null,
      loading: itemId ? Boolean(detailBusy[itemId]) : false,
      error: itemId ? detailErrors[itemId] ?? null : null };
  });
  function canCompareItem(item: BrowseItem): boolean {
    return Boolean(comparableCategory(item)) && (compareIds.includes(item.browserId) ||
      (compareIds.length < COMPARE_LIMIT && (!compareAnchor || isComparableForTray(compareAnchor, item))));
  }
  function toggleCompare(item: BrowseItem) {
    if (!comparableCategory(item)) return;
    setCompareIds((current) => {
      if (current.includes(item.browserId)) return current.filter((id) => id !== item.browserId);
      if (current.length >= COMPARE_LIMIT) return current;
      const first = current.map((id) => allItems.find((entry) => entry.browserId === id)).find((entry): entry is BrowseItem => Boolean(entry));
      if (first && !isComparableForTray(first, item)) return current;
      return [...current, item.browserId];
    });
  }

  useEffect(() => {
    if (!awaitingTransfer || !sourceGuardianId) return;
    // Require both Bungie scopes to agree that the item is exclusively at
    // its destination. Never confirm while the previous location remains.
    const confirmed = verifyItemDestination(
      awaitingTransfer.itemId,
      awaitingTransfer.destination,
      sourceGuardianId,
      { success: true, ...coreItems },
      { success: true, vault: accountItems.vault, otherGuardianItems: accountItems.others }
    );
    if (!confirmed) return;
    setVerifiedTransfer({ itemId: awaitingTransfer.itemId, destination: awaitingTransfer.destination });
    setTransferFeedback({
      kind: "success",
      message: `${awaitingTransfer.itemName} → ${awaitingTransfer.targetLabel}. Bungie accepted the transfer and the new location was verified.`,
    });
    setAwaitingTransfer(null);
  }, [coreItems, accountItems, awaitingTransfer, sourceGuardianId]);

  useEffect(() => {
    if (!awaitingTransfer || !sourceGuardianId) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const referenceId = sourceGuardianId;
    const pending = awaitingTransfer;

    const schedule = (delay: number) => {
      if (!cancelled) timeout = setTimeout(() => void checkAgain(), delay);
    };
    async function checkAgain() {
      if (cancelled || !mounted.current) return;
      // Avoid overlapping a normal sync or an actual write. NEVER repeat POST.
      if (transferLock.current || busy.current.core || busy.current.account) {
        schedule(1200);
        return;
      }
      busy.current.core = true;
      busy.current.account = true;
      const revision = ++syncRevision.current;
      try {
        const base = `/api/destiny/characters/${encodeURIComponent(referenceId)}/inventory`;
        const [freshCore, freshAccount] = await Promise.all([
          getApi<CoreResponse>(`${base}?scope=core`),
          getApi<AccountResponse>(`${base}?scope=account`),
        ]);
        if (cancelled || !mounted.current || revision !== syncRevision.current) return;
        setCoreItems({ inventory: freshCore.inventory ?? [], equipment: freshCore.equipment ?? [] });
        setAccountItems({ vault: freshAccount.vault ?? [], others: freshAccount.otherGuardianItems ?? [] });
        setCoreError("");
        setAccountError("");
        lastSynced.current.core = Date.now();
        lastSynced.current.account = Date.now();
        if (verifyItemDestination(pending.itemId, pending.destination, referenceId, freshCore, freshAccount)) {
          setVerifiedTransfer({ itemId: pending.itemId, destination: pending.destination });
          setTransferFeedback({
            kind: "success",
            message: `${pending.itemName} → ${pending.targetLabel}. Bungie accepted the transfer and the new location was verified.`,
          });
          setAwaitingTransfer(null);
          return;
        }
      } catch {
        // Inventory can lag or an individual read can fail briefly; retry GET only.
      } finally {
        busy.current.core = false;
        busy.current.account = false;
      }
      if (cancelled || !mounted.current) return;
      attempts += 1;
      if (attempts < TRANSFER_VERIFY_DELAYS_MS.length) {
        schedule(TRANSFER_VERIFY_DELAYS_MS[attempts]);
      } else {
        setTransferFeedback({
          kind: "pending",
          message: `${pending.itemName} → ${pending.targetLabel}: Bungie accepted the transfer, but the destination is still not confirmed. Use Sync Bungie later; do not repeat the transfer blindly.`,
        });
      }
    }

    schedule(TRANSFER_VERIFY_DELAYS_MS[0]);
    return () => {
      cancelled = true;
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [awaitingTransfer, sourceGuardianId]);

  useEffect(() => {
    if (!selectedInstanceId || selectedHash === null || details[selectedInstanceId] || pendingDetails.current.has(selectedInstanceId)) return;
    const instanceId = selectedInstanceId;
    pendingDetails.current.add(instanceId);
    setDetailBusy((current) => ({ ...current, [instanceId]: true }));
    void (async () => {
      try {
        const endpoint = `/api/destiny/characters/${encodeURIComponent(sourceGuardianId ?? "")}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(instanceId)}&itemHash=${selectedHash}`;
        const response = await getApi<DetailResponse>(endpoint);
        if (!response.item) throw new Error("Bungie returned no item details");
        if (mounted.current) {
          setDetails((current) => ({ ...current, [instanceId]: response.item! }));
          setDetailErrors((current) => { const next = { ...current }; delete next[instanceId]; return next; });
        }
      } catch (cause) {
        if (mounted.current) setDetailErrors((current) => ({ ...current, [instanceId]: cause instanceof Error ? cause.message : "Item details could not be loaded" }));
      } finally {
        pendingDetails.current.delete(instanceId);
        if (mounted.current) setDetailBusy((current) => ({ ...current, [instanceId]: false }));
      }
    })();
  }, [selectedInstanceId, selectedHash, sourceGuardianId, details]);

  useEffect(() => {
    if (!compareOpen || !sourceGuardianId) return;
    const remaining = Math.max(0, 2 - pendingDetails.current.size);
    if (!remaining) return;
    const queue = compareEntries.filter((entry) => entry.item?.itemInstanceId &&
      !entry.detail && !entry.error && !pendingDetails.current.has(entry.item.itemInstanceId)).slice(0, remaining);
    for (const entry of queue) {
      const item = entry.item!;
      const instanceId = item.itemInstanceId!;
      pendingDetails.current.add(instanceId);
      setDetailBusy((current) => ({...current, [instanceId]: true}));
      void (async () => {
        try {
          const endpoint = `/api/destiny/characters/${encodeURIComponent(sourceGuardianId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(instanceId)}&itemHash=${item.itemHash}`;
          const result = await getApi<DetailResponse>(endpoint);
          if (!result.item) throw new Error("Bungie returned no item details");
          if (mounted.current) {
            setDetails((current) => ({...current, [instanceId]: result.item!}));
            setDetailErrors((current) => {const next={...current};delete next[instanceId];return next;});
          }
        } catch (cause) {
          if (mounted.current) setDetailErrors((current) => ({...current, [instanceId]:cause instanceof Error ? cause.message : "Could not load compare details"}));
        } finally {
          pendingDetails.current.delete(instanceId);
          if (mounted.current) setDetailBusy((current) => ({...current, [instanceId]: false}));
        }
      })();
    }
  }, [compareOpen, compareIds, allItems, details, detailErrors, detailBusy, sourceGuardianId]);

  useEffect(() => {
    if (!selectedId && !transferItemId && !weaponDetailsOpen && !armorDetailsOpen && !compareOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || transferLock.current) return;
      if (transferItemId) setTransferItemId(null);
      else if (compareOpen) setCompareOpen(false);
      else if (weaponDetailsOpen) setWeaponDetailsOpen(false);
      else if (armorDetailsOpen) setArmorDetailsOpen(false);
      else setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, transferItemId, weaponDetailsOpen, armorDetailsOpen, compareOpen]);

  useEffect(() => {
    if (!weaponDetailsOpen && !armorDetailsOpen && !compareOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [weaponDetailsOpen, armorDetailsOpen, compareOpen]);

  useEffect(() => {
    if (weaponDetailsOpen && (!selectedItem || getCategory(selectedItem) !== "weapon")) {
      setWeaponDetailsOpen(false);
    }
  }, [weaponDetailsOpen, selectedItem]);

  useEffect(() => {
    if (armorDetailsOpen && (!selectedItem || getCategory(selectedItem) !== "armor")) {
      setArmorDetailsOpen(false);
    }
  }, [armorDetailsOpen, selectedItem]);

  async function syncNow() {
    if (!sourceGuardianId || transferLock.current) return;
    setSyncing(true);
    try { await Promise.all([refreshScope("core", sourceGuardianId), refreshScope("account", sourceGuardianId)]); }
    finally { if (mounted.current) setSyncing(false); }
  }

  // A stale scope can survive even after Bungie accepts a real transfer.
  // Retry a few READ-ONLY syncs for mismatched locations. This never calls
  // /api/destiny/transfer and cannot perform another inventory mutation.
  useEffect(() => {
    if (conflictingIds.size === 0) {
      conflictRetryCount.current = 0;
      return;
    }
    if (!sourceGuardianId || awaitingTransfer || transferBusy || conflictRetryCount.current >= 4) return;
    const timer = window.setTimeout(() => {
      if (transferLock.current || busy.current.core || busy.current.account) return;
      conflictRetryCount.current += 1;
      void syncNow();
    }, 2500 + conflictRetryCount.current * 1800);
    return () => window.clearTimeout(timer);
  }, [conflictingIds, sourceGuardianId, awaitingTransfer, transferBusy]);

  function openTransfer(item: BrowseItem) {
    if (transferLock.current || !isTransferableInFirstPhase(item)) return;
    if (item.itemInstanceId && conflictingIds.has(normalizedInstanceId(item.itemInstanceId)!)) {
      setTransferFeedback({ kind: "pending", message: `Bungie is reporting conflicting locations for ${item.name}. Wait for synchronization before requesting another real transfer.` });
      return;
    }
    if (awaitingTransfer?.itemId === item.itemInstanceId) {
      setTransferFeedback({ kind: "pending", message: `The previous transfer of ${item.name} is still waiting for Bungie inventory verification. Sync Bungie before trying another operation on this item.` });
      return;
    }
    setTransferError("");
    setTransferFeedback(null);
    setAwaitingTransfer(null);
    setTransferItemId(item.browserId);
    setTransferTargetId(
      guardians.find((guardian) => canReceiveItem(guardian, item))?.characterId ?? ""
    );
  }

  async function confirmTransfer() {
    if (transferLock.current || !sourceGuardianId || !transferItem || !isTransferableInFirstPhase(transferItem)) return;
    if (transferItem.itemInstanceId && conflictingIds.has(normalizedInstanceId(transferItem.itemInstanceId)!)) {
      setTransferError("Bungie reports this item in multiple locations. Sync first; transferring it now would be unsafe.");
      return;
    }
    if (coreLoading || accountLoading || syncing) {
      setTransferError("Wait for the current inventory sync to finish before transferring.");
      return;
    }
    const destination: TransferDestination = transferItem.location.type === "vault"
      ? { type: "guardian", characterId: transferTargetId }
      : { type: "vault" };
    if (destination.type === "guardian" && !transferGuardians.some((guardian) => guardian.characterId === destination.characterId)) {
      setTransferError("Choose a valid destination Guardian for this item.");
      return;
    }

    const itemId = transferItem.itemInstanceId;
    if (!itemId) return;
    const itemName = transferItem.name;
    const targetLabel = destination.type === "vault"
      ? "Vault" : transferGuardians.find((guardian) => guardian.characterId === destination.characterId)?.className ?? "Guardian";
    transferLock.current = true;
    syncRevision.current += 1; // Ignore an older inventory response racing this write.
    setTransferBusy(true);
    setTransferError("");
    setTransferFeedback(null);
    setVerifiedTransfer(null);

    try {
      // POST is intentionally never retried automatically: an interrupted network
      // response does not establish whether Bungie already moved the item.
      const response = await fetch("/api/destiny/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemHash: transferItem.itemHash,
          itemInstanceId: itemId,
          destination,
          confirm: true,
        }),
        cache: "no-store",
      });
      const result: { success?: boolean; bungieAccepted?: boolean; error?: string } | null = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true || result.bungieAccepted !== true) {
        setTransferError(result?.error || `Transfer request was not accepted (${response.status}). Sync Bungie before retrying.`);
        return;
      }

      // Never optimistically change an item location. Read back both scopes,
      // including the destination when it belongs to another Guardian.
      try {
        const baseUrl = `/api/destiny/characters/${encodeURIComponent(sourceGuardianId)}/inventory`;
        const [freshCore, freshAccount] = await Promise.all([
          getApi<CoreResponse>(`${baseUrl}?scope=core`),
          getApi<AccountResponse>(`${baseUrl}?scope=account`),
        ]);
        if (!mounted.current) return;
        setCoreItems({ inventory: freshCore.inventory ?? [], equipment: freshCore.equipment ?? [] });
        setAccountItems({ vault: freshAccount.vault ?? [], others: freshAccount.otherGuardianItems ?? [] });
        setCoreError("");
        setAccountError("");
        lastSynced.current.core = Date.now();
        lastSynced.current.account = Date.now();
        const verified = verifyItemDestination(itemId, destination, sourceGuardianId, freshCore, freshAccount);
        if (verified) setVerifiedTransfer({ itemId, destination });
        setTransferFeedback(verified
          ? { kind: "success", message: `${itemName} → ${targetLabel}. Bungie accepted the transfer and the new location was verified.` }
          : { kind: "pending", message: `Bungie accepted the transfer of ${itemName}, but ${targetLabel} has not shown the new location yet. Wait briefly and use Sync Bungie; do not repeat the transfer blindly.` });
        if (!verified) setAwaitingTransfer({ itemId, itemName, destination, targetLabel });
      } catch {
        if (mounted.current) {
          setTransferFeedback({
            kind: "pending",
            message: `Bungie accepted the transfer of ${itemName}, but the follow-up inventory check failed. Use Sync Bungie before trying anything else.`,
          });
          setAwaitingTransfer({ itemId, itemName, destination, targetLabel });
        }
      }
      setTransferItemId(null);
    } catch {
      setTransferError("The transfer request was interrupted. Bungie may already have processed it. Close this dialog and Sync Bungie before attempting another transfer.");
    } finally {
      transferLock.current = false;
      if (mounted.current) setTransferBusy(false);
    }
  }

  const vaultCount = allItems.filter((item) => item.location.type === "vault").length;
  const weaponCount = allItems.filter((item) => getCategory(item) === "weapon").length;
  const armorCount = allItems.filter((item) => getCategory(item) === "armor").length;
  const activeGuardian = guardians.find((guardian) => guardian.characterId === activeGuardianId)
    ?? guardians.find((guardian) => guardian.characterId === sourceGuardianId) ?? null;
  // Browsing an inventory is a deliberate Guardian selection. It does not
  // change which reference Guardian drives core/account fetches: switching
  // reference mid-sync would combine snapshots belonging to different Guardians.
  const chooseBrowseLocation = (nextLocation: string) => {
    setLocation(nextLocation);
    const selectedGuardian = guardians.find((guardian) => guardian.characterId === nextLocation);
    if (!selectedGuardian) return;
    setActiveGuardianId(selectedGuardian.characterId);
    try { window.localStorage.setItem(ACTIVE_GUARDIAN_KEY, selectedGuardian.characterId); } catch { /* optional */ }
  };
  const isBootstrapping = guardiansLoading || (!!sourceGuardianId && !allItems.length && (coreLoading || accountLoading));

  return (
    <AppShell
      activeSection="vault"
      loadoutsHref={activeGuardian ? `/guardian/${activeGuardian.characterId}/loadouts` : undefined}
      vaultHref="/vault"
      autoSync
      bungieSynced={!guardiansError && !coreError && !accountError}
      syncing={syncing || coreLoading || accountLoading}
      onSync={() => void syncNow()}
    >
      <main className={`min-h-screen px-4 py-6 lg:px-8 lg:py-8 ${compareIds.length ? "pb-44" : ""}`}>
        <div className="mx-auto max-w-[1540px]">
          <section className="relative overflow-hidden border border-white/10 bg-[#0b0e14] p-5 lg:p-7">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_90%_0%,rgba(66,159,188,0.14),transparent_50%)]" />
            <div className="relative flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-200/60">Account-wide inventory</p>
                <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.09em] sm:text-4xl">Vault <span className="text-cyan-200/75">2.0</span></h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">A shared Vault and all your Guardians in one place. Inspect actual Bungie rolls, and transfer eligible weapons or armor after confirmation.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {activeGuardian && <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-cyan-200/55" title="Guardian retained when navigating Vault, Builder and Loadouts">Active: {activeGuardian.className}</span>}
                {activeGuardian && <Link href={`/guardian/${activeGuardian.characterId}`} className="border border-white/15 bg-white/[0.04] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.13em] text-white/60 hover:border-cyan-300/30 hover:text-white" title={`Return to ${activeGuardian.className} Build`}>Open {activeGuardian.className} Build ↗</Link>}
                {compareIds.length > 0 && <button type="button" onClick={() => {setWeaponDetailsOpen(false);setArmorDetailsOpen(false);setCompareOpen(true);}} className="border border-violet-200/35 bg-violet-200/[0.08] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.13em] text-violet-100 hover:bg-violet-200/[0.15]">Compare Tray · {compareIds.length}</button>}
                <button type="button" disabled={!sourceGuardianId || syncing || transferBusy} onClick={() => void syncNow()} className="border border-cyan-200/25 bg-cyan-200/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.13em] text-cyan-100 hover:bg-cyan-200/[0.12] disabled:opacity-40">{syncing ? "Syncing…" : "Sync Bungie"}</button>
              </div>
            </div>
            <div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Gear across account", count: allItems.length },
                { label: "Stored in Vault", count: vaultCount },
                { label: "Weapons", count: weaponCount },
                { label: "Armor", count: armorCount },
              ].map((stat) => (
                <div key={stat.label} className="border border-white/[0.09] bg-black/20 px-3 py-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.13em] text-white/35">{stat.label}</p>
                  <p className="mt-1 text-xl font-black tabular-nums text-white/85">{stat.count}</p>
                </div>
              ))}
            </div>
          </section>

          {transferFeedback && (
            <div role="status" className={`mt-4 flex items-start justify-between gap-3 border p-4 text-xs leading-relaxed ${transferFeedback.kind === "success" ? "border-emerald-400/25 bg-emerald-400/[0.055] text-emerald-100" : "border-amber-400/25 bg-amber-400/[0.055] text-amber-100"}`}>
              <p>{transferFeedback.message}</p>
              <button type="button" aria-label="Dismiss transfer status" onClick={() => setTransferFeedback(null)} className="shrink-0 text-current opacity-60 hover:opacity-100">✕</button>
            </div>
          )}

          {conflictingIds.size > 0 && (
            <div role="status" className="mt-4 border border-amber-400/20 bg-amber-400/[0.045] px-4 py-3 text-xs leading-relaxed text-amber-100/80">
              <strong className="font-semibold">Inventory synchronization in progress:</strong> Bungie's Guardian and Vault responses currently disagree on the location of {conflictingIds.size} item{conflictingIds.size === 1 ? "" : "s"}. Disputed items appear only once in All Account until the location is confirmed; they are temporarily excluded from Vault/Guardian filters. Wait a moment or press Sync Bungie.
            </div>
          )}
          {(guardiansError || coreError || accountError) && (
            <div className="mt-4 border border-amber-400/20 bg-amber-400/[0.045] p-4 text-xs text-amber-100/80">
              {guardiansError && <p>Guardians: {guardiansError}</p>}
              {coreError && <p>Current Guardian: {coreError}</p>}
              {accountError && <p>Vault / other Guardians: {accountError}</p>}
              <p className="mt-1 text-amber-100/50">Loaded items remain visible. Retry with Sync Bungie.</p>
              {guardiansError && <Link href="/" className="mt-3 inline-block text-cyan-100 underline">Back to Guardians</Link>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border border-white/10 bg-[#090c12] px-4 py-2.5 text-[10px] uppercase tracking-[0.12em] text-white/45">
            {guardiansLoading ? <span>Loading Guardians…</span> : <span>{guardians.length} Guardians</span>}
            <span className="text-white/15">/</span>
            <span className={coreLoading ? "text-cyan-200" : coreError ? "text-amber-200" : "text-white/55"}>{coreLoading ? "Reading current Guardian…" : coreError ? "Guardian sync issue" : "Current Guardian ready"}</span>
            <span className="text-white/15">/</span>
            <span className={accountLoading ? "text-cyan-200" : accountError ? "text-amber-200" : "text-white/55"}>{accountLoading ? "Loading Vault + other Guardians…" : accountError ? "Account sync issue" : "Account gear ready"}</span>
          </div>

          <section className="mt-4 border border-white/10 bg-[#090c12] p-3 lg:p-4" aria-label="Inventory filters">
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/30">Browse</span>
              {([
                { id: "vault", label: "Shared Vault" },
                { id: "all", label: "All account" },
                ...guardians.map((guardian) => ({ id: guardian.characterId, label: guardian.className })),
              ]).map((option) => (
                <button key={option.id} type="button" onClick={() => chooseBrowseLocation(option.id)} className={`border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${location === option.id ? "border-cyan-200/40 bg-cyan-200/[0.09] text-cyan-100" : "border-white/10 text-white/45 hover:border-white/25 hover:text-white"}`}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "All gear"], ["weapon", "Weapons"], ["armor", "Armor"], ["artifact", "Artifacts"],
              ] as Array<[CategoryFilter, string]>).map(([key, label]) => (
                <button key={key} type="button" onClick={() => { setCategory(key); setSlot("all"); }} className={`border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition ${category === key ? "border-cyan-200/40 bg-cyan-200/[0.08] text-cyan-100" : "border-white/10 text-white/45 hover:border-white/20 hover:text-white/80"}`}>{label}</button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1.5fr)_1fr_1fr_1fr]">
              <input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Search name, item type or source…" aria-label="Search inventory" className="min-w-0 border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-cyan-200/45" />
              <select value={location} onChange={(event: ChangeEvent<HTMLSelectElement>) => chooseBrowseLocation(event.target.value)} aria-label="Filter by location" className="min-w-0 border border-white/10 bg-[#10151c] px-3 py-2.5 text-xs text-white/75 outline-none focus:border-cyan-200/45">
                <option value="all">Every location</option>
                <option value="vault">Vault only</option>
                {guardians.map((guardian) => <option key={guardian.characterId} value={guardian.characterId}>{guardian.className} · all gear</option>)}
              </select>
              <select value={slot} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSlot(event.target.value)} aria-label="Filter by equipment slot" className="min-w-0 border border-white/10 bg-[#10151c] px-3 py-2.5 text-xs text-white/75 outline-none focus:border-cyan-200/45">
                <option value="all">Every equipment slot</option>
                {slots.map(([hash, label]) => <option key={hash} value={hash}>{label}</option>)}
              </select>
              <select value={sortMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSortMode(event.target.value as SortMode)} aria-label="Sort inventory" className="min-w-0 border border-white/10 bg-[#10151c] px-3 py-2.5 text-xs text-white/75 outline-none focus:border-cyan-200/45">
                <option value="name">Sort · Name</option>
                <option value="power">Sort · Power (high)</option>
                <option value="tier">Sort · Gear tier (high)</option>
              </select>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-white/50">
                <input type="checkbox" checked={copiesOnly} onChange={(event: ChangeEvent<HTMLInputElement>) => setCopiesOnly(event.target.checked)} className="accent-cyan-300" />
                Show items with multiple copies
              </label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] tabular-nums text-white/40">Showing <strong className="text-cyan-100">{visibleItems.length}</strong> / {allItems.length}</span>
                <button type="button" onClick={() => setCompact((current) => !current)} className="border border-white/10 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-white/50 hover:text-white">{compact ? "Grid view" : "Compact view"}</button>
                <button type="button" onClick={() => { setQuery(""); setCategory("all"); setLocation("vault"); setSlot("all"); setSortMode("name"); setCopiesOnly(false); }} className="text-[10px] uppercase tracking-wider text-white/35 hover:text-white">Clear</button>
              </div>
            </div>
          </section>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="min-w-0 border border-white/10 bg-[#080b10] p-3 lg:p-4" aria-label="Inventory items">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.19em] text-white/45">Inventory browser</p>
                  <p className="mt-1 text-[11px] text-white/30">Each copy appears separately. Select any item to inspect its live Bungie roll.</p>
                </div>
              </div>
              {isBootstrapping && !visibleItems.length ? (
                <div className="flex min-h-60 flex-col items-center justify-center text-center">
                  <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/10 border-t-cyan-200" />
                  <p className="mt-4 text-[11px] uppercase tracking-[0.15em] text-white/45">Loading account inventory…</p>
                </div>
              ) : visibleItems.length ? (
                <div className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-2 sm:grid-cols-2 2xl:grid-cols-3"}>
                  {displayedItems.map((item) => <ItemCard key={item.browserId} item={item} selected={selectedId === item.browserId} copies={countsByHash.get(item.itemHash) ?? 1} compact={compact} onInspect={() => setSelectedId((current) => current === item.browserId ? null : item.browserId)} compared={compareIds.includes(item.browserId)} canCompare={canCompareItem(item)} onToggleCompare={() => toggleCompare(item)} />)}
                </div>
              ) : (
                <div className="border border-dashed border-white/10 px-5 py-14 text-center">
                  <p className="text-sm font-semibold text-white/60">No items match these filters.</p>
                  <p className="mt-2 text-xs text-white/35">Try another source, slot or search.</p>
                </div>
              )}
              {displayedItems.length < visibleItems.length && (
                <button type="button" onClick={() => setRenderLimit((current) => current + 120)} className="mt-4 w-full border border-white/10 bg-white/[0.035] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] text-cyan-100 hover:border-cyan-200/35 hover:bg-cyan-200/[0.055]">
                  Load more gear · {visibleItems.length - displayedItems.length} remaining
                </button>
              )}
            </section>

            <aside className="sticky top-32 hidden h-[calc(100vh-9rem)] min-h-[340px] overflow-hidden border border-white/10 bg-[#0c1017] lg:block" aria-label="Item inspector">
              <Inspector item={selectedItem} detail={selectedDetail} loading={selectedLoading} error={selectedError} onClose={() => setSelectedId(null)} onTransfer={openTransfer} onOpenWeapon={() => setWeaponDetailsOpen(true)} onOpenArmor={() => setArmorDetailsOpen(true)} onToggleCompare={toggleCompare} inCompare={Boolean(selectedItem && compareIds.includes(selectedItem.browserId))} canCompare={Boolean(selectedItem && canCompareItem(selectedItem))} transferBusy={transferBusy} transferBlocked={Boolean(selectedItem?.itemInstanceId && conflictingIds.has(normalizedInstanceId(selectedItem.itemInstanceId)!))} />
            </aside>
          </div>
        </div>
      </main>
      {compareIds.length > 0 && !compareOpen && (
        <div className="fixed inset-x-3 bottom-3 z-[120] mx-auto max-w-[1040px] border border-cyan-200/30 bg-[#101827]/95 p-3 shadow-[0_12px_50px_rgba(0,0,0,0.85)] backdrop-blur-xl" aria-label="Compare Tray">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-cyan-100">Compare Tray <span className="text-white/45">{compareIds.length}/{COMPARE_LIMIT}</span></p>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {compareEntries.map((entry) => <div key={entry.id} className="flex max-w-[165px] shrink-0 items-center gap-2 border border-white/10 bg-black/20 px-2 py-1">
                  {entry.item && itemImage(entry.item.icon) ? <img src={itemImage(entry.item.icon)!} alt="" className="h-7 w-7 shrink-0"/> : <div className="h-7 w-7 shrink-0 bg-white/5"/>}
                  <span className="max-w-[100px] truncate text-[10px] text-white/70" title={entry.item?.name}>{entry.item?.name ?? "Missing item"}</span>
                  <button type="button" onClick={() => setCompareIds((ids) => ids.filter((id) => id !== entry.id))} aria-label={`Remove ${entry.item?.name ?? "item"} from compare`} className="text-white/35 hover:text-white">✕</button>
                </div>)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCompareIds([])} className="border border-white/15 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/45 hover:text-white">Clear</button>
              <button type="button" onClick={() => { setWeaponDetailsOpen(false);setArmorDetailsOpen(false);setSelectedId(null);setCompareOpen(true); }} disabled={compareIds.length < 2} className="border border-cyan-200/50 bg-cyan-200/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-200/20 disabled:opacity-35">Compare {compareIds.length} ↗</button>
            </div>
          </div>
        </div>
      )}
      {compareOpen && compareEntries.length >= 2 && (
        <CompareTrayDialog entries={compareEntries} onClose={() => setCompareOpen(false)}
          onRemove={(id) => {setCompareIds((ids) => ids.filter((current) => current !== id)); if (compareIds.length <= 2) setCompareOpen(false);}}
          onInspect={(id) => {setCompareOpen(false);setSelectedId(id);}}
          onRetry={(id) => {const entry = compareEntries.find((value) => value.id === id); if (entry?.item?.itemInstanceId) setDetailErrors((current) => {const next={...current};delete next[entry.item!.itemInstanceId!];return next;});}} />
      )}
      {selectedItem && (
        <div className="fixed inset-0 z-[130] flex items-stretch justify-end lg:hidden">
          <button type="button" aria-label="Close item inspector" onClick={() => setSelectedId(null)} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <aside className="relative h-full w-[min(92vw,440px)] overflow-hidden border-l border-white/15 bg-[#0c1017] shadow-2xl" aria-label="Item inspector">
            <Inspector item={selectedItem} detail={selectedDetail} loading={selectedLoading} error={selectedError} onClose={() => setSelectedId(null)} onTransfer={openTransfer} onOpenWeapon={() => setWeaponDetailsOpen(true)} onOpenArmor={() => setArmorDetailsOpen(true)} onToggleCompare={toggleCompare} inCompare={Boolean(selectedItem && compareIds.includes(selectedItem.browserId))} canCompare={Boolean(selectedItem && canCompareItem(selectedItem))} transferBusy={transferBusy} transferBlocked={Boolean(selectedItem?.itemInstanceId && conflictingIds.has(normalizedInstanceId(selectedItem.itemInstanceId)!))} />
          </aside>
        </div>
      )}
      {weaponDetailsOpen && selectedItem && getCategory(selectedItem) === "weapon" && (
        <WeaponDetails key={selectedItem.browserId} item={selectedItem} detail={selectedDetail} loading={selectedLoading} error={selectedError} onClose={() => setWeaponDetailsOpen(false)} />
      )}
      {armorDetailsOpen && selectedItem && getCategory(selectedItem) === "armor" && (
        <ArmorDetails key={selectedItem.browserId} item={selectedItem} detail={selectedDetail} loading={selectedLoading} error={selectedError} onClose={() => setArmorDetailsOpen(false)} />
      )}
      {transferItemId && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="vault-transfer-heading" className="max-h-[92vh] w-full max-w-lg overflow-y-auto border border-cyan-200/25 bg-[#0d121a] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/55">Real Bungie inventory action</p>
                <h2 id="vault-transfer-heading" className="mt-2 text-xl font-black uppercase tracking-[0.07em] text-white">Confirm transfer</h2>
              </div>
              <button type="button" disabled={transferBusy} onClick={() => setTransferItemId(null)} aria-label="Cancel transfer" className="border border-white/10 px-2.5 py-1 text-white/55 hover:text-white disabled:opacity-30">✕</button>
            </div>
            {transferItem ? (
              <>
                <div className="mt-5 flex items-center gap-3 border border-white/10 bg-black/20 p-3">
                  {itemImage(transferItem.icon) ? <img src={itemImage(transferItem.icon)!} alt="" className="h-14 w-14 shrink-0 object-contain" /> : <div className="h-14 w-14 shrink-0 bg-white/5" />}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{transferItem.name}</p>
                    <p className="mt-1 text-[11px] text-white/45">Currently: {sourceName(transferItem)}</p>
                    <p className="mt-1 text-[10px] text-white/30">Instance {transferItem.itemInstanceId ?? "—"}</p>
                  </div>
                </div>
                {transferItem.location.type === "vault" ? (
                  <div className="mt-5">
                    <label htmlFor="vault-transfer-target" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">Destination Guardian</label>
                    <select id="vault-transfer-target" disabled={transferBusy} value={transferTargetId} onChange={(event: ChangeEvent<HTMLSelectElement>) => { setTransferTargetId(event.target.value); setTransferError(""); }} className="w-full border border-white/15 bg-[#151c27] px-3 py-3 text-sm text-white outline-none focus:border-cyan-200/50 disabled:opacity-40">
                      {transferGuardians.length === 0 && <option value="">No compatible Guardian available</option>}
                      {transferGuardians.map((guardian) => <option key={guardian.characterId} value={guardian.characterId}>{guardian.className} · Power {guardian.light}</option>)}
                    </select>
                    {transferItem.category === "armor" && <p className="mt-2 text-[11px] text-white/35">Only Guardians compatible with this armor class are shown.</p>}
                  </div>
                ) : (
                  <div className="mt-5 border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Destination</p>
                    <p className="mt-1 text-sm font-semibold text-cyan-100">Shared Vault</p>
                  </div>
                )}
                <p className="mt-5 text-xs leading-relaxed text-amber-100/75">This is a real operation on your Bungie account, not a Builder Preview. Items that are equipped must be unequipped first. The transfer cannot be undone automatically.</p>
                {transferError && <p role="alert" className="mt-4 border border-rose-400/25 bg-rose-400/[0.06] p-3 text-xs leading-relaxed text-rose-100">{transferError}</p>}
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <button type="button" disabled={transferBusy} onClick={() => setTransferItemId(null)} className="border border-white/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white disabled:opacity-30">Cancel</button>
                  <button type="button" disabled={transferBusy || !isTransferableInFirstPhase(transferItem) || (transferItem.location.type === "vault" && !transferGuardians.some((g) => g.characterId === transferTargetId))} onClick={() => void confirmTransfer()} className="border border-cyan-200/40 bg-cyan-200/[0.12] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-200/[0.2] disabled:cursor-not-allowed disabled:opacity-40">
                    {transferBusy ? "Submitting & verifying…" : "Confirm real transfer"}
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-5 space-y-4 text-sm text-white/50">
                <p>The item moved or disappeared during inventory synchronization. Close this dialog and select it again.</p>
                <button type="button" disabled={transferBusy} onClick={() => setTransferItemId(null)} className="border border-white/20 px-4 py-2 text-white/75">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
