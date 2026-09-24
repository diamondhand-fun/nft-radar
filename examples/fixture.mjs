import { encodeAbiParameters, encodeEventTopics, zeroAddress } from "viem";
import { chain, factory, launchEvent } from "../src/index.mjs";

export const token = "0x" + "ab".repeat(20);
export const hash = "0x" + "aa".repeat(32);
export const blockHash = "0x" + "bb".repeat(32);
export const metadata = {
  name: "Synthetic launch", symbol: "SYN",
  description: "Source NFT: https://zecbit.net/item/synthetic-fixture/1",
  logo: "https://example.com/synthetic.png",
};
export const event = (address = token) => ({
  address: factory,
  topics: encodeEventTopics({ abi: [launchEvent], eventName: "TokenLaunched", args: { token: address, curve: address, deployer: zeroAddress } }),
  data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }], [zeroAddress, 0n, 1n]),
});
export const receipt = () => ({ status: "success", logs: [event()], blockNumber: 79_999_999n, blockHash });
export const fixtureClient = () => ({
  getChainId: async () => chain.id,
  getBlockNumber: async () => 80_000_000n,
  getLogs: async () => [{ transactionHash: hash }],
  getTransactionReceipt: async () => receipt(),
  getBlock: async () => ({ hash: blockHash, timestamp: 1_800_000_000n }),
  readContract: async ({ functionName }) => metadata[functionName],
});
