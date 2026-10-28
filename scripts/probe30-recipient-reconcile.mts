// Probe 30: reconcile the LiquidationFeeRecipient's MarginBank balance with (liquidation fees − keeper rewards)
// for every fee charged after the recipient was set (2026-10-07, ts 1791366870), using indexer rows.
import { formatUnits } from "viem";
import { client, INDEXER, j } from "./client.mts";
const SET_TS = 1791366870n;
const f = (v: bigint) => formatUnits(v, 18);
const fees: any[] = [];
for (let o = 0; ; o += 500) { const p = await client.listPerpFees({ kind: "LiquidationFee", limit: 500, offset: o }); fees.push(...p); if (p.length < 500) break; }
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
const kr: any[] = [];
for (let o = 0; ; o += 1000) { const r = await q(`{ LiquidationEvent(where:{kind:{_eq:"KeeperReward"}}, limit:1000, offset:${o}, order_by:{id:asc}) { id txHash timestamp keeperReward } }`); const p = r.data?.LiquidationEvent ?? []; if (r.errors) { console.log(j(r.errors)); break; } kr.push(...p); if (p.length < 1000) break; }
const rewardByTx: Record<string, bigint> = {};
for (const r of kr) rewardByTx[r.txHash] = (rewardByTx[r.txHash] ?? 0n) + BigInt(r.keeperReward ?? 0);
let before = 0n, after = 0n, afterRewards = 0n, nb = 0, na = 0;
for (const r of fees) { const a = BigInt(r.amount); if (BigInt(r.timestamp) < SET_TS) { before += a; nb++; } else { after += a; na++; } }
const seen = new Set<string>(); for (const r of fees) if (BigInt(r.timestamp) >= SET_TS && !seen.has(r.txHash)) { seen.add(r.txHash); afterRewards += rewardByTx[r.txHash] ?? 0n; }
console.log(j({ feeRows: fees.length, beforeRecipientSet: { rows: nb, fees: f(before) }, afterRecipientSet: { rows: na, fees: f(after), keeperRewardsInThoseTxs: f(afterRewards), feesMinusRewards: f(after - afterRewards) }, keeperRewardRows: kr.length }));
process.exit(0);
