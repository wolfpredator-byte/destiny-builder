import { getManifestDefinition } from "./manifest";

export async function getPlugSetDefinition(
  plugSetHash: number,
  apiKey: string
) {
  return getManifestDefinition(
    "DestinyPlugSetDefinition",
    plugSetHash,
    apiKey
  );
}
