# BTC-PERP long side has 5,631 holders against an ADL scan cap of 500, so ADL there runs in storage order, not "most profit relative to equity first" as the trader docs say
Severity: normal
Area: docs

**Reported:** first published in this repo on 2026-10-26 16:58 UTC (commit `5fea0f4`) and submitted in DoraHacks Build 50378 the same day. Found 2026-10-22. Re-checked 2026-10-26.

**Map cells:** S01/B, S13/B, S13/G | **Lead:** new

## Summary

The trader docs say ADL closes profitable positions on the opposite side "those with the most profit relative to their account's equity first", and that the app's ADL column shows each position's place in that queue.

On BTC-PERP, the busiest market, the long side holds 5,631 positions. The LiquidationEngine's ADL scan cap (`getMaxAdlScanPerCall`) is 500. Above the cap the engine walks holders in storage order and never calls the ranker. The SDK's own ADL queue read reports this side as `regime: "storageOrder"` with no per-holder order. So for every BTC long, the documented ranking does not apply and there is no queue position to show.

## Steps to reproduce

1. `npm install` in this repo.
2. `npx tsx scripts/repro-002-btc-long-adl-storage-order.mts`

The script reads at one pinned block:
- `LiquidationEngine.getMaxAdlScanPerCall()` and `getAdlRanker()`
- for all 21 markets x 2 sides, `MarginBank.getSideHolderStatesPaginated(pool, isLong, 0, 0)`, which returns the holder count without any health walk
- `client.perpAdlQueue.getSnapshot()` for the largest side

It exits 1 if any side is over the cap.

## Expected

Per `https://app.testnet.dreamdex.io/docs/trading/perps-testnet/margin-and-liquidations` (read 2026-10-22):

> only when both are exhausted does auto-deleveraging (ADL) start. ADL reduces profitable positions on the opposite side of the same market, those with the most profit relative to their account's equity first. [...] The ADL column in your positions table shows where each position stands in that queue as five bars.

## Actual

Script output (2026-10-22 19:28 UTC, block 30,452,677):

```
"scanCap": "500",
"ranker": "0x3d7466A217e375635386d3c5da30a82959DdB789",
largest sides: BTC-PERP long 5631, SOL-PERP long 316, BTC-PERP short 298, ETH-PERP long 268, HYPE-PERP long 257, XRP-PERP long 244
"sdkQueueForLargestSide": { "regime": "storageOrder" }
FAIL: BTC-PERP long (5631 holders > cap 500) — ADL there is not profit/equity ranked
```

BTC long is the only side over the cap; the other 41 sides read `regime: "ranked"`, `orderSource: "ranker"`. A sample of three 25-holder pages from the BTC long list (offsets 0, 2800, 5550) found 0 empty slots. These are real positions (0.0002 to 0.06 BTC each), not leftover entries.

What happens above the cap, as the SDK states it (`node_modules/@somnia-chain/markets-sdk/src/perp/adl.ts`):

- lines 180-183: "`storageOrder`: the side has more holders than `scanCap`, so the engine walks them in storage order and never calls the ranker. That walk depends on the bankrupt account's size, so no per-holder order is given."
- lines 514-515: "The engine compares the HOLDER count, before any filter, with the cap." / `if (scanCap !== 0n && holderCount > scanCap) return answer({ regime: "storageOrder", ...counts });`

I could not read the engine source (it is not verified on the explorer), so the engine-side behaviour above is as the SDK documents it.

## Evidence

- `evidence/002-adl-storage-order-*.json` (cap, ranker, per-side counts at one block, SDK queue result)
- `evidence/probe1-*.json` (full `perpAdlQueue.getSnapshot` for all 42 sides, block 30,432,808 to 30,433,625)
- `evidence/probe6-btc-long-sample-*.json` (75 sampled BTC long holders: sizes, entries, equity)
- `notes/run-002-btc-long-adl-storage-order.txt`

## Environment

- Wallet (tester): `0xE488bb2bd58E9C425F525293856FAA529f7b1db3`. Not needed to reproduce; every read is keyless.
- Re-checked 2026-10-26 with the same script: still failing, and BTC-PERP long has grown to 5,785 holders (cap still 500). Output: `notes/run-002-btc-long-adl-storage-order-1026.txt`

- `@somnia-chain/markets-sdk` 0.32.1
- Somnia Tokyo testnet (chain 50383), RPC `https://api.hideki2.infra.testnet.somnia.network`
- LiquidationEngine `0xA66d3C24Ad4a389d863846905D8173e1017e9F4D`, MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, BTC-PERP pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`
- Read-only, no wallet used. Node 22.12.0, Windows 11

## Impact

- For BTC longs, the doc's promise ("most profit relative to equity first") is false. Which longs an ADL closes depends on where they sit in the holder list and on the bankrupt's size. A low-leverage, slightly profitable long can be closed before a highly levered, very profitable one.
- The ADL bars cannot reflect a real queue place on BTC longs, because no per-holder order exists. Neither the docs nor the SDK queue output say what the app shows in that case.
- It will spread: SOL long (316), BTC short (298) and ETH long (268) are each over half the cap during a four-week Arena that is still adding wallets.

ADL has not run on Hideki yet (the Insurance Fund ledger has no `TierDebited` or `BadDebtAuthorised` rows), so nobody has been hurt. This is latent, which is why I rate it normal.

## Suggested fix

Either raise or remove the scan cap for large sides (or rank in pages), so the ranker always decides the order. Or document the fallback: on the Margin & Liquidations page, state that sides with more than `getMaxAdlScanPerCall()` holders are deleveraged in holder-list order, and say what the ADL column shows for such a position.

## Related

- 003 in this repo: the linked-wallet netting that the ranked ADL order is supposed to apply is also not wired.
