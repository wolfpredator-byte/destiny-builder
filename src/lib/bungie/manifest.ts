import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUNGIE_API_ROOT } from "./config";

type ManifestDefinitionType =
  | "DestinyInventoryItemDefinition"
  | "DestinyStatDefinition"
  | "DestinyPlugSetDefinition";

type MemoryCacheEntry = {
  expiresAt: number;
  promise: Promise<any>;
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_ROOT = path.join(
  tmpdir(),
  "destiny-builder-manifest-cache"
);

const memoryCache = new Map<string, MemoryCacheEntry>();

function getCacheKey(
  definitionType: ManifestDefinitionType,
  hash: number
) {
  return `${definitionType}:${hash}`;
}

function getCachePath(
  definitionType: ManifestDefinitionType,
  hash: number
) {
  return path.join(
    CACHE_ROOT,
    definitionType,
    `${hash}.json`
  );
}

async function readDiskCache(
  definitionType: ManifestDefinitionType,
  hash: number
) {
  const filePath = getCachePath(definitionType, hash);

  try {
    const fileStat = await stat(filePath);

    if (Date.now() - fileStat.mtimeMs > CACHE_TTL_MS) {
      return null;
    }

    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeDiskCache(
  definitionType: ManifestDefinitionType,
  hash: number,
  value: any
) {
  const directory = path.join(
    CACHE_ROOT,
    definitionType
  );

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      getCachePath(definitionType, hash),
      JSON.stringify(value),
      "utf8"
    );
  } catch {
    // Cache writes are best-effort. A filesystem problem must never break
    // Guardian loading; the live Bungie response is still returned.
  }
}

export async function getManifestDefinition(
  definitionType: ManifestDefinitionType,
  hash: number,
  apiKey: string
) {
  const cacheKey = getCacheKey(definitionType, hash);
  const now = Date.now();
  const cached = memoryCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = (async () => {
    const diskValue = await readDiskCache(
      definitionType,
      hash
    );

    if (diskValue) {
      return diskValue;
    }

    const response = await fetch(
      `${BUNGIE_API_ROOT}/Destiny2/Manifest/${definitionType}/${hash}/`,
      {
        headers: {
          "X-API-Key": apiKey,
        },
        cache: "force-cache",
      }
    );

    const data = await response.json();

    if (!response.ok || data.ErrorCode !== 1) {
      throw new Error(
        `Failed to load ${definitionType} for hash ${hash}`
      );
    }

    await writeDiskCache(
      definitionType,
      hash,
      data.Response
    );

    return data.Response;
  })().catch((error) => {
    memoryCache.delete(cacheKey);
    throw error;
  });

  memoryCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    promise,
  });

  return promise;
}

export async function getInventoryItemDefinition(
  itemHash: number,
  apiKey: string
) {
  return getManifestDefinition(
    "DestinyInventoryItemDefinition",
    itemHash,
    apiKey
  );
}
