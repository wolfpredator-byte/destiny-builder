/**
 * Engine-B0.5c3d2b — Offline socket-type whitelist compatibility tests.
 * Checks *category compatibility only*, never installability or a Bungie write.
 */
import { assessArmorModifierAvailability } from './src/lib/destiny-builder/armorModifierAvailability';
const GENERAL = 'enhancements.v2_general';
const SOCKET = 1718047805;
const SELECTED = 1999001;
const CANDIDATE = 1999002;
const CAT = 10101010;
const STAT = 392767087;
function equal(actual: unknown, expected: unknown, why: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${why}: expected ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`);
}
function assert(value: unknown, why: string): asserts value {
  if (!value) throw new Error(why);
}
function fixture(): any {
  return {
    schemaVersion: 1, source: 'bungie_item_detail_live_reusable_plus_manifest',
    readOnly: true, installabilityVerified: false,
    socketCountFromManifest: 2, socketCountFromLive: 2,
    itemEnergyEvidence: null,
    sockets: [{
      socketIndex: 0, socketTypeHash: SOCKET, plugSources: 1,
      reusablePlugSetHash: null, randomizedPlugSetHash: null,
      selectedPlugHash: SELECTED, liveSocketPresent: true,
      liveSocketEnabled: true, liveReusableDataPresent: true,
      options: [{
        plugHash: SELECTED, plugCategoryHash: CAT, name: 'Installed Mod',
        plugCategoryIdentifier: GENERAL, selected: true,
        plugDefinitionResolved: true,
        sources: ['selected', 'manifest_socket_items'], evidenceState: 'selected',
        liveCanInsert: null, liveEnabled: null,
        declaredInvestmentStats: [{ statHash: STAT, value: 5, isConditionallyActive: false }],
        declaredEnergyCost: { energyCost: 1, energyTypeHash: null },
      }, {
        plugHash: CANDIDATE, plugCategoryHash: CAT, name: 'Possible Mod',
        plugCategoryIdentifier: GENERAL, selected: false,
        plugDefinitionResolved: true,
        sources: ['live_item_reusable', 'manifest_socket_items'], evidenceState: 'live_can_insert',
        liveCanInsert: true, liveEnabled: true,
        declaredInvestmentStats: [{ statHash: STAT, value: 10, isConditionallyActive: false }],
        declaredEnergyCost: { energyCost: 3, energyTypeHash: null },
      }],
    }],
  };
}
function supply(f: any, categories: number[] | null, resolved = true, malformed = false) {
  f.sockets[0].socketTypeWhitelistEvidence = {
    source: 'bungie_manifest_socket_type_definition', socketTypeHash: SOCKET,
    definitionResolved: resolved, plugWhitelistCategoryHashes: categories, malformed,
  };
  return f;
}
function evalOption(f: any) {
  const r = assessArmorModifierAvailability(f);
  assert(r.validEvidence, `Rejected test fixture: ${r.reason}`);
  const s = r.sockets[0];
  const o = s.options.find(x => x.plugHash === CANDIDATE);
  assert(o, 'Candidate not found');
  return { r, s, o };
}
let count = 0;
function test(name: string, fn: () => void) {
  fn(); count++;
  console.log(`PASS ${String(count).padStart(2, '0')} ${name}`);
}

test('Legacy without whitelist is unknown, existing live signals unchanged', () => {
  const { s, o } = evalOption(fixture());
  equal(s.socketWhitelistEvidenceState, 'missing', 'evidence state');
  equal(o.socketWhitelistCheck, 'unknown', 'category check');
  equal(o.availability, 'live_candidate', 'availability');
});
test('Exact matching Manifest category is allowed at whitelist level only', () => {
  const {s,o} = evalOption(supply(fixture(), [CAT, 123]));
  equal(s.socketWhitelistEvidenceState, 'verified', 'status');
  equal(s.socketWhitelistCategoryHashes, [CAT,123], 'hashes');
  equal(o.socketWhitelistCheck,'allowed','match');
  equal(o.availability,'live_candidate','candidate stays candidate');
  equal(o.installabilityVerified,false,'not certified');
});
test('Explicit empty whitelist means category rule allows all', () => {
  const {s,o} = evalOption(supply(fixture(), []));
  equal(s.socketWhitelistEvidenceState,'verified','state');
  equal(s.socketWhitelistCategoryHashes,[],'distinguish empty');
  equal(o.socketWhitelistCheck,'allowed','allowed');
  equal(o.installabilityVerified,false,'not installable');
});
test('Missing whitelist property is NOT allow-all', () => {
  const f = supply(fixture(),null);
  const {s,o} = evalOption(f);
  equal(s.socketWhitelistEvidenceState,'missing','state');
  equal(o.socketWhitelistCheck,'unknown','check');
});
test('Unresolved definition cannot supply an affirmative whitelist', () => {
  const {s,o} = evalOption(supply(fixture(),null,false));
  equal(s.socketWhitelistEvidenceState,'missing','unresolved');
  equal(o.socketWhitelistCheck,'unknown','unknown');
});
test('Unresolved definition with categories is contradictory, hence invalid', () => {
  const {s,o} = evalOption(supply(fixture(),[CAT],false));
  equal(s.socketWhitelistEvidenceState,'invalid','invalid');
  equal(o.socketWhitelistCheck,'unknown','unknown');
});
test('Explicit nonmatch downgrades contradictory live candidate to unknown, not live_blocked', () => {
  const {r,o} = evalOption(supply(fixture(),[1234567]));
  equal(o.socketWhitelistCheck,'excluded','excluded');
  equal(o.availability,'unknown','downgrade');
  equal(r.summary.live_candidate,0,'summary corrected');
  equal(r.summary.unknown,1,'summary corrected');
});
test('Manifest-only excluded candidate stays catalog only', () => {
  const f = supply(fixture(),[1234567]);
  const opt = f.sockets[0].options[1];
  opt.sources=['manifest_socket_items']; opt.evidenceState='manifest_only';
  opt.liveCanInsert=null; opt.liveEnabled=null;
  const {o} = evalOption(f);
  equal(o.socketWhitelistCheck,'excluded','excluded');
  equal(o.availability,'manifest_candidate','catalog-only');
});
test('Selected plug stays installed even when whitelist conflicts with its category', () => {
  const {s} = evalOption(supply(fixture(),[1234567]));
  const old = s.options.find(x=>x.plugHash===SELECTED)!;
  equal(old.socketWhitelistCheck,'excluded','mismatch');
  equal(old.availability,'installed','observed installed');
  equal(old.installabilityVerified,false,'no retroactive permission');
});
test('Explicit Bungie live block persists independently from allowed whitelist', () => {
  const f=supply(fixture(),[CAT]);
  const o = f.sockets[0].options[1];
  o.liveCanInsert=false; o.evidenceState='live_cannot_insert';
  equal(evalOption(f).o.availability,'live_blocked','live block');
});
test('Missing plug category hash with nonempty whitelist remains unknown', () => {
  const f=supply(fixture(),[CAT]);f.sockets[0].options[1].plugCategoryHash=null;
  const {o}=evalOption(f);
  equal(o.socketWhitelistCheck,'unknown','unknown');
  equal(o.availability,'live_candidate','legacy live signal unchanged, still unverified');
});
test('Explicit empty whitelist permits category rule even without plug category hash', () => {
  const f=supply(fixture(),[]);f.sockets[0].options[1].plugCategoryHash=null;
  const {o}=evalOption(f);
  equal(o.socketWhitelistCheck,'allowed','empty list permits all');
  equal(o.installabilityVerified,false,'no certification');
});
test('Wrong socket type hash is invalid evidence, cannot permit', () => {
  const f=supply(fixture(),[CAT]);f.sockets[0].socketTypeWhitelistEvidence.socketTypeHash=SOCKET+1;
  const {s,o}=evalOption(f);
  equal(s.socketWhitelistEvidenceState,'invalid','mismatched');
  equal(o.socketWhitelistCheck,'unknown','no fake match');
});
test('Wrong source is invalid evidence', () => {
  const f=supply(fixture(),[CAT]);f.sockets[0].socketTypeWhitelistEvidence.source='caller_claimed';
  equal(evalOption(f).o.socketWhitelistCheck,'unknown','no fake match');
});
for(const [label,bad] of [
  ['duplicate',[CAT,CAT]], ['negative',[-1]], ['fraction',[1.5]],
  ['string',['10101010']], ['oversized',[0x100000000]], ['not-array','bad'],
] as const) {
  test(`Malformed ${label} whitelist cannot produce a positive`, () => {
    const f=supply(fixture(),[]);f.sockets[0].socketTypeWhitelistEvidence.plugWhitelistCategoryHashes=bad;
    const {s,o}=evalOption(f);
    equal(s.socketWhitelistEvidenceState,'invalid','invalid state');
    equal(o.socketWhitelistCheck,'unknown','unknown category');
  });
}
test('Manifest redaction marker produces unknown', () => {
  const {s,o}=evalOption(supply(fixture(),[CAT],true,true));
  equal(s.socketWhitelistEvidenceState,'invalid','invalid');
  equal(o.socketWhitelistCheck,'unknown','unknown');
});
test('Source evidence and readonly invariants preserved', () => {
  const f=supply(fixture(),[CAT]);const before=JSON.stringify(f);
  const {r,s}=evalOption(f);
  equal(JSON.stringify(f),before,'no mutations');
  equal(r.readOnly,true,'read only');
  equal(r.installabilityVerified,false,'not certified');
  equal(s.socketWhitelistCategoryHashes,[CAT],'evidence returned');
});
console.log(`PASS — ${count} whitelist checks. No network, no Bungie/OpenAI writes.`);
