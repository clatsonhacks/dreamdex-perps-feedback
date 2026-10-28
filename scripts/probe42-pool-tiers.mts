// Probe 42: pool -> Insurance Fund tier consistency: MarginBank.getPoolTier(pool) now, the fund's per-tier pool counts,
// the indexer's InsuranceFundPoolTier parameter changes, and the tier each LiquidationFee row was tagged with.
import { createPublicClient, http } from "viem";
import { chain, RPC, INDEXER, client, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const, IF = "0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80";
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
const mk = (await client.listPerpMarkets()) as any[];
const tierNow: Record<string, number> = {};
for (const m of mk) tierNow[m.poolAddress.toLowerCase()] = Number(await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getPoolTier", args: [m.poolAddress] }));
const st = await client.getInsuranceFundState(IF);
const countByTier: Record<string, number> = {}; for (const t of Object.values(tierNow)) countByTier[t] = (countByTier[t] ?? 0) + 1;
const ch = await q(`{ __type(name:"PerpParameterChange"){ fields { name } } }`);
const fields = ch.data.__type.fields.map((x: any) => x.name).join(" ");
const changes = (await q(`{ PerpParameterChange(where:{kind:{_eq:"InsuranceFundPoolTier"}}, order_by:{blockNumber:asc}) { ${fields} } }`)).data.PerpParameterChange;
const fees: any[] = []; for (let o = 0; ; o += 1000) { const p = (await q(`{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFee"}}, order_by:{id:asc}, limit:1000, offset:${o}) { pool tier blockNumber } }`)).data.PerpFeeRecord; fees.push(...p); if (p.length < 1000) break; }
const pairs: Record<string, number> = {}; for (const f of fees) pairs[`${f.pool}|${f.tier}`] = (pairs[`${f.pool}|${f.tier}`] ?? 0) + 1;
const mismatch = Object.entries(pairs).filter(([k]) => { const [p, t] = k.split("|"); return tierNow[p] !== Number(t); });
console.log(j({ marketCount: mk.length, countByTierFromBank: countByTier, fundPoolCounts: st.tiers.map((t: any) => ({ tier: t.tier, pools: t.poolCount })), tierChanges: changes.length, sampleChange: changes[0], feePoolTierPairsNotMatchingCurrentTier: mismatch.slice(0, 20), symbols: mk.map((m) => `${m.baseSymbol}:${tierNow[m.poolAddress.toLowerCase()]}`).join(" ") }));
process.exit(0);
