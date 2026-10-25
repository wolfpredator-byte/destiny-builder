/** SYNC-2c — injected transport tests. No Bungie/OpenAI/network. */
import {strict as assert} from "node:assert";
import {
  selectAccountDetailKeys, extractMatchingCachedDetails, matchesLiveDetail,
  runDetailClientSync, type DetailKey, type DetailItem,
} from "../src/lib/destiny-builder/itemDetailClientSync";

const id=(n:number)=>String(10000+n);
const row=(n:number,category="armor")=>({itemInstanceId:id(n),itemHash:1000+n,category});
const key=(n:number):DetailKey=>({itemInstanceId:id(n),itemHash:1000+n});
const detail=(n:number):DetailItem=>({...key(n),armorStats:[{statHash:1,value:n}]});
const collections=()=>({equipped:[row(1),row(2,"weapon")],inventory:[row(3)],vault:[row(4)],otherGuardian:[row(5)]});
function cacheReply(rows:readonly DetailItem[]) {
  return {success:true,scope:"cached-details",cachedDataIsLiveVerified:false,
    cached:rows.map((item)=>({itemInstanceId:item.itemInstanceId,itemHash:item.itemHash,item}))};
}
const tests: Array<[string,()=>void|Promise<void>]> = [];
const test=(label:string,fn:()=>void|Promise<void>)=>tests.push([label,fn]);
function makeEnv(opts?:{cached?:number[];live?:number[];failCache?:boolean; abort?:AbortController;liveBudget?:number;failLive?:boolean}) {
  const controller=opts?.abort??new AbortController();
  const observed:DetailItem[]=[];
  const calls:{cache:number;live:number;active:number;maximum:number}={cache:0,live:0,active:0,maximum:0};
  const stages:string[]=[];
  const options = {
    signal:controller.signal,
    liveBudget:opts?.liveBudget,
    requestCache:async(batch:readonly DetailKey[])=>{calls.cache++;if(opts?.failCache)throw new Error("db offline");
      return cacheReply(batch.filter((v)=>opts?.cached?.includes(Number(v.itemInstanceId)-10000))
        .map((v)=>detail(Number(v.itemInstanceId)-10000)));},
    requestLive:async(k:DetailKey)=>{calls.live++;calls.active++;calls.maximum=Math.max(calls.maximum,calls.active);
      await Promise.resolve();calls.active--;
      if (opts?.failLive || opts?.live && !opts.live.includes(Number(k.itemInstanceId)-10000)) throw new Error("GetItem offline");
      return detail(Number(k.itemInstanceId)-10000);},
    onDetails:(entries:readonly DetailItem[])=>observed.push(...entries),
    onProgress:(p:{stage:string})=>stages.push(p.stage),
  };
  return {controller,options,observed,calls,stages};
}

test("01 Four account sources prioritized, armor before weapon",()=>{
  assert.deepEqual(selectAccountDetailKeys(collections()),[key(1),key(2),key(3),key(4),key(5)]);
});
test("02 Weapons and armor only; stackables are not addressed by item hash",()=>{
  const selected=selectAccountDetailKeys({...collections(),inventory:[row(3),{itemHash:999,category:"armor"},{...row(4),category:"other"}]});
  assert.deepEqual(selected,[key(1),key(2),key(3),key(4),key(5)]);
});
test("03 Duplicate item instance is ambiguous and omitted",()=>{
  const selected=selectAccountDetailKeys({...collections(),vault:[row(4),row(1)]});
  assert.ok(!selected.some((v)=>v.itemInstanceId===id(1)));
});
test("04 Incomplete account view is not silently accepted",()=>{
  assert.throws(()=>selectAccountDetailKeys({equipped:[],inventory:[],vault:[]} as never));
});
test("05 Cache response requires authenticated bounded schema",()=>{
  assert.throws(()=>extractMatchingCachedDetails([key(1)],{...cacheReply([detail(1)]),cachedDataIsLiveVerified:true}));
});
test("06 Wrong identity, definition hash and unknown IDs never hydrate",()=>{
  const response={...cacheReply([detail(1),detail(2)]),cached:[
    {itemInstanceId:id(1),itemHash:1001,item:{...detail(1),itemHash:404}},
    {itemInstanceId:id(2),itemHash:1002,item:detail(2)}]};
  assert.deepEqual(extractMatchingCachedDetails([key(1)],response),[]);
});
test("07 Cache includes exact match only",()=>{
  assert.deepEqual(extractMatchingCachedDetails([key(1)],cacheReply([detail(1)])),[detail(1)]);
});
test("08 Live response identity checked before merge",()=>{
  assert.equal(matchesLiveDetail(key(1),detail(2)),false);
  assert.equal(matchesLiveDetail(key(1),detail(1)),true);
});
test("09 Cached details do not trigger redundant Bungie requests",async()=>{
  const env=makeEnv({cached:[1,3]});
  const result=await runDetailClientSync([key(1),key(2),key(3)],env.options);
  assert.deepEqual([result.cacheHits,result.liveDone,result.liveLoaded,result.pending],[2,1,1,0]);
  assert.equal(env.calls.live,1);
});
test("10 Existing client detail avoids both cache and GetItem",async()=>{
  const env=makeEnv();
  const result=await runDetailClientSync([key(1)],{...env.options,existing:{[id(1)]:detail(1)}});
  assert.equal(result.stage,"complete");assert.equal(env.calls.cache,0);assert.equal(env.calls.live,0);
});
test("11 Stale in-memory item hash cannot skip verification",async()=>{
  const env=makeEnv();
  await runDetailClientSync([key(1)],{...env.options,existing:{[id(1)]:{...detail(1),itemHash:333}}});
  assert.equal(env.calls.live,1);
});
test("12 Never more than two concurrent live detail requests",async()=>{
  const env=makeEnv();await runDetailClientSync([key(1),key(2),key(3),key(4),key(5)],env.options);
  assert.ok(env.calls.maximum<=2); assert.equal(env.calls.live,5);
});
test("13 Every cache request contains at most 32 exact identities",async()=>{
  const env=makeEnv({cached:Array.from({length:70},(_,i)=>i+1)});
  const requested=Array.from({length:70},(_,i)=>key(i+1));
  const sizes:number[]=[];
  const status=await runDetailClientSync(requested,{...env.options,requestCache:async(q)=>{sizes.push(q.length);return cacheReply(q.map(k=>detail(Number(k.itemInstanceId)-10000)));}});
  assert.deepEqual(sizes,[32,32,6]);assert.equal(status.pending,0);assert.equal(env.calls.live,0);
});
test("14 Live workload is capped and remaining items explicitly pending",async()=>{
  const env=makeEnv({liveBudget:2});const result=await runDetailClientSync([key(1),key(2),key(3)],env.options);
  assert.equal(result.stage,"paused");assert.equal(result.pending,1);assert.equal(env.calls.live,2);
});
test("15 Cache error prevents automatic refetch of entire inventory",async()=>{
  const env=makeEnv({failCache:true});const status=await runDetailClientSync([key(1)],env.options);
  assert.equal(status.stage,"cache_unavailable");assert.equal(env.calls.live,0);
});
test("16 Cancellation stops client requests and avoids accepting results",async()=>{
  const controller=new AbortController();const env=makeEnv({abort:controller});
  const state=await runDetailClientSync([key(1),key(2)],{...env.options,requestCache:async(q,signal)=>{controller.abort();return cacheReply(q.map(()=>detail(1)));}});
  assert.equal(state.stage,"paused");assert.equal(env.observed.length,0);assert.equal(env.calls.live,0);
});
test("17 Repeated live failure pauses rather than flooding GetItem",async()=>{
  const env=makeEnv({failLive:true});const status=await runDetailClientSync(Array.from({length:12},(_,i)=>key(i+1)),env.options);
  assert.equal(status.stage,"paused");assert.equal(env.calls.live,4);assert.equal(status.failed,4);
});
test("18 Invalid batch limits and duplicate identities are rejected",async()=>{
  const env=makeEnv();await assert.rejects(runDetailClientSync([key(1),key(1)],env.options));
  await assert.rejects(runDetailClientSync([key(1)],{...env.options,liveBudget:10000}));
});
test("19 Progress counters never expose private instance IDs",async()=>{
  const env=makeEnv({cached:[1]});const progress:unknown[]=[];
  await runDetailClientSync([key(1),key(2)],{...env.options,onProgress:(p)=>progress.push(p)});
  assert.ok(progress.length>0);assert.ok(progress.every(p=>!JSON.stringify(p).includes(id(1))));
});
test("20 Pure selection never mutates source arrays",()=>{
  const data=collections();const before=JSON.stringify(data);selectAccountDetailKeys(data);assert.equal(JSON.stringify(data),before);
});

(async()=>{let passed=0;for(const [label,fn] of tests){try{await fn();passed++;console.log(`PASS ${label}`);}catch(error){console.error(`FAIL ${label}`,error);process.exitCode=1;}}console.log(`SYNC-2c: ${passed}/${tests.length} offline checks ${passed===tests.length?"PASS":"FAILED"}. No Bungie/OpenAI calls.`);})();
