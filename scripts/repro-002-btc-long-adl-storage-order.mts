// Repro 002: on BTC-PERP the long side has more holders than the LiquidationEngine's ADL scan
// cap, so ADL there runs in storage order and the ranker is never asked — contrary to the trader
// docs ("those with the most profit relative to their account's equity first").
// Read-only, every read pinned to one block. Exits 1 while any side is over the cap.
//
// Run: npx tsx scripts/repro-002-btc-long-adl-storage-order.mts
import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { chain, client, j, RPC } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const ENGINE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D" as const;
const engineAbi = parseAbi([
  "function getMaxAdlScanPerCall() view returns (uint256)",
  "function getAdlRanker() view returns (address)",
]);
const bankAbi = (await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any)).marginBankReadAbi;

const block = await pc.getBlockNumber();
const scanCap = await pc.readContract({ address: ENGINE, abi: engineAbi, functionName: "getMaxAdlScanPerCall", blockNumber: block });
const ranker = await pc.readContract({ address: ENGINE, abi: engineAbi, functionName: "getAdlRanker", blockNumber: block });

const markets = (await client.listPerpMarkets()) as any[];
const sides: any[] = [];
for (const m of markets) {
  for (const isLong of [true, false]) {
    // count = 0: returns the side's holder-list length without any holder's health walk.
    const [, listLength] = (await pc.readContract({
      address: BANK, abi: bankAbi, functionName: "getSideHolderStatesPaginated",
      args: [m.poolAddress, isLong, 0n, 0n], blockNumber: block,
    })) as any;
    sides.push({ market: `${m.baseSymbol}-PERP`, side: isLong ? "long" : "short", pool: m.poolAddress, holders: listLength, overScanCap: scanCap !== 0n && listLength > scanCap });
  }
}
sides.sort((a, b) => Number(b.holders - a.holders));

// What the SDK's own ADL queue read says about the worst side.
const worst = sides[0];
const snap = await client.perpAdlQueue.getSnapshot({ marginBank: BANK, pool: worst.pool, isLong: worst.side === "long" });

const out = { at: new Date().toISOString(), block, engine: ENGINE, ranker, scanCap, largestSides: sides.slice(0, 6), sdkQueueForLargestSide: snap.data.queue };
console.log(j({ ...out, sdkQueueForLargestSide: { regime: snap.data.queue.regime, block: snap.data.blockNumber } }));
mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/002-adl-storage-order-${Date.now()}.json`, j(out));

const over = sides.filter((s) => s.overScanCap);
console.log(over.length ? `FAIL: ${over.map((s) => `${s.market} ${s.side} (${s.holders} holders > cap ${scanCap})`).join(", ")} — ADL there is not profit/equity ranked` : "PASS");
process.exit(over.length ? 1 : 0);
