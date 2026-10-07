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

  const response = await fetch(
    "https://www.bungie.net/Platform/User/GetMembershipsForCurrentUser/",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-API-Key": apiKey,
      },
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok || data.ErrorCode !== 1) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch Bungie memberships",
        details: data,
      },
      { status: response.status || 500 }
    );
  }

const membershipData = data.Response;
const destinyMemberships = membershipData.destinyMemberships ?? [];

if (destinyMemberships.length === 0) {
  return NextResponse.json(
    {
      success: false,
      error: "No Destiny memberships found",
    },
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

return NextResponse.json({
  success: true,
  activeMembership: {
    membershipType: activeMembership.membershipType,
    membershipId: activeMembership.membershipId,
    displayName: activeMembership.displayName,
    crossSaveOverride: activeMembership.crossSaveOverride,
  },
  allMemberships: destinyMemberships.map((membership: any) => ({
    membershipType: membership.membershipType,
    membershipId: membership.membershipId,
    displayName: membership.displayName,
    crossSaveOverride: membership.crossSaveOverride,
  })),
});
}