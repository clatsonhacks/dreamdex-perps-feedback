// One-off cleanup: MAIN recalls whatever principal is still outstanding in the CHILD (over-asks; the bank clamps).
import { createPublicClient, http, formatUnits } from "viem";
import { chain, RPC } from "./client.mts";
import { client, trader } from "./wallet.mts";
import { childAddress as CHILD } from "./wallet-child.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const { principal } = await client.getPerpMainFunding(BANK, CHILD);
console.log("outstanding", formatUnits(principal, 18));
if (principal > 0n) {
  const r: any = await trader.recallPerpMainFunding({ marginBank: BANK, child: CHILD, amount: principal * 2n });
  const rc = await pc.waitForTransactionReceipt({ hash: r.hash ?? r.txHash ?? r.receipt?.transactionHash });
  console.log("recall", rc.transactionHash, rc.status, "block", rc.blockNumber);
}
process.exit(0);
