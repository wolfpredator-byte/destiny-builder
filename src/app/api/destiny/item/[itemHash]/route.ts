import { NextResponse } from "next/server";
import { getInventoryItemDefinition } from "@/lib/bungie/manifest";

export async function GET(
  request: Request,
  context: { params: Promise<{ itemHash: string }> }
) {
  const { itemHash } = await context.params;

  const apiKey = process.env.BUNGIE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "BUNGIE_API_KEY is missing",
      },
      { status: 500 }
    );
  }

  const parsedHash = Number(itemHash);

  if (!Number.isInteger(parsedHash)) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid item hash",
      },
      { status: 400 }
    );
  }

  try {
    const definition = await getInventoryItemDefinition(
      parsedHash,
      apiKey
    );

    return NextResponse.json({
      success: true,

      item: {
        hash: definition.hash,

        name:
          definition.displayProperties?.name ?? "Unknown Item",

        description:
          definition.displayProperties?.description ?? "",

        icon:
          definition.displayProperties?.icon ?? null,

        itemTypeDisplayName:
          definition.itemTypeDisplayName ?? null,

        itemType:
          definition.itemType ?? null,

        itemSubType:
          definition.itemSubType ?? null,

        tierTypeName:
          definition.inventory?.tierTypeName ?? null,

        equippable:
          definition.equippable ?? false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load item definition",
      },
      { status: 500 }
    );
  }
}