// Probe 14: accounts that are liquidatable and stay that way (keeper lag).
// 1) every distinct account holding any perp position (getSideHoldersPaginated, all sides)
// 2) MarginBank.isLiquidatable + getMarginStatus for each, at one pinned block (multicall, small batches)
// 3) re-read the liquidatable ones after WAIT_S seconds, twice
// Read-only.
import { writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { client, j, RPC } from "./client.mts";

const pc = createPublicClient({ chain: hidekiTestnet as any, transport: http(RPC), batch: { multicall: { batchSize: 1024 * 2 } } });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const WAIT_S = Number(process.argv[2] ?? "180");

const markets = (await client.listPerpMarkets()) as any[];
const block0 = await pc.getBlockNumber();
const accounts = new Set<string>();
for (const m of markets) for (const isLong of [true, false]) {
  for (let start = 0n; ; start += 1000n) {
    const page = (await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getSideHoldersPaginated", args: [m.poolAddress, isLong, start, 1000n], blockNumber: block0 })) as string[];
    page.forEach((a) => accounts.add(a.toLowerCase()));
    if (page.length < 1000) break;
  }
}
const list = [...accounts] as `0x${string}`[];
console.log("block", block0, "distinct accounts with a position:", list.length);

const check = async (accts: `0x${string}`[], blockNumber: bigint) => {
  const out: any[] = [];
  for (let i = 0; i < accts.length; i += 150) {
    const chunk = accts.slice(i, i + 150);
    const res = await pc.multicall({
      contracts: chunk.flatMap((a) => [
        { address: BANK, abi: R.marginBankReadAbi, functionName: "isLiquidatable", args: [a] },
        { address: BANK, abi: R.marginBankReadAbi, functionName: "getMarginStatus", args: [a] },
        { address: BANK, abi: R.marginBankReadAbi, functionName: "getAccountHealth", args: [a] },
      ]),
      blockNumber, allowFailure: true,
    });
    chunk.forEach((a, k) => {
      const [liq, st, h] = [res[3 * k], res[3 * k + 1], res[3 * k + 2]] as any[];
      out.push({
        account: a, liquidatable: liq.status === "success" ? liq.result : null, status: st.status === "success" ? Number(st.result) : null,
        equity: h.status === "success" ? h.result[0].toString() : null, mmReq: h.status === "success" ? h.result[2].toString() : null,
        error: [liq, st, h].some((x) => x.status !== "success") ? String((liq.error ?? st.error ?? h.error)?.shortMessage ?? "").slice(0, 80) : undefined,
      });
    });
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
};

const first = await check(list, block0);
const statusCounts: Record<string, number> = {};
first.forEach((r) => (statusCounts[String(r.status)] = (statusCounts[String(r.status)] ?? 0) + 1));
const liq0 = first.filter((r) => r.liquidatable === true);
const errs = first.filter((r) => r.error);
console.log("status counts", statusCounts, "liquidatable:", liq0.length, "read errors:", errs.length);
const rounds: any[] = [{ block: block0, liquidatable: liq0.map((r) => r.account) }];
let still = liq0.map((r) => r.account as `0x${string}`);
for (let round = 1; round <= 2 && still.length; round++) {
  await new Promise((r) => setTimeout(r, WAIT_S * 1000));
  const b = await pc.getBlockNumber();
  const again = await check(still, b);
  still = again.filter((r) => r.liquidatable === true).map((r) => r.account);
  rounds.push({ block: b, liquidatable: still, rows: again });
  console.log(`after ${round * WAIT_S}s (block ${b}): still liquidatable ${still.length} of ${liq0.length}`);
}
writeFileSync(`evidence/probe14-keeper-lag-${Date.now()}.json`, j({ at: new Date().toISOString(), block0, accounts: list.length, statusCounts, first: first.filter((r) => r.liquidatable || r.error || (r.status ?? 0) > 0), rounds }));
process.exit(0);
