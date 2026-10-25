import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sharedItemCacheUrl, resolveSharedItemDetail } from "../src/lib/destiny-builder/sharedItemDetailCache";
const key = {itemInstanceId:"1000123456",itemHash:424242};
const details = { ...key, name:"Observed item", selectedPerks:[] };
const cache=(rows:unknown[])=>({success:true,scope:"cached-details",cachedDataIsLiveVerified:false,
  cached:rows.map(x=>({ ...key, item:x, refreshRecommended:false }))});
let count=0;
async function check(name:string, fn:()=>Promise<void>|void){await fn();console.log(`PASS ${String(++count).padStart(2,"0")} ${name}`)}
async function main(){
 await check("Builds only one bounded authenticated cache URL",()=>{assert.equal(sharedItemCacheUrl("230987",key),"/api/destiny/characters/230987/inventory?scope=cached-details&items=1000123456%3A424242")});
 await check("Rejects malformed Guardian, instance and item hash",()=>{for(const k of [{...key,itemInstanceId:"bad"},{...key,itemHash:0},{...key,itemHash:0xffffffff+1}])assert.throws(()=>sharedItemCacheUrl("34",k));assert.throws(()=>sharedItemCacheUrl("../bad",key))});
 await check("Cache hit needs no Bungie request",async()=>{let live=0;const result=await resolveSharedItemDetail(key,{readCache:async()=>cache([details]),readLive:async()=>{live++;return details}});assert.equal(result.source,"cached_unverified");assert.equal(live,0)});
 await check("Cache miss falls back to just one live item",async()=>{let live=0;const result=await resolveSharedItemDetail(key,{readCache:async()=>cache([]),readLive:async()=>{live++;return details}});assert.equal(result.source,"bungie_live");assert.equal(live,1)});
 await check("Cache outage allows one inspector fallback",async()=>{let cacheCalls=0,live=0;await resolveSharedItemDetail(key,{readCache:async()=>{cacheCalls++;throw Error("SQLite unavailable")},readLive:async()=>{live++;return details}});assert.deepEqual([cacheCalls,live],[1,1])});
 await check("Cache wrong hash cannot skip Bungie",async()=>{let live=0;const r=await resolveSharedItemDetail(key,{readCache:async()=>cache([{...details,itemHash:27}]),readLive:async()=>{live++;return details}});assert.equal(live,1);assert.equal(r.source,"bungie_live")});
 await check("Cache wrong instance cannot skip Bungie",async()=>{let live=0;await resolveSharedItemDetail(key,{readCache:async()=>cache([{...details,itemInstanceId:"1999"}]),readLive:async()=>{live++;return details}});assert.equal(live,1)});
 await check("Cache duplicate identities are not unconditionally accepted",async()=>{let live=0;await resolveSharedItemDetail(key,{readCache:async()=>({...cache([details]),cached:[{...key,item:details},{...key,item:{...details,itemHash:0}}]}),readLive:async()=>{live++;return details}});assert.equal(live,0)});
 await check("Unexpected response envelope fails closed",async()=>{let live=0;await resolveSharedItemDetail(key,{readCache:async()=>({...cache([details]),cachedDataIsLiveVerified:true}),readLive:async()=>{live++;return details}});assert.equal(live,1)});
 await check("Forced refresh never consults cached value",async()=>{let cacheReads=0;const r=await resolveSharedItemDetail(key,{forceLive:true,readCache:async()=>{cacheReads++;return cache([details])},readLive:async()=>details});assert.equal(cacheReads,0);assert.equal(r.source,"bungie_live")});
 await check("Wrong live identity is rejected",async()=>{await assert.rejects(()=>resolveSharedItemDetail(key,{readCache:async()=>cache([]),readLive:async()=>({...details,itemHash:555})}),/mismatch/)});
 await check("Invalid input makes no network request",async()=>{let calls=0;await assert.rejects(()=>resolveSharedItemDetail({...key,itemInstanceId:"0"},{readCache:async()=>{calls++;return cache([])},readLive:async()=>{calls++;return details}}));assert.equal(calls,0)});
 await check("Does not mutate stored or returned records",async()=>{const a=JSON.stringify(details);const r=await resolveSharedItemDetail(key,{readCache:async()=>cache([details]),readLive:async()=>details});assert.equal(JSON.stringify(details),a);assert.equal(r.detail,details)});
 const builder=readFileSync("src/app/guardian/[characterId]/page.tsx","utf8");
 const vault=readFileSync("src/app/vault/page.tsx","utf8");
 await check("Builder imports the same authenticated shared cache adapter",()=>{assert.match(builder,/import \{ resolveSharedItemDetail, sharedItemCacheUrl \}/);assert.match(builder,/forceLive: force/);assert.match(builder,/detailCacheRef\.current\[key\] = detail/)});
 await check("Vault Inspector and Compare Tray both use shared adapter",()=>{assert.equal((vault.match(/await resolveSharedItemDetail\(identity/g)??[]).length,2);assert.equal((vault.match(/getApi<CachedDetailResponse>\(sharedItemCacheUrl/g)??[]).length,2)});
 await check("Vault still verifies physical transfer destination",()=>{assert.match(vault,/verifyItemDestination/);assert.match(vault,/fetch\("\/api\/destiny\/transfer"/)});
 await check("Builder draft persistence remains untouched",()=>{assert.match(builder,/window\.localStorage\.setItem\(/);assert.match(builder,/destiny-builder-draft:/)});
 await check("Cache integration never introduces a Bungie write",()=>{assert.doesNotMatch(readFileSync("src/lib/destiny-builder/sharedItemDetailCache.ts","utf8"),/\/api\/destiny\/transfer|MoveEquipDestinyItems/)});
 console.log(`SYNC-3b1: ${count}/${count} shared detail checks PASS. No network or Bungie writes.`);
}main().catch(e=>{console.error(e);process.exitCode=1});
