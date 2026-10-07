import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getInventoryItemDefinition } from "@/lib/bungie/manifest";
import { getItemCategory } from "@/lib/bungie/itemCategories";

export async function GET() {
  const cookieStore = await cookies();

  const accessToken = cookieStore.get("bungie_access_token")?.value;
  const apiKey = process.env.BUNGIE_API_KEY;

  if (!accessToken) {
    return NextResponse.json(
      {
        success: false,
        error: "User is not authenticated",
      },
      { status: 401 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "BUNGIE_API_KEY is missing",
      },
      { status: 500 }
    );
  }

  // 1. Recuperiamo le membership Destiny
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
      {
        status: membershipsResponse.status || 500,
      }
    );
  }

  const destinyMemberships =
    membershipsData.Response?.destinyMemberships ?? [];

  if (destinyMemberships.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: "No Destiny memberships found",
      },
      { status: 404 }
    );
  }

  // 2. Selezioniamo la membership attiva
  const crossSaveMembership = destinyMemberships.find(
    (membership: any) =>
      membership.crossSaveOverride &&
      membership.crossSaveOverride !== 0 &&
      membership.membershipType === membership.crossSaveOverride
  );

  const activeMembership =
    crossSaveMembership ??
    destinyMemberships.find(
      (membership: any) => membership.isPublic
    ) ??
    destinyMemberships[0];

  const membershipType = activeMembership.membershipType;
  const membershipId = activeMembership.membershipId;

  // 3. Recuperiamo ProfileInventories
  const profileResponse = await fetch(
    `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=102`,
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
        error: "Failed to fetch Vault",
        details: profileData,
      },
      {
        status: profileResponse.status || 500,
      }
    );
  }

  const profileInventory =
    profileData.Response?.profileInventory?.data?.items ?? [];

const uniqueHashes: number[] = [
  ...new Set<number>(
    profileInventory.map((item: any) => Number(item.itemHash))
  ),
];

const definitions = await Promise.all(
  uniqueHashes.map(async (itemHash) => {
    try {
      const definition =
        await getInventoryItemDefinition(
          itemHash,
          apiKey
        );

      return [itemHash, definition] as const;
    } catch {
      return [itemHash, null] as const;
    }
  })
);

const definitionMap = new Map(definitions);

const enrichedItems = profileInventory.map(
  (item: any) => {
    const definition =
      definitionMap.get(item.itemHash);

    return {
      itemHash: item.itemHash,
      itemInstanceId:
        item.itemInstanceId ?? null,
      bucketHash:
        item.bucketHash ?? null,
      quantity:
        item.quantity ?? 1,

      name:
        definition?.displayProperties?.name ??
        "Unknown Item",

      description:
        definition?.displayProperties?.description ??
        "",

      icon:
        definition?.displayProperties?.icon ??
        null,

      itemTypeDisplayName:
        definition?.itemTypeDisplayName ??
        null,

      itemType:
        definition?.itemType ??
        null,

      itemSubType:
        definition?.itemSubType ??
        null,

      tierTypeName:
        definition?.inventory?.tierTypeName ??
        null,

      equippable:
        definition?.equippable ??
        false,

      category: getItemCategory(
        definition?.itemType ?? null
      ),
    };
  }
);

return NextResponse.json({
  success: true,
  itemCount: enrichedItems.length,
  items: enrichedItems,
});

  
}