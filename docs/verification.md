# From launch to source

```mermaid
flowchart LR
    I[Token or transaction] --> C[Check RPC chain]
    C --> L[Find launch receipt]
    L --> E[Check status and factory event]
    E --> S[Select one token]
    S --> M[Read current metadata]
    S --> B[Compare receipt and block hashes]
    M --> V[Validate source and artwork URLs]
    B --> R[JSON report]
    V --> R
```

## Receipt selection

An address triggers a backward log search, filtered by factory and indexed token.
Windows are contiguous, bounded and include both endpoints. The first matching
transaction becomes the candidate; its receipt must independently contain the
matching factory event. A supplied transaction hash skips log scanning.

Only `TokenLaunched` events emitted by the preset factory count. Removed logs
are discarded, and matching logs must belong to the same transaction and block
as the receipt. Malformed and
unrelated logs are ignored. Repeated events for the same token are deduplicated
case-insensitively. If a receipt launches multiple different tokens, the caller
must choose one. A selection absent from the receipt is rejected.

## Metadata semantics

The reader calls `name()`, `symbol()`, `description()` and `logo()` in parallel.
The latest block is captured first, and all four reads are pinned to its block
number. After the reads, both the metadata block and the launch block are
checked again against their recorded hashes. A changed block rejects the report.
This needs recent state access, not an archive of the original launch state.

The final line matching `Source NFT: ...` is used, preserving the application
convention. It must be exactly `https://zecbit.net/item/{collection}/{positive-id}`:
no query string, fragment, credentials, custom port or trailing slash. Multiple
references are not an ownership chain; only the final reference is reported.

Artwork must be an HTTPS URL without embedded credentials or a nondefault port.
The reader does not fetch or verify the image. Names and metadata are untrusted
text and must be escaped when displayed in HTML.

## What a passing report means

A successful RPC receipt contains a matching launch event, its reported block
still matches a separately fetched block, and current token metadata references
a syntactically supported NFT source. The chain can reorganize after the check;
no confirmation-depth or finality policy is enforced. An untrusted RPC can lie.

No NFT ownership, NFT authenticity, shielded Zcash data, economic safety or
permission from the original creator is established by these checks.

## Extraction notes

Based on Diamond Hand's `proof` and `verify-launch` modules. The standalone
version consolidates the duplicate receipt fetch, validates optional selection,
deduplicates token identities, verifies the receipt transaction hash and pins
metadata reads to one block. The report also records that metadata block and hash.
Wallet integrations, launch-writing ABI methods, fee recipients and production
credentials are excluded. Tests use encoded synthetic EVM events and never call
a public RPC.
