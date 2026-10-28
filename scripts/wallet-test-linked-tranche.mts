// Wallet test 2: the child's OWN money vs its main's money ("junior tranche").
//
// Docs: a child may withdraw at most `balance - principal`; what the main funded is "BORROWED, NEVER
// WITHDRAWN". Here the child holds 1 USDso of its own, then an order needs ~2.24 USDso, so the main
// funds the rest. After the cancel, the child's withdrawable should be exactly its own 1 USDso.
// Checks every getter (bank getWithdrawableCollateral, SDK getMarginAccount.withdrawable) against the
// contract's real boundary (simulate withdraw(w) and withdraw(w + 1 wei)).
//
// With --send, in order (MAIN = .env PRIVATE_KEY, CHILD = .env CHILD_PRIVATE_KEY):
//   1. MAIN proposeLink(child), CHILD acceptLink(main)     (skipped if already linked)
//   2. MAIN transfers 1 USDso to the CHILD's wallet
//   3. CHILD depositMargin(1 USDso)                          (auto-approves the bank)
//   4. CHILD places XRP-PERP BUY 10 x minQty @ ~50% of mark (cannot fill); the main funds the shortfall
//   5. CHILD cancels; boundary simulations
//   6. cleanup: MAIN recallFromChild(all), CHILD withdraws its own money, CHILD unlinks
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, formatUnits, parseUnits, decodeEventLog } from "viem";
import { chain, RPC, j } from "./client.mts";
import { address as MAIN, client, trader, walletClient } from "./wallet.mts";
import { childAddress as CHILD, childTrader } from "./wallet-child.mts";

const SEND = process.argv.includes("--send");
const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72" as const;
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const T = await import("../node_modules/@somnia-chain/markets-sdk/dist/tradeAbi.js" as any);
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const f = (v: bigint) => formatUnits(v, 18);
const stamp = Date.now();
const out: any = { at: new Date().toISOString(), main: MAIN, child: CHILD, steps: [], sims: [] };
const save = () => writeFileSync(`evidence/wallet-test-linked-tranche-${stamp}.json`, j(out));
const registry = (await client.getPerpLinkedWalletRegistry(BANK)) as `0x${string}`;
const allEvents = Object.values(ev).filter(Array.isArray).flat() as any[];

// Every read in one snapshot is pinned to one block, so a lagging node cannot mix two states.
const snap = async (label: string) => {
  const blockNumber = await pc.getBlockNumber();
  const rd = (address: any, abi: any, functionName: string, args: any[] = []) => pc.readContract({ address, abi, functionName, args, blockNumber } as any) as Promise<any>;
  const st = await rd(BANK, R.marginBankReadAbi, "getAccountState", [CHILD]);
  const s = {
    label, block: blockNumber,
    childWallet: f(await rd(USDSO, erc20, "balanceOf", [CHILD])), mainWallet: f(await rd(USDSO, erc20, "balanceOf", [MAIN])),
    childUnlocked: st.unlockedCollateralBalance as bigint, childLocked: st.lockedCollateral as bigint,
    principal: (await rd(BANK, R.marginBankReadAbi, "getMainFundedPrincipal", [CHILD])) as bigint,
    payer: await rd(BANK, R.marginBankReadAbi, "getMainFundingPayer", [CHILD]),
    bankWithdrawable: (await rd(BANK, R.marginBankReadAbi, "getWithdrawableCollateral", [CHILD])) as bigint,
    equity: (await rd(BANK, R.marginBankReadAbi, "getAccountEquity", [CHILD])) as bigint,
  };
  out[label] = s;
  console.log(label, j({ ...s, childUnlocked: f(s.childUnlocked), childLocked: f(s.childLocked), principal: f(s.principal), bankWithdrawable: f(s.bankWithdrawable), equity: f(s.equity) }));
  return s;
};
const decodeAll = (rc: any) => rc.logs.map((l: any) => { try { const d: any = decodeEventLog({ abi: allEvents, data: l.data, topics: l.topics }); return d.eventName; } catch { return l.topics[0].slice(0, 10); } });
const record = async (step: string, res: any, extra: any = {}) => {
  const hash = (typeof res === "string" ? res : res.hash ?? res.txHash ?? res.receipt?.transactionHash) as `0x${string}`;
  const rc = await pc.waitForTransactionReceipt({ hash });
  out.steps.push({ step, hash, block: rc.blockNumber, status: rc.status, logs: decodeAll(rc), ...extra });
  console.log(step, hash, rc.status, decodeAll(rc).join(", "));
  save();
  return rc;
};
const sim = async (label: string, from: `0x${string}`, fn: string, args: any[], block?: bigint) => {
  let r: any;
  try { await pc.simulateContract({ account: from, address: BANK, abi: T.marginBankWriteAbi, functionName: fn, args, blockNumber: block } as any); r = { label, args: args.map(String), result: "ok" }; }
  catch (e: any) { r = { label, args: args.map(String), result: "revert", reason: e.cause?.data?.errorName ?? e.cause?.signature ?? e.shortMessage?.split("\n")[0] }; }
  out.sims.push(r); console.log("sim", j(r)); return r;
};

const xrp = ((await client.listPerpMarkets()) as any[]).find((x) => x.baseSymbol === "XRP")!;
const st: any = await client.getPerpState(xrp.poolAddress);
const tick = BigInt(xrp.tickSize), lot = BigInt(xrp.lotSize), minQ = BigInt(xrp.minQuantity);
const price = (st.markPrice / 2n / tick) * tick;
const quantity = ((minQ * 10n + lot - 1n) / lot) * lot;
const OWN = parseUnits("1", 18);
out.plan = { price: f(price), quantity: formatUnits(quantity, xrp.baseDecimals), notional: f((price * quantity) / 10n ** BigInt(xrp.baseDecimals)), childOwnDeposit: "1" };
console.log("plan", out.plan);
for (const a of [MAIN, CHILD]) if (((await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getCreditFloor", args: [a] })) as bigint) > 0n) throw new Error("STOP: Arena account");
await snap("t0_start");
if (!SEND) { console.log("dry run: nothing sent. Re-run with --send."); process.exit(0); }

// 1. link
const linked = await pc.readContract({ address: registry, abi: R.linkedWalletRegistryReadAbi, functionName: "areLinked", args: [MAIN, CHILD] });
if (!linked) {
  await record("propose", await trader.proposePerpWalletLink({ child: CHILD, marginBank: BANK }));
  await record("accept", await childTrader.acceptPerpWalletLink({ main: MAIN, marginBank: BANK }));
}
// 2-3. the child's own 1 USDso, in its bank account
await record("mainTransfer1", await walletClient.writeContract({ address: USDSO, abi: erc20, functionName: "transfer", args: [CHILD, OWN] }));
await record("childDeposit1", await childTrader.depositMargin({ marginBank: BANK, amount: OWN }));
await snap("t1_deposited");
// 4-5. order the main tops up, then cancel
const placed = await childTrader.placePerpOrder({ pool: xrp.poolAddress, isBid: true, price, quantity });
await record("childPlace", placed, { orderId: placed.orderId?.toString() });
await snap("t2_placed");
await record("childCancel", await childTrader.cancelOrder({ pool: xrp.poolAddress, orderId: placed.orderId }));
const s3 = await snap("t3_cancelled");

const own = s3.childUnlocked - s3.principal;           // what the docs say is withdrawable
out.boundary = { unlocked: f(s3.childUnlocked), principal: f(s3.principal), documentedWithdrawable: f(own), bankWithdrawable: f(s3.bankWithdrawable), sdkWithdrawable: null as any };
out.boundary.sdkWithdrawable = f(BigInt((await client.getMarginAccount(BANK, CHILD)).withdrawable));
await sim("withdraw(documented max)", CHILD, "withdraw", [own], s3.block);
await sim("withdraw(documented max + 1 wei)", CHILD, "withdraw", [own + 1n], s3.block);
await sim("withdraw(bank getWithdrawableCollateral)", CHILD, "withdraw", [s3.bankWithdrawable], s3.block);
await sim("withdraw(bank getWithdrawableCollateral + 1 wei)", CHILD, "withdraw", [s3.bankWithdrawable + 1n], s3.block);
await sim("withdraw(all unlocked)", CHILD, "withdraw", [s3.childUnlocked], s3.block);
console.log("boundary", j(out.boundary));
save();

// 6. cleanup
await record("mainRecall", await trader.recallPerpMainFunding({ marginBank: BANK, child: CHILD, amount: s3.principal * 2n + 1n }));
const s4 = await snap("t4_recalled");
if (s4.bankWithdrawable > 0n) await record("childWithdrawOwn", await childTrader.withdrawMargin({ marginBank: BANK, amount: s4.bankWithdrawable }));
await record("childUnlink", await childTrader.unlinkPerpWallet({ marginBank: BANK, counterparty: MAIN }));
await snap("t5_end");
save();
process.exit(0);
