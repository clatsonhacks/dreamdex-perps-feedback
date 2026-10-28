// Probe 10: who received the fee? MarginBank state deltas for every plausible recipient across the block,
// plus the bank's USDso token balance delta.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, formatUnits, parseAbi } from "viem";
import { chain, j, RPC } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const abi = (await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any)).marginBankReadAbi;
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72";
const b = BigInt(process.argv[2]!);
const who: Record<string, string> = {
  insuranceFund: "0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80", liquidationEngine: "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D",
  feeRecipient: "0xd58596620Ee6951B2958a931949e4ff7ce6222be", keeper: "0x03CA1F61c5A475951F69F51BD16523075Fdfb1cc",
  pool: "0xD9b6A347A3Ae9FD6BA21179D3343F2c8A922F697", counterparty: "0x47537E3A3ea6e9391F3B26Ea45618db6828c8bfF",
  bankItself: BANK, keeperOwner: "0xF48394d6fDCc83D519C7a22C2cF246d210F1932E",
};
const out: any = { block: b, deltas: {} };
for (const [name, a] of Object.entries(who)) {
  const s0: any = await pc.readContract({ address: BANK, abi, functionName: "getAccountState", args: [a], blockNumber: b - 1n });
  const s1: any = await pc.readContract({ address: BANK, abi, functionName: "getAccountState", args: [a], blockNumber: b });
  const d = s1.unlockedCollateralBalance + s1.lockedCollateral - (s0.unlockedCollateralBalance + s0.lockedCollateral);
  out.deltas[name] = d;
  console.log(name.padEnd(18), "bank-account delta", formatUnits(d, 18));
}
const erc = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const t0 = await pc.readContract({ address: USDSO, abi: erc, functionName: "balanceOf", args: [BANK], blockNumber: b - 1n });
const t1 = await pc.readContract({ address: USDSO, abi: erc, functionName: "balanceOf", args: [BANK], blockNumber: b });
out.bankTokenDelta = t1 - t0;
console.log("MarginBank USDso token balance delta", formatUnits(t1 - t0, 18));
writeFileSync(`evidence/probe10-fee-recipient-${Date.now()}.json`, j(out));
process.exit(0);
