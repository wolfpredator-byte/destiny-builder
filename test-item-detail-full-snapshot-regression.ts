/** SYNC-2c hotfix: full-account snapshot must NOT delete unchanged cache.
 * All checks use temporary SQLite and synthetic instance IDs; no Bungie requests.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openItemDetailStore, type ObservedInstance } from "./src/lib/destiny-builder/itemDetailStore";

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);
const account = { membershipType: 3, membershipId: "1234500012345000" };
const another = { membershipType: 3, membershipId: "1234500012345001" };
const mk = (id: string, hash = 5001, location: ObservedInstance["location"] = "vault"): ObservedInstance =>
  ({ itemInstanceId: id, itemHash: hash, category: "armor", location });
const now = Date.now();
const temp = mkdtempSync(join(tmpdir(), "destiny-full-snapshot-regression-"));
const store = openItemDetailStore(join(temp, "cache.sqlite"));
let completed = 0;

try {
  test("01 Full account re-sync preserves live-present detail in cache", () => {
    store.applyInventorySnapshot(account, [mk("1001")], "partial", now);
    store.saveDetail(account, { itemInstanceId: "1001", itemHash: 5001, name: "synthetic" }, now);
    assert.equal(store.lookup(account, "1001", 5001, { nowMs: now }).state, "cached_unverified");
    store.applyInventorySnapshot(account, [mk("1001")], "full_account", now + 1);
    assert.equal(store.lookup(account, "1001", 5001, { nowMs: now + 1 }).state, "cached_unverified");
    assert.equal(store.summary(account).stored, 1);
  });
  test("02 Repeated complete snapshots are idempotent, including same timestamp", () => {
    store.applyInventorySnapshot(account, [mk("1001")], "full_account", now + 1);
    store.applyInventorySnapshot(account, [mk("1001")], "full_account", now + 2);
    assert.equal(store.lookup(account, "1001", 5001, { nowMs: now + 2 }).state, "cached_unverified");
    assert.equal(store.listPending(account, 10, { nowMs: now + 2 }).length, 0);
  });
  test("03 Vault moves do not invalidate a detail on complete snapshot", () => {
    store.applyInventorySnapshot(account, [mk("1001", 5001, "equipped")], "full_account", now + 3);
    assert.equal(store.lookup(account, "1001", 5001, { nowMs: now + 3 }).state, "cached_unverified");
  });
  test("04 True disappearance still sets present=0", () => {
    store.applyInventorySnapshot(account, [mk("1002", 5002)], "full_account", now + 4);
    assert.equal(store.lookup(account, "1001", 5001).state, "not_current");
    assert.equal(store.summary(account).current, 1);
  });
  test("05 Reappearance still invalidates previous saved detail", () => {
    // Previously absent `1001` must NOT inherit its old cached payload.
    store.applyInventorySnapshot(account, [mk("1001"), mk("1002", 5002)], "full_account", now + 5);
    assert.equal(store.lookup(account, "1001", 5001, { nowMs: now + 5 }).state, "missing");
    assert.equal(store.summary(account).current, 2);
  });
  test("06 Changed itemHash still invalidates old details", () => {
    store.saveDetail(account, { itemInstanceId: "1002", itemHash: 5002 }, now + 6);
    store.applyInventorySnapshot(account, [mk("1001"), mk("1002", 9002)], "full_account", now + 7);
    assert.equal(store.lookup(account, "1002", 9002, { nowMs: now + 7 }).state, "missing");
    assert.equal(store.listPending(account, 10, { nowMs: now + 7 }).some((x) => x.itemInstanceId === "1002"), true);
  });
  test("07 Other accounts are isolated across full-snapshot operations", () => {
    store.applyInventorySnapshot(another, [mk("1001")], "full_account", now);
    store.saveDetail(another, { itemInstanceId: "1001", itemHash: 5001, name: "different account" }, now);
    store.applyInventorySnapshot(account, [], "full_account", now + 8);
    assert.equal(store.lookup(another, "1001", 5001, { nowMs: now + 8 }).state, "cached_unverified");
    assert.equal(store.summary(account).current, 0);
    assert.equal(store.summary(another).stored, 1);
  });
  test("08 Partial snapshot never marks nonobserved items absent", () => {
    store.applyInventorySnapshot(another, [mk("1003", 5003)], "partial", now + 9);
    assert.equal(store.lookup(another, "1001", 5001, { nowMs: now + 9 }).state, "cached_unverified");
  });
  for (const [name, fn] of tests) {
    fn(); completed++;
    console.log(`PASS ${name}`);
  }
  console.log(`SYNC-2c cache regression: ${completed}/${tests.length} PASS. Synthetic SQLite only; no network.`);
} finally {
  store.close();
  rmSync(temp, { recursive: true, force: true });
}
