// Probe 32: for given blocks, every tx that touches the MarginBank / LiquidationEngine: decoded event names, and fee-related args.
import { createPublicClient, http, decodeEventLog, formatUnits } from "viem";
import { chain, RPC, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const all = Object.values(ev).filter(Array.isArray).flat() as any[];
for (const bn of process.argv.slice(2).map(BigInt)) {
  const blk = await pc.getBlock({ blockNumber: bn, includeTransactions: true });
  for (const t of blk.transactions as any[]) {
    const rc = await pc.getTransactionReceipt({ hash: t.hash });
    const names: string[] = []; const fee: any[] = [];
    for (const l of rc.logs) { try { const d: any = decodeEventLog({ abi: all, data: l.data, topics: l.topics as any }); names.push(d.eventName); if (/Fee|Keeper|Liquidat|Penalty/.test(d.eventName)) fee.push({ ev: d.eventName, ...Object.fromEntries(Object.entries(d.args).map(([k, v]) => [k, typeof v === "bigint" && v > 10n ** 12n ? formatUnits(v, 18) : v])) }); } catch { names.push(l.topics[0]!.slice(0, 10)); } }
    if (!names.some((n) => /Liquidat|Fee|Adl|CloseOut|Takeover|TakenOver/.test(n))) continue;
    console.log(bn, t.hash, rc.status, "to", t.to, "\n  ", names.join(","), "\n  ", j(fee));
  }
}
process.exit(0);
