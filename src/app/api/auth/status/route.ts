import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();

  const accessToken = cookieStore.get("bungie_access_token");
  const membershipId = cookieStore.get("bungie_membership_id");

  return NextResponse.json({
    authenticated: Boolean(accessToken),
    membershipId: membershipId?.value ?? null,
  });
}