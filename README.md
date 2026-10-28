# dreamDEX Perps feedback: clatsonhacks

Feedback track submission for the dreamDEX Perps Builder Bounty.

## Timeline of reports

All times UTC. "Published" is the first commit containing the item in this repo; the git history is the record.

| # | Found | Reported | How |
|---|---|---|---|
| 004 | 2026-10-22 | **2026-10-23** | Emailed privately to security@dreamdex.io. The team replied that it is a product/docs issue that "belongs in the Feedback track"; published here 2026-10-28 19:10 (commit `e9cd6a9`). |
| 002 | 2026-10-22 | **2026-10-26 16:58** | Published (commit `5fea0f4`), submitted in DoraHacks Build 50378 the same day |
| 003 | 2026-10-22 | **2026-10-26 16:58** | Published (commit `5fea0f4`), submitted in DoraHacks Build 50378 the same day |
| 005 | 2026-10-26 | **2026-10-26 19:06** | Published (commit `1435fae`) |
| 006 | 2026-10-28 | **2026-10-28** | Published (see git history for the exact commit time) |

Each file in `feedback/` repeats its own date on a **Reported:** line near the top.

## Issues

| # | Title | Severity | Area | Repro |
|---|---|---|---|---|
| [002](feedback/002-btc-long-adl-runs-in-storage-order-not-by-profit.md) | BTC-PERP long ADL runs in storage order (5,631 holders > scan cap 500), not "most profit relative to equity first" | normal | docs | `npx tsx scripts/repro-002-btc-long-adl-storage-order.mts` |
| [003](feedback/003-adl-netting-for-linked-wallets-is-unwired-while-funding-rail-is-live.md) | Linked-wallet funding rail armed on the MarginBank, ADL netting unwired on the LiquidationEngine | normal | contracts | `npx tsx scripts/repro-003-adl-netting-unwired.mts` |
| [004](feedback/004-liquidation-fees-never-reach-the-insurance-fund.md) | Liquidation fees (225,706 USDso over 1,418 liquidations) are documented as Insurance Fund inflow, but no tier and no fund balance ever receives them | major | contracts | `npx tsx scripts/repro-004-liquidation-fee-not-in-insurance-fund.mts` |
| [005](feedback/005-getperpwalletlinkage-reports-a-linked-funded-child-as-unlinked-for-its-first-hour.md) | `getPerpWalletLinkage` reports a linked child as unlinked (and its main as no main) for the link's first hour, while the child's orders already spend the main's wallet | normal | SDK | `npx tsx scripts/repro-005-linkage-empty-until-mature.mts` |
| [006](feedback/006-liquidation-fee-skipped-is-undocumented-and-the-indexer-drops-its-reason-and-amount.md) | `LiquidationFeeSkipped` (82 liquidations) is an indexer fee kind the SDK never mentions, served without its reason or skipped amount, and with no SDK ABI to decode it | normal | API | `npx tsx scripts/repro-006-liquidation-fee-skipped-undocumented.mts` |

By severity: 1 major, 4 normal. By area: contracts 2, API 1, docs 1, SDK 1.

## How to reproduce

```
npm ci
npx tsx scripts/repro-00N-*.mts     # exits 1 while the bug is present, 0 once fixed
```

Each repro script uses only public endpoints (`scripts/client.mts`), needs no key, prints its evidence and writes a JSON copy to `evidence/`. Each file in `feedback/` is self-contained.

## Scope

- Found on Somnia Tokyo testnet (Hideki, chain 50383) with `@somnia-chain/markets-sdk` 0.32.1, 2026-10-22 to 2026-10-29.
- Looked at: SDK perps ADL, linked-wallet, portfolio, system and fee-history modules; the Insurance Fund, LiquidationEngine and MarginBank on-chain; the indexer's perps entities; trader docs on liquidations and ADL; the Arena rules.
- Live wallet tests (testnet USDso, own wallets, no Arena account): owner auto-pull indexing (`scripts/wallet-test-autopull.mts`, clean) and the full linked-wallet cycle: propose, accept, main-funded child order, cancel, repay, unlink, recall (`scripts/wallet-test-linked.mts`, led to 005; everything else behaved as documented). These read keys from a git-ignored `.env`.
- Not tested: HTTP and WebSocket APIs, the app UI with a funded Arena wallet, explorer verification, bot-kit strategies.
- Security issues go to security@dreamdex.io first, as 004 did.
