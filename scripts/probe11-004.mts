// Probe 11: tier balances and bank wiring at block-1 / block of the fee tx, and the bank's
// token balance vs the sum of tier balances + a sample of account balances is out of reach, so
// stick to: does any InsuranceFund tier move, and what does the bank say the IF is?
import { createPublicClient, http, formatUnits } from "viem";
import { chain, RPC } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
const IF = "0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80";
const POOL = "0xD9b6A347A3Ae9FD6BA21179D3343F2c8A922F697";
const b = BigInt(process.argv[2]!);
for (const blk of [b - 1n, b]) {
  const tiers = [];
  for (let t = 0n; t <= 5n; t++) tiers.push(formatUnits(await pc.readContract({ address: IF, abi: R.insuranceFundReadAbi, functionName: "getTierBalance", args: [t], blockNumber: blk }) as bigint, 18));
  const total = await pc.readContract({ address: IF, abi: R.insuranceFundReadAbi, functionName: "getTotalTierBalances", blockNumber: blk });
  console.log("block", blk, "tiers", tiers.join(" | "), "total", formatUnits(total as bigint, 18));
}
console.log("bank.getInsuranceFundAddress", await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getInsuranceFundAddress", blockNumber: b }));
console.log("bank.isInsuranceFundCoverageEnabled(pool)", await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "isInsuranceFundCoverageEnabled", args: [POOL], blockNumber: b }));
process.exit(0);
