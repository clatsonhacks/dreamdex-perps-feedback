// Probe 25: the on-chain event behind indexer PerpFeeRecord kind "LiquidationFeeSkipped".
// Lists every LiquidationEngine log in one such tx, decoded with the SDK ABIs where possible.
import { createPublicClient, http, decodeEventLog } from "viem";
import { chain, RPC, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const all = Object.values(ev).filter(Array.isArray).flat() as any[];
const tx = (process.argv[2] ?? "0xed01fb0d38daaf468e117685e1bca265d201d96ac6588ea67372fd53aa08c3ad") as `0x${string}`;
const rc = await pc.getTransactionReceipt({ hash: tx });
for (const l of rc.logs) {
  let d: any; try { d = decodeEventLog({ abi: all, data: l.data, topics: l.topics as any }); } catch {}
  console.log(l.logIndex, l.address, d ? `${d.eventName} ${j(d.args)}` : `UNDECODED topics=${l.topics.join(",")} data=${l.data}`);
}
process.exit(0);
