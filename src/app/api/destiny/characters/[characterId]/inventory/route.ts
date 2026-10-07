import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getInventoryItemDefinition } from "@/lib/bungie/manifest";
import { getItemCategory } from "@/lib/bungie/itemCategories";
import { getWeaponPlugType } from "@/lib/bungie/weaponRoll";
import { getStatDefinition } from "@/lib/bungie/stats";
import { getSubclassSlotType } from "@/lib/bungie/subclass";
import { getPlugSetDefinition } from "@/lib/bungie/plugSets";
import {
  getSubclassCatalog,
} from "@/lib/bungie/subclassCatalog";

const inventoryDefinitionCache = new Map<number, Promise<any>>();
const statDefinitionCache = new Map<number, Promise<any>>();
const plugSetDefinitionCache = new Map<number, Promise<any>>();
const genericManifestDefinitionCache = new Map<string, Promise<any>>();

const ARMOR_STAT_HASHES = [
  2996146975, // Weapons
  392767087, // Health
  1943323491, // Class
  1735777505, // Grenade
  144602215, // Super
  4244567218, // Melee
] as const;

const ARMOR_STAT_FALLBACK_NAMES = new Map<number, string>([
  [2996146975, "Weapons"],
  [392767087, "Health"],
  [1943323491, "Class"],
  [1735777505, "Grenade"],
  [144602215, "Super"],
  [4244567218, "Melee"],
]);

function isSubclassPlaceholderPlug(
  name: unknown,
  plugCategoryIdentifier: unknown = null
) {
  const normalizedName =
    typeof name === "string" ? name.trim().toLowerCase() : "";
  const normalizedIdentifier =
    typeof plugCategoryIdentifier === "string"
      ? plugCategoryIdentifier.trim().toLowerCase()
      : "";

  return (
    !normalizedName ||
    normalizedName === "unknown plug" ||
    normalizedName === "empty" ||
    normalizedName.startsWith("empty ") ||
    normalizedIdentifier.includes("empty_socket") ||
    normalizedIdentifier.includes("empty.socket") ||
    normalizedIdentifier.endsWith(".empty") ||
    normalizedIdentifier.includes(".empty.")
  );
}

function getAspectFragmentSlotCount(definition: any) {
  const value = definition?.plug?.energyCapacity?.capacityValue;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

const COMBAT_EFFECT_RULES = [
  { key: "amplified", label: "Amplified", kind: "buff", pattern: /\bamplif(?:ied|y|ication)\b/i },
  { key: "radiant", label: "Radiant", kind: "buff", pattern: /\bradiant\b/i },
  { key: "restoration", label: "Restoration", kind: "buff", pattern: /\brestoration\b/i },
  { key: "cure", label: "Cure", kind: "buff", pattern: /\bcure(?:d)?\b/i },
  { key: "overshield", label: "Overshield", kind: "buff", pattern: /\bovershield\b/i },
  { key: "devour", label: "Devour", kind: "buff", pattern: /\bdevour\b/i },
  { key: "invisibility", label: "Invisibility", kind: "buff", pattern: /\binvisib(?:le|ility)\b/i },
  { key: "frost-armor", label: "Frost Armor", kind: "buff", pattern: /\bfrost armor\b/i },
  { key: "woven-mail", label: "Woven Mail", kind: "buff", pattern: /\bwoven mail\b/i },
  { key: "transcendence", label: "Transcendence", kind: "buff", pattern: /\btranscenden(?:ce|t)\b/i },
  { key: "volatile-rounds", label: "Volatile Rounds", kind: "buff", pattern: /\bvolatile rounds\b/i },
  { key: "unraveling-rounds", label: "Unraveling Rounds", kind: "buff", pattern: /\bunravel(?:ing)? rounds\b/i },
  { key: "damage-resistance", label: "Damage Resistance", kind: "buff", pattern: /\bdamage resistance\b|\breduced incoming damage\b|\btake less damage\b/i },
  { key: "weapon-damage", label: "Weapon Damage", kind: "buff", pattern: /\b(?:increased|increase|bonus|more) (?:weapon )?damage\b|\bweapon damage (?:is )?increased\b/i },
  { key: "blind", label: "Blind", kind: "debuff", pattern: /\bblind(?:ed|ing)?\b/i },
  { key: "jolt", label: "Jolt", kind: "debuff", pattern: /\bjolt(?:ed|ing)?\b/i },
  { key: "scorch", label: "Scorch", kind: "debuff", pattern: /\bscorch(?:ed|ing)?\b/i },
  { key: "ignition", label: "Ignition", kind: "effect", pattern: /\bignit(?:e|es|ed|ing|ion|ions)\b/i },
  { key: "volatile", label: "Volatile", kind: "debuff", pattern: /\bvolatile\b/i },
  { key: "weaken", label: "Weaken", kind: "debuff", pattern: /\bweaken(?:ed|ing)?\b/i },
  { key: "suppression", label: "Suppression", kind: "debuff", pattern: /\bsuppress(?:ed|ion|ing)?\b/i },
  { key: "slow", label: "Slow", kind: "debuff", pattern: /\bslow(?:ed|ing)?\b/i },
  { key: "freeze", label: "Freeze", kind: "debuff", pattern: /\bfreez(?:e|es|ing)\b|\bfrozen\b/i },
  { key: "shatter", label: "Shatter", kind: "effect", pattern: /\bshatter(?:ed|ing)?\b/i },
  { key: "sever", label: "Sever", kind: "debuff", pattern: /\bsever(?:ed|ing)?\b/i },
  { key: "suspend", label: "Suspend", kind: "debuff", pattern: /\bsuspend(?:ed|ing)?\b/i },
  { key: "unravel", label: "Unravel", kind: "debuff", pattern: /\bunravel(?:ed|ing)?\b/i },
  { key: "ionic-trace", label: "Ionic Trace", kind: "effect", pattern: /\bionic traces?\b/i },
  { key: "firesprite", label: "Firesprite", kind: "effect", pattern: /\bfiresprites?\b/i },
  { key: "void-breach", label: "Void Breach", kind: "effect", pattern: /\bvoid breaches?\b/i },
  { key: "stasis-shard", label: "Stasis Shard", kind: "effect", pattern: /\bstasis shards?\b/i },
  { key: "tangle", label: "Tangle", kind: "effect", pattern: /\btangles?\b/i },
  { key: "threadling", label: "Threadling", kind: "effect", pattern: /\bthreadlings?\b/i },
  { key: "ability-energy", label: "Ability Energy", kind: "effect", pattern: /\b(?:ability|grenade|melee|class ability|super) energy\b/i },
] as const;

function getCombatEffectTags(...parts: unknown[]) {
  const text = parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");

  if (!text) {
    return [];
  }

  return COMBAT_EFFECT_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => ({
      key: rule.key,
      label: rule.label,
      kind: rule.kind,
    }));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  retries = 2
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 200 * (attempt + 1))
        );
      }
    }
  }

  throw lastError;
}

function getCachedInventoryItemDefinition(
  itemHash: number,
  apiKey: string
) {
  let cached = inventoryDefinitionCache.get(itemHash);

  if (!cached) {
    cached = withRetry(() =>
      getInventoryItemDefinition(itemHash, apiKey)
    ).catch((error) => {
      inventoryDefinitionCache.delete(itemHash);
      throw error;
    });

    inventoryDefinitionCache.set(itemHash, cached);
  }

  return cached;
}

function getCachedStatDefinition(
  statHash: number,
  apiKey: string
) {
  let cached = statDefinitionCache.get(statHash);

  if (!cached) {
    cached = withRetry(() =>
      getStatDefinition(statHash, apiKey)
    ).catch((error) => {
      statDefinitionCache.delete(statHash);
      throw error;
    });

    statDefinitionCache.set(statHash, cached);
  }

  return cached;
}

function getCachedPlugSetDefinition(
  plugSetHash: number,
  apiKey: string
) {
  let cached = plugSetDefinitionCache.get(plugSetHash);

  if (!cached) {
    cached = withRetry(() =>
      getPlugSetDefinition(plugSetHash, apiKey)
    ).catch((error) => {
      plugSetDefinitionCache.delete(plugSetHash);
      throw error;
    });

    plugSetDefinitionCache.set(plugSetHash, cached);
  }

  return cached;
}


function getCachedManifestDefinition(
  entityType: string,
  hash: number,
  apiKey: string
) {
  const key = `${entityType}:${hash}`;
  let cached = genericManifestDefinitionCache.get(key);

  if (!cached) {
    cached = withRetry(async () => {
      const response = await fetch(
        `https://www.bungie.net/Platform/Destiny2/Manifest/${entityType}/${hash}/`,
        {
          headers: {
            "X-API-Key": apiKey,
          },
          cache: "force-cache",
        }
      );

      const data = await response.json();

      if (!response.ok || data.ErrorCode !== 1) {
        throw new Error(
          `Failed to load ${entityType} definition for hash ${hash}`
        );
      }

      return data.Response;
    }).catch((error) => {
      genericManifestDefinitionCache.delete(key);
      throw error;
    });

    genericManifestDefinitionCache.set(key, cached);
  }

  return cached;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

function getGuardianClassName(classType: number | null) {
  switch (classType) {
    case 0:
      return "Titan";
    case 1:
      return "Hunter";
    case 2:
      return "Warlock";
    default:
      return "Unknown Guardian";
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await context.params;
  const scope = request.nextUrl.searchParams.get("scope") ?? "core";

  const cookieStore = await cookies();
  const accessToken = cookieStore.get("bungie_access_token")?.value;
  const apiKey = process.env.BUNGIE_API_KEY;

  if (!accessToken) {
    return NextResponse.json(
      { success: false, error: "User is not authenticated" },
      { status: 401 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "BUNGIE_API_KEY is missing" },
      { status: 500 }
    );
  }

  const membershipsResponse = await fetch(
    "https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    }
  );

  const membershipsData = await membershipsResponse.json();

  if (!membershipsResponse.ok || membershipsData.ErrorCode !== 1) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch memberships",
        details: membershipsData,
      },
      { status: membershipsResponse.status || 500 }
    );
  }

  const destinyMemberships =
    membershipsData.Response?.destinyMemberships ?? [];

  if (destinyMemberships.length === 0) {
    return NextResponse.json(
      { success: false, error: "No Destiny memberships found" },
      { status: 404 }
    );
  }

  const crossSaveMembership = destinyMemberships.find(
    (membership: any) =>
      membership.crossSaveOverride &&
      membership.crossSaveOverride !== 0 &&
      membership.membershipType === membership.crossSaveOverride
  );

  const activeMembership =
    crossSaveMembership ??
    destinyMemberships.find((membership: any) => membership.isPublic) ??
    destinyMemberships[0];

  const membershipType = activeMembership.membershipType;
  const membershipId = activeMembership.membershipId;

  if (scope === "detail") {
    const itemInstanceId =
      request.nextUrl.searchParams.get("itemInstanceId");
    const requestedItemHash = Number(
      request.nextUrl.searchParams.get("itemHash")
    );

    if (!itemInstanceId || !Number.isFinite(requestedItemHash)) {
      return NextResponse.json(
        {
          success: false,
          error: "itemInstanceId and itemHash are required for detail scope",
        },
        { status: 400 }
      );
    }

    const detailResponse = await fetch(
      `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/Item/${itemInstanceId}/?components=300,302,304,305,307,310`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-API-Key": apiKey,
        },
        cache: "no-store",
      }
    );

    const detailData = await detailResponse.json();

    if (!detailResponse.ok || detailData.ErrorCode !== 1) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to load item details",
          details: detailData,
        },
        { status: detailResponse.status || 500 }
      );
    }

    const definition = await getCachedInventoryItemDefinition(
      requestedItemHash,
      apiKey
    );

    const instance = detailData.Response?.instance?.data ?? null;
    const statsData = detailData.Response?.stats?.data ?? null;
    const socketsData = detailData.Response?.sockets?.data ?? null;
    const reusablePlugsData =
      detailData.Response?.reusablePlugs?.data ?? null;
    const livePerksData = detailData.Response?.perks?.data ?? null;

    const statHashes = [
      ...(statsData?.stats
        ? Object.values(statsData.stats)
            .map((stat: any) => stat.statHash)
            .filter(
              (hash: unknown): hash is number =>
                typeof hash === "number"
            )
        : []),
      ...(definition?.itemType === 2 ? ARMOR_STAT_HASHES : []),
    ];

    const statDefinitions = await mapWithConcurrency(
      [...new Set<number>(statHashes)],
      10,
      async (statHash) => {
        try {
          return [
            statHash,
            await getCachedStatDefinition(statHash, apiKey),
          ] as const;
        } catch {
          return [statHash, null] as const;
        }
      }
    );

    const statDefinitionMap = new Map(statDefinitions);

    const readableStats = statsData?.stats
      ? Object.values(statsData.stats).map((stat: any) => {
          const statDefinition =
            statDefinitionMap.get(stat.statHash);

          return {
            statHash: stat.statHash,
            name:
              statDefinition?.displayProperties?.name ??
              "Unknown Stat",
            description:
              statDefinition?.displayProperties?.description ?? "",
            value: stat.value ?? 0,
          };
        })
      : [];

    const socketEntries =
      definition?.sockets?.socketEntries ?? [];
    const liveSockets = socketsData?.sockets ?? [];

    const plugSetHashes = [
      ...new Set<number>(
        socketEntries
          .flatMap((entry: any) => [
            entry?.reusablePlugSetHash,
            entry?.randomizedPlugSetHash,
          ])
          .filter(
            (hash: unknown): hash is number =>
              typeof hash === "number" && hash > 0
          )
      ),
    ];

    const plugSetDefinitions = await mapWithConcurrency(
      plugSetHashes,
      10,
      async (plugSetHash) => {
        try {
          return [
            plugSetHash,
            await getCachedPlugSetDefinition(
              plugSetHash,
              apiKey
            ),
          ] as const;
        } catch {
          return [plugSetHash, null] as const;
        }
      }
    );

    const plugSetMap = new Map(plugSetDefinitions);

    const plugHashes = new Set<number>();

    liveSockets.forEach((socket: any) => {
      if (typeof socket?.plugHash === "number") {
        plugHashes.add(socket.plugHash);
      }
    });

    Object.values(reusablePlugsData?.plugs ?? {}).forEach(
      (plugs: any) => {
        for (const plug of plugs ?? []) {
          if (typeof plug?.plugItemHash === "number") {
            plugHashes.add(plug.plugItemHash);
          }
        }
      }
    );

    socketEntries.forEach((entry: any) => {
      for (const plug of entry?.reusablePlugItems ?? []) {
        if (typeof plug?.plugItemHash === "number") {
          plugHashes.add(plug.plugItemHash);
        }
      }

      for (const setHash of [
        entry?.reusablePlugSetHash,
        entry?.randomizedPlugSetHash,
      ]) {
        if (typeof setHash !== "number") {
          continue;
        }

        const plugSet = plugSetMap.get(setHash);

        for (const plug of plugSet?.reusablePlugItems ?? []) {
          if (typeof plug?.plugItemHash === "number") {
            plugHashes.add(plug.plugItemHash);
          }
        }
      }
    });

    const plugDefinitions = await mapWithConcurrency(
      [...plugHashes],
      12,
      async (plugHash) => {
        try {
          return [
            plugHash,
            await getCachedInventoryItemDefinition(
              plugHash,
              apiKey
            ),
          ] as const;
        } catch {
          return [plugHash, null] as const;
        }
      }
    );

    const plugDefinitionMap = new Map(plugDefinitions);

    const toPlug = (
      plugHash: number,
      socketIndex: number,
      state: "selected" | "rolled" | "possible"
    ) => {
      const plugDefinition =
        plugDefinitionMap.get(plugHash);

      if (!plugDefinition) {
        return null;
      }

      const name =
        plugDefinition?.displayProperties?.name ??
        "Unknown Plug";

      if (
        !name ||
        name === "Unknown Plug" ||
        name === "Empty Mod Socket" ||
        name === "Empty Aspect Socket" ||
        name === "Empty Fragment Socket"
      ) {
        return null;
      }

      const plugCategoryIdentifier =
        plugDefinition?.plug?.plugCategoryIdentifier ??
        null;
      const description =
        plugDefinition?.displayProperties?.description ?? "";

      return {
        socketIndex,
        plugHash,
        name,
        description,
        icon:
          plugDefinition?.displayProperties?.icon ?? null,
        plugCategoryIdentifier,
        type: getWeaponPlugType(
          plugCategoryIdentifier
        ),
        state,
        effectTags: getCombatEffectTags(
          name,
          description
        ),
      };
    };

    const perkColumns = socketEntries
      .map((entry: any, socketIndex: number) => {
        const selectedHash =
          liveSockets?.[socketIndex]?.plugHash ?? null;

        const rolledHashes = [
          ...new Set<number>(
            (
              reusablePlugsData?.plugs?.[socketIndex] ??
              reusablePlugsData?.plugs?.[
                String(socketIndex)
              ] ??
              []
            )
              .map((plug: any) => plug.plugItemHash)
              .filter(
                (hash: unknown): hash is number =>
                  typeof hash === "number"
              )
          ),
        ];

        const possibleHashes = new Set<number>();

        for (const plug of entry?.reusablePlugItems ?? []) {
          if (typeof plug?.plugItemHash === "number") {
            possibleHashes.add(plug.plugItemHash);
          }
        }

        for (const setHash of [
          entry?.reusablePlugSetHash,
          entry?.randomizedPlugSetHash,
        ]) {
          if (typeof setHash !== "number") {
            continue;
          }

          const plugSet = plugSetMap.get(setHash);

          for (const plug of plugSet?.reusablePlugItems ?? []) {
            if (typeof plug?.plugItemHash === "number") {
              possibleHashes.add(plug.plugItemHash);
            }
          }
        }

        const selected =
          typeof selectedHash === "number"
            ? toPlug(
                selectedHash,
                socketIndex,
                "selected"
              )
            : null;

        const rolled = rolledHashes
          .filter((hash) => hash !== selectedHash)
          .map((hash) =>
            toPlug(hash, socketIndex, "rolled")
          )
          .filter(Boolean);

        const possible = [...possibleHashes]
          .filter(
            (hash) =>
              hash !== selectedHash &&
              !rolledHashes.includes(hash)
          )
          .map((hash) =>
            toPlug(hash, socketIndex, "possible")
          )
          .filter(Boolean);

        const all = [
          ...(selected ? [selected] : []),
          ...rolled,
          ...possible,
        ];

        if (all.length === 0) {
          return null;
        }

        return {
          socketIndex,
          selected,
          rolled,
          possible,
          all,
        };
      })
      .filter(Boolean);

    const selectedPerks = perkColumns
      .map((column: any) => column.selected)
      .filter(Boolean);

    const itemSetHash =
      definition?.equippingBlock?.equipableItemSetHash ??
      null;

    let itemSet: any = null;

    if (typeof itemSetHash === "number") {
      try {
        const itemSetDefinition =
          await getCachedManifestDefinition(
            "DestinyEquipableItemSetDefinition",
            itemSetHash,
            apiKey
          );

        const setPerkHashes = [
          ...new Set<number>(
            (itemSetDefinition?.setPerks ?? [])
              .map((perk: any) => perk?.sandboxPerkHash)
              .filter(
                (hash: unknown): hash is number =>
                  typeof hash === "number"
              )
          ),
        ];

        const setPerkDefinitions =
          await mapWithConcurrency(
            setPerkHashes,
            6,
            async (perkHash) => {
              try {
                return [
                  perkHash,
                  await getCachedManifestDefinition(
                    "DestinySandboxPerkDefinition",
                    perkHash,
                    apiKey
                  ),
                ] as const;
              } catch {
                return [perkHash, null] as const;
              }
            }
          );

        const setPerkMap = new Map(setPerkDefinitions);

        itemSet = {
          hash: itemSetHash,
          name:
            itemSetDefinition?.displayProperties?.name ??
            "Armor Set",
          icon:
            itemSetDefinition?.displayProperties?.icon ??
            null,
          perks: (itemSetDefinition?.setPerks ?? []).map(
            (perk: any) => {
              const perkDefinition =
                setPerkMap.get(perk.sandboxPerkHash);

              return {
                requiredSetCount:
                  perk.requiredSetCount ?? 0,
                perkHash:
                  perk.sandboxPerkHash ?? null,
                name:
                  perkDefinition?.displayProperties?.name ??
                  `Set bonus (${perk.requiredSetCount ?? 0})`,
                description:
                  perkDefinition?.displayProperties
                    ?.description ?? "",
                icon:
                  perkDefinition?.displayProperties?.icon ??
                  null,
                effectTags: getCombatEffectTags(
                  perkDefinition?.displayProperties?.name ?? "",
                  perkDefinition?.displayProperties?.description ?? ""
                ),
              };
            }
          ),
        };
      } catch {
        itemSet = {
          hash: itemSetHash,
          name: "Armor Set",
          icon: null,
          perks: [],
        };
      }
    }

    const intrinsicPerkHashes = [
      ...new Set<number>(
        (definition?.perks ?? [])
          .map((perk: any) => perk?.perkHash)
          .filter(
            (hash: unknown): hash is number =>
              typeof hash === "number"
          )
      ),
    ];

    const intrinsicPerkDefinitions =
      await mapWithConcurrency(
        intrinsicPerkHashes,
        6,
        async (perkHash) => {
          try {
            return [
              perkHash,
              await getCachedManifestDefinition(
                "DestinySandboxPerkDefinition",
                perkHash,
                apiKey
              ),
            ] as const;
          } catch {
            return [perkHash, null] as const;
          }
        }
      );

    const intrinsicPerks = intrinsicPerkDefinitions
      .map(([perkHash, perkDefinition]) => ({
        perkHash,
        name:
          perkDefinition?.displayProperties?.name ??
          "Intrinsic perk",
        description:
          perkDefinition?.displayProperties?.description ??
          "",
        icon:
          perkDefinition?.displayProperties?.icon ?? null,
        isDisplayable:
          perkDefinition?.isDisplayable ?? true,
        effectTags: getCombatEffectTags(
          perkDefinition?.displayProperties?.name ?? "",
          perkDefinition?.displayProperties?.description ?? ""
        ),
      }))
      .filter(
        (perk) =>
          perk.isDisplayable &&
          (perk.name !== "Intrinsic perk" ||
            perk.description)
      );

    const liveStatValueMap = new Map<number, number>(
      (statsData?.stats ? Object.values(statsData.stats) : [])
        .filter(
          (stat: any) =>
            typeof stat?.statHash === "number"
        )
        .map((stat: any) => [
          stat.statHash,
          stat.value ?? 0,
        ])
    );

    const armorStats =
      definition?.itemType === 2
        ? ARMOR_STAT_HASHES.map((statHash) => {
            const statDefinition =
              statDefinitionMap.get(statHash);

            return {
              statHash,
              name:
                statDefinition?.displayProperties?.name ??
                ARMOR_STAT_FALLBACK_NAMES.get(statHash) ??
                `Stat ${statHash}`,
              description:
                statDefinition?.displayProperties?.description ??
                "",
              value:
                liveStatValueMap.get(statHash) ?? 0,
            };
          })
        : [];

    const armorStatTotal = armorStats.reduce(
      (total: number, stat: any) =>
        total + (stat.value ?? 0),
      0
    );

    const recoilDirection =
      readableStats.find((stat: any) =>
        stat.name
          .toLowerCase()
          .includes("recoil direction")
      )?.value ?? null;

    return NextResponse.json({
      success: true,
      scope: "detail",
      item: {
        itemHash: requestedItemHash,
        itemInstanceId,
        name:
          definition?.displayProperties?.name ??
          "Unknown Item",
        description:
          definition?.displayProperties?.description ?? "",
        icon:
          definition?.displayProperties?.icon ?? null,
        itemTypeDisplayName:
          definition?.itemTypeDisplayName ?? null,
        itemType:
          definition?.itemType ?? null,
        itemSubType:
          definition?.itemSubType ?? null,
        category: getItemCategory(
          definition?.itemType ?? null
        ),
        tierTypeName:
          definition?.inventory?.tierTypeName ?? null,
        gearTier: instance?.gearTier ?? null,
        power:
          instance?.primaryStat?.value ?? null,
        damageType:
          instance?.damageType ?? null,
        damageTypeHash:
          instance?.damageTypeHash ?? null,
        stats: readableStats,
        armorStats,
        armorStatTotal:
          definition?.itemType === 2
            ? armorStatTotal
            : null,
        selectedPerks,
        perkColumns,
        intrinsicPerks,
        itemSet,
        recoilDirection,
        livePerks: livePerksData?.perks ?? [],
      },
    });
  }

  const requestedComponents =
    scope === "account"
      ? "102,200,201,205,300"
      : "200,201,202,205,206,300,305,310";

  const profileResponse = await fetch(
    `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=${requestedComponents}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    }
  );

  const profileData = await profileResponse.json();

  if (!profileResponse.ok || profileData.ErrorCode !== 1) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch character inventory",
        details: profileData,
      },
      { status: profileResponse.status || 500 }
    );
  }

  const characters =
    profileData.Response?.characters?.data ?? {};

  const character =
    characters[characterId] ?? null;

const classType =
  character?.classType ?? null;

if (classType === null) {
  return NextResponse.json(
    {
      success: false,
      error: "Character class could not be determined",
    },
    { status: 404 }
  );
}

const subclassCatalog =
  getSubclassCatalog(classType);

  const characterInventories =
    profileData.Response?.characterInventories?.data ?? {};

  const characterEquipment =
    profileData.Response?.characterEquipment?.data ?? {};

  const vault =
    profileData.Response?.profileInventory?.data?.items ?? [];

  const itemInstances =
    profileData.Response?.itemComponents?.instances?.data ?? {};

  const itemStats =
    profileData.Response?.itemComponents?.stats?.data ?? {};

  const itemSockets =
    profileData.Response?.itemComponents?.sockets?.data ?? {};

  const itemReusablePlugs =
    profileData.Response?.itemComponents?.reusablePlugs?.data ?? {};

  const profilePlugSets =
    profileData.Response?.profilePlugSets?.data?.plugs ?? {};

  const characterPlugSets =
    profileData.Response?.characterPlugSets?.data?.[characterId]?.plugs ?? {};

  const characterProgression =
    profileData.Response?.characterProgressions?.data?.[characterId] ?? null;

  const seasonalArtifact =
    characterProgression?.seasonalArtifact ?? null;

  const inGameLoadouts =
    profileData.Response?.characterLoadouts?.data?.[characterId]?.loadouts ?? [];

  const profileUnlockedPlugHashes = new Set<number>();
  const characterUnlockedPlugHashes = new Set<number>();

  for (const plugs of Object.values(profilePlugSets) as any[]) {
    for (const plug of plugs ?? []) {
      if (
        typeof plug?.plugItemHash === "number" &&
        plug?.enabled === true
      ) {
        profileUnlockedPlugHashes.add(plug.plugItemHash);
      }
    }
  }

  for (const plugs of Object.values(characterPlugSets) as any[]) {
    for (const plug of plugs ?? []) {
      if (
        typeof plug?.plugItemHash === "number" &&
        plug?.enabled === true
      ) {
        characterUnlockedPlugHashes.add(plug.plugItemHash);
      }
    }
  }

  const inventory =
    characterInventories[characterId]?.items ?? [];

  const equipment =
    characterEquipment[characterId]?.items ?? [];

  // Keep full account item hashes for basic item definitions, but scope
  // expensive socket/stat enrichment to the currently inspected Guardian.
  // Enriching all Vault sockets at once causes a huge number of Manifest
  // lookups and can make plug definitions fail or get throttled.
  const currentCharacterItems = [
    ...inventory,
    ...equipment,
  ];

  // Phase 7C only needs detailed socket/plug data for subclass items.
  // Weapons/armor still receive their basic Manifest definition and live
  // instance data, but perk/stat enrichment is intentionally deferred to 7D.
  // This avoids hundreds of definition lookups during the blocking core load.
  const subclassItemHashSet = new Set<number>(
    subclassCatalog.map((subclass) => subclass.itemHash)
  );

  const detailedCharacterItems = currentCharacterItems.filter(
    (item: any) => subclassItemHashSet.has(item.itemHash)
  );

  if (scope === "account") {
    const accountEntries: Array<{ item: any; location: any }> = [];

    for (const item of vault) {
      if (!item?.itemInstanceId) {
        continue;
      }

      accountEntries.push({
        item,
        location: {
          type: "vault",
          characterId: null,
          classType: null,
          className: null,
          placement: "vault",
        },
      });
    }

    for (const [otherCharacterId, otherCharacter] of Object.entries(
      characters
    ) as Array<[string, any]>) {
      if (otherCharacterId === characterId) {
        continue;
      }

      const otherClassType =
        otherCharacter?.classType ?? null;
      const otherClassName =
        getGuardianClassName(otherClassType);

      for (const item of
        characterInventories[otherCharacterId]?.items ?? []) {
        if (!item?.itemInstanceId) {
          continue;
        }

        accountEntries.push({
          item,
          location: {
            type: "otherGuardian",
            characterId: otherCharacterId,
            classType: otherClassType,
            className: otherClassName,
            placement: "inventory",
          },
        });
      }

      for (const item of
        characterEquipment[otherCharacterId]?.items ?? []) {
        if (!item?.itemInstanceId) {
          continue;
        }

        accountEntries.push({
          item,
          location: {
            type: "otherGuardian",
            characterId: otherCharacterId,
            classType: otherClassType,
            className: otherClassName,
            placement: "equipped",
          },
        });
      }
    }

    const accountHashes = [
      ...new Set<number>(
        accountEntries
          .map(({ item }) => item.itemHash)
          .filter(
            (hash: unknown): hash is number =>
              typeof hash === "number"
          )
      ),
    ];

    const accountDefinitions = await mapWithConcurrency(
      accountHashes,
      12,
      async (itemHash) => {
        try {
          const definition =
            await getCachedInventoryItemDefinition(
              itemHash,
              apiKey
            );

          return [itemHash, definition] as const;
        } catch {
          return [itemHash, null] as const;
        }
      }
    );

    const accountDefinitionMap =
      new Map(accountDefinitions);

    const enrichAccountItem = ({
      item,
      location,
    }: {
      item: any;
      location: any;
    }) => {
      const definition =
        accountDefinitionMap.get(item.itemHash);
      const instance = item.itemInstanceId
        ? itemInstances[item.itemInstanceId]
        : null;

      return {
        location,
        itemHash: item.itemHash,
        itemInstanceId: item.itemInstanceId ?? null,
        bucketHash: item.bucketHash ?? null,
        locationBucketHash: item.bucketHash ?? null,
        equipmentSlotHash:
          definition?.inventory?.bucketTypeHash ?? null,
        quantity: item.quantity ?? 1,
        name:
          definition?.displayProperties?.name ??
          "Unknown Item",
        description:
          definition?.displayProperties?.description ?? "",
        icon:
          definition?.displayProperties?.icon ?? null,
        itemTypeDisplayName:
          definition?.itemTypeDisplayName ?? null,
        itemType:
          definition?.itemType ?? null,
        itemSubType:
          definition?.itemSubType ?? null,
        classType:
          definition?.classType ?? null,
        tierTypeName:
          definition?.inventory?.tierTypeName ?? null,
        equippable:
          definition?.equippable ?? false,
        category: getItemCategory(
          definition?.itemType ?? null
        ),
        power:
          instance?.primaryStat?.value ?? null,
        gearTier:
          instance?.gearTier ?? null,
        damageType:
          instance?.damageType ?? null,
        damageTypeHash:
          instance?.damageTypeHash ?? null,
        isEquipped:
          location?.placement === "equipped" ||
          instance?.isEquipped === true,
        canEquip:
          instance?.canEquip ?? null,
        stats: [],
        roll: [],
        armorStats: [],
        armorStatTotal: null,
      };
    };

    const accountGear = accountEntries
      .map(enrichAccountItem)
      .filter((item) => {
        const isArtifact =
          item.itemType === 28 ||
          item.itemTypeDisplayName?.toLowerCase().includes("artifact") === true;

        return (
          item.category === "weapon" ||
          item.category === "armor" ||
          isArtifact
        );
      });

    const enrichedVault = accountGear.filter(
      (item) => item.location?.type === "vault"
    );

    const otherGuardianItems = accountGear.filter(
      (item) => item.location?.type === "otherGuardian"
    );

    return NextResponse.json({
      success: true,
      scope: "account",
      requestedCharacterId: characterId,
      vaultCount: enrichedVault.length,
      otherGuardianCount: otherGuardianItems.length,
      vault: enrichedVault,
      otherGuardianItems,
      itemLocationModel: {
        version: 1,
        types: [
          "equipped",
          "characterInventory",
          "vault",
          "otherGuardian",
          "missing",
        ],
      },
    });
  }

  // Core mode intentionally resolves only the selected Guardian. Account-wide
  // gear is loaded by a second lightweight request after the page is usable.
  const allItems = currentCharacterItems;

  const allPlugHashes = detailedCharacterItems.flatMap((item: any) => {
    if (!item.itemInstanceId) {
      return [];
    }

    const socketsData = itemSockets[item.itemInstanceId];

    if (!socketsData?.sockets) {
      return [];
    }

    return socketsData.sockets
      .map((socket: any) => socket.plugHash)
      .filter((plugHash: number | undefined) => plugHash != null);
  });

// Only resolve reusable plug definitions actually attached to the selected
// Guardian here. Profile/character plug sets can contain hundreds of unrelated
// cosmetics and mods; pulling all of them was the main source of long loads
// and partial Manifest failures. Relevant subclass plug-set definitions are
// resolved later from the sockets referenced by this Guardian.
const allReusablePlugHashes =
  detailedCharacterItems.flatMap((item: any) => {
    if (!item.itemInstanceId) {
      return [];
    }

    const component = itemReusablePlugs[item.itemInstanceId];

    return Object.values(component?.plugs ?? {}).flatMap(
      (plugs: any) =>
        (plugs ?? []).map(
          (plug: any) => plug.plugItemHash
        )
    );
  });

  // Stats/weapon-roll detail is a 7D concern. Keeping this empty makes
  // the first Guardian render much cheaper without changing the 7C selector.
  const allStatHashes: number[] = [];


const uniqueHashes: number[] = [
  ...new Set<number>([
    ...allItems
      .map((item: any) => item.itemHash)
      .filter(
        (hash: unknown): hash is number =>
          typeof hash === "number"
      ),

    ...subclassCatalog.map(
      (subclass) => subclass.itemHash
    ),
  ]),
];

  const uniquePlugHashes: number[] = [
    ...new Set<number>(allPlugHashes),
  ];

  const uniqueReusablePlugHashes: number[] = [
    ...new Set<number>(
      allReusablePlugHashes.filter(
        (hash: unknown): hash is number => typeof hash === "number"
      )
    ),
  ];

  const uniqueStatHashes: number[] = [
    ...new Set<number>(allStatHashes),
  ];

  const definitions = await mapWithConcurrency(
    uniqueHashes,
    16,
    async (itemHash) => {
      try {
        const definition = await getCachedInventoryItemDefinition(
          itemHash,
          apiKey
        );

        return [itemHash, definition] as const;
      } catch {
        return [itemHash, null] as const;
      }
    }
  );

  const plugDefinitions = await mapWithConcurrency(
    uniquePlugHashes,
    16,
    async (plugHash) => {
      try {
        const definition = await getCachedInventoryItemDefinition(
          plugHash,
          apiKey
        );

        return [plugHash, definition] as const;
      } catch {
        return [plugHash, null] as const;
      }
    }
  );

  const reusablePlugDefinitions = await mapWithConcurrency(
    uniqueReusablePlugHashes,
    16,
    async (plugHash) => {
      try {
        const definition = await getCachedInventoryItemDefinition(
          plugHash,
          apiKey
        );

        return [plugHash, definition] as const;
      } catch {
        return [plugHash, null] as const;
      }
    }
  );

  const statDefinitions = await mapWithConcurrency(
    uniqueStatHashes,
    16,
    async (statHash) => {
      try {
        const definition = await getCachedStatDefinition(
          statHash,
          apiKey
        );

        return [statHash, definition] as const;
      } catch {
        return [statHash, null] as const;
      }
    }
  );

  const definitionMap = new Map(definitions);

  const subclassDefinitions = subclassCatalog
    .map((subclass) => definitionMap.get(subclass.itemHash))
    .filter(Boolean);

  const plugSetHashes: number[] = [
    ...new Set<number>(
      subclassDefinitions
        .flatMap((definition: any) =>
          definition?.sockets?.socketEntries?.flatMap(
            (socketEntry: any) => [
              socketEntry?.reusablePlugSetHash,
              socketEntry?.randomizedPlugSetHash,
            ]
          ) ?? []
        )
        .filter(
          (hash: unknown): hash is number =>
            typeof hash === "number" && hash > 0
        )
    ),
  ];

const plugSetDefinitions = await mapWithConcurrency(
  plugSetHashes,
  16,
  async (plugSetHash) => {
    try {
      const definition = await getCachedPlugSetDefinition(
        plugSetHash,
        apiKey
      );

      return [plugSetHash, definition] as const;
    } catch {
      return [plugSetHash, null] as const;
    }
  }
);

const plugSetDefinitionMap =
  new Map(plugSetDefinitions);

const manifestPlugSetItemHashes: number[] = [
  ...new Set<number>(
    Array.from(plugSetDefinitionMap.values())
      .flatMap((plugSet: any) =>
        (plugSet?.reusablePlugItems ?? []).map(
          (plug: any) => plug.plugItemHash
        )
      )
      .filter(
        (hash: unknown): hash is number =>
          typeof hash === "number"
      )
  ),
];

const manifestPlugDefinitions =
  await mapWithConcurrency(
    manifestPlugSetItemHashes,
    16,
    async (plugHash) => {
      try {
        const definition =
          await getCachedInventoryItemDefinition(
            plugHash,
            apiKey
          );

        return [plugHash, definition] as const;
      } catch {
        return [plugHash, null] as const;
      }
    }
  );

const manifestPlugDefinitionMap =
  new Map(manifestPlugDefinitions);

const definitionReusablePlugHashes: number[] = [
  ...new Set<number>(
    subclassDefinitions
      .flatMap((definition: any) =>
        definition?.sockets?.socketEntries?.flatMap(
          (socketEntry: any) =>
            (socketEntry?.reusablePlugItems ?? []).map(
              (plug: any) => plug.plugItemHash
            )
        ) ?? []
      )
      .filter(
        (hash: unknown): hash is number =>
          typeof hash === "number"
      )
  ),
];

const definitionReusablePlugDefinitions =
  await mapWithConcurrency(
    definitionReusablePlugHashes,
    16,
    async (plugHash) => {
      try {
        const definition =
          await getCachedInventoryItemDefinition(
            plugHash,
            apiKey
          );

        return [plugHash, definition] as const;
      } catch {
        return [plugHash, null] as const;
      }
    }
  );

const definitionReusablePlugMap =
  new Map(definitionReusablePlugDefinitions);
  const plugDefinitionMap = new Map(plugDefinitions);
  const reusablePlugDefinitionMap = new Map(reusablePlugDefinitions);
  const statDefinitionMap = new Map(statDefinitions);

  const subclassPlugDefinitionPool = [
    ...Array.from(manifestPlugDefinitionMap.values()),
    ...Array.from(definitionReusablePlugMap.values()),
    ...Array.from(reusablePlugDefinitionMap.values()),
    ...Array.from(plugDefinitionMap.values()),
  ].filter(Boolean);

  const subclassInvestmentStatHashes = [
    ...new Set<number>(
      subclassPlugDefinitionPool
        .flatMap((definition: any) => definition?.investmentStats ?? [])
        .map((stat: any) => stat?.statTypeHash)
        .filter(
          (hash: unknown): hash is number =>
            typeof hash === "number" && hash > 0
        )
    ),
  ];

  const subclassInvestmentStatDefinitions =
    await mapWithConcurrency(
      subclassInvestmentStatHashes,
      12,
      async (statHash) => {
        if (statDefinitionMap.has(statHash)) {
          return [statHash, statDefinitionMap.get(statHash)] as const;
        }

        try {
          return [
            statHash,
            await getCachedStatDefinition(statHash, apiKey),
          ] as const;
        } catch {
          return [statHash, null] as const;
        }
      }
    );

  for (const [statHash, definition] of subclassInvestmentStatDefinitions) {
    if (!statDefinitionMap.has(statHash)) {
      statDefinitionMap.set(statHash, definition);
    }
  }

  const getSubclassStatEffects = (definition: any) =>
    (definition?.investmentStats ?? [])
      .filter(
        (stat: any) =>
          typeof stat?.statTypeHash === "number" &&
          typeof stat?.value === "number" &&
          stat.value !== 0 &&
          stat.statTypeHash !== 2223994109
      )
      .map((stat: any) => {
        const statDefinition =
          statDefinitionMap.get(stat.statTypeHash);

        return {
          statHash: stat.statTypeHash,
          name:
            statDefinition?.displayProperties?.name ??
            ARMOR_STAT_FALLBACK_NAMES.get(stat.statTypeHash) ??
            `Stat ${stat.statTypeHash}`,
          description:
            statDefinition?.displayProperties?.description ?? "",
          value: stat.value,
          isConditionallyActive:
            stat.isConditionallyActive === true,
        };
      });

  function buildTheoreticalSubclass(itemHash: number) {
    const definition = definitionMap.get(itemHash);

    if (!definition) {
      return null;
    }

    const socketEntries =
      definition?.sockets?.socketEntries ?? [];

    const theoreticalSockets = socketEntries.map(
      (socketDefinition: any, socketIndex: number) => {
        const reusablePlugSetHash =
          socketDefinition?.reusablePlugSetHash ?? null;

        const randomizedPlugSetHash =
          socketDefinition?.randomizedPlugSetHash ?? null;

        const definitionReusablePlugs =
          socketDefinition?.reusablePlugItems ?? [];

        const reusableManifestSet =
          reusablePlugSetHash
            ? plugSetDefinitionMap.get(reusablePlugSetHash)
            : null;

        const randomizedManifestSet =
          randomizedPlugSetHash
            ? plugSetDefinitionMap.get(randomizedPlugSetHash)
            : null;

        const manifestPlugs = [
          ...definitionReusablePlugs,
          ...(reusableManifestSet?.reusablePlugItems ?? []),
          ...(randomizedManifestSet?.reusablePlugItems ?? []),
        ];

        const uniqueHashes = [
          ...new Set<number>(
            manifestPlugs
              .map((plug: any) => plug.plugItemHash)
              .filter(
                (hash: unknown): hash is number =>
                  typeof hash === "number"
              )
          ),
        ];

        const available = uniqueHashes
          .map((plugHash) => {
            const plugDefinition =
              manifestPlugDefinitionMap.get(plugHash) ??
              definitionReusablePlugMap.get(plugHash) ??
              reusablePlugDefinitionMap.get(plugHash) ??
              plugDefinitionMap.get(plugHash);

            if (!plugDefinition) {
              return null;
            }

            const name =
              plugDefinition?.displayProperties?.name ??
              "Unknown Plug";

            const plugCategoryIdentifier =
              plugDefinition?.plug?.plugCategoryIdentifier ??
              null;

            if (
              isSubclassPlaceholderPlug(
                name,
                plugCategoryIdentifier
              )
            ) {
              return null;
            }

            return {
              plugHash,
              name,
              description:
                plugDefinition?.displayProperties?.description ?? "",
              icon:
                plugDefinition?.displayProperties?.icon ?? null,
              plugCategoryIdentifier,
              fragmentSlots:
                getAspectFragmentSlotCount(plugDefinition),
              statEffects:
                getSubclassStatEffects(plugDefinition),
              effectTags: getCombatEffectTags(
                name,
                plugDefinition?.displayProperties?.description ?? ""
              ),
              possible: true,
              unlocked: false,
              equipped: false,
            };
          })
          .filter(Boolean);

        const firstIdentifier =
          available.find(Boolean)?.plugCategoryIdentifier ??
          null;

        return {
          socketIndex,
          slotType:
            getSubclassSlotType(firstIdentifier),
          equipped: null,
          available,
        };
      }
    );

    const getSingleSlot = (slotType: string) =>
      theoreticalSockets.find(
        (socket: any) =>
          socket.slotType === slotType
      ) ?? null;

    const getMultipleSlots = (slotType: string) =>
      theoreticalSockets.filter(
        (socket: any) =>
          socket.slotType === slotType
      );

    return {
      itemHash,
      name:
        definition?.displayProperties?.name ??
        "Unknown Subclass",
      icon:
        definition?.displayProperties?.icon ?? null,
      source: "manifest",
      theoretical: true,

      super: getSingleSlot("super"),
      classAbility: getSingleSlot("classAbility"),
      movement: getSingleSlot("movement"),
      melee: getSingleSlot("melee"),
      grenade: getSingleSlot("grenade"),

      aspects: getMultipleSlots("aspect"),
      fragments: getMultipleSlots("fragment"),
      other: getMultipleSlots("other"),
    };
  }

  function enrichItem(item: any, location: any = null) {
    const definition = definitionMap.get(item.itemHash);

    const instance = item.itemInstanceId
      ? itemInstances[item.itemInstanceId]
      : null;

    const statsData = item.itemInstanceId
      ? itemStats[item.itemInstanceId]
      : null;

    const socketsData = item.itemInstanceId
      ? itemSockets[item.itemInstanceId]
      : null;

    const reusablePlugsData = item.itemInstanceId
      ? itemReusablePlugs[item.itemInstanceId]
      : null;

    const readableStats = statsData?.stats
      ? Object.values(statsData.stats).map((stat: any) => {
          const statDefinition = statDefinitionMap.get(stat.statHash);

          return {
            statHash: stat.statHash,
            name:
              statDefinition?.displayProperties?.name ??
              "Unknown Stat",
            description:
              statDefinition?.displayProperties?.description ?? "",
            value: stat.value ?? 0,
          };
        })
      : [];

    const armorStats =
      definition?.itemType === 2
        ? readableStats.filter(
            (stat: any) =>
              stat.name !== "Unknown Stat" && stat.value > 0
          )
        : [];

    const armorStatTotal = armorStats.reduce(
      (total: number, stat: any) => total + stat.value,
      0
    );

    type PlugSource =
      | "itemReusable"
      | "definition"
      | "manifest"
      | "profile"
      | "character"
      | "profileRandomized"
      | "characterRandomized"
      | "equipped";

    type PlugState = {
      plugItemHash: number;
      sources: Set<PlugSource>;
      canInsert: boolean;
      enabled: boolean;
      unlocked: boolean;
    };

    const shouldEnrichSockets =
      definition?.itemType === 16;

    const enrichedSockets =
      shouldEnrichSockets
        ? socketsData?.sockets?.map(
        (socket: any, socketIndex: number) => {
          const socketDefinition =
            definition?.sockets?.socketEntries?.[socketIndex] ?? null;

          const definitionReusablePlugs =
            socketDefinition?.reusablePlugItems ?? [];

          const reusablePlugSetHash =
            socketDefinition?.reusablePlugSetHash ?? null;

          const randomizedPlugSetHash =
            socketDefinition?.randomizedPlugSetHash ?? null;

          const plugSources =
            socketDefinition?.plugSources ?? 0;

          const reusableManifestSet =
            reusablePlugSetHash
              ? plugSetDefinitionMap.get(reusablePlugSetHash)
              : null;

          const randomizedManifestSet =
            randomizedPlugSetHash
              ? plugSetDefinitionMap.get(randomizedPlugSetHash)
              : null;

          const manifestSetPlugs = [
            ...(reusableManifestSet?.reusablePlugItems ?? []),
            ...(randomizedManifestSet?.reusablePlugItems ?? []),
          ];

          const plugDefinition = socket.plugHash
            ? plugDefinitionMap.get(socket.plugHash)
            : null;

          const itemReusable =
            reusablePlugsData?.plugs?.[socketIndex] ?? [];

          const profileSetPlugs =
            reusablePlugSetHash
              ? profilePlugSets[reusablePlugSetHash] ?? []
              : [];

          const characterSetPlugs =
            reusablePlugSetHash
              ? characterPlugSets[reusablePlugSetHash] ?? []
              : [];

          const profileRandomizedPlugs =
            randomizedPlugSetHash
              ? profilePlugSets[randomizedPlugSetHash] ?? []
              : [];

          const characterRandomizedPlugs =
            randomizedPlugSetHash
              ? characterPlugSets[randomizedPlugSetHash] ?? []
              : [];

          const plugStateMap = new Map<number, PlugState>();

          const addPlugs = (
            plugs: any[],
            source: PlugSource,
            live: boolean
          ) => {
            for (const plug of plugs ?? []) {
              const plugItemHash = plug?.plugItemHash;

              if (typeof plugItemHash !== "number") {
                continue;
              }

              let state = plugStateMap.get(plugItemHash);

              if (!state) {
                state = {
                  plugItemHash,
                  sources: new Set<PlugSource>(),
                  canInsert: false,
                  enabled: false,
                  unlocked: false,
                };

                plugStateMap.set(plugItemHash, state);
              }

              state.sources.add(source);

              if (live) {
                if (plug.canInsert === true) {
                  state.canInsert = true;
                }

                if (plug.enabled === true) {
                  state.enabled = true;
                }

                if (plug.canInsert === true || plug.enabled === true) {
                  state.unlocked = true;
                }
              }
            }
          };

          addPlugs(itemReusable, "itemReusable", true);
          addPlugs(definitionReusablePlugs, "definition", false);
          addPlugs(manifestSetPlugs, "manifest", false);
          addPlugs(profileSetPlugs, "profile", true);
          addPlugs(characterSetPlugs, "character", true);
          addPlugs(profileRandomizedPlugs, "profileRandomized", true);
          addPlugs(characterRandomizedPlugs, "characterRandomized", true);

          if (typeof socket.plugHash === "number") {
            let equippedState = plugStateMap.get(socket.plugHash);

            if (!equippedState) {
              equippedState = {
                plugItemHash: socket.plugHash,
                sources: new Set<PlugSource>(),
                canInsert: false,
                enabled: false,
                unlocked: true,
              };

              plugStateMap.set(socket.plugHash, equippedState);
            }

            equippedState.sources.add("equipped");
            equippedState.unlocked = true;
          }

          const liveReusableFlagsAreNonAuthoritative =
            definition?.itemType === 16 &&
            itemReusable.length > 0 &&
            typeof socket.plugHash === "number" &&
            itemReusable.some(
              (plug: any) =>
                plug?.plugItemHash === socket.plugHash
            ) &&
            itemReusable.every(
              (plug: any) =>
                plug?.canInsert !== true &&
                plug?.enabled !== true
            );

          const availablePlugDetails = Array.from(
            plugStateMap.values()
          ).map((state) => {
            const availableDefinition =
              reusablePlugDefinitionMap.get(state.plugItemHash) ??
              definitionReusablePlugMap.get(state.plugItemHash) ??
              manifestPlugDefinitionMap.get(state.plugItemHash) ??
              plugDefinitionMap.get(state.plugItemHash);

            const isEquipped =
              socket.plugHash === state.plugItemHash;

            const unlockedFromProfilePlugSet =
              profileUnlockedPlugHashes.has(state.plugItemHash);

            const unlockedFromCharacterPlugSet =
              characterUnlockedPlugHashes.has(state.plugItemHash);

            const plugCategoryIdentifier =
              availableDefinition?.plug?.plugCategoryIdentifier ?? null;

            const subclassSlotType =
              getSubclassSlotType(plugCategoryIdentifier);

            const isCoreSubclassAbility =
              subclassSlotType === "super" ||
              subclassSlotType === "classAbility" ||
              subclassSlotType === "movement" ||
              subclassSlotType === "melee" ||
              subclassSlotType === "grenade";

            // Some live subclass sockets (notably certain Super sockets)
            // report every reusable plug as enabled=false/canInsert=false,
            // including the currently equipped plug. In that case those flags
            // cannot be used as ownership evidence. For core abilities only,
            // presence in the LIVE reusable-plug list is therefore treated as
            // unlocked. Aspects/fragments keep the stricter ownership rules.
            const unlockedFromLiveReusableFallback =
              liveReusableFlagsAreNonAuthoritative &&
              isCoreSubclassAbility &&
              state.sources.has("itemReusable");

            const unlocked =
              isEquipped ||
              state.unlocked ||
              unlockedFromProfilePlugSet ||
              unlockedFromCharacterPlugSet ||
              unlockedFromLiveReusableFallback;

            return {
              plugHash: state.plugItemHash,
              name:
                availableDefinition?.displayProperties?.name ??
                "Unknown Plug",
              description:
                availableDefinition?.displayProperties?.description ?? "",
              icon:
                availableDefinition?.displayProperties?.icon ?? null,
              plugCategoryIdentifier,
              fragmentSlots:
                getAspectFragmentSlotCount(availableDefinition),
              statEffects:
                getSubclassStatEffects(availableDefinition),
              effectTags: getCombatEffectTags(
                availableDefinition?.displayProperties?.name ?? "",
                availableDefinition?.displayProperties?.description ?? ""
              ),
              possible: true,
              unlocked,
              equipped: isEquipped,
              unlockEvidence: {
                equipped: isEquipped,
                liveSocketState: state.unlocked,
                profilePlugSet: unlockedFromProfilePlugSet,
                characterPlugSet: unlockedFromCharacterPlugSet,
                liveReusableFallback:
                  unlockedFromLiveReusableFallback,
              },
              canInsert: state.canInsert,
              enabled: state.enabled,
              sources: Array.from(state.sources),
            };
          });

          return {
            socketIndex,
            plugHash: socket.plugHash ?? null,
            name:
              plugDefinition?.displayProperties?.name ?? "Unknown Plug",
            description:
              plugDefinition?.displayProperties?.description ?? "",
            icon:
              plugDefinition?.displayProperties?.icon ?? null,
            plugCategoryIdentifier:
              plugDefinition?.plug?.plugCategoryIdentifier ?? null,
            fragmentSlots:
              getAspectFragmentSlotCount(plugDefinition),
            statEffects:
              getSubclassStatEffects(plugDefinition),
            effectTags: getCombatEffectTags(
              plugDefinition?.displayProperties?.name ?? "",
              plugDefinition?.displayProperties?.description ?? ""
            ),
            plugCategoryHash:
              plugDefinition?.plug?.plugCategoryHash ?? null,
            plugSources,
            reusablePlugSetHash,
            randomizedPlugSetHash,
            isEnabled: socket.isEnabled ?? false,
            isVisible: socket.isVisible ?? false,
            availablePlugs: availablePlugDetails,
          };
        }
      ) ?? []
        : [];

    const weaponRoll =
      definition?.itemType === 3
        ? enrichedSockets
            .map((socket: any) => ({
              socketIndex: socket.socketIndex,
              plugHash: socket.plugHash,
              name: socket.name,
              description: socket.description,
              icon: socket.icon,
              type: getWeaponPlugType(
                socket.plugCategoryIdentifier
              ),
              isEnabled: socket.isEnabled,
              isVisible: socket.isVisible,
            }))
            .filter(
              (socket: any) =>
                socket.isEnabled &&
                socket.isVisible &&
                socket.type !== "other"
            )
        : [];

    return {
      location,

      itemHash: item.itemHash,
      itemInstanceId: item.itemInstanceId ?? null,

      // bucketHash is the item's CURRENT container. For Vault items this can
      // be the Vault bucket, so it must not be used to decide which gear slot
      // the item belongs to. equipmentSlotHash comes from the Manifest and is
      // stable regardless of where the item is stored.
      bucketHash: item.bucketHash ?? null,
      locationBucketHash: item.bucketHash ?? null,
      equipmentSlotHash:
        definition?.inventory?.bucketTypeHash ??
        item.bucketHash ??
        null,

      quantity: item.quantity ?? 1,

      name:
        definition?.displayProperties?.name ??
        "Unknown Item",
      description:
        definition?.displayProperties?.description ?? "",
      icon:
        definition?.displayProperties?.icon ?? null,

      itemTypeDisplayName:
        definition?.itemTypeDisplayName ?? null,
      itemType:
        definition?.itemType ?? null,
      itemSubType:
        definition?.itemSubType ?? null,
      classType:
        definition?.classType ?? null,
      tierTypeName:
        definition?.inventory?.tierTypeName ?? null,
      equippable:
        definition?.equippable ?? false,
      category: getItemCategory(
        definition?.itemType ?? null
      ),

      power:
        instance?.primaryStat?.value ?? null,
      gearTier:
        instance?.gearTier ?? null,
      damageType:
        instance?.damageType ?? null,
      damageTypeHash:
        instance?.damageTypeHash ?? null,
      isEquipped:
        instance?.isEquipped ?? false,
      canEquip:
        instance?.canEquip ?? null,

      stats: readableStats,
      armorStats,
      armorStatTotal:
        definition?.itemType === 2
          ? armorStatTotal
          : null,

      sockets: enrichedSockets,
      roll: weaponRoll,
    };
  }

  function getGuardianClassName(classType: number | null) {
    switch (classType) {
      case 0:
        return "Titan";
      case 1:
        return "Hunter";
      case 2:
        return "Warlock";
      default:
        return "Unknown Guardian";
    }
  }

  const currentGuardianClassName =
    getGuardianClassName(classType);

  const enrichedInventory = inventory.map((item: any) =>
    enrichItem(item, {
      type: "characterInventory",
      characterId,
      classType,
      className: currentGuardianClassName,
      placement: "inventory",
    })
  );

  const enrichedEquipment = equipment.map((item: any) =>
    enrichItem(item, {
      type: "equipped",
      characterId,
      classType,
      className: currentGuardianClassName,
      placement: "equipped",
    })
  );

  const enrichedVault: any[] = [];
  const otherGuardianItems: any[] = [];

  function buildLiveSubclassSetup(liveSubclass: any) {
    if (!liveSubclass) {
      return null;
    }

    const subclassSockets = liveSubclass?.sockets ?? [];

    const subclassPlugs = subclassSockets
      .map((socket: any) => {
        const available = (socket.availablePlugs ?? [])
          .filter(
            (plug: any) =>
              !isSubclassPlaceholderPlug(
                plug.name,
                plug.plugCategoryIdentifier
              )
          )
          .map((plug: any) => ({
            plugHash: plug.plugHash,
            name: plug.name,
            description: plug.description,
            icon: plug.icon,
            plugCategoryIdentifier:
              plug.plugCategoryIdentifier,
            fragmentSlots:
              typeof plug.fragmentSlots === "number"
                ? plug.fragmentSlots
                : null,
            statEffects:
              Array.isArray(plug.statEffects)
                ? plug.statEffects
                : [],
            effectTags:
              Array.isArray(plug.effectTags)
                ? plug.effectTags
                : [],
            possible: plug.possible ?? true,
            unlocked: plug.unlocked ?? false,
            equipped: plug.equipped ?? false,
          }));

        let slotType = getSubclassSlotType(
          socket.plugCategoryIdentifier
        );

        // Empty/disabled Fragment sockets often have a placeholder plug whose
        // category does not describe the socket. Infer the real slot type from
        // its available plugs so previewing an Aspect can expose the Fragment
        // slots without waiting for Destiny itself to equip that Aspect.
        if (slotType === "other") {
          const inferredPlug = available.find(
            (plug: any) =>
              getSubclassSlotType(
                plug.plugCategoryIdentifier
              ) !== "other"
          );

          if (inferredPlug) {
            slotType = getSubclassSlotType(
              inferredPlug.plugCategoryIdentifier
            );
          }
        }

        const isAspectOrFragment =
          slotType === "aspect" || slotType === "fragment";

        // Keep all Aspect/Fragment sockets, including live sockets Bungie marks
        // disabled/hidden because the currently equipped Aspects do not grant
        // enough Fragment capacity. Other socket types retain the live flags.
        if (
          !isAspectOrFragment &&
          !(socket.isEnabled && socket.isVisible)
        ) {
          return null;
        }

        const equippedIsPlaceholder =
          isSubclassPlaceholderPlug(
            socket.name,
            socket.plugCategoryIdentifier
          );

        return {
          socketIndex: socket.socketIndex,
          slotType,
          equipped: equippedIsPlaceholder
            ? null
            : {
                plugHash: socket.plugHash,
                name: socket.name,
                description: socket.description,
                icon: socket.icon,
                plugCategoryIdentifier:
                  socket.plugCategoryIdentifier,
                fragmentSlots:
                  typeof socket.fragmentSlots === "number"
                    ? socket.fragmentSlots
                    : null,
                statEffects:
                  Array.isArray(socket.statEffects)
                    ? socket.statEffects
                    : [],
                effectTags:
                  Array.isArray(socket.effectTags)
                    ? socket.effectTags
                    : [],
                possible: true,
                unlocked: true,
                equipped: true,
              },
          available,
        };
      })
      .filter(Boolean);

    return {
      itemHash: liveSubclass.itemHash,
      name: liveSubclass.name,
      icon: liveSubclass.icon,
      source: "live",
      theoretical: false,

      super:
        subclassPlugs.find(
          (slot: any) =>
            slot.slotType === "super"
        ) ?? null,

      classAbility:
        subclassPlugs.find(
          (slot: any) =>
            slot.slotType === "classAbility"
        ) ?? null,

      movement:
        subclassPlugs.find(
          (slot: any) =>
            slot.slotType === "movement"
        ) ?? null,

      melee:
        subclassPlugs.find(
          (slot: any) =>
            slot.slotType === "melee"
        ) ?? null,

      grenade:
        subclassPlugs.find(
          (slot: any) =>
            slot.slotType === "grenade"
        ) ?? null,

      aspects:
        subclassPlugs.filter(
          (slot: any) =>
            slot.slotType === "aspect"
        ),

      fragments:
        subclassPlugs.filter(
          (slot: any) =>
            slot.slotType === "fragment"
        ),

      other:
        subclassPlugs.filter(
          (slot: any) =>
            slot.slotType === "other"
        ),
    };
  }

  const liveSubclasses = [
    ...enrichedInventory,
    ...enrichedEquipment,
  ].filter(
    (item: any) =>
      item.category === "subclass"
  );

  const subclasses =
    subclassCatalog.map((catalogEntry) => {
      const liveSubclass =
        liveSubclasses.find(
          (item: any) =>
            item.itemHash ===
            catalogEntry.itemHash
        ) ?? null;

      const definition =
        definitionMap.get(
          catalogEntry.itemHash
        );

      const equipped =
        liveSubclass?.isEquipped === true;

      const unlocked =
        liveSubclass !== null;

      const status:
        | "equipped"
        | "unlocked"
        | "locked" =
        equipped
          ? "equipped"
          : unlocked
          ? "unlocked"
          : "locked";

      const setup =
        liveSubclass
          ? buildLiveSubclassSetup(
              liveSubclass
            )
          : buildTheoreticalSubclass(
              catalogEntry.itemHash
            );

      return {
        itemHash:
          catalogEntry.itemHash,

        name:
          definition?.displayProperties?.name ??
          catalogEntry.name,

        icon:
          definition?.displayProperties?.icon ??
          null,

        element:
          catalogEntry.element,

        classType:
          catalogEntry.classType,

        status,

        equipped,

        unlocked,

        locked:
          !unlocked,

        usableNow:
          unlocked,

        itemInstanceId:
          liveSubclass?.itemInstanceId ??
          null,

        // Struttura unica per UI e Build Engine:
        // live se sbloccata, Manifest se bloccata.
        setup,

        // Manteniamo anche i dati raw live
        // per non rompere eventuali usi esistenti.
        liveItem:
          liveSubclass,

        theoreticalSetup:
          unlocked
            ? null
            : setup,
      };
    });

  const equippedSubclass =
    liveSubclasses.find(
      (item: any) =>
        item.isEquipped === true
    ) ?? null;

  // Compatibilità con la UI attuale:
  // continua a rappresentare la subclass realmente equipaggiata.
  const subclassSetup =
    buildLiveSubclassSetup(
      equippedSubclass
    );

  let artifact: any = null;

  if (seasonalArtifact?.artifactHash) {
    try {
      const artifactDefinition =
        await getCachedManifestDefinition(
          "DestinyArtifactDefinition",
          seasonalArtifact.artifactHash,
          apiKey
        );

      const liveArtifactItems = new Map<
        number,
        { isActive: boolean; tierIndex: number }
      >();

      (seasonalArtifact?.tiers ?? []).forEach(
        (tier: any, tierIndex: number) => {
          for (const item of tier?.items ?? []) {
            if (typeof item?.itemHash === "number") {
              liveArtifactItems.set(item.itemHash, {
                isActive: item?.isActive === true,
                tierIndex,
              });
            }
          }
        }
      );

      const artifactItemHashes = [
        ...new Set<number>(
          (artifactDefinition?.tiers ?? [])
            .flatMap((tier: any) =>
              (tier?.items ?? []).map(
                (item: any) => item?.itemHash
              )
            )
            .filter(
              (hash: unknown): hash is number =>
                typeof hash === "number"
            )
        ),
      ];

      const artifactItemDefinitions =
        await mapWithConcurrency(
          artifactItemHashes,
          10,
          async (itemHash) => {
            try {
              return [
                itemHash,
                await getCachedInventoryItemDefinition(
                  itemHash,
                  apiKey
                ),
              ] as const;
            } catch {
              return [itemHash, null] as const;
            }
          }
        );

      const artifactItemMap =
        new Map(artifactItemDefinitions);

      artifact = {
        artifactHash:
          seasonalArtifact.artifactHash,
        name:
          artifactDefinition?.displayProperties?.name ??
          "Seasonal Artifact",
        description:
          artifactDefinition?.displayProperties?.description ??
          "",
        icon:
          artifactDefinition?.displayProperties?.icon ??
          null,
        pointsUsed:
          seasonalArtifact?.pointsUsed ?? 0,
        resetCount:
          seasonalArtifact?.resetCount ?? 0,
        tiers: (artifactDefinition?.tiers ?? []).map(
          (tier: any, tierIndex: number) => ({
            tierHash: tier?.tierHash ?? null,
            title:
              tier?.displayTitle ||
              `Tier ${tierIndex + 1}`,
            minimumUnlockPointsUsedRequirement:
              tier?.minimumUnlockPointsUsedRequirement ??
              0,
            isUnlocked:
              seasonalArtifact?.tiers?.[tierIndex]
                ?.isUnlocked ?? false,
            items: (tier?.items ?? [])
              .filter(
                (item: any) =>
                  item?.isVisible !== false
              )
              .map((item: any) => {
                const itemDefinition =
                  artifactItemMap.get(
                    item.itemHash
                  );
                const live =
                  liveArtifactItems.get(
                    item.itemHash
                  );

                return {
                  itemHash: item.itemHash,
                  name:
                    itemDefinition?.displayProperties
                      ?.name ?? "Artifact Perk",
                  description:
                    itemDefinition?.displayProperties
                      ?.description ?? "",
                  icon:
                    itemDefinition?.displayProperties
                      ?.icon ?? null,
                  isActive:
                    live?.isActive ?? false,
                  isUnlocked:
                    live !== undefined,
                };
              }),
          })
        ),
      };
    } catch {
      artifact = {
        artifactHash:
          seasonalArtifact.artifactHash,
        name: "Seasonal Artifact",
        description: "",
        icon: null,
        pointsUsed:
          seasonalArtifact?.pointsUsed ?? 0,
        resetCount:
          seasonalArtifact?.resetCount ?? 0,
        tiers: [],
      };
    }
  }

  const loadoutDefinitionHashes = {
    names: [
      ...new Set<number>(
        inGameLoadouts
          .map((loadout: any) => loadout?.nameHash)
          .filter(
            (hash: unknown): hash is number =>
              typeof hash === "number"
          )
      ),
    ],
    icons: [
      ...new Set<number>(
        inGameLoadouts
          .map((loadout: any) => loadout?.iconHash)
          .filter(
            (hash: unknown): hash is number =>
              typeof hash === "number"
          )
      ),
    ],
    colors: [
      ...new Set<number>(
        inGameLoadouts
          .map((loadout: any) => loadout?.colorHash)
          .filter(
            (hash: unknown): hash is number =>
              typeof hash === "number"
          )
      ),
    ],
  };

  const [
    loadoutNameDefinitions,
    loadoutIconDefinitions,
    loadoutColorDefinitions,
  ] = await Promise.all([
    mapWithConcurrency(
      loadoutDefinitionHashes.names,
      6,
      async (hash) => {
        try {
          return [
            hash,
            await getCachedManifestDefinition(
              "DestinyLoadoutNameDefinition",
              hash,
              apiKey
            ),
          ] as const;
        } catch {
          return [hash, null] as const;
        }
      }
    ),
    mapWithConcurrency(
      loadoutDefinitionHashes.icons,
      6,
      async (hash) => {
        try {
          return [
            hash,
            await getCachedManifestDefinition(
              "DestinyLoadoutIconDefinition",
              hash,
              apiKey
            ),
          ] as const;
        } catch {
          return [hash, null] as const;
        }
      }
    ),
    mapWithConcurrency(
      loadoutDefinitionHashes.colors,
      6,
      async (hash) => {
        try {
          return [
            hash,
            await getCachedManifestDefinition(
              "DestinyLoadoutColorDefinition",
              hash,
              apiKey
            ),
          ] as const;
        } catch {
          return [hash, null] as const;
        }
      }
    ),
  ]);

  const loadoutNameMap =
    new Map(loadoutNameDefinitions);
  const loadoutIconMap =
    new Map(loadoutIconDefinitions);
  const loadoutColorMap =
    new Map(loadoutColorDefinitions);

  const enrichedInGameLoadouts =
    inGameLoadouts.map(
      (loadout: any, index: number) => {
        const nameDefinition =
          loadoutNameMap.get(loadout?.nameHash);
        const iconDefinition =
          loadoutIconMap.get(loadout?.iconHash);
        const colorDefinition =
          loadoutColorMap.get(loadout?.colorHash);

        return {
          index,
          nameHash:
            loadout?.nameHash ?? null,
          iconHash:
            loadout?.iconHash ?? null,
          colorHash:
            loadout?.colorHash ?? null,
          name:
            nameDefinition?.name ??
            nameDefinition?.displayProperties?.name ??
            `Loadout ${index + 1}`,
          icon:
            iconDefinition?.iconImagePath ??
            iconDefinition?.icon_image_path ??
            iconDefinition?.icon ??
            iconDefinition?.displayProperties?.icon ??
            null,
          colorImage:
            colorDefinition?.colorImagePath ??
            colorDefinition?.color_image_path ??
            null,
          items:
            loadout?.items ?? [],
        };
      }
    );

  return NextResponse.json({
    success: true,
    scope: "core",
    requestedCharacterId: characterId,
    inventoryCount: enrichedInventory.length,
    equipmentCount: enrichedEquipment.length,
    vaultCount: enrichedVault.length,
    otherGuardianCount: otherGuardianItems.length,
    inventory: enrichedInventory,
    equipment: enrichedEquipment,
    vault: enrichedVault,
    otherGuardianItems,
    itemLocationModel: {
      version: 1,
      types: [
        "equipped",
        "characterInventory",
        "vault",
        "otherGuardian",
        "missing",
      ],
    },
    subclass: equippedSubclass,
    subclassSetup,
    classType,
    subclasses,
    seasonalArtifact,
    artifact,
    inGameLoadouts: enrichedInGameLoadouts,
  });
}
