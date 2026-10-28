// Repro 008: client.getFills(pool, { sinceBlock, toBlock, limit, offset }) and getUserFills page with `offset`
// over `order_by: [timestamp desc, blockNumber desc]`, which is not a total order: one block often holds several
// fills (a liquidation fills several makers in one tx). So offset paging over a FIXED block window returns some
// trades twice and never returns others, while the row count still matches.
// Truth = the same window from the indexer ordered by `id` (unique).
// Read-only, pinned to a past block window, so the true set cannot change between runs.
// Exits 1 if any page size loses a fill.
//
// Run: npx tsx scripts/repro-008-getfills-paging-loses-trades.mts [pool fromBlock toBlock]
import { writeFileSync, mkdirSync } from "node:fs";
import { formatUnits } from "viem";
import { client, INDEXER, j } from "./client.mts";

const pool = (process.argv[2] ?? "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0").toLowerCase(); // BTC-PERP
const from = Number(process.argv[3] ?? 24300000), to = Number(process.argv[4] ?? 24500000);     // 2026-10-15, a liquidation-heavy day

const raw: any[] = [];
for (let o = 0; ; o += 1000) {
  const r = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ Fill(where:{pool:{_eq:"${pool}"}, blockNumber:{_gte:"${from}", _lte:"${to}"}}, order_by:{id:asc}, limit:1000, offset:${o}) { id blockNumber quantity quoteQuantity } }` }) })).json()) as any;
  raw.push(...r.data.Fill);
  if (r.data.Fill.length < 1000) break;
}
const qq = (rows: any[]) => rows.reduce((t, r) => t + BigInt(r.quoteQuantity), 0n);
const trueVolume = qq(raw);
const runs: any[] = [];
for (const size of [50, 100, 500]) {
  const got: any[] = [];
  for (let offset = 0; ; offset += size) {
    const page = (await client.getFills(pool, { sinceBlock: from, toBlock: to, limit: size, offset })) as any[];
    got.push(...page);
    if (page.length < size) break;
  }
  const seen: Record<string, number> = {};
  for (const r of got) seen[r.id] = (seen[r.id] ?? 0) + 1;
  const missing = raw.filter((r) => !seen[r.id]);
  runs.push({
    pageSize: size, returned: got.length, unique: Object.keys(seen).length,
    duplicated: Object.values(seen).filter((n) => n > 1).length, missing: missing.length,
    quoteVolumeError: formatUnits(qq(got) - trueVolume, 18),
    missingSample: missing.slice(0, 5).map((r) => r.id),
  });
}
const out = { at: new Date().toISOString(), pool, window: { fromBlock: from, toBlock: to }, indexerFills: raw.length, trueQuoteVolume: formatUnits(trueVolume, 18), blocksWithMoreThanOneFill: Object.values(raw.reduce((m: any, r) => ((m[r.blockNumber] = (m[r.blockNumber] ?? 0) + 1), m), {})).filter((n: any) => n > 1).length, runs };
for (const r of runs) console.log(`pageSize ${String(r.pageSize).padStart(3)}: returned ${r.returned} (true ${raw.length}), unique ${r.unique}, duplicated ${r.duplicated}, missing ${r.missing}, quote-volume error ${r.quoteVolumeError} USDso, e.g. missing ${r.missingSample.slice(0, 3).join(", ")}`);
console.log(j({ indexerFills: raw.length, trueQuoteVolume: out.trueQuoteVolume, blocksWithMoreThanOneFill: out.blocksWithMoreThanOneFill }));
mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/008-getfills-paging-${Date.now()}.json`, j(out));
const bad = runs.filter((r) => r.missing || r.duplicated);
console.log(bad.length ? `FAIL: ${bad.length}/${runs.length} page sizes lose fills in a fixed block window (worst: ${Math.max(...bad.map((r) => r.missing))} of ${raw.length} missing, each replaced by a duplicate)` : "PASS");
process.exit(bad.length ? 1 : 0);
