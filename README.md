![Diamond Hand](assets/banner.png)

# NFT Radar

**Trace a token launch back to its source NFT.**

The read-only inspection core behind Diamond Hand Radar. Give it a token address
or a launch transaction hash; it checks the chain, factory event, receipt and
block consistency, then extracts the Zecbit NFT reference from current token metadata.

[How it works](docs/verification.md) · [Offline example](examples/demo.mjs) ·
[Zecbit Parser](https://github.com/diamondhand-fun/zecbit-parser)

## Try it without a wallet

Requires Node.js 22 or newer. One runtime dependency: `viem`.

```sh
npm ci --ignore-scripts
npm test
npm run demo
```

The demo uses synthetic events and a local client fixture. It makes **zero
network calls** and requires no keys, tokens, wallet or deployed contracts.

## Inspect a real launch

```sh
npm run --silent inspect -- <transaction-hash>
npm run --silent inspect -- <token-address>
npm run --silent inspect -- <transaction-hash> <selected-token-address>
```

Replace the angle-bracket placeholders before running. Set `RADAR_RPC_URL` to
use your own provider. The default deployment preset comes from Diamond Hand:
chain ID **4663**, factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`.
Provider availability is not required or exercised by CI.

```js
import { inspectLaunch, radarClient } from "./src/index.mjs";

const report = await inspectLaunch(transactionHash, radarClient());
console.log(report.sourceUrl, report.metadataState);
```

## What gets checked

| Check | Rejection condition |
| --- | --- |
| Network | RPC chain ID differs from the deployment preset |
| Transaction | Receipt is not successful |
| Origin | No matching `TokenLaunched` event from the configured factory |
| Selection | Multiple token launches without an explicit selection |
| Block | Receipt block hash differs from the fetched block |
| NFT reference | Missing or noncanonical Zecbit item URL |
| Metadata | Invalid name, ticker or HTTPS artwork reference |

Token lookup scans at most ten windows of 800,000 blocks, never below block
70,000,000. Supply the transaction hash for older launches. Transaction lookup
uses the receipt directly; it does not scan the chain.

## Report

The JSON report contains `schema`, `chainId`, `factory`, `token`, `hash`,
`sourceUrl`, `name`, `symbol`, `imageUrl`, `block`, `confirmedAt`, `checkedAt`
and `metadataState`. Block numbers are decimal strings, so JSON serialization
does not lose bigint precision.

`metadataState: "current"` is explicit: metadata is read now, not reconstructed
at launch time. `confirmedAt` is the receipt block's timestamp, not a finality
guarantee. A matching reference establishes what the token claims about its
source; it does **not** prove NFT ownership, creator identity or endorsement.

## Scope

This repository contains the reusable inspection core and CLI. The application's
radar interface, indexed catalog, signing flows and deployment configuration are
outside this extraction. It submits no transactions and downloads no artwork.
It trusts the configured RPC; it is not a light client or cryptographic proof system.

Pair it with [Zecbit Parser](https://github.com/diamondhand-fun/zecbit-parser)
to turn the returned source page into structured NFT traits and artwork metadata.

Maintained by [Diamond Hand](https://github.com/diamondhand-fun).
The package is marked private to prevent accidental npm publication; the repository is public.
