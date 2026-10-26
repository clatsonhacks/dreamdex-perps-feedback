// Probe 5: raw reads (no SDK logic) behind the two ADL findings, pinned to one block.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi } from "viem";
import { chain, j, RPC } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const ENGINE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D" as const;
const abi = parseAbi([
  "function getLinkedWalletRegistry() view returns (address)",
  "function getAdlRanker() view returns (address)",
  "function getMaxAdlScanPerCall() view returns (uint256)",
]);
const block = await pc.getBlockNumber();
const read = (address: `0x${string}`, functionName: any) => pc.readContract({ address, abi, functionName, blockNumber: block });
const out: any = {
  at: new Date().toISOString(),
  block,
  marginBank_getLinkedWalletRegistry: await read(BANK, "getLinkedWalletRegistry"),
  engine_getLinkedWalletRegistry: await read(ENGINE, "getLinkedWalletRegistry"),
  engine_getAdlRanker: await read(ENGINE, "getAdlRanker"),
  engine_getMaxAdlScanPerCall: await read(ENGINE, "getMaxAdlScanPerCall"),
};

// Side holder counts: getSideHolderStatesPaginated(pool, isLong, 0, 0) returns the list length without any holder state.
const { markets } = JSON.parse(process.argv[2]!);
const bankAbi = (await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any)).marginBankReadAbi;
out.sides = [];
for (const m of markets) {
  for (const isLong of [true, false]) {
    const [, listLength] = (await pc.readContract({
      address: BANK, abi: bankAbi, functionName: "getSideHolderStatesPaginated", args: [m.pool, isLong, 0n, 0n], blockNumber: block,
    })) as any;
    out.sides.push({ base: m.base, isLong, holders: listLength, overScanCap: listLength > out.engine_getMaxAdlScanPerCall });
  }
}
console.log(j({ ...out, sides: undefined }));
const sorted = [...out.sides].sort((a, b) => Number(b.holders - a.holders));
console.log("largest sides:", sorted.slice(0, 8).map((s) => `${s.base}-${s.isLong ? "long" : "short"}=${s.holders}`).join(", "));
console.log("sides over the scan cap:", out.sides.filter((s: any) => s.overScanCap).map((s: any) => `${s.base}-${s.isLong ? "long" : "short"}`));
writeFileSync(`evidence/probe5-adl-raw-${Date.now()}.json`, j(out));
process.exit(0);
