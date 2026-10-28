// Probe 15: who funds the keeper reward? Match every indexed LiquidationEvent (KeeperReward rows,
// AccountLiquidated rows) with LiquidationFee rows by tx. Read-only, indexer only.
import { writeFileSync } from "node:fs";
import { j, INDEXER } from "./client.mts";

const gql = async (query: string) => {
  const r = await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const b: any = await r.json();
  if (b.errors) throw new Error(JSON.stringify(b.errors));
  return b.data;
};
const all = async (entity: string, where: string, fields: string) => {
  const rows: any[] = [];
  for (let off = 0; ; off += 1000) {
    const d = await gql(`{ ${entity}(where:${where}, limit:1000, offset:${off}, order_by:{id:asc}) { ${fields} } }`);
    rows.push(...d[entity]);
    if (d[entity].length < 1000) break;
  }
  return rows;
};

const ev = await all("LiquidationEvent", "{}", "id kind account txHash keeperReward stageReached timestamp");
const fees = await all("PerpFeeRecord", '{kind:{_eq:"LiquidationFee"}}', "txHash amount");
const kinds: Record<string, number> = {};
ev.forEach((r) => (kinds[r.kind] = (kinds[r.kind] ?? 0) + 1));
console.log("LiquidationEvent kinds", kinds, "| LiquidationFee rows", fees.length);

const feeByTx = new Map<string, bigint>();
fees.forEach((f) => feeByTx.set(f.txHash, (feeByTx.get(f.txHash) ?? 0n) + BigInt(f.amount)));
const kr = ev.filter((r) => r.kind === "KeeperReward");
const withAmount = kr.filter((r) => r.keeperReward != null);
const krTx = new Set(kr.map((r) => r.txHash));
const noFee = kr.filter((r) => !feeByTx.has(r.txHash));
const rewardTotal = withAmount.reduce((t, r) => t + BigInt(r.keeperReward), 0n);
console.log(`KeeperReward rows ${kr.length} (with amount ${withAmount.length}, total ${Number(rewardTotal) / 1e18} USDso); in txs with no LiquidationFee: ${noFee.length}`);
const liqTx = new Set(ev.filter((r) => r.kind === "AccountLiquidated").map((r) => r.txHash));
console.log(`AccountLiquidated txs ${liqTx.size}; of those with a keeper reward ${[...liqTx].filter((t) => krTx.has(t)).length}; with a fee ${[...liqTx].filter((t) => feeByTx.has(t)).length}`);
writeFileSync(`evidence/probe15-keeper-reward-${Date.now()}.json`, j({ at: new Date().toISOString(), kinds, keeperRewardRows: kr.length, withAmount: withAmount.length, rewardTotal, noFeeSamples: noFee.slice(0, 20), feeTxs: feeByTx.size }));
process.exit(0);
