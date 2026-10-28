# Liquidation fees (225,706 USDso over 1,418 liquidations) are documented as Insurance Fund inflow, but no tier and no fund balance ever receives them
Severity: major
Area: contracts

**Reported:** sent privately to security@dreamdex.io on 2026-10-23. The team replied that it is a product/documentation issue for the Feedback track and asked for it to be filed here; published here 2026-10-28 19:10 UTC (commit `e9cd6a9`). Numbers below re-checked 2026-10-28 (UTC).

**Map cells:** S13/C, S10/C, S11/A

## Summary

Every book liquidation emits `LiquidationFeeCharged(account, perpPool, tier, fillNotional, amount)` from the LiquidationEngine, and the fee is taken from the liquidated trader. The SDK says this fee is "routed WHOLLY to an Insurance Fund tier".

On Hideki, from 2026-09-29 to 2026-10-28:

- 1,418 liquidation fees were charged, totalling **225,706.38 USDso**.
- Every Insurance Fund tier balance still equals its admin top-ups minus one withdrawal, **to the wei**. The fund's ledger has no `TierCredited` row at all.
- In a single liquidation, the trader's collateral falls by exactly PnL + funding + fee. Meanwhile the fund's tier balances, its MarginBank account, and the MarginBank account of every address named in the transaction's events do not move.

The fee leaves the trader and is not credited anywhere visible. Apart from a 0.07 USDso keeper reward, it stays in the MarginBank's token balance without belonging to any account.

The indexer changed between 2026-10-26 and 2026-10-29: every `LiquidationFee` row's `insurancePortion` went from `= amount` to `0`, old rows included. SDK 0.32.1 (still the latest release) was not updated, so its docs now disagree with both the chain and the indexer. Where the fee is supposed to go is not documented anywhere I could find.

## Steps to reproduce

1. `npm ci` in this repo.
2. `npx tsx scripts/repro-004-liquidation-fee-not-in-insurance-fund.mts 0x88b153ace3aaafab447ac2e6e09f7a29e3ac495cb7eae9164b4f6d4ad8e9f168 0x5521160E05bB130783E003F746F03d9D31ea1e69`

The script runs two checks, needs no key, and exits 1 while fees exist and the tiers equal their top-ups. The two arguments are optional; without them only Part A runs.

**Part A** (all history):
- Pages through `client.listPerpFees({ kind: "LiquidationFee" })` and `client.listPerpInsuranceFundEvents()`.
- Replays the fund ledger per tier.
- Compares that replay with `client.getInsuranceFundState()` and with the fund's MarginBank account.

**Part B** (one liquidation): reads the liquidated account, the fund's MarginBank account and every tier at `block - 1` and at `block` of the given transaction.

To see where a fee goes, run `npx tsx scripts/probe21-fee-tx-events.mts <txHash>`. It decodes every log of a fee transaction and reads the MarginBank balance of every address those logs name, before and after.

## Expected

The SDK, `node_modules/@somnia-chain/markets-sdk/src/perp/history.ts`:

- lines 572-573: "LiquidationFee stage-3 health-preserving liquidation fee, routed WHOLLY to an Insurance Fund tier"
- lines 584-586: "on `LiquidationFee` it equals `amount`, because that fee goes wholly to a tier. Written on both so `SUM(insurancePortion)` is the fund's fee inflow"

And `src/perp/system.ts:298`: `TierCredited` = "the insurance share of a fee, booked by MarginBank | inflow".

So each fee should raise its tier's `getTierBalance(tier)` and appear in the fund's ledger as a `TierCredited` row. If the fee is meant to go somewhere else, that destination should be documented and visible on chain.

## Actual

**Part A**, 2026-10-29, block 35,404,495 (`notes/run-004-1029.txt`):

```
liquidationFeeRows: 1418, liquidationFeeTotal: 225706.378729210629580422 USDso (2026-09-29 → 2026-10-28)
insuranceLedgerKinds: { TierFunded: 10, TierWithdrawn: 1 }          <- no TierCredited, ever
totalTierBalances: 1660000, insuranceFundBankAccount: 1660000
tier 1: chain 1050000 | ledger replay (top-ups − withdrawals) 1050000 | fees charged in tier-1 markets 118621.13 | indexed insurancePortion 0
tier 2: chain  260000 | ledger replay                         260000 | fees charged in tier-2 markets 106111.22 | indexed insurancePortion 0
tier 3: chain  350000 | ledger replay                         350000 | fees charged in tier-3 markets    974.03 | indexed insurancePortion 0
FAIL: 225706.378729210629580422 USDso of liquidation fees (1418 rows) charged in tiered markets; every Insurance Fund tier still equals its top-ups minus withdrawals, and the ledger has no TierCredited row
```

The gap has grown with every run:

| Date | Fee rows | Fees (USDso) | Tier balances |
|---|---|---|---|
| 2026-10-22 | 1,022 | 140,838.09 | 1,050,000 / 260,000 / 350,000 |
| 2026-10-26 | 1,321 | 203,879.24 | unchanged |
| 2026-10-29 | 1,418 | 225,706.38 | unchanged |

Run logs: `notes/run-004.txt`, `notes/run-004-1026.txt`, `notes/run-004-1029.txt`.

**Part B** on the newest fee, tx `0x88b153ac…f168`: block 35,404,495, tier-2 market `0x63b4…297a`, fee 289.193296 USDso, which is 1% of 28,919.33 fill notional.

```
liquidated account 0x5521…1e69: delta −686.744852103520323175
insuranceFund bank account delta: 0
tiers before: 0 | 1050000 | 260000 | 350000 | 0 | 0
tiers after:  0 | 1050000 | 260000 | 350000 | 0 | 0
```

`probe21` read the MarginBank balance of every address named in that transaction's 26 logs: the account, the pool, the makers, the LiquidationEngine, the keeper and its owner, the Insurance Fund, the bank itself and the tx sender. The liquidated account is the **only** non-zero delta (`evidence/probe21-fee-tx-*.json`).

The only USDso token transfers in the transaction are the 0.07 USDso keeper reward: bank → keeper `0x03ca…b1cc` → keeper owner `0xf483…932e`. So 289.12 USDso of fee left the trader and stayed in the MarginBank without being credited to anyone.

An older tier-3 fee reconciles the same way, to the wei. Tx `0x432a26fe…689c20`, block 30,438,732, fee 0.50832342 USDso, decoded with the SDK's own event ABIs (`evidence/probe8-liqfee-tx-*.json`):

```
  realizedPnl   −8.865924333333333334   (PositionUpdated)
− funding        0.145001421294078745   (sum of 4 FundingSettled)
− fee            0.508323420000000000   (LiquidationFeeCharged)
= −9.519249174627412079                 = the account's collateral delta, exactly
fund bank account delta 0, tier balances unchanged
```

A tier-2 fee (249.81 USDso, tx `0x1070c57b…c49cc`) and a tier-1 fee (182.52 USDso, tx `0xdd5fd66c…d4db4a`) give the same result: the fund's delta is 0 and the tiers are unchanged (`evidence/probe9-*.json`, `notes/run-probe11-tier-balances.txt`).

**Keeper rewards don't account for it.** I checked all 1,315 indexed `KeeperReward` liquidation events on 2026-10-26 (`scripts/probe15-keeper-reward.mts`). Every one sits in a transaction that also has a `LiquidationFee`, and none occurs without one, so the keeper appears to be paid out of the fee. They total 91.99 USDso, against 203,879 USDso of fees on that date.

**The indexer's change.** `scripts/probe20-fee-tier-tags.mts` shows that on 2026-10-29 all 1,418 rows carry `insurancePortion: "0"`: 534 in tier 1, 843 in tier 2 and 41 in tier 3. That includes the oldest row, from 2026-09-29. On 2026-10-26 the same rows carried `insurancePortion = amount` (112,909 / 89,996 / 974 USDso by tier, `notes/run-004-1026.txt`). There was no SDK release in between. The latest on npm is still 0.32.1, from 2026-10-13.

## Evidence

- `evidence/004-liquidation-fee-insurance-*.json`: Parts A and B from 10-22, 10-26 and 10-29
- `evidence/liqfees-raw.json`: all 1,022 LiquidationFee rows as of 10-22
- `evidence/probe7-insurance-*.json`: tier ledger replay vs chain
- `evidence/probe8-liqfee-tx-*.json`: every log of the tier-3 fee tx, decoded
- `evidence/probe9-*.json`, `evidence/probe10-*.json`: per-block balance reads around fee transactions
- `evidence/probe15-keeper-reward-*.json`: keeper rewards vs fees, by transaction
- `evidence/probe21-fee-tx-*.json`: every log and every named account's bank delta for the 10-28 fee tx
- `notes/run-004*.txt`, `notes/run-probe11-tier-balances.txt`
- Scripts: `scripts/repro-004-*.mts`, `scripts/probe7-004.mts` … `probe11-004.mts`, `probe15-keeper-reward.mts`, `probe20-fee-tier-tags.mts`, `probe21-fee-tx-events.mts`

## Environment

- `@somnia-chain/markets-sdk` 0.32.1
- Somnia Tokyo testnet (chain 50383), RPC `https://api.hideki2.infra.testnet.somnia.network`, indexer `https://hideki-dev.smk.somnia.host/v1/graphql`
- MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, LiquidationEngine `0xA66d3C24Ad4a389d863846905D8173e1017e9F4D`, InsuranceFund `0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80`
- Read-only, no wallet used. Node 22.12.0, Windows 11.

## Impact

- **The fund is smaller than the docs imply.** Traders pay up to 1% of every liquidation, as documented, but the money does not build the Insurance Fund. That fund is the stage meant to absorb bad debt before ADL. It is 225,706 USDso (about 13.6%) smaller than the fee docs imply, and the gap grows with every liquidation.
- **The money has no visible owner.** It sits in the MarginBank's token balance without belonging to any account, and I could not find a getter or event that shows it. An integrator auditing protocol solvency cannot reconcile the bank's token balance with the sum of its accounts.
- **The documented inflow figure is wrong.** Anyone who computes fund inflow the way the SDK says to (`SUM(insurancePortion)`) got the full fee total until 2026-10-26, and gets 0 now. Neither figure matches a destination on chain, and the SDK text still says the former.

I rate this major because it concerns protocol solvency numbers that users and integrators rely on, and real fee money is unaccounted for. Testnet paper funds only, and there is no exploit path.

## Suggested fix

One of:

- **Route the fee as documented.** Credit it to the tier named in `LiquidationFeeCharged` (bank → fund transfer plus `TierCredited`).
- **Or document the real destination.** If the fee is meant to go elsewhere (protocol surplus, keeper budget), credit it to an account, emit an event that names the destination, and update `history.ts:572-586` and `system.ts:298, 314-319` to match the indexer's new `insurancePortion = 0`.

Either way, publish an SDK release, so that the docs, the indexer and the chain agree.

## Related

- 003 in this repo (ADL netting unwired) is also about the backstop stages before ADL, but is otherwise unrelated.
