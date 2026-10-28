// Probe 37: does client.listPerpFees() offset paging return every row exactly once?
// The SDK's PerpFees query orders by {timestamp: desc} only (no tiebreaker), and many liquidation fees share a timestamp.
// Pages through it with the SDK, then fetches the same set from the indexer ordered by id, and diffs.
import { writeFileSync } from "node:fs";
import { formatUnits } from "viem";
import { client, INDEXER, j } from "./client.mts";
const kind = process.argv[2] ?? "LiquidationFee", size = Number(process.argv[3] ?? 500);
const sdk: any[] = [];
for (let o = 0; ; o += size) { const p = (await client.listPerpFees({ kind, limit: size, offset: o })) as any[]; sdk.push(...p); if (p.length < size) break; }
const raw: any[] = [];
for (let o = 0; ; o += 1000) { const r = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpFeeRecord(where:{kind:{_eq:"${kind}"}}, order_by:{id:asc}, limit:1000, offset:${o}) { id amount timestamp } }` }) })).json()) as any; const p = r.data.PerpFeeRecord; raw.push(...p); if (p.length < 1000) break; }
const count: Record<string, number> = {};
for (const r of sdk) count[r.id] = (count[r.id] ?? 0) + 1;
const dup = Object.entries(count).filter(([, n]) => n > 1).map(([id, n]) => ({ id, n }));
const rawIds = new Set(raw.map((r) => r.id));
const missing = raw.filter((r) => !count[r.id]);
const extra = sdk.filter((r) => !rawIds.has(r.id));
const sum = (a: any[]) => a.reduce((t, r) => t + BigInt(r.amount), 0n);
const tsShared = Object.values(raw.reduce((m: any, r) => ((m[r.timestamp] = (m[r.timestamp] ?? 0) + 1), m), {})).filter((n: any) => n > 1).length;
const out = { kind, pageSize: size, sdkRowsReturned: sdk.length, sdkUniqueIds: Object.keys(count).length, indexerRows: raw.length, duplicatedIds: dup.length, missingIds: missing.length, extraIds: extra.length, sdkSum: formatUnits(sum(sdk), 18), indexerSum: formatUnits(sum(raw), 18), sdkSumMinusTrue: formatUnits(sum(sdk) - sum(raw), 18), timestampsSharedByMoreThanOneRow: tsShared, missing: missing.slice(0, 20), duplicated: dup.slice(0, 20) };
console.log(j(out));
writeFileSync(`evidence/probe37-listperpfees-paging-${kind}-${size}-${Date.now()}.json`, j(out));
process.exit(0);
