# The linked-wallet funding rail is armed on the MarginBank, but the LiquidationEngine has no linked-wallet registry, so the ADL netting the SDK documents for linked wallets never applies
Severity: normal
Area: contracts

**Reported:** first published in this repo on 2026-10-26 16:58 UTC (commit `5fea0f4`) and submitted in DoraHacks Build 50378 the same day. Found 2026-10-22. Re-checked 2026-10-26.

**Map cells:** S13/A, S13/B, S02/A | **Lead:** new

## Summary

The SDK presents linked wallets as two features built on one link: main-to-child margin funding, and ADL netting that starts once the link matures (`maturesAt`). On Hideki only the first is wired:

- `MarginBank.getLinkedWalletRegistry()` = `0x5b3C5Bf1F7AdA852e8AA783f6299932E32073aFb`: armed. A link exists, and children can draw on their main.
- `LiquidationEngine.getLinkedWalletRegistry()` = `0x0000000000000000000000000000000000000000`: unset. The ranker gets no link graph, so it nets nothing and does not move a bankrupt's own group to the back.

`getPerpSystemConfig().fullyWired` still reports `true`, and no doc says netting is off. A wallet's `maturesAt` (returned by `getPerpWalletLinkage`) therefore gates nothing on this deployment.

## Steps to reproduce

1. `npm install` in this repo.
2. `npx tsx scripts/repro-003-adl-netting-unwired.mts`

It reads both registries at one block, plus `getPerpSystemConfig`, `getPerpMaxLinkedChildren` and the indexed `Linked` rows. It exits 1 when the bank's registry is set and the engine's is zero.

## Expected

The SDK docs describe netting as live behaviour of a matured link:

- `docs/PERPS.md:659`: "Funding does not wait for link maturity: the rail reads the raw graph, and `maturesAt` gates ADL netting only."
- `src/perp/linkedWallet.ts:144-149`: "ADL netting is gated on maturity so that a link armed in reaction to an impending auto-deleveraging cannot buy netting credit."
- `src/perp/adl.ts:200-202`: "The engine's linked-wallet registry. While it is non-zero, a link-aware ranker nets linked wallets, and a real bankrupt's own group is sorted last."

So either the engine is wired to the same registry as the bank, or the docs say netting is not enabled on this deployment.

## Actual

Script output (2026-10-22 19:28 UTC, block 30,452,572):

```
"liquidationEngine": "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D",
"fullyWired": true,
"bankRegistry":   "0x5b3C5Bf1F7AdA852e8AA783f6299932E32073aFb",
"engineRegistry": "0x0000000000000000000000000000000000000000",
"maxChildren": "12",
"linkedRows": [ { "kind": "Linked", "main": "0x29fd…fb41", "child": "0xd4ac…8f8f", "blockNumber": "30361545", ... } ]
FAIL: funding rail armed on the bank, ADL netting unwired on the engine (fullyWired still true)
```

The SDK's own ADL queue read confirms it on every market: all 41 ranked sides return `linkedWalletRegistry: 0x000…000` (`evidence/probe1-*.json`).

## Evidence

- `evidence/003-adl-netting-unwired-*.json`
- `evidence/probe5-adl-raw-*.json` (independent raw reads, block 30,437,386)
- `evidence/probe1-*.json` (`linkedWalletRegistry` on each ranked ADL side)
- `notes/run-003-adl-netting-unwired.txt`

## Environment

- Wallet (tester): `0xE488bb2bd58E9C425F525293856FAA529f7b1db3`. Not needed to reproduce; every read is keyless.
- Re-checked 2026-10-26 with the same script: still failing (engine registry still `0x0`, bank registry armed). Output: `notes/run-003-adl-netting-unwired-1026.txt`

- `@somnia-chain/markets-sdk` 0.32.1
- Somnia Tokyo testnet (chain 50383), RPC `https://api.hideki2.infra.testnet.somnia.network`
- Read-only, no wallet used. Node 22.12.0, Windows 11

## Impact

A trader who splits a hedge across a main and its children (the SDK's recommended way to get isolated margin) is ranked for ADL as unrelated accounts. A profitable leg can be auto-deleveraged on the strength of that wallet's own leverage while its losing sibling stays open, which is exactly what netting exists to prevent. Builders reading `maturesAt` will tell users netting starts at a time when nothing happens.

Limits: one link exists on Hideki and ADL has not run yet, so this is latent. It may be an intentional staging choice. If so, it is undocumented, and `fullyWired` does not cover it.

## Suggested fix

Call the engine's registry setter with the bank's registry, or document on the perps developer page and in `PERPS.md` that ADL netting is not enabled on this deployment. Consider including the engine-vs-bank registry match in `fullyWired`, or exposing it from `getLiquidationEngineConfig`, which today returns no registry field.

## Related

- 005 in this repo: the SDK's link-status read is also wrong during the link's first hour, the same maturity window that would gate netting.
