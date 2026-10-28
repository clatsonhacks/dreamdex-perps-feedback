// Repro 007: client.listPerpFees() orders only by {timestamp: desc}. Many fee rows share a timestamp (one
// liquidation keeper batch per block, several per second), so offset paging is not a stable total order:
// across page boundaries rows are returned twice and others never. The row COUNT still looks right, so
// nothing warns the caller, and SUM(amount), the fee total the SDK docs tell you to compute, comes out wrong.
// Truth = the same rows fetched from the indexer ordered by id (unique).
// Read-only. Exits 1 if any page size returns a duplicate or misses a row.
//
// Run: npx tsx scripts/repro-007-listperpfees-unstable-paging.mts [kind]
import { writeFileSync, mkdirSync } from "node:fs";
import { formatUnits } from "viem";
import { client, INDEXER, j } from "./client.mts";

const kind = process.argv[2] ?? "LiquidationFee";
const raw: any[] = [];
for (let o = 0; ; o += 1000) {
  const r = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpFeeRecord(where:{kind:{_eq:"${kind}"}}, order_by:{id:asc}, limit:1000, offset:${o}) { id amount timestamp } }` }) })).json()) as any;
  raw.push(...r.data.PerpFeeRecord);
  if (r.data.PerpFeeRecord.length < 1000) break;
}
const truth = raw.reduce((t, r) => t + BigInt(r.amount), 0n);
const sharedTs = Object.values(raw.reduce((m: Record<string, number>, r) => ((m[r.timestamp] = (m[r.timestamp] ?? 0) + 1), m), {})).filter((n) => n > 1).length;

const runs: any[] = [];
for (const size of [50, 100, 250, 500, 1000]) {
  const got: any[] = [];
  for (let offset = 0; ; offset += size) {
    const page = (await client.listPerpFees({ kind, limit: size, offset })) as any[];
    got.push(...page);
    if (page.length < size) break;
  }
  const seen: Record<string, number> = {};
  for (const r of got) seen[r.id] = (seen[r.id] ?? 0) + 1;
  const missing = raw.filter((r) => !seen[r.id]);
  const duplicated = Object.entries(seen).filter(([, n]) => n > 1).map(([id]) => id);
  runs.push({
    pageSize: size, rowsReturned: got.length, uniqueRows: Object.keys(seen).length, duplicated: duplicated.length, missing: missing.length,
    sdkSumAmount: formatUnits(got.reduce((t, r) => t + BigInt(r.amount), 0n), 18),
    errorUSDso: formatUnits(got.reduce((t, r) => t + BigInt(r.amount), 0n) - truth, 18),
    missingRows: missing.map((r) => ({ id: r.id, amount: formatUnits(BigInt(r.amount), 18), timestamp: r.timestamp })),
    duplicatedRows: duplicated,
  });
}
const out = { at: new Date().toISOString(), kind, indexerRows: raw.length, trueSumAmount: formatUnits(truth, 18), timestampsSharedByMoreThanOneRow: sharedTs, runs };
for (const r of runs) console.log(`pageSize ${String(r.pageSize).padStart(4)}: returned ${r.rowsReturned}, unique ${r.uniqueRows}, duplicated ${r.duplicated}, missing ${r.missing}, SUM(amount) error ${r.errorUSDso} USDso`);
console.log(j({ trueRows: raw.length, trueSumAmount: out.trueSumAmount, timestampsSharedByMoreThanOneRow: sharedTs, exampleMissing: runs.find((r) => r.missing)?.missingRows ?? [] }));
mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/007-listperpfees-paging-${Date.now()}.json`, j(out));
const bad = runs.filter((r) => r.duplicated || r.missing);
console.log(bad.length
  ? `FAIL: ${bad.length}/${runs.length} page sizes return duplicated and/or missing ${kind} rows while the row count still matches (${raw.length}); worst SUM(amount) error ${bad.map((r) => r.errorUSDso).sort((a, b) => Math.abs(Number(b)) - Math.abs(Number(a)))[0]} USDso`
  : "PASS");
process.exit(bad.length ? 1 : 0);
