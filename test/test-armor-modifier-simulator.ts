/** Destiny Builder B0.5a — executable deterministic assertions.
 * Run at the repository root: npx tsx test-armor-modifier-simulator.ts
 * Fixtures are anonymized six-stat snapshots from the B0.3c live audit; no account IDs.
 */
import { simulateArmorModifiers, type SimulatorInput, type ModifierConfig, type ArmorBaseStats } from '../src/lib/destiny-builder/armorModifierSimulator';

const IDS = [2996146975, 392767087, 1943323491, 1735777505, 144602215, 4244567218];
const NAMES = ['Weapons', 'Health', 'Class', 'Grenade', 'Super', 'Melee'];
const GENERAL = 'enhancements.v2_general' as const;
const TUNING = 'core.gear_systems.armor_tiering.plugs.tuning.mods' as const;
const BALANCED: ModifierConfig = {
  plugHash: 3122197216, name: 'Balanced Tuning', category: TUNING,
  rule: 'balanced_lowest_three', contributions: [],
};
const stats = (values: number[]): ArmorBaseStats[] => values.map((value, i) => ({
  statHash: IDS[i], name: NAMES[i], value,
}));
const general = (plugHash: number, changes: [number, number][]): ModifierConfig => ({
  plugHash, name: 'General stat mod', category: GENERAL, hasConditionalEffects: false,
  contributions: changes.map(([index, value]) => ({statHash: IDS[index], name: NAMES[index], value})),
});
const tune = (plugHash: number, changes: [number, number][]): ModifierConfig => ({
  plugHash, name: 'Direct tuning', category: TUNING, hasConditionalEffects: false,
  contributions: changes.map(([index, value]) => ({statHash: IDS[index], name: NAMES[index], value})),
});
const run = (base: number[], modifiers: ModifierConfig[] = [],
  baseProvenance: SimulatorInput['baseProvenance'] = 'reconciled_roll_candidate') =>
  simulateArmorModifiers({baseStats: stats(base), modifiers, baseProvenance});
const same = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}; actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)}`);
  }
};
const ok = (condition: boolean, message: string) => {if (!condition) throw new Error(message);};
const successful = (base: number[], mods: ModifierConfig[], expected: number[], label: string) => {
  const r = run(base, mods);
  ok(r.mathematicallyValid, `${label}: invalid: ${r.reason}`);
  same(r.simulatedStats.map(s => s.value), expected, `${label}: wrong stats`);
  same(r.baseStats.map(s => s.value), base, `${label}: base mutated`);
  const expectedChange = expected.reduce((a,b) => a+b,0) - base.reduce((a,b) => a+b,0);
  same(r.totalChange, expectedChange, `${label}: wrong totalChange`);
  same(r.simulatedTotal, r.baseTotal + r.totalChange, `${label}: totals incoherent`);
  same([r.installabilityVerified,r.certifiedForOptimization,r.baseProvenance],
    [false,false,'reconciled_roll_candidate'], `${label}: certifications/provenance wrong`);
  return r;
};
const rejected = (input: SimulatorInput, reason: string) => {
  const r = simulateArmorModifiers(input);
  ok(!r.mathematicallyValid, `${reason}: should reject, got ${JSON.stringify(r.simulatedStats)}`);
  ok(!!r.reason, `${reason}: missing error reason`);
  same([r.installabilityVerified,r.certifiedForOptimization], [false,false], `${reason}: unsafe certification`);
};
let passed = 0;
function test(label: string, fn: () => void) {
  fn(); passed++;
  console.log(`PASS ${String(passed).padStart(2,'0')} ${label}`);
}
const crownBase = [30,0,0,25,20,0];
const crownModifiers = [general(4204488676,[[2,10]]), tune(455024236,[[3,5],[1,-5]])];

test('Crown: direct mod + signed tuning, totals and immutable base', () => {
  const r = successful(crownBase, crownModifiers, [30,-5,10,30,20,0], 'Crown');
  same([r.baseTotal,r.totalChange,r.simulatedTotal], [75,10,85], 'Crown totals');
  same(r.modifierContributions.map(s=>s.value), [0,0,10,0,0,0], 'Class Mod breakdown');
  same(r.tuningContributions.map(s=>s.value), [0,-5,0,5,0,0], 'Tuning breakdown');
});

test('no modifiers and unverified provenance remain clearly unverified', () => {
  const r = simulateArmorModifiers({baseStats:stats([10,10,10,10,10,10]), modifiers:[]});
  ok(r.mathematicallyValid, r.reason);
  same(r.simulatedStats.map(s=>s.value), [10,10,10,10,10,10], 'no changes');
  same([r.totalChange,r.baseProvenance,r.certifiedForOptimization], [0,'unverified',false], 'provenance');
});

test('Balanced +1 exactly once, unique three smallest', () => {
  const r = successful([0,0,0,10,20,30], [BALANCED], [1,1,1,10,20,30], 'Balanced no tie');
  same(r.totalChange, 3, 'Balanced total');
  same(r.tuningContributions.map(s=>s.value), [1,1,1,0,0,0], 'Balanced contribution');
});

test('Balanced tie at 3rd/4th is rejected', () => {
  rejected({baseStats:stats([0,1,1,1,10,20]), modifiers:[BALANCED]}, 'tie');
});

test('Balanced ranks AFTER static mod; order of input mods does not matter', () => {
  const gm = general(4021790309,[[0,10]]);
  successful([1,2,3,4,5,6], [gm,BALANCED], [11,3,4,5,5,6], 'general then balanced');
  successful([1,2,3,4,5,6], [BALANCED,gm], [11,3,4,5,5,6], 'balanced then general');
});

// These eight roll/observed pairs are reconstructed from the user's B0.3c
// real audit; there are no character, account, or instance identifiers.
const realCases: {name: string; base:number[]; mods:ModifierConfig[]; observed:number[]}[] = [
  {name:'Nothing Manacles', base:[25,0,0,20,0,30], mods:[general(4021790309,[[3,5]]),BALANCED], observed:[25,1,1,25,1,30]},
  {name:'Luminopotent Cover', base:[30,0,0,0,25,20], mods:[general(1435557120,[[3,10]]),BALANCED], observed:[30,1,1,11,25,20]},
  {name:'Bushido Robes', base:[20,0,0,30,25,0], mods:[], observed:[20,0,0,30,25,0]},
  {name:'Sunbracers', base:[3,11,19,6,20,6], mods:[], observed:[3,11,19,6,20,6]},
  {name:'Crown of Tempests', base:crownBase, mods:crownModifiers, observed:[30,-5,10,30,20,0]},
  {name:'Raven Shard', base:[6,12,6,12,6,6], mods:[], observed:[6,12,6,12,6,6]},
  {name:'Eutechnology Bond', base:[20,24,0,0,0,30], mods:[], observed:[20,24,0,0,0,30]},
  {name:'Luminopotent Boots', base:[0,20,25,30,0,0], mods:[general(4021790309,[[3,5]]),BALANCED], observed:[1,20,25,35,1,1]},
];
for (const c of realCases) {
  test(`B0.3c observed-stat regression: ${c.name}`, () => {
    successful(c.base,c.mods,c.observed,c.name);
  });
}

const VALID_BASE = stats([1,2,3,4,5,6]);
const input = (modifiers:ModifierConfig[], baseStats:ArmorBaseStats[]=VALID_BASE): SimulatorInput => ({
  baseStats, modifiers, baseProvenance:'reconciled_roll_candidate',
});
const aGeneral = general(1234567890,[[0,10]]);
const aTuning = tune(2345678901,[[1,-5],[3,5]]);
const badCases: [string,SimulatorInput][] = [
  ['base duplicate', input([], [VALID_BASE[0],VALID_BASE[0],...VALID_BASE.slice(2)])],
  ['base missing', input([], VALID_BASE.slice(1))],
  ['unknown stat hash', input([], [{statHash:999, name:'?', value:1},...VALID_BASE.slice(1)])],
  ['fractional base', input([], stats([1,2.5,3,4,5,6]))],
  ['negative base', input([], stats([1,-2,3,4,5,6]))],
  ['NaN base', input([], stats([1,NaN,3,4,5,6]))],
  ['unsafe base integer', input([], stats([Number.MAX_SAFE_INTEGER+1,2,3,4,5,6]))],
  ['baseTotal overflow', input([], stats([Number.MAX_SAFE_INTEGER,1,0,0,0,0]))],
  ['duplicated plug hash', input([aGeneral,aGeneral])],
  ['two different general plugs', input([aGeneral,general(1234567891,[[1,5]])])],
  ['two tuning plugs', input([aTuning,BALANCED])],
  ['two direct tuning plugs', input([aTuning,tune(2345678902,[[0,1]])])],
  ['invalid plug hash', input([{...aGeneral,plugHash:-1}])],
  ['wrong Balanced hash', input([{...BALANCED,plugHash:1234567891}])],
  ['Balanced hash without rule', input([{...aTuning,plugHash:3122197216}])],
  ['Balanced rule in general category', input([{...BALANCED,category:GENERAL}])],
  ['Balanced malformed Manifest evidence', input([{...BALANCED,contributions:stats([1,1,1,1,1,1])}])],
  ['unsupported category', input([{...aGeneral,category:'unsupported' as any}])],
  ['conditional direct plug', input([{...aGeneral,hasConditionalEffects:true}])],
  ['unknown conditional status', input([{...aGeneral,hasConditionalEffects:undefined}])],
  ['conditional direct stat entry', input([{...aGeneral,contributions:[{...aGeneral.contributions[0],isConditionallyActive:true}]}])],
  ['unknown conditional stat entry', input([{...aGeneral,contributions:[{...aGeneral.contributions[0],isConditionallyActive:null}]}])],
  ['duplicate direct contribution', input([{...aGeneral,contributions:[aGeneral.contributions[0],aGeneral.contributions[0]]}])],
  ['invalid contribution hash', input([{...aGeneral,contributions:[{statHash:999,name:'?',value:5}]}])],
  ['fractional contribution', input([{...aGeneral,contributions:[{...aGeneral.contributions[0],value:1.5}]}])],
  ['empty direct contribution', input([{...aGeneral,contributions:[]}])],
  ['overflow applying modifier', input([aGeneral], stats([Number.MAX_SAFE_INTEGER,0,0,0,0,0]))],
  ['invalid provenance', {...input([]), baseProvenance: 'certified' as any}],
];
for (const [label, i] of badCases) test(`reject ${label}`, () => rejected(i,label));

test('input vectors are not mutated', () => {
  const source = input([aGeneral, aTuning]);
  const snapshot = JSON.stringify(source);
  const r = simulateArmorModifiers(source);
  ok(r.mathematicallyValid, r.reason);
  same(JSON.stringify(source), snapshot, 'Input changed');
});

console.log(`\nPASS — ${passed} assertions/test cases executed. No tests skipped.`);
