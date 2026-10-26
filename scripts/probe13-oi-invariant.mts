// Probe 13: per market, at ONE pinned block: pool openInterest vs Σ long sizes vs Σ |short sizes|.
// Holders from MarginBank.getSideHoldersPaginated, positions from getPosition via multicall3.
// Light reads only (no health walks). Read-only.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, formatUnits } from "viem";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { client, j, RPC } from "./client.mts";

const pc = createPublicClient({ chain: hidekiTestnet as any, transport: http(RPC), batch: { multicall: { batchSize: 1024 * 4 } } });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const only = process.argv[2]?.split(",");

const markets = ((await client.listPerpMarkets()) as any[]).filter((m) => !only || only.includes(m.baseSymbol));
const out: any = { at: new Date().toISOString(), rows: [] };
for (const m of markets) {
  const block = await pc.getBlockNumber();
  const sideSum = async (isLong: boolean) => {
    const holders: string[] = [];
    for (let start = 0n; ; start += 1000n) {
      const page = (await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getSideHoldersPaginated", args: [m.poolAddress, isLong, start, 1000n], blockNumber: block })) as string[];
      holders.push(...page);
      if (page.length < 1000) break;
    }
    const res = await pc.multicall({
      contracts: holders.map((a) => ({ address: BANK, abi: R.marginBankReadAbi, functionName: "getPosition", args: [a, m.poolAddress] })),
      blockNumber: block, allowFailure: true,
    });
    let sum = 0n, wrongSign = 0, flat = 0, failed = 0;
    const odd: any[] = [];
    res.forEach((r: any, i: number) => {
      if (r.status !== "success") { failed++; return; }
      const s = BigInt(r.result.size);
      if (s === 0n) { flat++; odd.push({ account: holders[i], size: "0" }); return; }
      if (isLong ? s < 0n : s > 0n) { wrongSign++; odd.push({ account: holders[i], size: s.toString() }); }
      sum += s < 0n ? -s : s;
    });
    return { holders: holders.length, sum, wrongSign, flat, failed, odd: odd.slice(0, 10) };
  };
  const [L, S] = [await sideSum(true), await sideSum(false)];
  const oi = (await pc.readContract({ address: m.poolAddress, abi: R.perpPoolReadAbi, functionName: "getOpenInterest", blockNumber: block }).catch(async () => {
    const st: any = await client.getPerpFeedStatus(m.poolAddress); return BigInt(st.openInterest);
  })) as bigint;
  const d = m.baseDecimals;
  const row = {
    market: `${m.baseSymbol}-PERP`, block, openInterest: formatUnits(oi, d), sumLong: formatUnits(L.sum, d), sumShort: formatUnits(S.sum, d),
    longMinusShort: formatUnits(L.sum - S.sum, d), oiMinusLong: formatUnits(oi - L.sum, d),
    holders: { long: L.holders, short: S.holders }, flatSlots: L.flat + S.flat, wrongSide: L.wrongSign + S.wrongSign, failed: L.failed + S.failed,
    odd: [...L.odd, ...S.odd],
    ok: L.sum === S.sum && oi === L.sum && L.flat + S.flat + L.wrongSign + S.wrongSign === 0,
  };
  out.rows.push(row);
  console.log(`${row.market.padEnd(14)} blk ${block} OI ${row.openInterest} | Σlong ${row.sumLong} | Σshort ${row.sumShort} | L-S ${row.longMinusShort} | OI-L ${row.oiMinusLong} | flat ${row.flatSlots} wrongSide ${row.wrongSide} failed ${row.failed} ${row.ok ? "" : "<<<"}`);
}
writeFileSync(`evidence/probe13-oi-invariant-${Date.now()}.json`, j(out));
process.exit(0);
