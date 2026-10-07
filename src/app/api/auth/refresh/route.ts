import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const cookieStore = await cookies();

  const refreshToken = cookieStore.get(
    "bungie_refresh_token"
  )?.value;

  const clientId =
    process.env.CLIENT_ID ??
    process.env.BUNGIE_CLIENT_ID ??
    process.env.NEXT_PUBLIC_BUNGIE_CLIENT_ID;

  const clientSecret =
    process.env.CLIENT_SECRET ??
    process.env.BUNGIE_CLIENT_SECRET;

  if (!refreshToken) {
    return NextResponse.json(
      {
        success: false,
        error: "No Bungie refresh token is available. Please sign in again.",
      },
      { status: 401 }
    );
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Bungie OAuth client configuration is missing. Expected CLIENT_ID/BUNGIE_CLIENT_ID and CLIENT_SECRET/BUNGIE_CLIENT_SECRET.",
      },
      { status: 500 }
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const tokenResponse = await fetch(
    "https://www.bungie.net/platform/app/oauth/token/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    }
  );

  const tokenData = await tokenResponse
    .json()
    .catch(() => null);

  if (!tokenResponse.ok || !tokenData?.access_token) {
    return NextResponse.json(
      {
        success: false,
        error:
          tokenData?.error_description ||
          tokenData?.error ||
          "Bungie session could not be refreshed. Please sign in again.",
      },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    success: true,
    expiresIn: tokenData.expires_in ?? null,
    refreshExpiresIn:
      tokenData.refresh_expires_in ?? null,
  });

  const commonCookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
  };

  response.cookies.set(
    "bungie_access_token",
    tokenData.access_token,
    {
      ...commonCookieOptions,
      maxAge: tokenData.expires_in ?? 3600,
    }
  );

  if (tokenData.refresh_token) {
    response.cookies.set(
      "bungie_refresh_token",
      tokenData.refresh_token,
      {
        ...commonCookieOptions,
        maxAge:
          tokenData.refresh_expires_in ??
          60 * 60 * 24 * 90,
      }
    );
  }

  if (tokenData.membership_id) {
    response.cookies.set(
      "bungie_membership_id",
      String(tokenData.membership_id),
      {
        ...commonCookieOptions,
        maxAge:
          tokenData.refresh_expires_in ??
          60 * 60 * 24 * 90,
      }
    );
  }

  return response;
}
