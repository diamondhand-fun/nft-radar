# Validation record

Checked on 2026-09-24.

## Real network

- The configured public RPC returned chain ID 4663.
- The configured factory returned 24,177 bytes of deployed bytecode.
- A recent 800,000-block factory query returned 9,848 decoded launch events.
- Transaction `0xac5e2317bb6ae47ad1862652c2977ac3bf2a7f5582d389cf4f7dfde3bc0664d2`
  reached receipt and contract metadata reads, then was rejected because its
  metadata did not contain a supported Zecbit source reference.

The recent sample did not yield a Zecbit-linked launch for a successful live
report. The public RPC and factory path were exercised; successful report
assembly is covered by encoded event and local JSON-RPC integration tests.
These observations are a point-in-time check, not an uptime promise.

## Regression coverage

- Token and transaction lookup; ten contiguous scan windows and the lower bound.
- Wrong chain, wrong factory, failed receipt, wrong receipt transaction hash,
  malformed event, ambiguous launches and explicit token selection.
- Metadata reads pinned to one block; launch and metadata block changes rejected.
- Invalid NFT sources, credentials in artwork URLs and invalid token metadata.
- CLI input failures and a complete HTTP/JSON-RPC/ABI round trip.

`npm audit` reported zero known dependency vulnerabilities on the check date.
Run `npm test` to reproduce the checks without relying on an upstream service.
