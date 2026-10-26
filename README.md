# dreamDEX Perps feedback: clatsonhacks

Feedback track submission for the dreamDEX Perps Builder Bounty. Every item was found on Somnia Tokyo testnet (Hideki, chain 50383) with `@somnia-chain/markets-sdk` 0.32.1, 2026-10-22 to 2026-10-27. 005 was found during a live two-wallet test of the linked-wallet rail; its repro, like the others, is read-only and needs no wallet.

## Issues

| # | Title | Severity | Area | Repro |
|---|---|---|---|---|
| [002](feedback/002-btc-long-adl-runs-in-storage-order-not-by-profit.md) | BTC-PERP long ADL runs in storage order (5,631 holders > scan cap 500), not "most profit relative to equity first" | normal | docs | `npx tsx scripts/repro-002-btc-long-adl-storage-order.mts` |
| [003](feedback/003-adl-netting-for-linked-wallets-is-unwired-while-funding-rail-is-live.md) | Linked-wallet funding rail armed on the MarginBank, ADL netting unwired on the LiquidationEngine | normal | contracts | `npx tsx scripts/repro-003-adl-netting-unwired.mts` |
| [005](feedback/005-getperpwalletlinkage-reports-a-linked-funded-child-as-unlinked-for-its-first-hour.md) | `getPerpWalletLinkage` reports a linked child as unlinked (and its main as no main) for the link's first hour, while the child's orders already spend the main's wallet | normal | SDK | `npx tsx scripts/repro-005-linkage-empty-until-mature.mts` |

By severity: 3 normal. By area: contracts 1, docs 1, SDK 1.

One further item was reported privately to security@dreamdex.io and is not included here.

## How to reproduce

```
npm ci
npx tsx scripts/repro-00N-*.mts     # exits 1 while the bug is present, 0 once fixed
```

Each repro script uses only public endpoints (`scripts/client.mts`), needs no key, prints its evidence and writes a JSON copy to `evidence/`. Each file in `feedback/` is self-contained.

## Scope

- Looked at: SDK perps ADL, linked-wallet, portfolio, system and fee-history modules; the Insurance Fund, LiquidationEngine and MarginBank on-chain; the indexer's perps entities; trader docs on liquidations and ADL; the Arena rules.
- Live wallet tests (testnet USDso, own wallets, no Arena account): owner auto-pull indexing (`scripts/wallet-test-autopull.mts`, clean) and the full linked-wallet cycle: propose, accept, main-funded child order, cancel, repay, unlink, recall (`scripts/wallet-test-linked.mts`, led to 005; everything else behaved as documented). These read keys from a git-ignored `.env`.
- Not tested: HTTP and WebSocket APIs, the app UI with a funded Arena wallet, explorer verification, bot-kit strategies. Each item was duplicate-checked against the public feedback repos on 2026-10-22, 2026-10-26 and 2026-10-27.
- Feedback only. Security issues go to security@dreamdex.io, not to this repo.
