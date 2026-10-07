import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.BUNGIE_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "BUNGIE_CLIENT_ID is missing" },
      { status: 500 }
    );
  }

  const authorizationUrl = new URL(
    "https://www.bungie.net/en/OAuth/Authorize"
  );

  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("response_type", "code");

  return NextResponse.redirect(authorizationUrl);
}