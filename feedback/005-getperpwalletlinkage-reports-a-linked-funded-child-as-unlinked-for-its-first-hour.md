# `getPerpWalletLinkage` reports a linked child as unlinked for the link's first hour, while the child's orders are already spending its main's wallet
Severity: normal
Area: SDK

**Reported:** first published in this repo on 2026-10-26 19:06 UTC (commit `1435fae`). Found the same day during a live two-wallet test.

**Map cells:** S11/B, S11/F, S13/A | **Lead:** found during a live linked-wallet test

## Summary

For the first `linkMaturitySeconds` (3,600 s on Hideki) after `acceptLink`, the registry's `linkageOf(wallet)` returns `main = 0x0` and `members = []`. It does fill in `linkedAt` and `maturesAt`. The SDK builds `getPerpWalletLinkage` directly on that read, so for that whole hour:

- the child reads as `{ isChild: false, main: 0x0, members: [] }`, and
- the main reads as `{ isMain: false, main: 0x0, members: [] }`.

Meanwhile the link is fully live:

- `mainOf`, `areLinked`, `groupOf` and `childrenOf` all report the pair.
- `quotePerpFundingPayer(child)` says `funded: true`.
- The child's first order had already pulled 0.2229 USDso out of the main's wallet.

The SDK docs say that `main` and `members` are zero/empty only when the wallet is unlinked, and that a link "can be fundable and not yet mature". They also tell integrators to use this read to check whether a wallet is already in a group.

## Steps to reproduce

1. `npm install` in this repo.
2. `npx tsx scripts/repro-005-linkage-empty-until-mature.mts`

The script needs no wallet. It calls the SDK's own `getPerpWalletLinkage`, `quotePerpFundingPayer`, `getPerpMainFunding` and `listPerpLinkedChildren` with every read pinned to block 33,889,745. At that block my test child `0x7400…080d` had been linked to `0xE488…1db3` for 4 seconds, and its first order had just been funded by the main. The script compares those results with the registry's raw graph reads at the same block, and exits 1 while the SDK says "not linked" and the bank says "linked and funded".

To see it live instead: link two wallets, then call `client.getPerpWalletLinkage(registry, child)` at any time within the next hour.

## Expected

- `src/perp/linkedWallet.ts:154`: `main`: "The group's main. Zero when the wallet is unlinked."
- `src/perp/linkedWallet.ts:156`: `members`: "The main plus every child. Empty when the wallet is unlinked."
- `src/perp/linkedWallet.ts:162`: `isChild`: "whether this wallet is a child (has a main that is not itself)"
- `src/somniaMarketsClient.ts:4798`: "`maturesAt` gates ADL netting only: the funding rail reads the raw graph, so a link can be fundable and not yet mature."
- `docs/PERPS.md:712`: "Who is in my group, and when did it mature? → `client.getPerpWalletLinkage(registry, wallet)`"
- `docs/PERPS.md:774-775`: "`client.getPerpWalletLinkage(registry, wallet)` settles guards 2, 3 and 4 — read it on both parties, since `main` being non-zero means the wallet is already in a group."

So during the immature hour, the child should read `isChild: true` with its main and members, and the main should read `isMain: true`. Only `maturesAt` should still be in the future.

## Actual

Script output (`notes/run-005-linkage-empty-until-mature.txt`, block 33,889,745, `linkMaturitySeconds` 3600):

```
SDK getPerpWalletLinkage(child): { main: 0x000…000, members: [], linkedAt: 1793041137, maturesAt: 1793044737, isChild: false, isMain: false }
SDK getPerpWalletLinkage(main):  { main: 0x000…000, members: [], linkedAt: 0, maturesAt: 0, isChild: false, isMain: false }
SDK quotePerpFundingPayer(child): { funded: true, payer: 0xE488…1db3 }
SDK getPerpMainFunding(child):    { principal: 0.2229045 USDso, payer: 0xE488…1db3 }
SDK listPerpLinkedChildren(main): [ 0x7400…080d ]
registry mainOf(child) = 0xE488…1db3 | areLinked = true | groupOf(child) = [0xE488…1db3, 0x7400…080d]
FAIL: link 4s old (matures in 3596s); main has funded 0.2229045 USDso into the child, but getPerpWalletLinkage says child { isChild: false, main: 0x0, members: [] } and main { isMain: false }
```

The raw return bytes of `linkageOf(child)` at that block are `main = 0`, `members` offset → length 0, then `linkedAt` and `maturesAt` set, so this is what the contract returns. It is not an SDK decoding error.

The cause is maturity. The same read on the two older (matured) links on Hideki returns the full group, and the SDK reports them correctly (`evidence/probe18-linkage-mature-*.json`):

```
0x29fd…fb41 → 0xd4ac…8f8f  mature: linkageOf(child) main 0x29FD…, members 2, sdk isChild true
0x93b7…a31e → 0x19e7…ff2a  mature: linkageOf(child) main 0x93B7…, members 2, sdk isChild true
```

## How this was found

This came from a full live run of the rail, with two wallets of my own (`scripts/wallet-test-linked.mts`, `notes/wallet-test-linked-run.txt`, `evidence/wallet-test-linked-*.json`):

1. propose
2. accept
3. a child order funded from the main (`MainFundedChild`, `PerpMarginPull` source `Main`)
4. cancel
5. child repays half
6. unlink with the claim still open
7. main recalls the rest

Everything else behaved as documented:

- The child's `withdraw` reverts with principal outstanding, both before and after the unlink.
- A non-payer can't `recallFromChild`.
- Repay and recall both return to the main's wallet; the main ended at exactly its starting balance.
- The indexer's `PerpWalletLinkEvent`, `PerpMarginPull` and `PerpMainFundingEvent` rows match every receipt.

Only the linkage read was wrong. It said "not linked" at every snapshot.

## Impact

- **Wrong status shown to users.** A wallet UI or bot that shows link status with `getPerpWalletLinkage` (as `PERPS.md:712` suggests) shows a freshly linked child as unlinked for an hour, and its main as having no children. During that hour the child's orders silently draw on the main's wallet. That is exactly the "whose money is this order spending" surprise the module's docs work to prevent.
- **The documented pre-accept check fails.** `PERPS.md:774` tells integrators to confirm a wallet is not already in a group with this read. During the first hour it reports `main = 0` for a wallet that is already linked, so the check passes and the `acceptLink` reverts with `AlreadyLinked` (or `CallerIsMain` for the main), costing gas.
- **Inconsistent reads.** `getPerpWalletLinkage` disagrees with `listPerpLinkedChildren`, `quotePerpFundingPayer` and `getPerpMainFunding` for the same wallet at the same block.

## Suggested fix

Either:

- **SDK fix:** build `main` and `members` in `getPerpWalletLinkage` from `mainOf` and `groupOf`, which report the live graph, and take only `linkedAt` and `maturesAt` from `linkageOf`. Or
- **Contract fix:** have `linkageOf` return the group whether or not it is mature, so that maturity lives only in `maturesAt`.

If hiding the group until maturity is intended (for ADL netting), document it on `PerpWalletLinkage.main`, `members`, `isChild` and `isMain`, and in `PERPS.md:712` and `:774`. Also point status UIs and the pre-accept check at `mainOf` and `groupOf` instead.

## Related

- 003 in this repo (ADL netting unwired) is about the LiquidationEngine's registry. This report is about the read surface the SDK documents for link status.

## Environment

- `@somnia-chain/markets-sdk` 0.32.1. Somnia Tokyo testnet (chain 50383), RPC `https://api.hideki2.infra.testnet.somnia.network`.
- MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, LinkedWalletRegistry `0x5b3C5Bf1F7AdA852e8AA783f6299932E32073aFb`.
- Test wallets (both mine): main `0xE488bb2bd58E9C425F525293856FAA529f7b1db3`, child `0x7400346f9492cf6Ac73c13A3B2D0b864b0F5080d`.
- Transactions:
  - propose `0x58f23bf4…8165b`
  - accept `0x583c47fd…0e30f`
  - child order `0x25c3b1a2…b86283`
  - repay `0xc038d5a5…b96b`
  - unlink `0x61775bbc…4e5a`
  - recall `0xe51371cb…f35c3`
- Node 22.12.0, Windows 11. The repro itself is keyless.
