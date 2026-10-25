/**
 * Engine-B0.5c3d2a — offline Manifest socket-type accessor tests.
 * This script intercepts ALL fetch requests: it NEVER contacts Bungie or OpenAI.
 * Type/cache lookup only; this does not certify plug installation.
 */
import { getInventoryItemDefinition, getSocketTypeDefinition } from '../src/lib/bungie/manifest';

const SOCKET_A = 1718047805;
const SOCKET_B = 2581339086;
const FAKE_VERSION = `B05c3d2a_test_${process.pid}_${Date.now()}`;
const API_KEY = 'offline-test-placeholder';
let manifestVersionCalls = 0;
const definitionCalls = new Map<string, number>();
const originalFetch = globalThis.fetch;
let count = 0;
function assert(condition: unknown, explanation: string): asserts condition {
  if (!condition) throw new Error(explanation);
}
function equal(actual: unknown, expected: unknown, explanation: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${explanation}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function test(label: string, fn: () => void) { fn(); count++; console.log(`PASS ${String(count).padStart(2, '0')} ${label}`); }
async function main() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    assert(init?.cache === 'no-store', `Unexpected caching policy at ${url}`);
    assert(new Headers(init.headers).get('X-API-Key') === API_KEY, 'Unexpected test API key');
    if (url.endsWith('/Destiny2/Manifest/')) {
      manifestVersionCalls++;
      return Response.json({ ErrorCode: 1, Response: { version: FAKE_VERSION } });
    }
    const match = url.match(/\/Destiny2\/Manifest\/(DestinySocketTypeDefinition|DestinyInventoryItemDefinition)\/(\d+)\/$/);
    if (!match) throw new Error(`Unexpected fetch; real network is prohibited: ${url}`);
    const [, type, hashText] = match;
    const hash = Number(hashText);
    assert([SOCKET_A, SOCKET_B].includes(hash), 'Unexpected hash');
    const key = `${type}:${hash}`;
    definitionCalls.set(key, (definitionCalls.get(key) ?? 0) + 1);
    const content = type === 'DestinyInventoryItemDefinition' ? { hash, itemType: 2 } :
      hash === SOCKET_A ? { hash, plugWhitelist: [{ categoryHash: 100, categoryIdentifier: 'a' }] } :
        { hash, plugWhitelist: [] };
    return Response.json({ ErrorCode: 1, Response: content });
  }) as typeof fetch;

  try {
    const a = await getSocketTypeDefinition(SOCKET_A, API_KEY);
    test('Exact DestinySocketTypeDefinition fetched and preserved', () =>
      equal(a, { hash: SOCKET_A, plugWhitelist: [{ categoryHash: 100, categoryIdentifier: 'a' }] }, 'socket A'));
    const aRepeat = await getSocketTypeDefinition(SOCKET_A, API_KEY);
    test('Repeated same socket lookup reuses versioned cache', () => {
      equal(aRepeat, a, 'cached definition');
      equal(definitionCalls.get(`DestinySocketTypeDefinition:${SOCKET_A}`), 1, 'socket A fetch count');
    });
    const b = await getSocketTypeDefinition(SOCKET_B, API_KEY);
    test('Distinct socket hash receives distinct definition', () => {
      equal(b.plugWhitelist, [], 'explicit empty whitelist survives');
      equal(definitionCalls.get(`DestinySocketTypeDefinition:${SOCKET_B}`), 1, 'socket B fetch count');
    });
    const item = await getInventoryItemDefinition(SOCKET_A, API_KEY);
    test('Different Manifest definition types do not collide on same hash', () => {
      equal(item, { hash: SOCKET_A, itemType: 2 }, 'item definition');
      equal(definitionCalls.get(`DestinyInventoryItemDefinition:${SOCKET_A}`), 1, 'item fetch count');
    });
    test('Version lookup is shared by these requests', () => equal(manifestVersionCalls, 1, 'version calls'));
    const priorVersionCount = manifestVersionCalls;
    const priorCallCount = [...definitionCalls.values()].reduce((a,b)=>a+b,0);
    for (const invalid of [0,-1,NaN,Infinity,2.5,0x100000000]) {
      let rejected = false;
      try { await getSocketTypeDefinition(invalid, API_KEY); }
      catch (e) { rejected = e instanceof Error && e.message === 'Invalid DestinySocketTypeDefinition hash'; }
      if (!rejected) throw new Error(`Invalid hash did not reject: ${invalid}`);
    }
    test('Invalid hashes reject without any fetch', () => {
      equal(manifestVersionCalls,priorVersionCount,'version calls unchanged');
      equal([...definitionCalls.values()].reduce((a,b)=>a+b,0),priorCallCount,'definition calls unchanged');
    });
    console.log(`PASS — ${count} Manifest socket accessor assertions. Mocked fetch only; no Bungie/OpenAI calls.`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch(err => { console.error(err); process.exitCode=1; });
