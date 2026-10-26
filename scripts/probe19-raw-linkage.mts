// Probe 19: raw linkageOf return bytes, plus areLinked / linkedAtOf / groupOf, at one block.
// Run: npx tsx scripts/probe19-raw-linkage.mts <child> <main> <block>
import { createPublicClient, http, encodeFunctionData, parseAbi } from "viem";
import { chain, RPC } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const REG = "0x5b3C5Bf1F7AdA852e8AA783f6299932E32073aFb";
const [child, main, block] = process.argv.slice(2);
const abi = parseAbi(["function linkageOf(address) view returns (uint256)", "function areLinked(address,address) view returns (bool)", "function linkedAtOf(address) view returns (uint64)", "function groupOf(address) view returns (address[])"]);
for (const w of [child, main]) {
  const r = await pc.call({ to: REG, data: encodeFunctionData({ abi, functionName: "linkageOf", args: [w as any] }), blockNumber: BigInt(block) });
  console.log("linkageOf", w, "\n" + (r.data!.slice(2).match(/.{64}/g) ?? []).map((x, i) => `${(i * 32).toString(16).padStart(4)}: ${x}`).join("\n"));
}
console.log("areLinked", await pc.readContract({ address: REG, abi, functionName: "areLinked", args: [main as any, child as any], blockNumber: BigInt(block) }));
console.log("linkedAtOf", await pc.readContract({ address: REG, abi, functionName: "linkedAtOf", args: [child as any], blockNumber: BigInt(block) }));
console.log("groupOf child", await pc.readContract({ address: REG, abi, functionName: "groupOf", args: [child as any], blockNumber: BigInt(block) }));
console.log("groupOf main", await pc.readContract({ address: REG, abi, functionName: "groupOf", args: [main as any], blockNumber: BigInt(block) }));
process.exit(0);
