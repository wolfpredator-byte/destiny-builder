"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/destiny-builder/AppShell";
import { resolveSharedItemDetail, sharedItemCacheUrl } from "@/lib/destiny-builder/sharedItemDetailCache";

type Character = {
  characterId: string;
  className: string;
  light: number;
  emblemPath: string;
  emblemBackgroundPath: string;
  dateLastPlayed: string;
};

type ItemLocationType =
  | "equipped"
  | "characterInventory"
  | "vault"
  | "otherGuardian"
  | "missing";

type ItemLocation = {
  type: ItemLocationType;
  characterId: string | null;
  classType: number | null;
  className: string | null;
  placement: "equipped" | "inventory" | "vault" | null;
};

type DestinyItem = {
  location?: ItemLocation | null;
  itemHash: number;
  itemInstanceId: string | null;
  bucketHash: number | null;
  locationBucketHash: number | null;
  equipmentSlotHash: number | null;
  quantity: number;

  name: string;
  description: string;
  icon: string | null;

  itemTypeDisplayName: string | null;
  itemType: number | null;
  itemSubType: number | null;
  classType: number | null;

  tierTypeName: string | null;
  equippable: boolean;

  category: string;

  power: number | null;
gearTier?: number | null;
damageType: number | null;
damageTypeHash: number | null;
isEquipped: boolean;
canEquip: boolean | null;

stats: {
  statHash: number;
  name: string;
  description: string;
  value: number;
}[];

roll: {
  socketIndex: number;
  plugHash: number | null;
  name: string;
  description: string;
  icon: string | null;
  type: string;
}[];

armorStats: {
  statHash: number;
  name: string;
  description: string;
  value: number;
}[];

armorStatTotal: number | null;
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

type SubclassStatus =
  | "equipped"
  | "unlocked"
  | "locked";

type GuardianSubclass = {
  itemHash: number;
  name: string;
  icon: string | null;
  element:
    | "arc"
    | "solar"
    | "void"
    | "stasis"
    | "strand"
    | "prismatic";
  classType: number;
  status: SubclassStatus;
  equipped: boolean;
  unlocked: boolean;
  locked: boolean;
  usableNow: boolean;
  itemInstanceId: string | null;
  setup: SubclassSetup | null;
};

type GearPreviewSource =
  | "character"
  | "vault"
  | "otherGuardian";

type GearPreviewSelection = {
  item: DestinyItem;
  source: GearPreviewSource;
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
  itemTypeDisplayName: string | null;
  itemType: number | null;
  itemSubType: number | null;
  category: string;
  tierTypeName: string | null;
  gearTier: number | null;
  power: number | null;
  damageType: number | null;
  damageTypeHash: number | null;
  stats: DestinyItem["stats"];
  armorStats: DestinyItem["armorStats"];
  armorStatTotal: number | null;
  selectedPerks: DetailPerk[];
  perkColumns: {
    socketIndex: number;
    selected: DetailPerk | null;
    rolled: DetailPerk[];
    possible: DetailPerk[];
    all: DetailPerk[];
  }[];
  intrinsicPerks: {
    perkHash: number;
    name: string;
    description: string;
    icon: string | null;
    isDisplayable: boolean;
    effectTags: CombatEffectTag[];
  }[];
  itemSet: null | {
    hash: number;
    name: string;
    icon: string | null;
    perks: {
      requiredSetCount: number;
      perkHash: number | null;
      name: string;
      description: string;
      icon: string | null;
      effectTags: CombatEffectTag[];
    }[];
  };
  recoilDirection: number | null;
};

type HoveredItemState = {
  item: DestinyItem;
  anchorX: number;
  anchorY: number;
  viewportWidth: number;
  viewportHeight: number;
};

const GUARDIAN_LOADING_MESSAGES = [
  "Contacting Bungie API...",
  "Loading Guardian profile...",
  "Resolving inventory definitions...",
  "Reading subclass configuration...",
  "Preparing loadout preview...",
];

export default function GuardianPage() {
  const params = useParams();
  const characterId = params.characterId as string;

  const [characters, setCharacters] = useState<Character[]>([]);
  const [character, setCharacter] = useState<Character | null>(null);

  const [inventory, setInventory] = useState<DestinyItem[]>([]);
  const [equipment, setEquipment] = useState<DestinyItem[]>([]);
  const [vaultItems, setVaultItems] = useState<DestinyItem[]>([]);
  const [otherGuardianItems, setOtherGuardianItems] =
    useState<DestinyItem[]>([]);
  const [vaultError, setVaultError] = useState("");
  const [subclassSetup, setSubclassSetup] =
    useState<SubclassSetup | null>(null);
  const [subclasses, setSubclasses] = useState<GuardianSubclass[]>([]);
  const [selectedSubclassHash, setSelectedSubclassHash] =
    useState<number | null>(null);
  const [quickLoadoutOpen, setQuickLoadoutOpen] = useState(false);
  const [activeBuilderLoadoutId, setActiveBuilderLoadoutId] = useState<string | null>(null);
  const [subclassQuickView, setSubclassQuickView] = useState<{ slot: SubclassSlot; label: string } | null>(null);
  const [previewSubclassPlugs, setPreviewSubclassPlugs] =
    useState<Record<string, SubclassPlug>>({});

  const [previewGear, setPreviewGear] = useState<
    Record<string, GearPreviewSelection>
  >({});
  const [openGearBucketHash, setOpenGearBucketHash] =
    useState<number | null>(null);
  const [gearSearch, setGearSearch] = useState("");
  const [includeAccountGearInPicker, setIncludeAccountGearInPicker] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingMessageIndex, setLoadingMessageIndex] =
    useState(0);
  const [accountGearLoading, setAccountGearLoading] =
    useState(true);
  const [accountGearError, setAccountGearError] =
    useState("");
  const [accountGearReadyNotice, setAccountGearReadyNotice] =
    useState(false);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const [seasonalArtifact, setSeasonalArtifact] = useState<any>(null);
  const [previewArtifactIdentity, setPreviewArtifactIdentity] =
    useState<string | null>(null);
  const [previewArtifactPlugs, setPreviewArtifactPlugs] =
    useState<Record<string, number>>({});
  const [inGameLoadouts, setInGameLoadouts] = useState<any[]>([]);
  const [builderLoadouts, setBuilderLoadouts] = useState<any[]>([]);
  const [builderLoadoutName, setBuilderLoadoutName] = useState("");
  const [selectedInGameLoadout, setSelectedInGameLoadout] =
    useState<any | null>(null);
  const [quickSaveOpen, setQuickSaveOpen] = useState(false);

  const [hoveredItem, setHoveredItem] =
    useState<HoveredItemState | null>(null);
  const [compareBaseline, setCompareBaseline] =
    useState<DestinyItem | null>(null);
  const [detailsItem, setDetailsItem] =
    useState<DestinyItem | null>(null);
  const [detailLoadingIds, setDetailLoadingIds] =
    useState<Record<string, boolean>>({});
  const [itemDetails, setItemDetails] =
    useState<Record<string, ItemDetail>>({});
  const detailCacheRef =
    useRef<Record<string, ItemDetail>>({});
  const hoverCloseTimerRef = useRef<number | null>(null);
  const pendingLoadoutHandledRef = useRef(false);
  // A state-based hydration barrier: never save defaults before the stored
  // Builder Preview has actually been applied by React.
  const [draftReadyFor, setDraftReadyFor] = useState<string | null>(null);
  const lastPointerRef = useRef({
    x: 24,
    y: 96,
    viewportWidth: 1280,
    viewportHeight: 720,
  });
  const coreSyncInFlightRef = useRef(false);
  const accountSyncInFlightRef = useRef(false);
  const liveSubclassStateRef = useRef({
    selectedSubclassHash: null as number | null,
    previewSubclassPlugs: {} as Record<string, SubclassPlug>,
    subclasses: [] as GuardianSubclass[],
  });

  useEffect(() => {
    liveSubclassStateRef.current = {
      selectedSubclassHash,
      previewSubclassPlugs,
      subclasses,
    };
  }, [selectedSubclassHash, previewSubclassPlugs, subclasses]);

  useEffect(() => {
    const updatePointer = (event: MouseEvent) => {
      lastPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    };

    window.addEventListener("mousemove", updatePointer, { passive: true });
    return () => window.removeEventListener("mousemove", updatePointer);
  }, []);

  // Always cancel a pending hover-close timer when this Guardian page unmounts.
  useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current !== null) {
        window.clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
    };
  }, []);

  // The Destiny-style gear grid is a true modal; Escape closes it without
  // changing the user's existing Builder preview.
  useEffect(() => {
    if (openGearBucketHash === null) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenGearBucketHash(null);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [openGearBucketHash]);

  // Status messages that are not tied to an active Bungie sync are transient.
  useEffect(() => {
    if (!syncMessage || syncing) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSyncMessage("");
    }, 4500);

    return () => window.clearTimeout(timeout);
  }, [syncMessage, syncing]);

  // Prevent the page behind our main overlays from scrolling while a modal is open.
  const blockingOverlayOpen = Boolean(
    detailsItem ||
      selectedInGameLoadout ||
      quickSaveOpen ||
      openGearBucketHash !== null
  );

  useEffect(() => {
    if (!blockingOverlayOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [blockingOverlayOpen]);

  // Resolve the saved draft during the SAME guarded async load as the Guardian.
  // In dev, React Strict Mode may start this effect twice. An obsolete request
  // must never reset a draft that was already restored by the current request.
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    setLoading(true);
    setDraftReadyFor(null);
    setError("");

    async function loadGuardian() {
      try {
        const [charactersResponse, inventoryResponse] = await Promise.all([
          fetch("/api/destiny/characters", {
            cache: "no-store",
            signal: abort.signal,
          }),
          fetch(`/api/destiny/characters/${characterId}/inventory?scope=core`, {
            cache: "no-store",
            signal: abort.signal,
          }),
        ]);

        const [charactersData, inventoryData] = await Promise.all([
          charactersResponse.json(),
          inventoryResponse.json(),
        ]);
        if (cancelled) return;

        if (charactersResponse.status === 401 || inventoryResponse.status === 401) {
          const refreshResponse = await fetch("/api/auth/refresh", {
            method: "POST",
            signal: abort.signal,
          });
          if (cancelled) return;
          if (refreshResponse.ok) {
            window.location.reload();
            return;
          }
        }

        if (!charactersResponse.ok || !charactersData.success) {
          throw new Error(charactersData.error || "Failed to load character");
        }
        if (!inventoryResponse.ok || !inventoryData.success) {
          throw new Error(inventoryData.error || "Failed to load inventory");
        }

        const nextCharacters: Character[] = Array.isArray(charactersData.characters)
          ? charactersData.characters : [];
        const selectedCharacter = nextCharacters.find(
          (entry) => String(entry.characterId) === String(characterId)
        );
        if (!selectedCharacter) throw new Error("Guardian not found");

        const loadedSubclasses: GuardianSubclass[] = Array.isArray(inventoryData.subclasses)
          ? inventoryData.subclasses : [];
        const equippedSubclass = loadedSubclasses.find((entry) => entry.equipped);

        // Read AFTER the network request, immediately before committing React
        // state, so even an Assistant edit made while loading is not lost.
        // Draft is never replaced by a default merely because Bungie refreshed.
        let restored: Record<string, unknown> = {};
        try {
          const raw = window.localStorage.getItem(`destiny-builder-draft:${characterId}`);
          if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              restored = parsed as Record<string, unknown>;
            }
          }
        } catch {
          // Malformed optional drafts must not prevent a Guardian from loading.
        }
        if (cancelled) return;

        const savedGear = restored.previewGear;
        const savedSubclassPlugs = restored.previewSubclassPlugs;
        const savedArtifactPlugs = restored.previewArtifactPlugs;
        const savedSubclassHash = restored.selectedSubclassHash;
        const validSavedSubclass = typeof savedSubclassHash === "number" &&
          loadedSubclasses.some((entry) => entry.itemHash === savedSubclassHash);

        setCharacters(nextCharacters);
        setCharacter(selectedCharacter);
        setInventory(Array.isArray(inventoryData.inventory) ? inventoryData.inventory : []);
        setEquipment(Array.isArray(inventoryData.equipment) ? inventoryData.equipment : []);
        setVaultItems([]);
        setOtherGuardianItems([]);
        setVaultError("");
        setPreviewGear(savedGear && typeof savedGear === "object" && !Array.isArray(savedGear)
          ? savedGear as Record<string, GearPreviewSelection> : {});
        setPreviewSubclassPlugs(savedSubclassPlugs && typeof savedSubclassPlugs === "object" && !Array.isArray(savedSubclassPlugs)
          ? savedSubclassPlugs as Record<string, SubclassPlug> : {});
        setPreviewArtifactIdentity(typeof restored.previewArtifactIdentity === "string"
          ? restored.previewArtifactIdentity : null);
        setPreviewArtifactPlugs(savedArtifactPlugs && typeof savedArtifactPlugs === "object" && !Array.isArray(savedArtifactPlugs)
          ? savedArtifactPlugs as Record<string, number> : {});
        setOpenGearBucketHash(null);
        setSubclassSetup(inventoryData.subclassSetup ?? null);
        setSubclasses(loadedSubclasses);
        setSeasonalArtifact(inventoryData.artifact ?? inventoryData.seasonalArtifact ?? null);
        setInGameLoadouts(Array.isArray(inventoryData.inGameLoadouts) ? inventoryData.inGameLoadouts : []);
        setSelectedSubclassHash(validSavedSubclass
          ? savedSubclassHash as number
          : equippedSubclass?.itemHash ?? loadedSubclasses[0]?.itemHash ?? null);

        // This barrier and all the restored values commit in one React batch.
        // The persistence effect cannot run with empty default state.
        setDraftReadyFor(characterId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadGuardian();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [characterId]);

  useEffect(() => {
    if (!loading) {
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingMessageIndex((current) =>
        Math.min(
          current + 1,
          GUARDIAN_LOADING_MESSAGES.length - 1
        )
      );
    }, 1200);

    return () => window.clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (loading || !character) {
      return;
    }

    let cancelled = false;

    async function loadAccountGear() {
      try {
        setAccountGearLoading(true);
        setAccountGearError("");
        setAccountGearReadyNotice(false);

        const response = await fetch(
          `/api/destiny/characters/${characterId}/inventory?scope=account`,
          { cache: "no-store" }
        );

        const data = await response.json().catch(() => null);

        if (response.status === 401) {
          const refreshResponse = await fetch(
            "/api/auth/refresh",
            { method: "POST" }
          );

          if (refreshResponse.ok) {
            window.location.reload();
            return;
          }
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.error || "Failed to load account gear"
          );
        }

        if (cancelled) {
          return;
        }

        setVaultItems(
          Array.isArray(data.vault) ? data.vault : []
        );
        setOtherGuardianItems(
          Array.isArray(data.otherGuardianItems)
            ? data.otherGuardianItems
            : []
        );
        setVaultError("");
        setAccountGearReadyNotice(true);
      } catch (err) {
        if (cancelled) {
          return;
        }

        const message =
          err instanceof Error
            ? err.message
            : "Failed to load account gear";

        setAccountGearReadyNotice(false);
        setAccountGearError(message);
        setVaultError(message);
      } finally {
        if (!cancelled) {
          setAccountGearLoading(false);
        }
      }
    }

    loadAccountGear();

    return () => {
      cancelled = true;
    };
  }, [characterId, loading, character]);

  useEffect(() => {
    if (!accountGearReadyNotice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setAccountGearReadyNotice(false);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [accountGearReadyNotice]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        "destiny-builder-loadouts"
      );

      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setBuilderLoadouts(parsed);
        }
      }
    } catch {
      // Local loadouts are optional; ignore malformed storage.
    }
  }, []);

  // The first Guardian request now restores all preview fields atomically.
  // Do not add another restore effect here: it can race with the initial save.

  useEffect(() => {
    if (
      loading ||
      !character ||
      String(character.characterId) !== String(characterId) ||
      draftReadyFor !== characterId
    ) {
      return;
    }

    try {
      window.localStorage.setItem(
        `destiny-builder-draft:${characterId}`,
        JSON.stringify({
          selectedSubclassHash,
          previewSubclassPlugs,
          previewGear,
          previewArtifactIdentity,
          previewArtifactPlugs,
        })
      );
    } catch {
      // Draft persistence is best-effort.
    }
  }, [
    loading,
    character,
    characterId,
    draftReadyFor,
    selectedSubclassHash,
    previewSubclassPlugs,
    previewGear,
    previewArtifactIdentity,
    previewArtifactPlugs,
  ]);

  // Character Stats in the Hybrid Builder need the detailed Armor 3.0
  // stat payload. Core inventory intentionally stays lightweight, so resolve
  // only the five effective armor pieces in the background.
  useEffect(() => {
    if (loading || !character) {
      return;
    }

    const effectiveArmorForStats = equipment
      .filter((item) => item.category === "armor")
      .map((equippedItem) => {
        const slotHash = getEquipmentSlotHash(equippedItem);
        return slotHash !== null
          ? previewGear[String(slotHash)]?.item ?? equippedItem
          : equippedItem;
      });

    for (const item of effectiveArmorForStats) {
      if (!item.itemInstanceId) {
        continue;
      }

      if (detailCacheRef.current[item.itemInstanceId]?.itemHash !== item.itemHash) {
        void ensureItemDetail(item);
      }
    }
  }, [loading, character, equipment, previewGear, characterId]);

  async function fetchWithSessionRefresh(url: string) {
    let response = await fetch(url, { cache: "no-store" });

    if (response.status === 401) {
      const refreshResponse = await fetch(
        "/api/auth/refresh",
        { method: "POST" }
      );

      if (refreshResponse.ok) {
        response = await fetch(url, { cache: "no-store" });
      }
    }

    const data = await response.json().catch(() => null);
    return { response, data };
  }

  async function refreshCoreFromBungie(showStatus = false) {
    if (coreSyncInFlightRef.current) {
      return false;
    }

    coreSyncInFlightRef.current = true;

    try {
      if (showStatus) {
        setSyncMessage("Syncing Guardian with Bungie...");
      }

      const [charactersResult, inventoryResult] =
        await Promise.all([
          fetchWithSessionRefresh("/api/destiny/characters"),
          fetchWithSessionRefresh(
            `/api/destiny/characters/${characterId}/inventory?scope=core`
          ),
        ]);

      const { response: charactersResponse, data: charactersData } =
        charactersResult;
      const { response: inventoryResponse, data: inventoryData } =
        inventoryResult;

      if (!charactersResponse.ok || !charactersData?.success) {
        throw new Error(
          charactersData?.error || "Failed to refresh Guardian"
        );
      }

      if (!inventoryResponse.ok || !inventoryData?.success) {
        throw new Error(
          inventoryData?.error || "Failed to refresh Guardian inventory"
        );
      }

      const nextCharacter =
        charactersData.characters?.find(
          (entry: Character) =>
            entry.characterId === characterId
        ) ?? null;

      const nextInventory: DestinyItem[] =
        Array.isArray(inventoryData.inventory)
          ? inventoryData.inventory
          : [];
      const nextEquipment: DestinyItem[] =
        Array.isArray(inventoryData.equipment)
          ? inventoryData.equipment
          : [];
      const nextSubclasses: GuardianSubclass[] =
        Array.isArray(inventoryData.subclasses)
          ? inventoryData.subclasses
          : [];

      setCharacters(Array.isArray(charactersData.characters) ? charactersData.characters : []);

      if (nextCharacter) {
        setCharacter(nextCharacter);
      }

      setInventory(nextInventory);
      setEquipment(nextEquipment);
      setSubclassSetup(
        inventoryData.subclassSetup ?? null
      );
      setSubclasses(nextSubclasses);
      setSeasonalArtifact(
        inventoryData.artifact ??
          inventoryData.seasonalArtifact ??
          null
      );
      setInGameLoadouts(
        Array.isArray(inventoryData.inGameLoadouts)
          ? inventoryData.inGameLoadouts
          : []
      );

      const snapshot = liveSubclassStateRef.current;
      const previousEquippedHash =
        snapshot.subclasses.find(
          (subclass) => subclass.equipped
        )?.itemHash ?? null;
      const nextEquippedHash =
        nextSubclasses.find(
          (subclass) => subclass.equipped
        )?.itemHash ?? null;
      const hasSubclassPreview =
        Object.keys(snapshot.previewSubclassPlugs).length > 0 ||
        (
          snapshot.selectedSubclassHash !== null &&
          previousEquippedHash !== null &&
          snapshot.selectedSubclassHash !== previousEquippedHash
        );

      setSelectedSubclassHash((current) => {
        const stillExists = nextSubclasses.some(
          (subclass) => subclass.itemHash === current
        );

        if (!stillExists) {
          return (
            nextEquippedHash ??
            nextSubclasses[0]?.itemHash ??
            null
          );
        }

        if (!hasSubclassPreview && nextEquippedHash !== null) {
          return nextEquippedHash;
        }

        return current;
      });

      // Live socket/perk data can change without the item instance changing.
      // Invalidate visible detail cards and force-refresh the equipped Artifact.
      const nextArtifact =
        nextEquipment.find((item) => isArtifactItem(item)) ??
        nextInventory.find((item) => isArtifactItem(item)) ??
        null;

      if (nextArtifact) {
        void ensureItemDetail(nextArtifact, true);
      }

      if (detailsItem?.itemInstanceId) {
        void ensureItemDetail(detailsItem, true);
      }

      if (compareBaseline?.itemInstanceId) {
        void ensureItemDetail(compareBaseline, true);
      }

      if (showStatus) {
        setSyncMessage("Guardian synced with Bungie.");
      }

      return true;
    } catch (err) {
      if (showStatus) {
        setSyncMessage(
          err instanceof Error
            ? err.message
            : "Could not sync Guardian data"
        );
      }
      return false;
    } finally {
      coreSyncInFlightRef.current = false;
    }
  }

  async function refreshAccountGearFromBungie(showStatus = false) {
    if (accountSyncInFlightRef.current) {
      return false;
    }

    accountSyncInFlightRef.current = true;

    try {
      if (showStatus) {
        setAccountGearLoading(true);
        setAccountGearError("");
      }

      const { response, data } =
        await fetchWithSessionRefresh(
          `/api/destiny/characters/${characterId}/inventory?scope=account`
        );

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || "Failed to refresh account gear"
        );
      }

      setVaultItems(
        Array.isArray(data.vault) ? data.vault : []
      );
      setOtherGuardianItems(
        Array.isArray(data.otherGuardianItems)
          ? data.otherGuardianItems
          : []
      );
      setVaultError("");
      setAccountGearError("");

      if (showStatus) {
        setAccountGearReadyNotice(true);
      }

      return true;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to refresh account gear";

      if (showStatus) {
        setAccountGearError(message);
        setVaultError(message);
      }

      return false;
    } finally {
      accountSyncInFlightRef.current = false;
      if (showStatus) {
        setAccountGearLoading(false);
      }
    }
  }

  async function handleSyncBungie() {
    if (syncing) {
      return;
    }

    setSyncing(true);
    setSyncMessage("Syncing Bungie data...");

    try {
      const [coreOk, accountOk] = await Promise.all([
        refreshCoreFromBungie(false),
        refreshAccountGearFromBungie(false),
      ]);

      setSyncMessage(
        coreOk && accountOk
          ? "Bungie data synced."
          : coreOk
          ? "Guardian synced. Account gear refresh had a problem."
          : "Bungie sync could not be completed."
      );
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (loading || !character) {
      return;
    }

    const syncCoreIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshCoreFromBungie(false);
      }
    };

    const syncAccountIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshAccountGearFromBungie(false);
      }
    };

    const coreInterval = window.setInterval(
      syncCoreIfVisible,
      30_000
    );
    const accountInterval = window.setInterval(
      syncAccountIfVisible,
      90_000
    );

    const handleFocus = () => {
      void refreshCoreFromBungie(false);
      void refreshAccountGearFromBungie(false);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        handleFocus();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener(
      "visibilitychange",
      handleVisibility
    );

    return () => {
      window.clearInterval(coreInterval);
      window.clearInterval(accountInterval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
    };
  }, [
    characterId,
    loading,
    character?.characterId,
    detailsItem?.itemInstanceId,
    compareBaseline?.itemInstanceId,
  ]);

useEffect(() => {
  if (
    pendingLoadoutHandledRef.current ||
    loading ||
    !character ||
    accountGearLoading ||
    !accountGearReadyNotice ||
    builderLoadouts.length === 0
  ) {
    return;
  }

  try {
    const raw = window.localStorage.getItem(
      "destiny-builder-pending-loadout"
    );

    if (!raw) {
      pendingLoadoutHandledRef.current = true;
      return;
    }

    const pending = JSON.parse(raw);
    if (
      pending?.characterId &&
      String(pending.characterId) !== String(characterId)
    ) {
      return;
    }

    const loadout = builderLoadouts.find(
      (candidate) => String(candidate?.id) === String(pending?.id)
    );

    if (!loadout) {
      window.localStorage.removeItem(
        "destiny-builder-pending-loadout"
      );
      pendingLoadoutHandledRef.current = true;
      return;
    }

    window.localStorage.removeItem(
      "destiny-builder-pending-loadout"
    );
    pendingLoadoutHandledRef.current = true;
    loadBuilderLoadout(loadout);
  } catch {
    window.localStorage.removeItem(
      "destiny-builder-pending-loadout"
    );
    pendingLoadoutHandledRef.current = true;
  }
  // loadBuilderLoadout intentionally uses the current resolved account snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  loading,
  character,
  characterId,
  accountGearLoading,
  accountGearReadyNotice,
  builderLoadouts,
]);

  // Quick Overview is a click-driven inspector. Keep this hook above every
  // early return so React always sees the same hook order while Guardian data
  // transitions from loading to ready.
  useEffect(() => {
    if (!hoveredItem) return;

    const closeQuickOverview = () => {
      if (hoverCloseTimerRef.current !== null) {
        window.clearTimeout(hoverCloseTimerRef.current);
        hoverCloseTimerRef.current = null;
      }
      setHoveredItem(null);
    };

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      // Let the inspector itself and gear cards handle their own clicks. Gear
      // cards need this exception so clicking the same card can toggle the panel.
      if (
        target.closest('[data-item-quick-overview="true"]') ||
        target.closest('[data-item-inspector-trigger="true"]')
      ) {
        return;
      }

      closeQuickOverview();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeQuickOverview();
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [hoveredItem]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black p-6 shadow-2xl">
          <div className="mb-5 flex items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />

            <div>
              <p className="text-lg font-semibold">
                Loading Guardian
              </p>
              <p className="text-sm text-white/50">
                Core Guardian data loads first. Vault and other Guardians continue syncing in the background.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 font-mono text-sm">
            {GUARDIAN_LOADING_MESSAGES
              .slice(0, loadingMessageIndex + 1)
              .map((message, index) => (
                <p
                  key={message}
                  className={
                    index === loadingMessageIndex
                      ? "text-white"
                      : "text-white/40"
                  }
                >
                  <span className="mr-2 text-white/30">&gt;</span>
                  {message}
                  {index === loadingMessageIndex && (
                    <span className="ml-1 animate-pulse">_</span>
                  )}
                </p>
              ))}
          </div>
        </div>
      </main>
    );
  }

  if (error || !character) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500">
            {error || "Guardian not found"}
          </p>

          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-white px-6 py-3 font-semibold text-black"
          >
            Back to Guardians
          </Link>
        </div>
      </main>
    );
  }

const equippedWeapons = equipment.filter(
  (item) => item.category === "weapon"
);

const equippedArmor = equipment.filter(
  (item) => item.category === "armor"
);

const equippedOther = equipment.filter(
  (item) =>
    item.category !== "weapon" &&
    item.category !== "armor" &&
    item.category !== "subclass" &&
    !isArtifactItem(item)
);

const inventoryWeapons = inventory.filter(
  (item) => item.category === "weapon"
);

const inventoryArmor = inventory.filter(
  (item) => item.category === "armor"
);

const currentClassType =
  subclasses[0]?.classType ?? null;

const vaultWeapons = vaultItems.filter(
  (item) => item.category === "weapon"
);

const vaultArmor = vaultItems.filter(
  (item) =>
    item.category === "armor" &&
    (
      currentClassType === null ||
      item.classType === null ||
      item.classType === 3 ||
      item.classType === currentClassType
    )
);

const otherGuardianWeapons = otherGuardianItems.filter(
  (item) => item.category === "weapon"
);

// Armor is class-specific, so items carried by another Guardian are not
// useful alternatives for the current Guardian's armor slots.
const otherGuardianArmor: DestinyItem[] = [];

const equippedArtifact =
  equipment.find((item) => isArtifactItem(item)) ?? null;

const artifactCandidates = [
  ...(equippedArtifact ? [equippedArtifact] : []),
  ...inventory.filter((item) => isArtifactItem(item)),
].filter(
  (item, index, items) =>
    items.findIndex(
      (candidate) => candidate.itemHash === item.itemHash
    ) === index
);

const selectedArtifactItem =
  artifactCandidates.find(
    (item) => getItemIdentity(item) === previewArtifactIdentity
  ) ??
  equippedArtifact ??
  artifactCandidates[0] ??
  null;

const selectedArtifactDetail =
  selectedArtifactItem?.itemInstanceId
    ? itemDetails[selectedArtifactItem.itemInstanceId] ?? null
    : null;

const inventoryOther = inventory.filter(
  (item) =>
    item.category !== "weapon" &&
    item.category !== "armor" &&
    item.category !== "subclass" &&
    !isArtifactItem(item)
);

const selectedSubclass =
  subclasses.find(
    (subclass) =>
      subclass.itemHash === selectedSubclassHash
  ) ??
  subclasses.find((subclass) => subclass.equipped) ??
  null;

const displayedSubclassSetup =
  selectedSubclass?.setup ?? subclassSetup;

const getSubclassPreviewKey = (
  socketIndex: number
) =>
  selectedSubclass
    ? `${selectedSubclass.itemHash}:${socketIndex}`
    : null;

const getSubclassPlugFromPreviewState = (
  slot: SubclassSlot | null,
  previewState: Record<string, SubclassPlug>
) => {
  if (!slot || !selectedSubclass) {
    return null;
  }

  const key = `${selectedSubclass.itemHash}:${slot.socketIndex}`;
  const selectedPlug = previewState[key] ?? slot.equipped;

  if (!selectedPlug) {
    return null;
  }

  // Live Bungie socket data can occasionally be sparser than the matching
  // Manifest/PlugSet option (Aspects are a common example). Keep the live
  // equipped/unlocked state, but fill missing display metadata from the same
  // plugHash already present in the slot's available options.
  const definitionPlug = (slot.available ?? []).find(
    (candidate) => candidate.plugHash === selectedPlug.plugHash
  );

  if (!definitionPlug) {
    return selectedPlug;
  }

  return {
    ...definitionPlug,
    ...selectedPlug,
    description:
      selectedPlug.description?.trim()
        ? selectedPlug.description
        : definitionPlug.description,
    icon: selectedPlug.icon ?? definitionPlug.icon,
    plugCategoryIdentifier:
      selectedPlug.plugCategoryIdentifier ?? definitionPlug.plugCategoryIdentifier,
    fragmentSlots:
      selectedPlug.fragmentSlots ?? definitionPlug.fragmentSlots,
    statEffects:
      selectedPlug.statEffects?.length
        ? selectedPlug.statEffects
        : definitionPlug.statEffects,
    effectTags:
      selectedPlug.effectTags?.length
        ? selectedPlug.effectTags
        : definitionPlug.effectTags,
    possible: selectedPlug.possible || definitionPlug.possible,
    unlocked: selectedPlug.unlocked || definitionPlug.unlocked,
    equipped: selectedPlug.equipped || definitionPlug.equipped,
  };
};

const getSelectedSubclassPlug = (
  slot: SubclassSlot | null
) =>
  getSubclassPlugFromPreviewState(
    slot,
    previewSubclassPlugs
  );

const hasAspectFragmentCapacityMetadata = Boolean(
  displayedSubclassSetup?.aspects.some((slot) =>
    [
      ...(slot.equipped ? [slot.equipped] : []),
      ...(slot.available ?? []),
    ].some(
      (plug) =>
        typeof plug.fragmentSlots === "number"
    )
  )
);

const getFragmentCapacityFromPreviewState = (
  previewState: Record<string, SubclassPlug>
) => {
  if (!displayedSubclassSetup || !selectedSubclass) {
    return 0;
  }

  // Older/odd Manifest data may not expose Aspect capacity. In that case,
  // preserve the previous behavior rather than hiding valid Fragment slots.
  if (!hasAspectFragmentCapacityMetadata) {
    return displayedSubclassSetup.fragments.length;
  }

  return displayedSubclassSetup.aspects.reduce(
    (total, slot) => {
      const selectedAspect =
        getSubclassPlugFromPreviewState(
          slot,
          previewState
        );

      const capacity =
        typeof selectedAspect?.fragmentSlots === "number"
          ? selectedAspect.fragmentSlots
          : 0;

      return total + Math.max(0, capacity);
    },
    0
  );
};

const activeFragmentSlotCount =
  displayedSubclassSetup
    ? Math.min(
        displayedSubclassSetup.fragments.length,
        getFragmentCapacityFromPreviewState(
          previewSubclassPlugs
        )
      )
    : 0;

const visibleSubclassFragmentSlots =
  displayedSubclassSetup?.fragments.slice(
    0,
    activeFragmentSlotCount
  ) ?? [];

const trimHiddenFragmentPreviews = (
  previewState: Record<string, SubclassPlug>
) => {
  if (
    !displayedSubclassSetup ||
    !selectedSubclass ||
    !hasAspectFragmentCapacityMetadata
  ) {
    return previewState;
  }

  const capacity = Math.min(
    displayedSubclassSetup.fragments.length,
    getFragmentCapacityFromPreviewState(previewState)
  );
  const next = { ...previewState };

  displayedSubclassSetup.fragments.forEach(
    (fragmentSlot, index) => {
      if (index < capacity) {
        return;
      }

      delete next[
        `${selectedSubclass.itemHash}:${fragmentSlot.socketIndex}`
      ];
    }
  );

  return next;
};

const getSiblingSubclassSlots = (slot: SubclassSlot) => {
  if (!displayedSubclassSetup) {
    return [];
  }

  if (slot.slotType === "aspect") {
    return displayedSubclassSetup.aspects;
  }

  if (slot.slotType === "fragment") {
    // Only currently active Fragment sockets participate in duplicate checks.
    // Bungie can keep plugs in hidden/inactive sockets after Aspect capacity changes;
    // those must not block a valid choice in one of the visible Fragment slots.
    return visibleSubclassFragmentSlots;
  }

  return [];
};

const getBlockedSubclassPlugHashes = (slot: SubclassSlot) => {
  const blocked = new Set<number>();

  for (const siblingSlot of getSiblingSubclassSlots(slot)) {
    if (siblingSlot.socketIndex === slot.socketIndex) {
      continue;
    }

    const selectedSiblingPlug =
      getSelectedSubclassPlug(siblingSlot);

    if (selectedSiblingPlug) {
      blocked.add(selectedSiblingPlug.plugHash);
    }
  }

  return blocked;
};

const selectSubclassPlug = (
  slot: SubclassSlot,
  plug: SubclassPlug
) => {
  const key = getSubclassPreviewKey(slot.socketIndex);

  if (!key) {
    return;
  }

  const siblingSlots = getSiblingSubclassSlots(slot);

  // Aspects and Fragments are unique inside their respective groups.
  // A plug already selected in another socket cannot be duplicated here.
  if (siblingSlots.length > 0) {
    const duplicateExists = siblingSlots.some((siblingSlot) => {
      if (siblingSlot.socketIndex === slot.socketIndex) {
        return false;
      }

      return (
        getSelectedSubclassPlug(siblingSlot)?.plugHash ===
        plug.plugHash
      );
    });

    if (duplicateExists) {
      return;
    }
  }

  setPreviewSubclassPlugs((current) => {
    const next = { ...current };

    if (
      slot.equipped &&
      plug.plugHash === slot.equipped.plugHash
    ) {
      delete next[key];
    } else {
      next[key] = plug;
    }

    return slot.slotType === "aspect"
      ? trimHiddenFragmentPreviews(next)
      : next;
  });
};

const resetSubclassPlug = (slot: SubclassSlot) => {
  const key = getSubclassPreviewKey(slot.socketIndex);

  if (!key) {
    return;
  }

  setPreviewSubclassPlugs((current) => {
    const next = { ...current };
    delete next[key];

    return slot.slotType === "aspect"
      ? trimHiddenFragmentPreviews(next)
      : next;
  });
};

const ensureItemDetail = async (
  item: DestinyItem,
  force = false
): Promise<ItemDetail | null> => {
  if (!item.itemInstanceId) {
    return null;
  }

  const key = item.itemInstanceId;
  const cached = detailCacheRef.current[key];

  if (!force && cached?.itemHash === item.itemHash) {
    return cached;
  }

  // Bungie Sync explicitly forces live; ordinary Inspect/Builder reads SQLite
  // first. This does not launch any background account-wide fetch.
  if (detailLoadingIds[key]) {
    return cached?.itemHash === item.itemHash ? cached : null;
  }

  setDetailLoadingIds((current) => ({ ...current, [key]: true }));

  try {
    const identity = { itemInstanceId: key, itemHash: item.itemHash };
    const resolved = await resolveSharedItemDetail(identity, {
      forceLive: force,
      readCache: async () => {
        const response = await fetch(sharedItemCacheUrl(characterId, identity), { cache: "no-store" });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) throw new Error("Detail cache unavailable");
        return data;
      },
      readLive: async () => {
        const response = await fetch(
          `/api/destiny/characters/${encodeURIComponent(characterId)}/inventory?scope=detail&itemInstanceId=${encodeURIComponent(key)}&itemHash=${item.itemHash}`,
          { cache: "no-store" }
        );
        const data = await response.json().catch(() => null);
        if (response.status === 401) {
          const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
          if (refreshed.ok) {
            window.location.reload();
            throw new Error("Session refresh underway");
          }
        }
        if (!response.ok || !data?.success || !data?.item) {
          throw new Error(data?.error || "Failed to load item details");
        }
        return data.item;
      },
    });
    const detail = resolved.detail as ItemDetail;
    detailCacheRef.current[key] = detail;
    setItemDetails((current) => ({
      ...current,
      [key]: detail,
    }));

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
};

const cancelHoverClose = () => {
  if (hoverCloseTimerRef.current !== null) {
    window.clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  }
};

const handleHoverItem = (item: DestinyItem) => {
  cancelHoverClose();

  // Clicking the item that already owns the Quick Overview toggles it closed.
  if (
    hoveredItem &&
    getItemIdentity(hoveredItem.item) === getItemIdentity(item)
  ) {
    setHoveredItem(null);
    return;
  }

  const pointer = lastPointerRef.current;
  setHoveredItem({
    item,
    anchorX: pointer.x,
    anchorY: pointer.y,
    viewportWidth: pointer.viewportWidth,
    viewportHeight: pointer.viewportHeight,
  });
  void ensureItemDetail(item);
};

const openGearPicker = (slotItem: DestinyItem) => {
  const bucketHash = getEquipmentSlotHash(slotItem);
  if (bucketHash === null || (slotItem.category !== "weapon" && slotItem.category !== "armor")) return;
  cancelHoverClose();
  setHoveredItem(null);
  setGearSearch("");
  setIncludeAccountGearInPicker(false);
  setOpenGearBucketHash(bucketHash);
};

const handleHoverItemLeave = () => {
  cancelHoverClose();

  // Give the pointer a short grace period to move from the item card to the
  // floating inspector. If it enters the inspector, the timer is cancelled.
  // Otherwise the hover card disappears instead of sticking on screen.
  hoverCloseTimerRef.current = window.setTimeout(() => {
    setHoveredItem(null);
    hoverCloseTimerRef.current = null;
  }, 420);
};

const handleHoverInspectorEnter = () => {
  cancelHoverClose();
};

const handleStartCompare = (item: DestinyItem) => {
  cancelHoverClose();
  setCompareBaseline(item);
  // Compare mode keeps only the compact baseline indicator. The large hover
  // inspector should not stay pinned after choosing the baseline.
  setHoveredItem(null);
  void ensureItemDetail(item);
};

const handleOpenDetails = (item: DestinyItem) => {
  cancelHoverClose();
  setHoveredItem(null);
  setDetailsItem(item);
  void ensureItemDetail(item);
};

const closeItemInspector = () => {
  cancelHoverClose();
  setHoveredItem(null);
};

const openQuickSave = () => {
  cancelHoverClose();
  setHoveredItem(null);
  setQuickSaveOpen(true);
};

const openInGameLoadoutInspector = (loadout: any) => {
  cancelHoverClose();
  setHoveredItem(null);
  setSelectedInGameLoadout(loadout);
};

const getCachedDetail = (
  item: DestinyItem | null
): ItemDetail | null => {
  if (!item?.itemInstanceId) {
    return null;
  }

  const detail = itemDetails[item.itemInstanceId];
  return detail?.itemHash === item.itemHash ? detail : null;
};

const saveBuilderLoadout = () => {
  const name =
    builderLoadoutName.trim() ||
    `Build ${builderLoadouts.length + 1}`;

  const gear = equipment
    .filter((item) => {
      const slotHash = getEquipmentSlotHash(item);
      return (
        slotHash !== null &&
        (item.category === "weapon" ||
          item.category === "armor")
      );
    })
    .map((equippedItem) => {
      const slotHash =
        getEquipmentSlotHash(equippedItem);

      if (slotHash === null) {
        return null;
      }

      const preview =
        previewGear[String(slotHash)]?.item ??
        equippedItem;

      return {
        slotHash,
        itemHash: preview.itemHash,
        itemInstanceId:
          preview.itemInstanceId ?? null,
        name: preview.name,
      };
    })
    .filter(Boolean);

  const subclassSlots = selectedSubclass?.setup
    ? [
        selectedSubclass.setup.super,
        selectedSubclass.setup.classAbility,
        selectedSubclass.setup.movement,
        selectedSubclass.setup.melee,
        selectedSubclass.setup.grenade,
        ...selectedSubclass.setup.aspects,
        ...visibleSubclassFragmentSlots,
      ].filter(Boolean) as SubclassSlot[]
    : [];

  const subclassPlugs = subclassSlots.map((slot) => ({
    socketIndex: slot.socketIndex,
    plugHash:
      previewSubclassPlugs[
        `${selectedSubclass?.itemHash}:${slot.socketIndex}`
      ]?.plugHash ??
      slot.equipped?.plugHash ??
      null,
  }));

  const usedArtifactPlugHashes = new Set<number>();
  const artifactSocketOverrides =
    selectedArtifactDetail?.perkColumns
      ?.map((column) => {
        const plugHash =
          previewArtifactPlugs[String(column.socketIndex)] ??
          column.selected?.plugHash ??
          null;
        const perk =
          typeof plugHash === "number"
            ? column.all.find(
                (candidate) => candidate.plugHash === plugHash
              ) ??
              (column.selected?.plugHash === plugHash
                ? column.selected
                : null)
            : null;

        if (
          typeof plugHash !== "number" ||
          !isMeaningfulArtifactPerk(perk) ||
          usedArtifactPlugHashes.has(plugHash)
        ) {
          return null;
        }

        usedArtifactPlugHashes.add(plugHash);

        return {
          socketIndex: column.socketIndex,
          plugHash,
        };
      })
      .filter(Boolean) ?? [];

  const saved = {
    id: `${Date.now()}`,
    name,
    createdAt: new Date().toISOString(),
    favorite: false,
    className: character?.className ?? null,
    subclassHash:
      selectedSubclass?.itemHash ?? null,
    subclassName:
      selectedSubclass?.name ?? null,
    subclassPlugs,
    gear,
    artifact: selectedArtifactItem
      ? {
          itemHash: selectedArtifactItem.itemHash,
          itemInstanceId: selectedArtifactItem.itemInstanceId ?? null,
          name: selectedArtifactItem.name,
          socketOverrides: artifactSocketOverrides,
        }
      : seasonalArtifact
      ? {
          artifactHash: seasonalArtifact.artifactHash ?? null,
          name: seasonalArtifact.name ?? "Seasonal Artifact",
          socketOverrides: [],
        }
      : null,
  };

  const next = [saved, ...builderLoadouts];
  setBuilderLoadouts(next);
  setBuilderLoadoutName("");

  try {
    window.localStorage.setItem(
      "destiny-builder-loadouts",
      JSON.stringify(next)
    );
  } catch {
    // Saving locally is best-effort in this v1.
  }
};

const loadBuilderLoadout = (loadout: any) => {
  if (
    loadout?.className &&
    character?.className &&
    loadout.className !== character.className
  ) {
    setSyncMessage(
      `${loadout?.name ?? "This build"} belongs to ${loadout.className}, not ${character.className}.`
    );
    return;
  }

  if (accountGearLoading) {
    setSyncMessage(
      "Account gear is still syncing. Wait for Vault / Other Guardians to finish so the build can be restored completely."
    );
    return;
  }

  // Loading a saved build starts a clean preview session. Old inspectors,
  // comparisons and slot pickers should never leak into the restored build.
  cancelHoverClose();
  setHoveredItem(null);
  setCompareBaseline(null);
  setDetailsItem(null);
  setSelectedInGameLoadout(null);
  setQuickSaveOpen(false);
  setOpenGearBucketHash(null);

  const targetSubclass = subclasses.find(
    (subclass) => subclass.itemHash === loadout?.subclassHash
  );

  if (targetSubclass) {
    setSelectedSubclassHash(targetSubclass.itemHash);

    const nextSubclassPlugs: Record<string, SubclassPlug> = {};
    const slots = targetSubclass.setup
      ? [
          targetSubclass.setup.super,
          targetSubclass.setup.classAbility,
          targetSubclass.setup.movement,
          targetSubclass.setup.melee,
          targetSubclass.setup.grenade,
          ...targetSubclass.setup.aspects,
          ...targetSubclass.setup.fragments,
        ].filter(Boolean) as SubclassSlot[]
      : [];

    for (const savedPlug of loadout?.subclassPlugs ?? []) {
      const slot = slots.find(
        (candidate) => candidate.socketIndex === savedPlug.socketIndex
      );
      if (!slot || typeof savedPlug?.plugHash !== "number") {
        continue;
      }

      const plug = [
        ...(slot.equipped ? [slot.equipped] : []),
        ...(slot.available ?? []),
      ].find((candidate) => candidate.plugHash === savedPlug.plugHash);

      if (plug && slot.equipped?.plugHash !== plug.plugHash) {
        nextSubclassPlugs[`${targetSubclass.itemHash}:${slot.socketIndex}`] = plug;
      }
    }

    setPreviewSubclassPlugs(nextSubclassPlugs);
  } else {
    // Do not keep plug choices from a previously previewed build.
    setPreviewSubclassPlugs({});
  }

  const allGear = [
    ...equipment,
    ...inventory,
    ...vaultItems,
    ...otherGuardianItems,
  ];
  const nextGear: Record<string, GearPreviewSelection> = {};

  for (const savedGear of loadout?.gear ?? []) {
    const item =
      allGear.find(
        (candidate) =>
          savedGear?.itemInstanceId &&
          candidate.itemInstanceId === savedGear.itemInstanceId
      ) ??
      allGear.find(
        (candidate) =>
          !savedGear?.itemInstanceId &&
          candidate.itemHash === savedGear?.itemHash &&
          getEquipmentSlotHash(candidate) === savedGear?.slotHash
      );

    if (!item || typeof savedGear?.slotHash !== "number") {
      continue;
    }

    const equippedInSlot = equipment.find(
      (candidate) => getEquipmentSlotHash(candidate) === savedGear.slotHash
    );

    if (equippedInSlot && getItemIdentity(equippedInSlot) === getItemIdentity(item)) {
      continue;
    }

    const source: GearPreviewSource =
      item.location?.type === "vault"
        ? "vault"
        : item.location?.type === "otherGuardian"
        ? "otherGuardian"
        : "character";

    nextGear[String(savedGear.slotHash)] = { item, source };
  }

  setPreviewGear(nextGear);

  const savedArtifact = loadout?.artifact ?? null;
  if (savedArtifact) {
    const artifactItem =
      artifactCandidates.find(
        (candidate) =>
          savedArtifact?.itemInstanceId &&
          candidate.itemInstanceId === savedArtifact.itemInstanceId
      ) ??
      artifactCandidates.find(
        (candidate) => candidate.itemHash === savedArtifact?.itemHash
      ) ??
      null;

    if (artifactItem) {
      if (equippedArtifact && getItemIdentity(artifactItem) === getItemIdentity(equippedArtifact)) {
        setPreviewArtifactIdentity(null);
      } else {
        setPreviewArtifactIdentity(getItemIdentity(artifactItem));
      }
      void ensureItemDetail(artifactItem);
    } else {
      // A missing Artifact must not leave the previous build's Artifact selected.
      setPreviewArtifactIdentity(null);
    }

    const nextArtifactPlugs: Record<string, number> = {};
    const restoredArtifactPlugHashes = new Set<number>();
    for (const override of savedArtifact?.socketOverrides ?? []) {
      if (
        typeof override?.socketIndex === "number" &&
        typeof override?.plugHash === "number" &&
        !restoredArtifactPlugHashes.has(override.plugHash)
      ) {
        nextArtifactPlugs[String(override.socketIndex)] = override.plugHash;
        restoredArtifactPlugHashes.add(override.plugHash);
      }
    }
    setPreviewArtifactPlugs(nextArtifactPlugs);
  } else {
    setPreviewArtifactIdentity(null);
    setPreviewArtifactPlugs({});
  }

  setActiveBuilderLoadoutId(loadout?.id ? String(loadout.id) : null);
  setQuickLoadoutOpen(false);
  setSyncMessage(`Loaded ${loadout?.name ?? "Builder loadout"} into preview.`);
};

const deleteBuilderLoadout = (id: string) => {
  const next = builderLoadouts.filter(
    (loadout) => loadout.id !== id
  );

  setBuilderLoadouts(next);

  try {
    window.localStorage.setItem(
      "destiny-builder-loadouts",
      JSON.stringify(next)
    );
  } catch {
    // Ignore storage failures.
  }
};

const allKnownGear = [
  ...equipment,
  ...inventory,
  ...vaultItems,
  ...otherGuardianItems,
];

const pickerEquippedItem = openGearBucketHash === null ? null :
  [...equippedWeapons, ...equippedArmor].find(
    (item) => getEquipmentSlotHash(item) === openGearBucketHash
  ) ?? null;

const pickerGuardianClassType = character.className === "Titan" ? 0 : character.className === "Hunter" ? 1 : 2;
const pickerCandidates: DestinyItem[] = (() => {
  if (!pickerEquippedItem) return [];
  const candidates = [
    pickerEquippedItem,
    ...inventory,
    ...(includeAccountGearInPicker ? [...vaultItems, ...otherGuardianItems] : []),
  ];
  const seen = new Set<string>();
  return candidates.filter((item) => {
    if (item.category !== pickerEquippedItem.category ||
        getEquipmentSlotHash(item) !== openGearBucketHash) return false;
    // Class-specific armor on a different Guardian must not be offered.
    if (item.category === "armor" && item.classType !== null &&
        item.classType !== 3 && item.classType !== pickerGuardianClassType) return false;
    const id = getItemIdentity(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
})();

const applyGearPreview = (nextItem: DestinyItem) => {
  if (!pickerEquippedItem || openGearBucketHash === null) return;
  const slotKey = String(openGearBucketHash);
  setPreviewGear((current) => {
    const next = { ...current };
    if (getItemIdentity(nextItem) === getItemIdentity(pickerEquippedItem)) {
      delete next[slotKey];
    } else {
      const inVault = vaultItems.some((item) => getItemIdentity(item) === getItemIdentity(nextItem));
      const onOtherGuardian = otherGuardianItems.some((item) => getItemIdentity(item) === getItemIdentity(nextItem));
      next[slotKey] = { item: nextItem, source: inVault ? "vault" : onOtherGuardian ? "otherGuardian" : "character" };
    }
    return next;
  });
  setOpenGearBucketHash(null);
  void ensureItemDetail(nextItem);
};

const effectiveWeapons = equippedWeapons.map((equippedItem) => {
  const slotHash = getEquipmentSlotHash(equippedItem);
  return slotHash !== null
    ? previewGear[String(slotHash)]?.item ?? equippedItem
    : equippedItem;
});

const effectiveArmor = equippedArmor.map((equippedItem) => {
  const slotHash = getEquipmentSlotHash(equippedItem);
  return slotHash !== null
    ? previewGear[String(slotHash)]?.item ?? equippedItem
    : equippedItem;
});

const hybridArmorStats = Array.from(
  effectiveArmor.reduce((stats, item) => {
    const detail = getCachedDetail(item);
    const sourceStats =
      detail?.armorStats?.length
        ? detail.armorStats
        : item.armorStats ?? [];

    for (const stat of sourceStats) {
      const current = stats.get(stat.statHash);
      stats.set(stat.statHash, {
        statHash: stat.statHash,
        name: stat.name,
        value: (current?.value ?? 0) + stat.value,
      });
    }
    return stats;
  }, new Map<number, { statHash: number; name: string; value: number }>())
    .values()
).sort((a, b) => {
  const aIndex = ARMOR_STAT_ORDER.indexOf(a.statHash as any);
  const bIndex = ARMOR_STAT_ORDER.indexOf(b.statHash as any);
  return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
});

const hybridArmorStatsLoading = effectiveArmor.some(
  (item) =>
    Boolean(item.itemInstanceId) &&
    Boolean(detailLoadingIds[item.itemInstanceId as string])
);

const hybridSubclassSlots = displayedSubclassSetup
  ? [
      displayedSubclassSetup.super,
      displayedSubclassSetup.classAbility,
      displayedSubclassSetup.movement,
      displayedSubclassSetup.melee,
      displayedSubclassSetup.grenade,
      ...displayedSubclassSetup.aspects,
      ...visibleSubclassFragmentSlots,
    ].filter(Boolean) as SubclassSlot[]
  : [];

const hybridCombatEffects = Array.from(
  (() => {
    const effects = new Map<string, CombatEffectTag>();

    for (const slot of hybridSubclassSlots) {
      const plug = getSelectedSubclassPlug(slot);
      for (const effect of plug?.effectTags ?? []) {
        effects.set(effect.key, effect);
      }
    }

    const gearForEffects = [...effectiveWeapons, ...effectiveArmor];
    for (const item of gearForEffects) {
      const detail = getCachedDetail(item);
      for (const perk of detail?.selectedPerks ?? []) {
        for (const effect of perk.effectTags ?? []) {
          effects.set(effect.key, effect);
        }
      }
      for (const perk of detail?.intrinsicPerks ?? []) {
        for (const effect of perk.effectTags ?? []) {
          effects.set(effect.key, effect);
        }
      }
      for (const perk of detail?.itemSet?.perks ?? []) {
        for (const effect of perk.effectTags ?? []) {
          effects.set(effect.key, effect);
        }
      }
    }

    for (const perk of selectedArtifactDetail?.selectedPerks ?? []) {
      for (const effect of perk.effectTags ?? []) {
        effects.set(effect.key, effect);
      }
    }

    return effects;
  })().values()
);

const favoriteLoadouts = builderLoadouts
  .filter((loadout) => loadout?.favorite === true)
  .filter((loadout) => !loadout?.className || loadout.className === character.className)
  .slice(0, 6);

const activeFavoriteLoadout = activeBuilderLoadoutId
  ? builderLoadouts.find((loadout) => String(loadout?.id) === activeBuilderLoadoutId) ?? null
  : null;


  return (
    <AppShell
      activeSection="builder"
      currentBuildHref={`/guardian/${characterId}`}
      loadoutsHref={`/guardian/${characterId}/loadouts`}
      subclassHref={`/guardian/${characterId}/subclass`}
      artifactHref={`/guardian/${characterId}/artifact`}
      guardianContextSection="build"
      guardianId={characterId}
      guardianClassName={character.className}
      guardianSubclassName={selectedSubclass?.name ?? null}
      guardianEmblemPath={character.emblemPath}
      guardianOptions={characters.map((guardian) => ({
        characterId: guardian.characterId,
        className: guardian.className,
        light: guardian.light,
        emblemPath: guardian.emblemPath,
        href: `/guardian/${guardian.characterId}`,
      }))}
      power={character.light}
      autoSync
      bungieSynced={!error}
      syncing={syncing}
      onSync={handleSyncBungie}
    >
      <main id="current-build" className="min-h-screen px-4 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1540px]">
          {syncMessage && (
            <p className="mb-4 border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-white/60">
              {syncMessage}
            </p>
          )}

          <section className="relative overflow-hidden border border-white/10 bg-[#0a0d12]">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-45"
              style={{
                backgroundImage: `url(https://www.bungie.net${character.emblemBackgroundPath})`,
              }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,8,12,0.96)_0%,rgba(6,8,12,0.72)_42%,rgba(6,8,12,0.92)_100%)]" />
            <div className="relative flex min-h-[168px] flex-col justify-between gap-6 p-5 sm:flex-row sm:items-end lg:p-7">
              <div className="flex items-center gap-4">
                <img
                  src={`https://www.bungie.net${character.emblemPath}`}
                  alt={`${character.className} emblem`}
                  className="h-16 w-16 border border-white/15 object-cover shadow-2xl sm:h-20 sm:w-20"
                />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-200/55">
                    Current Guardian
                  </p>
                  <h1 className="mt-1 text-3xl font-black uppercase tracking-[0.06em] sm:text-4xl">
                    {character.className}
                  </h1>
                  <p className="mt-1 text-sm uppercase tracking-[0.12em] text-white/55">
                    {selectedSubclass?.name ?? "Subclass loading"}
                    {selectedSubclass?.element ? ` · ${selectedSubclass.element}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-end gap-5">
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300/55">Power</p>
                  <p className="text-3xl font-black text-amber-100">{character.light}</p>
                </div>
                <button
                  type="button"
                  onClick={handleSyncBungie}
                  disabled={syncing}
                  className="border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-2 text-xs font-semibold uppercase tracking-[0.13em] text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-300/[0.1] disabled:cursor-not-allowed disabled:opacity-50 xl:hidden"
                >
                  {syncing ? "Syncing" : "Sync Bungie"}
                </button>
              </div>
            </div>
          </section>
<section className="mt-8">
  <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px] 2xl:grid-cols-[370px_minmax(0,1fr)_390px]">
    <aside className="min-w-0">
      <HybridGearRail
        title="Weapons"
        equippedItems={equippedWeapons}
        accountGearLoading={accountGearLoading}
        previewGear={previewGear}
        getItemDetail={getCachedDetail}
        onInspectItem={handleHoverItem}
        onChooseGear={openGearPicker}
      />
    </aside>

    <section id="subclass-panel" className="relative min-w-0 scroll-mt-32 overflow-hidden border border-white/10 bg-[#080b11]">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            selectedSubclass?.element === "solar"
              ? "radial-gradient(circle at 50% 24%, rgba(249,115,22,.19), transparent 34%), linear-gradient(180deg, rgba(255,255,255,.015), transparent 45%)"
              : selectedSubclass?.element === "arc"
              ? "radial-gradient(circle at 50% 24%, rgba(56,189,248,.19), transparent 34%), linear-gradient(180deg, rgba(255,255,255,.015), transparent 45%)"
              : selectedSubclass?.element === "strand"
              ? "radial-gradient(circle at 50% 24%, rgba(74,222,128,.17), transparent 34%), linear-gradient(180deg, rgba(255,255,255,.015), transparent 45%)"
              : selectedSubclass?.element === "stasis"
              ? "radial-gradient(circle at 50% 24%, rgba(96,165,250,.18), transparent 34%), linear-gradient(180deg, rgba(255,255,255,.015), transparent 45%)"
              : selectedSubclass?.element === "prismatic"
              ? "radial-gradient(circle at 50% 24%, rgba(192,132,252,.18), transparent 34%), radial-gradient(circle at 60% 32%, rgba(34,211,238,.09), transparent 24%)"
              : "radial-gradient(circle at 50% 24%, rgba(168,85,247,.2), transparent 34%), linear-gradient(180deg, rgba(255,255,255,.015), transparent 45%)",
        }}
      />

      {displayedSubclassSetup?.icon && (
        <img
          src={`https://www.bungie.net${displayedSubclassSetup.icon}`}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-24 h-[360px] w-[360px] -translate-x-1/2 object-contain opacity-[0.045] blur-[0.2px]"
        />
      )}

      <div className="relative p-4 lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            {displayedSubclassSetup?.icon ? (
              <img
                src={`https://www.bungie.net${displayedSubclassSetup.icon}`}
                alt={displayedSubclassSetup.name}
                className="h-14 w-14 object-contain"
              />
            ) : (
              <div className="h-14 w-14 border border-white/10 bg-white/5" />
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/35">
                Subclass configuration
              </p>
              <h2 className="mt-1 text-2xl font-black uppercase tracking-[0.08em]">
                {displayedSubclassSetup?.name ?? selectedSubclass?.name ?? "Guardian"}
              </h2>
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/45">
                {selectedSubclass?.equipped
                  ? "Equipped in Destiny"
                  : selectedSubclass?.unlocked
                  ? "Builder preview"
                  : selectedSubclass
                  ? "Theory mode · locked"
                  : "Loading"}
              </p>
            </div>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setQuickLoadoutOpen((current) => !current)}
              className="group flex min-w-[220px] items-center justify-between gap-3 border border-white/10 bg-black/25 px-3 py-2 text-left transition hover:border-white/30 hover:bg-white/[0.05]"
            >
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Quick loadout</p>
                <p className="truncate text-xs font-bold uppercase tracking-[0.08em] text-white/80">
                  {activeFavoriteLoadout?.name ?? "Current preview"}
                </p>
              </div>
              <span className="flex items-center gap-2 text-[10px] text-white/35">
                <span className="text-amber-200/80">★</span>
                <span className="text-lg transition group-hover:text-white/70">⌄</span>
              </span>
            </button>

            {quickLoadoutOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-[85] w-[min(360px,calc(100vw-2rem))] border border-white/15 bg-[#0b0e13]/98 p-2 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3 px-2 py-2">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Favorite loadouts</p>
                    <p className="mt-1 text-xs text-white/35">Load a complete saved preview without leaving Build.</p>
                  </div>
                  <button type="button" onClick={() => setQuickLoadoutOpen(false)} className="text-xs text-white/35 hover:text-white">Close</button>
                </div>
                <div className="mt-1 space-y-1">
                  {favoriteLoadouts.length > 0 ? favoriteLoadouts.map((loadout) => (
                    <button
                      key={loadout.id}
                      type="button"
                      onClick={() => loadBuilderLoadout(loadout)}
                      className="flex w-full items-center gap-3 border border-transparent px-3 py-2.5 text-left transition hover:border-white/10 hover:bg-white/[0.04]"
                    >
                      <span className="text-amber-200">★</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold">{loadout.name}</span>
                        <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.1em] text-white/30">
                          {loadout.subclassName ?? "No subclass"}{loadout.artifact?.name ? ` · ${loadout.artifact.name}` : ""}
                        </span>
                      </span>
                    </button>
                  )) : (
                    <p className="px-3 py-4 text-xs leading-relaxed text-white/35">
                      No favorite loadouts for this Guardian yet. Star one in the Loadout Manager and it will appear here.
                    </p>
                  )}
                </div>
                <Link
                  href={`/guardian/${characterId}/loadouts`}
                  onClick={() => setQuickLoadoutOpen(false)}
                  className="mt-2 block border-t border-white/10 px-3 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100/75 hover:text-cyan-100"
                >
                  Manage Loadouts →
                </Link>
              </div>
            )}
          </div>
        </div>

        {selectedSubclass && displayedSubclassSetup ? (
          <div className="relative mt-4 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Abilities</p>
                <span className="text-[10px] uppercase tracking-[0.12em] text-white/25">5 active slots</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <SubclassSlotCard
                  compact
                  title="Super"
                  slot={displayedSubclassSetup.super}
                  viewerOnly
                  onInspect={(slot) => setSubclassQuickView({ slot, label: "Super" })}
                  theoretical={selectedSubclass.locked}
                  selectedPlug={getSelectedSubclassPlug(displayedSubclassSetup.super)}
                  onSelectPlug={selectSubclassPlug}
                  onResetPlug={resetSubclassPlug}
                />
                <SubclassSlotCard
                  compact
                  title="Class"
                  slot={displayedSubclassSetup.classAbility}
                  viewerOnly
                  onInspect={(slot) => setSubclassQuickView({ slot, label: "Class Ability" })}
                  theoretical={selectedSubclass.locked}
                  selectedPlug={getSelectedSubclassPlug(displayedSubclassSetup.classAbility)}
                  onSelectPlug={selectSubclassPlug}
                  onResetPlug={resetSubclassPlug}
                />
                <SubclassSlotCard
                  compact
                  title="Jump"
                  slot={displayedSubclassSetup.movement}
                  viewerOnly
                  onInspect={(slot) => setSubclassQuickView({ slot, label: "Movement" })}
                  theoretical={selectedSubclass.locked}
                  selectedPlug={getSelectedSubclassPlug(displayedSubclassSetup.movement)}
                  onSelectPlug={selectSubclassPlug}
                  onResetPlug={resetSubclassPlug}
                />
                <SubclassSlotCard
                  compact
                  title="Melee"
                  slot={displayedSubclassSetup.melee}
                  viewerOnly
                  onInspect={(slot) => setSubclassQuickView({ slot, label: "Melee" })}
                  theoretical={selectedSubclass.locked}
                  selectedPlug={getSelectedSubclassPlug(displayedSubclassSetup.melee)}
                  onSelectPlug={selectSubclassPlug}
                  onResetPlug={resetSubclassPlug}
                />
                <SubclassSlotCard
                  compact
                  title="Grenade"
                  slot={displayedSubclassSetup.grenade}
                  viewerOnly
                  onInspect={(slot) => setSubclassQuickView({ slot, label: "Grenade" })}
                  theoretical={selectedSubclass.locked}
                  selectedPlug={getSelectedSubclassPlug(displayedSubclassSetup.grenade)}
                  onSelectPlug={selectSubclassPlug}
                  onResetPlug={resetSubclassPlug}
                />
              </div>
            </div>

            {displayedSubclassSetup.aspects.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Aspects</p>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-white/25">
                    {activeFragmentSlotCount} fragment slots
                  </span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {displayedSubclassSetup.aspects.map((slot) => (
                    <SubclassSlotCard
                      compact
                      key={slot.socketIndex}
                      title="Aspect"
                      slot={slot}
                      viewerOnly
                      onInspect={(targetSlot) => setSubclassQuickView({ slot: targetSlot, label: "Aspect" })}
                      theoretical={selectedSubclass.locked}
                      selectedPlug={getSelectedSubclassPlug(slot)}
                      blockedPlugHashes={getBlockedSubclassPlugHashes(slot)}
                      onSelectPlug={selectSubclassPlug}
                      onResetPlug={resetSubclassPlug}
                    />
                  ))}
                </div>
              </div>
            )}

            {displayedSubclassSetup.fragments.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Fragments</p>
                  {hasAspectFragmentCapacityMetadata && (
                    <span className="text-[10px] uppercase tracking-[0.12em] text-white/25">
                      {activeFragmentSlotCount} active
                    </span>
                  )}
                </div>
                {visibleSubclassFragmentSlots.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {visibleSubclassFragmentSlots.map((slot) => (
                      <SubclassSlotCard
                        compact
                        key={slot.socketIndex}
                        title="Fragment"
                        slot={slot}
                        viewerOnly
                        onInspect={(targetSlot) => setSubclassQuickView({ slot: targetSlot, label: "Fragment" })}
                        theoretical={selectedSubclass.locked}
                        selectedPlug={getSelectedSubclassPlug(slot)}
                        blockedPlugHashes={getBlockedSubclassPlugHashes(slot)}
                        onSelectPlug={selectSubclassPlug}
                        onResetPlug={resetSubclassPlug}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="border border-dashed border-white/10 bg-black/20 p-3 text-xs text-white/35">
                    Select Aspects to grant Fragment slots.
                  </div>
                )}
              </div>
            )}

            {(seasonalArtifact || selectedArtifactItem) && (
              <div id="artifact-panel" className="scroll-mt-32">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Seasonal Artifact</p>
                  <Link
                    href={`/guardian/${characterId}/artifact`}
                    className="border border-cyan-200/20 bg-cyan-200/[0.05] px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-cyan-100 transition hover:border-cyan-200/40 hover:bg-cyan-200/[0.1]"
                  >
                    Open in Artifact Editor →
                  </Link>
                </div>
                <ArtifactCard
                  compact
                  readOnly
                  artifactProgression={seasonalArtifact}
                  artifactItem={selectedArtifactItem}
                  artifactDetail={selectedArtifactDetail}
                  artifactLoading={Boolean(
                    selectedArtifactItem?.itemInstanceId &&
                      detailLoadingIds[selectedArtifactItem.itemInstanceId]
                  )}
                  candidates={artifactCandidates}
                  equippedArtifact={equippedArtifact}
                  previewPlugs={previewArtifactPlugs}
                  onEnsureDetail={(item) => void ensureItemDetail(item)}
                  onSelectArtifact={(item) => {
                    setPreviewArtifactIdentity(getItemIdentity(item));
                    setPreviewArtifactPlugs({});
                    void ensureItemDetail(item);
                  }}
                  onResetArtifact={() => {
                    setPreviewArtifactIdentity(null);
                    setPreviewArtifactPlugs({});
                    if (equippedArtifact) {
                      void ensureItemDetail(equippedArtifact);
                    }
                  }}
                  onSelectPlug={(socketIndex, plugHash) =>
                    setPreviewArtifactPlugs((current) => ({
                      ...current,
                      [String(socketIndex)]: plugHash,
                    }))
                  }
                  onResetPlug={(socketIndex) =>
                    setPreviewArtifactPlugs((current) => {
                      const next = { ...current };
                      delete next[String(socketIndex)];
                      return next;
                    })
                  }
                />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 border border-dashed border-white/10 p-5 text-sm text-white/40">
            No subclass configuration is available for this Guardian yet.
          </div>
        )}
      </div>
    </section>

    <aside className="min-w-0">
      <HybridGearRail
        title="Armor"
        equippedItems={equippedArmor}
        accountGearLoading={accountGearLoading}
        previewGear={previewGear}
        getItemDetail={getCachedDetail}
        onInspectItem={handleHoverItem}
        onChooseGear={openGearPicker}
      />

      <div className="mt-4 border border-white/10 bg-[#080b11] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Character stats</p>
          <span className="text-[10px] uppercase tracking-[0.12em] text-white/25">Armor total</span>
        </div>
        {hybridArmorStats.length > 0 ? (
          <div className="space-y-2">
            {hybridArmorStats.map((stat) => (
              <div key={stat.statHash} className="grid grid-cols-[minmax(0,1fr)_1fr_2rem] items-center gap-2 text-xs">
                <span className="truncate text-white/55">{stat.name}</span>
                <div className="h-1 bg-white/10">
                  <div
                    className="h-full bg-cyan-200/80"
                    style={{ width: `${Math.max(2, Math.min(100, stat.value))}%` }}
                  />
                </div>
                <span className="text-right font-semibold text-white/80">{stat.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/35">
            {hybridArmorStatsLoading
              ? "Loading armor stats…"
              : "No armor stats are available for the current preview."}
          </p>
        )}
      </div>
    </aside>
  </div>

  <div className="mt-4 border border-white/10 bg-[#080b11] px-4 py-3">
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-2 min-w-[150px]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/65">Active combat loop</p>
        <p className="mt-1 text-xs text-white/30">Detected from the current preview</p>
      </div>
      {hybridCombatEffects.length > 0 ? (
        hybridCombatEffects.slice(0, 10).map((effect) => (
          <CombatEffectBadge key={`hybrid-${effect.key}`} effect={effect} />
        ))
      ) : (
        <span className="text-xs text-white/35">
          Combat effects will appear as subclass, weapon, armor and Artifact details resolve.
        </span>
      )}
    </div>
  </div>

  {(accountGearLoading || vaultError || accountGearError) && (
    <div className="mt-4 border border-white/10 bg-white/[0.025] px-4 py-3 text-xs text-white/45">
      {accountGearLoading
        ? "Vault and other Guardian gear are syncing in the background. The Builder remains usable while this completes."
        : `Account gear is currently unavailable: ${vaultError || accountGearError}`}
    </div>
  )}
</section>


      </div>

      {selectedInGameLoadout && (
        <InGameLoadoutInspector
          loadout={selectedInGameLoadout}
          allItems={allKnownGear}
          onClose={() => setSelectedInGameLoadout(null)}
        />
      )}

      <button
        type="button"
        onClick={openQuickSave}
        className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-white/20 bg-white px-5 py-3 text-sm font-bold text-black shadow-2xl transition hover:scale-[1.02] hover:bg-white/90"
      >
        Save current build
      </button>

      {pickerEquippedItem && openGearBucketHash !== null && (
        <GearSlotPicker
          slotItem={pickerEquippedItem}
          equippedItem={pickerEquippedItem}
          currentItem={previewGear[String(openGearBucketHash)]?.item ?? pickerEquippedItem}
          candidates={pickerCandidates}
          search={gearSearch}
          onSearchChange={setGearSearch}
          includeAccountGear={includeAccountGearInPicker}
          onIncludeAccountChange={setIncludeAccountGearInPicker}
          accountGearLoading={accountGearLoading}
          getItemDetail={getCachedDetail}
          onEnsureDetail={(item) => { void ensureItemDetail(item); }}
          onPick={applyGearPreview}
          onClose={() => setOpenGearBucketHash(null)}
        />
      )}

      {quickSaveOpen && (
        <div
          className="fixed inset-0 z-[125] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={() => setQuickSaveOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0d0f13] p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
              Destiny Builder loadout
            </p>
            <h3 className="mt-1 text-xl font-bold">Save current preview</h3>
            <p className="mt-2 text-sm text-white/45">
              Saves the current subclass and gear preview locally. You can rename it now or leave the field empty for an automatic name.
            </p>
            <input
              value={builderLoadoutName}
              onChange={(event) => setBuilderLoadoutName(event.target.value)}
              placeholder={`Build ${builderLoadouts.length + 1}`}
              autoFocus
              className="mt-4 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm outline-none placeholder:text-white/25 focus:border-white/30"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setQuickSaveOpen(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  saveBuilderLoadout();
                  setQuickSaveOpen(false);
                }}
                className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-black hover:bg-white/90"
              >
                Save build
              </button>
            </div>
          </div>
        </div>
      )}

      {hoveredItem && !detailsItem && (
        <ItemHoverInspector
          item={hoveredItem.item}
          detail={getCachedDetail(hoveredItem.item)}
          loading={Boolean(
            hoveredItem.item.itemInstanceId &&
              detailLoadingIds[hoveredItem.item.itemInstanceId]
          )}
          compareBaseline={compareBaseline}
          compareDetail={getCachedDetail(compareBaseline)}
          onCompare={handleStartCompare}
          onDetails={handleOpenDetails}
          onChangeGear={openGearPicker}
          onClose={closeItemInspector}
          onInspectorEnter={() => {}}
          onInspectorLeave={() => {}}
          anchorX={hoveredItem.anchorX}
          anchorY={hoveredItem.anchorY}
          viewportWidth={hoveredItem.viewportWidth}
          viewportHeight={hoveredItem.viewportHeight}
        />
      )}

      {compareBaseline && (
        <div className="fixed bottom-5 left-5 z-[65] w-[min(22rem,calc(100vw-2.5rem))] rounded-2xl border border-white/15 bg-black/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                Compare mode
              </p>
              <p className="mt-1 truncate font-semibold">
                {compareBaseline.name}
              </p>
              <p className="mt-1 text-xs text-white/45">
                Hover another item in the same slot to compare it with this baseline.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompareBaseline(null)}
              className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {subclassQuickView && selectedSubclass && (
        <SubclassQuickInspector
          label={subclassQuickView.label}
          slot={subclassQuickView.slot}
          plug={getSelectedSubclassPlug(subclassQuickView.slot)}
          theoretical={selectedSubclass.locked}
          editHref={`/guardian/${characterId}/subclass?socket=${subclassQuickView.slot.socketIndex}&label=${encodeURIComponent(subclassQuickView.label)}`}
          onClose={() => setSubclassQuickView(null)}
        />
      )}

      {detailsItem && (
        <ItemDetailsDrawer
          item={detailsItem}
          detail={getCachedDetail(detailsItem)}
          loading={Boolean(
            detailsItem.itemInstanceId &&
              detailLoadingIds[detailsItem.itemInstanceId]
          )}
          onClose={() => setDetailsItem(null)}
          onCompare={handleStartCompare}
        />
      )}

      {(accountGearLoading || accountGearReadyNotice || accountGearError) && (
        <div className="fixed bottom-5 right-5 z-50 w-[min(22rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-black/95 p-4 shadow-2xl backdrop-blur">
          {accountGearLoading ? (
            <>
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />

                <div>
                  <p className="text-sm font-semibold">
                    Syncing account gear
                  </p>
                  <p className="text-xs text-white/45">
                    Guardian core is ready. Extra account gear is loading in the background.
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/60">Vault</span>
                  <span className="flex items-center gap-2 text-white/40">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" />
                    Loading
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/60">Other Guardians</span>
                  <span className="flex items-center gap-2 text-white/40">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" />
                    Loading
                  </span>
                </div>
              </div>
            </>
          ) : accountGearError ? (
            <>
              <p className="text-sm font-semibold">
                Account gear sync failed
              </p>
              <p className="mt-1 text-xs text-white/50">
                {accountGearError}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 text-sm">
                  ✓
                </div>

                <div>
                  <p className="text-sm font-semibold">
                    Account gear ready
                  </p>
                  <p className="text-xs text-white/45">
                    Vault and other Guardian weapons are now available.
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/50">
                <span className="rounded-full bg-white/5 px-2 py-1">
                  Vault {vaultItems.length}
                </span>
                <span className="rounded-full bg-white/5 px-2 py-1">
                  Other Guardians {otherGuardianItems.filter((item) => item.category === "weapon").length} weapons
                </span>
              </div>
            </>
          )}
        </div>
      )}
      </main>
    </AppShell>
  );
}

const GEAR_SLOT_NAMES: Record<number, string> = {
  1498876634: "Kinetic Slot",
  2465295065: "Energy Slot",
  953998645: "Power Slot",
  3448274439: "Helmet",
  3551918588: "Gauntlets",
  14239492: "Chest Armor",
  20886954: "Leg Armor",
  1585787867: "Class Item",
};

const GEAR_SLOT_ORDER: Record<number, number> = {
  1498876634: 0,
  2465295065: 1,
  953998645: 2,
  3448274439: 10,
  3551918588: 11,
  14239492: 12,
  20886954: 13,
  1585787867: 14,
};

function getEquipmentSlotHash(item: DestinyItem) {
  return item.equipmentSlotHash ?? item.bucketHash;
}

function getGearSlotName(item: DestinyItem) {
  const slotHash = getEquipmentSlotHash(item);

  if (slotHash !== null) {
    const knownName = GEAR_SLOT_NAMES[slotHash];

    if (knownName) {
      return knownName;
    }
  }

  return item.category === "weapon"
    ? "Weapon Slot"
    : "Armor Slot";
}

function getGearSlotOrder(item: DestinyItem) {
  const slotHash = getEquipmentSlotHash(item);

  if (slotHash === null) {
    return 999;
  }

  return GEAR_SLOT_ORDER[slotHash] ?? 999;
}

function getItemIdentity(item: DestinyItem) {
  return (
    item.itemInstanceId ??
    `${item.itemHash}-${getEquipmentSlotHash(item)}`
  );
}

function GearTierDots({
  tier,
  className = "",
}: {
  tier: number | null | undefined;
  className?: string;
}) {
  if (typeof tier !== "number" || !Number.isFinite(tier) || tier <= 0) {
    return null;
  }

  const filled = Math.max(1, Math.min(5, Math.round(tier)));

  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      aria-label={`Gear tier ${tier}`}
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <span
          key={index}
          className={`h-1.5 w-1.5 rounded-full border ${
            index < filled
              ? "border-white/80 bg-white/80"
              : "border-white/20 bg-transparent"
          }`}
        />
      ))}
    </span>
  );
}

function getAppliedAppearance(detail: ItemDetail | null) {
  if (!detail) {
    return null;
  }

  const selected = detail.selectedPerks.find((perk) => {
    const identifier = (perk.plugCategoryIdentifier ?? "").toLowerCase();
    const name = perk.name.trim().toLowerCase();
    const isAppearance =
      identifier.includes("ornament") ||
      identifier.includes("skin") ||
      identifier.includes("armor_skins");
    const isDefault =
      name.includes("default ornament") ||
      name.includes("restore defaults") ||
      name === "default";

    return isAppearance && !isDefault && Boolean(perk.icon);
  });

  return selected ?? null;
}

function ItemAppearanceIcon({
  item,
  detail,
  className,
}: {
  item: DestinyItem;
  detail: ItemDetail | null;
  className: string;
}) {
  const appearance =
    item.category === "armor" ? getAppliedAppearance(detail) : null;
  const baseIcon = item.icon;
  const appearanceIcon = appearance?.icon ?? null;

  if (!baseIcon && !appearanceIcon) {
    return <div className={`${className} bg-white/5`} />;
  }

  if (!appearanceIcon || !baseIcon) {
    return (
      <img
        src={`https://www.bungie.net${appearanceIcon ?? baseIcon}`}
        alt={item.name}
        className={`${className} object-cover`}
      />
    );
  }

  return (
    <span
      className={`group/appearance relative block overflow-hidden ${className}`}
      aria-label={`${item.name}. Applied appearance: ${appearance?.name ?? "ornament"}. Hover the icon to see the base armor.`}
    >
      <img
        src={`https://www.bungie.net${appearanceIcon}`}
        alt={`${appearance?.name ?? item.name} appearance`}
        className="absolute inset-0 h-full w-full object-cover opacity-100 transition-opacity duration-150 group-hover/appearance:opacity-0"
      />
      <img
        src={`https://www.bungie.net${baseIcon}`}
        alt={`${item.name} base armor`}
        className="h-full w-full object-cover opacity-0 transition-opacity duration-150 group-hover/appearance:opacity-100"
      />
      <span className="pointer-events-none absolute bottom-1 right-1 h-2 w-2 rotate-45 border border-white/70 bg-black/70" />
    </span>
  );
}

function GearPickerStatComparison({
  candidate,
  candidateDetail,
  baseline,
  baselineDetail,
}: {
  candidate: DestinyItem;
  candidateDetail: ItemDetail | null;
  baseline: DestinyItem;
  baselineDetail: ItemDetail | null;
}) {
  const candidateStats = getEffectiveStats(candidate, candidateDetail);
  const baselineStats = getEffectiveStats(baseline, baselineDetail);
  const candidateMap = new Map(candidateStats.map((stat) => [stat.statHash, stat]));
  const baselineMap = new Map(baselineStats.map((stat) => [stat.statHash, stat]));
  const isArmor = candidate.category === "armor";
  const statHashes = Array.from(new Set([
    ...candidateStats.map((stat) => stat.statHash),
    ...baselineStats.map((stat) => stat.statHash),
  ])).sort((a, b) => {
    if (!isArmor) return 0;
    const aOrder = ARMOR_STAT_ORDER.indexOf(a as typeof ARMOR_STAT_ORDER[number]);
    const bOrder = ARMOR_STAT_ORDER.indexOf(b as typeof ARMOR_STAT_ORDER[number]);
    return (aOrder < 0 ? 100 : aOrder) - (bOrder < 0 ? 100 : bOrder);
  });
  const candidateTotal = candidateDetail?.armorStatTotal ?? candidate.armorStatTotal;
  const baselineTotal = baselineDetail?.armorStatTotal ?? baseline.armorStatTotal;
  const power = getEffectivePower(candidate, candidateDetail);
  const baselinePower = getEffectivePower(baseline, baselineDetail);
  const tier = getEffectiveGearTier(candidate, candidateDetail);
  const sameItem = getItemIdentity(candidate) === getItemIdentity(baseline);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="border border-white/10 bg-black/25 p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">Power</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-black tabular-nums text-amber-100">{power ?? "—"}</span>
            {power !== null && baselinePower !== null && power !== baselinePower && (
              <span className={`text-xs font-bold tabular-nums ${power > baselinePower ? "text-emerald-300" : "text-rose-300"}`}>
                {power > baselinePower ? "+" : ""}{power - baselinePower}
              </span>
            )}
          </div>
        </div>
        <div className="border border-white/10 bg-black/25 p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">{isArmor ? "Armor stat total" : "Gear tier"}</p>
          {isArmor ? (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-black tabular-nums text-white/90">{candidateTotal ?? "—"}</span>
              {candidateTotal !== null && baselineTotal !== null && candidateTotal !== baselineTotal && (
                <span className={`text-xs font-bold tabular-nums ${candidateTotal > baselineTotal ? "text-emerald-300" : "text-rose-300"}`}>
                  {candidateTotal > baselineTotal ? "+" : ""}{candidateTotal - baselineTotal}
                </span>
              )}
            </div>
          ) : <div className="mt-3"><GearTierDots tier={tier} /><span className="ml-2 text-xs text-white/45">{tier ?? "—"}</span></div>}
        </div>
      </div>
      <div className="border-t border-white/10 pt-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">{isArmor ? "Armor 3.0 stats" : "Weapon statistics"}</p>
          <span className="text-[9px] uppercase tracking-wider text-white/30">vs current preview</span>
        </div>
        {statHashes.length ? (
          <div className="space-y-3">
            {statHashes.map((hash) => {
              const stat = candidateMap.get(hash);
              const reference = baselineMap.get(hash);
              const value = stat?.value;
              const before = reference?.value;
              const diff = value !== undefined && before !== undefined ? value - before : null;
              const barValue = value !== undefined && value >= 0 && value <= 100 ? value : null;
              const baselineBar = before !== undefined && before >= 0 && before <= 100 ? before : null;
              return (
                <div key={hash}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-white/60" title={stat?.description || reference?.description || undefined}>{stat?.name ?? reference?.name ?? "Stat"}</span>
                    <span className="flex shrink-0 items-center gap-1.5 font-semibold tabular-nums">
                      <span className="text-white/30">{before ?? "—"}</span>
                      <span className="text-white/20">→</span>
                      <span className="text-white/90">{value ?? "—"}</span>
                      {diff !== null && diff !== 0 && (
                        <span className={`min-w-8 text-right ${diff > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {diff > 0 ? "+" : ""}{diff}
                        </span>
                      )}
                    </span>
                  </div>
                  {barValue !== null && (
                    <div className="relative mt-1.5 h-1.5 bg-white/10">
                      <div className="h-full bg-cyan-200/80 transition-[width] duration-150" style={{ width: `${barValue}%` }} />
                      {baselineBar !== null && <div className="absolute -top-0.5 h-2.5 w-px bg-amber-200" style={{ left: `${baselineBar}%` }} title={`Current preview: ${baselineBar}`} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="border border-dashed border-white/10 p-3 text-xs leading-relaxed text-white/40">
            Statistics are not available in the current snapshot. Keep the pointer on this item to load its Bungie details.
          </p>
        )}
        {sameItem && <p className="mt-3 text-[10px] text-cyan-200/50">This is your current Builder preview.</p>}
      </div>
    </div>
  );
}

function GearSlotPicker({
  slotItem,
  equippedItem,
  currentItem,
  candidates,
  search,
  onSearchChange,
  includeAccountGear,
  onIncludeAccountChange,
  accountGearLoading,
  getItemDetail,
  onEnsureDetail,
  onPick,
  onClose,
}: {
  slotItem: DestinyItem;
  equippedItem: DestinyItem;
  currentItem: DestinyItem;
  candidates: DestinyItem[];
  search: string;
  onSearchChange: (next: string) => void;
  includeAccountGear: boolean;
  onIncludeAccountChange: (next: boolean) => void;
  accountGearLoading: boolean;
  getItemDetail: (item: DestinyItem) => ItemDetail | null;
  onEnsureDetail: (item: DestinyItem) => void;
  onPick: (item: DestinyItem) => void;
  onClose: () => void;
}) {
  const [inspectedId, setInspectedId] = useState(() => getItemIdentity(currentItem));
  const [sort, setSort] = useState<"name" | "power" | "total">("name");
  const className = "h-[62px] w-[62px] sm:h-[72px] sm:w-[72px]";
  // Avoid expensive detail fanout: one deliberate hover/focus loads one item.
  // Refs are only read from effects, never accessed during render.
  const requestedRef = useRef(new Set<string>());

  const normalized = search.trim().toLowerCase();
  const matches = candidates.filter((item) =>
    !normalized || `${item.name} ${item.itemTypeDisplayName ?? ""} ${getItemLocationLabel(item)}`.toLowerCase().includes(normalized)
  ).sort((a, b) => {
    if (sort === "power") return (b.power ?? -1) - (a.power ?? -1) || a.name.localeCompare(b.name);
    if (sort === "total") {
      const getTotal = (item: DestinyItem) => getItemDetail(item)?.armorStatTotal ?? item.armorStatTotal ?? -1;
      return getTotal(b) - getTotal(a) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name) || (b.power ?? -1) - (a.power ?? -1);
  });
  const inspectedItem = candidates.find((item) => getItemIdentity(item) === inspectedId) ?? currentItem;
  const inspectedKey = getItemIdentity(inspectedItem);
  const inspectedDetail = getItemDetail(inspectedItem);
  const currentDetail = getItemDetail(currentItem);
  const candidatePerks = inspectedDetail ? getQuickPerks(inspectedDetail) : (inspectedItem.roll ?? []).filter((perk) => Boolean(perk.name));
  const sameAsCurrent = inspectedKey === getItemIdentity(currentItem);
  const isEquipped = inspectedKey === getItemIdentity(equippedItem);

  useEffect(() => {
    if (!inspectedItem.itemInstanceId || inspectedDetail || requestedRef.current.has(inspectedKey)) return;
    const timer = window.setTimeout(() => {
      if (requestedRef.current.has(inspectedKey)) return;
      requestedRef.current.add(inspectedKey);
      onEnsureDetail(inspectedItem);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [inspectedKey, inspectedItem, inspectedDetail, onEnsureDetail]);

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="presentation">
      <section role="dialog" aria-modal="true" aria-label={`Choose ${getGearSlotName(slotItem)}`}
        className="flex h-[min(800px,calc(100dvh-2.5rem))] min-h-0 w-full max-w-6xl flex-col overflow-hidden border border-cyan-200/25 bg-[#080c13] shadow-[0_24px_90px_rgba(0,0,0,0.75)]">
        <header className="sticky top-0 z-20 flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-white/10 bg-[#111923] px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-200/55">Guardian inventory · Builder preview</p>
            <h2 className="mt-1 text-xl font-black uppercase tracking-[0.09em] text-white/90">{getGearSlotName(slotItem)}</h2>
            <p className="mt-1 text-xs text-white/40">Hover or focus to inspect and compare · Click to preview · No changes in Destiny</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 border border-white/15 px-3 py-1.5 text-xs font-bold uppercase text-white/55 hover:bg-white/10 hover:text-white">Close ✕</button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_390px] lg:overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-col lg:border-r lg:border-white/10">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-white/10 p-3 sm:p-4">
              <input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search this slot…" aria-label="Search Guardian gear" className="min-w-[155px] flex-1 border border-white/15 bg-black/30 px-3 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-cyan-200/50" />
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/55">
                <input type="checkbox" checked={includeAccountGear} onChange={(event) => onIncludeAccountChange(event.target.checked)} className="accent-cyan-300" />
                Include Vault + other Guardians
              </label>
              <select value={sort} onChange={(event) => setSort(event.target.value as "name" | "power" | "total")}
                aria-label="Sort equipment" className="border border-white/15 bg-[#111923] px-2 py-2 text-xs text-white/70 outline-none">
                <option value="name">Name</option><option value="power">Power ↓</option>
                {slotItem.category === "armor" && <option value="total">Stat total ↓</option>}
              </select>
            </div>
            <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">{includeAccountGear ? "Account options" : "Current Guardian inventory"} · {matches.length} items{accountGearLoading && includeAccountGear ? " · Syncing…" : ""}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {matches.map((item) => {
                  const identity = getItemIdentity(item);
                  const equipped = identity === getItemIdentity(equippedItem);
                  const selected = identity === getItemIdentity(currentItem);
                  const inspected = identity === inspectedKey;
                  const detail = getItemDetail(item);
                  return (
                    <button key={identity} type="button" onClick={() => onPick(item)}
                      onMouseEnter={() => setInspectedId(identity)} onFocus={() => setInspectedId(identity)}
                      title={`${item.name} · ${getItemLocationLabel(item)} · Power ${item.power ?? "—"} · ${equipped ? "Equipped in Destiny" : selected ? "Current preview" : "Preview"}`}
                      className={`group flex min-w-0 flex-col items-center border p-2 text-left transition ${inspected ? "border-cyan-200/70 bg-cyan-200/[0.09]" : selected ? "border-emerald-300/50 bg-emerald-300/[0.035]" : "border-white/10 bg-white/[0.02] hover:border-cyan-200/40 hover:bg-white/[0.05]"}`}>
                      <span className="relative block shrink-0 border border-white/10 bg-black/30">
                        <ItemAppearanceIcon item={item} detail={detail} className={className} />
                        {selected && <span className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center bg-cyan-200 text-[10px] font-black text-[#071017]">✓</span>}
                        {equipped && <span className="absolute bottom-0 left-0 right-0 bg-black/85 py-0.5 text-center text-[8px] font-bold uppercase tracking-wider text-emerald-200">Equipped</span>}
                      </span>
                      <span className="mt-2 block w-full truncate text-[10px] font-semibold text-white/80">{item.name}</span>
                      <span className="mt-1 block w-full truncate text-[9px] text-amber-100/65">{item.power !== null ? `Power ${item.power}` : "Power —"}</span>
                      <span className="mt-0.5 block w-full truncate text-[9px] text-white/35">{getItemLocationLabel(item)}</span>
                    </button>
                  );
                })}
              </div>
              {!matches.length && <p className="mt-5 text-xs text-white/45">No matching equipment in this slot.{includeAccountGear && accountGearLoading ? " Vault and other Guardians are still loading." : ""}</p>}
            </div>
          </div>
          <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#0b121c] p-4 sm:p-5 lg:border-t-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/55">{sameAsCurrent ? "Current Builder preview" : "Inspect gear · compare"}</p>
            <div className="mt-3 flex items-center gap-3 border-b border-white/10 pb-4">
              <ItemAppearanceIcon item={inspectedItem} detail={inspectedDetail} className="h-[72px] w-[72px] shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-black uppercase text-white/90">{inspectedItem.name}</p>
                <p className="mt-1 text-[10px] text-white/40">{inspectedItem.itemTypeDisplayName ?? inspectedItem.category} · {inspectedItem.tierTypeName ?? ""}</p>
                <p className="mt-1 text-[10px] text-white/45">{getItemLocationLabel(inspectedItem)}</p>
                {isEquipped && <span className="mt-1 inline-block text-[9px] font-bold uppercase text-emerald-200/75">Equipped in Destiny</span>}
              </div>
            </div>
            {!sameAsCurrent && (
              <p className="mt-3 text-[10px] leading-relaxed text-white/45">
                Comparing against <span className="font-semibold text-white/70">{currentItem.name}</span>, your current Builder preview. Green/red numbers show real stat differences.
              </p>
            )}
            <div className="mt-4">
              <GearPickerStatComparison candidate={inspectedItem} candidateDetail={inspectedDetail} baseline={currentItem} baselineDetail={currentDetail}/>
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Selected perks</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {candidatePerks.slice(0, 10).map((perk, i) => (
                  <div key={`${perk.socketIndex}-${i}`} title={`${perk.name}${perk.description ? `: ${perk.description}` : ""}`} className="flex h-9 w-9 items-center justify-center border border-white/10 bg-black/25">
                    {perk.icon ? <img src={`https://www.bungie.net${perk.icon}`} alt={perk.name} className="h-7 w-7 object-contain" /> : <span className="text-[9px] text-white/40">•</span>}
                  </div>
                ))}
              </div>
              {!candidatePerks.length && <p className="mt-2 text-[11px] text-white/35">Perks will appear when item details are available.</p>}
            </div>
            <div className="sticky bottom-0 -mx-4 mt-4 border-t border-white/10 bg-[#0b121c]/95 px-4 pb-1 pt-3 backdrop-blur sm:-mx-5 sm:px-5">
              {!sameAsCurrent && (
                <button type="button" onClick={() => onPick(inspectedItem)} className="w-full border border-cyan-200/50 bg-cyan-200/10 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-200/20">
                  Preview this {inspectedItem.category === "armor" ? "armor" : "weapon"} →
                </button>
              )}
              {getItemIdentity(currentItem) !== getItemIdentity(equippedItem) && (
                <button type="button" onClick={() => onPick(equippedItem)} className="mt-2 w-full border border-white/20 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-white/65 hover:bg-white/10 hover:text-white">Reset to Destiny equipped</button>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-white/35">All selections are local Builder previews. Nothing is moved or equipped in Destiny.</p>
            </div>
          </aside>
        </div>
      </section>
    </div>,
    document.body
  );
}

function HybridGearRail({
  title,
  equippedItems,
  accountGearLoading,
  previewGear,
  getItemDetail,
  onInspectItem,
  onChooseGear,
}: {
  title: string;
  equippedItems: DestinyItem[];
  accountGearLoading: boolean;
  previewGear: Record<string, GearPreviewSelection>;
  getItemDetail: (item: DestinyItem) => ItemDetail | null;
  onInspectItem: (item: DestinyItem) => void;
  onChooseGear: (item: DestinyItem) => void;
}) {
  const slots = [...equippedItems]
    .filter((item) => getEquipmentSlotHash(item) !== null)
    .sort((a, b) => getGearSlotOrder(a) - getGearSlotOrder(b));

  return (
    <div className="border border-white/10 bg-[#080b11] p-4">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">{title}</p>
          <p className="mt-1 text-xs text-white/25">{slots.length} / {slots.length} equipped</p>
        </div>
        {accountGearLoading && (
          <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-cyan-200" />
        )}
      </div>

      <div className="space-y-2">
        {slots.map((equippedItem) => {
          const bucketHash = getEquipmentSlotHash(equippedItem);
          if (bucketHash === null) return null;

          const previewSelection = previewGear[String(bucketHash)] ?? null;
          const previewItem = previewSelection?.item ?? equippedItem;
          const previewDetail = getItemDetail(previewItem);
          const previewSource = previewSelection?.source ?? null;
          const isPreviewing = previewSelection !== null;

          return (
            <div key={bucketHash} className="relative">
            <button
              type="button"
              data-item-inspector-trigger="true"
              onClick={() => onInspectItem(previewItem)}
              className="group w-full border border-white/10 bg-white/[0.025] p-3.5 pr-16 text-left transition hover:border-white/25 hover:bg-white/[0.05]"
              aria-label={`Inspect ${previewItem.name}`}
            >
              <div className="flex gap-3">
                <ItemAppearanceIcon
                  item={previewItem}
                  detail={previewDetail}
                  className="h-[72px] w-[72px] shrink-0"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/30">
                        {getGearSlotName(equippedItem)}
                      </p>
                      <p className="mt-1 truncate text-[15px] font-bold uppercase tracking-[0.025em] text-white/90">
                        {previewItem.name}
                      </p>
                    </div>
                    <span className="text-xs text-white/25 transition group-hover:text-white/60">↗</span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.08em] text-white/35">
                    {previewItem.power !== null && <span className="text-amber-200/80">{previewItem.power}</span>}
                    <GearTierDots tier={previewDetail?.gearTier ?? previewItem.gearTier ?? null} />
                    {getDamageTypeName(previewItem.damageType) && <span>{getDamageTypeName(previewItem.damageType)}</span>}
                    {previewItem.tierTypeName && <span>{previewItem.tierTypeName}</span>}
                  </div>

                  {previewItem.roll?.length > 0 && (
                    <div className="mt-2.5 flex gap-1.5">
                      {previewItem.roll.slice(0, 5).map((perk, index) => (
                        <div
                          key={`${perk.socketIndex}-${perk.plugHash ?? index}`}
                          className="flex h-6 w-6 items-center justify-center border border-white/10 bg-black/25"
                          title={perk.name}
                        >
                          {perk.icon ? (
                            <img src={`https://www.bungie.net${perk.icon}`} alt="" className="h-5 w-5 object-contain" />
                          ) : (
                            <span className="text-[8px] text-white/25">•</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {isPreviewing && (
                    <p className="mt-2 truncate text-[9px] uppercase tracking-[0.12em] text-cyan-200/60">
                      Preview · {previewSource === "vault" ? "Vault" : previewSource === "otherGuardian" ? previewItem.location?.className ?? "Other Guardian" : "Guardian"}
                    </p>
                  )}
                </div>
              </div>
            </button>
            <button
              type="button"
              title={`Choose ${getGearSlotName(equippedItem)} for Builder preview`}
              onClick={() => onChooseGear(previewItem)}
              className="absolute right-2 top-2 border border-cyan-200/30 bg-[#111b25] px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-100/80 hover:border-cyan-200/60 hover:bg-cyan-200/[0.14] hover:text-cyan-50"
            >
              Change
            </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemSection({
  title,
  items,
}: {
  title: string;
  items: DestinyItem[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mb-10">
      <div className="mb-4 flex items-center gap-3">
        <h3 className="text-2xl font-semibold">
          {title}
        </h3>

        <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-white/60">
          {items.length}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {items.map((item, index) => (
          <ItemCard
            key={
              item.itemInstanceId ??
              `${item.itemHash}-${index}`
            }
            item={item}
          />
        ))}
      </div>
    </div>
  );
}

function getDamageTypeName(damageType: number | null) {
  switch (damageType) {
    case 1:
      return "Kinetic";
    case 2:
      return "Arc";
    case 3:
      return "Solar";
    case 4:
      return "Void";
    case 6:
      return "Stasis";
    case 7:
      return "Strand";
    default:
      return null;
  }
}

function ItemCard({ item }: { item: DestinyItem }) {
  const damageTypeName =
    getDamageTypeName(item.damageType);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex gap-4">
        {item.icon ? (
          <img
            src={`https://www.bungie.net${item.icon}`}
            alt={item.name}
            className="h-16 w-16 rounded"
          />
        ) : (
          <div className="h-16 w-16 rounded bg-white/10" />
        )}

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold">
            {item.name}
          </h3>

          <p className="text-sm text-white/60">
            {item.itemTypeDisplayName ??
              "Unknown type"}
          </p>

          <div className="mt-1 flex flex-wrap gap-2 text-sm">
            {item.tierTypeName && (
              <span>{item.tierTypeName}</span>
            )}

            {item.power !== null && (
              <span className="text-yellow-300">
                Power {item.power}
              </span>
            )}

            {damageTypeName && (
              <span className="text-white/70">
                {damageTypeName}
              </span>
            )}
          </div>
        </div>
      </div>

      {item.category === "weapon" &&
        item.roll?.length > 0 && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="mb-2 text-sm font-semibold text-white/70">
              Roll
            </p>

            <div className="space-y-2">
              {item.roll.map((perk) => (
                <div
                  key={`${perk.socketIndex}-${perk.plugHash}`}
                  className="flex items-center gap-2"
                >
                  {perk.icon && (
                    <img
                      src={`https://www.bungie.net${perk.icon}`}
                      alt={perk.name}
                      className="h-7 w-7 rounded"
                    />
                  )}

                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {perk.name}
                    </p>

                    <p className="text-xs text-white/40">
                      {perk.type}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      {item.category === "armor" &&
        item.armorStats?.length > 0 && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-white/70">
                Armor Stats
              </p>

              {item.armorStatTotal !== null && (
                <span className="text-sm font-bold">
                  Total {item.armorStatTotal}
                </span>
              )}
            </div>

            <div className="space-y-1">
              {item.armorStats.map((stat) => (
                <div
                  key={stat.statHash}
                  className="flex justify-between text-sm"
                >
                  <span className="text-white/60">
                    {stat.name}
                  </span>

                  <span>
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}


    </div>
  );
}

function SubclassSlotCard({
  title,
  slot,
  theoretical = false,
  selectedPlug,
  blockedPlugHashes = new Set<number>(),
  onSelectPlug,
  onResetPlug,
  compact = false,
  viewerOnly = false,
  onInspect,
}: {
  title: string;
  slot: SubclassSlot | null;
  theoretical?: boolean;
  selectedPlug: SubclassPlug | null;
  blockedPlugHashes?: Set<number>;
  onSelectPlug: (
    slot: SubclassSlot,
    plug: SubclassPlug
  ) => void;
  onResetPlug: (slot: SubclassSlot) => void;
  compact?: boolean;
  viewerOnly?: boolean;
  onInspect?: (slot: SubclassSlot) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerSort, setPickerSort] = useState<"status" | "name">("status");

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pickerOpen]);

  if (!slot) {
    return null;
  }

  const allOptions = [
    ...(slot.equipped ? [slot.equipped] : []),
    ...slot.available,
  ]
    .filter((option) => {
      const name = option.name.trim().toLowerCase();
      const identifier =
        option.plugCategoryIdentifier?.trim().toLowerCase() ?? "";

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
    .filter((option, index, options) =>
      options.findIndex(
        (candidate) =>
          candidate.plugHash === option.plugHash
      ) === index
    );

  const filteredOptions = allOptions
    .filter((option) => {
      const query = pickerQuery.trim().toLowerCase();
      if (!query) {
        return true;
      }
      return (
        option.name.toLowerCase().includes(query) ||
        option.description.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (pickerSort === "name") {
        return a.name.localeCompare(b.name);
      }

      const rank = (option: SubclassPlug) => {
        if (selectedPlug?.plugHash === option.plugHash) return 0;
        if (slot.equipped?.plugHash === option.plugHash) return 1;
        if (option.unlocked) return 2;
        return 3;
      };

      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

  const isPreviewing = Boolean(
    selectedPlug &&
      (!slot.equipped ||
        selectedPlug.plugHash !==
          slot.equipped.plugHash)
  );

  const selectedStatEffects =
    selectedPlug?.statEffects ?? [];
  const selectedEffectTags =
    selectedPlug?.effectTags ?? [];

  const formatStatEffect = (effect: SubclassPlug["statEffects"][number]) =>
    `${effect.value > 0 ? "+" : ""}${effect.value} ${effect.name}${effect.isConditionallyActive ? " (conditional)" : ""}`;

  const compactKind =
    title === "Aspect" ? "aspect" : title === "Fragment" ? "fragment" : "ability";

  return (
    <div
      className={`relative border border-white/10 bg-black/20 transition ${
        compact
          ? compactKind === "aspect"
            ? "min-h-[86px] cursor-pointer p-3 hover:border-white/25 hover:bg-white/[0.035]"
            : "min-h-[108px] cursor-pointer p-2.5 text-center hover:border-white/25 hover:bg-white/[0.035]"
          : "rounded-xl bg-white/5 p-4"
      }`}
      role={compact && (viewerOnly || allOptions.length > 0) ? "button" : undefined}
      tabIndex={compact && (viewerOnly || allOptions.length > 0) ? 0 : undefined}
      onClick={compact && (viewerOnly || allOptions.length > 0) ? () => {
        if (viewerOnly) onInspect?.(slot);
        else setPickerOpen(true);
      } : undefined}
      onKeyDown={compact && (viewerOnly || allOptions.length > 0) ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (viewerOnly) onInspect?.(slot);
          else setPickerOpen(true);
        }
      } : undefined}
      title={!viewerOnly && compact ? selectedPlug?.name ?? title : undefined}
    >
      <div className={`${compact ? "mb-1.5" : "mb-3"} flex items-center justify-between gap-3`}>
        <p className={`${compact ? "text-[9px] tracking-[0.16em]" : "text-sm tracking-wide"} font-semibold uppercase text-white/40`}>
          {title}
        </p>

        {isPreviewing && !compact && (
          <button
            type="button"
            onClick={() => onResetPlug(slot)}
            className="text-xs text-white/50 hover:text-white"
          >
            {slot.equipped
              ? "Reset to equipped"
              : "Clear preview"}
          </button>
        )}
        {isPreviewing && compact && (
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" title="Preview changed" />
        )}
      </div>

      {selectedPlug ? (
        <div className={compact && compactKind !== "aspect" ? "flex flex-col items-center" : "flex gap-3"}>
          {selectedPlug.icon && (
            <img
              src={`https://www.bungie.net${selectedPlug.icon}`}
              alt={selectedPlug.name}
              className={
                compact
                  ? compactKind === "aspect"
                    ? "h-11 w-11 shrink-0 object-contain"
                    : "h-12 w-12 object-contain"
                  : "h-12 w-12 rounded"
              }
            />
          )}

          <div className={compact && compactKind !== "aspect" ? "mt-2 min-w-0 w-full" : "min-w-0 flex-1"}>
            <div className={compact && compactKind !== "aspect" ? "block" : "flex flex-wrap items-center gap-2"}>
              <h4 className={compact ? "truncate text-[11px] font-semibold" : "font-semibold"}>
                {selectedPlug.name}
              </h4>

              {!compact && (
                <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/50">
                  {isPreviewing
                    ? theoretical || !selectedPlug.unlocked
                      ? "Theory preview"
                      : "Preview"
                    : "Equipped"}
                </span>
              )}
            </div>

            {!compact && selectedPlug.description && (
              <p className="mt-1 text-sm text-white/50">
                {selectedPlug.description}
              </p>
            )}

            {compact && compactKind === "aspect" && typeof selectedPlug.fragmentSlots === "number" && (
              <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-white/35">
                +{selectedPlug.fragmentSlots} Fragment slots
              </p>
            )}

            {compact && compactKind === "fragment" && selectedStatEffects.length > 0 && (
              <p className={`mt-1 text-[10px] ${selectedStatEffects[0].value > 0 ? "text-emerald-200/75" : "text-rose-200/75"}`}>
                {formatStatEffect(selectedStatEffects[0])}
              </p>
            )}

            {!compact && (typeof selectedPlug.fragmentSlots === "number" ||
              selectedStatEffects.length > 0 ||
              selectedEffectTags.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {typeof selectedPlug.fragmentSlots === "number" && (
                  <span
                    className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-white/65"
                    title="Number of Fragment slots granted by this Aspect"
                  >
                    Fragment slots +{selectedPlug.fragmentSlots}
                  </span>
                )}

                {selectedStatEffects.map((effect) => (
                  <span
                    key={`${selectedPlug.plugHash}-${effect.statHash}-${effect.value}`}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      effect.value > 0
                        ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200"
                        : "border-rose-400/25 bg-rose-400/5 text-rose-200"
                    }`}
                    title={`${effect.name}${effect.description ? `\n${effect.description}` : ""}${effect.isConditionallyActive ? "\nConditional effect" : ""}`}
                  >
                    {formatStatEffect(effect)}
                  </span>
                ))}

                {selectedEffectTags.map((effect) => (
                  <CombatEffectBadge
                    key={`${selectedPlug.plugHash}-${effect.key}`}
                    effect={effect}
                  />
                ))}
              </div>
            )}

            {!compact && selectedPlug.unlocked === false && (
              <p className="mt-2 text-xs text-white/40">
                Locked on this Guardian. This choice can be used for a future/theoretical build, but not applied now.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-white/10 p-3">
          <p className="text-sm text-white/60">
            {theoretical
              ? "Choose an option for this theoretical setup"
              : "No option selected"}
          </p>
        </div>
      )}

      {!viewerOnly && allOptions.length > 0 && (
        <>
          {!compact && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className={`${selectedPlug ? "border-t border-white/10" : ""} mt-4 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/65 transition hover:bg-white/5 hover:text-white`}
            >
              Change option ({allOptions.length})
            </button>
          )}

          {pickerOpen && (
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
              onMouseDown={() => setPickerOpen(false)}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="max-h-[82vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-[#0d0f13] p-5 shadow-2xl"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                      Change option
                    </p>
                    <h4 className="mt-1 text-xl font-semibold">
                      {title}
                    </h4>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white"
                  >
                    Close
                  </button>
                </div>

                <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={pickerQuery}
                    onChange={(event) => setPickerQuery(event.target.value)}
                    placeholder={`Search ${title.toLowerCase()} options...`}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/30"
                  />
                  <select
                    value={pickerSort}
                    onChange={(event) =>
                      setPickerSort(event.target.value as "status" | "name")
                    }
                    className="rounded-lg border border-white/10 bg-[#111318] px-3 py-2 text-sm text-white/70 outline-none"
                  >
                    <option value="status">Selected / unlocked first</option>
                    <option value="name">Name A-Z</option>
                  </select>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {filteredOptions.map((option) => {
                    const isSelected =
                      selectedPlug?.plugHash ===
                      option.plugHash;
                    const isDestinyEquipped =
                      slot.equipped?.plugHash ===
                      option.plugHash;
                    const isUsedInAnotherSlot =
                      blockedPlugHashes.has(option.plugHash) &&
                      !isSelected;

                    return (
                      <button
                        key={option.plugHash}
                        type="button"
                        disabled={isUsedInAnotherSlot}
                        onClick={() => {
                          if (!isUsedInAnotherSlot) {
                            onSelectPlug(slot, option);
                            setPickerOpen(false);
                          }
                        }}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                          isSelected
                            ? "border-white/50 bg-white/10"
                            : isUsedInAnotherSlot
                            ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-35"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        {option.icon ? (
                          <img
                            src={`https://www.bungie.net${option.icon}`}
                            alt={option.name}
                            className="h-11 w-11 rounded"
                          />
                        ) : (
                          <div className="h-11 w-11 rounded bg-white/10" />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {option.name}
                          </p>
                          <p className="mt-1 text-xs text-white/40">
                            {isUsedInAnotherSlot
                              ? "Already selected in another slot"
                              : isDestinyEquipped
                              ? "Equipped in Destiny"
                              : option.unlocked
                              ? "Unlocked"
                              : "Locked · Theory only"}
                          </p>

                          {(typeof option.fragmentSlots === "number" ||
                            (option.statEffects?.length ?? 0) > 0 ||
                            (option.effectTags?.length ?? 0) > 0) && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {typeof option.fragmentSlots === "number" && (
                                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">
                                  +{option.fragmentSlots} Fragment slots
                                </span>
                              )}
                              {(option.statEffects ?? []).map((effect) => (
                                <span
                                  key={`${option.plugHash}-${effect.statHash}-${effect.value}`}
                                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                                    effect.value > 0
                                      ? "bg-emerald-400/10 text-emerald-200"
                                      : "bg-rose-400/10 text-rose-200"
                                  }`}
                                >
                                  {formatStatEffect(effect)}
                                </span>
                              ))}
                              {(option.effectTags ?? []).map((effect) => (
                                <CombatEffectBadge
                                  key={`${option.plugHash}-${effect.key}`}
                                  effect={effect}
                                  compact
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}


function mergeCombatEffectTags(
  ...groups: Array<CombatEffectTag[] | null | undefined>
) {
  const merged = new Map<string, CombatEffectTag>();

  for (const group of groups) {
    for (const effect of group ?? []) {
      if (!merged.has(effect.key)) {
        merged.set(effect.key, effect);
      }
    }
  }

  return Array.from(merged.values());
}

const COMBAT_EFFECT_DESCRIPTIONS: Record<string, string> = {
  amplified:
    "An Arc buff that improves mobility and enables or strengthens effects that require you to be Amplified.",
  radiant:
    "A Solar weapon-damage buff. While Radiant, your weapons deal increased damage and can interact with effects that require Radiant.",
  restoration:
    "A Solar healing buff that continuously regenerates health and shields for its duration and is not interrupted by taking damage.",
  cure:
    "A Solar healing effect that immediately restores a chunk of health when it is applied.",
  overshield:
    "A protective shield layered over your normal health and shields. Void Overshield also supports effects that specifically require an Overshield.",
  devour:
    "A Void buff that restores health on final blows, extends Devour, and contributes to grenade-energy regeneration while active.",
  invisibility:
    "A Void buff that makes you harder for enemies to detect. Attacking or using some abilities can end the effect.",
  "frost-armor":
    "A Stasis defensive buff that reduces incoming damage. Additional stacks can strengthen the protection up to its allowed maximum.",
  "woven-mail":
    "A Strand defensive buff that reduces incoming non-precision damage from combatants while active.",
  transcendence:
    "A Prismatic empowered state fueled by Light and Darkness energy that enhances your ability loop and grants access to your Transcendence grenade.",
  "volatile-rounds":
    "A Void weapon buff that lets eligible Void weapons apply Volatile to targets.",
  "unraveling-rounds":
    "A Strand weapon buff that lets eligible Strand weapons apply Unravel to targets.",
  "damage-resistance":
    "Reduces incoming damage while the relevant condition is active. The exact amount and conditions come from the source perk or ability.",
  "weapon-damage":
    "Increases weapon damage while the source effect is active. The exact bonus and conditions are defined by the perk or ability granting it.",
  blind:
    "An Arc debuff that disorients combatants and limits their ability to attack effectively. Its behavior against Guardians differs from PvE combatants.",
  jolt:
    "An Arc debuff that causes the target to release damaging chain lightning when it takes additional damage.",
  scorch:
    "A Solar stacking damage-over-time debuff. Building enough Scorch on a target can trigger an Ignition.",
  ignition:
    "A large Solar explosion triggered by certain effects or by reaching enough Scorch stacks, damaging nearby enemies.",
  volatile:
    "A Void debuff that causes the target to explode after taking enough additional damage, damaging nearby enemies.",
  weaken:
    "A Void debuff that causes the affected target to take increased damage from attackers while Weaken is active.",
  suppression:
    "A Void debuff that disrupts abilities and special actions. Against combatants it can prevent many abilities; against Guardians it suppresses their abilities.",
  slow:
    "A Stasis stacking debuff that reduces movement and combat effectiveness. Accumulating enough Slow can Freeze the target.",
  freeze:
    "A Stasis debuff that immobilizes the target until the Freeze ends or the target is shattered or breaks free.",
  shatter:
    "A Stasis damage event created by breaking a frozen target or Stasis crystal, dealing burst damage around the shatter.",
  sever:
    "A Strand debuff that reduces the damage dealt by the affected target while Sever is active.",
  suspend:
    "A Strand debuff that lifts and disables many combatants for a short time, limiting their actions.",
  unravel:
    "A Strand debuff that causes attacks on the target to create seeking Strand projectiles that can damage other enemies.",
  "ionic-trace":
    "An Arc pickup that travels toward its creator and grants ability energy when collected.",
  firesprite:
    "A Solar elemental pickup used by Solar subclass effects; collecting one can trigger effects defined by your equipped fragments or aspects.",
  "void-breach":
    "A Void elemental pickup used by Void subclass effects; collecting one can trigger effects defined by your equipped fragments or aspects.",
  "stasis-shard":
    "A Stasis elemental pickup used by Stasis subclass effects; collecting one can trigger effects defined by your current build.",
  tangle:
    "A Strand object created by certain Strand effects. It can be picked up, thrown, shot, or consumed by abilities and perks.",
  threadling:
    "A Strand creature that seeks nearby enemies and detonates on them. Some effects can perch Threadlings on the player for later release.",
  "ability-energy":
    "Grants or modifies ability energy. Check the source perk or ability description to see which ability receives energy and under what condition.",
};

function getCombatEffectDescription(effect: CombatEffectTag) {
  return (
    COMBAT_EFFECT_DESCRIPTIONS[effect.key] ??
    "Build-relevant combat effect detected from the source perk or ability description."
  );
}

function getCombatEffectKindLabel(kind: CombatEffectTag["kind"]) {
  return kind === "buff" ? "Buff" : kind === "debuff" ? "Debuff" : "Combat effect";
}

function FloatingInfoTooltip({
  children,
  eyebrow,
  title,
  description,
  footer,
  className = "",
}: {
  children: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  footer?: string;
  className?: string;
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    below: boolean;
  } | null>(null);

  const openTooltip = () => {
    const node = triggerRef.current;
    if (!node || typeof window === "undefined") return;

    const rect = node.getBoundingClientRect();
    const width = 288;
    const margin = 12;
    const left = Math.max(
      margin,
      Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - margin
      )
    );
    const below = rect.top < 190;

    setPosition({
      left,
      top: below ? rect.bottom + 10 : rect.top - 10,
      below,
    });
  };

  return (
    <span
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={openTooltip}
      onMouseLeave={() => setPosition(null)}
      onFocus={openTooltip}
      onBlur={() => setPosition(null)}
    >
      {children}
      {position &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            className="pointer-events-none fixed z-[300] w-72 rounded-xl border border-white/15 bg-[#0b0d11]/[0.99] p-3 text-left shadow-2xl backdrop-blur"
            style={{
              left: position.left,
              top: position.top,
              transform: position.below ? "none" : "translateY(-100%)",
            }}
          >
            {eyebrow && (
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                {eyebrow}
              </span>
            )}
            <span className="mt-0.5 block text-sm font-semibold text-white">
              {title}
            </span>
            {description && (
              <span className="mt-2 block text-xs leading-relaxed text-white/65">
                {description}
              </span>
            )}
            {footer && (
              <span className="mt-2 block border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/40">
                {footer}
              </span>
            )}
          </span>,
          document.body
        )}
    </span>
  );
}

function CombatEffectBadge({
  effect,
  compact = false,
}: {
  effect: CombatEffectTag;
  compact?: boolean;
}) {
  const description = getCombatEffectDescription(effect);

  return (
    <FloatingInfoTooltip
      eyebrow={getCombatEffectKindLabel(effect.kind)}
      title={effect.label}
      description={description}
    >
      <span
        tabIndex={0}
        className={`cursor-help rounded-md border ${
          compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
        } ${getCombatEffectBadgeClass(effect.kind)}`}
      >
        {effect.label}
      </span>
    </FloatingInfoTooltip>
  );
}

function getCombatEffectBadgeClass(kind: CombatEffectTag["kind"]) {
  switch (kind) {
    case "buff":
      return "border-emerald-400/25 bg-emerald-400/5 text-emerald-200";
    case "debuff":
      return "border-rose-400/25 bg-rose-400/5 text-rose-200";
    default:
      return "border-sky-400/25 bg-sky-400/5 text-sky-200";
  }
}

function isMeaningfulArtifactPerk(
  perk: DetailPerk | null | undefined
) {
  if (!perk) {
    return false;
  }

  const name = perk.name.trim().toLowerCase();
  const identifier =
    perk.plugCategoryIdentifier?.trim().toLowerCase() ?? "";

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

function isArtifactItem(item: DestinyItem) {
  return (
    item.itemType === 28 ||
    item.itemTypeDisplayName?.toLowerCase().includes("artifact") === true
  );
}

function getItemLocationLabel(item: DestinyItem) {
  const location = item.location;

  if (item.isEquipped || location?.type === "equipped") {
    return "Equipped in Destiny";
  }

  switch (location?.type) {
    case "characterInventory":
      return "Guardian inventory";
    case "vault":
      return "Vault";
    case "otherGuardian":
      return `${location.className ?? "Other Guardian"} · ${
        location.placement === "equipped" ? "Equipped" : "Inventory"
      }`;
    case "missing":
      return "Not owned";
    default:
      return "Current Guardian";
  }
}

function getEffectiveGearTier(
  item: DestinyItem,
  detail: ItemDetail | null
) {
  return detail?.gearTier ?? item.gearTier ?? null;
}

function getEffectivePower(
  item: DestinyItem,
  detail: ItemDetail | null
) {
  return detail?.power ?? item.power ?? null;
}

function getEffectiveStats(
  item: DestinyItem,
  detail: ItemDetail | null
) {
  const source =
    item.category === "armor"
      ? detail?.armorStats?.length
        ? detail.armorStats
        : item.armorStats
      : detail?.stats?.length
      ? detail.stats
      : item.stats;

  return (source ?? []).filter(
    (stat) =>
      stat.name &&
      stat.name !== "Unknown Stat" &&
      Number.isFinite(stat.value)
  );
}

function getQuickPerks(detail: ItemDetail | null) {
  if (!detail) {
    return [];
  }

  // The weapon plug classifier intentionally groups unfamiliar/new Bungie
  // categories as "other". Filtering that type removed legitimate equipped
  // barrel / magazine / trait plugs from the quick card on newer weapons.
  // Instead, keep every selected live socket and only hide obvious cosmetic
  // or bookkeeping sockets that are not part of the weapon roll.
  const hiddenCategoryMarkers = [
    "shader",
    "ornament",
    "skin",
    "tracker",
    "kill_tracker",
    "memento",
    "crafting.recipes.empty_socket",
  ];

  const perks = detail.selectedPerks.filter((perk) => {
    if (detail.category !== "weapon") {
      return true;
    }

    const category = (perk.plugCategoryIdentifier ?? "").toLowerCase();
    return !hiddenCategoryMarkers.some((marker) =>
      category.includes(marker)
    );
  });

  return perks.filter(
    (perk, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.socketIndex === perk.socketIndex &&
          candidate.plugHash === perk.plugHash
      ) === index
  );
}

function isComparableItem(
  baseline: DestinyItem,
  candidate: DestinyItem
) {
  if (baseline.category !== candidate.category) {
    return false;
  }

  return (
    getEquipmentSlotHash(baseline) ===
    getEquipmentSlotHash(candidate)
  );
}

function PerkIconStrip({
  perks,
  size = "md",
  comparePerks = null,
  compareBySocket = false,
}: {
  perks: Array<{
    socketIndex?: number;
    plugHash?: number;
    perkHash?: number;
    name: string;
    description: string;
    icon: string | null;
    effectTags?: CombatEffectTag[];
  }>;
  size?: "sm" | "md";
  comparePerks?: Array<{
    socketIndex?: number;
    plugHash?: number;
    perkHash?: number;
    name: string;
    description: string;
    icon: string | null;
    effectTags?: CombatEffectTag[];
  }> | null;
  compareBySocket?: boolean;
}) {
  const iconClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";

  if (perks.length === 0) {
    return null;
  }

  const getIdentity = (perk: {
    plugHash?: number;
    perkHash?: number;
  }) => perk.plugHash ?? perk.perkHash ?? null;

  const getComparison = (perk: {
    socketIndex?: number;
    plugHash?: number;
    perkHash?: number;
  }) => {
    if (!comparePerks) {
      return null;
    }

    const match = compareBySocket && typeof perk.socketIndex === "number"
      ? comparePerks.find(
          (candidate) => candidate.socketIndex === perk.socketIndex
        ) ?? null
      : comparePerks.find(
          (candidate) => getIdentity(candidate) === getIdentity(perk)
        ) ?? null;

    if (!match) {
      return {
        state: "different" as const,
        label: "Only on this item",
      };
    }

    if (getIdentity(match) === getIdentity(perk)) {
      return {
        state: "same" as const,
        label: "Same as baseline",
      };
    }

    return {
      state: "different" as const,
      label: `Different from ${match.name}`,
    };
  };

  return (
    <div className="flex flex-wrap gap-2">
      {perks.map((perk, index) => {
        const comparison = getComparison(perk);
        const comparisonClass =
          comparison?.state === "same"
            ? "border-emerald-400/80 bg-emerald-400/10"
            : comparison?.state === "different"
            ? "border-amber-400/80 bg-amber-400/10"
            : "border-white/10 bg-white/5";

        const effectFooter = perk.effectTags?.length
          ? `Effects: ${perk.effectTags.map((effect) => effect.label).join(", ")}`
          : "";
        const footer = [effectFooter, comparison?.label ?? ""]
          .filter(Boolean)
          .join(" · ");

        return (
          <FloatingInfoTooltip
            key={`${perk.plugHash ?? perk.perkHash ?? index}-${index}`}
            eyebrow="Perk / socket"
            title={perk.name}
            description={perk.description || "No Bungie description available for this perk."}
            footer={footer || undefined}
          >
            <span
              tabIndex={0}
              className={`${iconClass} relative flex items-center justify-center overflow-hidden rounded-lg border ${comparisonClass}`}
            >
              {perk.icon ? (
                <img
                  src={`https://www.bungie.net${perk.icon}`}
                  alt={perk.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs text-white/30">?</span>
              )}
              {comparison && (
                <span
                  className={`absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ${
                    comparison.state === "same"
                      ? "bg-emerald-300"
                      : "bg-amber-300"
                  }`}
                />
              )}
            </span>
          </FloatingInfoTooltip>
        );
      })}
    </div>
  );
}

const ARMOR_STAT_ORDER = [
  2996146975, // Weapons
  392767087, // Health
  1943323491, // Class
  1735777505, // Grenade
  144602215, // Super
  4244567218, // Melee
] as const;

function StatList({
  stats,
  compareStats = null,
  includeMissingCompareStats = false,
}: {
  stats: DestinyItem["stats"];
  compareStats?: DestinyItem["stats"] | null;
  includeMissingCompareStats?: boolean;
}) {
  const compareSource = compareStats ?? [];
  const currentMap = new Map(
    stats.map((stat) => [stat.statHash, stat])
  );
  const compareStatMap = new Map(
    compareSource.map((stat) => [stat.statHash, stat])
  );

  // Armor 3.0 pieces can legitimately expose only their rolled stats in the
  // live item component. During a comparison we still need to render the full
  // six-stat set so a stat that exists on the baseline but is 0 on the
  // candidate is shown as a real negative delta instead of disappearing.
  const displayStats = includeMissingCompareStats
    ? [
        ...ARMOR_STAT_ORDER.filter(
          (hash) => currentMap.has(hash) || compareStatMap.has(hash)
        ),
        ...stats
          .map((stat) => stat.statHash)
          .filter((hash) => !ARMOR_STAT_ORDER.includes(hash as any)),
        ...compareSource
          .map((stat) => stat.statHash)
          .filter(
            (hash) =>
              !ARMOR_STAT_ORDER.includes(hash as any) &&
              !currentMap.has(hash)
          ),
      ]
        .filter((hash, index, all) => all.indexOf(hash) === index)
        .map((hash) => {
          const current = currentMap.get(hash);
          if (current) {
            return current;
          }

          const baseline = compareStatMap.get(hash);
          return baseline
            ? { ...baseline, value: 0 }
            : null;
        })
        .filter((stat): stat is DestinyItem["stats"][number] => stat !== null)
    : stats;

  if (displayStats.length === 0) {
    return (
      <p className="text-sm text-white/35">
        Statistics are loading or unavailable for this item.
      </p>
    );
  }

  const compareMap = new Map(
    compareSource.map((stat) => [stat.statHash, stat.value])
  );

  return (
    <div className="space-y-2">
      {displayStats.map((stat) => {
        const compareValue = compareMap.get(stat.statHash);
        const delta =
          typeof compareValue === "number"
            ? stat.value - compareValue
            : null;
        const canUseBar = stat.value >= 0 && stat.value <= 100;

        return (
          <div key={stat.statHash}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-white/55">
                {stat.name}
              </span>
              <span className="flex shrink-0 items-center gap-2 font-medium">
                {stat.value}
                {delta !== null && delta !== 0 && (
                  <span
                    className={
                      delta > 0
                        ? "text-emerald-300"
                        : "text-rose-300"
                    }
                  >
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </span>
                )}
              </span>
            </div>

            {canUseBar && (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white/55"
                  style={{ width: `${Math.max(2, stat.value)}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ItemOverviewPanel({
  item,
  detail,
  loading,
  compact = false,
  compareStats = null,
  compareItem = null,
  compareDetail = null,
  showComparisonHighlights = false,
  showStats = true,
}: {
  item: DestinyItem;
  detail: ItemDetail | null;
  loading: boolean;
  compact?: boolean;
  compareStats?: DestinyItem["stats"] | null;
  compareItem?: DestinyItem | null;
  compareDetail?: ItemDetail | null;
  showComparisonHighlights?: boolean;
  showStats?: boolean;
}) {
  const gearTier = getEffectiveGearTier(item, detail);
  const power = getEffectivePower(item, detail);
  const stats = getEffectiveStats(item, detail);
  const currentPerks = getQuickPerks(detail);
  const intrinsicPerks = detail?.intrinsicPerks ?? [];
  const itemSet = detail?.itemSet ?? null;
  const appliedAppearance = item.category === "armor" ? getAppliedAppearance(detail) : null;
  const currentCombatEffects = mergeCombatEffectTags(
    ...currentPerks.map((perk) => perk.effectTags),
    ...intrinsicPerks.map((perk) => perk.effectTags),
    ...(itemSet?.perks ?? []).map((perk) => perk.effectTags)
  );
  const armorStatTotal = detail?.armorStatTotal ?? null;
  const damageType = getDamageTypeName(
    detail?.damageType ?? item.damageType
  );

  const comparePower = compareItem
    ? getEffectivePower(compareItem, compareDetail)
    : null;
  const compareArmorStatTotal = compareItem
    ? compareDetail?.armorStatTotal ?? compareItem.armorStatTotal ?? null
    : null;
  const compareCurrentPerks = showComparisonHighlights
    ? getQuickPerks(compareDetail)
    : null;
  const compareIntrinsicPerks = showComparisonHighlights
    ? compareDetail?.intrinsicPerks ?? []
    : null;
  const compareSetPerks = showComparisonHighlights
    ? compareDetail?.itemSet?.perks ?? []
    : null;

  const powerDelta =
    showComparisonHighlights &&
    power !== null &&
    comparePower !== null
      ? power - comparePower
      : null;
  const armorTotalDelta =
    showComparisonHighlights &&
    armorStatTotal !== null &&
    compareArmorStatTotal !== null
      ? armorStatTotal - compareArmorStatTotal
      : null;

  const Delta = ({ value }: { value: number | null }) => {
    if (value === null || value === 0) {
      return null;
    }

    return (
      <span
        className={
          value > 0
            ? "ml-1 text-emerald-300"
            : "ml-1 text-rose-300"
        }
      >
        {value > 0 ? "+" : ""}
        {value}
      </span>
    );
  };

  return (
    <div className="min-w-0">
      <div className="flex gap-3">
        <ItemAppearanceIcon
          item={item}
          detail={detail}
          className={compact ? "h-12 w-12 shrink-0 rounded" : "h-16 w-16 shrink-0 rounded-xl"}
        />

        <div className="min-w-0 flex-1">
          <h3 className={`${compact ? "text-base" : "text-xl"} truncate font-bold`}>
            {item.name}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-white/50">
            <span>{detail?.tierTypeName ?? item.tierTypeName ?? "Unknown rarity"}</span>
            {gearTier !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span>·</span>
                <GearTierDots tier={gearTier} />
              </span>
            )}
            {power !== null && (
              <span>
                · Power {power}
                <Delta value={powerDelta} />
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-white/45">
            {detail?.itemTypeDisplayName ?? item.itemTypeDisplayName ?? "Unknown type"}
            {` · ${getGearSlotName(item)}`}
            {damageType ? ` · ${damageType}` : ""}
          </p>
          <p className="mt-1 text-xs text-white/35">
            {getItemLocationLabel(item)}
          </p>
          {appliedAppearance && (
            <p className="mt-1 text-[11px] text-violet-200/55">
              Appearance · {appliedAppearance.name} · hover icon for base armor
            </p>
          )}
        </div>
      </div>

      {showStats && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
              Statistics
            </p>
            {item.category === "armor" && armorStatTotal !== null && (
              <span className="text-xs font-semibold text-white/70">
                Total {armorStatTotal}
                <Delta value={armorTotalDelta} />
              </span>
            )}
          </div>
          {loading && stats.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-white/40">
              <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white" />
              Loading live stats...
            </div>
          ) : (
            <StatList
              stats={stats}
              compareStats={compareStats}
              includeMissingCompareStats={
                item.category === "armor" && showComparisonHighlights
              }
            />
          )}
        </div>
      )}

      {(currentPerks.length > 0 || loading) && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
              {item.category === "weapon" ? "Current roll" : "Current perks / sockets"}
            </p>
            {showComparisonHighlights && currentPerks.length > 0 && (
              <span className="text-[10px] text-white/30">
                Green = same · Amber = changed
              </span>
            )}
          </div>
          {currentPerks.length > 0 ? (
            <PerkIconStrip
              perks={currentPerks}
              size="sm"
              comparePerks={compareCurrentPerks}
              compareBySocket={item.category === "weapon" || item.category === "armor"}
            />
          ) : (
            <p className="text-xs text-white/35">Loading perk icons...</p>
          )}
        </div>
      )}

      {currentCombatEffects.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
            Combat effects
          </p>
          <div className="flex flex-wrap gap-2">
            {currentCombatEffects.map((effect) => (
              <CombatEffectBadge
                key={effect.key}
                effect={effect}
              />
            ))}
          </div>
        </div>
      )}

      {item.category === "armor" && intrinsicPerks.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
            Exotic / intrinsic
          </p>
          <PerkIconStrip
            perks={intrinsicPerks}
            size="sm"
            comparePerks={compareIntrinsicPerks}
          />
        </div>
      )}

      {item.category === "armor" && itemSet && itemSet.perks.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
            Armor set bonuses
          </p>
          <div className="flex flex-wrap gap-2">
            {itemSet.perks.map((perk, index) => {
              const comparePerk = compareSetPerks?.find(
                (candidate) =>
                  candidate.requiredSetCount === perk.requiredSetCount
              );
              const isSame = Boolean(
                comparePerk &&
                comparePerk.perkHash === perk.perkHash
              );
              const comparisonClass = !showComparisonHighlights
                ? "border-white/10 bg-white/5"
                : isSame
                ? "border-emerald-400/80 bg-emerald-400/10"
                : "border-amber-400/80 bg-amber-400/10";

              return (
                <div
                  key={`${perk.requiredSetCount}-${perk.perkHash ?? index}`}
                  title={`${perk.name}${perk.description ? `\n${perk.description}` : ""}${showComparisonHighlights ? `\n${isSame ? "Same as baseline" : "Different from baseline"}` : ""}`}
                  className={`relative h-9 w-9 rounded-lg border p-1 ${comparisonClass}`}
                >
                  {perk.icon ? (
                    <img
                      src={`https://www.bungie.net${perk.icon}`}
                      alt={perk.name}
                      className="h-full w-full rounded object-cover"
                    />
                  ) : (
                    <div className="h-full w-full rounded bg-white/5" />
                  )}
                  <span className="absolute -bottom-1 -right-1 rounded bg-black px-1 text-[9px] font-bold text-white/70">
                    {perk.requiredSetCount}x
                  </span>
                  {showComparisonHighlights && (
                    <span
                      className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${
                        isSame ? "bg-emerald-300" : "bg-amber-300"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonInspector({
  baseline,
  baselineDetail,
  candidate,
  candidateDetail,
  candidateLoading,
  onDetails,
}: {
  baseline: DestinyItem;
  baselineDetail: ItemDetail | null;
  candidate: DestinyItem;
  candidateDetail: ItemDetail | null;
  candidateLoading: boolean;
  onDetails: (item: DestinyItem) => void;
}) {
  const baselineStats = getEffectiveStats(baseline, baselineDetail);

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
            Baseline
          </div>
          <ItemOverviewPanel
            item={baseline}
            detail={baselineDetail}
            loading={!baselineDetail}
            compact
          />
        </div>

        <div className="rounded-xl border border-white/20 bg-white/[0.05] p-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
            <span>Candidate</span>
            <span className="normal-case tracking-normal text-white/30">
              Changes vs {baseline.name}
            </span>
          </div>
          <ItemOverviewPanel
            item={candidate}
            detail={candidateDetail}
            loading={candidateLoading}
            compact
            compareStats={baselineStats}
            compareItem={baseline}
            compareDetail={baselineDetail}
            showComparisonHighlights
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[10px] text-white/40">
        <span>
          Stat deltas, Power, Tier, perks and armor bonuses are shown directly on the candidate card.
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-300" /> Same
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-300" /> Different
          </span>
        </span>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onDetails(baseline)}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60 hover:bg-white/5 hover:text-white"
        >
          Base details
        </button>
        <button
          type="button"
          onClick={() => onDetails(candidate)}
          className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"
        >
          Candidate details
        </button>
      </div>
    </div>
  );
}

function ItemHoverInspector({
  item,
  detail,
  loading,
  compareBaseline,
  compareDetail,
  onCompare,
  onDetails,
  onChangeGear,
  onClose,
  onInspectorEnter,
  onInspectorLeave,
  anchorX,
  anchorY,
  viewportWidth,
  viewportHeight,
}: {
  item: DestinyItem;
  detail: ItemDetail | null;
  loading: boolean;
  compareBaseline: DestinyItem | null;
  compareDetail: ItemDetail | null;
  onCompare: (item: DestinyItem) => void;
  onDetails: (item: DestinyItem) => void;
  onChangeGear: (item: DestinyItem) => void;
  onClose: () => void;
  onInspectorEnter: () => void;
  onInspectorLeave: () => void;
  anchorX: number;
  anchorY: number;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const comparing =
    compareBaseline &&
    getItemIdentity(compareBaseline) !== getItemIdentity(item);
  const compatible =
    compareBaseline && isComparableItem(compareBaseline, item);

  const comparisonOpen = Boolean(comparing && compatible);
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState(440);

  useEffect(() => {
    const node = inspectorRef.current;
    if (!node) return;

    const frame = window.requestAnimationFrame(() => {
      setMeasuredHeight(
        Math.min(node.scrollHeight, Math.max(220, viewportHeight - 32))
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    item.itemInstanceId,
    detail,
    loading,
    comparisonOpen,
    viewportHeight,
  ]);

  const inspectorWidth = Math.min(
    comparisonOpen ? 928 : 432,
    Math.max(300, viewportWidth - 32)
  );
  const gap = 18;
  let inspectorLeft = anchorX + gap;

  if (inspectorLeft + inspectorWidth > viewportWidth - 16) {
    inspectorLeft = anchorX - inspectorWidth - gap;
  }

  inspectorLeft = Math.max(
    16,
    Math.min(inspectorLeft, viewportWidth - inspectorWidth - 16)
  );

  const viewportMargin = 16;
  const safeTop = 128;
  const verticalGap = 18;
  const maxAvailableHeight = Math.max(
    220,
    viewportHeight - safeTop - viewportMargin
  );
  const effectiveHeight = Math.min(measuredHeight, maxAvailableHeight);
  let inspectorTop = Math.max(safeTop, anchorY - 48);

  if (inspectorTop + effectiveHeight > viewportHeight - viewportMargin) {
    inspectorTop = Math.max(
      safeTop,
      anchorY - effectiveHeight - verticalGap
    );
  }

  if (inspectorTop + effectiveHeight > viewportHeight - viewportMargin) {
    inspectorTop = Math.max(
      safeTop,
      viewportHeight - effectiveHeight - viewportMargin
    );
  }

  const inspectorMaxHeight = maxAvailableHeight;

  return (
    <div
      ref={inspectorRef}
      data-item-quick-overview="true"
      onMouseEnter={onInspectorEnter}
      onMouseLeave={onInspectorLeave}
      style={{
        left: inspectorLeft,
        top: inspectorTop,
        width: inspectorWidth,
        maxHeight: inspectorMaxHeight,
      }}
      className="fixed z-[95] overflow-y-auto rounded-2xl border border-white/15 bg-[#0a0c10]/98 p-4 shadow-2xl backdrop-blur"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
          {comparing && compatible ? "Comparison" : "Quick overview"}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-white/40 hover:bg-white/5 hover:text-white"
        >
          Close
        </button>
      </div>

      {comparing && compatible && compareBaseline ? (
        <ComparisonInspector
          baseline={compareBaseline}
          baselineDetail={compareDetail}
          candidate={item}
          candidateDetail={detail}
          candidateLoading={loading}
          onDetails={onDetails}
        />
      ) : (
        <>
          <ItemOverviewPanel
            item={item}
            detail={detail}
            loading={loading}
          />

          {compareBaseline && comparing && !compatible && (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/45">
              Compare mode is active, but this item is in a different equipment slot. Select an item from the same slot.
            </p>
          )}

          {compareBaseline && !comparing && (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/45">
              This is your comparison baseline. Select another item from the same slot.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => onChangeGear(item)}
              className="min-w-[110px] flex-1 rounded-lg border border-cyan-200/35 bg-cyan-200/[0.08] px-3 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-200/[0.15]"
            >
              Change Gear
            </button>
            <button
              type="button"
              onClick={() => onCompare(item)}
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10"
            >
              {compareBaseline && getItemIdentity(compareBaseline) === getItemIdentity(item)
                ? "Comparison baseline"
                : "Compare"}
            </button>
            <button
              type="button"
              onClick={() => onDetails(item)}
              className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-white/90"
            >
              Details
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SubclassQuickInspector({
  label,
  slot,
  plug,
  theoretical,
  editHref,
  onClose,
}: {
  label: string;
  slot: SubclassSlot;
  plug: SubclassPlug | null;
  theoretical: boolean;
  editHref: string;
  onClose: () => void;
}) {
  return (
    <aside className="fixed right-4 top-32 z-[96] w-[min(390px,calc(100vw-2rem))] border border-white/15 bg-[#0a0c10]/98 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/30">Quick overview · {label}</p>
          <h3 className="mt-1 text-lg font-black uppercase tracking-[0.05em]">{plug?.name ?? "No option selected"}</h3>
        </div>
        <button type="button" onClick={onClose} className="px-2 py-1 text-xs text-white/40 hover:bg-white/5 hover:text-white">Close</button>
      </div>

      <div className="mt-4 flex gap-4">
        {plug?.icon ? (
          <img src={`https://www.bungie.net${plug.icon}`} alt="" className="h-16 w-16 shrink-0 object-contain" />
        ) : (
          <div className="h-16 w-16 shrink-0 border border-white/10 bg-white/[0.03]" />
        )}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.12em] text-white/35">
            {theoretical || plug?.unlocked === false ? "Theory preview" : plug?.equipped ? "Equipped in Destiny" : "Builder preview"}
          </p>
          {plug?.description && <p className="mt-2 text-sm leading-relaxed text-white/55">{plug.description}</p>}
        </div>
      </div>

      {plug?.statEffects?.length ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Stat effects</p>
          <div className="flex flex-wrap gap-2">
            {plug.statEffects.map((effect) => (
              <span key={`${effect.statHash}-${effect.value}`} className={`border px-2 py-1 text-xs ${effect.value >= 0 ? "border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-200" : "border-rose-300/20 bg-rose-300/[0.05] text-rose-200"}`}>
                {effect.value > 0 ? "+" : ""}{effect.value} {effect.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {plug?.effectTags?.length ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30">Combat effects</p>
          <div className="flex flex-wrap gap-2">
            {plug.effectTags.map((effect) => <CombatEffectBadge key={effect.key} effect={effect} />)}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex gap-2 border-t border-white/10 pt-4">
        <Link href={editHref} className="flex-1 bg-white px-3 py-2.5 text-center text-xs font-black uppercase tracking-[0.12em] text-black hover:bg-white/90">
          Open in Subclass Editor
        </Link>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-white/25">Slot {slot.socketIndex}. Build is viewer-first; changes are made in the dedicated Subclass Editor.</p>
    </aside>
  );
}

function RecoilIndicator({ value }: { value: number | null }) {
  if (value === null) {
    return null;
  }

  // Destiny exposes a 0-100 Recoil Direction stat. The cone below derives its
  // left/right bias and spread from that value instead of inventing an angle.
  const signedDirection =
    Math.sin((value + 5) * (Math.PI / 10)) * (100 - value);
  const direction = signedDirection * 0.8 * (Math.PI / 180);
  const maxSpread = 180;
  const spread =
    ((100 - value) / 100) *
    (maxSpread / 2) *
    (Math.PI / 180) *
    (Math.sign(direction) || 1);

  const x = Math.sin(direction);
  const y = Math.cos(direction);
  const xMore = Math.sin(direction + spread);
  const yMore = Math.cos(direction + spread);
  const xLess = Math.sin(direction - spread);
  const yLess = Math.cos(direction - spread);

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30 p-2">
        <svg viewBox="0 0 2 2" className="h-20 w-20 overflow-hidden" aria-label={`Recoil direction ${value}`}>
          <circle r="1" cx="1" cy="1" fill="rgba(255,255,255,0.08)" />
          {value >= 95 ? (
            <line
              x1={1 - x}
              y1={1 + y}
              x2={1 + x}
              y2={1 - y}
              stroke="white"
              strokeWidth="0.08"
            />
          ) : (
            <path
              d={`M1,1 L${1 + xMore},${1 - yMore} A1,1 0 0,${direction < 0 ? 1 : 0} ${1 + xLess},${1 - yLess} Z`}
              fill="rgba(255,255,255,0.86)"
            />
          )}
          <line x1="1" y1="1" x2="1" y2="0.08" stroke="rgba(255,255,255,0.22)" strokeWidth="0.025" />
        </svg>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-white/35">
          Recoil Direction
        </p>
        <p className="mt-1 text-3xl font-bold">{value}</p>
        <p className="mt-1 text-xs text-white/40">
          Live Destiny stat · higher values tighten the recoil cone.
        </p>
      </div>
    </div>
  );
}

function PerkStateIcon({
  perk,
  previewSelected,
  onClick,
  disabled = false,
  disabledReason = "Already selected in another slot",
}: {
  perk: DetailPerk;
  previewSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const stateClass =
    perk.state === "selected"
      ? "border-sky-400 bg-sky-400/10"
      : perk.state === "rolled"
      ? "border-yellow-400/80 bg-yellow-400/5"
      : "border-white/15 bg-white/[0.02] opacity-65";

  const stateLabel = disabled
    ? disabledReason
    : perk.state === "selected"
    ? "Selected now"
    : perk.state === "rolled"
    ? "Rolled on this copy"
    : "Possible on this item";
  const effectText = (perk.effectTags ?? [])
    .map(
      (effect) =>
        `${effect.label}: ${getCombatEffectDescription(effect)}`
    )
    .join(" · ");
  const footer = [effectText, stateLabel].filter(Boolean).join(" · ");

  return (
    <FloatingInfoTooltip
      eyebrow="Perk / socket option"
      title={perk.name}
      description={perk.description || "No Bungie description available for this option."}
      footer={footer || undefined}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`relative h-11 w-11 rounded-lg border p-1 transition hover:opacity-100 ${stateClass} ${
          previewSelected ? "outline outline-2 outline-white outline-offset-2" : ""
        } ${disabled ? "cursor-not-allowed opacity-25" : ""}`}
      >
        {perk.icon ? (
          <img
            src={`https://www.bungie.net${perk.icon}`}
            alt={perk.name}
            className="h-full w-full rounded object-cover"
          />
        ) : (
          <span className="text-xs text-white/30">?</span>
        )}
      </button>
    </FloatingInfoTooltip>
  );
}

function getDetailColumnLabel(column: ItemDetail["perkColumns"][number]) {
  const identifier = column.all
    .map((perk) => perk.plugCategoryIdentifier ?? "")
    .join(" ")
    .toLowerCase();
  const type = column.selected?.type ?? column.all[0]?.type ?? "other";

  if (identifier.includes("masterwork")) return "Masterwork";
  if (identifier.includes("shader")) return "Shader";
  if (identifier.includes("ornament") || identifier.includes("skin")) return "Ornament";
  if (identifier.includes("memento")) return "Memento";
  if (identifier.includes("tracker")) return "Tracker";
  if (identifier.includes("mod")) return "Mod";
  if (type !== "other") {
    return type.replace(/(^|_)([a-z])/g, (_, prefix, letter) => `${prefix ? " " : ""}${letter.toUpperCase()}`).trim();
  }
  return `Socket ${column.socketIndex + 1}`;
}

function shouldCompactDetailColumn(column: ItemDetail["perkColumns"][number]) {
  const identifier = column.all
    .map((perk) => perk.plugCategoryIdentifier ?? "")
    .join(" ")
    .toLowerCase();

  return (
    /shader|ornament|skin|masterwork|mod|memento|tracker|cosmetic/.test(identifier) ||
    (column.socketIndex >= 5 && column.all.length > 6)
  );
}

function DetailPerkColumn({
  column,
  previewHash,
  onPreview,
  forceExpanded = false,
  forceCompact = false,
  blockedPlugHashes = new Set<number>(),
}: {
  column: ItemDetail["perkColumns"][number];
  previewHash: number | null;
  onPreview: (plugHash: number) => void;
  forceExpanded?: boolean;
  forceCompact?: boolean;
  blockedPlugHashes?: Set<number>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"state" | "name">("state");
  const label = getDetailColumnLabel(column);
  const compact =
    forceCompact || (!forceExpanded && shouldCompactDetailColumn(column));

  const visible = column.all
    .filter((perk) => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return true;
      return (
        perk.name.toLowerCase().includes(normalized) ||
        perk.description.toLowerCase().includes(normalized)
      );
    })
    .sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name);
      const rank = (state: DetailPerkState) =>
        state === "selected" ? 0 : state === "rolled" ? 1 : 2;
      return rank(a.state) - rank(b.state) || a.name.localeCompare(b.name);
    });

  if (!compact) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          {label}
        </p>
        <div className="flex flex-wrap gap-3">
          {column.all.map((perk) => (
            <PerkStateIcon
              key={`${column.socketIndex}-${perk.plugHash}`}
              perk={perk}
              previewSelected={previewHash === perk.plugHash}
              onClick={() => onPreview(perk.plugHash)}
              disabled={
                blockedPlugHashes.has(perk.plugHash) &&
                previewHash !== perk.plugHash
              }
            />
          ))}
        </div>
      </div>
    );
  }

  const current =
    column.all.find((perk) => perk.plugHash === previewHash) ??
    column.selected ??
    column.rolled[0] ??
    column.all[0] ??
    null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
            {label}
          </p>
          <p className="mt-1 truncate text-sm text-white/55">
            {current?.name ?? `${column.all.length} options`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {current && (
            <PerkStateIcon
              perk={current}
              previewSelected={previewHash === current.plugHash}
              onClick={() => onPreview(current.plugHash)}
              disabled={
                blockedPlugHashes.has(current.plugHash) &&
                previewHash !== current.plugHash
              }
            />
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/65 hover:bg-white/5 hover:text-white"
          >
            Change option ({column.all.length})
          </button>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="max-h-[82vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-[#0d0f13] p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/35">Change option</p>
                <h4 className="mt-1 text-xl font-bold">{label}</h4>
                <p className="mt-1 text-xs text-white/40">
                  Blue = active · Yellow = rolled on this copy · Grey = possible.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mb-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/30"
              />
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as "state" | "name")}
                className="rounded-lg border border-white/10 bg-[#111318] px-3 py-2 text-sm text-white/65 outline-none"
              >
                <option value="state">Active / rolled first</option>
                <option value="name">Name A-Z</option>
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {visible.map((perk) => {
                const isBlocked =
                  blockedPlugHashes.has(perk.plugHash) &&
                  previewHash !== perk.plugHash;

                return (
                <button
                  key={`${column.socketIndex}-${perk.plugHash}`}
                  type="button"
                  title={`${perk.name}${perk.description ? `\n${perk.description}` : ""}${
                    perk.effectTags?.length
                      ? `\n\n${perk.effectTags
                          .map(
                            (effect) =>
                              `${effect.label}: ${getCombatEffectDescription(effect)}`
                          )
                          .join("\n")}`
                      : ""
                  }`}
                  disabled={isBlocked}
                  onClick={() => {
                    if (isBlocked) {
                      return;
                    }
                    onPreview(perk.plugHash);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                    isBlocked
                      ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-30"
                      : "hover:bg-white/[0.07]"
                  } ${
                    perk.state === "selected"
                      ? "border-sky-400/70 bg-sky-400/10"
                      : perk.state === "rolled"
                      ? "border-yellow-400/60 bg-yellow-400/5"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  {perk.icon ? (
                    <img
                      src={`https://www.bungie.net${perk.icon}`}
                      alt={perk.name}
                      className="h-10 w-10 rounded"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-white/5" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{perk.name}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-white/35">
                      {isBlocked ? "Already selected" : perk.state}
                    </p>
                    {perk.description && (
                      <p className="mt-1 max-h-10 overflow-hidden text-[11px] leading-5 text-white/45">
                        {perk.description}
                      </p>
                    )}
                    {(perk.effectTags?.length ?? 0) > 0 && (
                      <p className="mt-1 truncate text-[10px] text-white/35">
                        {perk.effectTags.map((effect) => effect.label).join(" · ")}
                      </p>
                    )}
                  </div>
                </button>
                );
              })}
            </div>

            {visible.length === 0 && (
              <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-white/35">
                No options match this search.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemDetailsDrawer({
  item,
  detail,
  loading,
  onClose,
  onCompare,
}: {
  item: DestinyItem;
  detail: ItemDetail | null;
  loading: boolean;
  onClose: () => void;
  onCompare: (item: DestinyItem) => void;
}) {
  const [previewBySocket, setPreviewBySocket] =
    useState<Record<string, number>>({});

  useEffect(() => {
    setPreviewBySocket({});
  }, [item.itemInstanceId]);

  const stats = getEffectiveStats(item, detail);
  const intrinsicPerks = detail?.intrinsicPerks ?? [];
  const itemSet = detail?.itemSet ?? null;
  const perkColumns = detail?.perkColumns ?? [];

  return (
    <div className="fixed inset-0 z-[110] bg-black/65 backdrop-blur-sm" onMouseDown={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-[min(760px,96vw)] overflow-y-auto border-l border-white/15 bg-[#0b0d11] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#0b0d11]/95 px-5 py-4 backdrop-blur">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/35">
              Item details
            </p>
            <h2 className="mt-1 text-xl font-bold">{item.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="p-5">
          <ItemOverviewPanel
            item={item}
            detail={detail}
            loading={loading}
            showStats={false}
          />

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => onCompare(item)}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
            >
              Set as comparison baseline
            </button>
          </div>

          {detail?.description && (
            <section className="mt-7 border-t border-white/10 pt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
                In-game description
              </p>
              <p className="mt-3 text-sm leading-6 text-white/65">
                {detail.description}
              </p>
            </section>
          )}

          <section className="mt-7 border-t border-white/10 pt-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
              Full statistics
            </p>
            <StatList stats={stats} />
          </section>

          {item.category === "weapon" && (
            <section className="mt-7 border-t border-white/10 pt-6">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
                Recoil
              </p>
              <RecoilIndicator value={detail?.recoilDirection ?? null} />
            </section>
          )}

          {intrinsicPerks.length > 0 && (
            <section className="mt-7 border-t border-white/10 pt-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
                Intrinsic / Exotic perk
              </p>
              <PerkIconStrip perks={intrinsicPerks} />
            </section>
          )}

          {itemSet && itemSet.perks.length > 0 && (
            <section className="mt-7 border-t border-white/10 pt-6">
              <div className="mb-4 flex items-center gap-3">
                {itemSet.icon && (
                  <img
                    src={`https://www.bungie.net${itemSet.icon}`}
                    alt=""
                    className="h-9 w-9 rounded"
                  />
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
                    Armor set
                  </p>
                  <p className="font-semibold">{itemSet.name}</p>
                </div>
              </div>
              <div className="space-y-3">
                {itemSet.perks.map((perk, index) => (
                  <div
                    key={`${perk.requiredSetCount}-${perk.perkHash ?? index}`}
                    className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div className="relative h-10 w-10 shrink-0 rounded-lg border border-white/10 bg-white/5 p-1">
                      {perk.icon && (
                        <img
                          src={`https://www.bungie.net${perk.icon}`}
                          alt=""
                          className="h-full w-full rounded"
                        />
                      )}
                      <span className="absolute -bottom-1 -right-1 rounded bg-black px-1 text-[9px] font-bold">
                        {perk.requiredSetCount}x
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold">{perk.name}</p>
                      {perk.description && (
                        <p className="mt-1 text-sm leading-5 text-white/50">
                          {perk.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {perkColumns.length > 0 && (
            <section className="mt-7 border-t border-white/10 pt-6">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">
                    Possible rolls
                  </p>
                  <p className="mt-1 text-xs text-white/40">
                    Click an icon to preview a socket choice locally. Nothing is changed in Destiny yet.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-[10px] text-white/45">
                  <span><b className="text-sky-300">Blue</b> selected</span>
                  <span><b className="text-yellow-300">Yellow</b> rolled</span>
                  <span><b className="text-white/55">Grey</b> possible</span>
                </div>
              </div>

              <div className="space-y-4">
                {perkColumns.map((column) => (
                  <DetailPerkColumn
                    key={column.socketIndex}
                    column={column}
                    previewHash={
                      previewBySocket[String(column.socketIndex)] ?? null
                    }
                    onPreview={(plugHash) =>
                      setPreviewBySocket((current) => ({
                        ...current,
                        [String(column.socketIndex)]: plugHash,
                      }))
                    }
                    forceCompact={item.category === "armor"}
                  />
                ))}
              </div>
            </section>
          )}

          {loading && !detail && (
            <div className="mt-8 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
              <div className="h-4 w-4 animate-spin rounded-full border border-white/20 border-t-white" />
              Loading detailed Bungie item data...
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function InGameLoadoutInspector({
  loadout,
  allItems,
  onClose,
}: {
  loadout: any;
  allItems: DestinyItem[];
  onClose: () => void;
}) {
  const byInstance = new Map(
    allItems
      .filter((item) => item.itemInstanceId)
      .map((item) => [String(item.itemInstanceId), item])
  );
  const entries = (loadout?.items ?? []).map((saved: any, index: number) => ({
    saved,
    index,
    item: byInstance.get(String(saved?.itemInstanceId ?? "")) ?? null,
  }));

  const resolved = entries.filter((entry: any) => entry.item);
  const unresolved = entries.length - resolved.length;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/15 bg-[#0d0f13] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5"
              style={
                loadout?.colorImage
                  ? {
                      backgroundImage: `url(https://www.bungie.net${loadout.colorImage})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {loadout?.icon ? (
                <img
                  src={`https://www.bungie.net${loadout.icon}`}
                  alt=""
                  className="h-10 w-10 object-contain"
                />
              ) : (
                <span className="text-lg font-bold text-white/50">L</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-white/35">In-game loadout</p>
              <h3 className="mt-1 truncate text-2xl font-bold">
                {loadout?.name ?? "Destiny Loadout"}
              </h3>
              <p className="mt-1 text-sm text-white/45">
                {entries.length} saved items · {resolved.length} resolved from the current account snapshot
                {unresolved > 0 ? ` · ${unresolved} still resolving` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(({ saved, item, index }: any) => (
            <div
              key={`${String(saved?.itemInstanceId ?? "missing")}-${index}`}
              className="rounded-xl border border-white/10 bg-black/30 p-3"
            >
              {item ? (
                <div className="flex gap-3">
                  {item.icon ? (
                    <img
                      src={`https://www.bungie.net${item.icon}`}
                      alt={item.name}
                      className="h-12 w-12 rounded"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded bg-white/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.name}</p>
                    <p className="mt-1 truncate text-xs text-white/45">
                      {item.itemTypeDisplayName ?? item.category} · {getItemLocationLabel(item)}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-white/30">
                      {(saved?.plugItemHashes ?? []).length} saved socket selections
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-white/60">Saved item</p>
                  <p className="mt-1 break-all text-xs text-white/35">
                    Instance {String(saved?.itemInstanceId ?? "Unknown")}
                  </p>
                  <p className="mt-2 text-xs text-white/35">
                    Waiting for Vault / other Guardian account gear to resolve this item.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArtifactCard({
  artifactProgression,
  artifactItem,
  artifactDetail,
  artifactLoading,
  candidates,
  equippedArtifact,
  previewPlugs,
  onEnsureDetail,
  onSelectArtifact,
  onResetArtifact,
  onSelectPlug,
  onResetPlug,
  compact = false,
  readOnly = false,
}: {
  artifactProgression: any;
  artifactItem: DestinyItem | null;
  artifactDetail: ItemDetail | null;
  artifactLoading: boolean;
  candidates: DestinyItem[];
  equippedArtifact: DestinyItem | null;
  previewPlugs: Record<string, number>;
  onEnsureDetail: (item: DestinyItem) => void;
  onSelectArtifact: (item: DestinyItem) => void;
  onResetArtifact: () => void;
  onSelectPlug: (socketIndex: number, plugHash: number) => void;
  onResetPlug: (socketIndex: number) => void;
  compact?: boolean;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [artifactPickerOpen, setArtifactPickerOpen] = useState(false);
  const [artifactQuery, setArtifactQuery] = useState("");

  useEffect(() => {
    if (!open && !artifactPickerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, artifactPickerOpen]);

  useEffect(() => {
    if (artifactItem) {
      onEnsureDetail(artifactItem);
    }
  }, [artifactItem?.itemInstanceId, artifactItem?.itemHash]);

  const progressionActivePerks = (artifactProgression?.tiers ?? [])
    .flatMap((tier: any) => tier?.items ?? [])
    .filter((perk: any) => perk?.isActive === true);

  const perkColumns = (artifactDetail?.perkColumns ?? [])
    .map((column) => {
      const all = column.all.filter(isMeaningfulArtifactPerk);
      const selected =
        column.selected && isMeaningfulArtifactPerk(column.selected)
          ? column.selected
          : null;
      const rolled = column.rolled.filter(isMeaningfulArtifactPerk);
      const possible = column.possible.filter(isMeaningfulArtifactPerk);

      return {
        ...column,
        selected,
        rolled,
        possible,
        all,
      };
    })
    .filter((column) => column.all.length > 0);

  const effectivePerks = perkColumns
    .map((column) => {
      const effectiveHash =
        previewPlugs[String(column.socketIndex)] ??
        column.selected?.plugHash ??
        null;
      if (effectiveHash === null) return null;
      return (
        column.all.find((perk) => perk.plugHash === effectiveHash) ??
        column.selected ??
        null
      );
    })
    .filter(Boolean) as DetailPerk[];

  const visibleActivePerks =
    effectivePerks.length > 0 ? effectivePerks : progressionActivePerks;

  const hasPreviewChanges =
    Object.keys(previewPlugs).length > 0 ||
    Boolean(
      artifactItem &&
        equippedArtifact &&
        getItemIdentity(artifactItem) !== getItemIdentity(equippedArtifact)
    );

  const filteredArtifacts = candidates.filter((candidate) => {
    const query = artifactQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      candidate.name.toLowerCase().includes(query) ||
      (candidate.itemTypeDisplayName ?? "").toLowerCase().includes(query)
    );
  });

  return (
    <div className={`border border-white/10 bg-white/[0.03] ${compact ? "p-3" : "rounded-2xl p-5"}`}>
      <div className={`flex flex-wrap items-center justify-between ${compact ? "gap-2" : "gap-4"}`}>
        <div className="flex items-center gap-4">
          {(artifactItem?.icon ?? artifactProgression?.icon) ? (
            <img
              src={`https://www.bungie.net${artifactItem?.icon ?? artifactProgression?.icon}`}
              alt={artifactItem?.name ?? artifactProgression?.name ?? "Seasonal Artifact"}
              className={compact ? "h-11 w-11 bg-white/5 p-1" : "h-16 w-16 rounded-xl bg-white/5 p-1"}
            />
          ) : (
            <div className="h-16 w-16 rounded-xl bg-white/10" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={compact ? "text-sm font-semibold" : "text-xl font-semibold"}>
                {artifactItem?.name ?? artifactProgression?.name ?? "Seasonal Artifact"}
              </h3>
              {artifactItem && equippedArtifact &&
                getItemIdentity(artifactItem) === getItemIdentity(equippedArtifact) && (
                  <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                    Equipped in Destiny
                  </span>
                )}
              {hasPreviewChanges && (
                <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/55">
                  Preview changed
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-white/45">
              {artifactItem
                ? `${getItemLocationLabel(artifactItem)}${artifactItem.power !== null ? ` · Power ${artifactItem.power}` : ""}`
                : `${artifactProgression?.pointsUsed ?? 0} points used`}
            </p>
            {!compact && artifactProgression && (
              <p className="mt-1 text-xs text-white/30">
                Bungie progression: {artifactProgression?.pointsUsed ?? 0} points used
                {typeof artifactProgression?.resetCount === "number"
                  ? ` · ${artifactProgression.resetCount} resets`
                  : ""}
              </p>
            )}
          </div>
        </div>

        {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setArtifactPickerOpen(true)}
            className={compact ? "border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] hover:bg-white/10" : "rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"}
          >
            Change Artifact ({candidates.length})
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={compact ? "border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] hover:bg-white/10" : "rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"}
          >
            Change perks
          </button>
          {hasPreviewChanges && (
            <button
              type="button"
              onClick={onResetArtifact}
              className={compact ? "border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white/55 hover:bg-white/5 hover:text-white" : "rounded-lg border border-white/10 px-4 py-2 text-sm text-white/55 hover:bg-white/5 hover:text-white"}
            >
              Reset to Destiny
            </button>
          )}
        </div>
        ) : (
          <span className="border border-white/10 bg-black/20 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">
            Build viewer
          </span>
        )}
      </div>

      <div className={`${compact ? "mt-3 pt-3" : "mt-5 pt-4"} border-t border-white/10`}>
        <div className={`${compact ? "mb-2" : "mb-3"} flex items-center justify-between gap-3`}>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">
            Active artifact perks
          </p>
          {artifactLoading && (
            <span className="flex items-center gap-2 text-xs text-white/35">
              <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white" />
              Reading Destiny sockets...
            </span>
          )}
        </div>
        {visibleActivePerks.length > 0 ? (
          <PerkIconStrip perks={visibleActivePerks} />
        ) : (
          <p className="text-sm text-white/35">
            No active Artifact perks have been resolved yet.
          </p>
        )}
      </div>

      {artifactPickerOpen && (
        <div
          className="fixed inset-0 z-[145] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={() => setArtifactPickerOpen(false)}
        >
          <div
            className="max-h-[82vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/15 bg-[#0d0f13] p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/35">Change Artifact</p>
                <h4 className="mt-1 text-xl font-bold">Available on this account</h4>
                <p className="mt-1 text-xs text-white/40">
                  The currently equipped Artifact comes directly from Destiny. Selecting another one changes only the Builder preview.
                </p>
              </div>
              <button type="button" onClick={() => setArtifactPickerOpen(false)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white">Close</button>
            </div>

            <input
              value={artifactQuery}
              onChange={(event) => setArtifactQuery(event.target.value)}
              placeholder="Search artifacts..."
              className="mb-4 w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/30"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              {filteredArtifacts.map((candidate) => {
                const selected = artifactItem && getItemIdentity(candidate) === getItemIdentity(artifactItem);
                const equipped = equippedArtifact && getItemIdentity(candidate) === getItemIdentity(equippedArtifact);
                return (
                  <button
                    key={getItemIdentity(candidate)}
                    type="button"
                    onClick={() => {
                      onSelectArtifact(candidate);
                      setArtifactPickerOpen(false);
                    }}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-white/50 bg-white/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}
                  >
                    {candidate.icon ? (
                      <img src={`https://www.bungie.net${candidate.icon}`} alt={candidate.name} className="h-12 w-12 rounded" />
                    ) : (
                      <div className="h-12 w-12 rounded bg-white/5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{candidate.name}</p>
                      <p className="mt-1 text-xs text-white/40">
                        {equipped ? "Equipped in Destiny" : getItemLocationLabel(candidate)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {filteredArtifacts.length === 0 && (
              <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-white/35">No Artifact matches this search.</p>
            )}
          </div>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[145] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/15 bg-[#0d0f13] p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/35">Artifact perks</p>
                <h3 className="mt-1 text-2xl font-bold">{artifactItem?.name ?? artifactProgression?.name ?? "Seasonal Artifact"}</h3>
                <p className="mt-2 text-sm text-white/45">
                  Blue is the perk currently selected in Destiny. A white outline marks a local Builder preview choice. Nothing is written to Destiny yet.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white">Close</button>
            </div>

            {artifactLoading && !artifactDetail && (
              <div className="mb-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                <div className="h-4 w-4 animate-spin rounded-full border border-white/20 border-t-white" />
                Reading the Artifact and its currently selected perks from Destiny...
              </div>
            )}

            {perkColumns.length > 0 ? (
              <div className="space-y-4">
                {perkColumns.map((column) => {
                  const blockedPlugHashes = new Set(
                    perkColumns
                      .filter(
                        (otherColumn) =>
                          otherColumn.socketIndex !== column.socketIndex
                      )
                      .map(
                        (otherColumn) =>
                          previewPlugs[String(otherColumn.socketIndex)] ??
                          otherColumn.selected?.plugHash ??
                          null
                      )
                      .filter(
                        (plugHash): plugHash is number =>
                          typeof plugHash === "number"
                      )
                  );

                  return (
                  <div key={column.socketIndex}>
                    <DetailPerkColumn
                      column={column}
                      previewHash={previewPlugs[String(column.socketIndex)] ?? null}
                      blockedPlugHashes={blockedPlugHashes}
                      onPreview={(plugHash) => {
                        if (!blockedPlugHashes.has(plugHash)) {
                          onSelectPlug(column.socketIndex, plugHash);
                        }
                      }}
                      forceExpanded
                    />
                    {previewPlugs[String(column.socketIndex)] !== undefined && (
                      <button type="button" onClick={() => onResetPlug(column.socketIndex)} className="mt-2 text-xs text-white/40 hover:text-white">
                        Reset this socket to Destiny
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            ) : (artifactProgression?.tiers ?? []).length > 0 ? (
              <div className="space-y-5">
                {(artifactProgression.tiers ?? []).map((tier: any, tierIndex: number) => (
                  <div key={`${tier.tierHash ?? tierIndex}`} className="rounded-xl border border-white/10 bg-black/25 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="font-semibold">{tier.title ?? `Tier ${tierIndex + 1}`}</h4>
                      <span className="text-xs text-white/35">
                        {tier.isUnlocked ? "Tier unlocked" : `Requires ${tier.minimumUnlockPointsUsedRequirement ?? 0} points`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {(tier.items ?? []).map((perk: any) => {
                        const stateClass = perk.isActive
                          ? "border-sky-400 bg-sky-400/10"
                          : perk.isUnlocked
                          ? "border-yellow-400/70 bg-yellow-400/5"
                          : "border-white/10 bg-white/[0.02] opacity-45";
                        return (
                          <div key={perk.itemHash} title={`${perk.name}${perk.description ? `\n${perk.description}` : ""}`} className={`h-12 w-12 rounded-xl border p-1 ${stateClass}`}>
                            {perk.icon ? (
                              <img src={`https://www.bungie.net${perk.icon}`} alt={perk.name} className="h-full w-full rounded object-cover" />
                            ) : (
                              <div className="h-full w-full rounded bg-white/5" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-white/40">Bungie returned the Artifact, but no socket choices could be resolved.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
