// Probe 31: D(b) = LiquidationFeeRecipient bank balance at block b − Σ(indexed liquidation fees − keeper rewards) with timestamp ≤ ts(b).
// Sampled across the recipient's life, then bisected down to the single blocks where D jumps.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, formatUnits } from "viem";
import { chain, RPC, INDEXER, client, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const, REC = "0x95f23a563ecee5c6f841d762943d2f2fec742253" as const;
const START = 17162830n;
const f = (v: bigint) => formatUnits(v, 18);
const fees: any[] = [];
for (let o = 0; ; o += 500) { const p = await client.listPerpFees({ kind: "LiquidationFee", limit: 500, offset: o }); fees.push(...p); if (p.length < 500) break; }
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
const kr: any[] = [];
for (let o = 0; ; o += 1000) { const p = (await q(`{ LiquidationEvent(where:{kind:{_eq:"KeeperReward"}}, limit:1000, offset:${o}, order_by:{id:asc}) { txHash timestamp keeperReward } }`)).data.LiquidationEvent; kr.push(...p); if (p.length < 1000) break; }
const feeTx = new Set(fees.map((r) => r.txHash));
const flows = [...fees.map((r) => ({ ts: BigInt(r.timestamp), v: BigInt(r.amount), tx: r.txHash })), ...kr.filter((r) => feeTx.has(r.txHash)).map((r) => ({ ts: BigInt(r.timestamp), v: -BigInt(r.keeperReward ?? 0), tx: r.txHash }))].sort((a, b) => (a.ts < b.ts ? -1 : 1));
const tsCache = new Map<bigint, bigint>();
const ts = async (b: bigint) => { if (!tsCache.has(b)) tsCache.set(b, (await pc.getBlock({ blockNumber: b })).timestamp); return tsCache.get(b)!; };
const bal = async (b: bigint) => { const s: any = await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getAccountState", args: [REC], blockNumber: b } as any); return s.unlockedCollateralBalance + s.lockedCollateral; };
const exp = (t: bigint, setTs: bigint) => flows.filter((x) => x.ts <= t && x.ts >= setTs).reduce((a, x) => a + x.v, 0n);
const setTs = await ts(START);
const D = async (b: bigint) => (await bal(b)) - exp(await ts(b), setTs);
const head = await pc.getBlockNumber();
const pts: { b: bigint; d: bigint }[] = [];
for (let i = 0n; i <= 24n; i++) { const b = START + ((head - START) * i) / 24n; pts.push({ b, d: await D(b) }); }
console.log("samples", pts.map((p) => `${p.b}:${f(p.d)}`).join("  "));
const jumps: any[] = [];
const bis = async (lo: bigint, dlo: bigint, hi: bigint, dhi: bigint, depth = 0): Promise<void> => {
  if (dlo === dhi || jumps.length > 40) return;
  if (hi - lo <= 1n) { jumps.push({ block: hi, jump: f(dhi - dlo), ts: (await ts(hi)).toString() }); return; }
  const mid = (lo + hi) / 2n; const dm = await D(mid);
  await bis(lo, dlo, mid, dm, depth + 1); await bis(mid, dm, hi, dhi, depth + 1);
};
for (let i = 1; i < pts.length; i++) await bis(pts[i - 1].b, pts[i - 1].d, pts[i].b, pts[i].d);
console.log("jumps", j(jumps));
writeFileSync(`evidence/probe31-recipient-drift-${Date.now()}.json`, j({ samples: pts, jumps }));
process.exit(0);
