/** SYNC-1 offline regression suite; no API access and no Bungie writes. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultItemDetailDatabasePath, openItemDetailStore, type ObservedInstance } from "../src/lib/destiny-builder/itemDetailStore";

const account = { membershipType: 3, membershipId: "12345678901234567" };
const otherAccount = { membershipType: 3, membershipId: "12345678901234568" };
const item = (id: string, hash: number, location: ObservedInstance["location"] = "equipped", componentFingerprint: string | null = null): ObservedInstance =>
  ({ itemInstanceId: id, itemHash: hash, category: "armor", location, componentFingerprint });
const tests: Array<[string, () => void]> = [];
function test(label: string, fn: () => void) { tests.push([label, fn]); }
const directory = mkdtempSync(join(tmpdir(), "destiny-detail-store-test-"));
const dbPath = join(directory, "item-store.sqlite");
let store = openItemDetailStore(dbPath);
let passed = 0;
const now = Date.now();

try {
  test("01 Fresh database is empty and never reports certification", () => {
    assert.deepEqual(store.summary(account), { current: 0, stored: 0, missing: 0, certified: false });
    assert.deepEqual(store.listPending(account), []);
  });
  test("02 Partial snapshot indexes observed instances but cannot reconcile absences", () => {
    const result = store.applyInventorySnapshot(account, [item("1001", 2001), item("1002", 2002, "vault")], "partial", now);
    assert.deepEqual(result, { observed: 2, absenceReconciled: false });
    assert.deepEqual(store.summary(account), { current: 2, stored: 0, missing: 2, certified: false });
  });
  test("03 Uncached item lookup is missing; unknown account ownership is not guessed", () => {
    assert.equal(store.lookup(account, "1001", 2001).state, "missing");
    assert.equal(store.lookup(otherAccount, "1001", 2001).state, "not_current");
  });
  test("04 Save full route-derived details without exposing unapproved private fields", () => {
    const raw = {
      itemInstanceId: "1001", itemHash: 2001, name: "Test Helmet", category: "armor",
      armorStats: [{ statHash: 2996146975, value: -5, name: "Weapons" }],
      armorStatEvidence: { schemaVersion: 1, complete: true, socketInfo: { plugHash: 42, oauthToken: "SECRET_NEVER_STORE" } },
      armorModifierAvailabilityEvidence: { sockets: [], installabilityVerified: false },
      selectedPerks: [{ plugHash: 91, state: "selected" }],
      accessToken: "SECRET_NEVER_STORE", membershipId: "PRIVATE_ID", randomPayload: "omit-me",
    };
    store.saveDetail(account, raw, now);
    const result = store.lookup(account, "1001", 2001, { nowMs: now });
    assert.equal(result.state, "cached_unverified");
    assert.equal(result.detail?.armorStatTotal, undefined);
    assert.equal((result.detail?.armorStats as any[])?.[0].value, -5);
    assert.equal((result.detail?.armorStatEvidence as any)?.socketInfo?.oauthToken, undefined);
    assert.equal(result.detail?.accessToken, undefined);
    assert.equal(result.detail?.randomPayload, undefined);
    assert.equal(store.summary(account).stored, 1);
  });
  test("05 SQLite persistence survives close/reopen without re-fetching", () => {
    store.close();
    store = openItemDetailStore(dbPath);
    assert.equal(store.lookup(account, "1001", 2001, { nowMs: now }).state, "cached_unverified");
    assert.equal(store.summary(account).missing, 1);
  });
  test("06 Two accounts cannot read each other's private item instances", () => {
    store.applyInventorySnapshot(otherAccount, [item("1001", 2001)], "full_account", now);
    assert.equal(store.lookup(otherAccount, "1001", 2001, { nowMs: now }).state, "missing");
    assert.equal(store.lookup(account, "1001", 2001, { nowMs: now }).state, "cached_unverified");
  });
  test("07 Cached hashes must match both requested identity and observed snapshot", () => {
    assert.equal(store.lookup(account, "1001", 9999).state, "hash_mismatch");
    assert.throws(() => store.saveDetail(account, { itemInstanceId: "1002", itemHash: 9999 }, now), /does not match/);
  });
  test("08 New acquisitions enter the read-only pending queue first by location", () => {
    store.applyInventorySnapshot(account, [item("1003", 2003, "characterInventory"), item("1004", 2004, "equipped")], "partial", now);
    assert.deepEqual(store.listPending(account, 10, { nowMs: now }).map((i) => i.itemInstanceId), ["1004", "1003", "1002"]);
  });
  test("09 Known item moving to Vault keeps its matching cached details", () => {
    store.applyInventorySnapshot(account, [item("1001", 2001, "vault")], "partial", now);
    assert.equal(store.lookup(account, "1001", 2001, { nowMs: now }).state, "cached_unverified");
  });
  test("10 A changed observed definition hash invalidates the previous detail", () => {
    store.applyInventorySnapshot(account, [item("1001", 2008, "vault")], "partial", now);
    assert.equal(store.lookup(account, "1001", 2008, { nowMs: now }).state, "missing");
    assert.deepEqual(store.listPending(account, 10, { nowMs: now }).map((i) => i.itemInstanceId).includes("1001"), true);
  });
  test("11 Invalid duplicate instance snapshots roll back atomically", () => {
    const before = store.summary(account);
    assert.throws(() => store.applyInventorySnapshot(account, [item("1005", 2005), item("1005", 2006)], "full_account", now), /Ambiguous/);
    assert.deepEqual(store.summary(account), before);
    assert.equal(store.lookup(account, "1003", 2003).state, "missing");
  });
  test("12 Only a complete account snapshot can mark unseen instances inactive", () => {
    store.applyInventorySnapshot(account, [item("1001", 2008, "vault"), item("1004", 2004, "equipped")], "full_account", now);
    assert.equal(store.lookup(account, "1003", 2003).state, "not_current");
    assert.equal(store.summary(account).current, 2);
    store.applyInventorySnapshot(account, [item("1006", 2006)], "partial", now);
    assert.equal(store.summary(account).current, 3);
  });
  test("13 A changed live component fingerprint requests revalidation", () => {
    store.applyInventorySnapshot(account, [item("1004", 2004, "equipped", "fingerprint-v1")], "partial", now);
    store.saveDetail(account, { itemInstanceId: "1004", itemHash: 2004, selectedPerks: [{ plugHash: 15 }] }, now);
    assert.equal(store.lookup(account, "1004", 2004, { nowMs: now }).state, "cached_unverified");
    store.applyInventorySnapshot(account, [item("1004", 2004, "equipped", "fingerprint-v2")], "partial", now + 1);
    assert.equal(store.lookup(account, "1004", 2004, { nowMs: now + 1 }).state, "refresh_required");
    assert.equal(store.listPending(account, 10, { nowMs: now + 1 }).some((i) => i.itemInstanceId === "1004"), true);
  });
  test("14 Age-based refresh covers changes invisible in snapshots", () => {
    store.saveDetail(account, { itemInstanceId: "1004", itemHash: 2004 }, now);
    assert.equal(store.lookup(account, "1004", 2004, { nowMs: now + 60, maxAgeMs: 100 }).state, "cached_unverified");
    assert.equal(store.lookup(account, "1004", 2004, { nowMs: now + 101, maxAgeMs: 100 }).state, "refresh_required");
    assert.equal(store.listPending(account, 10, { nowMs: now + 101, maxAgeMs: 100 }).some((i) => i.itemInstanceId === "1004"), true);
  });
  test("15 Malformed identities, fingerprints and unbounded batch sizes are rejected", () => {
    assert.throws(() => store.applyInventorySnapshot({ membershipType: 0, membershipId: "x" }, [], "full_account"));
    assert.throws(() => store.applyInventorySnapshot(account, [item("not-id", 2001)], "partial"));
    assert.throws(() => store.applyInventorySnapshot(account, [item("1006", 2006, "equipped", "bad")], "partial"));
    assert.throws(() => store.listPending(account, 1000), /limit/);
    assert.throws(() => store.saveDetail(account, { itemInstanceId: "1006", itemHash: 2006, nested: { accessToken: "hidden" }, name: Infinity }));
  });
  test("16 Input objects aren't mutated or promoted to Bungie-verified status", () => {
    const original = Object.freeze({ itemInstanceId: "1006", itemHash: 2006, name: "Original" });
    store.saveDetail(account, original, now);
    const read = store.lookup(account, "1006", 2006, { nowMs: now });
    assert.equal(read.state, "cached_unverified");
    assert.equal(original.name, "Original");
    assert.equal((read.detail as any)?.certifiedForOptimization, undefined);
  });
  test("17 No raw OAuth token or membership ID appears in persisted file", () => {
    store.close();
    store = openItemDetailStore(dbPath);
    const bytes = readFileSync(dbPath);
    assert.equal(bytes.includes(Buffer.from("SECRET_NEVER_STORE")), false);
    assert.equal(bytes.includes(Buffer.from(account.membershipId)), false);
    assert.ok(statSync(dbPath).size > 0);
  });
  test("18 An absent item returning later requires fresh details, never reuses a past record", () => {
    store.applyInventorySnapshot(account, [item("1018", 2018)], "partial", now);
    store.saveDetail(account, { itemInstanceId: "1018", itemHash: 2018, name: "Old item" }, now);
    store.applyInventorySnapshot(account, [item("1006", 2006)], "full_account", now + 1);
    assert.equal(store.lookup(account, "1018", 2018).state, "not_current");
    store.applyInventorySnapshot(account, [item("1018", 2018)], "partial", now + 2);
    assert.equal(store.lookup(account, "1018", 2018).state, "missing");
  });
  test("19 No silent network calls: default path is outside the project's public folder", () => {
    assert.ok(defaultItemDetailDatabasePath().endsWith("item-details-v1.sqlite"));
    assert.equal(store.summary(account).certified, false);
  });
  for (const [label, action] of tests) {
    action(); passed++;
    console.log(`PASS ${label}`);
  }
  console.log(`SYNC-1: ${passed}/${tests.length} offline checks passed. No network calls or Bungie/OpenAI writes.`);
} finally {
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
