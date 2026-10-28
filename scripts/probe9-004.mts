// Probe 9: around one LiquidationFeeCharged tx, read the liquidated account's and the
// InsuranceFund's MarginBank state at block-1 and block. Read-only, pinned blocks.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, formatUnits } from "viem";
import { chain, j, RPC } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const abi = (await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any)).marginBankReadAbi;
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
const IF = "0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80";
const [tx, account] = process.argv.slice(2) as [`0x${string}`, `0x${string}`];
const rc = await pc.getTransactionReceipt({ hash: tx });
const b = rc.blockNumber;
const st = async (who: string, blockNumber: bigint) => {
  const s: any = await pc.readContract({ address: BANK, abi, functionName: "getAccountState", args: [who], blockNumber });
  return { unlocked: s.unlockedCollateralBalance, locked: s.lockedCollateral, total: s.unlockedCollateralBalance + s.lockedCollateral };
};
const out: any = { tx, block: b, txIndex: rc.transactionIndex };
for (const [name, who] of [["account", account], ["insuranceFund", IF]] as const) {
  const before = await st(who, b - 1n), after = await st(who, b);
  out[name] = { before, after, delta: after.total - before.total };
  console.log(name, "before", formatUnits(before.total, 18), "after", formatUnits(after.total, 18), "delta", formatUnits(after.total - before.total, 18));
}
// Other txs in the block touching the account would muddy the delta; count them.
const block = await pc.getBlock({ blockNumber: b, includeTransactions: false });
out.txsInBlock = block.transactions.length;
console.log("txs in block", block.transactions.length);
writeFileSync(`evidence/probe9-liqfee-balances-${Date.now()}.json`, j(out));
process.exit(0);
