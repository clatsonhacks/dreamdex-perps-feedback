// Repro 005: for the first `linkMaturitySeconds` after a link is accepted, the registry's linkageOf()
// returns main = 0 and members = [], so the SDK's getPerpWalletLinkage reports a linked child
// (whose orders are already drawing on its main's wallet) as unlinked, and its main as no main.
// Read-only. Every read is pinned to one historical block at which a link was 4 s old and had
// just funded a child order, so this needs no wallet and gives the same answer on every run.
// Exits 1 while the SDK says "not linked" and the bank and the raw graph say "linked and funded".
//
// Run: npx tsx scripts/repro-005-linkage-empty-until-mature.mts [child main block]
import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, formatUnits, zeroAddress } from "viem";
import { chain, j, RPC } from "./client.mts";

const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const L = await import("../node_modules/@somnia-chain/markets-sdk/dist/perp/linkedWallet.js" as any);
const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const [child, main, blk] = process.argv.length > 4 ? process.argv.slice(2) : ["0x7400346f9492cf6Ac73c13A3B2D0b864b0F5080d", "0xE488bb2bd58E9C425F525293856FAA529f7b1db3", "33889745"];
const blockNumber = BigInt(blk);

// The SDK's own read functions, handed a client whose every read is pinned to `blockNumber`.
const pinned: any = { ...pc, readContract: (a: any) => pc.readContract({ ...a, blockNumber }) };
const rd = (address: any, abi: any, functionName: string, args: any[] = []) => pc.readContract({ address, abi, functionName, args, blockNumber } as any) as Promise<any>;

const block = await pc.getBlock({ blockNumber });
const registry = await L.getPerpLinkedWalletRegistry(BANK, pinned);
const reg = R.linkedWalletRegistryReadAbi;
const out: any = {
  at: new Date().toISOString(), block: blockNumber, blockTime: block.timestamp, registry, child, main,
  linkMaturitySeconds: await rd(registry, reg, "linkMaturitySeconds"),
  sdk: {
    getPerpWalletLinkage_child: await L.getPerpWalletLinkage(registry, child, pinned),
    getPerpWalletLinkage_main: await L.getPerpWalletLinkage(registry, main, pinned),
    quotePerpFundingPayer_child: await L.quotePerpFundingPayer(BANK, child, pinned),
    getPerpMainFunding_child: await L.getPerpMainFunding(BANK, child, pinned),
    listPerpLinkedChildren_main: await L.listPerpLinkedChildren(registry, main, pinned),
  },
  registryRaw: {
    mainOf_child: await rd(registry, reg, "mainOf", [child]),
    areLinked: await rd(registry, reg, "areLinked", [main, child]),
    groupOf_child: await rd(registry, reg, "groupOf", [child]),
    linkageOf_child: await rd(registry, reg, "linkageOf", [child]),
    linkageOf_main: await rd(registry, reg, "linkageOf", [main]),
  },
};
const lc = out.sdk.getPerpWalletLinkage_child;
out.linkAgeSeconds = block.timestamp - lc.linkedAt;
out.secondsUntilMature = lc.maturesAt - block.timestamp;
out.principalFunded = formatUnits(out.sdk.getPerpMainFunding_child.principal, 18);
console.log(j(out));
mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/005-linkage-empty-until-mature-${Date.now()}.json`, j(out));

const graphSaysLinked = out.registryRaw.areLinked && out.registryRaw.mainOf_child === main;
const bankSaysFunded = out.sdk.quotePerpFundingPayer_child.funded && out.sdk.getPerpMainFunding_child.principal > 0n;
const sdkSaysUnlinked = !lc.isChild && lc.main === zeroAddress && lc.members.length === 0 && !out.sdk.getPerpWalletLinkage_main.isMain;
const bug = graphSaysLinked && bankSaysFunded && sdkSaysUnlinked;
console.log(bug
  ? `FAIL: link ${out.linkAgeSeconds}s old (matures in ${out.secondsUntilMature}s); main has funded ${out.principalFunded} USDso into the child, but getPerpWalletLinkage says child { isChild: false, main: 0x0, members: [] } and main { isMain: false }`
  : "PASS");
process.exit(bug ? 1 : 0);
