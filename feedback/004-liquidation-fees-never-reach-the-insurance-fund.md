# Liquidation fees (226,009 USDso) are documented as Insurance Fund inflow, but the contract pays them to a separate liquidation-fee recipient, one it forbids from being the fund, and the SDK gives no way to find that recipient
Severity: normal
Area: SDK

**Reported:** sent privately to security@dreamdex.io on 2026-10-23. The team replied that it is a product/documentation issue for the Feedback track, and asked for it to be filed here. First published here 2026-10-28 19:10 UTC (commit `e9cd6a9`).

**Corrected 2026-10-28.** The earlier version (and the email) said the fees "arrive nowhere visible". That was wrong. My balance checks covered only the addresses named in each transaction's events plus a hand-picked list, and missed `MarginBank.getLiquidationFeeRecipient()`. That account receives every fee, minus the keeper reward. What remains is a documentation and SDK problem, described below. I lowered the severity to normal accordingly.

**Map cells:** S13/C, S10/C, S11/A

## Summary

Every book liquidation emits `LiquidationFeeCharged(account, perpPool, tier, fillNotional, amount)` and takes the fee from the trader. The SDK tells integrators that this fee builds the Insurance Fund:

- `src/perp/history.ts:572-573`: "LiquidationFee stage-3 health-preserving liquidation fee, routed WHOLLY to an Insurance Fund tier"
- `src/perp/history.ts:584-586`: "on `LiquidationFee` it equals `amount`, because that fee goes wholly to a tier. Written on both so `SUM(insurancePortion)` is the fund's fee inflow"
- `src/perp/system.ts:298`: `TierCredited` = "the insurance share of a fee, booked by MarginBank | inflow"

On Hideki none of that happens. Instead:

- **The fee goes to a dedicated recipient.** It is credited to the MarginBank account of `MarginBank.getLiquidationFeeRecipient()` = `0x95F23A563EceE5c6F841d762943D2F2FEc742253`, set on 2026-10-07. In each transaction the recipient gains exactly fee − keeper reward, to the wei. Its balance is now **225,768.69 USDso**, which reconciles to the wei (see Actual).
- **The fund cannot be the recipient.** The contract forbids it: the SDK's own error ABI contains `LiquidationFeeRecipientCannotBeInsuranceFund` (`src/contractErrorsAbi.ts:282`).
- **The fund never receives a fee.** All 1,418 fees (226,009.34 USDso, 2026-09-29 → 2026-10-28) bypass it. Every tier still equals its admin top-ups minus one withdrawal, to the wei, and the fund's ledger has no `TierCredited` row.
- **The SDK hides the recipient.** It does not mention `getLiquidationFeeRecipient` anywhere. `client.getPerpSystemConfig()` returns `feeRecipient` (`0xd585…22be`, the trading-fee recipient) and `insuranceFund`, but not the liquidation-fee recipient. An integrator following the SDK cannot find where the fees go.
- **The indexer changed, the SDK did not.** Between 2026-10-26 and 2026-10-28 the indexer re-wrote every `LiquidationFee` row's `insurancePortion` from `= amount` to `0`. The SDK (0.32.1, still the latest release) was not updated, so its text now contradicts the chain and the indexer.

## Steps to reproduce

1. `npm ci` in this repo.
2. `npx tsx scripts/repro-004-liquidation-fee-not-in-insurance-fund.mts 0x88b153ace3aaafab447ac2e6e09f7a29e3ac495cb7eae9164b4f6d4ad8e9f168`

The script needs no key and exits 1 while the SDK's "Insurance Fund" text and the chain disagree. It:
- checks the SDK's claim in `history.ts`, the keys of `getPerpSystemConfig()`, and the error ABI;
- sums every indexed `LiquidationFee` and replays the Insurance Fund ledger tier by tier;
- reads `getLiquidationFeeRecipient()` and that recipient's MarginBank balance;
- with a transaction hash, compares the recipient, fund and tier deltas across that one liquidation.

## Expected

Either the fee reaches an Insurance Fund tier (as a `TierCredited` row, raising `getTierBalance(tier)`), as the SDK says, or the SDK documents where it really goes. In the second case, `insurancePortion` and `tier` on `LiquidationFee` would be described accordingly, and `getPerpSystemConfig()` (or a dedicated read) would expose the liquidation-fee recipient.

## Actual

Script output, 2026-10-28 (`notes/run-004-1028-routing.txt`):

```
sdk: { historyTsSaysWhollyToInsuranceFund: true,
       getPerpSystemConfigKeys: [marginBank, collateralToken, perpPoolFactory, liquidationEngine, insuranceFund, feeRecipient, maxLeverageLimit, fullyWired],
       getPerpSystemConfigExposesLiquidationFeeRecipient: false,
       errorAbiHasLiquidationFeeRecipientCannotBeInsuranceFund: true }
liquidationFeeRows: 1418, liquidationFeeTotal: 226009.343776278272957015
insuranceFund: { ledgerKinds: { TierFunded: 10, TierWithdrawn: 1 }, totalTierBalances: 1660000, bankAccount: 1660000, tiersEqualTopUpsMinusWithdrawals: true }
liquidationFeeRecipient: { address: 0x95F23A563EceE5c6F841d762943D2F2FEc742253, isInsuranceFund: false, bankAccount: 225768.694146222688033084 }

partB (tx 0x88b153ac…f168, block 35,404,495, tier-2 market):
  feeCharged 289.193296, keeperReward 0.07
  recipientDelta 289.123296  (= fee − reward: true)
  insuranceFundBankDelta 0, tiers unchanged (0 | 1050000 | 260000 | 350000 | 0 | 0)
FAIL: the SDK says liquidation fees go wholly to an Insurance Fund tier, but 226009.343776278272957015 USDso of them (1418 rows) went to the liquidation fee recipient 0x95F2…2253 (bank balance 225768.694146222688033084); the fund's tiers still equal their top-ups and getPerpSystemConfig does not expose the recipient: true
```

**The whole balance reconciles to the wei:**

```
  fees charged since the recipient was set (2026-10-07)     225,863.890830038272957015
− keeper rewards paid in those transactions                     95.981645815584923931
+ 3 liquidations newer than the indexer's latest fee row          0.784962  (0.206966 + 0.483104 + 0.094892, read on chain)
= 225,768.694146222688033084  = the recipient's MarginBank balance
```

The same per-transaction match holds for older fees: tx `0x432a26fe…` (fee 0.50832342, recipient +0.43832342) and tx `0x1070c57b…` (fee 249.8103006, recipient +249.7403006) (`scripts/probe29-liq-fee-recipient.mts`).

The recipient was set by `PerpFeeRecipientChange` kind `LiquidationFeeRecipient`, at block 17,162,830 (tx `0x17bdd054…7405`, 2026-10-07). Before that it was `0xd585…22be`, the trading-fee recipient. The 40 fees charged before that date total 145.45 USDso.

How the indexed `insurancePortion` changed between runs:

| Run | Fee rows | Fees (USDso) | Indexed `insurancePortion` total |
|---|---|---|---|
| 2026-10-22 | 1,022 | 140,838.09* | = amount |
| 2026-10-26 | 1,321 | 203,879.24* | = amount |
| 2026-10-28 | 1,418 | 226,009.34 | 0 on every row, old rows included (`scripts/probe20-fee-tier-tags.mts`) |

\* These two totals were summed by paging `client.listPerpFees`, which drops and repeats rows that share a timestamp (007), so they may be slightly off. The 2026-10-28 total is read in a stable order.

## Evidence

- `evidence/004-liquidation-fee-routing-*.json`: corrected script output (2026-10-28)
- `evidence/004-liquidation-fee-insurance-*.json`: earlier runs (10-22, 10-26), showing the fund side and `insurancePortion = amount`
- `evidence/probe8-liqfee-tx-*.json`: every log of a tier-3 fee transaction, decoded
- `evidence/probe15-keeper-reward-*.json`: every keeper reward sits in a fee transaction
- `scripts/probe29-liq-fee-recipient.mts`, `probe34-recipient-by-block.mts`: recipient deltas per fee transaction
- `scripts/probe35-liq-fee-recipient-getter.mts`: the on-chain getter vs `getPerpSystemConfig`
- `notes/run-004*.txt`

## Environment

- `@somnia-chain/markets-sdk` 0.32.1
- Somnia Tokyo testnet (chain 50383), RPC `https://api.hideki2.infra.testnet.somnia.network`, indexer `https://hideki-dev.smk.somnia.host/v1/graphql`
- MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, LiquidationEngine `0xA66d3C24Ad4a389d863846905D8173e1017e9F4D`, InsuranceFund `0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80`, liquidation-fee recipient `0x95F23A563EceE5c6F841d762943D2F2FEc742253`
- Read-only, no wallet. Node 22.12.0, Windows 11.

## Impact

- **The backstop looks bigger than it is.** The SDK tells integrators and risk dashboards that liquidation fees capitalise the Insurance Fund, which is the stage that absorbs bad debt before ADL. Anyone sizing that backstop from the docs (fund + fee inflow, or `SUM(insurancePortion)` as of 2026-10-26) overstates it by 226,009 USDso, about 13.6% of the 1,660,000 fund.
- **The money can't be traced from the SDK.** Nothing in the SDK names the liquidation-fee recipient or exposes its address, so an integrator following the docs cannot reconcile where 226k USDso of fees went. I could not either, until I found the getter outside the SDK.
- **The read model moved without notice.** The indexer silently re-wrote historical `insurancePortion` values, so a consumer that stored the old numbers now disagrees with the API, with no release note.

## Suggested fix

- **Docs.** Correct `history.ts:572-586` and `system.ts:298, 314-319`. Say that the liquidation fee goes to the liquidation-fee recipient, never to the Insurance Fund (the contract forbids it), and describe what `insurancePortion` and `tier` mean on `LiquidationFee` now.
- **Read surface.** Add `liquidationFeeRecipient` to `getPerpSystemConfig()`, or add a dedicated read.
- **Release.** Publish an SDK release with these changes, so the docs, the indexer and the chain agree.

## Related

- 006 in this repo: the liquidation fees that are skipped instead of charged, which the SDK also does not surface.
- 007 in this repo: paging `listPerpFees` drops and repeats fee rows, so the fee totals the SDK docs suggest come out wrong.
