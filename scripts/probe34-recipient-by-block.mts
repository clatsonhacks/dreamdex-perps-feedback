// Probe 34: per-block reconciliation of the LiquidationFeeRecipient's MarginBank balance:
//   delta(b) vs Σ indexed LiquidationFee.amount − Σ KeeperReward in block b. Reports every block where they differ,
//   over all blocks that had a fee, plus a coarse check that nothing else moved the balance in between.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, formatUnits } from "viem";
import { chain, RPC, INDEXER, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const, REC = (process.argv[2] ?? "0x95f23a563ecee5c6f841d762943d2f2fec742253") as `0x${string}`;
const f = (v: bigint) => formatUnits(v, 18);
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
const page = async (ent: string, where: string, fields: string) => { const all: any[] = []; for (let o = 0; ; o += 1000) { const p = (await q(`{ ${ent}(where:${where}, limit:1000, offset:${o}, order_by:{id:asc}) { ${fields} } }`)).data[ent]; all.push(...p); if (p.length < 1000) break; } return all; };
const fees = await page("PerpFeeRecord", `{kind:{_eq:"LiquidationFee"}}`, "id amount blockNumber txHash");
const kr = await page("LiquidationEvent", `{kind:{_eq:"KeeperReward"}}`, "id keeperReward blockNumber txHash");
const exp = new Map<bigint, bigint>();
for (const r of fees) exp.set(BigInt(r.blockNumber), (exp.get(BigInt(r.blockNumber)) ?? 0n) + BigInt(r.amount));
const feeTx = new Set(fees.map((r) => r.txHash));
for (const r of kr) if (feeTx.has(r.txHash)) exp.set(BigInt(r.blockNumber), (exp.get(BigInt(r.blockNumber)) ?? 0n) - BigInt(r.keeperReward ?? 0));
const bal = async (b: bigint) => { const s: any = await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getAccountState", args: [REC], blockNumber: b } as any); return s.unlockedCollateralBalance + s.lockedCollateral; };
const blocks = [...exp.keys()].sort((a, b) => (a < b ? -1 : 1));
const diffs: any[] = []; let prevAfter: bigint | null = null; let prevB = 0n; const gaps: any[] = [];
let sumExp = 0n, sumAct = 0n;
for (const b of blocks) {
  const before = await bal(b - 1n), after = await bal(b);
  if (prevAfter !== null && before !== prevAfter) gaps.push({ between: [prevB.toString(), b.toString()], moved: f(before - prevAfter) });
  const act = after - before, e = exp.get(b)!;
  sumExp += e; sumAct += act;
  if (act !== e) diffs.push({ block: b.toString(), actual: f(act), expected: f(e), extra: f(act - e) });
  prevAfter = after; prevB = b;
}
const out = { recipient: REC, feeBlocks: blocks.length, sumExpected: f(sumExp), sumActual: f(sumAct), blocksWhereDeltaDiffers: diffs.length, diffs: diffs.slice(0, 60), balanceMovedBetweenFeeBlocks: gaps.slice(0, 60), gapsCount: gaps.length, now: f(await bal(await pc.getBlockNumber())) };
console.log(j({ ...out, diffs: out.diffs.slice(0, 20), balanceMovedBetweenFeeBlocks: out.balanceMovedBetweenFeeBlocks.slice(0, 20) }));
writeFileSync(`evidence/probe34-recipient-by-block-${Date.now()}.json`, j(out));
process.exit(0);
