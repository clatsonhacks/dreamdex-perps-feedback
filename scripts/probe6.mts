// Probe 6: sample BTC-long holder slots (3 pages of 25) to see whether they are real positions.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, formatUnits } from "viem";
import { chain, j, RPC } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
const pool = process.argv[2] as `0x${string}`;
const bankAbi = (await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any)).marginBankReadAbi;
const block = await pc.getBlockNumber();
const out: any = { block, pool, pages: [] };
for (const start of [0n, 2800n, 5550n]) {
  const [states, listLength, , snap] = (await pc.readContract({ address: BANK, abi: bankAbi, functionName: "getSideHolderStatesPaginated", args: [pool, true, start, 25n], blockNumber: block })) as any;
  const rows = states.map((s: any) => ({ account: s.account, size: formatUnits(s.position.size, 8), entry: formatUnits(s.position.avgEntryPrice, 18), equity: formatUnits(s.equity, 18), priceable: s.priceable }));
  const flat = rows.filter((r: any) => Number(r.size) === 0).length;
  const inProfit = states.filter((s: any) => s.position.size > 0n && snap.markPrice > s.position.avgEntryPrice).length;
  console.log(`start ${start}: listLength ${listLength}, mark ${formatUnits(snap.markPrice, 18)}, flat ${flat}/25, inProfit ${inProfit}/25, sizes ${rows.slice(0, 6).map((r: any) => r.size).join(" ")}`);
  out.pages.push({ start, listLength, mark: snap.markPrice, rows });
  await new Promise((r) => setTimeout(r, 500));
}
writeFileSync(`evidence/probe6-btc-long-sample-${Date.now()}.json`, j(out));
process.exit(0);
