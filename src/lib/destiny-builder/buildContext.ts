/**
 * Destiny Builder - Phase 8A: deterministic BuildContext foundation.
 *
 * Pure adapter for the existing core/account/detail responses and local draft.
 * No Bungie writes, React, storage, network calls, scores, or invented stats.
 * The callers decide when to load item details; this module does not fan out.
 */

export type ActivityKind = "general" | "pve" | "pvp" | "raid" | "nightfall" | "dungeon";
export type BuildMode = "owned" | "theory";
export type ItemCategory = "weapon" | "armor" | "artifact" | "other";
export type ItemAvailability = "owned" | "not_verified";
export type UnlockStatus = "equipped" | "unlocked" | "locked" | "unknown";
export type PerkAvailability = "equipped" | "selected_on_item" | "unlocked" | "possible";
export type PositionStatus = "confirmed" | "conflicting" | "unknown";

export interface GuardianInfo {
  characterId: string;
  className: string;
  classType?: number | null;
  light?: number | null;
}

export interface StatValue {
  statHash: number;
  name: string;
  value: number;
  description?: string;
}

export interface EffectTag {
  key: string;
  label: string;
  kind: "buff" | "debuff" | "effect";
}

export interface InventoryItem {
  itemHash: number;
  itemInstanceId: string | null;
  name: string;
  category: string;
  equipmentSlotHash?: number | null;
  bucketHash?: number | null;
  itemType?: number | null;
  itemTypeDisplayName?: string | null;
  classType?: number | null;
  power?: number | null;
  gearTier?: number | null;
  isEquipped?: boolean;
  stats?: StatValue[];
  armorStats?: StatValue[];
  armorStatTotal?: number | null;
  location?: {
    type: "equipped" | "characterInventory" | "vault" | "otherGuardian" | "missing";
    characterId?: string | null;
    className?: string | null;
    placement?: "equipped" | "inventory" | "vault" | null;
  } | null;
}

export interface SubclassPlug {
  plugHash: number;
  name: string;
  description?: string;
  equipped?: boolean;
  unlocked?: boolean;
  possible?: boolean;
  effectTags?: EffectTag[];
}

export interface SubclassSlot {
  socketIndex: number;
  slotType: string;
  equipped: SubclassPlug | null;
  available: SubclassPlug[];
}

export interface SubclassSetup {
  itemHash: number;
  name: string;
  super?: SubclassSlot | null;
  classAbility?: SubclassSlot | null;
  movement?: SubclassSlot | null;
  melee?: SubclassSlot | null;
  grenade?: SubclassSlot | null;
  aspects?: SubclassSlot[];
  fragments?: SubclassSlot[];
  other?: SubclassSlot[];
}

export interface GuardianSubclass {
  itemHash: number;
  name: string;
  element: string;
  equipped?: boolean;
  unlocked?: boolean;
  locked?: boolean;
  status?: "equipped" | "unlocked" | "locked";
  setup?: SubclassSetup | null;
}

export interface DetailPerk {
  socketIndex: number;
  plugHash: number;
  name: string;
  description?: string;
  state?: "selected" | "rolled" | "possible";
  effectTags?: EffectTag[];
}

export interface ItemDetail {
  itemHash: number;
  itemInstanceId: string;
  stats?: StatValue[];
  armorStats?: StatValue[];
  armorStatTotal?: number | null;
  selectedPerks?: DetailPerk[];
  intrinsicPerks?: Array<{ perkHash: number; name: string; description?: string; effectTags?: EffectTag[] }>;
  perkColumns?: Array<{
    socketIndex: number;
    selected: DetailPerk | null;
    all: DetailPerk[];
  }>;
  itemSet?: { name: string; perks: Array<{ name: string; requiredSetCount: number; effectTags?: EffectTag[] }> } | null;
  recoilDirection?: number | null;
}

export interface BuilderDraft {
  selectedSubclassHash?: number | null;
  previewSubclassPlugs?: Record<string, SubclassPlug>;
  previewGear?: Record<string, { item: InventoryItem; source?: "character" | "vault" | "otherGuardian" }>;
  previewArtifactIdentity?: string | null;
  previewArtifactPlugs?: Record<string, number>;
}

export interface CoreSnapshot {
  equipment: InventoryItem[];
  inventory: InventoryItem[];
  subclasses: GuardianSubclass[];
  subclassSetup?: SubclassSetup | null;
  artifact?: {
    artifactHash?: number | null;
    name?: string | null;
    tiers?: Array<{ items?: Array<{ itemHash: number; name: string; isActive: boolean; isUnlocked: boolean }> }>;
  } | null;
}

export interface AccountSnapshot {
  vault: InventoryItem[];
  otherGuardianItems: InventoryItem[];
}

export interface BuildContextInput {
  guardian: GuardianInfo;
  core: CoreSnapshot;
  account?: AccountSnapshot | null;
  draft?: BuilderDraft | null;
  detailsByInstanceId?: Record<string, ItemDetail | null | undefined>;
  activity?: ActivityKind;
  mode?: BuildMode;
  goal?: string;
}

export interface KnownItem {
  /** Stable only when a Bungie itemInstanceId exists. */
  identity: string;
  itemHash: number;
  itemInstanceId: string | null;
  name: string;
  category: ItemCategory;
  equipmentSlotHash: number | null;
  power: number | null;
  gearTier: number | null;
  classType: number | null;
  availability: ItemAvailability;
  position: string | null;
  positionStatus: PositionStatus;
  detailsLoaded: boolean;
}

export interface ChosenPerk {
  plugHash: number;
  name: string;
  description: string;
  availability: PerkAvailability;
  effectTags: EffectTag[];
  /** Effect tags are derived from text, not official Bungie buff/debuff fields. */
  effectOrigin: "inferred_from_description";
}

export interface SelectedSocket {
  socketIndex: number;
  slotType: string;
  perk: ChosenPerk | null;
  isPreview: boolean;
}

export interface SelectedSubclass {
  itemHash: number;
  name: string;
  element: string;
  unlockStatus: UnlockStatus;
  theoretical: boolean;
  isPreview: boolean;
  sockets: SelectedSocket[];
}

export interface SelectedGear {
  slotHash: number;
  item: KnownItem;
  isPreview: boolean;
  detailsLoaded: boolean;
  stats: StatValue[] | null;
  selectedPerks: ChosenPerk[] | null;
  intrinsicPerks: ChosenPerk[] | null;
  recoilDirection: number | null;
  /** Requirements are reported; activation is NOT inferred here. */
  setBonuses: Array<{ setName: string; perkName: string; requiredPieces: number; effectTags: EffectTag[] }> | null;
}

export interface SelectedArtifact {
  item: KnownItem | null;
  name: string | null;
  selectedPerks: ChosenPerk[] | null;
  isPreview: boolean;
}

export interface BuildContext {
  version: 1;
  guardian: GuardianInfo;
  activity: ActivityKind;
  mode: BuildMode;
  goal: string;
  account: {
    /** False means Vault/other Guardians have not finished loading. */
    complete: boolean;
    items: KnownItem[];
  };
  build: {
    subclass: SelectedSubclass | null;
    gear: SelectedGear[];
    artifact: SelectedArtifact;
  };
  warnings: string[];
}

function categoryOf(item: InventoryItem): ItemCategory {
  if (item.category === "weapon" || item.category === "armor") return item.category;
  if (item.itemType === 28 || item.itemTypeDisplayName?.toLowerCase().includes("artifact")) return "artifact";
  return "other";
}

/** Mirrors the identity format used by the existing Guardian Build page. */
export function itemIdentity(item: InventoryItem): string {
  if (item.itemInstanceId) return item.itemInstanceId;
  const slot = item.equipmentSlotHash ?? item.bucketHash ?? "unknown";
  return `${item.itemHash}-${slot}`;
}

function positionOf(item: InventoryItem): string | null {
  const position = item.location;
  if (!position || position.type === "missing") return null;
  if (position.type === "vault") return "vault";
  if (position.type === "equipped" || position.placement === "equipped")
    return `${position.characterId ?? "unknown"}:equipped`;
  return `${position.characterId ?? "unknown"}:inventory`;
}

function knownItem(item: InventoryItem, status: PositionStatus, detail: ItemDetail | null): KnownItem {
  return {
    identity: itemIdentity(item),
    itemHash: item.itemHash,
    itemInstanceId: item.itemInstanceId,
    name: item.name,
    category: categoryOf(item),
    equipmentSlotHash: item.equipmentSlotHash ?? item.bucketHash ?? null,
    power: item.power ?? null,
    gearTier: item.gearTier ?? null,
    classType: item.classType ?? null,
    availability: "owned",
    position: status === "confirmed" ? positionOf(item) : null,
    positionStatus: status,
    detailsLoaded: detail !== null,
  };
}

/**
 * scope=detail selectedPerks can also contain alternate rolled/possible plugs.
 * The enclosing selectedPerks array is authoritative for legacy records without
 * a state, but an explicit rolled/possible state must NEVER be promoted to an
 * active perk. Leave socket-option inspection to perkColumns.
 */
function isActiveDetailPerk(perk: DetailPerk): boolean {
  return perk.state === "selected" || perk.state === undefined;
}

function toChosenPerk(perk: SubclassPlug | DetailPerk, availability: PerkAvailability): ChosenPerk {
  return {
    plugHash: perk.plugHash,
    name: perk.name,
    description: perk.description ?? "",
    availability,
    effectTags: perk.effectTags ?? [],
    effectOrigin: "inferred_from_description",
  };
}

function subclassStatus(value: GuardianSubclass): UnlockStatus {
  if (value.equipped || value.status === "equipped") return "equipped";
  if (value.unlocked || value.status === "unlocked") return "unlocked";
  if (value.locked || value.status === "locked") return "locked";
  return "unknown";
}

function sameItem(a: InventoryItem, b: InventoryItem): boolean {
  // Never confuse two distinct copies of the same weapon.
  if (a.itemInstanceId && b.itemInstanceId) return a.itemInstanceId === b.itemInstanceId;
  return !a.itemInstanceId && !b.itemInstanceId && a.itemHash === b.itemHash &&
    (a.equipmentSlotHash ?? a.bucketHash) === (b.equipmentSlotHash ?? b.bucketHash);
}

export function createBuildContext(input: BuildContextInput): BuildContext {
  const { guardian, core, account, draft, detailsByInstanceId } = input;
  const warnings: string[] = [];
  const accountComplete = account != null;
  if (!accountComplete) warnings.push("Account scope has not finished loading: Vault and other Guardian candidates are incomplete.");

  const snapshots: InventoryItem[] = [
    ...(core.equipment ?? []), ...(core.inventory ?? []),
    ...(account?.vault ?? []), ...(account?.otherGuardianItems ?? []),
  ];

  // Per-instance reconciliation. Conflicting locations are not guessed: no
  // transfer or recommendation engine should treat one of them as confirmed.
  const unique = new Map<string, { item: InventoryItem; positions: Set<string>; ambiguous: boolean }>();
  let stacklessIndex = 0;
  for (const item of snapshots) {
    if (!Number.isFinite(item.itemHash) || !item.name) continue;
    // Non-instanced stackables cannot safely be deduplicated by itemHash.
    const key = item.itemInstanceId ? `instance:${item.itemInstanceId}` : `stack:${stacklessIndex++}`;
    const position = positionOf(item);
    const existing = unique.get(key);
    if (!existing) unique.set(key, { item, positions: new Set(position ? [position] : []), ambiguous: false });
    else {
      if (position) existing.positions.add(position);
      existing.ambiguous = existing.positions.size > 1;
    }
  }

  const entries = Array.from(unique.values());
  const items: KnownItem[] = entries.map(({ item, positions, ambiguous }) => {
    const detail = item.itemInstanceId ? detailsByInstanceId?.[item.itemInstanceId] ?? null : null;
    const status: PositionStatus = ambiguous ? "conflicting" : positions.size === 0 ? "unknown" : "confirmed";
    const result = knownItem(item, status, detail);
    // If the first copy lacked location metadata, use the one position that
    // the other snapshot confirmed instead of silently losing it.
    if (status === "confirmed" && !result.position) result.position = positions.values().next().value ?? null;
    return result;
  });
  if (entries.some((entry) => entry.ambiguous))
    warnings.push("Some item instances have conflicting Vault/Guardian positions; their location is unverified.");

  const byInstance = new Map(items.filter((item) => item.itemInstanceId).map((item) => [item.itemInstanceId, item] as const));
  const actualItemByInstance = new Map(entries.filter((entry) => entry.item.itemInstanceId).map((entry) => [entry.item.itemInstanceId, entry.item] as const));
  const resolveOwned = (requested: InventoryItem): KnownItem | null => {
    if (requested.itemInstanceId) {
      const matched = byInstance.get(requested.itemInstanceId);
      return matched && matched.itemHash === requested.itemHash ? matched : null;
    }
    const matches = items.filter((candidate) => !candidate.itemInstanceId && candidate.itemHash === requested.itemHash);
    return matches.length === 1 ? matches[0] : null;
  };

  const equippedGear = core.equipment.filter((item) => item.category === "weapon" || item.category === "armor");
  const gear: SelectedGear[] = [];
  for (const equipped of equippedGear) {
    const slot = equipped.equipmentSlotHash ?? equipped.bucketHash ?? null;
    if (slot === null) continue;
    const proposed = draft?.previewGear?.[String(slot)]?.item;
    let chosen = equipped;
    let isPreview = false;
    if (proposed && !sameItem(proposed, equipped)) {
      const resolved = resolveOwned(proposed);
      if (!resolved) {
        warnings.push(`Preview gear in slot ${slot} cannot be verified as owned and was ignored.`);
      } else if (resolved.positionStatus !== "confirmed") {
        warnings.push(`Preview gear ${proposed.name} has an uncertain location and was ignored.`);
      } else if (resolved.category !== categoryOf(equipped) || resolved.equipmentSlotHash !== slot) {
        warnings.push(`Preview gear ${proposed.name} does not match the equipment slot and was ignored.`);
      } else if (resolved.category === "armor" && resolved.classType !== null && resolved.classType !== 3 &&
        guardian.classType !== undefined && guardian.classType !== null && resolved.classType !== guardian.classType) {
        warnings.push(`Preview armor ${proposed.name} belongs to a different Guardian class and was ignored.`);
      } else {
        chosen = proposed;
        isPreview = true;
      }
    }
    const item = resolveOwned(chosen);
    if (!item) continue;
    // Drafts store embedded item objects; use fresh Bungie data, never stats
    // or properties copied from a potentially stale draft.
    const actualItem = chosen.itemInstanceId ? actualItemByInstance.get(chosen.itemInstanceId) ?? chosen : chosen;
    const detail = actualItem.itemInstanceId ? detailsByInstanceId?.[actualItem.itemInstanceId] ?? null : null;
    const rawStats = actualItem.category === "armor" ? detail?.armorStats ?? actualItem.armorStats : detail?.stats ?? actualItem.stats;
    gear.push({
      slotHash: slot, item, isPreview, detailsLoaded: detail !== null,
      stats: rawStats?.length ? rawStats : null,
      selectedPerks: detail ? (detail.selectedPerks ?? []).filter(isActiveDetailPerk).map((p) => toChosenPerk(p, "selected_on_item")) : null,
      intrinsicPerks: detail ? (detail.intrinsicPerks ?? []).map((p) => ({
        plugHash: p.perkHash, name: p.name, description: p.description ?? "",
        availability: "selected_on_item" as const, effectTags: p.effectTags ?? [],
        effectOrigin: "inferred_from_description" as const,
      })) : null,
      recoilDirection: detail?.recoilDirection ?? null,
      setBonuses: detail ? (detail.itemSet?.perks ?? []).map((perk) => ({
        setName: detail.itemSet?.name ?? "", perkName: perk.name,
        requiredPieces: perk.requiredSetCount, effectTags: perk.effectTags ?? [],
      })) : null,
    });
  }

  if (draft?.selectedSubclassHash != null && !core.subclasses.some((item) => item.itemHash === draft.selectedSubclassHash))
    warnings.push(`Preview subclass ${draft.selectedSubclassHash} is not in the Bungie subclass catalog and was ignored.`);
  const selectedSubclass = core.subclasses.find((item) => item.itemHash === draft?.selectedSubclassHash) ??
    core.subclasses.find((item) => item.equipped) ?? null;
  let subclass: SelectedSubclass | null = null;
  if (selectedSubclass) {
    const unlockStatus = subclassStatus(selectedSubclass);
    const setup = selectedSubclass.setup ?? core.subclassSetup ?? null;
    const groups = setup ? [setup.super, setup.classAbility, setup.movement, setup.melee, setup.grenade,
      ...(setup.aspects ?? []), ...(setup.fragments ?? []), ...(setup.other ?? [])] : [];
    const sockets: SelectedSocket[] = [];
    for (const slot of groups) {
      if (!slot) continue;
      const draftPlug = draft?.previewSubclassPlugs?.[`${selectedSubclass.itemHash}:${slot.socketIndex}`];
      const selectedOption = draftPlug ? [slot.equipped, ...slot.available].find((plug) => plug?.plugHash === draftPlug.plugHash) ?? null : null;
      if (draftPlug && !selectedOption) warnings.push(`Subclass plug ${draftPlug.plugHash} was not found in socket ${slot.socketIndex}.`);
      const perk = selectedOption ?? slot.equipped;
      const actual = slot.equipped?.plugHash === perk?.plugHash;
      sockets.push({
        socketIndex: slot.socketIndex, slotType: slot.slotType,
        perk: perk ? toChosenPerk(perk, actual ? "equipped" : perk.unlocked ? "unlocked" : "possible") : null,
        isPreview: Boolean(selectedOption && !actual),
      });
    }
    const theoretical = unlockStatus === "locked" || sockets.some((socket) => socket.perk?.availability === "possible");
    if (theoretical && input.mode !== "theory") warnings.push("The subclass preview contains locked or Manifest-only choices; this build is theoretical.");
    subclass = {
      itemHash: selectedSubclass.itemHash, name: selectedSubclass.name, element: selectedSubclass.element,
      unlockStatus, theoretical, isPreview: !selectedSubclass.equipped, sockets,
    };
  }

  const artifactEquipped = core.equipment.find((item) => categoryOf(item) === "artifact") ?? null;
  const artifactCandidates = [...core.equipment, ...core.inventory].filter((item) => categoryOf(item) === "artifact");
  const artifactChoice = artifactCandidates.find((item) => draft?.previewArtifactIdentity === itemIdentity(item)) ?? artifactEquipped;
  const artifactDetail = artifactChoice?.itemInstanceId ? detailsByInstanceId?.[artifactChoice.itemInstanceId] ?? null : null;
  let artifactPerks: ChosenPerk[] | null = null;
  if (artifactDetail) {
    if (artifactDetail.perkColumns?.length) {
      artifactPerks = [];
      for (const column of artifactDetail.perkColumns) {
        const override = draft?.previewArtifactPlugs?.[String(column.socketIndex)];
        const option = override !== undefined ? column.all.find((perk) => perk.plugHash === override) : null;
        if (override !== undefined && !option)
          warnings.push(`Artifact perk ${override} is not in the options for socket ${column.socketIndex}.`);
        const resolved = option ?? column.selected;
        if (resolved) artifactPerks.push(toChosenPerk(resolved, resolved.plugHash === column.selected?.plugHash ? "selected_on_item" : "possible"));
      }
    } else if (artifactDetail.selectedPerks) {
      artifactPerks = artifactDetail.selectedPerks.filter(isActiveDetailPerk).map((p) => toChosenPerk(p, "selected_on_item"));
    }
  }

  if (Object.keys(draft?.previewArtifactPlugs ?? {}).length && !artifactDetail?.perkColumns?.length)
    warnings.push("Artifact perk preview cannot be resolved until detailed perk columns are loaded.");

  const artifact: SelectedArtifact = {
    item: artifactChoice ? resolveOwned(artifactChoice) : null,
    name: artifactChoice?.name ?? core.artifact?.name ?? null,
    selectedPerks: artifactPerks,
    isPreview: Boolean(artifactChoice && artifactEquipped && !sameItem(artifactChoice, artifactEquipped)) ||
      Boolean(Object.keys(draft?.previewArtifactPlugs ?? {}).length),
  };

  return {
    version: 1,
    guardian,
    activity: input.activity ?? "general",
    mode: input.mode ?? "owned",
    goal: input.goal?.trim() ?? "",
    account: { complete: accountComplete, items },
    build: { subclass, gear, artifact },
    warnings,
  };
}
