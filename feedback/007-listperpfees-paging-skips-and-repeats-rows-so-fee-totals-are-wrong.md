# `client.listPerpFees()` sorts only by `timestamp`, so paging repeats some fee rows and drops others; the fee total the SDK tells you to compute comes out 302.97 USDso low
Severity: normal
Area: SDK

**Reported:** first published in this repo on 2026-10-28 (UTC). Found the same day, while reconciling 004.

**Map cells:** S10/C, S11/A

## Summary

`listPerpFees` is documented as "newest first … paginate", and its docs say "a fee total is `SUM(amount)`". Its query (`src/gql/gql.ts:282`) orders `PerpFeeRecord` by `{timestamp: desc}` alone.

Liquidation fees often share a timestamp: 201 timestamps on Hideki carry more than one fee. Without a unique tiebreaker, the indexer returns tied rows in a different order depending on `limit` and `offset`, so offset paging is not stable. Pages overlap at their boundaries: some rows come back twice and others never come back at all.

The row count still matches (1,418 every time), so nothing warns the caller.

Paging all `LiquidationFee` rows with page sizes of 100, 250, 500 or 1,000 returns 1,414 distinct rows: four rows twice, and four real fees never. The four missing fees total 302.97 USDso, so `SUM(amount)` is 302.97 USDso low. In a wider sweep, page size 300 instead dropped one row and duplicated a large one, and the total came out **147.18 USDso high**. The SDK's default page size (50) and some others (400, 700) happened to be correct on these runs.

The SDK already knows about this failure and fixes it in other queries. `src/perp/history.ts:890-895`, on the funding-rate query:

> "A total order, as in LiquidationsQuery: rows that share a timestamp come back in the same order on every request."

`Liquidations`, `PerpMarginPulls`, `PerpMainFundingEvents` and `PerpInsuranceFundEvents` all add `blockNumber`/`logIndex`/`id` tiebreakers. `PerpFees` does not.

## Steps to reproduce

1. `npm ci` in this repo.
2. `npx tsx scripts/repro-007-listperpfees-unstable-paging.mts`

The script needs no key. It:
- fetches every `LiquidationFee` row from the indexer ordered by `id`, which is unique, to get the true row set and `SUM(amount)`;
- pages `client.listPerpFees({ kind: "LiquidationFee", limit, offset })` with page sizes 50, 100, 250, 500 and 1,000;
- reports duplicated rows, missing rows and the `SUM(amount)` error for each page size.

It exits 1 if any page size returns a duplicate or misses a row. A second argument selects another `kind`.

## Expected

Paging through `listPerpFees` with any page size returns every row exactly once, so `SUM(amount)` equals the indexer's total.

## Actual

`notes/run-007-listperpfees-paging.txt`, 2026-10-28:

```
pageSize   50: returned 1418, unique 1418, duplicated 0, missing 0, SUM(amount) error 0 USDso
pageSize  100: returned 1418, unique 1414, duplicated 4, missing 4, SUM(amount) error -302.965047067643376593 USDso
pageSize  250: returned 1418, unique 1414, duplicated 4, missing 4, SUM(amount) error -302.965047067643376593 USDso
pageSize  500: returned 1418, unique 1414, duplicated 4, missing 4, SUM(amount) error -302.965047067643376593 USDso
pageSize 1000: returned 1418, unique 1414, duplicated 4, missing 4, SUM(amount) error -302.965047067643376593 USDso
trueRows 1418, trueSumAmount 226009.343776278272957015, timestampsSharedByMoreThanOneRow 201
FAIL: 4/5 page sizes return duplicated and/or missing LiquidationFee rows while the row count still matches (1418)
```

The four rows that go missing all share timestamp `1792093469` (2026-10-15):

| row id | fee (USDso) |
|---|---|
| `0x4bbe58ae…a2_39` | 123.227093 |
| `0x2f96b2c3…4c_64` | 96.635686 |
| `0x597ab34a…c4_23` | 83.245569 |
| `0x8a0cd8c2…18_35` | 0.875224 |

On chain they are ordinary fees. The liquidation-fee recipient's balance rises by exactly fee − keeper reward in each of those blocks (`scripts/probe36-recipient-blocks.mts`).

A sweep over 10 runs (`evidence/probe38-paging-sweep-*.json`): page sizes 100, 200, 250, 500, 500 and 1000 were each −302.97 USDso; 300 was +147.18 USDso (one row dropped, a large one duplicated); 50, 400 and 700 were exact.

## How this was found

I was reconciling the liquidation-fee recipient's on-chain balance (see 004) with the SDK's fee history. Fetched through `listPerpFees` in pages of 500, the history was 302.97 USDso short of the chain. Bisecting the gap block by block found the chain correct in every block. The missing amount was exactly these four rows, which the SDK had paged past.

## Evidence

- `evidence/007-listperpfees-paging-*.json`: per page size, the duplicated and missing row ids
- `evidence/probe37-*.json`, `evidence/probe38-paging-sweep-*.json`: more page sizes and repeat runs
- `evidence/probe31-recipient-drift-*.json`: the 302.69 USDso "gap" (302.97 − 4 × 0.07 keeper rewards) that led here
- `notes/run-007-listperpfees-paging.txt`

## Environment

- `@somnia-chain/markets-sdk` 0.32.1 (the latest on npm), `client.listPerpFees`
- Indexer `https://hideki-dev.smk.somnia.host/v1/graphql`, Somnia Tokyo testnet (chain 50383)
- Read-only, no wallet. Node 22.12.0, Windows 11.

## Impact

- **Wrong fee totals, silently.** Any fee report, accounting job or dashboard that pages `listPerpFees` and sums `amount`, exactly as the SDK docs instruct, gets a wrong total. It can be wrong in either direction, it changes with page size, and no error or count mismatch flags it.
- **Wrong reconciliations.** A missing row is a real fee charged to a real trader, so per-account fee histories can silently omit charges. My own earlier fee totals in 004 were low by this amount until I found it.
- **The problem grows over time.** More liquidations per second means more tied timestamps, and so more boundaries where rows can be lost.

## Suggested fix

Order `PerpFees` by `[{timestamp: desc}, {blockNumber: desc}, {logIndex: desc}, {id: desc}]`. The indexer row already has `blockNumber` and `logIndex`. This matches the "total order" the SDK uses for `Liquidations` and funding history. The other queries that still order by a non-unique key alone (`ProtocolFees`, `BuilderFees`, `SettlementFees`, `RouterActions`, all `{timestamp: desc}`) would need the same fix.
