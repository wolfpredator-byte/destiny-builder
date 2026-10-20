import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUNGIE_API_ROOT } from "./config";

type ManifestDefinitionType =
  | "DestinyInventoryItemDefinition"
  | "DestinyStatDefinition"
  | "DestinyPlugSetDefinition"
  | "DestinySocketTypeDefinition";

type MemoryCacheEntry = {
  expiresAt: number;
  manifestVersion: string;
  promise: Promise<any>;
};

type ManifestVersionSnapshot = {
  version: string | null;
  verified: boolean;
  epoch: number;
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const VERSION_TTL_MS = 60 * 60 * 1000;
const VERSION_RETRY_MS = 2 * 60 * 1000;
const CACHE_ROOT = path.join(tmpdir(), "destiny-builder-manifest-cache");

const memoryCache = new Map<string, MemoryCacheEntry>();

// "version" is the last successfully verified version, not a claim that the
// latest verification succeeded. The epoch changes only on a confirmed change.
const versionCache: {
  version: string | null;
  verified: boolean;
  expiresAt: number;
  epoch: number;
  pending: Promise<ManifestVersionSnapshot> | null;
} = {
  version: null,
  verified: false,
  expiresAt: 0,
  epoch: 0,
  pending: null,
};

function snapshot(): ManifestVersionSnapshot {
  return {
    version: versionCache.version,
    verified: versionCache.verified,
    epoch: versionCache.epoch,
  };
}

function validManifestVersion(value: unknown): value is string {
  // Manifest versions are used in filenames: reject unsafe or unbounded values.
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && value !== "unknown";
}

function getCacheKey(
  definitionType: ManifestDefinitionType,
  hash: number,
  version: string,
): string {
  return `${definitionType}:${hash}:${version}`;
}

function getCachePath(
  definitionType: ManifestDefinitionType,
  hash: number,
  version: string,
): string {
  return path.join(CACHE_ROOT, definitionType, `${hash}_${version}.json`);
}

async function getManifestVersion(apiKey: string): Promise<ManifestVersionSnapshot> {
  // A refresh already under way takes precedence over a cached result.
  if (versionCache.pending) return versionCache.pending;
  if (Date.now() < versionCache.expiresAt) return snapshot();

  const pending = (async (): Promise<ManifestVersionSnapshot> => {
    try {
      const response = await fetch(`${BUNGIE_API_ROOT}/Destiny2/Manifest/`, {
        headers: { "X-API-Key": apiKey },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Manifest version endpoint unavailable");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Invalid manifest version envelope");
      const result = data as {
        ErrorCode?: unknown;
        Response?: { version?: unknown } | null;
      };
      const version = result.Response?.version;
      if (result.ErrorCode !== 1 || !validManifestVersion(version))
        throw new Error("Invalid manifest version response");

      if (versionCache.version !== version) {
        versionCache.epoch += 1;
        memoryCache.clear(); // Disk files remain isolated by version suffix.
      }
      versionCache.version = version;
      versionCache.verified = true;
      versionCache.expiresAt = Date.now() + VERSION_TTL_MS;
    } catch {
      // Keep the last known revision available as a best-effort fallback, but
      // do not treat it as newly verified or persist new definitions under it.
      versionCache.verified = false;
      versionCache.expiresAt = Date.now() + VERSION_RETRY_MS;
    }
    return snapshot();
  })();

  versionCache.pending = pending;
  try {
    return await pending;
  } finally {
    if (versionCache.pending === pending) versionCache.pending = null;
  }
}

async function readDiskCache(
  definitionType: ManifestDefinitionType,
  hash: number,
  version: string,
): Promise<any | null> {
  const filePath = getCachePath(definitionType, hash, version);
  try {
    const fileStat = await stat(filePath);
    if (Date.now() - fileStat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeDiskCache(
  definitionType: ManifestDefinitionType,
  hash: number,
  version: string,
  value: any,
): Promise<void> {
  try {
    await mkdir(path.join(CACHE_ROOT, definitionType), { recursive: true });
    await writeFile(getCachePath(definitionType, hash, version), JSON.stringify(value), "utf8");
  } catch {
    // Best effort. The live definition remains usable even if disk is unwritable.
  }
}

async function fetchDefinition(
  definitionType: ManifestDefinitionType,
  hash: number,
  apiKey: string,
): Promise<any> {
  // The application's own versioned memory/disk caches are authoritative here.
  // An independent HTTP force-cache could retain an earlier Manifest revision.
  const response = await fetch(
    `${BUNGIE_API_ROOT}/Destiny2/Manifest/${definitionType}/${hash}/`,
    { headers: { "X-API-Key": apiKey }, cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok || data?.ErrorCode !== 1)
    throw new Error(`Failed to load ${definitionType} for hash ${hash}`);
  return data.Response;
}

export async function getManifestDefinition(
  definitionType: ManifestDefinitionType,
  hash: number,
  apiKey: string,
): Promise<any> {
  const revision = await getManifestVersion(apiKey);

  // If the Manifest version cannot be verified, previously cached data for a
  // known version may still be read. New data must NOT be cached as "unknown"
  // or incorrectly attributed to the last verified version.
  if (!revision.verified || !revision.version) {
    if (revision.version) {
      const key = getCacheKey(definitionType, hash, revision.version);
      const cached = memoryCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.promise;
      const disk = await readDiskCache(definitionType, hash, revision.version);
      if (disk !== null) return disk;
    }
    return fetchDefinition(definitionType, hash, apiKey);
  }

  const cacheKey = getCacheKey(definitionType, hash, revision.version);
  const now = Date.now();
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > now && cached.manifestVersion === revision.version)
    return cached.promise;

  const promise = (async () => {
    const diskValue = await readDiskCache(definitionType, hash, revision.version!);
    // A concurrent version refresh can supersede this request even during disk IO.
    if (versionCache.epoch !== revision.epoch)
      return getManifestDefinition(definitionType, hash, apiKey);
    if (diskValue !== null) return diskValue;

    const value = await fetchDefinition(definitionType, hash, apiKey);
    if (versionCache.epoch !== revision.epoch)
      return getManifestDefinition(definitionType, hash, apiKey);

    // A temporary version-check failure must never promote newly fetched data
    // to a confirmed version. Only confirmed revisions may be persisted.
    if (versionCache.verified && versionCache.version === revision.version)
      await writeDiskCache(definitionType, hash, revision.version!, value);

    if (versionCache.epoch !== revision.epoch)
      return getManifestDefinition(definitionType, hash, apiKey);
    return value;
  })();

  // Do not delete a newer entry if this older promise fails after replacement.
  const guardedPromise = promise.catch((error) => {
    if (memoryCache.get(cacheKey)?.promise === guardedPromise)
      memoryCache.delete(cacheKey);
    throw error;
  });
  memoryCache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    manifestVersion: revision.version,
    promise: guardedPromise,
  });
  return guardedPromise;
}

export async function getInventoryItemDefinition(itemHash: number, apiKey: string) {
  return getManifestDefinition("DestinyInventoryItemDefinition", itemHash, apiKey);
}

/**
 * Engine-B0.5c3d2a — Version-aware socket type Manifest lookup.
 * This returns STATIC definition evidence only. A plugWhitelist match is not
 * per-instance insertability, ownership, unlock, or energy certification.
 */
export async function getSocketTypeDefinition(socketTypeHash: number, apiKey: string) {
  if (!Number.isSafeInteger(socketTypeHash) || socketTypeHash <= 0 || socketTypeHash > 0xffffffff) {
    throw new Error("Invalid DestinySocketTypeDefinition hash");
  }
  return getManifestDefinition("DestinySocketTypeDefinition", socketTypeHash, apiKey);
}
