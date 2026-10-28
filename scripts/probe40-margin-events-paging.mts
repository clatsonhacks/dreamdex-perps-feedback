// Probe 40: client.getMarginEvents(account, {limit, offset}) orders by {timestamp: desc} only. For an account whose
// history is frozen (no activity since), page it at several sizes and diff against the indexer ordered by id.
import { writeFileSync } from "node:fs";
import { client, INDEXER, j } from "./client.mts";
const acct = (process.argv[2] ?? "0x14c8a8e2adfe82d7374d24900ee1dcada6e37562").toLowerCase();
const raw: any[] = [];
for (let o = 0; ; o += 1000) { const r = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ MarginEvent(where:{account:{_eq:"${acct}"}}, order_by:{id:asc}, limit:1000, offset:${o}) { id kind amount timestamp } }` }) })).json()) as any; raw.push(...r.data.MarginEvent); if (r.data.MarginEvent.length < 1000) break; }
const tied = Object.values(raw.reduce((m: any, r) => ((m[r.timestamp] = (m[r.timestamp] ?? 0) + 1), m), {})).filter((n: any) => n > 1).length;
const runs: any[] = [];
for (const size of [10, 20, 25, 50, 100]) {
  const got: any[] = [];
  for (let offset = 0; ; offset += size) { const p = (await client.getMarginEvents(acct, { limit: size, offset })) as any[]; got.push(...p); if (p.length < size) break; }
  const seen: Record<string, number> = {}; for (const r of got) seen[r.id] = (seen[r.id] ?? 0) + 1;
  const missing = raw.filter((r) => !seen[r.id]);
  runs.push({ pageSize: size, returned: got.length, unique: Object.keys(seen).length, duplicated: Object.values(seen).filter((n) => n > 1).length, missing: missing.length, missingRows: missing.map((r) => ({ id: r.id, kind: r.kind, amount: r.amount, ts: r.timestamp })) });
  console.log(`page ${size}: returned ${got.length} (true ${raw.length}), unique ${Object.keys(seen).length}, missing ${missing.length}`, missing.slice(0, 3).map((r) => `${r.kind} ${r.id}`).join("; "));
}
console.log("events", raw.length, "timestamps shared by >1 event", tied, "kinds", j(raw.reduce((m: any, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {})));
writeFileSync(`evidence/probe40-margin-events-paging-${Date.now()}.json`, j({ acct, events: raw.length, tied, runs }));
process.exit(0);
