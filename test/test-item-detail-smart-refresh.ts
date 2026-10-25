/** SYNC-3a: bounded age-based revalidation and 30-day hard cache cutoff.
 * Synthetic fixture only; no Bungie requests, tokens or external writes.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openItemDetailStore, type ObservedInstance } from "../src/lib/destiny-builder/itemDetailStore";
import { runDetailClientSync, type DetailKey, type DetailItem, MAX_SOFT_REFRESH_PER_RUN } from "../src/lib/destiny-builder/itemDetailClientSync";

const HOUR=60*60*1000, DAY=24*HOUR;
const account={membershipType:3,membershipId:"12345678900123456"};
const other={membershipType:3,membershipId:"12345678900123457"};
const temp=mkdtempSync(join(tmpdir(),"destiny-smart-refresh-"));
const store=openItemDetailStore(join(temp,"test.sqlite"));
const t0=Date.now()-40*DAY;
const id=(n:number)=>String(700000+n);
const hash=(n:number)=>100000+n;
const observed=(n:number,location:ObservedInstance["location"]="vault",fingerprint:string|null=null):ObservedInstance=>({
  itemInstanceId:id(n),itemHash:hash(n),category:"armor",location,componentFingerprint:fingerprint,
});
const detail=(n:number):DetailItem=>({itemInstanceId:id(n),itemHash:hash(n),name:"synthetic"});
const key=(n:number):DetailKey=>({itemInstanceId:id(n),itemHash:hash(n)});
const tests:Array<[string,()=>void|Promise<void>]> = [];
function test(name:string,fn:()=>void|Promise<void>){tests.push([name,fn]);}

function fakeReply(keys:readonly DetailKey[],ageDue:(key:DetailKey)=>unknown=()=>false){
  return {success:true,scope:"cached-details",cachedDataIsLiveVerified:false,cached:keys.map((key)=>({
    itemInstanceId:key.itemInstanceId,itemHash:key.itemHash,item:{...key},refreshRecommended:ageDue(key),
  }))};
}
async function clientRun(numbers:number[],opts?:{
  due?:number[],missing?:number[],budget?:number,refreshBudget?:number,failLive?:boolean,
  onCached?:(count:number)=>void,
}){
  const calls:number[]=[];
  let concurrency=0,maxConcurrency=0,cacheCount=0;
  const hits:Array<{id:string,source:string}>=[];
  const ctrl=new AbortController();
  const result=await runDetailClientSync(numbers.map(key),{
    signal:ctrl.signal,liveBudget:opts?.budget,refreshBudget:opts?.refreshBudget,
    requestCache:async(batch)=>{cacheCount++;return fakeReply(batch.filter(k=>!opts?.missing?.includes(Number(k.itemInstanceId)-700000)),
      k=>opts?.due?.includes(Number(k.itemInstanceId)-700000) ?? false);},
    requestLive:async(k)=>{
      calls.push(Number(k.itemInstanceId)-700000);concurrency++;maxConcurrency=Math.max(maxConcurrency,concurrency);
      await Promise.resolve();concurrency--;
      if(opts?.failLive) throw Error("simulated outage");
      return {...k};
    },
    onDetails:(batch,source)=>{
      for(const part of batch) hits.push({id:part.itemInstanceId,source});
      if(source==="cache")opts?.onCached?.(batch.length);
    },
  });
  return {result,calls,maxConcurrency,hits,cacheCount};
}

(async()=>{
try {
  test("01 Stored equipped detail remains cached after 6h (soft, not hard expiry)",()=>{
    store.applyInventorySnapshot(account,[observed(1,"equipped")],"full_account",t0);
    store.saveDetail(account,detail(1),t0);
    const read=store.lookup(account,id(1),hash(1),{nowMs:t0+6*HOUR+1});
    assert.equal(read.state,"cached_unverified");
    if(read.state==="cached_unverified")assert.equal(read.refreshRecommended,true);
  });
  test("02 Equipped detail younger than 6h is not queued for refresh",()=>{
    const read=store.lookup(account,id(1),hash(1),{nowMs:t0+6*HOUR-1});
    assert.equal(read.state,"cached_unverified");
    if(read.state==="cached_unverified")assert.equal(read.refreshRecommended,false);
  });
  test("03 Unequipped cached item is not refreshed after just 6h",()=>{
    store.applyInventorySnapshot(account,[observed(2,"vault")],"partial",t0);
    store.saveDetail(account,detail(2),t0);
    const read=store.lookup(account,id(2),hash(2),{nowMs:t0+6*HOUR+1});
    assert.equal(read.state,"cached_unverified");
    if(read.state==="cached_unverified")assert.equal(read.refreshRecommended,false);
  });
  test("04 Vault item is soft-refresh eligible at 3 days",()=>{
    const read=store.lookup(account,id(2),hash(2),{nowMs:t0+3*DAY});
    assert.equal(read.state,"cached_unverified");
    if(read.state==="cached_unverified")assert.equal(read.refreshRecommended,true);
  });
  test("05 30-day hard expiry blocks stale details regardless of soft-refresh",()=>{
    assert.equal(store.lookup(account,id(2),hash(2),{nowMs:t0+30*DAY+1}).state,"refresh_required");
  });
  test("06 Explicit strict TTL overrides 30-day default",()=>{
    assert.equal(store.lookup(account,id(2),hash(2),{nowMs:t0+101,maxAgeMs:100}).state,"refresh_required");
  });
  test("07 Changed live fingerprint remains a hard miss, never served stale",()=>{
    store.applyInventorySnapshot(account,[observed(2,"vault","fingerprint-v1")],"partial",t0);
    assert.equal(store.lookup(account,id(2),hash(2),{nowMs:t0+DAY}).state,"refresh_required");
  });
  test("08 Live detail saved after recheck clears fingerprint mismatch",()=>{
    store.saveDetail(account,detail(2),t0+DAY);
    const read=store.lookup(account,id(2),hash(2),{nowMs:t0+DAY});
    assert.equal(read.state,"cached_unverified");
    if(read.state==="cached_unverified")assert.equal(read.refreshRecommended,false);
  });
  test("09 Account and item hash protection still apply",()=>{
    assert.equal(store.lookup(other,id(2),hash(2),{nowMs:t0+DAY}).state,"not_current");
    assert.equal(store.lookup(account,id(2),hash(2)+1,{nowMs:t0+DAY}).state,"hash_mismatch");
  });
  test("10 Cached record stays intact through full account reindex",()=>{
    store.applyInventorySnapshot(account,[observed(1,"equipped"),observed(2,"vault","fingerprint-v1")],"full_account",t0+2*DAY);
    assert.equal(store.lookup(account,id(1),hash(1),{nowMs:t0+2*DAY}).state,"cached_unverified");
  });
  test("11 36 due cache hits revalidate max 8 and preserve all cached details",async()=>{
    const numbers=Array.from({length:36},(_,i)=>i+1);
    const {result,calls,hits,maxConcurrency}=await clientRun(numbers,{due:numbers});
    assert.equal(result.cacheHits,36);
    assert.equal(result.pending,0);
    assert.equal(result.refreshDue,36);
    assert.equal(result.refreshDone,8);
    assert.equal(result.refreshRemaining,28);
    assert.equal(calls.length,MAX_SOFT_REFRESH_PER_RUN);
    assert.ok(maxConcurrency<=2);
    assert.equal(hits.filter(x=>x.source==="cache").length,36);
  });
  test("12 New instance must be fetched before an age-based recheck",async()=>{
    const {result,calls}=await clientRun([1,2,3,4],{due:[1,2,3],missing:[4]});
    assert.equal(calls[0],4);
    assert.equal(result.cacheHits,3);
    assert.equal(result.pending,0);
    assert.equal(result.refreshDone,3);
  });
  test("13 A fully cached, recently fresh account makes zero live requests",async()=>{
    const {result,calls}=await clientRun([1,2,3]);
    assert.equal(calls.length,0);
    assert.equal(result.refreshDue,0);
    assert.equal(result.stage,"complete");
  });
  test("14 A small liveBudget counts new and refresh requests together",async()=>{
    const {result,calls}=await clientRun([1,2,3,4],{due:[1,2,3],missing:[4],budget:2});
    assert.deepEqual(calls,[4,1]);
    assert.equal(result.refreshDone,1);
    assert.equal(result.refreshRemaining,2);
  });
  test("15 Zero refreshBudget disables only periodic calls, not missing fetches",async()=>{
    const {result,calls}=await clientRun([1,2],{due:[1],missing:[2],refreshBudget:0});
    assert.deepEqual(calls,[2]);
    assert.equal(result.refreshRemaining,1);
  });
  test("16 Failed recheck never removes an already hydrated cached result",async()=>{
    const {result,hits}=await clientRun([1],{due:[1],failLive:true});
    assert.equal(result.failed,1);
    assert.equal(result.pending,0);
    assert.equal(hits.filter(x=>x.source==="cache").length,1);
  });
  test("17 No arbitrary/invalid refreshBudget is accepted",async()=>{
    const ctrl=new AbortController();
    await assert.rejects(runDetailClientSync([key(1)],{
      signal:ctrl.signal,refreshBudget:9,requestCache:async()=>fakeReply([]),
      requestLive:async()=>detail(1),onDetails:()=>{},
    }));
  });
  test("18 A forged boolean-looking hint cannot trigger a live request",async()=>{
    const calls:number[]=[];
    const ctrl=new AbortController();
    await runDetailClientSync([key(1)],{
      signal:ctrl.signal,requestCache:async(batch)=>fakeReply(batch,()=>"true"),
      requestLive:async()=>{calls.push(1);return detail(1);},onDetails:()=>{},
    });
    assert.equal(calls.length,0);
  });
  test("19 The client never promotes cache to live verification or certification",async()=>{
    const a=await clientRun([1],{due:[1],refreshBudget:0});
    assert.equal(a.result.liveLoaded,0);
    assert.equal(a.result.cacheHits,1);
    assert.equal(JSON.stringify(a.result).includes("itemInstanceId"),false);
  });

  let passed=0;
  for (const [name,fn] of tests) {
    try {await fn();passed++;console.log(`PASS ${name}`);}
    catch(e){console.error(`FAIL ${name}`,e);process.exitCode=1;break;}
  }
  console.log(`SYNC-3a: ${passed}/${tests.length} offline checks ${passed===tests.length?"PASS":"FAILED"}. No Bungie/OpenAI calls.`);
} finally {
  store.close();rmSync(temp,{recursive:true,force:true});
}

})().catch((e)=>{console.error(e);process.exitCode=1;});
