/** Engine-B0.5b2 — deterministic offline tests. Fixture evidence was
 * minimized from the user's B0.5b1 4-armor audit and from adverse cases.
 * The original audit's option lists are truncated and not API fixtures. */
const assert = {
  equal(actual:unknown,expected:unknown,message?:string):void {if(actual!==expected) throw new Error((message??'not equal')+`: ${String(actual)} !== ${String(expected)}`);},
  deepEqual(actual:unknown,expected:unknown,message?:string):void {if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error((message??'not equal')+`: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);},
};
import { assessArmorModifierAvailability } from '../src/lib/destiny-builder/armorModifierAvailability';
import { simulateArmorModifiers } from '../src/lib/destiny-builder/armorModifierSimulator';

const GENERAL='enhancements.v2_general';
const TUNING='core.gear_systems.armor_tiering.plugs.tuning.mods';
const H={W:2996146975,H:392767087,C:1943323491,G:1735777505,S:144602215,M:4244567218};
const keys=Object.values(H);
const eff=(statHash:number,value:number,isConditionallyActive:boolean=false)=>({statHash,value,isConditionallyActive});
const balanced=keys.map((id)=>eff(id,1,true));
const base=(vals:number[])=>keys.map((statHash,i)=>({statHash,value:vals[i],name:''}));
const source=(...a:string[])=>a;
const opts=(plugHash:number, category:string, effects:unknown[],
  evidenceState:'selected'|'manifest_only'|'live_can_insert'|'live_cannot_insert'|'live_status_unknown',
  extras:Record<string,unknown>={})=>({
  plugHash,name:'Example',plugCategoryIdentifier:category,plugDefinitionResolved:true,
  declaredInvestmentStats:effects,
  selected:evidenceState==='selected', evidenceState,
  sources:evidenceState==='selected'?source('selected','manifest_reusable_set'):
    evidenceState==='manifest_only'?source('manifest_reusable_set'):
    source('live_item_reusable','manifest_reusable_set'),
  liveCanInsert:evidenceState==='live_can_insert'?true:
    evidenceState==='live_cannot_insert'?false:null,
  liveEnabled:evidenceState==='live_can_insert'||evidenceState==='live_cannot_insert'?true:null,
  ...extras,
});
const socket=(index:number, selectedHash:number,options:any[],liveReusableDataPresent:boolean,liveSocketEnabled=true)=>({
  socketIndex:index,selectedPlugHash:selectedHash,options,liveReusableDataPresent,liveSocketEnabled,liveSocketPresent:true,
});
const evidence=(sockets:ReturnType<typeof socket>[],count=15)=>({
  schemaVersion:1,source:'bungie_item_detail_live_reusable_plus_manifest',readOnly:true,
  installabilityVerified:false,socketCountFromManifest:count,socketCountFromLive:count,
  itemEnergyEvidence:{energyCapacity:11,energyUsed:8,energyTypeHash:4069572561},sockets,
});
const geomag=evidence([
  socket(0,2724608735,[
    opts(2724608735,GENERAL,[eff(H.S,10)],'selected',{name:'Super Mod'}),
    opts(1180408010,GENERAL,[eff(H.H,10)],'manifest_only',{name:'Health Mod'}),
    opts(1980618587,GENERAL,[],'manifest_only',{name:'Empty Mod Socket'}),
  ],false),
  socket(14,4026414261,[
    opts(4026414261,TUNING,[eff(H.S,5),eff(H.H,-5)],'selected',{name:'+Super / -Health',sources:['selected','live_item_reusable'],liveCanInsert:true,liveEnabled:true}),
    opts(3122197216,TUNING,balanced,'live_can_insert',{name:'Balanced Tuning'}),
    opts(388618952,TUNING,[eff(H.H,5),eff(H.M,-5)],'live_can_insert',{name:'+Health / -Melee'}),
  ],true),
]);
const sword=evidence([
  socket(0,350061697,[opts(350061697,GENERAL,[eff(H.S,5)],'selected',{name:'Minor Super Mod'})],false),
  socket(11,3122197216,[
    opts(3122197216,TUNING,balanced,'selected',{name:'Balanced Tuning',sources:['selected','live_item_reusable'],liveCanInsert:true,liveEnabled:true}),
    opts(455024236,TUNING,[eff(H.G,5),eff(H.H,-5)],'live_can_insert',{name:'+Grenade / -Health'}),
    opts(388618952,TUNING,[eff(H.H,5),eff(H.M,-5)],'manifest_only'),
  ],true),
],12);
const storm=evidence([
  socket(0,1980618587,[opts(1980618587,GENERAL,[],'selected',{name:'Empty Mod Socket'})],false),
  socket(14,2121121504,[
    opts(2121121504,TUNING,[],'selected',{name:'Empty Tuning Mod Socket'}),
    opts(3122197216,TUNING,balanced,'live_can_insert',{name:'Balanced Tuning'}),
  ],true),
]);
const clone=<T>(x:T):T=>structuredClone(x);
let passed=0;
const check=(label:string,fn:()=>void)=>{try{fn();passed++;console.log('PASS '+String(passed).padStart(2,'0')+' '+label);}catch(e){console.error('FAIL '+label);throw e;}};
const find=(data:ReturnType<typeof assessArmorModifierAvailability>,hash:number)=>{
  const val=data.sockets.flatMap(s=>s.options).find(o=>o.plugHash===hash);
  if (!val) throw new Error('missing assessed option '+hash);return val;
};
const g=assessArmorModifierAvailability(geomag);
check('Geomag input B0.5b1 accepted',()=>assert.equal(g.validEvidence,true));
check('General socket 0 has no live reusable data',()=>assert.equal(g.sockets[0].liveReusableDataPresent,false));
check('Installed Super Mod not certifiable',()=>{
  const m=find(g,2724608735); assert.equal(m.availability,'installed');assert.equal(m.installabilityVerified,false);
});
check('Manifest-only Health Mod remains catalog candidate',()=>{
  const m=find(g,1180408010);assert.equal(m.availability,'manifest_candidate');assert.equal(m.effectKind,'direct');
});
check('Known empty mod represented by omission, not fake stat contributions',()=>{
  const m=find(g,1980618587);assert.equal(m.effectKind,'empty_socket');assert.equal(m.simulatorModifier,null);
});
check('Live Balanced has only candidate availability',()=>{
  const m=find(g,3122197216);assert.equal(m.availability,'live_candidate');assert.equal(m.effectKind,'balanced_lowest_three');
  assert.equal(m.installabilityVerified,false);assert.equal(m.simulatorModifier?.rule,'balanced_lowest_three');
});
check('Installed signed tuning simulator config',()=>{
  const m=find(g,4026414261);assert.equal(m.availability,'installed');assert.equal(m.effectKind,'direct');
  assert.deepEqual(m.simulatorModifier?.contributions.map(s=>s.value),[5,-5]);
});
check('Geomag real roll fixture simulates observed vector',()=>{
  const a=find(g,2724608735).simulatorModifier!;
  const b=find(g,4026414261).simulatorModifier!;
  const s=simulateArmorModifiers({baseStats:base([20,0,0,30,25,0]),baseProvenance:'reconciled_roll_candidate',modifiers:[a,b]});
  assert.equal(s.mathematicallyValid,true,s.reason);
  assert.deepEqual(s.simulatedStats.map(x=>x.value),[20,-5,0,30,40,0]);
  assert.equal(s.installabilityVerified,false);
});
check('Swordmaster no full tuning catalog permission',()=>{
 const a=assessArmorModifierAvailability(sword);assert.equal(find(a,455024236).availability,'live_candidate');
 assert.equal(find(a,388618952).availability,'manifest_candidate');assert.equal(a.installabilityVerified,false);
});
check('Stormdancer empty sockets recognized, tuning candidate live',()=>{
 const a=assessArmorModifierAvailability(storm);
 assert.equal(find(a,1980618587).simulationMode,'omit_empty');
 assert.equal(find(a,2121121504).simulationMode,'omit_empty');
 assert.equal(find(a,3122197216).availability,'live_candidate');
});
check('No live insertion source means canInsert true alone does not grant candidate',()=>{
 const x=clone(geomag);(x.sockets[0].options[1] as any).liveCanInsert=true;
 assert.equal(find(assessArmorModifierAvailability(x),1180408010).availability,'unknown');
});
check('Selected inconsistency cannot claim installed',()=>{
 const x=clone(geomag);(x.sockets[0].options[0] as any).selected=false;
 assert.equal(find(assessArmorModifierAvailability(x),2724608735).availability,'unknown');
});
check('Live false canInsert is blocked',()=>{
 const x=clone(geomag);const o=x.sockets[1].options[1] as any;o.liveCanInsert=false;o.evidenceState='live_cannot_insert';
 assert.equal(find(assessArmorModifierAvailability(x),3122197216).availability,'live_blocked');
});
check('Live enabled false is blocked',()=>{
 const x=clone(geomag);(x.sockets[1].options[1] as any).liveEnabled=false;
 assert.equal(find(assessArmorModifierAvailability(x),3122197216).availability,'live_blocked');
});
check('Live enabled missing is not enough',()=>{
 const x=clone(geomag);(x.sockets[1].options[1] as any).liveEnabled=null;
 assert.equal(find(assessArmorModifierAvailability(x),3122197216).availability,'unknown');
});
check('Disabled live socket refuses alternative',()=>{
 const x=clone(geomag);x.sockets[1].liveSocketEnabled=false;
 assert.equal(find(assessArmorModifierAvailability(x),3122197216).availability,'live_blocked');
});
check('Missing per-socket live reusable component refuses candidate',()=>{
 const x=clone(geomag);x.sockets[1].liveReusableDataPresent=false;
 assert.equal(find(assessArmorModifierAvailability(x),3122197216).availability,'unknown');
});
check('Missing live socket cannot confirm live candidate',()=>{
 const x=clone(geomag);x.sockets[1].liveSocketPresent=false;
 assert.equal(find(assessArmorModifierAvailability(x),3122197216).availability,'unknown');
});
check('Balanced conditional six-entry integrity required',()=>{
 const x=clone(geomag);(x.sockets[1].options[1] as any).declaredInvestmentStats=[eff(H.S,1,true)];
 assert.equal(find(assessArmorModifierAvailability(x),3122197216).simulationMode,'not_supported');
});
check('Unknown stat effect is not simulatable',()=>{
 const x=clone(geomag);(x.sockets[0].options[1] as any).declaredInvestmentStats=[eff(12345,10)];
 assert.equal(find(assessArmorModifierAvailability(x),1180408010).effectKind,'unknown_effect');
});
check('Unknown conditional effect is not simulatable',()=>{
 const x=clone(geomag);(x.sockets[0].options[1] as any).declaredInvestmentStats=[eff(H.H,10,true)];
 assert.equal(find(assessArmorModifierAvailability(x),1180408010).simulationMode,'not_supported');
});
check('Duplicate direct contribution is not simulatable',()=>{
 const x=clone(geomag);(x.sockets[0].options[1] as any).declaredInvestmentStats=[eff(H.H,5),eff(H.H,5)];
 assert.equal(find(assessArmorModifierAvailability(x),1180408010).effectKind,'unknown_effect');
});
check('Unknown empty-effects plug not assumed empty socket',()=>{
 const x=clone(geomag);(x.sockets[0].options[1] as any).declaredInvestmentStats=[];
 assert.equal(find(assessArmorModifierAvailability(x),1180408010).simulationMode,'not_supported');
});
check('Invalid schema rejected',()=>{const x=clone(geomag);x.schemaVersion=2;assert.equal(assessArmorModifierAvailability(x).validEvidence,false);});
check('Mismatched live/Manifest socket count rejected',()=>{const x=clone(geomag);x.socketCountFromLive=14;assert.equal(assessArmorModifierAvailability(x).validEvidence,false);});
check('Duplicate socket rejected',()=>{const x=clone(geomag);x.sockets.push(clone(x.sockets[0]));assert.equal(assessArmorModifierAvailability(x).validEvidence,false);});
check('Duplicate option rejected',()=>{const x=clone(geomag);x.sockets[0].options.push(clone(x.sockets[0].options[0]));assert.equal(assessArmorModifierAvailability(x).validEvidence,false);});
check('Missing selected option rejected',()=>{const x=clone(geomag);x.sockets[0].options.shift();assert.equal(assessArmorModifierAvailability(x).validEvidence,false);});
check('Wrong evidence source rejected',()=>{const x=clone(geomag);x.source='invented' as any;assert.equal(assessArmorModifierAvailability(x).validEvidence,false);});
check('Does not mutate source object',()=>{const x=clone(geomag);const before=JSON.stringify(x);assessArmorModifierAvailability(x);assert.equal(JSON.stringify(x),before);});
console.log(`\nPASS — ${passed} assertions/test cases executed. No tests skipped.`);
