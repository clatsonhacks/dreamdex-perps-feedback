// Probe 23: trading-fee rows (kind Fee / Rebate / BuilderFee) — totals and insurancePortion, via the indexer's aggregate.
import { INDEXER, j } from "./client.mts";
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
for (const k of ["Fee", "Rebate", "BuilderFee", "LiquidationFee"]) {
  const r = await q(`{ PerpFeeRecord_aggregate(where:{kind:{_eq:"${k}"}}) { aggregate { count sum { amount insurancePortion } min { timestamp } max { timestamp } } } }`);
  console.log(k, j(r.data?.PerpFeeRecord_aggregate ?? r.errors));
}
const s = await q(`{ PerpFeeRecord(where:{kind:{_eq:"Fee"}}, order_by:{timestamp:desc}, limit:3) { amount insurancePortion tier pool timestamp txHash } }`);
console.log("sample Fee rows", j(s.data ?? s.errors));
process.exit(0);
