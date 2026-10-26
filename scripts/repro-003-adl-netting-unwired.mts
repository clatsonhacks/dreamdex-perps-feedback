// Repro 003: the linked-wallet funding rail is armed on the MarginBank, but the LiquidationEngine
// holds no linked-wallet registry, so the ADL netting the SDK documents for linked wallets
// (and the `maturesAt` it is gated on) never applies.
// Read-only, pinned to one block. Exits 1 while bank and engine disagree.
//
// Run: npx tsx scripts/repro-003-adl-netting-unwired.mts
import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, parseAbi, zeroAddress } from "viem";
import { chain, client, j, RPC } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const abi = parseAbi(["function getLinkedWalletRegistry() view returns (address)"]);
const block = await pc.getBlockNumber();
const cfg = await client.getPerpSystemConfig(BANK);
const bankRegistry = await pc.readContract({ address: BANK, abi, functionName: "getLinkedWalletRegistry", blockNumber: block });
const engineRegistry = await pc.readContract({ address: cfg.liquidationEngine, abi, functionName: "getLinkedWalletRegistry", blockNumber: block });

const out: any = { at: new Date().toISOString(), block, liquidationEngine: cfg.liquidationEngine, fullyWired: cfg.fullyWired, bankRegistry, engineRegistry };
if (bankRegistry !== zeroAddress) {
  out.maxChildren = await client.getPerpMaxLinkedChildren(bankRegistry);
  out.linkedRows = await client.listPerpWalletLinkEvents({ kind: "Linked", limit: 20 });
}
console.log(j(out));
mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/003-adl-netting-unwired-${Date.now()}.json`, j(out));

const bug = bankRegistry !== zeroAddress && engineRegistry === zeroAddress;
console.log(bug ? "FAIL: funding rail armed on the bank, ADL netting unwired on the engine (fullyWired still true)" : "PASS");
process.exit(bug ? 1 : 0);
