import { inspectLaunch, radarClient, RadarError, type LaunchReport } from "@diamondhand-fun/nft-radar";
const client = radarClient(undefined, { signal: AbortSignal.timeout(1000), timeoutMs: 500 });
const report: Promise<LaunchReport> = inspectLaunch("input", client, undefined, { minConfirmations: 12 });
const error = new RadarError("Wrong chain", "wrong_chain");
const code: string = error.code;
report.then(result => {
  const block: string = result.metadataBlock;
  const confirmations: string = result.confirmations;
  const address: `0x${string}` = result.token;
  // @ts-expect-error Big block numbers are encoded as strings.
  const numeric: number = result.block;
});
// @ts-expect-error Selected tokens must be address-shaped.
inspectLaunch("input", client, "not-an-address");
// @ts-expect-error Confirmation counts are numeric.
inspectLaunch("input", client, undefined, { minConfirmations: "12" });
