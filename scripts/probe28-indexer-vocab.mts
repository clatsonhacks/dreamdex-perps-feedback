// Probe 28: every string "vocabulary" field in the indexer (kind / source / reason / status / side / type ...):
// the distinct values actually present, to diff against what the SDK documents.
import { writeFileSync } from "node:fs";
import { INDEXER, j } from "./client.mts";
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
const schema = await q(`{ __schema { queryType { fields { name } } types { name kind fields { name type { kind name ofType { kind name } } } } } }`);
const roots = new Set(schema.data.__schema.queryType.fields.map((x: any) => x.name));
const pat = /^(kind|source|reason|cancelReason|status|side|type|eventType|action|stage|direction|regime|outcome|category|mode|role|origin|cause|leg|trigger|orderType|timeInForce)$/i;
const out: Record<string, Record<string, string[]>> = {};
for (const t of schema.data.__schema.types) {
  if (t.kind !== "OBJECT" || !roots.has(t.name) || !t.fields) continue;
  for (const fl of t.fields) {
    const tn = fl.type.name ?? fl.type.ofType?.name;
    if (!pat.test(fl.name) || !["String", "String!"].includes(tn) && tn !== "String") continue;
    const r = await q(`{ ${t.name}(distinct_on: ${fl.name}, order_by: {${fl.name}: asc}, limit: 100) { ${fl.name} } }`);
    if (r.errors) continue;
    (out[t.name] ??= {})[fl.name] = r.data[t.name].map((x: any) => x[fl.name]);
  }
}
console.log(j(out));
writeFileSync(`evidence/probe28-indexer-vocab-${Date.now()}.json`, j(out));
process.exit(0);
