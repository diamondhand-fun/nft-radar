import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { radarClient } from "../src/index.mjs";

test("bound streamed RPC bodies and cancel stalled transfers", async () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/large") response.end(" ".repeat(2_000_001));
    else response.write('{"jsonrpc":'); // Deliberately never finish the body.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(radarClient(url + "/large").getChainId(), /size|large|exceed/i);
    let timer;
    try {
      await assert.rejects(Promise.race([
        radarClient(url, { timeoutMs: 100 }).getChainId(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("body timeout missing")), 1000); }),
      ]), error => error.message !== "body timeout missing");
    } finally { clearTimeout(timer); }
    const controller = new AbortController();
    const pending = radarClient(url, { signal: controller.signal }).getChainId();
    controller.abort();
    await assert.rejects(pending);
    for (const timeoutMs of [0, -1, 1.5, Infinity, 120_001]) assert.throws(() => radarClient(url, { timeoutMs }), /timeout/);
    assert.throws(() => radarClient("file:///tmp/rpc"), /HTTP/);
  } finally { server.closeAllConnections(); server.close(); }
});
