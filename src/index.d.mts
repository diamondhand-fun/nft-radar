import type { AbiEvent, Address, Chain, Hash, PublicClient } from "viem";

export const chain: Chain;
export const factory: Address;
export const launchEvent: AbiEvent;
export type RadarErrorCode = "inspection_failed" | "invalid_input" | "invalid_selection"
  | "invalid_options" | "wrong_chain" | "token_mismatch" | "launch_not_found"
  | "invalid_receipt" | "launch_reverted" | "ambiguous_launch" | "invalid_metadata_block"
  | "launch_reorg" | "metadata_reorg" | "invalid_block" | "ambiguous_source"
  | "invalid_metadata" | "insufficient_confirmations" | "output_error";
export type ScanProgress = { fromBlock: string; toBlock: string; nextToBlock: string | null; windows: number; attempts: number };
export class RadarError extends Error {
  readonly code: RadarErrorCode;
  readonly details?: ScanProgress;
  constructor(message: string, code?: RadarErrorCode, details?: ScanProgress);
}
export type LaunchReport = {
  schema: "diamond-hand.launch-check.v1";
  chainId: number;
  factory: Address;
  token: Address;
  hash: Hash;
  curve: Address;
  deployer: Address;
  pairToken: Address;
  launchConfigId: string;
  graduationThreshold: string;
  blockHash: Hash;
  sourceUrl: string;
  name: string;
  symbol: string;
  imageUrl: string;
  block: string;
  confirmedAt: string;
  checkedAt: string;
  metadataState: "current";
  metadataBlockTag: "latest" | "safe" | "finalized";
  metadataBlock: string;
  metadataBlockHash: Hash;
  confirmations: string;
};
export type RadarClient = Pick<PublicClient, "getChainId" | "getBlockNumber" | "getLogs" | "getTransactionReceipt" | "getBlock" | "readContract">;
export function radarClient(rpcUrl?: string, options?: { signal?: AbortSignal; timeoutMs?: number }): PublicClient;
export function inspectLaunch(input: string, client?: RadarClient, selectedToken?: Address, options?: { minConfirmations?: number; fromBlock?: bigint; toBlock?: bigint; blockTag?: "latest" | "safe" | "finalized" }): Promise<LaunchReport>;
