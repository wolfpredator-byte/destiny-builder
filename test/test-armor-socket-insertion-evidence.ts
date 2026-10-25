/**
 * Destiny Builder — Engine-B0.5c3d1: Armor 3.0 live insertion diagnostics.
 * Offline deterministic tests; no Bungie/OpenAI calls or writes.
 * Live failure indexes and Manifest plug category hash are *evidence*, not install permission.
 */
import { assessArmorModifierAvailability } from '../src/lib/destiny-builder/armorModifierAvailability';

const GENERAL = 'enhancements.v2_general';
const TYPE_GENERAL = 1718047805;
const CURRENT = 1999001;
const CANDIDATE = 1999002;
const STAT = 392767087;
const CATEGORY_HASH = 10101010;
function equal(actual: unknown, expected: unknown, what: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function fixture() {
  return {
    schemaVersion: 1, source: 'bungie_item_detail_live_reusable_plus_manifest',
    readOnly: true, installabilityVerified: false,
    socketCountFromManifest: 2, socketCountFromLive: 2,
    itemEnergyEvidence: null,
    sockets: [{
      socketIndex: 0, socketTypeHash: TYPE_GENERAL, plugSources: 1,
      reusablePlugSetHash: null, randomizedPlugSetHash: null,
      selectedPlugHash: CURRENT, liveSocketPresent: true,
      liveSocketEnabled: true, liveReusableDataPresent: true,
      options: [{
        plugHash: CURRENT, name: 'Installed Mod', plugCategoryIdentifier: GENERAL,
        plugCategoryHash: CATEGORY_HASH, selected: true,
        plugDefinitionResolved: true, sources: ['selected', 'manifest_socket_items'],
        evidenceState: 'selected', liveCanInsert: null, liveEnabled: null,
        declaredInvestmentStats: [{ statHash: STAT, value: 5, isConditionallyActive: false }],
        declaredEnergyCost: { energyCost: 1, energyTypeHash: null },
      }, {
        plugHash: CANDIDATE, name: 'Possible Mod', plugCategoryIdentifier: GENERAL,
        plugCategoryHash: CATEGORY_HASH, selected: false,
        plugDefinitionResolved: true, sources: ['live_item_reusable', 'manifest_socket_items'],
        evidenceState: 'live_can_insert', liveCanInsert: true, liveEnabled: true,
        declaredInvestmentStats: [{ statHash: STAT, value: 10, isConditionallyActive: false }],
        declaredEnergyCost: { energyCost: 3, energyTypeHash: null },
      }],
    }],
  };
}
function candidate(input = fixture()) {
  const result = assessArmorModifierAvailability(input);
  if (!result.validEvidence) throw new Error(`Fixture rejected: ${result.reason}`);
  const option = result.sockets[0].options.find(o => o.plugHash === CANDIDATE);
  if (!option) throw new Error('Candidate disappeared');
  return { result, option };
}
let count = 0;
function test(name: string, check: () => void) {
  check(); count++; console.log(`PASS ${String(count).padStart(2, '0')} ${name}`);
}

// Existing evidence forms remain valid, and these new properties cannot create permission.
test('Legacy missing fail-index properties remain valid', () => {
  const {option} = candidate();
  equal(option.availability, 'live_candidate', 'availability');
  equal(option.liveInsertFailIndexes, null, 'missing insertion indexes');
  equal(option.liveEnableFailIndexes, null, 'missing enable indexes');
  equal(option.installabilityVerified, false, 'installability');
});
test('Plug category hash survives Manifest projection', () =>
  equal(candidate().option.plugCategoryHash, CATEGORY_HASH, 'category hash'));
test('Explicit empty live index arrays remain distinct from missing evidence', () => {
  const f = fixture();
  const opt: any = f.sockets[0].options[1];
  opt.liveInsertFailIndexes = []; opt.liveEnableFailIndexes = [];
  const {option} = candidate(f);
  equal(option.availability, 'live_candidate', 'availability');
  equal(option.liveInsertFailIndexes, [], 'insert fail indexes');
  equal(option.liveEnableFailIndexes, [], 'enable fail indexes');
});
test('Positive canInsert contradicted by insertion failures downgrades to unknown', () => {
  const f = fixture();
  (f.sockets[0].options[1] as any).liveInsertFailIndexes = [0];
  const {option} = candidate(f);
  equal(option.availability, 'unknown', 'availability');
  equal(option.liveInsertFailIndexes, [0], 'indexes');
});
test('Positive enabled contradicted by enable failures downgrades to unknown', () => {
  const f = fixture();
  (f.sockets[0].options[1] as any).liveEnableFailIndexes = [2];
  equal(candidate(f).option.availability, 'unknown', 'availability');
});
test('Explicit canInsert=false remains blocked, preserving insertion failure evidence', () => {
  const f = fixture(); const o: any = f.sockets[0].options[1];
  o.liveCanInsert = false; o.evidenceState = 'live_cannot_insert'; o.liveInsertFailIndexes = [1];
  const {option} = candidate(f);
  equal(option.availability, 'live_blocked', 'availability');
  equal(option.liveInsertFailIndexes, [1], 'indexes');
});
test('Explicit enabled=false remains blocked, preserving enable failure evidence', () => {
  const f = fixture(); const o: any = f.sockets[0].options[1];
  o.liveEnabled = false; o.liveEnableFailIndexes = [0];
  const {option} = candidate(f);
  equal(option.availability, 'live_blocked', 'availability');
  equal(option.liveEnableFailIndexes, [0], 'indexes');
});
for (const [label, bad] of [['negative', [-1]], ['fraction', [1.4]], ['duplicate', [2, 2]], ['string', ['0']], ['nonarray', 'bad']] as const) {
  test(`Malformed ${label} fail indexes cannot promote candidate`, () => {
    const f = fixture(); (f.sockets[0].options[1] as any).liveInsertFailIndexes = bad;
    const {option} = candidate(f);
    equal(option.availability, 'unknown', 'availability');
    equal(option.liveInsertFailIndexes, null, 'invalid indices do not survive');
  });
}
test('Malformed live arrays marked by route cannot promote candidate', () => {
  const f = fixture(); (f.sockets[0].options[1] as any).liveFailIndexEvidenceMalformed = true;
  equal(candidate(f).option.availability, 'unknown', 'availability');
});
test('Manifest-only plug never becomes a live candidate from indexes', () => {
  const f = fixture(); const o: any = f.sockets[0].options[1];
  o.sources = ['manifest_socket_items']; o.evidenceState = 'manifest_only';
  o.liveCanInsert = null; o.liveEnabled = null;
  o.liveInsertFailIndexes = [0];
  equal(candidate(f).option.availability, 'unknown', 'availability');
});
test('Missing category hash does not fabricate a whitelist match', () => {
  const f = fixture(); (f.sockets[0].options[1] as any).plugCategoryHash = null;
  const {option} = candidate(f);
  equal(option.plugCategoryHash, null, 'plugCategoryHash');
  equal(option.installabilityVerified, false, 'installability');
});
test('Status assessment remains strictly read-only and uncertified', () => {
  const f = fixture(); (f.sockets[0].options[1] as any).liveInsertFailIndexes = [];
  const before = JSON.stringify(f);
  const {result} = candidate(f);
  equal(JSON.stringify(f), before, 'no input mutation');
  equal(result.readOnly, true, 'read-only');
  equal(result.installabilityVerified, false, 'certification');
});
console.log(`PASS — ${count} Armor 3.0 insertion-evidence assertions. No network, no writes.`);
