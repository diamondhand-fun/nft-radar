![Diamond Hand](assets/banner.png)

# NFT Radar

**Trace a token launch back to its source NFT.**

The read-only inspection core behind Diamond Hand Radar. Give it a token address
or a launch transaction hash; it checks the chain, factory event, receipt and
block consistency, then extracts the Zecbit NFT reference from current token metadata.

[How it works](docs/verification.md) · [Offline example](examples/demo.mjs) ·
[Zecbit Parser](https://github.com/diamondhand-fun/zecbit-parser)

## Inspect a launch

Requires Node.js 22 or newer. One runtime dependency: `viem`.
No wallet connection or signing key is required.

```sh
npm ci --ignore-scripts
read -r TX_HASH
npm run --silent inspect -- "$TX_HASH"
```

Paste a launch transaction hash when `read` waits for input. The same command
accepts a token address. For a transaction containing multiple launches, add
the selected token address as a second argument. `RADAR_RPC_URL` selects a
custom RPC provider; otherwise the preset's public endpoint is used.

```js
import { inspectLaunch, radarClient } from "./src/index.mjs";

const report = await inspectLaunch(transactionHash, radarClient());
console.log(report.sourceUrl, report.metadataBlock);
```

The deployment preset comes from Diamond Hand: chain ID **4663**, factory
`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`.

## What gets checked

| Check | Rejection condition |
| --- | --- |
| Network | RPC chain ID differs from the deployment preset |
| Transaction | Receipt hash does not match the request, or receipt is not successful |
| Origin | No matching `TokenLaunched` event from the configured factory |
| Selection | Multiple token launches without an explicit selection |
| Blocks | Launch or metadata block hash changes during inspection |
| NFT reference | Missing or noncanonical Zecbit item URL |
| Metadata | Invalid name, ticker or HTTPS artwork reference |

Token lookup scans at most ten successful windows of up to 800,000 blocks,
never below block 70,000,000. When a provider rejects a log range, the window
is halved without skipping blocks. Each lookup is capped at 40 RPC attempts. For older launches, supply the transaction hash or set explicit history bounds
with `{ fromBlock: 71000000n, toBlock: 72000000n }`. The CLI equivalents are
`--from-block 71000000 --to-block 72000000`; these apply only to token lookup
and retain the same request caps. Narrow the range further if your provider
limits scan windows. Transaction lookup
uses the receipt directly; it does not scan the chain.

## Report

The JSON report contains `schema`, `chainId`, `factory`, `token`, `hash`,
`sourceUrl`, `name`, `symbol`, `imageUrl`, `block`, `confirmedAt`, `checkedAt`,
`metadataState`, `metadataBlock`, `metadataBlockHash` and `confirmations`. Block numbers are
decimal strings, so JSON serialization does not lose bigint precision.
The report also includes the launch `blockHash` and event provenance: `curve`,
`deployer`, `pairToken`, `launchConfigId` and `graduationThreshold`. The two
uint256 event values are decimal strings, including values above 2^53.

`metadataState: "current"` means the latest block captured at the start of
metadata retrieval. All four contract reads use that exact block number and its
hash is checked again afterward. Metadata is not reconstructed at launch time.
`confirmedAt` is the receipt block's timestamp, not a finality guarantee.
A matching reference establishes what the token claims about its
source; it does **not** prove NFT ownership, creator identity or endorsement.

## Scope

This repository contains the reusable inspection core and CLI. The application's
radar interface, indexed catalog, signing flows and deployment configuration are
outside this extraction. It submits no transactions and downloads no artwork.
It trusts the configured RPC; it is not a light client or cryptographic proof system.

Pair it with [Zecbit Parser](https://github.com/diamondhand-fun/zecbit-parser)
to turn the returned source page into structured NFT traits and artwork metadata.

## Development and validation

```sh
npm test
npm run demo
```

Tests cover failure paths and the full CLI → HTTP → JSON-RPC → ABI decoding
path using a local RPC server. The demo is a reproducible example requiring no
network. See [validation notes](docs/validation.md) for live checks.

Maintained by [Diamond Hand](https://github.com/diamondhand-fun).
The package is marked private to prevent accidental npm publication; the repository is public.

Validation failures are `RadarError` instances with a stable `code` (for example
`wrong_chain`, `invalid_receipt`, `ambiguous_launch`, `metadata_reorg`). Applications
can branch on the code instead of parsing human-readable messages.

Report token addresses use EIP-55 checksum casing; transaction hashes are
lowercase, so token and transaction lookups produce the same identity.

Require a confirmation depth with
`inspectLaunch(hash, client, selectedToken, { minConfirmations: 12 })`.
The default is one inclusion. `confirmations` is a decimal string observed at
inspection time; confirmation depth does not guarantee permanent finality.

RPC responses are limited to 2 MB and each complete transfer, including the
response body, has a 12-second deadline. Use
`radarClient(url, { signal, timeoutMs: 5000 })` for cancellation or a tighter
deadline. Timeouts must be 1–120,000 ms. Failed requests are not retried.

For automation, the CLI accepts `--confirmations 12`, `--timeout 5000` and
`--json-errors`. Reports go to stdout; failures go to stderr as
`{"error":{"code":"...","message":"..."}}` with exit status 1. Upstream RPC
URLs and messages are redacted from failures. `--help` lists the available flags.

TypeScript declarations cover the client, options, stable error codes and
report schema. `npm test` checks public package imports and expected type errors
as well as the runtime checks. TypeScript is a development dependency only.
