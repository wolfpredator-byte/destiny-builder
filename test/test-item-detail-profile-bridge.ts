import { strict as assert } from "node:assert";
import { indexProfileObservation, profileObservationFromBungie, parseCachedDetailSelection } from "../src/lib/destiny-builder/itemDetailProfileBridge";
import { openItemDetailStore, type ItemStoreScope, type ObservedInstance, type InventoryCoverage } from "../src/lib/destiny-builder/itemDetailStore";

let passed = 0;
function test(name: string, fn: () => void) {
  fn(); console.log(`PASS ${String(++passed).padStart(2,"0")} ${name}`);
}
const item = (id: string | null, hash = 1234) => ({itemInstanceId:id,itemHash:hash});
const scope: ItemStoreScope = {membershipType:3,membershipId:"123456"};
function profile(complete = true) {
  const response: Record<string,unknown> = {
    characters:{data:{"11":{classType:2},"22":{classType:1}}},
    characterInventories:{data:{"11":{items:[item("111")]} , "22":{items:[item("222")]}}},
    characterEquipment:{data:{"11":{items:[item("333")]},"22":{items:[item("444")]}}},
    profileInventory:{data:{items:[item("555")]}}
  };
  if (!complete) delete response.profileInventory;
  return response;
}
test("full server profile covers all five distinct instances",()=>{
  const s=profileObservationFromBungie(profile(),"11");
  assert.equal(s.coverage,"full_account"); assert.equal(s.accountComplete,true);
  assert.deepEqual(s.entries.map(x=>x.itemInstanceId).sort(),["111","222","333","444","555"]);
});
test("requested Guardian equipped and inventory locations remain distinct",()=>{
  const s=profileObservationFromBungie(profile(),"11");
  assert.equal(s.entries.find(x=>x.itemInstanceId==="333")?.location,"equipped");
  assert.equal(s.entries.find(x=>x.itemInstanceId==="111")?.location,"characterInventory");
});
test("Vault and other Guardian locations are differentiated",()=>{
  const s=profileObservationFromBungie(profile(),"11");
  assert.equal(s.entries.find(x=>x.itemInstanceId==="555")?.location,"vault");
  assert.equal(s.entries.find(x=>x.itemInstanceId==="444")?.location,"otherGuardian");
});
test("missing Vault component produces partial, not full account",()=>{
  const s=profileObservationFromBungie(profile(false),"11");
  assert.equal(s.coverage,"partial"); assert.equal(s.entries.length,4);
});
test("missing other Guardian inventory makes complete response impossible",()=>{
  const p=profile() as any; delete p.characterInventories.data["22"];
  assert.equal(profileObservationFromBungie(p,"11").coverage,"partial");
});
test("missing other Guardian equipment makes complete response impossible",()=>{
  const p=profile() as any; delete p.characterEquipment.data["22"];
  assert.equal(profileObservationFromBungie(p,"11").coverage,"partial");
});
test("untrusted absent character roster cannot trigger absence reconciliation",()=>{
  const p=profile() as any; delete p.characters;
  assert.equal(profileObservationFromBungie(p,"11").coverage,"partial");
});
test("empty genuine Vault is still complete",()=>{
  const p=profile() as any; p.profileInventory.data.items=[];
  const s=profileObservationFromBungie(p,"11"); assert.equal(s.coverage,"full_account");
});
test("unknown account requested Guardian is not treated as complete",()=>{
  const s=profileObservationFromBungie(profile(),"33");
  assert.equal(s.coverage,"partial");
});
test("stackables without instance IDs are skipped, never deduplicated by hash",()=>{
  const p=profile() as any; p.profileInventory.data.items.push(item(null),item(null));
  const s=profileObservationFromBungie(p,"11");
  assert.equal(s.skippedStackable,2); assert.equal(s.coverage,"full_account");
});
test("duplicate private instance across two account containers is rejected",()=>{
  const p=profile() as any; p.profileInventory.data.items.push(item("333"));
  assert.throws(()=>profileObservationFromBungie(p,"11"),/ambiguous/i);
});
test("invalid nonnumeric live instance is rejected",()=>{
  const p=profile() as any; p.profileInventory.data.items.push(item("not-an-id"));
  assert.throws(()=>profileObservationFromBungie(p,"11"),/invalid|ambiguous/i);
});
test("bad fetched item hash is rejected, rather than indexed",()=>{
  const p=profile() as any; p.profileInventory.data.items.push(item("999",-1));
  assert.throws(()=>profileObservationFromBungie(p,"11"),/invalid|ambiguous/i);
});
test("malformed character collection is rejected without marking absences",()=>{
  const p=profile() as any; p.characterEquipment.data["22"].items="wrong";
  assert.throws(()=>profileObservationFromBungie(p,"11"),/invalid/i);
});
test("missing response or malformed requested ID is rejected",()=>{
  assert.throws(()=>profileObservationFromBungie(null,"11"));
  assert.throws(()=>profileObservationFromBungie(profile(),"../../2"));
});
test("pure extraction does not mutate Bungie response",()=>{
  const p=profile(); const before=JSON.stringify(p);
  profileObservationFromBungie(p,"11");assert.equal(JSON.stringify(p),before);
});
test("adapter calls injected store once with full coverage when verified",()=>{
  const records: Array<{entries: readonly ObservedInstance[]; coverage: InventoryCoverage; time: number}> = [];
  const store={applyInventorySnapshot(_s: ItemStoreScope, entries: readonly ObservedInstance[], coverage:InventoryCoverage,time?:number){records.push({entries,coverage,time:time??0});}};
  const result=indexProfileObservation(store,scope,profile(),"11",1000);
  assert.equal(records.length,1);assert.equal(records[0].coverage,"full_account");assert.equal(records[0].time,1000);
  assert.equal(result.indexed,5);
});
test("adapter never claims full coverage for partial profile",()=>{
  let coverage="";
  const store={applyInventorySnapshot(_s: ItemStoreScope,_items: readonly ObservedInstance[],c:InventoryCoverage){coverage=c;}};
  indexProfileObservation(store,scope,profile(false),"11");assert.equal(coverage,"partial");
});
test("adapter does not write when profile validation fails",()=>{
  let called=0;
  const store={applyInventorySnapshot(){called++;}};
  const p=profile() as any;p.profileInventory.data.items.push(item("333"));
  assert.throws(()=>indexProfileObservation(store,scope,p,"11"));assert.equal(called,0);
});
test("no network, identity tokens or certification are projected",()=>{
  const s=profileObservationFromBungie(profile(),"11");
  const txt=JSON.stringify(s);
  assert.equal(/accessToken|authorization|certifiedForOptimization/i.test(txt),false);
  assert.equal(Object.keys(s).includes("accountComplete"),true);
});
test("cache request parser allows bounded exact pairs",()=>{
  assert.deepEqual(parseCachedDetailSelection("11:1234,22:5678"),[
    {itemInstanceId:"11",itemHash:1234},{itemInstanceId:"22",itemHash:5678}]);
});
test("cache parser rejects duplicate identities",()=>{
  assert.throws(()=>parseCachedDetailSelection("11:1234,11:5678"));
});
test("cache parser rejects overflow and malformed identities",()=>{
  for (const raw of [null,"", "1:0", "1:4294967296", "abc:123", "11:0", "../1:123", "1:100,"]) {
    assert.throws(()=>parseCachedDetailSelection(raw));
  }
});
test("cache parser rejects unbounded hydration",()=>{
  const request=Array.from({length:65},(_,i)=>`${i+1}:123`).join(",");
  assert.throws(()=>parseCachedDetailSelection(request));
});
test("real SQLite bridge indexes profile before a detail can be stored",()=>{
  const store=openItemDetailStore(":memory:");
  try {
    assert.equal(store.lookup(scope,"111",1234).state,"not_current");
    indexProfileObservation(store,scope,profile(),"11",1000);
    assert.equal(store.lookup(scope,"111",1234).state,"missing");
    store.saveDetail(scope,{itemInstanceId:"111",itemHash:1234,name:"Verified via detail route"},1100);
    const found=store.lookup(scope,"111",1234,{nowMs:1200});
    assert.equal(found.state,"cached_unverified");
  } finally {store.close();}
});
test("SQLite cache read is isolated by actual account scope",()=>{
  const store=openItemDetailStore(":memory:");
  try {
    indexProfileObservation(store,scope,profile(),"11",1000);
    store.saveDetail(scope,{itemInstanceId:"111",itemHash:1234},1100);
    assert.equal(store.lookup({membershipType:3,membershipId:"654321"},"111",1234).state,"not_current");
  } finally {store.close();}
});
test("a partial Bungie profile never marks other cached instances missing",()=>{
  const store=openItemDetailStore(":memory:");
  try {
    indexProfileObservation(store,scope,profile(),"11",1000);
    store.saveDetail(scope,{itemInstanceId:"555",itemHash:1234},1100);
    indexProfileObservation(store,scope,profile(false),"11",1200);
    assert.equal(store.lookup(scope,"555",1234,{nowMs:1300}).state,"cached_unverified");
  } finally {store.close();}
});
test("item hash change invalidates the cached SQLite detail",()=>{
  const store=openItemDetailStore(":memory:");
  try {
    indexProfileObservation(store,scope,profile(),"11",1000);
    store.saveDetail(scope,{itemInstanceId:"555",itemHash:1234},1100);
    const changed=profile() as any;changed.profileInventory.data.items=[item("555",9999)];
    indexProfileObservation(store,scope,changed,"11",1200);
    assert.notEqual(store.lookup(scope,"555",9999,{nowMs:1300}).state,"cached_unverified");
  } finally {store.close();}
});
console.log(`SYNC-2b: ${passed}/${passed} pure bridge tests PASS. No network/Bungie writes.`);
