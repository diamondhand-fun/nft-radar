import { createPublicClient, decodeEventLog, defineChain, http, isAddress, parseAbi, parseAbiItem } from "viem";

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

export function radarClient(rpcUrl) {
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }) });
}

export async function inspectLaunch(input, client = radarClient(), selectedToken) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!isAddress(value) && !isHash(value)) throw new RadarError("Use a token address or launch transaction hash.", "invalid_input");
  if (selectedToken !== undefined && (typeof selectedToken !== "string" || !isAddress(selectedToken))) throw new RadarError("Invalid selected token.", "invalid_selection");
  if (await client.getChainId() !== chain.id) throw new RadarError("The RPC returned a different chain. Verification stopped.", "wrong_chain");
  let token, hash;
  if (isAddress(value)) {
    token = value;
    if (selectedToken && selectedToken.toLowerCase() !== token.toLowerCase()) throw new RadarError("The selected token does not match the input.", "token_mismatch");
    let end = await client.getBlockNumber();
    // ponytail: ten 800k-block windows; use a transaction hash for older launches.
    for (let i = 0; i < 10 && end >= 70_000_000n; i++) {
      const start = end - 799_999n > 70_000_000n ? end - 799_999n : 70_000_000n;
      const logs = await client.getLogs({ address: factory, event: launchEvent, args: { token }, fromBlock: start, toBlock: end, strict: true });
      if (logs.length) { hash = logs[0].transactionHash; break; }
      end = start - 1n;
    }
    if (!isHash(hash)) throw new RadarError("No launch found in the recent history range. Use its transaction hash.", "launch_not_found");
  } else hash = value;

  const receipt = await client.getTransactionReceipt({ hash });
  if (!isHash(receipt.transactionHash) || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || !isHash(receipt.blockHash) || typeof receipt.blockNumber !== "bigint" || receipt.blockNumber < 0n)
    throw new RadarError("The RPC returned an inconsistent transaction receipt.", "invalid_receipt");
  if (receipt.status !== "success") throw new RadarError("This transaction has not confirmed a successful launch.", "launch_reverted");
  const tokens = new Set();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: [launchEvent], data: log.data, topics: log.topics });
      tokens.add(event.args.token.toLowerCase());
    } catch { /* Ignore unrelated or malformed logs. */ }
  }
  const expected = token || selectedToken;
  if (expected && !tokens.has(expected.toLowerCase())) throw new RadarError("No matching token launch was found in this transaction.", "token_mismatch");
  if (!expected && tokens.size !== 1) throw new RadarError(tokens.size ? "This transaction contains several launches. Select a token." : "No supported factory launch found in this transaction.", tokens.size ? "ambiguous_launch" : "launch_not_found");
  token = expected || [...tokens][0];

  const snapshot = await client.getBlock({ blockTag: "latest" });
  if (!isHash(snapshot.hash) || typeof snapshot.number !== "bigint" || snapshot.number < receipt.blockNumber)
    throw new RadarError("The RPC returned an invalid metadata block.", "invalid_metadata_block");
  // Pin all metadata reads to one recent block; archive state is not required.
  const [name, symbol, description, logo] = await Promise.all(
    ["name", "symbol", "description", "logo"].map(functionName => client.readContract({ address: token, abi: metadataAbi, functionName, blockNumber: snapshot.number })),
  );
  const [block, checkedSnapshot] = await Promise.all([
    client.getBlock({ blockNumber: receipt.blockNumber }),
    client.getBlock({ blockNumber: snapshot.number }),
  ]);
  if (!isHash(block.hash) || block.number !== receipt.blockNumber || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
    throw new RadarError("The launch block changed. Retry once the chain settles.", "launch_reorg");
  if (!isHash(checkedSnapshot.hash) || checkedSnapshot.number !== snapshot.number || checkedSnapshot.hash.toLowerCase() !== snapshot.hash.toLowerCase())
    throw new RadarError("The metadata block changed. Retry once the chain settles.", "metadata_reorg");
  const references = typeof description === "string" ? description.match(/^Source NFT: (.+)$/gm) ?? [] : [];
  const sourceUrl = references.at(-1)?.slice("Source NFT: ".length) ?? "";
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
    block: receipt.blockNumber.toString(), confirmedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    checkedAt: new Date().toISOString(), metadataState: "current",
    metadataBlock: snapshot.number.toString(), metadataBlockHash: snapshot.hash,
  };
}
