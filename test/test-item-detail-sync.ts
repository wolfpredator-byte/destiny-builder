import assert from "node:assert/strict";
import {openItemDetailStore} from "../src/lib/destiny-builder/itemDetailStore";
import {assembleItemDetailSyncSnapshot as assemble, runItemDetailSyncBatch as run} from "../src/lib/destiny-builder/itemDetailSync";

const scope = {membershipType: 3, membershipId: "234567890123"};
const object = (id: string, hash = 100, category="armor") => ({itemInstanceId:id, itemHash:hash, category});
const current = (id="101", hash=100) => ({itemInstanceId:id,itemHash:hash,stats:[{statHash:1,value:15}]});
const full = () => ({equipped:[object("101")], inventory:[object("102",200,"weapon")],
  vault:[object("103",300)], otherGuardian:[object("104",400,"weapon")], completeAccountResponse:true});
const tests: Array<[string,()=>void|Promise<void>]> = [];
function test(name:string, fn:()=>void|Promise<void>){tests.push([name,fn]);}
const withStore = async (fn: (s:ReturnType<typeof openItemDetailStore>)=>Promise<void>|void) => {
  const s=openItemDetailStore(":memory:"); try{await fn(s);}finally{s.close();}
};

test("Four account collections with a trusted completeness marker produce a full snapshot",()=>{
  const r=assemble(full());assert.equal(r.coverage,"full_account");assert.deepEqual(r.entries.map(x=>x.itemInstanceId),["101","102","103","104"]);
  assert.deepEqual(r.entries.map(x=>x.location),["equipped","characterInventory","vault","otherGuardian"]);
});
test("Four arrays without trusted complete-account evidence are still partial",()=>{
  assert.equal(assemble({...full(),completeAccountResponse:false}).coverage,"partial");
});
test("Missing collections never allow absence reconciliation",()=>{
  assert.equal(assemble({equipped:full().equipped}).coverage,"partial");
  assert.throws(()=>assemble({equipped:[],completeAccountResponse:true}),/complete account/i);
});
test("Stackable inventory entries lack stable instance IDs and are excluded",()=>{
  const r=assemble({equipped:[object("101"),{itemHash:20,itemInstanceId:null,category:"other"}]});
  assert.equal(r.entries.length,1);assert.equal(r.skippedStackable,1);
});
test("Instance duplicated across Vault/Guardian cannot be silently resolved",()=>{
  assert.throws(()=>assemble({equipped:[object("101")],vault:[object("101")]}),/ambiguous/i);
});
test("Malformed instance/hash in a trusted inventory is rejected",()=>{
  assert.throws(()=>assemble({inventory:[object("bad")]}),/invalid|malformed|ambiguous/i);
  assert.throws(()=>assemble({inventory:[object("101",0)]}),/invalid|malformed|ambiguous/i);
});
test("Snapshot conversion leaves original input unchanged",()=>{
  const src=full();const frozen=Object.freeze(src.equipped![0]);const a=assemble(src);
  assert.equal(a.entries[0].itemInstanceId,frozen.itemInstanceId);assert.equal(Object.hasOwn(src.equipped![0],"location"),false);
});
test("Partial update does not mark absent owned instances inactive",async()=>withStore(s=>{
  let snap=assemble(full());s.applyInventorySnapshot(scope,snap.entries,snap.coverage,500);
  snap=assemble({equipped:[object("101")]});s.applyInventorySnapshot(scope,snap.entries,snap.coverage,600);
  assert.equal(s.summary(scope).current,4);
}));
test("Explicit full account later can reconcile absences",async()=>withStore(s=>{
  let snap=assemble(full());s.applyInventorySnapshot(scope,snap.entries,snap.coverage,500);
  snap=assemble({equipped:[object("101")],inventory:[],vault:[],otherGuardian:[],completeAccountResponse:true});
  s.applyInventorySnapshot(scope,snap.entries,snap.coverage,600);
  assert.equal(s.summary(scope).current,1);
}));
test("One bounded batch persists four distinct item details",async()=>withStore(async s=>{
  const snap=assemble(full());s.applyInventorySnapshot(scope,snap.entries,snap.coverage,1000);
  const r=await run(s,scope,async p=>current(p.itemInstanceId,p.itemHash),{nowMs:1100});
  assert.deepEqual([r.queued,r.processed,r.saved,r.failed],[4,4,4,0]);
  assert.equal(s.listPending(scope,32,{nowMs:1200}).length,0);
  assert.equal(s.lookup(scope,"101",100,{nowMs:1200}).state,"cached_unverified");
}));
test("Refetch is limited to changed fingerprint or stale items",async()=>withStore(async s=>{
  s.applyInventorySnapshot(scope,[{itemInstanceId:"101",itemHash:100,category:"armor",location:"equipped",componentFingerprint:"fingerprint_v1"}],"partial",1000);
  await run(s,scope,async p=>current(p.itemInstanceId,p.itemHash),{nowMs:1100});
  assert.equal(s.listPending(scope,32,{nowMs:1200}).length,0);
  s.applyInventorySnapshot(scope,[{itemInstanceId:"101",itemHash:100,category:"armor",location:"equipped",componentFingerprint:"fingerprint_v2"}],"partial",1300);
  assert.equal(s.listPending(scope,32,{nowMs:1400}).length,1);
}));
test("Failed fetch remains pending; does not poison previously stored details",async()=>withStore(async s=>{
  const snap=assemble({equipped:[object("101"),object("102",200)]});s.applyInventorySnapshot(scope,snap.entries,snap.coverage,1000);
  const r=await run(s,scope,async p=>{if(p.itemInstanceId==="101") throw Error("offline");return current(p.itemInstanceId,p.itemHash);},{nowMs:1100});
  assert.equal(r.failed,1);assert.equal(r.saved,1);assert.equal(s.listPending(scope,32,{nowMs:1200}).length,1);
}));
test("Incorrect fetched identity cannot be saved",async()=>withStore(async s=>{
  s.applyInventorySnapshot(scope,assemble({equipped:[object("101")]}).entries,"partial",1000);
  const r=await run(s,scope,async()=>current("999",100),{nowMs:1100});
  assert.equal(r.failed,1);assert.equal(s.summary(scope).stored,0);
}));
test("In-flight request count never exceeds two",async()=>withStore(async s=>{
  const many=Array.from({length:9},(_,i)=>object(String(100+i)));
  s.applyInventorySnapshot(scope,assemble({inventory:many}).entries,"partial",1000);
  let active=0, peak=0;
  const r=await run(s,scope,async p=>{active++;peak=Math.max(peak,active);await new Promise<void>(ok=>setImmediate(ok));active--;return current(p.itemInstanceId,p.itemHash);},{nowMs:1100});
  assert.equal(peak,2);assert.equal(r.saved,9);
}));
test("Batch cap forbids unlimited or zero requests",async()=>withStore(async s=>{
  await assert.rejects(()=>run(s,scope,async p=>current(p.itemInstanceId,p.itemHash),{limit:33}),/batch size/i);
  await assert.rejects(()=>run(s,scope,async p=>current(p.itemInstanceId,p.itemHash),{limit:0}),/batch size/i);
}));
test("Cancellation prevents storing a completed but aborted in-flight response",async()=>withStore(async s=>{
  s.applyInventorySnapshot(scope,assemble({equipped:[object("101")]}).entries,"partial",1000);
  const controller=new AbortController();
  const r=await run(s,scope,async p=>{controller.abort();return current(p.itemInstanceId,p.itemHash);},{nowMs:1100,signal:controller.signal});
  assert.equal(r.cancelled,true);assert.equal(r.saved,0);assert.equal(s.summary(scope).stored,0);
}));
test("Progress counters reflect completed work without publishing private IDs",async()=>withStore(async s=>{
  s.applyInventorySnapshot(scope,assemble({equipped:[object("101")]}).entries,"partial",1000);
  const progress:unknown[]=[];
  await run(s,scope,async p=>current(p.itemInstanceId,p.itemHash),{nowMs:1100,onProgress:(p)=>progress.push(p)});
  assert.equal(progress.length,2);assert.deepEqual(progress.at(-1),{queued:1,processed:1,saved:1,failed:0,cancelled:false});
  assert.equal(JSON.stringify(progress).includes("101"),false);
}));
test("There is no network call or automatic loader invocation for an empty queue",async()=>withStore(async s=>{
  let invoked=0;
  const r=await run(s,scope,async()=>{invoked++;return current();});
  assert.equal(invoked,0);assert.equal(r.queued,0);
}));
test("Untrusted cross-account queue is never surfaced to another account",async()=>withStore(async s=>{
  s.applyInventorySnapshot(scope,assemble({equipped:[object("101")]}).entries,"partial",1000);
  const second={membershipType:3,membershipId:"987654321"};let invoked=0;
  const r=await run(s,second,async p=>{invoked++;return current(p.itemInstanceId,p.itemHash)},{nowMs:1100});
  assert.equal(r.queued,0);assert.equal(invoked,0);
}));

(async()=>{
 let passed=0;
 for (const [name,fn] of tests){
  try {await fn();passed++;console.log(`PASS ${String(passed).padStart(2,"0")} ${name}`);}
  catch(err){console.error(`FAIL ${name}`);throw err;}
 }
 console.log(`SYNC-2a: ${passed}/${tests.length} pure/injected-loader tests PASS. No Bungie/OpenAI calls or writes.`);
})().catch(error=>{console.error(error);process.exitCode=1});
