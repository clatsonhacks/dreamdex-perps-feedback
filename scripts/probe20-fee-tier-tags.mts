// Probe 20: how LiquidationFee rows are tagged by tier (indexer PerpFeeRecord via the SDK), oldest vs newest.
import { client, j } from "./client.mts";
const rows: any[] = [];
for (let off = 0; ; off += 500) { const p = await client.listPerpFees({ kind: "LiquidationFee", limit: 500, offset: off }); rows.push(...p); if (p.length < 500) break; }
console.log("rows", rows.length, "keys", Object.keys(rows[0]));
console.log("newest", j(rows[0])); console.log("oldest", j(rows.at(-1)));
const by: Record<string, number> = {};
for (const r of rows) { const k = `tier=${JSON.stringify(r.tier)} ip=${r.insurancePortion == null ? "null" : r.insurancePortion === r.amount ? "=amount" : "other"}`; by[k] = (by[k] ?? 0) + 1; }
console.log(j(by)); process.exit(0);
