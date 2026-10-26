// Wallet test: the linked-wallet funding rail end to end, with real money (testnet USDso).
//
// MAIN = the bounty test wallet (.env PRIVATE_KEY). CHILD = a fresh wallet (.env CHILD_PRIVATE_KEY)
// that holds only gas STT and no USDso, so whatever its order needs must come from the MAIN.
//
// With --send, in order:
//   1. MAIN sends the CHILD 1 STT for gas (skipped if it already has 0.2)
//   2. MAIN proposeLink(child)            3. CHILD acceptLink(main)
//   4. CHILD places XRP-PERP BUY minQty @ ~50% of mark (cannot fill): the pool pulls the margin from MAIN
//   5. CHILD cancels it                   6. simulate CHILD withdraw(all / 1 wei): the docs say it must revert
//   7. CHILD repayFunding(half)           8. CHILD unlink(main), with principal still outstanding
//   9. simulate CHILD withdraw again      10. MAIN recallFromChild(child, rest)
//  11. indexer: PerpWalletLinkEvent, PerpMarginPull, PerpMainFundingEvent vs the receipts
// No Arena account is involved. Without --send it only reads and prints the plan.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, formatUnits, parseEther, decodeEventLog } from "viem";
import { chain, RPC, j } from "./client.mts";
import { address as MAIN, client, trader, walletClient } from "./wallet.mts";
import { childAddress as CHILD, childTrader, childWallet } from "./wallet-child.mts";

const SEND = process.argv.includes("--send");
const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72" as const;
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const T = await import("../node_modules/@somnia-chain/markets-sdk/dist/tradeAbi.js" as any);
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const f = (v: bigint) => formatUnits(v, 18);
const out: any = { at: new Date().toISOString(), main: MAIN, child: CHILD, steps: [], sims: [] };
const save = () => writeFileSync(`evidence/wallet-test-linked-${stamp}.json`, j(out));
const stamp = Date.now();

const registry = (await client.getPerpLinkedWalletRegistry(BANK)) as `0x${string}`;
const bankRead = (fn: string, args: any[]) => pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: fn, args } as any) as Promise<any>;

const snap = async (label: string) => {
  const [mA, cA] = await Promise.all([client.getMarginAccount(BANK, MAIN), client.getMarginAccount(BANK, CHILD)]);
  const mf = await client.getPerpMainFunding(BANK, CHILD);
  const s = {
    label,
    mainWallet: f(await pc.readContract({ address: USDSO, abi: erc20, functionName: "balanceOf", args: [MAIN] })),
    mainAllowance: f(await pc.readContract({ address: USDSO, abi: erc20, functionName: "allowance", args: [MAIN, BANK] })),
    mainBankUnlocked: f(BigInt(mA.unlockedCollateralBalance)),
    childWallet: f(await pc.readContract({ address: USDSO, abi: erc20, functionName: "balanceOf", args: [CHILD] })),
    childBankUnlocked: f(BigInt(cA.unlockedCollateralBalance)),
    childBankLocked: f(BigInt(cA.lockedCollateral)),
    childWithdrawable: f(await bankRead("getWithdrawableCollateral", [CHILD])),
    childPrincipal: f(mf.principal), childPayer: mf.payer,
    childFundingPayer: await client.quotePerpFundingPayer(BANK, CHILD),
    childLinkage: await client.getPerpWalletLinkage(registry, CHILD),
  };
  out[label] = s;
  console.log(label, j(s));
  return s;
};

// Decode every log of a receipt with the SDK's own event ABIs (all exported *EventsAbi arrays).
const allEvents = Object.values(ev).filter(Array.isArray).flat() as any[];
const decodeAll = (rc: any) => rc.logs.map((l: any) => {
  try { const d: any = decodeEventLog({ abi: allEvents, data: l.data, topics: l.topics }); return { address: l.address, logIndex: l.logIndex, event: d.eventName, args: d.args }; }
  catch { return { address: l.address, logIndex: l.logIndex, topic0: l.topics[0], undecoded: true }; }
});
const hashOf = (r: any) => (r.hash ?? r.txHash ?? r.receipt?.transactionHash) as `0x${string}`;
const record = async (step: string, res: any, extra: any = {}) => {
  const hash = typeof res === "string" ? res : hashOf(res);
  const rc = await pc.waitForTransactionReceipt({ hash });
  const row = { step, hash, block: rc.blockNumber, status: rc.status, gasUsed: rc.gasUsed, logs: decodeAll(rc), ...extra };
  out.steps.push(row);
  console.log(step, hash, rc.status, "logs:", row.logs.map((l: any) => l.event ?? l.topic0).join(", "));
  save();
  return rc;
};
const sim = async (label: string, from: `0x${string}`, fn: string, args: any[], expect: "revert" | "ok") => {
  let r: any;
  try { await pc.simulateContract({ account: from, address: BANK, abi: T.marginBankWriteAbi, functionName: fn, args } as any); r = { label, result: "ok" }; }
  catch (e: any) { r = { label, result: "revert", reason: e.cause?.data?.errorName ?? e.shortMessage?.split("\n")[0] }; }
  r.expected = expect; r.unexpected = r.result !== expect;
  out.sims.push(r);
  console.log("sim", j(r));
  return r;
};

// ---- read-only preflight ----
const xrp = ((await client.listPerpMarkets()) as any[]).find((x) => x.baseSymbol === "XRP")!;
const st: any = await client.getPerpState(xrp.poolAddress);
const tick = BigInt(xrp.tickSize), lot = BigInt(xrp.lotSize), minQ = BigInt(xrp.minQuantity);
const price = (st.markPrice / 2n / tick) * tick;
const quantity = minQ % lot === 0n ? minQ : (minQ / lot + 1n) * lot;
out.pre = {
  registry, maxChildren: (await client.getPerpMaxLinkedChildren(registry)).toString(),
  mainSTT: f(await pc.getBalance({ address: MAIN })), childSTT: f(await pc.getBalance({ address: CHILD })),
  childCreditFloor: f(await bankRead("getCreditFloor", [CHILD])), mainCreditFloor: f(await bankRead("getCreditFloor", [MAIN])),
  mainLinkage: await client.getPerpWalletLinkage(registry, MAIN),
  mainCapacity: f(await client.getPerpWalletPullCapacity(BANK, MAIN)), childCapacity: f(await client.getPerpWalletPullCapacity(BANK, CHILD)),
  order: { market: "XRP-PERP", pool: xrp.poolAddress, mark: f(st.markPrice), price: f(price), quantity: formatUnits(quantity, xrp.baseDecimals) },
};
console.log("pre", j(out.pre));
if (out.pre.childCreditFloor !== "0" || out.pre.mainCreditFloor !== "0") throw new Error("STOP: an Arena (voucher) account is involved");
await snap("s0_start");
if (!SEND) { console.log("dry run: nothing sent. Re-run with --send."); process.exit(0); }

// 1. gas for the child
if ((await pc.getBalance({ address: CHILD })) < parseEther("0.2")) {
  await record("gas", await walletClient.sendTransaction({ to: CHILD, value: parseEther("1") }));
}
// 2-3. handshake
await record("propose", await trader.proposePerpWalletLink({ child: CHILD, marginBank: BANK }));
await record("accept", await childTrader.acceptPerpWalletLink({ main: MAIN, marginBank: BANK }));
await snap("s1_linked");

// 4. child order: margin must come from MAIN
const placed = await childTrader.placePerpOrder({ pool: xrp.poolAddress, isBid: true, price, quantity });
const placeRc = await record("childPlace", placed, { orderId: placed.orderId?.toString() });
const sPlaced = await snap("s2_placed");

// 5. cancel
if (placed.orderId != null) await record("childCancel", await childTrader.cancelOrder({ pool: xrp.poolAddress, orderId: placed.orderId }));
const sCancel = await snap("s3_cancelled");

// 6. the child must not be able to take the MAIN's money out
void sCancel;
const childUnlocked = BigInt((await client.getMarginAccount(BANK, CHILD)).unlockedCollateralBalance);
const principal = (await client.getPerpMainFunding(BANK, CHILD)).principal as bigint;
await sim("child withdraw(all unlocked) while principal outstanding", CHILD, "withdraw", [childUnlocked], "revert");
await sim("child withdraw(1 wei) while principal outstanding", CHILD, "withdraw", [1n], "revert");
await sim("main recallFromChild(child, 1 wei) from a non-payer (the child itself)", CHILD, "recallFromChild", [CHILD, 1n], "revert");

// 7. child repays half
await record("childRepayHalf", await childTrader.repayPerpMainFunding({ marginBank: BANK, amount: principal / 2n }));
await snap("s4_repaidHalf");

// 8. unlink from the child side, claim still open
await record("childUnlink", await childTrader.unlinkPerpWallet({ marginBank: BANK, counterparty: MAIN }));
await snap("s5_unlinked");

// 9. after unlink: still no withdrawal of the main's money
const left = (await client.getPerpMainFunding(BANK, CHILD)).principal as bigint;
const childUnlocked2 = BigInt((await client.getMarginAccount(BANK, CHILD)).unlockedCollateralBalance);
await sim("child withdraw(all unlocked) after unlink, principal outstanding", CHILD, "withdraw", [childUnlocked2], "revert");

// 10. main recalls the rest (over-ask: the bank clamps)
await record("mainRecall", await trader.recallPerpMainFunding({ marginBank: BANK, child: CHILD, amount: left * 2n }));
await snap("s6_recalled");

// 11. indexer view of all of it (give it up to ~2 min to catch up)
const lastBlock = out.steps.at(-1).block as bigint;
for (let i = 0; i < 12; i++) {
  const r = await fetch((client as any).indexerUrl ?? "https://hideki-dev.smk.somnia.host/v1/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ chain_metadata { latest_processed_block } }" }) });
  const head = BigInt(((await r.json()) as any).data.chain_metadata[0].latest_processed_block);
  if (head >= lastBlock) break;
  await new Promise((r) => setTimeout(r, 10_000));
}
out.indexer = {
  linkEvents: await client.listPerpWalletLinkEvents({ child: CHILD }),
  marginPulls: await client.listPerpMarginPulls({ account: CHILD }),
  mainFundingEvents: await client.listPerpMainFundingEvents({ account: CHILD }),
};
console.log("indexer", j(out.indexer));
out.placeBlock = placeRc.blockNumber;
void sPlaced;
save();
process.exit(0);
