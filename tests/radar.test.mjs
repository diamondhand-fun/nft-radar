import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { inspectLaunch, factory } from "../src/index.mjs";
import { token, hash, metadata, event, receipt, fixtureClient } from "../examples/fixture.mjs";

test("inspect a transaction and token without a wallet", async () => {
  for (const input of [hash, token]) {
    const result = await inspectLaunch(input, fixtureClient());
    assert.equal(result.token.toLowerCase(), token);
    assert.equal(result.hash, hash);
    assert.equal(result.sourceUrl, "https://zecbit.net/item/synthetic-fixture/1");
    assert.equal(result.metadataState, "current");
    assert.equal(result.chainId, 4663);
    assert.equal(result.factory, factory);
    assert.equal(result.block, "79999999");
    assert(Number.isFinite(Date.parse(result.checkedAt)));
  }
});

test("reject bad input and wrong chain before receipt reads", async () => {
  const client = { ...fixtureClient(), getTransactionReceipt: () => assert.fail("Must not read receipt") };
  for (const input of [null, {}, "bad", "0x12"]) await assert.rejects(inspectLaunch(input, client), /token address/);
  await assert.rejects(inspectLaunch(hash, client, "bad"), /selected token/);
  await assert.rejects(inspectLaunch(hash, { ...client, getChainId: async () => 1 }), /different chain/);
});

test("reject reverted, wrong-factory, malformed and mismatched events", async () => {
  const client = fixtureClient();
  await assert.rejects(inspectLaunch(hash, { ...client, getTransactionReceipt: async () => ({ ...receipt(), status: "reverted" }) }), /successful launch/);
  for (const log of [{ ...event(), address: "0x" + "00".repeat(20) }, { ...event(), data: "0x" }]) {
    await assert.rejects(inspectLaunch(hash, { ...client, getTransactionReceipt: async () => ({ ...receipt(), logs: [log] }) }), /No supported factory/);
  }
  await assert.rejects(inspectLaunch(hash, client, "0x" + "33".repeat(20)), /No matching token/);
});

test("require selection for multi-launch receipts; deduplicate token identities", async () => {
  const other = "0x" + "33".repeat(20);
  const client = { ...fixtureClient(), getTransactionReceipt: async () => ({ ...receipt(), logs: [event(), event(other)] }) };
  await assert.rejects(inspectLaunch(hash, client), /several launches/);
  assert.equal((await inspectLaunch(hash, client, token)).token, token);
  const duplicate = { ...client, getTransactionReceipt: async () => ({ ...receipt(), logs: [event(), event()] }) };
  assert.equal((await inspectLaunch(hash, duplicate)).token, token);
  await assert.rejects(inspectLaunch(token, client, other), /does not match the input/);
});

test("detect changed blocks and reject invalid source or image references", async () => {
  await assert.rejects(inspectLaunch(hash, { ...fixtureClient(), getBlock: async () => ({ hash, timestamp: 1n }) }), /block changed/);
  for (const patch of [
    { description: "No reference" },
    { description: "Source NFT: https://zecbit.net.evil.test/item/a/1" },
    { description: "Source NFT: https://zecbit.net/item/a/0" },
    { description: "Source NFT: https://zecbit.net/item/a/1?tracking=yes" },
    { logo: "javascript:alert(1)" }, { logo: "https://user:pass@example.com/image.png" },
    { name: "x".repeat(257) }, { symbol: "BAD TICKER" },
  ]) {
    const values = { ...metadata, ...patch };
    await assert.rejects(inspectLaunch(hash, { ...fixtureClient(), readContract: async ({ functionName }) => values[functionName] }), /supported Zecbit/);
  }
});

test("bound scan to ten contiguous windows and stop at deployment floor", async () => {
  const windows = [];
  const client = { ...fixtureClient(), getLogs: async input => { windows.push(input); return []; } };
  await assert.rejects(inspectLaunch(token, client), /recent history/);
  assert.equal(windows.length, 10);
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    assert.equal(window.toBlock - window.fromBlock + 1n, 800_000n);
    assert.equal(window.address, factory);
    assert.equal(window.args.token, token);
    if (i) assert.equal(window.toBlock, windows[i - 1].fromBlock - 1n);
  }
  windows.length = 0;
  await assert.rejects(inspectLaunch(token, { ...client, getBlockNumber: async () => 70_000_010n }), /recent history/);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].fromBlock, 70_000_000n);
});

test("CLI rejects missing and malformed input without network access", () => {
  for (const args of [[], ["bad"]]) {
    const result = spawnSync(process.execPath, [new URL("../src/cli.mjs", import.meta.url).pathname, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert(result.stderr.trim());
  }
});
