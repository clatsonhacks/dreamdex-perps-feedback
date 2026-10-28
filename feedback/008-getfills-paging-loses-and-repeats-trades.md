# `client.getFills()` / `getUserFills()` page with `offset` over a non-unique order, so even a fixed block window returns some trades twice and never returns others (64 of 16,843 BTC fills at the default page size)
Severity: normal
Area: SDK

**Reported:** first published in this repo on 2026-10-28 (UTC). Found the same day.

**Map cells:** S10/B, S11/B

## Summary

`getFills(pool, opts)` and `getUserFills(account, opts)` page with `limit`/`offset`, and their queries (`src/fills.ts:1382-1399`) order by:

```
order_by: [{timestamp: desc}, {blockNumber: desc}]
```

That is not a total order. One block often holds several fills; a single liquidation fills several makers in one transaction. The indexer returns tied rows in a different order for different `limit`/`offset` values, so consecutive pages overlap. Some trades appear twice, others never, and the number of rows returned still matches the true count.

This happens even inside a fixed, already-final window set with the SDK's own exact bounds (`sinceBlock` / `toBlock`). The SDK documents those bounds as the way to read every fill exactly once (`src/fills.ts:67`: "`[a, b]` followed by `[b + 1, c]` covers every fill exactly once").

On the BTC-PERP pool, blocks 24,300,000–24,500,000 (2026-10-15) hold 16,843 fills, 3,307 blocks of which hold more than one fill:

| page size | rows returned | distinct | duplicated | **missing** | quote-volume error |
|---|---|---|---|---|---|
| 50 (SDK default) | 16,843 | 16,779 | 64 | **64** | +14,587.08 USDso |
| 100 | 16,843 | 16,818 | 25 | **25** | −1,549.12 USDso |
| 500 | 16,843 | 16,836 | 7 | **7** | −3,774.07 USDso |

The SDK already explains why this fails, in its range reader `getFillsPage` (`src/fills.ts:739-743`):

> "Several Somnia blocks can share a timestamp, so the seam between two successive `since`/`until` windows either drops or repeats the fills in those blocks, and a volume feed built on it is silently wrong. `(blockNumber, logIndex)` is a total order over the table …"

`getFillsPage` uses that total order and a cursor. `getFills` and `getUserFills`, the per-pool and per-account trade tapes most integrators will reach for first, do not.

## Steps to reproduce

1. `npm ci` in this repo.
2. `npx tsx scripts/repro-008-getfills-paging-loses-trades.mts`

The script needs no key, and the window is in the past, so the true set cannot change between runs. It:
- reads every fill of the BTC-PERP pool in blocks 24,300,000–24,500,000 from the indexer, ordered by `id` (unique), as the truth;
- pages `client.getFills(pool, { sinceBlock, toBlock, limit, offset })` with page sizes 50, 100 and 500;
- reports duplicated and missing fill ids, and the error in summed `quoteQuantity`.

It exits 1 if any page size loses a fill. Pass `pool fromBlock toBlock` to try another window.

## Expected

Paging `getFills` or `getUserFills` over a fixed window returns every fill exactly once at any page size.

## Actual

`notes/run-008-getfills-paging.txt`, 2026-10-28:

```
pageSize  50: returned 16843 (true 16843), unique 16779, duplicated 64, missing 64, quote-volume error 14587.077018 USDso, e.g. missing 24454642_4, 24454642_9, 24455199_30
pageSize 100: returned 16843 (true 16843), unique 16818, duplicated 25, missing 25, quote-volume error -1549.124469 USDso, e.g. missing 24455815_30, 24455815_79, 24455815_94
pageSize 500: returned 16843 (true 16843), unique 16836, duplicated 7, missing 7, quote-volume error -3774.065445 USDso, e.g. missing 24463367_95, 24475946_73, 24475946_78
indexerFills 16843, trueQuoteVolume 17961498.656188, blocksWithMoreThanOneFill 3307
FAIL: 3/3 page sizes lose fills in a fixed block window (worst: 64 of 16843 missing, each replaced by a duplicate)
```

`getUserFills` uses the same `order_by` (`UserFillsQuery`, `src/fills.ts:1392-1399`), so a busy account's trade history pages the same way.

## Evidence

- `evidence/008-getfills-paging-*.json`: per page size, every duplicated and missing fill id
- `evidence/probe39-getfills-paging-*.json`: the same test with page size 250 (9 missing)
- `notes/run-008-getfills-paging.txt`

## Environment

- `@somnia-chain/markets-sdk` 0.32.1 (the latest on npm), `client.getFills`
- Indexer `https://hideki-dev.smk.somnia.host/v1/graphql`, Somnia Tokyo testnet (chain 50383), BTC-PERP pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`
- Read-only, no wallet. Node 22.12.0, Windows 11.

## Impact

- **Wrong trade history, silently.** Trade tapes, per-account histories, volume and PnL reports built by paging `getFills` or `getUserFills` drop real trades and double-count others. In this window that is 64 trades and +14,587 USDso of volume at the default page size, with no error and a row count that looks right.
- **Worst when it matters most.** The losses cluster in blocks with several fills, which are mostly liquidation bursts. Those are exactly the trades a user or risk tool is most likely to look for.
- **Bigger tapes lose more.** The error grows with the number of multi-fill blocks, and smaller pages (including the default) lose more rows.

## Suggested fix

Order both queries by a total order, for example `[{timestamp: desc}, {blockNumber: desc}, {logIndex: desc}]`. `logIndex` is already in `FillQueryFields`. Alternatively, page them with the `(blockNumber, logIndex)` cursor that `getFillsPage` already uses.

## Related

- 007 in this repo: the same missing tiebreaker on `listPerpFees`, which makes fee totals wrong.
