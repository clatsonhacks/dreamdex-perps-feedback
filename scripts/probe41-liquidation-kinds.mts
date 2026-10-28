// Probe 41: LiquidationEvent kinds the indexer writes vs the SDK's closed LIQUIDATION_KIND list; can the SDK filter on them?
import { client, INDEXER, j } from "./client.mts";
const H = await import("../node_modules/@somnia-chain/markets-sdk/dist/perp/history.js" as any);
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
const kinds: string[] = (await q(`{ LiquidationEvent(distinct_on: kind, order_by:{kind:asc}) { kind } }`)).data.LiquidationEvent.map((x: any) => x.kind);
const out: any = { sdkList: H.LIQUIDATION_KIND, unknownToSdk: [] };
for (const k of kinds.filter((k) => !H.isLiquidationKind(k))) {
  const rows = (await q(`{ LiquidationEvent(where:{kind:{_eq:"${k}"}}, order_by:{blockNumber:asc}) { id account pool blockNumber timestamp clampedBound marketBound price stageReached txHash } }`)).data.LiquidationEvent;
  let filter: any;
  try { const r = await client.listLiquidations({ kind: k as any, limit: 5 }); filter = { ok: true, rows: r.length }; } catch (e: any) { filter = { ok: false, error: `${e.name}: ${e.message?.slice(0, 160)}` }; }
  let unfiltered: any;
  try { const r = await client.listLiquidations({ limit: 1000 }); unfiltered = r.filter((x: any) => x.kind === k).length; } catch (e: any) { unfiltered = e.message?.slice(0, 120); }
  out.unknownToSdk.push({ kind: k, rows: rows.length, first: rows[0], last: rows.at(-1)?.timestamp, sdkFilterByKind: filter, inNewest1000ViaSdk: unfiltered });
}
console.log(j(out));
process.exit(0);
