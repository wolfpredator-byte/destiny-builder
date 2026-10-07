import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

  // 1. Recuperiamo le membership Destiny dell'utente
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

  if (
    !membershipsResponse.ok ||
    membershipsData.ErrorCode !== 1
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch Destiny memberships",
        details: membershipsData,
      },
      { status: membershipsResponse.status || 500 }
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

  // 2. Se c'è Cross Save scegliamo la membership principale
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

  // 3. Recuperiamo profilo e personaggi
  //
  // 100 = Profiles
  // 200 = Characters
  const profileResponse = await fetch(
    `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=100,200`,
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
        error: "Failed to fetch Destiny profile",
        details: profileData,
      },
      { status: profileResponse.status || 500 }
    );
  }

  return NextResponse.json({
    success: true,

    membership: {
      membershipType,
      membershipId,
      displayName: activeMembership.displayName,
    },

    profile: profileData.Response,
  });
}