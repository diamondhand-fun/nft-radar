import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { encodeAbiParameters } from "viem";
import { event, token, hash, blockHash, metadata } from "../examples/fixture.mjs";

test("CLI crosses the real HTTP/JSON-RPC and ABI boundary", async () => {
  const methods = [], calls = [];
  // Resolve selectors independently from the reader's call order.
  const { toFunctionSelector } = await import("viem");
  const selectors = Object.fromEntries(Object.entries(metadata).map(([name, value]) => [toFunctionSelector(`${name}()`), value]));
  const server = createServer(async (request, response) => {
    if (request.url === "/provider-secret") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "provider-secret in upstream error" } }));
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const { id, method, params } = JSON.parse(raw);
    methods.push(method);
    let result;
    if (method === "eth_chainId") result = "0x1237";
    else if (method === "eth_getTransactionReceipt") result = {
      transactionHash: hash, transactionIndex: "0x0", blockHash, blockNumber: "0x4c4b3ff",
      from: token, to: token, cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1",
      status: "0x1", type: "0x2", logsBloom: "0x" + "00".repeat(256),
      logs: [{ ...event(), blockHash, blockNumber: "0x4c4b3ff", transactionHash: hash, transactionIndex: "0x0", logIndex: "0x0", removed: false }],
    };
    else if (method === "eth_getBlockByNumber") result = {
      hash: blockHash, number: params[0] === "latest" ? "0x4c4b400" : params[0], timestamp: "0x6b49d200", transactions: [],
    };
    else if (method === "eth_call") {
      calls.push(params);
      result = encodeAbiParameters([{ type: "string" }], [selectors[params[0].data]]);
    } else assert.fail(`Unexpected RPC method: ${method}`);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const child = spawn(process.execPath, [new URL("../src/cli.mjs", import.meta.url).pathname, hash], {
      env: { ...process.env, RADAR_RPC_URL: `http://127.0.0.1:${server.address().port}` },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [code] = await once(child, "close");
    assert.equal(code, 0, stderr);
    const report = JSON.parse(stdout);
    assert.equal(report.sourceUrl, "https://zecbit.net/item/synthetic-fixture/1");
    assert.equal(report.metadataBlock, "80000000");
    assert.equal(calls.length, 4);
    assert(calls.every(params => params[1] === "0x4c4b400"));
    assert.equal(methods.filter(method => method === "eth_getTransactionReceipt").length, 1);
    const failed = spawn(process.execPath, [new URL("../src/cli.mjs", import.meta.url).pathname, "--json-errors", hash], {
      env: { ...process.env, RADAR_RPC_URL: `http://127.0.0.1:${server.address().port}/provider-secret` },
    });
    let failure = "";
    failed.stderr.on("data", chunk => { failure += chunk; });
    const [failedCode] = await once(failed, "close");
    assert.equal(failedCode, 1);
    assert.equal(JSON.parse(failure).error.code, "rpc_error");
    assert(!failure.includes("provider-secret"));
    const directory = await mkdtemp(join(tmpdir(), "radar-output-"));
    const output = join(directory, "launch.json");
    const save = async (destination, suffix = "") => {
      const saving = spawn(process.execPath, [new URL("../src/cli.mjs", import.meta.url).pathname, "--json-errors", "--output", destination, hash], {
        env: { ...process.env, RADAR_RPC_URL: `http://127.0.0.1:${server.address().port}${suffix}` },
      });
      let stdout = "", stderr = "";
      saving.stdout.on("data", chunk => { stdout += chunk; });
      saving.stderr.on("data", chunk => { stderr += chunk; });
      const [code] = await once(saving, "close");
      return { code, stdout, stderr };
    };
    try {
      const saved = await save(output);
      assert.equal(saved.code, 0, saved.stderr);
      assert.equal(saved.stdout, "");
      const bytes = await readFile(output, "utf8");
      assert.equal(JSON.parse(bytes).hash, hash);
      const duplicate = await save(output);
      assert.equal(duplicate.code, 1);
      assert.equal(JSON.parse(duplicate.stderr).error.code, "output_error");
      assert.equal(await readFile(output, "utf8"), bytes);
      const missing = await save(join(directory, "missing", "file.json"));
      assert.equal(JSON.parse(missing.stderr).error.code, "output_error");
      const rejected = await save(join(directory, "failed.json"), "/provider-secret");
      assert.equal(JSON.parse(rejected.stderr).error.code, "rpc_error");
      assert.deepEqual(await readdir(directory), ["launch.json"]);
    } finally { await rm(directory, { recursive: true, force: true }); }

  } finally { server.closeAllConnections(); server.close(); }
});
