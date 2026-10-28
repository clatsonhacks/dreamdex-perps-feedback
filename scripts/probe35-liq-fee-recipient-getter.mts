// Probe 35: is the liquidation fee recipient readable on chain? Tries likely getters on MarginBank and
// LiquidationEngine, and prints getPerpSystemConfig (does the SDK surface it?).
import { createPublicClient, http, parseAbi } from "viem";
import { chain, RPC, client, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394", LE = "0xA66d3C24Ad4a389d863846905D8173e1017e9F4D";
for (const name of ["getLiquidationFeeRecipient", "liquidationFeeRecipient", "getFeeRecipient", "feeRecipient", "getLiquidationFeeConfig"]) for (const [lbl, a] of [["bank", BANK], ["engine", LE]] as const) {
  try { const v = await pc.readContract({ address: a as any, abi: parseAbi([`function ${name}() view returns (address)`]), functionName: name as any }); console.log(lbl, name, "->", v); } catch { /* not present */ }
}
console.log("getPerpSystemConfig", j(await client.getPerpSystemConfig(BANK)));
process.exit(0);
