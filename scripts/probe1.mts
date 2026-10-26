// Probe 1: markets, linked-wallet rail state, ADL queue regimes per market side.
import { writeFileSync, mkdirSync } from "node:fs";
import { client, j } from "./client.mts";

mkdirSync("evidence", { recursive: true });
const out: any = { at: new Date().toISOString() };
out.block = await client.publicClient?.getBlockNumber?.().catch(() => null);

const mkts = await client.listPerpMarkets();
out.marketCount = mkts.length;
out.markets = mkts.map((m: any) => ({
  symbol: m.symbol ?? m.baseSymbol, base: m.baseSymbol, pool: m.poolAddress ?? m.address, marginBank: m.marginBank,
  stopRegistry: m.stopRegistry, baseDecimals: m.baseDecimals,
}));
console.log("markets", mkts.length, Object.keys(mkts[0]).join(","));

const bank = out.markets[0].marginBank;
const safe = async (name: string, f: () => Promise<any>) => {
  try { const v = await f(); out[name] = v; console.log(name, j(v).slice(0, 600)); return v; }
  catch (e: any) { out[name] = { error: e?.name, message: String(e?.message).slice(0, 400) }; console.log(name, "ERR", e?.name, String(e?.message).slice(0, 300)); }
};
const registry = await safe("linkedWalletRegistry", () => client.getPerpLinkedWalletRegistry(bank));
if (registry && typeof registry === "string" && !/^0x0+$/.test(registry)) {
  await safe("maxLinkedChildren", () => client.getPerpMaxLinkedChildren(registry));
}
await safe("systemConfig", () => client.getPerpSystemConfig(bank));

out.adl = [];
for (const m of out.markets) {
  for (const isLong of [true, false]) {
    try {
      const s = await client.perpAdlQueue.getSnapshot({ marginBank: m.marginBank, pool: m.pool, isLong });
      const q = s.data.queue;
      const row: any = { base: m.base, isLong, regime: q.regime, block: s.data.blockNumber, holderCount: q.holderCount, scanCap: q.scanCap };
      if (q.regime === "ranked") {
        row.orderSource = q.orderSource; row.ranker = q.ranker; row.lwr = q.linkedWalletRegistry;
        const c: Record<string, number> = {};
        for (const h of q.holders) c[h.eligibility] = (c[h.eligibility] ?? 0) + 1;
        row.eligibility = c;
        row.holders = q.holders;
      }
      out.adl.push(row);
      console.log(m.base, isLong ? "L" : "S", q.regime, row.orderSource ?? "", j(row.eligibility ?? {}).replace(/\s/g, ""));
    } catch (e: any) {
      out.adl.push({ base: m.base, isLong, error: e?.name, message: String(e?.message).slice(0, 300) });
      console.log(m.base, isLong ? "L" : "S", "ERR", e?.name, String(e?.message).slice(0, 200));
    }
  }
}
writeFileSync(`evidence/probe1-${Date.now()}.json`, j(out));
process.exit(0);
