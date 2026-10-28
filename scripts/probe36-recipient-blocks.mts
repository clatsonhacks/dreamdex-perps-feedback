// Probe 36: for given blocks: the recipient's bank delta vs every LiquidationFeeCharged / KeeperReward in that block (chain logs).
import { createPublicClient, http, formatUnits, decodeEventLog } from "viem";
import { chain, RPC, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const all = Object.values(ev).filter(Array.isArray).flat() as any[];
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const, REC = "0x95f23a563ecee5c6f841d762943d2f2fec742253" as const, LE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D";
const f = (v: bigint) => formatUnits(v, 18);
const bal = async (b: bigint) => { const s: any = await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getAccountState", args: [REC], blockNumber: b } as any); return s.unlockedCollateralBalance + s.lockedCollateral; };
for (const b of process.argv.slice(2).map(BigInt)) {
  const logs = await pc.getLogs({ address: LE as any, fromBlock: b, toBlock: b });
  let fee = 0n, rew = 0n; const items: string[] = [];
  for (const l of logs) { try { const d: any = decodeEventLog({ abi: all, data: l.data, topics: l.topics as any }); if (d.eventName === "LiquidationFeeCharged") { fee += d.args.amount; items.push(`fee ${f(d.args.amount)} tx ${l.transactionHash.slice(0, 10)}`); } if (d.eventName === "LiquidationKeeperRewardPaid") rew += d.args.amount; } catch {} }
  const delta = (await bal(b)) - (await bal(b - 1n));
  console.log(b, "recipient delta", f(delta), "| fees", f(fee), "rewards", f(rew), "| unexplained", f(delta - (fee - rew)), items.join("; "));
}
process.exit(0);
