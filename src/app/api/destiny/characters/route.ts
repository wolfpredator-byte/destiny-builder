import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function getClassName(classType: number) {
  switch (classType) {
    case 0:
      return "Titan";
    case 1:
      return "Hunter";
    case 2:
      return "Warlock";
    default:
      return "Unknown";
  }
}

export async function GET() {
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

  const profileResponse = await fetch(
    `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=200`,
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
        error: "Failed to fetch Destiny characters",
        details: profileData,
      },
      { status: profileResponse.status || 500 }
    );
  }

  const charactersData =
    profileData.Response?.characters?.data ?? {};

  const characters = Object.values(charactersData).map(
    (character: any) => ({
      characterId: character.characterId,
      classType: character.classType,
      className: getClassName(character.classType),
      light: character.light,
      raceType: character.raceType,
      genderType: character.genderType,
      emblemPath: character.emblemPath,
      emblemBackgroundPath: character.emblemBackgroundPath,
      dateLastPlayed: character.dateLastPlayed,
      minutesPlayedTotal: character.minutesPlayedTotal,
    })
  );

  return NextResponse.json({
    success: true,
    membership: {
      membershipType,
      membershipId,
      displayName: activeMembership.displayName,
    },
    characters,
  });
}
