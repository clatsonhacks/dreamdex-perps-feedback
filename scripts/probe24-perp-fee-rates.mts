// Probe 24: which PerpFeeRecord kinds exist, and do perp pools charge trading fees at all?
import { createPublicClient, http } from "viem";
import { chain, RPC, INDEXER, client, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
console.log("kinds", j((await q(`{ PerpFeeRecord(distinct_on: kind, order_by:{kind:asc}) { kind } }`)).data));
const mk = (await client.listPerpMarkets()) as any[];
const pp = (R as any).perpPoolReadAbi ?? Object.values(R).find((a: any) => Array.isArray(a) && a.some((x: any) => x.name === "getPerpPoolParameters"));
for (const m of mk) {
  const p: any = await pc.readContract({ address: m.poolAddress, abi: pp, functionName: "getPerpPoolParameters" });
  console.log(`${m.baseSymbol.padEnd(6)} taker ${p.takerFeeBpsTimes1k} maker ${p.makerFeeBpsTimes1k} (bps×1000)`);
}
process.exit(0);
