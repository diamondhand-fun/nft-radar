import { parseArgs } from "node:util";
import { inspectLaunch, radarClient, RadarError } from "./index.mjs";

const usage = "Usage: npm run --silent inspect -- [--confirmations N] [--timeout MS] [--json-errors] <token-or-tx-hash> [selected-token]";
const jsonErrors = process.argv.includes("--json-errors");
try {
  let args;
  try {
    args = parseArgs({ allowPositionals: true, options: {
      help: { type: "boolean", short: "h" }, "json-errors": { type: "boolean" },
      confirmations: { type: "string", default: "1" }, timeout: { type: "string", default: "12000" },
    } });
  } catch { throw new RadarError("Invalid arguments. Use --help.", "invalid_input"); }
  const { values, positionals } = args;
  if (values.help) console.log(usage);
  else {
    if (positionals.length < 1 || positionals.length > 2) throw new RadarError(usage, "invalid_input");
    if (![values.confirmations, values.timeout].every(value => /^[1-9][0-9]*$/.test(value))) throw new RadarError("Confirmations and timeout must be positive integers.", "invalid_options");
    const client = radarClient(process.env.RADAR_RPC_URL, { timeoutMs: Number(values.timeout) });
    const report = await inspectLaunch(positionals[0], client, positionals[1], { minConfirmations: Number(values.confirmations) });
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  const code = error instanceof RadarError ? error.code : "rpc_error";
  const message = error instanceof RadarError ? error.message : "RPC inspection failed. Check your provider and input.";
  console.error(jsonErrors ? JSON.stringify({ error: { code, message } }) : message);
  process.exitCode = 1;
}
