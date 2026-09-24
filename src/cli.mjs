import { inspectLaunch, radarClient } from "./index.mjs";

try {
  const [input, selectedToken] = process.argv.slice(2);
  if (!input || process.argv.length > 4) throw new Error("Usage: npm run --silent inspect -- <token-or-tx-hash> [selected-token]");
  console.log(JSON.stringify(await inspectLaunch(input, radarClient(process.env.RADAR_RPC_URL), selectedToken), null, 2));
} catch (error) {
  // RPC exceptions can include provider URLs. Keep credentials out of terminal output.
  console.error(error.name === "Error" ? error.message : "RPC inspection failed. Check your provider and input.");
  process.exitCode = 1;
}
