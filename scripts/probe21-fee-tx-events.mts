// Probe 21: decode every log of one liquidation-fee tx with the SDK's event ABIs, and read the
// MarginBank state of every address those events name, at block-1 and block. Shows where the fee lands.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, formatUnits, decodeEventLog, isAddress } from "viem";
import { chain, j, RPC } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const IF = "0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80";
const tx = process.argv[2] as `0x${string}`;
const rc = await pc.getTransactionReceipt({ hash: tx });
const b = rc.blockNumber;
const all = Object.values(ev).filter(Array.isArray).flat() as any[];
const f = (v: bigint) => formatUnits(v, 18);
const logs = rc.logs.map((l) => { try { const d: any = decodeEventLog({ abi: all, data: l.data, topics: l.topics as any }); return { i: l.logIndex, at: l.address, ev: d.eventName, args: d.args }; } catch { return { i: l.logIndex, at: l.address, ev: "?", topic0: l.topics[0] }; } });
const addrs = new Set<string>([IF, BANK, rc.from]);
for (const l of logs) { addrs.add(l.at); for (const v of Object.values((l as any).args ?? {})) if (typeof v === "string" && isAddress(v)) addrs.add(v); }
const tot = async (w: string, bn: bigint) => { const s: any = await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getAccountState", args: [w], blockNumber: bn }); return s.unlockedCollateralBalance + s.lockedCollateral; };
const deltas: any = {};
for (const a of addrs) { const d = (await tot(a, b)) - (await tot(a, b - 1n)); if (d !== 0n) deltas[a] = f(d); }
const out = { tx, block: b, logs: logs.map((l: any) => ({ i: l.i, ev: l.ev, at: l.at, args: l.args })), nonZeroBankDeltas: deltas, checkedAddresses: [...addrs] };
console.log(j({ events: logs.map((l: any) => `${l.i} ${l.ev}`), nonZeroBankDeltas: deltas, fee: logs.find((l: any) => l.ev === "LiquidationFeeCharged")?.args }));
writeFileSync(`evidence/probe21-fee-tx-${Date.now()}.json`, j(out));
process.exit(0);
