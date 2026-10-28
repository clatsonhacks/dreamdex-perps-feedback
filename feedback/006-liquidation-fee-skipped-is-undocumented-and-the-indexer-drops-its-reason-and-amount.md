# `LiquidationFeeSkipped` (82 liquidations) is served by the indexer as a fee kind the SDK never mentions, without the reason or the skipped amount, and the SDK has no ABI to decode it
Severity: normal
Area: API

**Reported:** first published in this repo on 2026-10-28 (UTC). Found the same day.

**Map cells:** S10/C, S11/A, S13/C

## Summary

When a liquidation does not charge its fee, the LiquidationEngine emits a fifth fee-related event:

```
LiquidationFeeSkipped(address indexed account, address indexed perpPool, uint8 indexed reason, uint256 fillNotional, uint256 fee)
topic0 0xabddd75762e0d6f38592eb52d5227a748603b3ae167f9f546fd3712d63ce991d
```

I recovered the signature by matching the topic's keccak hash. It is not in any public signature database.

It has fired 82 times since 2026-10-08, and the indexer serves every occurrence through `client.listPerpFees()` as a `PerpFeeRecord` with `kind: "LiquidationFeeSkipped"`. But:

1. **The SDK does not document the kind.** `PerpFeeRecord.kind` (`src/perp/history.ts:566-577`) lists `Fee`, `Rebate`, `BuilderFee` and `LiquidationFee`, and nothing else. A consumer branching on those four gets rows it cannot classify.
2. **The SDK has no ABI for the event.** It is missing from `liquidationEngineEventsAbi` and from every other exported events ABI, even though that ABI says it is "Generated from `indexer/abis/LiquidationEngine.json`" (`eventsAbi.ts:521`), which is the very ABI the indexer uses to produce these rows. A live subscriber sees an undecodable log on the engine.
3. **The indexer drops the two fields that explain the skip.** Every row has `amount: "0"`, `tier: null`, `insurancePortion: null` and no `reason` field. On chain, two different outcomes hide behind these identical rows:
   - **reason 7**, 78 times: `fee = 0`, so there was nothing to charge.
   - **reason 8**, 4 times: a real fee was computed (mostly exactly 1% of the fill, 2.40 USDso in total) and then not charged.

   In the indexer you cannot tell which case a row is, or how much fee was forgone.

## Steps to reproduce

1. `npm ci` in this repo.
2. `npx tsx scripts/repro-006-liquidation-fee-skipped-undocumented.mts`

The script needs no key. It:
- checks whether the event's topic0 appears in any SDK event ABI, and whether `history.ts` mentions the kind;
- pulls every `LiquidationFeeSkipped` row from the indexer;
- decodes the matching log of each row from its receipt, using the recovered signature;
- groups the results by reason code.

It exits 1 while the SDK lacks the ABI or the docs, or while a skipped real fee is indexed as `amount: 0` with no reason.

## Expected

- **Docs:** `PerpFeeRecord.kind` lists every kind the indexer writes, and says what a skip means and which reasons exist.
- **ABI:** `liquidationEngineEventsAbi` includes `LiquidationFeeSkipped`. The ABI's own header promises that "the engine emits the stages and their costs" (`eventsAbi.ts:507`), and a forgone fee is one of those costs.
- **Indexer:** the row keeps what the event carries, i.e. the `reason`, and the computed `fee` in a field that is not `amount`, so that sums of `amount` stay correct.

## Actual

Script output, 2026-10-28 19:16 UTC (`notes/run-006-liquidation-fee-skipped.txt`):

```
sdk: { eventInAnyEventsAbi: false, kindMentionedInHistoryTs: false }
indexer: { rows: 82, first: 1791472296 (2026-10-08), last: 1793192107 (2026-10-28), everyAmountZero: true, rowHasReasonField: false }
onChainByReason: { "7": { rows: 78, skippedFeeUSDso: "0" }, "8": { rows: 4, skippedFeeUSDso: "2.395643262352665359" } }
FAIL: 82 LiquidationFeeSkipped rows; SDK ABI has the event: false; SDK documents the kind: false; 4 rows skipped a real fee (2.395643262352665359 USDso) yet the indexer stores amount 0 and no reason
```

The four reason-8 skips, chain vs indexer:

| tx | block | fill notional | fee on chain (reason 8) | indexer row |
|---|---|---|---|---|
| `0x92ba0116…8f12` | 30,358,089 | 14.5107 | 0.145107 (1%) | amount 0, no reason |
| `0x525e9330…291c` | 33,269,498 | 102.8508 | 1.028508 (1%) | amount 0, no reason |
| `0xe2ee4b7c…001e` | 34,918,143 | 13.7781 | 0.105332 (0.76%) | amount 0, no reason |
| `0xed01fb0d…c3ad` | 35,389,307 | 111.6696 | 1.116696 (1%) | amount 0, no reason |

In all 82 rows, the account, pool and `fillNotional` match the chain exactly. Only `reason` and `fee` are lost.

The same transactions also carry a second engine event the SDK cannot decode: topic0 `0x1d68b7d3e7dc3becd79d240b343718f2c6dcb5efca01640951f2951368b3b2e2`, with the account indexed and one small integer as data. Across these 82 transactions it takes 10 different values (1, 2, 3, 4, 5, 7, 8, 9, 10, 14), and it also appears in ordinary fee-charging liquidations (`evidence/probe21-fee-tx-*.json`, log 23). I could not recover its name, so I only note it here.

## Evidence

- `evidence/006-liquidation-fee-skipped-*.json`: full script output
- `evidence/probe26-fee-skipped-*.json`: all 82 rows, chain vs indexer, side by side
- `scripts/probe25-fee-skipped.mts`: every log of one skip transaction, decoded where the SDK can
- `notes/run-006-liquidation-fee-skipped.txt`

## Environment

- `@somnia-chain/markets-sdk` 0.32.1 (the latest on npm)
- Somnia Tokyo testnet (chain 50383), RPC `https://api.hideki2.infra.testnet.somnia.network`, indexer `https://hideki-dev.smk.somnia.host/v1/graphql`
- LiquidationEngine `0xA66d3C24Ad4a389d863846905D8173e1017e9F4D`
- Read-only, no wallet. Node 22.12.0, Windows 11.

## Impact

- **Bots and dashboards** that branch on the documented fee kinds receive rows they cannot classify. A subscriber using the SDK's ABIs gets an undecodable log on every skipped fee.
- **Fee analytics are wrong.** A fee that was computed and forgone (reason 8) is indistinguishable from "nothing to charge" (reason 7), so anyone measuring how often, and how much, liquidation fees are waived gets 0. This matters most next to 004: a reader reconciling liquidation fees has no record of the fees that were skipped.
- **The reason codes are undocumented anywhere**, so even someone who reads the raw log cannot tell what 7 and 8 mean.

## Suggested fix

- Add `LiquidationFeeSkipped` to `liquidationEngineEventsAbi`, along with the `0x1d68b7d3…` event if it is an account outcome. Document the reason enum.
- List `LiquidationFeeSkipped` under `PerpFeeRecord.kind`, saying that `amount` is always 0 there.
- In the indexer, store `reason` and the computed fee (for example as `skippedAmount`) on the row.
