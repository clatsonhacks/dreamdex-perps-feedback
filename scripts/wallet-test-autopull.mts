// Wallet test: does an owner order that auto-pulls margin from the wallet get indexed as a
// PerpMarginPull row? (lead LD9: the indexer's newest PerpMarginPull is at block 16,323,696.)
//
// Sends at most 3 transactions from the bounty test wallet, nothing else:
//   1. USDso.approve(MarginBank, 10 USDso)   lets the pool pull margin from the wallet (skipped if already approved)
//   2. trader.placePerpOrder: XRP-PERP limit BUY 6.9 @ ~50% of mark (cannot fill), sent by the owner
//   3. trader.cancelOrder for that order
// The pulled margin stays in this wallet's own MarginBank account (withdrawable later).
// No Arena account is involved. Without --send it only prints the plan.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, formatUnits, parseUnits } from "viem";
import { chain, RPC, INDEXER, j } from "./client.mts";
import { address, client, trader, walletClient } from "./wallet.mts";

const SEND = process.argv.includes("--send");
const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72" as const;
const PULL_TOPIC = "0x5172d1be57aba2496f34563b03e92e754c67daf93fbaf76a42fa6f414f604cfe";
const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const f = (v: bigint) => formatUnits(v, 18);
const out: any = { at: new Date().toISOString(), address, steps: [] };
const save = () => writeFileSync(`evidence/wallet-test-autopull-${Date.now()}.json`, j(out));

const m = ((await client.listPerpMarkets()) as any[]).find((x) => x.baseSymbol === "XRP")!;
const st: any = await client.getPerpState(m.poolAddress);
const tick = BigInt(m.tickSize), lot = BigInt(m.lotSize), minQ = BigInt(m.minQuantity);
const price = (st.markPrice / 2n / tick) * tick;
const quantity = minQ % lot === 0n ? minQ : (minQ / lot + 1n) * lot;
const approveAmount = parseUnits("10", 18);
out.plan = { market: "XRP-PERP", pool: m.poolAddress, mark: f(st.markPrice), price: f(price), quantity: formatUnits(quantity, m.baseDecimals), approve: "10 USDso" };
console.log("plan", out.plan);
if (!SEND) { console.log("dry run: nothing sent. Re-run with --send."); process.exit(0); }

const snap = async () => {
  const a = await client.getMarginAccount(BANK, address);
  return { wallet: f(await pc.readContract({ address: USDSO, abi: erc20, functionName: "balanceOf", args: [address] })), bankUnlocked: f(BigInt(a.unlockedCollateralBalance)), bankLocked: f(BigInt(a.lockedCollateral)) };
};
out.before = await snap();
console.log("before", out.before);

// 1. approve
const allowance = await pc.readContract({ address: USDSO, abi: erc20, functionName: "allowance", args: [address, BANK] });
if (allowance < approveAmount) {
  const hash = await walletClient.writeContract({ address: USDSO, abi: erc20, functionName: "approve", args: [BANK, approveAmount] });
  const rc = await pc.waitForTransactionReceipt({ hash });
  out.steps.push({ step: "approve", hash, block: rc.blockNumber, status: rc.status });
  console.log("approve", hash, rc.status);
}

// 2. place (owner-sent, so the pool may auto-pull the shortfall from the wallet)
const placed = await trader.placePerpOrder({ pool: m.poolAddress, isBid: true, price, quantity });
const placeHash = placed.hash ?? placed.txHash ?? placed.receipt?.transactionHash;
const prc = await pc.getTransactionReceipt({ hash: placeHash });
const pullLogs = prc.logs.filter((l) => l.topics[0] === PULL_TOPIC);
out.steps.push({ step: "place", hash: placeHash, block: prc.blockNumber, status: prc.status, orderId: placed.orderId?.toString(), pullEventsInReceipt: pullLogs.length, pullAmounts: pullLogs.map((l) => f(BigInt(l.data.slice(0, 66)))) });
console.log("place", placeHash, prc.status, "orderId", placed.orderId?.toString(), "pull events in receipt:", pullLogs.length);
out.afterPlace = await snap();
console.log("after place", out.afterPlace);
save();

// 3. cancel
if (placed.orderId != null) {
  const c = await trader.cancelOrder({ pool: m.poolAddress, orderId: placed.orderId });
  const chash = c.hash ?? c.txHash ?? c.receipt?.transactionHash;
  out.steps.push({ step: "cancel", hash: chash });
  console.log("cancel", chash);
}
out.afterCancel = await snap();
console.log("after cancel", out.afterCancel);

// 4. did the indexer record the pull? Give it up to ~2 minutes.
const q = async () => {
  const r = await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpMarginPull(where:{txHash:{_eq:"${placeHash}"}}) { id account pool orderId source amount blockNumber } chain_metadata { latest_processed_block } }` }) });
  return ((await r.json()) as any).data;
};
for (let i = 0; i < 12; i++) {
  const d = await q();
  out.indexer = { rows: d.PerpMarginPull, indexerHead: d.chain_metadata[0].latest_processed_block, placeBlock: prc.blockNumber.toString() };
  if (d.PerpMarginPull.length || BigInt(d.chain_metadata[0].latest_processed_block) > prc.blockNumber + 600n) break;
  await new Promise((r) => setTimeout(r, 10_000));
}
console.log("indexer", j(out.indexer));
console.log(pullLogs.length && !out.indexer.rows.length ? "FINDING: the pool emitted a margin pull on chain, but the indexer has no PerpMarginPull row for it" : "no indexer gap shown by this run");
save();
process.exit(0);
