import { getManifestDefinition } from "./manifest";

export async function getStatDefinition(
  statHash: number,
  apiKey: string
) {
  return getManifestDefinition(
    "DestinyStatDefinition",
    statHash,
    apiKey
  );
}
