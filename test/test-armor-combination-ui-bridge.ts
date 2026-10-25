import { strict as assert } from 'node:assert';
import { prepareArmorCombinationUi } from '../src/lib/destiny-builder/armorCombinationUiBridge';
import { ARMOR_3_STAT_IDS } from '../src/lib/destiny-builder/armorBaseStatsResolver';
import { ARMOR_COMBINATION_SLOT_HASHES, searchArmorCombinations } from '../src/lib/destiny-builder/armorCombinationEngine';
const SLOT = 3448274439;
const item = (id: string, overrides: Record<string, unknown>={}) => ({category:'armor', name:'Helmet', itemHash:123, itemInstanceId:id, equipmentSlotHash:SLOT, classType:2, tierTypeName:'Legendary',...overrides});
const pools = (equipped:unknown[]=[],inventory:unknown[]=[],vault:unknown[]=[],otherGuardian:unknown[]=[]) => ({equipped,inventory,vault,otherGuardian});
const detail = (id:string,overrides:Record<string,unknown>={}) => ({itemInstanceId:id,itemHash:123,tierTypeName:'Legendary',...overrides});
let n=0;
function check(label:string,fn:()=>void){fn();console.log(`PASS ${String(++n).padStart(2,'0')} ${label}`);}
check('Correct source mapping preserves equipped and Vault distinction',()=>{
 const r=prepareArmorCombinationUi(pools([item('a')],[],[item('b')]),{});
 assert.deepEqual(r.items.map(x=>x.source),['equipped','vault']);assert.equal(r.missingDetails.length,2);
});
check('Missing details never become reconciled on core-only statistics',()=>{
 const r=prepareArmorCombinationUi(pools([item('a',{armorStats:[{statHash:1,value:10}]})]),{});
 assert.equal(r.items[0].detail,null);
});
check('Exact matching instance/hash accepts full unmodified detail',()=>{
 const d=detail('a',{armorStatEvidence:{schemaVersion:1},armorStats:[]});
 const r=prepareArmorCombinationUi(pools([item('a')]),{a:d});
 assert.equal(r.items[0].detail,d);assert.equal(r.missingDetails.length,0);
});
check('Stale detail hash is rejected and eligible for refetch',()=>{
 const r=prepareArmorCombinationUi(pools([item('a')]),{a:detail('a',{itemHash:999})});
 assert.equal(r.items[0].detail,null);assert.equal(r.missingDetails.length,1);
});
check('Stale instance ID is rejected even at same hash',()=>{
 const r=prepareArmorCombinationUi(pools([item('a')]),{a:detail('b')});
 assert.equal(r.items[0].detail,null);assert.equal(r.missingDetails.length,1);
});
check('Duplicated instance stays duplicated for engine rejection, no silent owner inference',()=>{
 const r=prepareArmorCombinationUi(pools([item('a')],[],[item('a')]),{});
 assert.equal(r.items.length,2);assert.equal(r.missingDetails.length,1);
});
check('Unknown rarity remains unknown, not inferred non-exotic',()=>{
 const r=prepareArmorCombinationUi(pools([item('a',{tierTypeName:null})]),{});
 assert.equal(r.items[0].rarity,'unknown');
});
check('Detailed rarity can ground a missing summary rarity',()=>{
 const r=prepareArmorCombinationUi(pools([item('a',{tierTypeName:null})]),{a:detail('a',{tierTypeName:'Exotic'})});
 assert.equal(r.items[0].rarity,'exotic');
});
check('Contradictory rarity cannot become eligible',()=>{
 const r=prepareArmorCombinationUi(pools([item('a')]),{a:detail('a',{tierTypeName:'Exotic'})});
 assert.equal(r.items[0].rarity,'unknown');
});
check('Unknown class stays unknown unless grounded by detail',()=>{
 const r=prepareArmorCombinationUi(pools([item('a',{classType:null})]),{});
 assert.equal(r.items[0].classType,null);
 const r2=prepareArmorCombinationUi(pools([item('a',{classType:null})]),{a:detail('a',{classType:2})});
 assert.equal(r2.items[0].classType,2);
});
check('Contradictory class is rejected, not guessed',()=>{
 const r=prepareArmorCombinationUi(pools([item('a')]),{a:detail('a',{classType:0})});
 assert.equal(r.items[0].classType,null);
});
check('Only actual armor in the five Armor 3.0 slots is mapped',()=>{
 const r=prepareArmorCombinationUi(pools([item('a',{category:'weapon'}),item('b',{equipmentSlotHash:999}),item('c')]),{});
 assert.equal(r.items.length,1);assert.equal(r.items[0].itemInstanceId,'c');
});
check('Input item and detail objects are not mutated',()=>{
 const it=Object.freeze(item('a'));const det=Object.freeze(detail('a'));
 prepareArmorCombinationUi(pools([it]),{a:det});assert.equal(it.name,'Helmet');
});
check('Bridge to actual B0.6 engine searches five grounded details with absolute Min/Max',()=>{
 const seeds=ARMOR_COMBINATION_SLOT_HASHES.map((slot,i)=>item(`piece${i}`,{itemHash:200+i,equipmentSlotHash:slot}));
 const map:Record<string,unknown>={};
 const stats = ARMOR_3_STAT_IDS.map((statHash,j)=>({statHash,value:j===0?20:0}));
 const declared = ARMOR_3_STAT_IDS.map((statHash,j)=>({statHash,value:j===0?20:0,isConditionallyActive:false}));
 for(let i=0;i<5;i++){
  map[`piece${i}`]={itemInstanceId:`piece${i}`,itemHash:200+i,tierTypeName:'Legendary',
   armorStats:stats,armorStatTotal:20,armorStatEvidence:{schemaVersion:1,observedStatsSource:'bungie_item_stats_component',
   complete:true,presentStatHashes:[...ARMOR_3_STAT_IDS],missingStatHashes:[],invalidStatHashes:[],
   itemDefinitionInvestmentStats:[],socketCountFromManifest:1,
   configuredSockets:[{socketIndex:0,selectedPlugHash:100,plugDefinitionResolved:true,plugName:'roll',
    plugCategoryIdentifier:'armor_stats',declaredInvestmentStats:declared,isEnabled:true,isVisible:true}]}};
 }
 const prepared=prepareArmorCombinationUi(pools(seeds),map);
 assert.equal(prepared.missingDetails.length,0);
 const positive=searchArmorCombinations({classType:2,items:prepared.items,ranges:{[ARMOR_3_STAT_IDS[0]]:{min:100,max:100}}});
 assert.equal(positive.status,'complete');assert.equal(positive.results.length,1);
 assert.equal(positive.results[0].observedGearStats[0],100);
 assert.equal(positive.results[0].certifiedForOptimization,false);
 const negative=searchArmorCombinations({classType:2,items:prepared.items,ranges:{[ARMOR_3_STAT_IDS[0]]:{max:99}}});
 assert.equal(negative.results.length,0);
});
check('Missing one full detail through the bridge yields insufficient coverage',()=>{
 const seeds=ARMOR_COMBINATION_SLOT_HASHES.map((slot,i)=>item(`piece${i}`,{itemHash:200+i,equipmentSlotHash:slot}));
 const prepared=prepareArmorCombinationUi(pools(seeds),{});
 assert.equal(prepared.missingDetails.length,5);
 const report=searchArmorCombinations({classType:2,items:prepared.items});
 assert.equal(report.status,'insufficient_candidates');assert.equal(report.missingSlotHashes.length,5);
});
console.log(`B0.6a2: ${n}/${n} adapter assertions PASS. No network, no writes.`);
