/**
 * Destiny Builder — Engine-B0.5b6 Patch 02 (OFFLINE / READ ONLY).
 * Synthetic B0.5b5-shaped evidence, NOT a recording of private Bungie data.
 * Exercises conservative joining of shared Profile/Character PlugSets to
 * B0.5b1 item socket candidates. Does not certify a legal installation.
 * Run from repository root:
 *   npx tsx test-armor-shared-plugset-availability.ts
 */
import { assessArmorModifierAvailability } from './src/lib/destiny-builder/armorModifierAvailability';

const GENERAL = 'enhancements.v2_general';
const TUNING = 'core.gear_systems.armor_tiering.plugs.tuning.mods';
const GENERAL_TYPE = 1718047805;
const TUNING_TYPE = 2581339086;
const STATS = {
  Weapons: 2996146975, Health: 392767087, Class: 1943323491,
  Grenade: 1735777505, Super: 144602215, Melee: 4244567218,
};
const PROFILE_SET = 990001;
const TUNING_SET = 990002;
const SELECTED_STAT = 112001;
const HEALTH_MOD = 112002;
const GRENADE_MOD = 112003;
const CHARACTER_MOD = 112004;
const EMPTY_GENERAL = 1980618587;
const EMPTY_TUNING = 2121121504;
const BALANCED_TUNING = 3122197216;
const NEGATIVE_TUNING = 112005;

const assertEqual = (actual: unknown, expected: unknown, label = 'value'): void => {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const assertDeepEqual = (actual: unknown, expected: unknown, label = 'value'): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const assertContains = (haystack: string, needle: string): void => {
  if (!haystack.includes(needle)) throw new Error(`Missing ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const investment = (statHash: number, value: number, conditional = false) =>
  ({ statHash, value, isConditionallyActive: conditional });
const balanced = Object.values(STATS).map(statHash => investment(statHash, 1, true));

const option = (plugHash: number, category: string, effects: unknown[], selected = false,
  liveStatus: 'none' | 'positive' | 'blocked' = 'none') => ({
  plugHash, name: `Fixture ${plugHash}`, plugCategoryIdentifier: category,
  plugDefinitionResolved: true, declaredInvestmentStats: effects,
  selected, evidenceState: selected ? 'selected' : liveStatus === 'positive' ? 'live_can_insert'
    : liveStatus === 'blocked' ? 'live_cannot_insert' : 'manifest_only',
  sources: selected ? ['selected', 'manifest_reusable_set']
    : liveStatus === 'none' ? ['manifest_reusable_set'] : ['manifest_reusable_set', 'live_item_reusable'],
  liveCanInsert: liveStatus === 'positive' ? true : liveStatus === 'blocked' ? false : null,
  liveEnabled: liveStatus !== 'none' ? true : null,
  declaredEnergyCost: { energyCost: 5, energyTypeHash: 4069572561 },
});

// JSON-shaped as emitted by B0.5b1 / B0.5b5; intentionally no Guardian IDs.
const itemEvidence = (): any => ({
  schemaVersion: 1, source: 'bungie_item_detail_live_reusable_plus_manifest',
  readOnly: true, installabilityVerified: false,
  socketCountFromManifest: 15, socketCountFromLive: 15,
  itemEnergyEvidence: { energyCapacity: 3, energyUsed: 2, energyTypeHash: 4069572561 },
  sockets: [
    {
      socketIndex: 0, socketTypeHash: GENERAL_TYPE, plugSources: 13,
      reusablePlugSetHash: PROFILE_SET, randomizedPlugSetHash: null,
      selectedPlugHash: SELECTED_STAT, liveSocketPresent: true, liveSocketEnabled: true,
      liveReusableDataPresent: false,
      options: [
        option(SELECTED_STAT, GENERAL, [investment(STATS.Super, 10)], true),
        option(HEALTH_MOD, GENERAL, [investment(STATS.Health, 10)]),
        option(GRENADE_MOD, GENERAL, [investment(STATS.Grenade, 5)]),
        option(CHARACTER_MOD, GENERAL, [investment(STATS.Weapons, 5)]),
        option(EMPTY_GENERAL, GENERAL, []),
      ],
    },
    {
      socketIndex: 14, socketTypeHash: TUNING_TYPE, plugSources: 7,
      reusablePlugSetHash: TUNING_SET, randomizedPlugSetHash: null,
      selectedPlugHash: EMPTY_TUNING, liveSocketPresent: true, liveSocketEnabled: true,
      liveReusableDataPresent: true,
      options: [
        option(EMPTY_TUNING, TUNING, [], true),
        option(BALANCED_TUNING, TUNING, balanced, false, 'positive'),
        option(NEGATIVE_TUNING, TUNING, [investment(STATS.Super, 5), investment(STATS.Health, -5)]),
      ],
    },
  ],
});
const signal = (plugHash: number, canInsert: boolean | null, enabled: boolean | null) =>
  ({ plugHash, canInsert, enabled });
const sharedEvidence = (): any => ({
  schemaVersion: 1, source: 'bungie_profile_item_sockets_shared_plug_sets',
  readOnly: true, scopedToRequestedGuardian: true, installabilityVerified: false,
  profileComponentPresent: true, characterComponentPresent: true,
  sets: [
    {
      setHash: PROFILE_SET, profileSetPresent: true, characterSetPresent: true,
      // 4 profile + 9 character: 13 DISTINCT shared options for the stat socket.
      profilePlugs: [
        signal(HEALTH_MOD, true, true), signal(GRENADE_MOD, true, true),
        signal(EMPTY_GENERAL, true, true), signal(SELECTED_STAT, true, true),
      ],
      characterPlugs: [
        signal(CHARACTER_MOD, true, true),
        ...Array.from({ length: 8 }, (_unused, i) => signal(112100 + i, true, true)),
      ],
    },
    {
      setHash: TUNING_SET, profileSetPresent: true, characterSetPresent: false,
      profilePlugs: [signal(BALANCED_TUNING, true, true)], characterPlugs: [],
    },
  ],
});
const assess = (item: unknown = itemEvidence(), shared?: unknown) =>
  assessArmorModifierAvailability(item, shared);
const get = (result: ReturnType<typeof assess>, plugHash: number) => {
  const hit = result.sockets.flatMap(s => s.options).find(o => o.plugHash === plugHash);
  if (!hit) throw new Error(`Fixture option ${plugHash} missing`);
  return hit;
};
let count = 0;
const test = (title: string, fn: () => void): void => {
  try { fn(); count += 1; console.log(`PASS ${String(count).padStart(2, '0')} ${title}`); }
  catch (error) { console.error(`FAIL ${title}`); throw error; }
};

// Compatibility with original one-argument B0.5b2 API.
test('Legacy single-argument API remains valid', () => assertEqual(assess().validEvidence, true));
test('No shared argument reports not_provided', () => assertEqual(assess().sharedEvidenceState, 'not_provided'));
test('Manifest-only option stays catalog-only without shared evidence', () =>
  assertEqual(get(assess(), HEALTH_MOD).availability, 'manifest_candidate'));
test('Existing per-item tuning live candidate remains live', () =>
  assertEqual(get(assess(), BALANCED_TUNING).availability, 'live_candidate'));

// Joined evidence is advisory; these are not certified plug insertions.
test('Correctly shaped shared response is accepted', () => assertEqual(assess(itemEvidence(), sharedEvidence()).sharedEvidenceState, 'valid'));
test('Positive ProfilePlugSet promotes exact Manifest candidate to live_candidate', () =>
  assertEqual(get(assess(itemEvidence(), sharedEvidence()), HEALTH_MOD).availability, 'live_candidate'));
test('Positive CharacterPlugSet promotes exact Manifest candidate to live_candidate', () =>
  assertEqual(get(assess(itemEvidence(), sharedEvidence()), CHARACTER_MOD).availability, 'live_candidate'));
test('Shared Profile source identified in option', () =>
  assertDeepEqual(get(assess(itemEvidence(), sharedEvidence()), HEALTH_MOD).sharedSignal.sources, ['profile_plug_set']));
test('Shared Character source identified in option', () =>
  assertDeepEqual(get(assess(itemEvidence(), sharedEvidence()), CHARACTER_MOD).sharedSignal.sources, ['character_plug_set']));
test('Joined set hash is the exact referenced definition hash', () =>
  assertDeepEqual(get(assess(itemEvidence(), sharedEvidence()), HEALTH_MOD).sharedSignal.setHashes, [PROFILE_SET]));
test('Stat socket resolves one referenced/matched set', () => {
  const s = assess(itemEvidence(), sharedEvidence()).sockets[0];
  assertEqual(s.sharedReferencedSetCount, 1); assertEqual(s.sharedMatchedSetCount, 1);
});
test('All thirteen shared stat options never manufacture new item candidates', () => {
  const r = assess(itemEvidence(), sharedEvidence());
  assertEqual(sharedEvidence().sets[0].profilePlugs.length + sharedEvidence().sets[0].characterPlugs.length, 13);
  assertEqual(r.sockets[0].options.length, 5);
});
test('Read-only and installability=false hold at assessment and option levels', () => {
  const r = assess(itemEvidence(), sharedEvidence());
  assertEqual(r.readOnly, true); assertEqual(r.installabilityVerified, false);
  for (const s of r.sockets) for (const o of s.options) assertEqual(o.installabilityVerified, false);
});
test('Inadequate declared energy budget is not silently approved', () => {
  const r = assess(itemEvidence(), sharedEvidence());
  assertEqual(r.energyEvidence?.energyCapacity, 3);
  assertEqual(get(r, HEALTH_MOD).declaredEnergyCost?.energyCost, 5);
  assertEqual(get(r, HEALTH_MOD).installabilityVerified, false);
});
test('Known empty stat socket plug omits math effects', () => {
  const opt = get(assess(itemEvidence(), sharedEvidence()), EMPTY_GENERAL);
  assertEqual(opt.availability, 'live_candidate');
  assertEqual(opt.effectKind, 'empty_socket');
  assertEqual(opt.simulationMode, 'omit_empty');
  assertEqual(opt.simulatorModifier, null);
});
test('Signed tuning remains mathematically modeled, not installable', () => {
  const opt = get(assess(itemEvidence(), sharedEvidence()), NEGATIVE_TUNING);
  assertEqual(opt.availability, 'manifest_candidate');
  assertEqual(opt.effectKind, 'direct');
  assertDeepEqual(opt.simulatorModifier?.contributions.map(c => c.value), [5, -5]);
  assertEqual(opt.installabilityVerified, false);
});
test('Balanced Tuning conditional math supported without certification', () => {
  const opt = get(assess(itemEvidence(), sharedEvidence()), BALANCED_TUNING);
  assertEqual(opt.effectKind, 'balanced_lowest_three');
  assertEqual(opt.simulatorModifier?.rule, 'balanced_lowest_three');
  assertEqual(opt.installabilityVerified, false);
});

// Missing/mismatched context must not grant shared live availability.
test('Unreferenced PlugSet does not promote any option', () => {
  const s = sharedEvidence(); s.sets[0].setHash = 444444;
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'manifest_candidate');
});
test('Manifest-only socket source bits exclude Profile/Character signal', () => {
  const i = itemEvidence(); i.sockets[0].plugSources = 1;
  assertEqual(get(assess(i, sharedEvidence()), HEALTH_MOD).availability, 'manifest_candidate');
});
test('Mismatched socket type hash never upgrades an option', () => {
  const i = itemEvidence(); i.sockets[0].socketTypeHash = TUNING_TYPE;
  assertEqual(get(assess(i, sharedEvidence()), HEALTH_MOD).availability, 'manifest_candidate');
});
test('Missing socket type hash never upgrades an option', () => {
  const i = itemEvidence(); i.sockets[0].socketTypeHash = null;
  assertEqual(get(assess(i, sharedEvidence()), HEALTH_MOD).availability, 'manifest_candidate');
});
test('Disabled live socket explicitly blocks shared alternatives', () => {
  const i = itemEvidence(); i.sockets[0].liveSocketEnabled = false;
  assertEqual(get(assess(i, sharedEvidence()), HEALTH_MOD).availability, 'live_blocked');
});
test('No live socket cannot become shared live_candidate', () => {
  const i = itemEvidence(); i.sockets[0].liveSocketPresent = false;
  assertEqual(get(assess(i, sharedEvidence()), HEALTH_MOD).availability, 'unknown');
});
test('Unconfirmed live socket enabled state blocks promotion', () => {
  const i = itemEvidence(); i.sockets[0].liveSocketEnabled = null;
  assertEqual(get(assess(i, sharedEvidence()), HEALTH_MOD).availability, 'manifest_candidate');
});
test('Shared canInsert=false reports live_blocked, not an installable option', () => {
  const s = sharedEvidence(); s.sets[0].profilePlugs[0].canInsert = false;
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'live_blocked');
});
test('Shared enabled=false reports live_blocked', () => {
  const s = sharedEvidence(); s.sets[0].profilePlugs[0].enabled = false;
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'live_blocked');
});
test('Missing canInsert evidence remains unknown, not positive', () => {
  const s = sharedEvidence(); s.sets[0].profilePlugs[0].canInsert = null;
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'unknown');
});
test('Missing enabled evidence remains unknown, not positive', () => {
  const s = sharedEvidence(); s.sets[0].profilePlugs[0].enabled = null;
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'unknown');
});
test('Missing entire Profile component never inferred as empty availability', () => {
  const s = sharedEvidence(); s.profileComponentPresent = false;
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'unknown');
});
test('Missing entire Character component never inferred as positive', () => {
  const s = sharedEvidence(); s.characterComponentPresent = false;
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'unknown');
});
test('Missing Character set within referenced scope remains incomplete', () => {
  const s = sharedEvidence(); s.sets[0].characterSetPresent = false;
  s.sets[0].characterPlugs = [];
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'unknown');
});
test('Conflicting shared signals result in unknown', () => {
  const s = sharedEvidence(); s.sets[0].characterPlugs.push(signal(HEALTH_MOD, false, true));
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).sharedSignal.state, 'conflict');
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'unknown');
});
test('Conflicting duplicates in one set do not get silently resolved', () => {
  const s = sharedEvidence(); s.sets[0].profilePlugs.push(signal(HEALTH_MOD, false, true));
  assertEqual(get(assess(itemEvidence(), s), HEALTH_MOD).availability, 'unknown');
});
test('Per-item positive versus shared negative is unknown, not blocked or live', () => {
  const i = itemEvidence(); i.sockets[0].liveReusableDataPresent = true;
  const o = i.sockets[0].options[1];
  o.sources.push('live_item_reusable'); o.evidenceState = 'live_can_insert'; o.liveCanInsert = true; o.liveEnabled = true;
  const s = sharedEvidence(); s.sets[0].profilePlugs[0].canInsert = false;
  assertEqual(get(assess(i, s), HEALTH_MOD).availability, 'unknown');
});
test('Per-item negative versus shared positive is unknown, not blocked or live', () => {
  const i = itemEvidence(); i.sockets[0].liveReusableDataPresent = true;
  const o = i.sockets[0].options[1];
  o.sources.push('live_item_reusable'); o.evidenceState = 'live_cannot_insert'; o.liveCanInsert = false; o.liveEnabled = true;
  assertEqual(get(assess(i, sharedEvidence()), HEALTH_MOD).availability, 'unknown');
});
test('Selected plug remains installed (does not imply reinsertable)', () => {
  const opt = get(assess(itemEvidence(), sharedEvidence()), SELECTED_STAT);
  assertEqual(opt.availability, 'installed'); assertEqual(opt.installabilityVerified, false);
});
test('Inconsistent selected state cannot be upgraded by shared signals', () => {
  const i = itemEvidence(); i.sockets[0].options[0].selected = false;
  assertEqual(get(assess(i, sharedEvidence()), SELECTED_STAT).availability, 'unknown');
});

// Fail closed on invalid shared wrapper; never conflate unknown with denied/owned.
test('Invalid schema is detected and ignored', () => {
  const s = sharedEvidence(); s.schemaVersion = 2;
  const r = assess(itemEvidence(), s);
  assertEqual(r.sharedEvidenceState, 'invalid');
  assertEqual(get(r, HEALTH_MOD).availability, 'manifest_candidate');
});
test('A missing requested-Guardian scope is rejected', () => {
  const s = sharedEvidence(); s.scopedToRequestedGuardian = false;
  assertEqual(assess(itemEvidence(), s).sharedEvidenceState, 'invalid');
});
test('Malformed shared plug boolean rejected', () => {
  const s = sharedEvidence(); s.sets[0].profilePlugs[0].canInsert = 'true';
  assertEqual(assess(itemEvidence(), s).sharedEvidenceState, 'invalid');
});
test('Duplicate set hashes invalidate shared evidence', () => {
  const s = sharedEvidence(); s.sets.push(clone(s.sets[0]));
  assertEqual(assess(itemEvidence(), s).sharedEvidenceState, 'invalid');
});
test('Invalid shared input does not invalidate otherwise valid item evidence', () => {
  const s = sharedEvidence(); s.source = 'untrusted_custom_source';
  const r = assess(itemEvidence(), s);
  assertEqual(r.validEvidence, true); assertEqual(r.sharedEvidenceState, 'invalid');
});
test('Input item and shared evidence are never mutated', () => {
  const i = itemEvidence(); const s = sharedEvidence(); const before = JSON.stringify([i, s]);
  assess(i, s); assertEqual(JSON.stringify([i, s]), before);
});
test('No private user/item identifiers enter the returned assessment', () => {
  const i = itemEvidence(); const s = sharedEvidence();
  // These are deliberately synthetic. They must never leak into the model result.
  i.characterId = 'PRIVATE_CHARACTER_SENTINEL';
  i.itemInstanceId = 'PRIVATE_ITEM_SENTINEL';
  s.requestedCharacterId = 'PRIVATE_REQUESTED_SENTINEL';
  const out = JSON.stringify(assess(i, s));
  for (const sentinel of ['PRIVATE_CHARACTER_SENTINEL', 'PRIVATE_ITEM_SENTINEL', 'PRIVATE_REQUESTED_SENTINEL'])
    if (out.includes(sentinel)) throw new Error('Private data was leaked: ' + sentinel);
});
test('Assessment explicitly warns about requested Guardian versus armor ownership', () => {
  const r = assess(itemEvidence(), sharedEvidence());
  assertContains(r.sharedEvidenceReason, 'requested Guardian');
  assertContains(get(r, HEALTH_MOD).reasons.join(' '), 'owner');
});
test('Shared positives update candidate summary without granting certification', () => {
  const r = assess(itemEvidence(), sharedEvidence());
  assertEqual(r.summary.live_candidate, 5);
  assertEqual(r.installabilityVerified, false);
});

console.log(`\nPASS — ${count} shared PlugSet test cases. No skips, network calls or Bungie/OpenAI writes.`);
