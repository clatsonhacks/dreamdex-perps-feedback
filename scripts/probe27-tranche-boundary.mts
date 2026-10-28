// Probe 27: re-run the withdraw-boundary checks of wallet-test-linked-tranche pinned to a given block
// (the cancel tx's block), so a lagging RPC node cannot hand back an older state.
import { createPublicClient, http, formatUnits } from "viem";
import { chain, RPC, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const T = await import("../node_modules/@somnia-chain/markets-sdk/dist/tradeAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const child = process.argv[2] as `0x${string}`, blockNumber = BigInt(process.argv[3]);
const rd = (fn: string) => pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: fn, args: [child], blockNumber } as any) as Promise<any>;
const st = await rd("getAccountState"), principal: bigint = await rd("getMainFundedPrincipal"), wd: bigint = await rd("getWithdrawableCollateral"), eq: bigint = await rd("getAccountEquity");
const f = (v: bigint) => formatUnits(v, 18);
const unlocked: bigint = st.unlockedCollateralBalance;
const sim = async (label: string, amt: bigint) => { try { await pc.simulateContract({ account: child, address: BANK, abi: T.marginBankWriteAbi, functionName: "withdraw", args: [amt], blockNumber } as any); return { label, amt: f(amt), result: "ok" }; } catch (e: any) { return { label, amt: f(amt), result: "revert", reason: e.cause?.signature ?? e.cause?.data?.errorName ?? e.shortMessage?.split("\n")[0] }; } };
const own = unlocked - principal;
console.log(j({ block: blockNumber, unlocked: f(unlocked), locked: f(st.lockedCollateral), principal: f(principal), equity: f(eq), getWithdrawableCollateral: f(wd), documented: f(own) }));
for (const r of [await sim("documented max", own), await sim("documented max + 1 wei", own + 1n), await sim("getWithdrawableCollateral", wd), await sim("getWithdrawableCollateral + 1 wei", wd + 1n), await sim("all unlocked", unlocked)]) console.log(j(r));
process.exit(0);
