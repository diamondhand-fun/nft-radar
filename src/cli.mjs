import { mkdtemp, writeFile, link, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { inspectLaunch, radarClient, RadarError } from "./index.mjs";

const usage = "Usage: npm run --silent inspect -- [--confirmations N] [--timeout MS] [--deadline MS] [--block-tag latest|safe|finalized] [--scan-window N] [--from-block N] [--to-block N] [--output FILE] [--json-errors] <token-or-tx-hash> [selected-token]";
const jsonErrors = process.argv.includes("--json-errors");
try {
  let args;
  try {
    args = parseArgs({ allowPositionals: true, options: {
      help: { type: "boolean", short: "h" }, "json-errors": { type: "boolean" },
      output: { type: "string" }, deadline: { type: "string" },
      "block-tag": { type: "string", default: "latest" },
      "scan-window": { type: "string", default: "800000" },
      "from-block": { type: "string" }, "to-block": { type: "string" },
      confirmations: { type: "string", default: "1" }, timeout: { type: "string", default: "12000" },
    } });
  } catch { throw new RadarError("Invalid arguments. Use --help.", "invalid_input"); }
  const { values, positionals } = args;
  if (values.help) console.log(usage);
  else {
    if (positionals.length < 1 || positionals.length > 2) throw new RadarError(usage, "invalid_input");
    if (![values.confirmations, values.timeout, values["scan-window"]].every(value => /^[1-9][0-9]*$/.test(value))) throw new RadarError("Confirmations, timeout and scan window must be positive integers.", "invalid_options");
    const bounds = {};
    for (const [flag, key] of [["from-block", "fromBlock"], ["to-block", "toBlock"]]) {
      if (values[flag] !== undefined) {
        if (!/^[0-9]{1,30}$/.test(values[flag])) throw new RadarError("Search bounds must be decimal block numbers.", "invalid_options");
        bounds[key] = BigInt(values[flag]);
      }
    }
    if (values.output !== undefined && !values.output.trim()) throw new RadarError("Output path must not be empty.", "invalid_options");
    if (values.deadline !== undefined && (!/^[1-9][0-9]*$/.test(values.deadline) || Number(values.deadline) > 600_000)) throw new RadarError("Deadline must be between 1 and 600000 milliseconds.", "invalid_options");
    const client = radarClient(process.env.RADAR_RPC_URL, { timeoutMs: Number(values.timeout), signal: values.deadline === undefined ? undefined : AbortSignal.timeout(Number(values.deadline)) });
    const report = await inspectLaunch(positionals[0], client, positionals[1], { minConfirmations: Number(values.confirmations), scanWindow: Number(values["scan-window"]), blockTag: values["block-tag"], ...bounds });
    const json = JSON.stringify(report, null, 2) + "\n";
    if (values.output === undefined || values.output === "-") process.stdout.write(json);
    else {
      let directory;
      try {
        const destination = resolve(values.output);
        directory = await mkdtemp(join(dirname(destination), ".nft-radar-"));
        const temporary = join(directory, "report.json");
        await writeFile(temporary, json, { mode: 0o600 });
        await link(temporary, destination); // Publish complete bytes atomically; never overwrite.
      } catch (error) {
        throw new RadarError(error.code === "EEXIST" ? "Output file already exists." : "Could not save the report file.", "output_error");
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }
  }
} catch (error) {
  const code = error instanceof RadarError ? error.code : "rpc_error";
  const message = error instanceof RadarError ? error.message : "RPC inspection failed. Check your provider and input.";
  console.error(jsonErrors ? JSON.stringify({ error: { code, message, ...(error instanceof RadarError && error.details ? { details: error.details } : {}) } }) : message);
  process.exitCode = 1;
}
