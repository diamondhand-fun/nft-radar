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
const isHash = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);

export function radarClient(rpcUrl) {
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }) });
}

export async function inspectLaunch(input, client = radarClient(), selectedToken) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!isAddress(value) && !isHash(value)) throw new Error("Use a token address or launch transaction hash.");
  if (selectedToken !== undefined && (typeof selectedToken !== "string" || !isAddress(selectedToken))) throw new Error("Invalid selected token.");
  if (await client.getChainId() !== chain.id) throw new Error("The RPC returned a different chain. Verification stopped.");
  let token, hash;
  if (isAddress(value)) {
    token = value;
    if (selectedToken && selectedToken.toLowerCase() !== token.toLowerCase()) throw new Error("The selected token does not match the input.");
    let end = await client.getBlockNumber();
    // ponytail: ten 800k-block windows; use a transaction hash for older launches.
    for (let i = 0; i < 10 && end >= 70_000_000n; i++) {
      const start = end - 799_999n > 70_000_000n ? end - 799_999n : 70_000_000n;
      const logs = await client.getLogs({ address: factory, event: launchEvent, args: { token }, fromBlock: start, toBlock: end, strict: true });
      if (logs.length) { hash = logs[0].transactionHash; break; }
      end = start - 1n;
    }
    if (!isHash(hash)) throw new Error("No launch found in the recent history range. Use its transaction hash.");
  } else hash = value;

  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("This transaction has not confirmed a successful launch.");
  const tokens = new Set();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: [launchEvent], data: log.data, topics: log.topics });
      tokens.add(event.args.token.toLowerCase());
    } catch { /* Ignore unrelated or malformed logs. */ }
  }
  const expected = token || selectedToken;
  if (expected && !tokens.has(expected.toLowerCase())) throw new Error("No matching token launch was found in this transaction.");
  if (!expected && tokens.size !== 1) throw new Error(tokens.size ? "This transaction contains several launches. Select a token." : "No supported factory launch found in this transaction.");
  token = expected || [...tokens][0];

  // The application reads current metadata because its RPC prunes historical state.
  const [name, symbol, description, logo, block] = await Promise.all([
    ...["name", "symbol", "description", "logo"].map(functionName => client.readContract({ address: token, abi: metadataAbi, functionName })),
    client.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  if (block.hash !== receipt.blockHash) throw new Error("The launch block changed. Retry once the chain settles.");
  const references = typeof description === "string" ? description.match(/^Source NFT: (.+)$/gm) ?? [] : [];
  const sourceUrl = references.at(-1)?.slice("Source NFT: ".length) ?? "";
  const source = /^https:\/\/zecbit\.net\/item\/[a-z0-9][a-z0-9_-]{0,127}\/[1-9][0-9]{0,77}$/.test(sourceUrl);
  let imageUrl = "";
  try {
    const url = new URL(logo);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port) imageUrl = url.href;
  } catch { /* Invalid media references fail the metadata check below. */ }
  if (!source || typeof name !== "string" || !name || name.length > 256 || typeof symbol !== "string" || !/^[A-Za-z0-9]{1,16}$/.test(symbol) || !imageUrl)
    throw new Error("This token does not contain supported Zecbit metadata.");
  return {
    schema: "diamond-hand.launch-check.v1", chainId: chain.id, factory,
    token, hash, sourceUrl, name, symbol, imageUrl,
    block: receipt.blockNumber.toString(), confirmedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    checkedAt: new Date().toISOString(), metadataState: "current",
  };
}
