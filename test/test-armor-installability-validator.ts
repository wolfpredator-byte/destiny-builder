/**
 * Destiny Builder — Engine-B0.5c2: assertion-based installability preflight tests.
 * READ ONLY. No Bungie/OpenAI calls or writes.
 * Engine-B0.5c3a adds provenance cross-checks without claiming installability.
 *
 * Deliberate regression tests: some MUST fail against the initial B0.5c1
 * validator until defects are corrected in a separate, reviewed source patch.
 */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateArmorInstallability } from '../src/lib/destiny-builder/armorInstallabilityValidator';
import type { ModifierAvailabilityAssessment, Availability } from '../src/lib/destiny-builder/armorModifierAvailability';

type Input = Parameters<typeof validateArmorInstallability>[0];
type Check = { passed: boolean; blocked: boolean; unknown: boolean };
const NEW = 1111111111;
const OLD = 2222222222;
const ENERGY_TYPE = 1234567890;

function assessment(status: Availability = 'live_candidate', selectedPlugHash: number | null = OLD): ModifierAvailabilityAssessment {
  const counts: ModifierAvailabilityAssessment['summary'] = {
    installed: 0, live_candidate: 0, live_blocked: 0, manifest_candidate: 0, unknown: 0,
  };
  counts[status]++;
  return {
    schemaVersion: 1,
    validEvidence: true,
    readOnly: true,
    installabilityVerified: false,
    reason: 'Synthetic deterministic test fixture',
    sharedEvidenceState: 'not_provided',
    sharedEvidenceReason: 'Not supplied',
    sockets: [{
      socketIndex: 0,
      category: 'enhancements.v2_general',
      selectedPlugHash,
      liveSocketEnabled: true,
      liveSocketPresent: true,
      liveReusableDataPresent: true,
      sharedReferencedSetCount: 0,
      sharedMatchedSetCount: 0,
      sharedComponentIncomplete: false,
      socketWhitelistEvidenceState: 'missing',
      socketWhitelistCategoryHashes: null,
      options: [{
        socketIndex: 0,
        plugHash: NEW,
        name: 'Test Mod',
        category: 'enhancements.v2_general',
        availability: status,
        effectKind: 'direct',
        simulationMode: 'modifier',
        simulatorModifier: null,
        selected: status === 'installed',
        liveCanInsert: status === 'live_candidate' ? true : status === 'live_blocked' ? false : null,
        liveEnabled: status === 'live_candidate' ? true : status === 'live_blocked' ? false : null,
        socketWhitelistCheck: 'unknown',
        evidenceSources: ['manifest_socket_items'],
        sharedSignal: { state: 'none', setHashes: [], sources: [] },
        declaredEnergyCost: { energyCost: 3, energyTypeHash: ENERGY_TYPE },
        reasons: [],
        installabilityVerified: false,
      }, ...(selectedPlugHash !== null && selectedPlugHash !== NEW ? [{
        socketIndex: 0, plugHash: selectedPlugHash, name: 'Installed Mod',
        category: 'enhancements.v2_general' as const,
        availability: 'installed' as const,
        effectKind: 'direct' as const,
        simulationMode: 'modifier' as const,
        simulatorModifier: null,
        selected: true,
        liveCanInsert: null, liveEnabled: null,
        socketWhitelistCheck: 'unknown' as const,
        evidenceSources: ['selected'],
        sharedSignal: { state: 'none' as const, setHashes: [] as number[], sources: [] as [] },
        declaredEnergyCost: { energyCost: 2, energyTypeHash: ENERGY_TYPE },
        reasons: [], installabilityVerified: false as const,
      }] : [])],
      note: 'Test socket',
    }],
    energyEvidence: { energyCapacity: 10, energyUsed: 5, energyTypeHash: ENERGY_TYPE },
    summary: counts,
  };
}


/** Keep synthetic declarations in sync in tests that intentionally change costs or energy. */
function matchingAssessment(params: { capacity?: number; used?: number; oldCost?: number; newCost?: number; selectedPlugHash?: number | null } = {}): ModifierAvailabilityAssessment {
  const a = assessment('live_candidate', params.selectedPlugHash === undefined ? OLD : params.selectedPlugHash);
  a.energyEvidence = { energyCapacity: params.capacity ?? 10, energyUsed: params.used ?? 5, energyTypeHash: ENERGY_TYPE };
  for (const option of a.sockets[0].options) {
    if (option.plugHash === NEW) option.declaredEnergyCost = { energyCost: params.newCost ?? 3, energyTypeHash: ENERGY_TYPE };
    if (option.plugHash === OLD) option.declaredEnergyCost = { energyCost: params.oldCost ?? 2, energyTypeHash: ENERGY_TYPE };
  }
  return a;
}

function input(): Input {
  return {
    itemInstance: {
      requestedGuardianId: 'char-123',
      ownerCharacterId: 'char-123',
      location: 'inventory',
      masterworkTier: 5,
      masterworkEnergyTypeHash: ENERGY_TYPE,
    },
    currentEnergy: { energyCapacity: 10, energyUsed: 5, energyTypeHash: ENERGY_TYPE },
    proposedSwap: { socketIndex: 0, newPlugHash: NEW, oldPlugHash: OLD },
    availabilityAssessment: assessment(),
    oldPlugCost: 2,
    newPlugCost: 3,
    newPlugEnergyType: ENERGY_TYPE,
  };
}

function result(patch: Partial<Input> = {}) {
  return validateArmorInstallability({ ...input(), ...patch });
}
function state(check: Check, expected: 'passed' | 'blocked' | 'unknown') {
  assert.equal(check.passed, expected === 'passed', `passed flag for ${expected}`);
  assert.equal(check.blocked, expected === 'blocked', `blocked flag for ${expected}`);
  assert.equal(check.unknown, expected === 'unknown', `unknown flag for ${expected}`);
}

// Tests 1–26: originally printed expected output but never asserted results.
test('01 — sufficient energy: 5 - 2 + 3 = 6; remaining 4', () => {
  const r = result();
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 6);
  assert.equal(r.energyBalance.energyRemaining, 4);
});
test('02 — insufficient energy is blocked', () => {
  const r = result({ currentEnergy: { energyCapacity: 10, energyUsed: 8, energyTypeHash: ENERGY_TYPE }, oldPlugCost: 1, newPlugCost: 4, availabilityAssessment: matchingAssessment({ used: 8, oldCost: 1, newCost: 4 }) });
  state(r.energyBalance, 'blocked');
  assert.equal(r.energyBalance.overflow, true);
});
test('03 — missing old plug cost stays unknown', () => {
  const r = result({ oldPlugCost: null });
  state(r.energyBalance, 'unknown');
  assert.match(r.energyBalance.reason, /old plug cost/i);
});
test('04 — missing new plug cost stays unknown', () => {
  const r = result({ newPlugCost: null });
  state(r.energyBalance, 'unknown');
  assert.match(r.energyBalance.reason, /new plug cost/i);
});
test('05 — wrong old plug does not calculate energy', () => {
  const base = input();
  const r = result({ proposedSwap: { ...base.proposedSwap, oldPlugHash: 3333333333 } });
  state(r.energyBalance, 'unknown');
  assert.match(r.energyBalance.reason, /does not match/i);
});
test('06 — missing current energy is unknown', () => {
  const r = result({ currentEnergy: { energyCapacity: null, energyUsed: 5, energyTypeHash: ENERGY_TYPE } });
  state(r.energyBalance, 'unknown');
});
test('07 — used > capacity is inconsistent, not validated', () => {
  const r = result({ currentEnergy: { energyCapacity: 5, energyUsed: 10, energyTypeHash: ENERGY_TYPE } });
  state(r.energyBalance, 'unknown');
});
test('08 — energy released by a replacement is counted correctly', () => {
  const r = result({ currentEnergy: { energyCapacity: 10, energyUsed: 8, energyTypeHash: ENERGY_TYPE }, oldPlugCost: 5, newPlugCost: 2, availabilityAssessment: matchingAssessment({ used: 8, oldCost: 5, newCost: 2 }) });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 5);
  assert.equal(r.energyBalance.energyRemaining, 5);
});
test('09 — live candidate is only an availability candidate', () => {
  const r = result();
  state(r.availabilityCheck, 'passed');
  assert.equal(r.installabilityVerified, false);
  assert.equal(r.overallInstallable, false);
});
test('10 — manifest-only must be unknown (not empty tri-state)', () => {
  const r = result({ availabilityAssessment: assessment('manifest_candidate') });
  state(r.availabilityCheck, 'unknown');
});
test('11 — explicit live block is blocked', () => {
  const r = result({ availabilityAssessment: assessment('live_blocked') });
  state(r.availabilityCheck, 'blocked');
});
test('12 — already installed does not pass swap/reinstallability', () => {
  const r = result({
    availabilityAssessment: assessment('installed', NEW),
    proposedSwap: { socketIndex: 0, newPlugHash: NEW, oldPlugHash: NEW },
  });
  assert.equal(r.availabilityCheck.passed, false);
  assert.equal(r.installabilityVerified, false);
  assert.equal(r.overallInstallable, false);
});
test('13 — current Guardian owner is recognized', () => {
  state(result().ownership, 'passed');
});
test('14 — other Guardian blocks immediate installation, not a future transfer', () => {
  const base = input();
  const r = result({ itemInstance: { ...base.itemInstance, ownerCharacterId: 'char-456' } });
  state(r.ownership, 'blocked');
});
test('15 — Vault item ownership is unknown', () => {
  const base = input();
  state(result({ itemInstance: { ...base.itemInstance, location: 'vault', ownerCharacterId: null } }).ownership, 'unknown');
});
test('16 — missing ownership remains unknown', () => {
  const base = input();
  state(result({ itemInstance: { ...base.itemInstance, location: 'unknown', ownerCharacterId: null } }).ownership, 'unknown');
});
test('17 — missing tier requirements stay unknown', () => {
  state(result().tierRequirements, 'unknown');
});
test('18 — missing unlock requirements stay unknown', () => {
  state(result().unlockRequirements, 'unknown');
});
test('19 — energy affinity legality remains unknown', () => {
  state(result().energyTypeCompatibility, 'unknown');
});
test('20 — unknown candidate gives unknown socket assessment', () => {
  state(result({ availabilityAssessment: assessment('unknown') }).socketRestrictions, 'unknown');
});
test('21 — source objects are never mutated', () => {
  const source = input();
  const original = JSON.stringify(source);
  validateArmorInstallability(source);
  assert.equal(JSON.stringify(source), original);
});
test('22 — result excludes private character identifiers', () => {
  const output = JSON.stringify(result());
  assert.equal(output.includes('char-123'), false);
  assert.equal(output.includes('char-456'), false);
  assert.equal(output.includes('ownerCharacterId'), false);
  assert.equal(output.includes('requestedGuardianId'), false);
});
test('23 — entire installation is never approved', () => {
  assert.equal(result().overallInstallable, false);
});
test('24 — certification remains false', () => {
  assert.equal(result().installabilityVerified, false);
});
test('25 — unsafe / out-of-bounds energy input is unknown (not a real arithmetic overflow test)', () => {
  const r = result({ currentEnergy: { energyCapacity: 10, energyUsed: Number.MAX_SAFE_INTEGER - 1, energyTypeHash: ENERGY_TYPE }, newPlugCost: 100 });
  state(r.energyBalance, 'unknown');
  assert.equal(r.energyBalance.newEnergyUsed, null);
});
test('26 — negative result from inconsistent source figures is unknown', () => {
  const r = result({ currentEnergy: { energyCapacity: 10, energyUsed: 2, energyTypeHash: ENERGY_TYPE }, oldPlugCost: 5, newPlugCost: 1 });
  state(r.energyBalance, 'unknown');
});

// Additional regression tests discovered while reviewing B0.5c1 sources.
test('27 — zero new energy cost is a valid integer, not missing data', () => {
  const r = result({ newPlugCost: 0, availabilityAssessment: matchingAssessment({ newCost: 0 }) });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 3);
});
test('28 — zero old energy cost is a valid integer', () => {
  const r = result({ oldPlugCost: 0, availabilityAssessment: matchingAssessment({ oldCost: 0 }) });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 8);
});
test('29 — old hash null cannot silently ignore an installed plug', () => {
  const base = input();
  const r = result({ proposedSwap: { ...base.proposedSwap, oldPlugHash: null }, oldPlugCost: null });
  state(r.energyBalance, 'unknown');
});
test('30 — Vault location is not ownership passed even with an inconsistent owner field', () => {
  const base = input();
  const r = result({ itemInstance: { ...base.itemInstance, location: 'vault' } });
  state(r.ownership, 'unknown');
});
test('31 — invalid availability evidence never becomes positive candidate', () => {
  const a = assessment();
  a.validEvidence = false;
  const r = result({ availabilityAssessment: a });
  assert.equal(r.availabilityCheck.passed, false);
  assert.equal(r.overallInstallable, false);
});
test('32 — evidence tri-states always have exactly one active status', () => {
  const r = result({ availabilityAssessment: assessment('manifest_candidate') });
  for (const check of [r.availabilityCheck, r.energyBalance, r.ownership, r.socketRestrictions, r.tierRequirements, r.unlockRequirements, r.energyTypeCompatibility]) {
    assert.equal([check.passed, check.blocked, check.unknown].filter(Boolean).length, 1);
  }
});
test('33 — observed 11-point energy capacity is not discarded by a hardcoded 10 ceiling', () => {
  const r = result({ currentEnergy: { energyCapacity: 11, energyUsed: 8, energyTypeHash: ENERGY_TYPE }, availabilityAssessment: matchingAssessment({ capacity: 11, used: 8 }) });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 9);
  assert.equal(r.energyBalance.energyRemaining, 2);
});
test('34 — absent old plug with explicit empty socket can be evaluated', () => {
  const base = input();
  const r = result({
    availabilityAssessment: matchingAssessment({ selectedPlugHash: null, newCost: 0 }),
    proposedSwap: { ...base.proposedSwap, oldPlugHash: null },
    oldPlugCost: null,
    newPlugCost: 0,
  });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 5);
});

// node:test exits non-zero when any assertion fails; successful printed values alone are NOT tests.


// Engine-B0.5c3a: additional evidence-consistency checks.
// These are expected to fail against the B0.5c2 validator before the separate fix.
test('35 — supplied new cost cannot override contradictory Manifest cost', () => {
  const r = result({ newPlugCost: 7 });
  state(r.energyBalance, 'unknown');
  assert.match(r.energyBalance.reason, /new.*cost|mismatch|evidence/i);
});
test('36 — supplied old cost cannot override selected plug cost', () => {
  const r = result({ oldPlugCost: 4 });
  state(r.energyBalance, 'unknown');
  assert.match(r.energyBalance.reason, /old.*cost|mismatch|evidence/i);
});
test('37 — selected old plug missing from evidence cannot be assumed known', () => {
  const a = assessment();
  a.sockets[0].options = a.sockets[0].options.filter(o => o.plugHash !== OLD);
  state(result({ availabilityAssessment: a }).energyBalance, 'unknown');
});
test('38 — new plug Manifest energy cost absent remains unknown', () => {
  const a = assessment();
  a.sockets[0].options.find(o => o.plugHash === NEW)!.declaredEnergyCost = null;
  state(result({ availabilityAssessment: a }).energyBalance, 'unknown');
});
test('39 — absent underlying instance energy cannot be replaced with caller values', () => {
  const a = assessment();
  a.energyEvidence = null;
  state(result({ availabilityAssessment: a }).energyBalance, 'unknown');
});
test('40 — current used energy disagrees with instance evidence', () => {
  const r = result({ currentEnergy: { energyCapacity: 10, energyUsed: 7, energyTypeHash: ENERGY_TYPE } });
  state(r.energyBalance, 'unknown');
});
test('41 — current capacity disagrees with instance evidence', () => {
  const r = result({ currentEnergy: { energyCapacity: 11, energyUsed: 5, energyTypeHash: ENERGY_TYPE } });
  state(r.energyBalance, 'unknown');
});
// B0.5c3c: legacy/optional energy type is never an Armor 3.0 arithmetic gate.
// A mismatch here cannot certify affinity but also cannot invalidate known
// capacity, used, and declared costs: those are checked independently.
test('42 — legacy energy type mismatch does not block a coherent arithmetic snapshot', () => {
  const r = result({ currentEnergy: { energyCapacity: 10, energyUsed: 5, energyTypeHash: 4321 } });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 6);
  state(r.energyTypeCompatibility, 'unknown');
  assert.equal(r.installabilityVerified, false);
});
test('43 — optional missing instance energy type does not block energy arithmetic', () => {
  const a = assessment();
  a.energyEvidence = { energyCapacity: 10, energyUsed: 5, energyTypeHash: null };
  const r = result({ availabilityAssessment: a });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 6);
  state(r.energyTypeCompatibility, 'unknown');
});
test('44 — unknown item location cannot pass ownership despite matching owner ID', () => {
  const base = input();
  state(result({ itemInstance: { ...base.itemInstance, location: 'unknown' } }).ownership, 'unknown');
});
test('45 — explicitly equipped by requested Guardian remains ownership passed', () => {
  const base = input();
  state(result({ itemInstance: { ...base.itemInstance, location: 'equipped' } }).ownership, 'passed');
});
test('46 — cross-Guardian inventory remains blocked for immediate use', () => {
  const base = input();
  state(result({ itemInstance: { ...base.itemInstance, location: 'inventory', ownerCharacterId: 'char-other' } }).ownership, 'blocked');
});
test('47 — installed old plug with unknown declared cost cannot validate a swap', () => {
  const a = assessment();
  a.sockets[0].options.find(o => o.plugHash === OLD)!.declaredEnergyCost = { energyCost: null, energyTypeHash: ENERGY_TYPE };
  state(result({ availabilityAssessment: a }).energyBalance, 'unknown');
});
test('48 — evidence completeness is not certified installability', () => {
  const r = result();
  state(r.energyBalance, 'passed');
  assert.equal(r.overallInstallable, false);
  assert.equal(r.installabilityVerified, false);
});

// B0.5c3c — Energy Semantics Guard: math is independent of legacy affinity.
test('49 — missing caller energy type does not block matching numeric snapshot', () => {
  const r = result({ currentEnergy: { energyCapacity: 10, energyUsed: 5, energyTypeHash: null } });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.energyRemaining, 4);
  state(r.energyTypeCompatibility, 'unknown');
});
test('50 — missing both energy types preserves verified numeric arithmetic only', () => {
  const a = assessment();
  a.energyEvidence = { energyCapacity: 10, energyUsed: 5, energyTypeHash: null };
  const r = result({
    availabilityAssessment: a,
    currentEnergy: { energyCapacity: 10, energyUsed: 5, energyTypeHash: null },
  });
  state(r.energyBalance, 'passed');
  assert.equal(r.energyBalance.newEnergyUsed, 6);
  assert.equal(r.overallInstallable, false);
});
test('51 — unlike energy type hashes, capacity mismatch still blocks math validation', () => {
  const a = assessment();
  a.energyEvidence = { energyCapacity: 11, energyUsed: 5, energyTypeHash: null };
  const r = result({ availabilityAssessment: a });
  state(r.energyBalance, 'unknown');
});
test('52 — unlike energy type hashes, used mismatch still blocks math validation', () => {
  const a = assessment();
  a.energyEvidence = { energyCapacity: 10, energyUsed: 6, energyTypeHash: null };
  const r = result({ availabilityAssessment: a });
  state(r.energyBalance, 'unknown');
});
test('53 — unlike energy type hashes, declared plug cost mismatch still blocks math', () => {
  const a = assessment();
  a.energyEvidence = { energyCapacity: 10, energyUsed: 5, energyTypeHash: null };
  a.sockets[0].options.find(o => o.plugHash === NEW)!.declaredEnergyCost!.energyCost = 7;
  const r = result({ availabilityAssessment: a });
  state(r.energyBalance, 'unknown');
});
test('54 — different plug declared energy type hash cannot imply an affinity block', () => {
  const a = assessment();
  a.sockets[0].options.find(o => o.plugHash === NEW)!.declaredEnergyCost!.energyTypeHash = 987654321;
  const r = result({ availabilityAssessment: a });
  state(r.energyBalance, 'passed');
  state(r.energyTypeCompatibility, 'unknown');
});
test('55 — missing plug declared energy type hash does not erase a known cost', () => {
  const a = assessment();
  a.sockets[0].options.find(o => o.plugHash === NEW)!.declaredEnergyCost!.energyTypeHash = null;
  const r = result({ availabilityAssessment: a, newPlugEnergyType: null });
  state(r.energyBalance, 'passed');
  state(r.energyTypeCompatibility, 'unknown');
});
test('56 — no energy type evidence still blocks an objectively overbudget calculation', () => {
  const a = matchingAssessment({ used: 9, oldCost: 1, newCost: 3 });
  a.energyEvidence!.energyTypeHash = null;
  const r = result({
    currentEnergy: { energyCapacity: 10, energyUsed: 9, energyTypeHash: null },
    oldPlugCost: 1,
    newPlugCost: 3,
    availabilityAssessment: a,
  });
  state(r.energyBalance, 'blocked');
  assert.equal(r.energyBalance.overflow, true);
  assert.equal(r.energyBalance.newEnergyUsed, 11);
  assert.equal(r.overallInstallable, false);
});
test('57 — missing instance capacity is unknown despite both energy types present', () => {
  const a = assessment();
  a.energyEvidence = { energyCapacity: null, energyUsed: 5, energyTypeHash: ENERGY_TYPE };
  state(result({ availabilityAssessment: a }).energyBalance, 'unknown');
});
test('58 — numeric math passes but unknown socket/tier/unlock/affinity still forbid certification', () => {
  const a = assessment();
  a.energyEvidence = { energyCapacity: 10, energyUsed: 5, energyTypeHash: null };
  const r = result({ availabilityAssessment: a });
  state(r.energyBalance, 'passed');
  state(r.tierRequirements, 'unknown');
  state(r.unlockRequirements, 'unknown');
  state(r.energyTypeCompatibility, 'unknown');
  assert.equal(r.installabilityVerified, false);
  assert.equal(r.overallInstallable, false);
});

// Engine-B0.5c3e — ensure partial whitelist/live evidence cannot certify socket rules.
test('59 — live candidate without whitelist leaves socket rule gate unknown', () => {
  const r = result();
  state(r.availabilityCheck, 'passed'); // live signal only
  state(r.socketRestrictions, 'unknown');
  assert.match(r.socketRestrictions.reason, /without verified|remain unknown/i);
});
test('60 — even verified whitelist allow cannot pass unexamined insertion rules', () => {
  const a = assessment();
  a.sockets[0].socketWhitelistEvidenceState = 'verified';
  a.sockets[0].socketWhitelistCategoryHashes = [2487827355];
  a.sockets[0].options[0].socketWhitelistCheck = 'allowed';
  const r = result({ availabilityAssessment: a });
  state(r.availabilityCheck, 'passed');
  state(r.socketRestrictions, 'unknown');
  assert.match(r.socketRestrictions.reason, /insertion rules/i);
  assert.equal(r.overallInstallable, false);
});
test('61 — forged contradictory live candidate and whitelist excluded cannot pass either gate', () => {
  const a = assessment();
  a.sockets[0].socketWhitelistEvidenceState = 'verified';
  a.sockets[0].socketWhitelistCategoryHashes = [222];
  a.sockets[0].options[0].socketWhitelistCheck = 'excluded';
  const r = result({ availabilityAssessment: a });
  state(r.availabilityCheck, 'unknown');
  state(r.socketRestrictions, 'unknown');
  assert.match(r.socketRestrictions.reason, /contradiction/i);
});
test('62 — explicit live denial stays blocked even if Manifest category is allowed', () => {
  const a = assessment('live_blocked');
  a.sockets[0].socketWhitelistEvidenceState = 'verified';
  a.sockets[0].socketWhitelistCategoryHashes = [2487827355];
  a.sockets[0].options[0].socketWhitelistCheck = 'allowed';
  const r = result({ availabilityAssessment: a });
  state(r.availabilityCheck, 'blocked');
  state(r.socketRestrictions, 'blocked');
});
test('63 — Manifest candidate with allowed whitelist is still not approved', () => {
  const a = assessment('manifest_candidate');
  a.sockets[0].socketWhitelistEvidenceState = 'verified';
  a.sockets[0].socketWhitelistCategoryHashes = [2487827355];
  a.sockets[0].options[0].socketWhitelistCheck = 'allowed';
  const r = result({ availabilityAssessment: a });
  state(r.availabilityCheck, 'unknown');
  state(r.socketRestrictions, 'unknown');
});
test('64 — equipped/installed plug is not an insertion permission even with allowed whitelist', () => {
  const a = assessment('installed', NEW);
  a.sockets[0].socketWhitelistEvidenceState = 'verified';
  a.sockets[0].socketWhitelistCategoryHashes = [2487827355];
  a.sockets[0].options[0].socketWhitelistCheck = 'allowed';
  const r = result({ availabilityAssessment: a, proposedSwap: { socketIndex:0,newPlugHash:NEW,oldPlugHash:NEW } });
  state(r.availabilityCheck, 'unknown');
  state(r.socketRestrictions, 'unknown');
});
test('65 — source objects, privacy, and uncertified output remain unchanged', () => {
  const v = input();
  const before = JSON.stringify(v);
  const r = validateArmorInstallability(v);
  assert.equal(JSON.stringify(v), before);
  assert.equal(r.overallInstallable, false);
  assert.equal(r.installabilityVerified, false);
  assert.equal(JSON.stringify(r).includes('char-123'), false);
  state(r.socketRestrictions, 'unknown');
  state(r.tierRequirements, 'unknown');
  state(r.unlockRequirements, 'unknown');
  state(r.energyTypeCompatibility, 'unknown');
});
