/** Engine-B0.6a3 offline checks. No Bungie/OpenAI/network access. */
import { strict as assert } from 'node:assert';
import { ARMOR_3_STAT_IDS } from '../src/lib/destiny-builder/armorBaseStatsResolver';
import {
  ARMOR_COMBINATION_SLOT_HASHES, type ArmorCombinationItem,
} from '../src/lib/destiny-builder/armorCombinationEngine';
import {
  summarizeEquippedArmorSnapshot, selectMissingArmorDetailBatch, ARMOR_DETAIL_BATCH_LIMIT,
} from '../src/lib/destiny-builder/armorEquippedSnapshot';

const records: [string, () => void][] = [];
const test = (name:string, fn:()=>void) => records.push([name,fn]);
function item(index:number, extra:Partial<ArmorCombinationItem> & {base?:number[];mod?:number[]} = {}):ArmorCombinationItem {
  const {base=[5,6,7,8,9,10],mod=[0,0,0,0,0,0],...override}=extra;
  const observed=base.map((v,i)=>v+mod[i]);
  const contributions=(values:number[])=>ARMOR_3_STAT_IDS.map((statHash,i)=>({statHash,value:values[i],isConditionallyActive:false}));
  const sockets=[{socketIndex:0,selectedPlugHash:1000,plugDefinitionResolved:true,plugName:'Base',plugCategoryIdentifier:'armor_stats',declaredInvestmentStats:contributions(base),isEnabled:true,isVisible:true}];
  if (mod.some(v=>v!==0)) sockets.push({socketIndex:1,selectedPlugHash:1001,plugDefinitionResolved:true,plugName:'Existing mod',plugCategoryIdentifier:'enhancements.v2_general',declaredInvestmentStats:contributions(mod),isEnabled:true,isVisible:true});
  const id=`piece-${index}`;
  return {source:'equipped',itemInstanceId:id,itemHash:100+index,equipmentSlotHash:ARMOR_COMBINATION_SLOT_HASHES[index],rarity:'legendary',classType:2,
    detail:({itemInstanceId:id,itemHash:100+index,armorStats:ARMOR_3_STAT_IDS.map((statHash,i)=>({statHash,value:observed[i]})),armorStatTotal:observed.reduce((a,b)=>a+b,0),armorStatEvidence:{schemaVersion:1,observedStatsSource:'bungie_item_stats_component',complete:true,presentStatHashes:[...ARMOR_3_STAT_IDS],missingStatHashes:[],invalidStatHashes:[],itemDefinitionInvestmentStats:[],socketCountFromManifest:sockets.length,configuredSockets:sockets}} as ArmorCombinationItem["detail"]),...override};
}
const five=()=>ARMOR_COMBINATION_SLOT_HASHES.map((_,i)=>item(i));
const missing=(id:string,slot:number=ARMOR_COMBINATION_SLOT_HASHES[0])=>({itemInstanceId:id,itemHash:100,name:id,equipmentSlotHash:slot});
test('Five reconciled equipped slots display exact observed gear totals',()=>{
  const r=summarizeEquippedArmorSnapshot(five());
  assert.equal(r.verifiedSlots,5);assert.deepEqual(r.observedGearTotals,[25,30,35,40,45,50]);assert.deepEqual(r.missingSlotHashes,[]);
});
test('Observed totals include already-installed positive and negative mods',()=>{
  const inputs=five(); inputs[0]=item(0,{mod:[10,-5,0,0,0,0]});
  const r=summarizeEquippedArmorSnapshot(inputs);
  assert.deepEqual(r.observedGearTotals,[35,25,35,40,45,50]);
});
test('Missing fifth detail does not invent full totals',()=>{
  const inputs=five();inputs[4]={...inputs[4],detail:null};
  const r=summarizeEquippedArmorSnapshot(inputs);
  assert.equal(r.verifiedSlots,4);assert.deepEqual(r.observedGearTotals,Array(6).fill(null));
  assert.deepEqual(r.partialSums,[20,24,28,32,36,40]);
  assert.deepEqual(r.missingSlotHashes,[ARMOR_COMBINATION_SLOT_HASHES[4]]);
});
test('Core-only summary cannot replace missing scope=detail evidence',()=>{
  const inputs=five();inputs[0]={...inputs[0],detail:null};
  assert.equal(summarizeEquippedArmorSnapshot(inputs).verifiedSlots,4);
});
test('Instance mismatch cannot contribute a verified equipped slot',()=>{
  const inputs=five();inputs[0]={...inputs[0],detail:{...inputs[0].detail!,itemInstanceId:'wrong'} as never};
  assert.equal(summarizeEquippedArmorSnapshot(inputs).verifiedSlots,4);
});
test('Definition hash mismatch cannot contribute verified slot',()=>{
  const inputs=five();inputs[0]={...inputs[0],detail:{...inputs[0].detail!,itemHash:999} as never};
  assert.equal(summarizeEquippedArmorSnapshot(inputs).verifiedSlots,4);
});
test('Contradictory observed stats cannot pass reconciliation',()=>{
  const inputs=five();inputs[1]={...inputs[1],detail:{...inputs[1].detail!,armorStatTotal:101} as never};
  assert.equal(summarizeEquippedArmorSnapshot(inputs).verifiedSlots,4);
});
test('Other Guardian items never count as worn even if reconciled',()=>{
  const inputs=five();inputs[2]={...inputs[2],source:'other_guardian'};
  assert.equal(summarizeEquippedArmorSnapshot(inputs).verifiedSlots,4);
});
test('Ambiguous duplicate equipped slots cannot be chosen arbitrarily',()=>{
  const inputs=five(); inputs.push(item(0,{itemInstanceId:'another',detail:null}));
  assert.equal(summarizeEquippedArmorSnapshot(inputs).verifiedSlots,4);
});
test('Empty equipped pool reports all five slots unverified',()=>{
  const r=summarizeEquippedArmorSnapshot([]);
  assert.deepEqual(r.observedGearTotals,Array(6).fill(null));assert.equal(r.missingSlotHashes.length,5);assert.deepEqual(r.partialSums,Array(6).fill(0));
});
test('No mutation, private identifiers or certification in public display summary',()=>{
  const inputs=five();const before=JSON.stringify(inputs);
  const r=summarizeEquippedArmorSnapshot(inputs);
  assert.equal(JSON.stringify(inputs),before);assert.equal(r.certifiedForOptimization,false);assert.equal(r.readOnly,true);
  assert.ok(!JSON.stringify(r).includes('piece-'));
});
test('Queue prioritizes missing equipped armor before Vault and inventory',()=>{
  const q=[missing('vault'),missing('inventory'),missing('equip',ARMOR_COMBINATION_SLOT_HASHES[4])];
  assert.deepEqual(selectMissingArmorDetailBatch(q,['equip'],new Set(),2).map(x=>x.itemInstanceId),['equip','vault']);
});
test('Queue caps manual batch to 32; never silently requests all 137',()=>{
  const q=Array.from({length:137},(_,i)=>missing(String(i)));
  assert.equal(ARMOR_DETAIL_BATCH_LIMIT,32);
  assert.equal(selectMissingArmorDetailBatch(q,[],new Set()).length,32);
});
test('Queue skips failed IDs until explicit retry clears the exclusions',()=>{
  const q=[missing('bad'),missing('good')];
  assert.deepEqual(selectMissingArmorDetailBatch(q,[],new Set(['bad'])).map(x=>x.itemInstanceId),['good']);
  assert.deepEqual(selectMissingArmorDetailBatch(q,[],new Set()).map(x=>x.itemInstanceId),['bad','good']);
});
test('Queue deduplicates instances and rejects malformed hashes/slots',()=>{
  const q=[missing('x'),missing('x'),missing('invalid',999),{...missing('hash'),itemHash:0},missing('good')];
  assert.deepEqual(selectMissingArmorDetailBatch(q,[],new Set()).map(x=>x.itemInstanceId),['x','good']);
});
test('Queue rejects invalid oversized and zero limits',()=>{
  assert.equal(selectMissingArmorDetailBatch([missing('x')],[],new Set(),33).length,0);
  assert.equal(selectMissingArmorDetailBatch([missing('x')],[],new Set(),0).length,0);
});
let passed=0;
for(const [name,fn] of records){try{fn();passed++;console.log(`PASS ${String(passed).padStart(2,'0')} ${name}`);}catch(e){console.error(`FAIL ${name}`,e);process.exitCode=1;}}
console.log(`B0.6a3: ${passed}/${records.length} pure checks passed. Offline, no network or writes.`);
