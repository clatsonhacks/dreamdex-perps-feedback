// Probe 39: client.getFills(pool, { sinceBlock, toBlock, limit, offset }) paged over a FIXED past block window,
// vs the same rows from the indexer ordered by id. The Fills query orders by [timestamp desc, blockNumber desc] —
// not unique when one block holds several fills (a liquidation fills several makers in one tx).
import { writeFileSync } from "node:fs";
import { client, INDEXER, j } from "./client.mts";
const pool = (process.argv[2] ?? "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0").toLowerCase();
const from = Number(process.argv[3] ?? 24300000), to = Number(process.argv[4] ?? 24500000);
const raw: any[] = [];
for (let o = 0; ; o += 1000) { const r = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ Fill(where:{pool:{_eq:"${pool}"}, blockNumber:{_gte:"${from}", _lte:"${to}"}}, order_by:{id:asc}, limit:1000, offset:${o}) { id blockNumber timestamp quantity } }` }) })).json()) as any; if (r.errors) { console.log(j(r.errors)); process.exit(2); } raw.push(...r.data.Fill); if (r.data.Fill.length < 1000) break; }
const perBlock = Object.values(raw.reduce((m: any, r) => ((m[r.blockNumber] = (m[r.blockNumber] ?? 0) + 1), m), {})) as number[];
const runs: any[] = [];
for (const size of [50, 100, 250, 500]) {
  const got: any[] = [];
  for (let offset = 0; ; offset += size) { const p = (await client.getFills(pool, { sinceBlock: from, toBlock: to, limit: size, offset })) as any[]; got.push(...p); if (p.length < size) break; }
  const seen: Record<string, number> = {}; for (const r of got) seen[r.id] = (seen[r.id] ?? 0) + 1;
  const missing = raw.filter((r) => !seen[r.id]);
  runs.push({ pageSize: size, returned: got.length, unique: Object.keys(seen).length, duplicated: Object.values(seen).filter((n) => n > 1).length, missing: missing.length, missingSample: missing.slice(0, 3) });
  console.log(j(runs.at(-1)));
}
const out = { pool, window: [from, to], indexerRows: raw.length, blocksWithMoreThanOneFill: perBlock.filter((n) => n > 1).length, runs };
console.log(j({ indexerRows: raw.length, blocksWithMoreThanOneFill: out.blocksWithMoreThanOneFill }));
writeFileSync(`evidence/probe39-getfills-paging-${Date.now()}.json`, j(out));
process.exit(0);
