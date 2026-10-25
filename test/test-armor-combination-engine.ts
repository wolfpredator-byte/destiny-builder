/** Offline assertions for Engine-B0.6a1. No API calls, writes, or external dependencies. */
import { ARMOR_3_STAT_IDS } from '../src/lib/destiny-builder/armorBaseStatsResolver';
import {
  ARMOR_COMBINATION_SLOT_HASHES, searchArmorCombinations,
  type ArmorCombinationItem, type ArmorCombinationRequest,
} from '../src/lib/destiny-builder/armorCombinationEngine';
const checks: [string, () => void][] = [];
const test = (name: string, fn: () => void) => checks.push([name, fn]);
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const equal = (a: unknown, b: unknown, message = 'Value mismatch') =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${message}\nGot ${JSON.stringify(a)}; expected ${JSON.stringify(b)}`);
const baseVectors = [
  [20, 0, 0, 0, 0, 0],
  [0, 20, 0, 0, 0, 0],
  [0, 0, 20, 0, 0, 0],
  [0, 0, 0, 20, 0, 0],
  [0, 0, 0, 0, 10, 10],
];
function createItem(slotIndex: number, id: string, options: Partial<ArmorCombinationItem> & {
  base?: number[], mod?: number[],
} = {}): ArmorCombinationItem {
  const {base = baseVectors[slotIndex], mod = [0, 0, 0, 0, 0, 0], ...overrides} = options;
  const observed = base.map((v, i) => v + mod[i]);
  const contributions = (vector: number[]) => ARMOR_3_STAT_IDS.map((statHash, i) =>
    ({statHash, value: vector[i], isConditionallyActive: false}));
  const modPresent = mod.some((n) => n !== 0);
  const configuredSockets = [{
    socketIndex: 0, selectedPlugHash: 10001, plugDefinitionResolved: true,
    plugName: 'armor roll', plugCategoryIdentifier: 'armor_stats',
    declaredInvestmentStats: contributions(base), isEnabled: true, isVisible: true,
  }, ...(modPresent ? [{
    socketIndex: 1, selectedPlugHash: 10002, plugDefinitionResolved: true,
    plugName: 'existing stat mod', plugCategoryIdentifier: 'enhancements.v2_general',
    declaredInvestmentStats: contributions(mod), isEnabled: true, isVisible: true,
  }] : [])];
  return {
    itemInstanceId: id, itemHash: 123456 + slotIndex,
    equipmentSlotHash: ARMOR_COMBINATION_SLOT_HASHES[slotIndex],
    classType: 2, rarity: 'legendary', source: 'inventory',
    detail: {
      armorStats: ARMOR_3_STAT_IDS.map((statHash, i) => ({statHash, value: observed[i]})),
      armorStatTotal: observed.reduce((a, b) => a + b, 0),
      armorStatEvidence: {
        schemaVersion: 1, observedStatsSource: 'bungie_item_stats_component',
        complete: true, presentStatHashes: [...ARMOR_3_STAT_IDS], missingStatHashes: [],
        invalidStatHashes: [], itemDefinitionInvestmentStats: [],
        socketCountFromManifest: configuredSockets.length, configuredSockets,
      },
    },
    ...overrides,
  };
}
function sample(): ArmorCombinationItem[] {
  return ARMOR_COMBINATION_SLOT_HASHES.map((_, index) => createItem(index, `owned-${index}`));
}
function request(items = sample(), extra: Partial<ArmorCombinationRequest> = {}): ArmorCombinationRequest {
  return {classType: 2, items, ...extra};
}
const weapons = ARMOR_3_STAT_IDS[0], health = ARMOR_3_STAT_IDS[1];
test('Five separately reconciled pieces produce a complete exact search', () => {
  const result = searchArmorCombinations(request());
  equal([result.status, result.searchComplete, result.evaluatedCombinations, result.results.length], ['complete', true, 1, 1]);
  equal(result.results[0].pieces.map((p) => p.equipmentSlotHash), [...ARMOR_COMBINATION_SLOT_HASHES]);
  equal(result.results[0].observedGearStats, [20, 20, 20, 20, 10, 10]);
});
test('Unmodified base rolls are separate from fixed observed modded gear totals', () => {
  const items = sample(); items[0] = createItem(0, 'modded', {mod: [5,0,0,0,0,0]});
  const result = searchArmorCombinations(request(items));
  equal(result.results[0].baseRollStats, [20,20,20,20,10,10]);
  equal(result.results[0].observedGearStats, [25,20,20,20,10,10]);
  assert(result.mode === 'fixed_installed_mods_and_tuning', 'Mode must be explicit');
});
test('Six absolute range constraints apply to observed item values, not base values', () => {
  const items = sample(); items[0] = createItem(0, 'modded', {mod: [5,0,0,0,0,0]});
  const yes = searchArmorCombinations(request(items, {ranges: {[weapons]: {min:25, max:25}, [health]: {min:20, max:20}}}));
  equal(yes.results.length, 1);
  const no = searchArmorCombinations(request(items, {ranges: {[weapons]: {max:24}}}));
  equal([no.status, no.results.length, no.searchComplete], ['complete',0,true]);
});
test('Unknown ranges mean unbounded, zero is a valid absolute bound', () => {
  const no = searchArmorCombinations(request(sample(), {ranges: {[weapons]: {min:0, max:0}}}));
  equal(no.results.length,0);
});
test('Invalid reversed range returns invalid_request', () => {
  equal(searchArmorCombinations(request(sample(), {ranges: {[weapons]: {min:21, max:20}}})).status, 'invalid_request');
});
test('Unexpected stat hash and fractional weight are rejected', () => {
  equal(searchArmorCombinations(request(sample(), {ranges: {999: {min:0}} as never})).status, 'invalid_request');
  equal(searchArmorCombinations(request(sample(), {weights: {[weapons]: 0.5}})).status, 'invalid_request');
});
test('Missing armor slot reports incomplete coverage rather than invented zero', () => {
  const out = searchArmorCombinations(request(sample().slice(0,4)));
  equal(out.status,'insufficient_candidates');
  equal(out.missingSlotHashes,[ARMOR_COMBINATION_SLOT_HASHES[4]]);
});
test('Missing full scope=detail evidence cannot enter search', () => {
  const items = sample(); items[2].detail = null;
  const result = searchArmorCombinations(request(items));
  equal(result.status,'insufficient_candidates');
  equal(result.rejectedItems.unreconciled_or_missing_detail,1);
});
test('Contradictory observed stat fails resolver and is rejected', () => {
  const items = sample();
  const detail = items[1].detail!;
  items[1].detail = {...detail, armorStats: detail.armorStats!.map((s, i) => ({...s, value:s.value+(i===0 ? 9 : 0)})), armorStatTotal:29};
  equal(searchArmorCombinations(request(items)).status,'insufficient_candidates');
});
test('Wrong Guardian class is rejected; universal class type is accepted', () => {
  const items = sample(); items[0].classType=0;
  const rejected = searchArmorCombinations(request(items));
  equal([rejected.status,rejected.rejectedItems.wrong_class],['insufficient_candidates',1]);
  items[0].classType=3;
  equal(searchArmorCombinations(request(items)).results.length,1);
});
test('Unknown rarity is not presumed legendary or exotic', () => {
  const items=sample(); items[3].rarity='unknown';
  equal(searchArmorCombinations(request(items)).status,'insufficient_candidates');
});
test('Two exotic armor pieces cannot be selected together', () => {
  const items=sample(); items[0].rarity='exotic'; items[1].rarity='exotic';
  const out=searchArmorCombinations(request(items));
  equal([out.status,out.results.length],['complete',0]);
});
test('Single exotic piece is allowed as a structural candidate, not certified', () => {
  const items=sample(); items[0].rarity='exotic';
  const out=searchArmorCombinations(request(items));
  assert(out.results.length===1 && out.results[0].certifiedForOptimization===false,'No certification');
});
test('Vault and other Guardian explicitly require transfer, without executing one', () => {
  const items=sample(); items[0].source='vault'; items[1].source='other_guardian';
  const out=searchArmorCombinations(request(items));
  assert(out.results[0].requiresTransfer,'Needs transfer');
  equal(out.results[0].pieces[0].source,'vault');
  equal(searchArmorCombinations(request(items,{includeTransfers:false})).status,'insufficient_candidates');
});
test('Same instance ID appearing twice invalidates both records (no inferred owner)', () => {
  const items=sample(); items[1].itemInstanceId=items[0].itemInstanceId;
  const out=searchArmorCombinations(request(items));
  equal([out.status,out.rejectedItems.duplicate_instance],['insufficient_candidates',2]);
});
test('All five slots matter, not just the four regular armor pieces', () => {
  const items=sample(); items[4].equipmentSlotHash=ARMOR_COMBINATION_SLOT_HASHES[0];
  const out=searchArmorCombinations(request(items));
  equal(out.missingSlotHashes,[ARMOR_COMBINATION_SLOT_HASHES[4]]);
});
test('A pinned helmet is preserved even if a better helmet exists', () => {
  const items=sample(); items.push(createItem(0,'better',{base:[50,0,0,0,0,0]}));
  const out=searchArmorCombinations(request(items, {lockedItemInstanceIds:['owned-0']}));
  equal(out.results.length,1);
  equal(out.results[0].pieces[0].itemInstanceId,'owned-0');
});
test('Unresolvable or conflicting pins invalidate request rather than silently ignoring', () => {
  const items=sample(); items.push(createItem(0,'better',{base:[30,0,0,0,0,0]}));
  equal(searchArmorCombinations(request(items,{lockedItemInstanceIds:['not-owned']})).status,'invalid_request');
  equal(searchArmorCombinations(request(items,{lockedItemInstanceIds:['owned-0','better']})).status,'invalid_request');
});
test('Distinct top results are deterministic, highest weighted score first', () => {
  const items=sample(); items.push(createItem(0,'better',{base:[30,0,0,0,0,0]}));
  const out=searchArmorCombinations(request(items, {maxResults:2,weights:{[weapons]:2,[health]:0}}));
  equal(out.results.map((r)=>r.pieces[0].itemInstanceId),['better','owned-0']);
  equal(out.results.map((r)=>r.weightedScore),[120,100]);
  equal(out.status,'complete');
});
test('Search budget reached is explicitly truncated and rankings are provisional', () => {
  const items=sample(); items.push(createItem(0,'better',{base:[30,0,0,0,0,0]}));
  const out=searchArmorCombinations(request(items,{maxEvaluations:1}));
  equal([out.status,out.searchComplete,out.evaluatedCombinations,out.results.length],['truncated',false,1,1]);
});
test('A fully pruned search is complete even with zero results', () => {
  const out=searchArmorCombinations(request(sample(), {ranges: {[weapons]: {min:1000}},maxEvaluations:1}));
  equal([out.status,out.searchComplete,out.evaluatedCombinations],['complete',true,0]);
});
test('Negative observed Armor values are preserved, never clamped to zero', () => {
  const items=sample(); items[0]=createItem(0,'negative',{base:[20,0,0,0,0,0],mod:[0,-5,0,0,0,0]});
  const out=searchArmorCombinations(request(items, {ranges: {[health]: {min:15,max:15}}}));
  equal([out.results.length,out.results[0].observedGearStats[1],out.results[0].baseRollStats[1]],[1,15,20]);
});
test('All candidates excluded by constraints still yields a complete search', () => {
  const items=sample(); items[0].rarity='exotic'; items[1].rarity='exotic';
  const out=searchArmorCombinations(request(items));
  equal([out.status,out.searchComplete,out.results.length],['complete',true,0]);
});
test('Read-only, privacy and input immutability invariants hold', () => {
  const input=request();
  const before=JSON.stringify(input);
  const out=searchArmorCombinations(input);
  equal(JSON.stringify(input),before);
  assert(out.readOnly && out.installabilityVerified === false && out.certifiedForOptimization===false,'Not certified');
  assert(out.results.every((r)=>r.readOnly && r.installabilityVerified===false && r.certifiedForOptimization===false),'No result certification');
  assert(!JSON.stringify(out).includes('armorStatEvidence') && !JSON.stringify(out).includes('token'),'No raw details or tokens');
});
test('Invalid limit, duplicate pins and item count larger than 5000 are rejected', () => {
  equal(searchArmorCombinations(request(sample(),{maxResults:6})).status,'invalid_request');
  equal(searchArmorCombinations(request(sample(),{maxEvaluations:0})).status,'invalid_request');
  equal(searchArmorCombinations(request(sample(),{lockedItemInstanceIds:['owned-0','owned-0']})).status,'invalid_request');
  equal(searchArmorCombinations(request(Array(5001).fill(sample()[0]))).status,'invalid_request');
});
let failures=0;
for (let i=0;i<checks.length;i++) {
  const [name, fn]=checks[i];
  try { fn(); process.stdout.write(`PASS ${String(i+1).padStart(2,'0')} ${name}\n`); }
  catch (e) { failures++; process.stderr.write(`FAIL ${String(i+1).padStart(2,'0')} ${name}: ${e instanceof Error?e.message:String(e)}\n`); }
}
process.stdout.write(`B0.6a1: ${checks.length-failures}/${checks.length} checks passed. Offline, no Bungie/OpenAI calls.\n`);
if (failures) process.exitCode=1;
