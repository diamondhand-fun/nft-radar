import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { inspectLaunch, factory, RadarError } from "../src/index.mjs";
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
  assert.equal((await inspectLaunch(hash, client, token)).token.toLowerCase(), token);
  const duplicate = { ...client, getTransactionReceipt: async () => ({ ...receipt(), logs: [event(), event()] }) };
  assert.equal((await inspectLaunch(hash, duplicate)).token.toLowerCase(), token);
  await assert.rejects(inspectLaunch(token, client, other), /does not match the input/);
});

test("detect changed blocks and reject invalid source or image references", async () => {
  await assert.rejects(inspectLaunch(hash, { ...fixtureClient(), getBlock: async ({ blockNumber = 80_000_000n } = {}) => ({ number: blockNumber, hash, timestamp: 1n }) }), /block changed/);
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

test("reject inconsistent receipt identity and null block hashes", async () => {
  for (const patch of [{ transactionHash: "0x" + "cc".repeat(32) }, { transactionHash: undefined }, { blockHash: null }, { blockNumber: null }]) {
    await assert.rejects(inspectLaunch(hash, { ...fixtureClient(), getTransactionReceipt: async () => ({ ...receipt(), ...patch }) }), /inconsistent transaction/);
  }
});

test("pin metadata to one block and detect reorganizations during reads", async () => {
  const client = fixtureClient();
  const heights = [];
  const result = await inspectLaunch(hash, { ...client, readContract: async input => {
    heights.push(input.blockNumber);
    return client.readContract(input);
  } });
  assert.deepEqual(heights, Array(4).fill(80_000_000n));
  assert.equal(result.metadataBlock, "80000000");
  const reorg = { ...client, getBlock: async input => ({
    ...await client.getBlock(input),
    ...(input.blockNumber === 80_000_000n ? { hash: "0x" + "cc".repeat(32) } : {}),
  }) };
  await assert.rejects(inspectLaunch(hash, reorg), /metadata block changed/);
});


test("expose stable error codes for application error handling", async () => {
  await assert.rejects(inspectLaunch("bad", fixtureClient()), error => error instanceof RadarError && error.code === "invalid_input");
  await assert.rejects(inspectLaunch(hash, { ...fixtureClient(), getChainId: async () => 1 }), error => error.code === "wrong_chain");
  await assert.rejects(inspectLaunch(hash, { ...fixtureClient(), getTransactionReceipt: async () => ({ ...receipt(), status: "reverted" }) }), error => error.code === "launch_reverted");
});


test("normalize report addresses and transaction hashes for stable identity", async () => {
  const { getAddress } = await import("viem");
  const result = await inspectLaunch(hash.toUpperCase(), fixtureClient());
  assert.equal(result.hash, hash);
  assert.equal(result.token, getAddress(token));
  assert.equal((await inspectLaunch(token, fixtureClient())).token, result.token);
});


test("discard removed logs and reject event identities outside the receipt", async () => {
  const withLogs = logs => ({ ...fixtureClient(), getTransactionReceipt: async () => ({ ...receipt(), logs }) });
  await assert.rejects(inspectLaunch(hash, withLogs([{ ...event(), removed: true }])), error => error.code === "launch_not_found");
  for (const patch of [{ transactionHash: "0x" + "cc".repeat(32) }, { blockHash: "0x" + "cc".repeat(32) }, { blockNumber: 1n }]) {
    await assert.rejects(inspectLaunch(hash, withLogs([{ ...event(), ...patch }])), error => error.code === "invalid_receipt");
  }
  assert.equal((await inspectLaunch(hash, withLogs([null, {}, event()]))).hash, hash);
});


test("reject malformed block timestamps before JSON serialization", async () => {
  const client = fixtureClient();
  for (const timestamp of [undefined, "123", -1n, 8_640_000_000_001n]) {
    await assert.rejects(inspectLaunch(hash, { ...client, getBlock: async input => ({ ...await client.getBlock(input), timestamp }) }), error => error.code === "invalid_block");
  }
  const result = await inspectLaunch(hash, { ...client, getBlock: async input => ({ ...await client.getBlock(input), timestamp: 0n }) });
  assert.equal(result.confirmedAt, "1970-01-01T00:00:00.000Z");
});


test("reject conflicting NFT references while allowing repeated identical sources", async () => {
  const client = fixtureClient();
  const withDescription = description => ({ ...client, readContract: async input => input.functionName === "description" ? description : client.readContract(input) });
  await assert.rejects(inspectLaunch(hash, withDescription(metadata.description + "\nSource NFT: https://zecbit.net/item/other/2")), error => error.code === "ambiguous_source");
  const report = await inspectLaunch(hash, withDescription(metadata.description + "\r\n" + metadata.description));
  assert.equal(report.sourceUrl, "https://zecbit.net/item/synthetic-fixture/1");
});


test("enforce confirmation depth before fetching metadata", async () => {
  const client = fixtureClient();
  const report = await inspectLaunch(hash, client, undefined, { minConfirmations: 2 });
  assert.equal(report.confirmations, "2");
  await assert.rejects(inspectLaunch(hash, { ...client, readContract: () => assert.fail("Too early to read metadata") }, undefined, { minConfirmations: 3 }), error => error.code === "insufficient_confirmations");
  for (const minConfirmations of [0, -1, 1.5, NaN]) {
    await assert.rejects(inspectLaunch(hash, client, undefined, { minConfirmations }), error => error.code === "invalid_options");
  }
});


test("shrink rejected RPC ranges without skipping blocks or retrying outages", async () => {
  const client = fixtureClient();
  const calls = [];
  const report = await inspectLaunch(token, { ...client, getLogs: async input => {
    calls.push(input);
    if (input.toBlock - input.fromBlock + 1n > 100_000n) throw Object.assign(new Error("query exceeds limit"), { code: -32000 });
    return calls.filter(x => x.toBlock - x.fromBlock + 1n <= 100_000n).length === 2 ? [{ transactionHash: hash }] : [];
  } });
  assert.equal(report.hash, hash);
  assert.equal(calls.length, 5);
  assert.equal(calls[4].toBlock, calls[3].fromBlock - 1n);
  let count = 0;
  const outage = new Error("HTTP 429: too many requests");
  await assert.rejects(inspectLaunch(token, { ...client, getLogs: async () => { count++; throw outage; } }), error => error === outage);
  assert.equal(count, 1);
});


test("CLI documents options and returns machine-readable validation failures", () => {
  const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--confirmations/);
  for (const args of [["bad"], ["--confirmations", "zero", hash]]) {
    const result = spawnSync(process.execPath, [cli, "--json-errors", ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(JSON.parse(result.stderr).error.code, /^invalid_(input|options)$/);
  }
});


test("reject malformed RPC responses with stable codes instead of TypeErrors", async () => {
  const client = fixtureClient();
  for (const value of [null, undefined, {}]) {
    await assert.rejects(inspectLaunch(hash, { ...client, getTransactionReceipt: async () => value }), error => error.code === "invalid_receipt");
    await assert.rejects(inspectLaunch(hash, { ...client, getBlock: async () => value }), error => error.code === "invalid_metadata_block");
    await assert.rejects(inspectLaunch(token, { ...client, getLogs: async () => value }), error => error.code === "invalid_receipt");
  }
  for (const value of [null, -1n, 80000000]) await assert.rejects(inspectLaunch(token, { ...client, getBlockNumber: async () => value }), error => error.code === "invalid_block");
  assert.equal((await inspectLaunch(token, { ...client, getLogs: async () => [null, {}, { transactionHash: hash }] })).hash, hash);
  for (const [height, code] of [[79_999_999n, "launch_reorg"], [80_000_000n, "metadata_reorg"]]) {
    await assert.rejects(inspectLaunch(hash, { ...client, getBlock: async input => input.blockNumber === height ? null : client.getBlock(input) }), error => error.code === code);
  }
});
