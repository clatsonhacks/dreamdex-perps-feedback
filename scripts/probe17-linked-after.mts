// Probe 17: re-read the child's bank state and linkage straight from the contracts after the linked-wallet test.
import { createPublicClient, http, formatUnits } from "viem";
import { chain, RPC, client, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const [child, main] = process.argv.slice(2) as `0x${string}`[];
const block = process.argv[4] ? BigInt(process.argv[4]) : undefined;
const f = (v: bigint) => formatUnits(v, 18);
const rd = (address: any, abi: any, functionName: string, args: any[]) => pc.readContract({ address, abi, functionName, args, blockNumber: block } as any) as Promise<any>;
const registry = await rd(BANK, R.marginBankReadAbi, "getLinkedWalletRegistry", []);
const fns = (R.marginBankReadAbi as any[]).filter((x) => x.type === "function" && x.inputs.length === 1 && x.inputs[0].type === "address").map((x) => x.name);
const out: any = { block: block?.toString() ?? "latest", registry, bank: {} };
for (const fn of fns) { try { const v = await rd(BANK, R.marginBankReadAbi, fn, [child]); out.bank[fn] = typeof v === "bigint" ? f(v) : v; } catch (e: any) { out.bank[fn] = "ERR " + (e.shortMessage ?? "").split("\n")[0]; } }
out.linkageOfChild = await rd(registry, R.linkedWalletRegistryReadAbi, "linkageOf", [child]);
out.mainOfChild = await rd(registry, R.linkedWalletRegistryReadAbi, "mainOf", [child]);
if (main) { out.linkageOfMain = await rd(registry, R.linkedWalletRegistryReadAbi, "linkageOf", [main]); out.childrenOfMain = await rd(registry, R.linkedWalletRegistryReadAbi, "childrenOf", [main]); }
out.sdkLinkage = await client.getPerpWalletLinkage(registry, child);
out.sdkMarginAccount = await client.getMarginAccount(BANK, child);
console.log(j(out));
process.exit(0);
