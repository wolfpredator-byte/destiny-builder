import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error,
      },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      {
        success: false,
        error: "Authorization code missing",
      },
      { status: 400 }
    );
  }

  const clientId = process.env.BUNGIE_CLIENT_ID;
  const clientSecret = process.env.BUNGIE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing Bungie OAuth credentials",
      },
      { status: 500 }
    );
  }

  const tokenResponse = await fetch(
    "https://www.bungie.net/platform/app/oauth/token/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to exchange authorization code",
        details: tokenData,
      },
      { status: tokenResponse.status }
    );
  }

  const response = NextResponse.redirect(
  new URL("/?auth=success", request.url)
);

response.cookies.set("bungie_access_token", tokenData.access_token, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: tokenData.expires_in,
});

if (tokenData.refresh_token) {
  response.cookies.set("bungie_refresh_token", tokenData.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: tokenData.refresh_expires_in ?? 7776000,
  });
}

if (tokenData.membership_id) {
  response.cookies.set(
    "bungie_membership_id",
    String(tokenData.membership_id),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: tokenData.refresh_expires_in ?? 7776000,
    }
  );
}

return response;
}