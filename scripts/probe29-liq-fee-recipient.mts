// Probe 29: the configured LiquidationFeeRecipient (indexer PerpFeeRecipientChange) — does it receive the fees?
// Reads its MarginBank account and USDso balance now, and its bank-account / token delta across given fee txs.
import { createPublicClient, http, formatUnits, parseAbi } from "viem";
import { chain, RPC, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const, USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72" as const;
const who = (process.argv[2] ?? "0x95f23a563ecee5c6f841d762943d2f2fec742253") as `0x${string}`;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const f = (v: bigint) => formatUnits(v, 18);
const bank = async (bn?: bigint) => { const s: any = await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getAccountState", args: [who], blockNumber: bn } as any); return s.unlockedCollateralBalance + s.lockedCollateral; };
const tok = async (bn?: bigint) => pc.readContract({ address: USDSO, abi: erc20, functionName: "balanceOf", args: [who], blockNumber: bn } as any) as Promise<bigint>;
console.log("recipient", who, "code bytes", ((await pc.getCode({ address: who })) ?? "0x").length / 2 - 1);
console.log("now: bank account", f(await bank()), "| USDso token", f(await tok()));
for (const tx of process.argv.slice(3)) {
  const rc = await pc.getTransactionReceipt({ hash: tx as `0x${string}` }); const b = rc.blockNumber;
  console.log(tx.slice(0, 12), "block", b, "bank delta", f((await bank(b)) - (await bank(b - 1n))), "token delta", f((await tok(b)) - (await tok(b - 1n))), "| bank before", f(await bank(b - 1n)));
}
for (const bn of [17162829n, 17162831n]) console.log("around the set-recipient block", bn, "bank", f(await bank(bn)));
process.exit(0);
