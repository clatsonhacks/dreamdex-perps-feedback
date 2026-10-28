// Probe 43: documented max-leverage tiers vs the chain: per market, the pool's initial-margin fraction (getPerpRiskParams /
// pool parameters), the implied max leverage, and the bank's protocol leverage limit.
import { createPublicClient, http } from "viem";
import { chain, RPC, client, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const DOC: Record<string, number> = { BTC: 20, ETH: 20, HYPE: 20, SOL: 20, XRP: 20, ADA: 10, AVAX: 10, BNB: 10, DOGE: 10, LINK: 10, NEAR: 10, SUI: 10, XLM: 10, "1000PEPE": 5, LIT: 5, PUMP: 5, TAO: 5, VVV: 5, WLD: 5, ZEC: 5, ZRO: 5 };
const pp = Object.values(R).find((a: any) => Array.isArray(a) && a.some((x: any) => x.name === "getPerpPoolParameters")) as any;
const mk = (await client.listPerpMarkets()) as any[];
console.log("bank getMaxLeverageLimit", await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getMaxLeverageLimit" }));
const rows: any[] = [];
for (const m of mk) {
  const p: any = await pc.readContract({ address: m.poolAddress, abi: pp, functionName: "getPerpPoolParameters" });
  const imf = Number(p.initialMarginFractionBps ?? p.imfBps ?? p.initialMarginBps ?? 0), mmf = Number(p.maintenanceMarginFractionBps ?? p.mmfBps ?? 0);
  rows.push({ m: m.baseSymbol, doc: DOC[m.baseSymbol], imfBps: imf, impliedMaxX: imf ? 10000 / imf : null, mmfBps: mmf, indexerInitialMarginBps: m.initialMarginBps });
}
for (const r of rows) console.log(`${r.m.padEnd(9)} docs ${String(r.doc).padStart(2)}x | IMF ${r.imfBps} bps -> ${r.impliedMaxX}x | MMF ${r.mmfBps} | indexer IM ${r.indexerInitialMarginBps}${r.impliedMaxX !== r.doc ? "   <-- differs" : ""}`);
const p0: any = await pc.readContract({ address: mk[0].poolAddress, abi: pp, functionName: "getPerpPoolParameters" });
console.log("param keys", Object.keys(p0).join(" "));
process.exit(0);
