import { createPublicClient, decodeEventLog, defineChain, http, isAddress, getAddress, parseAbi, parseAbiItem, zeroAddress } from "viem";

// Deployment preset extracted from the Diamond Hand application.
export const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});
export const factory = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
export const launchEvent = parseAbiItem("event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)");
const metadataAbi = parseAbi([
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function description() view returns (string)", "function logo() view returns (string)",
]);
export class RadarError extends Error {
  constructor(message, code = "inspection_failed") {
    super(message);
    this.name = "RadarError";
    this.code = code;
  }
}

const isHash = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);

export function radarClient(rpcUrl, { signal, timeoutMs = 12_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new RadarError("RPC timeout must be between 1 and 120000 milliseconds.", "invalid_options");
  let url;
  try { url = new URL(rpcUrl ?? chain.rpcUrls.default.http[0]); } catch { throw new RadarError("Invalid RPC URL.", "invalid_options"); }
  if (!["https:", "http:"].includes(url.protocol)) throw new RadarError("RPC URL must use HTTP or HTTPS.", "invalid_options");
  return createPublicClient({ chain, transport: http(url.href, {
    timeout: timeoutMs, retryCount: 0, maxResponseBodySize: 2_000_000,
    fetchFn: (input, init) => fetch(input, { ...init, redirect: "error",
      signal: AbortSignal.any([init?.signal, signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)),
    }),
  }) });
}

export async function inspectLaunch(input, client = radarClient(), selectedToken, { minConfirmations = 1, fromBlock, toBlock, blockTag = "latest" } = {}) {
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1) throw new RadarError("Minimum confirmations must be a positive integer.", "invalid_options");
  if (!["latest", "safe", "finalized"].includes(blockTag)) throw new RadarError("Metadata block tag must be latest, safe or finalized.", "invalid_options");
  const value = typeof input === "string" ? input.trim() : "";
  if (value.toLowerCase() === zeroAddress || !isAddress(value) && !isHash(value)) throw new RadarError("Use a token address or launch transaction hash.", "invalid_input");
  if ([fromBlock, toBlock].some(height => height !== undefined && (typeof height !== "bigint" || height < 70_000_000n)) || fromBlock !== undefined && toBlock !== undefined && fromBlock > toBlock || (fromBlock !== undefined || toBlock !== undefined) && !isAddress(value))
    throw new RadarError("Search bounds require a token address and an ordered range at or above block 70000000.", "invalid_options");
  if (selectedToken !== undefined && (typeof selectedToken !== "string" || !isAddress(selectedToken) || selectedToken.toLowerCase() === zeroAddress)) throw new RadarError("Invalid selected token.", "invalid_selection");
  if (await client.getChainId() !== chain.id) throw new RadarError("The RPC returned a different chain. Verification stopped.", "wrong_chain");
  let token, hash;
  if (isAddress(value)) {
    token = value;
    if (selectedToken && selectedToken.toLowerCase() !== token.toLowerCase()) throw new RadarError("The selected token does not match the input.", "token_mismatch");
    let end = await client.getBlockNumber();
    if (typeof end !== "bigint" || end < 0n) throw new RadarError("The RPC returned an invalid chain height.", "invalid_block");
    if (toBlock !== undefined && toBlock > end || fromBlock !== undefined && fromBlock > end) throw new RadarError("Search bounds exceed the current chain height.", "invalid_options");
    end = toBlock ?? end;
    const floor = fromBlock ?? 70_000_000n;
    // ponytail: at most ten successful windows and forty RPC attempts per lookup.
    let span = 800_000n, windows = 0, attempts = 0;
    while (windows < 10 && attempts < 40 && end >= floor) {
      const start = end - span + 1n > floor ? end - span + 1n : floor;
      let logs;
      attempts++;
      try {
        logs = await client.getLogs({ address: factory, event: launchEvent, args: { token }, fromBlock: start, toBlock: end, strict: true });
      } catch (error) {
        let rangeLimit = false, cause = error;
        for (let depth = 0; cause && depth < 8; depth++, cause = cause.cause) {
          if (/block range|range.*(?:large|limit)|query.*(?:exceed|limit)|too many (?:results|logs)|logs.*limit|response size/i.test(`${cause.details ?? ""} ${cause.message ?? ""}`)) rangeLimit = true;
        }
        if (!rangeLimit || span === 1n) throw error;
        span = span / 2n || 1n;
        continue;
      }
      if (!Array.isArray(logs)) throw new RadarError("The RPC returned an invalid log list.", "invalid_receipt");
      windows++;
      const candidate = logs.find(log => log && !log.removed && isHash(log.transactionHash));
      if (candidate) { hash = candidate.transactionHash; break; }
      end = start - 1n;
    }
    if (!isHash(hash)) throw new RadarError("No launch found in the recent history range. Use its transaction hash.", "launch_not_found");
  } else hash = value;

  hash = hash.toLowerCase();
  const receipt = await client.getTransactionReceipt({ hash });
  if (!Array.isArray(receipt?.logs) || !isHash(receipt.transactionHash) || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || !isHash(receipt.blockHash) || typeof receipt.blockNumber !== "bigint" || receipt.blockNumber < 0n)
    throw new RadarError("The RPC returned an inconsistent transaction receipt.", "invalid_receipt");
  if (receipt.status !== "success") throw new RadarError("This transaction has not confirmed a successful launch.", "launch_reverted");
  const tokens = new Map();
  for (const log of receipt.logs) {
    if (log?.removed || typeof log?.address !== "string" || log.address.toLowerCase() !== factory.toLowerCase()) continue;
    if (!isHash(log.transactionHash) || log.transactionHash.toLowerCase() !== hash || !isHash(log.blockHash) || log.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() || log.blockNumber !== receipt.blockNumber)
      throw new RadarError("The RPC returned a log from a different receipt or block.", "invalid_receipt");
    let event;
    try { event = decodeEventLog({ abi: [launchEvent], data: log.data, topics: log.topics }); }
    catch { continue; } // Ignore unrelated or malformed logs.
    const key = event.args.token.toLowerCase();
    const previous = tokens.get(key);
    if (previous && Object.keys(previous).some(field => previous[field].toString().toLowerCase() !== event.args[field].toString().toLowerCase()))
      throw new RadarError("The receipt contains conflicting launch events for one token.", "invalid_receipt");
    tokens.set(key, event.args);
  }
  const expected = token || selectedToken;
  if (expected && !tokens.has(expected.toLowerCase())) throw new RadarError("No matching token launch was found in this transaction.", "token_mismatch");
  if (!expected && tokens.size !== 1) throw new RadarError(tokens.size ? "This transaction contains several launches. Select a token." : "No supported factory launch found in this transaction.", tokens.size ? "ambiguous_launch" : "launch_not_found");
  token = getAddress(expected || tokens.keys().next().value);
  const launch = tokens.get(token.toLowerCase());

  const snapshot = await client.getBlock({ blockTag });
  if (!isHash(snapshot?.hash) || typeof snapshot.number !== "bigint" || snapshot.number < 0n)
    throw new RadarError("The RPC returned an invalid metadata block.", "invalid_metadata_block");
  if (snapshot.number < receipt.blockNumber) throw new RadarError("The launch is not included in the selected metadata block yet.", "insufficient_confirmations");
  const confirmations = snapshot.number - receipt.blockNumber + 1n;
  if (confirmations < BigInt(minConfirmations)) throw new RadarError("The launch has not reached the requested confirmation depth.", "insufficient_confirmations");
  // Pin all metadata reads to one recent block; archive state is not required.
  const [name, symbol, description, logo] = await Promise.all(
    ["name", "symbol", "description", "logo"].map(functionName => client.readContract({ address: token, abi: metadataAbi, functionName, blockNumber: snapshot.number })),
  );
  const [block, checkedSnapshot] = await Promise.all([
    client.getBlock({ blockNumber: receipt.blockNumber }),
    client.getBlock({ blockNumber: snapshot.number }),
  ]);
  if (!isHash(block?.hash) || block.number !== receipt.blockNumber || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
    throw new RadarError("The launch block changed. Retry once the chain settles.", "launch_reorg");
  if (!isHash(checkedSnapshot?.hash) || checkedSnapshot.number !== snapshot.number || checkedSnapshot.hash.toLowerCase() !== snapshot.hash.toLowerCase())
    throw new RadarError("The metadata block changed. Retry once the chain settles.", "metadata_reorg");
  if (typeof block.timestamp !== "bigint" || block.timestamp < 0n || block.timestamp > 8_640_000_000_000n)
    throw new RadarError("The RPC returned an invalid block timestamp.", "invalid_block");
  if (typeof description !== "string" || description.length > 65_536 || typeof logo !== "string" || logo.length > 2048 || /[\x00-\x20\x7f\\]/.test(logo))
    throw new RadarError("This token does not contain supported Zecbit metadata.", "invalid_metadata");
  const references = typeof description === "string" ? description.split(/\r\n|[\r\n]/).filter(line => line.startsWith("Source NFT:")) : [];
  const sources = new Set(references.map(reference => reference.slice("Source NFT:".length).trim()));
  if (sources.size > 1) throw new RadarError("Token metadata contains conflicting NFT source references.", "ambiguous_source");
  const sourceUrl = [...sources][0] ?? "";
  const source = /^https:\/\/zecbit\.net\/item\/[a-z0-9][a-z0-9_-]{0,127}\/[1-9][0-9]{0,77}$/.test(sourceUrl);
  let imageUrl = "";
  try {
    const url = new URL(logo);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port) imageUrl = url.href;
  } catch { /* Invalid media references fail the metadata check below. */ }
  if (!source || typeof name !== "string" || !name.trim() || name.length > 256 || typeof symbol !== "string" || !/^[A-Za-z0-9]{1,16}$/.test(symbol) || !imageUrl)
    throw new RadarError("This token does not contain supported Zecbit metadata.", "invalid_metadata");
  return {
    schema: "diamond-hand.launch-check.v1", chainId: chain.id, factory,
    token, hash, sourceUrl, name, symbol, imageUrl,
    curve: getAddress(launch.curve), deployer: getAddress(launch.deployer), pairToken: getAddress(launch.pairToken),
    launchConfigId: launch.launchConfigId.toString(), graduationThreshold: launch.graduationThreshold.toString(),
    blockHash: receipt.blockHash.toLowerCase(),
    block: receipt.blockNumber.toString(), confirmedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    checkedAt: new Date().toISOString(), metadataState: "current", metadataBlockTag: blockTag,
    metadataBlock: snapshot.number.toString(), metadataBlockHash: snapshot.hash, confirmations: confirmations.toString(),
  };
}
