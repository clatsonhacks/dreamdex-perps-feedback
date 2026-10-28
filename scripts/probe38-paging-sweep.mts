// Probe 38: listPerpFees({kind:"LiquidationFee"}) paged at several page sizes: rows returned, unique, missing, and the SUM(amount) error.
import { writeFileSync } from "node:fs";
import { formatUnits } from "viem";
import { client, INDEXER, j } from "./client.mts";
const raw: any[] = [];
for (let o = 0; ; o += 1000) { const r = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFee"}}, order_by:{id:asc}, limit:1000, offset:${o}) { id amount } }` }) })).json()) as any; raw.push(...r.data.PerpFeeRecord); if (r.data.PerpFeeRecord.length < 1000) break; }
const truth = raw.reduce((t, r) => t + BigInt(r.amount), 0n);
const rows: any[] = [];
for (const size of [50, 100, 200, 250, 300, 400, 500, 500, 700, 1000]) {
  const got: any[] = [];
  for (let o = 0; ; o += size) { const p = (await client.listPerpFees({ kind: "LiquidationFee", limit: size, offset: o })) as any[]; got.push(...p); if (p.length < size) break; }
  const ids = new Set(got.map((r) => r.id));
  const row = { pageSize: size, returned: got.length, unique: ids.size, missing: raw.filter((r) => !ids.has(r.id)).length, sumErrorUSDso: formatUnits(got.reduce((t, r) => t + BigInt(r.amount), 0n) - truth, 18) };
  rows.push(row); console.log(j(row));
}
writeFileSync(`evidence/probe38-paging-sweep-${Date.now()}.json`, j({ indexerRows: raw.length, trueSum: formatUnits(truth, 18), runs: rows }));
process.exit(0);
