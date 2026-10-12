import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getInventoryItemDefinition } from "@/lib/bungie/manifest";

// First controlled write operation for Destiny Builder.
// Deliberately supports ONLY: Vault -> Guardian inventory, Guardian inventory -> Vault.
// No equipped items, cross-Guardian hops, stacks, perks or real equip actions.

type TransferDestination =
  | { type: "vault" }
  | { type: "guardian"; characterId: string };

type TransferInput = {
  itemHash: number;
  itemInstanceId: string;
  destination: TransferDestination;
  confirm: true;
};

type BungieItem = {
  itemHash?: number;
  itemInstanceId?: string | null;
  transferStatus?: number;
};

type DestinyMembership = {
  membershipType: number;
  membershipId: string;
  crossSaveOverride?: number;
  isPublic?: boolean;
};

const numericIdPattern = /^[1-9]\d{0,24}$/;

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseInput(raw: unknown): TransferInput | null {
  if (!isRecord(raw) || raw.confirm !== true || !isRecord(raw.destination)) {
    return null;
  }

  const itemHash = raw.itemHash;
  const itemInstanceId = raw.itemInstanceId;
  const destination = raw.destination;
  if (
    typeof itemHash !== "number" ||
    !Number.isInteger(itemHash) ||
    itemHash <= 0 ||
    itemHash > 0xffffffff ||
    typeof itemInstanceId !== "string" ||
    !numericIdPattern.test(itemInstanceId)
  ) {
    return null;
  }

  if (destination.type === "vault") {
    return {
      itemHash,
      itemInstanceId,
      destination: { type: "vault" },
      confirm: true,
    };
  }
  if (
    destination.type === "guardian" &&
    typeof destination.characterId === "string" &&
    numericIdPattern.test(destination.characterId)
  ) {
    return {
      itemHash,
      itemInstanceId,
      destination: { type: "guardian", characterId: destination.characterId },
      confirm: true,
    };
  }
  return null;
}

function findMatchingItems(items: unknown, input: TransferInput): BungieItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is BungieItem =>
    isRecord(item) &&
    String(item.itemInstanceId ?? "") === input.itemInstanceId &&
    item.itemHash === input.itemHash
  );
}

async function bungieGet(url: string, accessToken: string, apiKey: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-API-Key": apiKey,
    },
    cache: "no-store",
  });
  const json: unknown = await response.json().catch(() => null);
  return { response, json };
}

export async function POST(request: NextRequest) {
  // Explicit opt-in protects the pre-existing read-only installation.
  if (process.env.DESTINY_ENABLE_ITEM_TRANSFERS !== "true") {
    return fail("Real transfers are disabled. Enable DESTINY_ENABLE_ITEM_TRANSFERS=true on the server when ready.", 503);
  }

  // Reject cross-site form/fetch requests before inspecting any cookies.
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return fail("Cross-origin transfers are not allowed.", 403);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return fail("Expected application/json.", 415);
  }

  const input = parseInput(await request.json().catch(() => null));
  if (!input) {
    return fail("Invalid transfer request. itemHash, itemInstanceId (string), destination and confirm:true are required.", 400);
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get("bungie_access_token")?.value;
  const apiKey = process.env.BUNGIE_API_KEY;
  if (!accessToken) return fail("Bungie session expired. Sign in again.", 401);
  if (!apiKey) return fail("BUNGIE_API_KEY is missing.", 500);

  try {
    const membershipsResult = await bungieGet(
      "https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/",
      accessToken,
      apiKey
    );
    if (membershipsResult.response.status === 401) return fail("Bungie session expired. Sign in again.", 401);
    const membershipsData = membershipsResult.json;
    if (!isRecord(membershipsData) || !membershipsResult.response.ok || membershipsData.ErrorCode !== 1) {
      return fail("Could not verify Bungie account ownership.", 502);
    }
    const responseValue = membershipsData.Response;
    const destinyMemberships = isRecord(responseValue) && Array.isArray(responseValue.destinyMemberships)
      ? responseValue.destinyMemberships as DestinyMembership[]
      : [];
    const activeMembership =
      destinyMemberships.find((membership) => membership.crossSaveOverride &&
        membership.crossSaveOverride !== 0 && membership.membershipType === membership.crossSaveOverride) ??
      destinyMemberships.find((membership) => membership.isPublic) ??
      destinyMemberships[0];
    if (!activeMembership) return fail("No Destiny account found.", 404);

    const { membershipType, membershipId } = activeMembership;
    const profileResult = await bungieGet(
      `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=102,200,201,205`,
      accessToken,
      apiKey
    );
    if (profileResult.response.status === 401) return fail("Bungie session expired. Sign in again.", 401);
    const profile = profileResult.json;
    if (!isRecord(profile) || !profileResult.response.ok || profile.ErrorCode !== 1 || !isRecord(profile.Response)) {
      return fail("Could not verify the current item location. No transfer was attempted.", 502);
    }

    const data = profile.Response;
    const charactersPart = isRecord(data.characters) ? data.characters.data : null;
    const characters = isRecord(charactersPart) ? charactersPart : {};
    const inventoryPart = isRecord(data.profileInventory) ? data.profileInventory.data : null;
    const vaultMatches = findMatchingItems(isRecord(inventoryPart) ? inventoryPart.items : null, input);
    const inventoriesPart = isRecord(data.characterInventories) ? data.characterInventories.data : null;
    const characterInventories = isRecord(inventoriesPart) ? inventoriesPart : {};
    const equipmentPart = isRecord(data.characterEquipment) ? data.characterEquipment.data : null;
    const characterEquipment = isRecord(equipmentPart) ? equipmentPart : {};

    const carriedMatches: { characterId: string; item: BungieItem }[] = [];
    const equippedMatches: { characterId: string; item: BungieItem }[] = [];
    for (const [characterId, entry] of Object.entries(characterInventories)) {
      const match = findMatchingItems(isRecord(entry) ? entry.items : null, input);
      for (const item of match) carriedMatches.push({ characterId, item });
    }
    for (const [characterId, entry] of Object.entries(characterEquipment)) {
      const match = findMatchingItems(isRecord(entry) ? entry.items : null, input);
      for (const item of match) equippedMatches.push({ characterId, item });
    }

    if (equippedMatches.length > 0) {
      return fail("The item is equipped. Unequip it in Destiny before transferring.", 409);
    }
    if (vaultMatches.length + carriedMatches.length !== 1) {
      return fail("The item was not uniquely found in the Vault or a Guardian inventory. Refresh and try again.", 409);
    }

    const source = vaultMatches.length === 1 ? "vault" : "guardian";
    const item = vaultMatches[0] ?? carriedMatches[0]?.item;
    const sourceCharacterId = carriedMatches[0]?.characterId ?? null;
    if (item?.transferStatus !== undefined && item.transferStatus !== 0) {
      return fail("Bungie reports this item as not currently transferable.", 409);
    }

    const destination = input.destination;
    let transferToVault: boolean;
    let characterId: string;
    if (destination.type === "vault") {
      if (source !== "guardian" || !sourceCharacterId) {
        return fail("That item is already in the Vault.", 409);
      }
      characterId = sourceCharacterId;
      transferToVault = true;
    } else {
      if (source !== "vault") {
        return fail("For now, move this item to the Vault first before sending it to another Guardian.", 409);
      }
      if (!Object.prototype.hasOwnProperty.call(characters, destination.characterId)) {
        return fail("Destination Guardian is not part of this Bungie account.", 400);
      }
      characterId = destination.characterId;
      transferToVault = false;
    }

    // One cached Manifest definition: restrict this first write phase to actual weapons/armor.
    const definition = await getInventoryItemDefinition(input.itemHash, apiKey);
    if (!definition || (definition.itemType !== 2 && definition.itemType !== 3)) {
      return fail("Only weapons and armor can be transferred in this first phase.", 400);
    }
    if (definition.nonTransferrable === true) {
      return fail("This item cannot be transferred according to Bungie.", 409);
    }

    const transferResponse = await fetch(
      "https://www.bungie.net/Platform/Destiny2/Actions/Items/TransferItem/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemReferenceHash: input.itemHash,
          itemId: input.itemInstanceId, // Preserve 64-bit ID precision.
          stackSize: 1,
          transferToVault,
          characterId,
          membershipType,
        }),
        cache: "no-store",
      }
    );
    const transferResult: unknown = await transferResponse.json().catch(() => null);
    if (transferResponse.status === 401) return fail("Bungie session expired. Sign in again.", 401);
    if (!transferResponse.ok || !isRecord(transferResult) || transferResult.ErrorCode !== 1) {
      const status = isRecord(transferResult) && typeof transferResult.ErrorStatus === "string"
        ? transferResult.ErrorStatus : "Unknown Bungie error";
      return NextResponse.json(
        { success: false, error: `Bungie rejected the transfer: ${status}`, bungieErrorCode: isRecord(transferResult) ? transferResult.ErrorCode ?? null : null },
        { status: transferResponse.status >= 400 && transferResponse.status < 500 ? transferResponse.status : 502 }
      );
    }

    // Bungie accepted the transfer. The Vault UI must now refresh the real account
    // inventory to confirm the new location; no optimistic local 'success' move.
    return NextResponse.json({
      success: true,
      bungieAccepted: true,
      verifiedLocation: false,
      itemInstanceId: input.itemInstanceId,
      itemHash: input.itemHash,
      from: source,
      destination: destination.type,
      characterId,
      message: "Bungie accepted the transfer. Refresh account inventory to verify its destination.",
    });
  } catch {
    return fail("Bungie transfer verification failed. Refresh inventory before retrying; do not repeat blindly.", 502);
  }
}
