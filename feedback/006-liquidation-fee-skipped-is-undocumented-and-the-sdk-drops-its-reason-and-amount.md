# `LiquidationFeeSkipped` (82 liquidations): the SDK never documents this fee kind, has no ABI for the event, and `listPerpFees` drops the skip reason and skipped amount that the indexer stores
Severity: normal
Area: SDK

**Reported:** first published in this repo on 2026-10-28 19:17 UTC (commit `6e48a78`). Corrected on 2026-10-28: the first version said the indexer drops the reason and amount. It doesn't. The indexer stores them as `skipReason` and `requestedAmount`, and it is the SDK that drops them.

**Map cells:** S10/C, S11/A, S13/C

## Summary

When a liquidation does not charge its fee, the LiquidationEngine emits:

```
LiquidationFeeSkipped(address indexed account, address indexed perpPool, uint8 indexed reason, uint256 fillNotional, uint256 fee)
topic0 0xabddd75762e0d6f38592eb52d5227a748603b3ae167f9f546fd3712d63ce991d
```

I recovered the signature by matching the topic's keccak hash. It is not in any public signature database.

This has happened 82 times since 2026-10-08. The indexer records every occurrence correctly as a `PerpFeeRecord` with `kind: "LiquidationFeeSkipped"`, `skipReason` and `requestedAmount`, and all 82 match the chain. The SDK falls short in three ways:

1. **The kind is undocumented.** `PerpFeeRecord.kind` (`src/perp/history.ts:566-577`) lists `Fee`, `Rebate`, `BuilderFee` and `LiquidationFee`, and nothing else. `client.listPerpFees()` returns these rows anyway, and a consumer branching on the four documented kinds cannot classify them.
2. **`listPerpFees` drops the two fields that explain a skip.**
   - The SDK's `PerpFees` query (`src/gql/gql.ts:282`) selects `id account pool amount isRebate kind insurancePortion tier fillNotional builder timestamp txHash`, and not `skipReason` or `requestedAmount`. The `PerpFeeRecord` type has no field for either.
   - The SDK's own generated schema does know both fields (`src/gql/graphql.ts:2022-2023`).
   - So through the SDK, every skip reads as `amount: "0"` with no reason. Two different outcomes look the same:
     - **reason 7**, 78 times: there was no fee to charge (`fee = 0`).
     - **reason 8**, 4 times: a real fee was computed (mostly exactly 1% of the fill, 2.40 USDso in total) and then not charged.
3. **There is no ABI for the event.** It is missing from `liquidationEngineEventsAbi` and from every other exported events ABI. That ABI's header says it is "Generated from `indexer/abis/LiquidationEngine.json`" (`src/eventsAbi.ts:521`), and that same file evidently contains the event, since the indexer decodes it. A live subscriber using the SDK gets an undecodable log.

## Steps to reproduce

1. `npm ci` in this repo.
2. `npx tsx scripts/repro-006-liquidation-fee-skipped-undocumented.mts`

The script needs no key. It reads the same rows three ways:
- through the SDK: `client.listPerpFees({ kind: "LiquidationFeeSkipped" })`;
- through the raw indexer, with `skipReason` and `requestedAmount` selected;
- from the chain: each row's log, decoded with the recovered signature.

It also checks whether the event's topic0 is in any SDK ABI, and whether `history.ts` names the kind. It exits 1 while any of the three gaps is present.

## Expected

- `PerpFeeRecord.kind` lists every kind the indexer writes, including `LiquidationFeeSkipped`, and says what each reason code means.
- `listPerpFees` returns `skipReason` and `requestedAmount`, as the indexer already provides them, and the type documents them.
- `liquidationEngineEventsAbi` includes the event. Its own header says "the engine emits the stages and their costs" (`src/eventsAbi.ts:507`), and a forgone fee is one of those costs.

## Actual

Script output, 2026-10-28 19:27 UTC (`notes/run-006-liquidation-fee-skipped.txt`):

```
sdk: { eventInAnyEventsAbi: false, kindMentionedInHistoryTs: false, listPerpFeesRows: 82,
       listPerpFeesRowKeys: [id, account, pool, amount, isRebate, kind, insurancePortion, tier, fillNotional, builder, timestamp, txHash],
       dropsSkipReasonAndRequestedAmount: true }
indexer: { rows: 82, rowsWhoseSkipReasonAndRequestedAmountMatchChain: 82 }
onChainByReason: { "7": { rows: 78, skippedFeeUSDso: "0" }, "8": { rows: 4, skippedFeeUSDso: "2.395643262352665359" } }
FAIL: 82 LiquidationFeeSkipped rows (indexer reason/amount match chain on 82); SDK ABI has the event: false; SDK documents the kind: false; listPerpFees drops skipReason and requestedAmount: true (hides 2.395643262352665359 USDso of skipped fees on 4 rows)
```

The four reason-8 skips:

| tx | block | fill notional | chain: reason / fee | indexer: skipReason / requestedAmount | SDK `listPerpFees` |
|---|---|---|---|---|---|
| `0x92ba0116…8f12` | 30,358,089 | 14.5107 | 8 / 0.145107 (1%) | 8 / 0.145107 | amount 0, no reason, no requested amount |
| `0x525e9330…291c` | 33,269,498 | 102.8508 | 8 / 1.028508 (1%) | 8 / 1.028508 | same |
| `0xe2ee4b7c…001e` | 34,918,143 | 13.7781 | 8 / 0.105332 (0.76%) | 8 / 0.105332 | same |
| `0xed01fb0d…c3ad` | 35,389,307 | 111.6696 | 8 / 1.116696 (1%) | 8 / 1.116696 | same |

A second engine event the SDK cannot decode appears in these transactions and in ordinary fee-charging liquidations. It has topic0 `0x1d68b7d3e7dc3becd79d240b343718f2c6dcb5efca01640951f2951368b3b2e2`, the account indexed, and one small integer as data (values 1–14 seen). I could not recover its name, so I only note it here.

## Evidence

- `evidence/006-liquidation-fee-skipped-*.json`: full script output
- `evidence/probe26-fee-skipped-*.json`: all 82 rows, chain vs indexer
- `scripts/probe25-fee-skipped.mts`: every log of one skip transaction, decoded where the SDK can
- `notes/run-006-liquidation-fee-skipped.txt`

## Environment

- `@somnia-chain/markets-sdk` 0.32.1 (the latest on npm)
- Somnia Tokyo testnet (chain 50383), RPC `https://api.hideki2.infra.testnet.somnia.network`, indexer `https://hideki-dev.smk.somnia.host/v1/graphql`
- LiquidationEngine `0xA66d3C24Ad4a389d863846905D8173e1017e9F4D`
- Read-only, no wallet. Node 22.12.0, Windows 11.

## Impact

- **Unclassifiable rows.** Bots and dashboards built on the SDK get fee rows of a kind they were never told about.
- **Waived fees are invisible.** Anyone using the SDK to measure how often, and how much, liquidation fees are waived gets 0, although the indexer holds the answer.
- **Undecodable logs.** Live subscribers cannot decode the event at all, and nothing documents the reason codes.

## Suggested fix

- Add `skipReason` and `requestedAmount` to the `PerpFees` query and to the `PerpFeeRecord` type.
- Document `LiquidationFeeSkipped` under `kind`, including the reason enum and the fact that `amount` is always 0 there.
- Add the event (and the `0x1d68b7d3…` event, if it is an account outcome) to `liquidationEngineEventsAbi`.
