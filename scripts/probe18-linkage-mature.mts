// Probe 18: for every pair the indexer says got Linked, compare the registry's raw graph reads
// (mainOf / groupOf / areLinked) with linkageOf, and note whether the link is past maturesAt.
import { createPublicClient, http, parseAbi } from "viem";
import { chain, RPC, INDEXER, client, j } from "./client.mts";
import { writeFileSync } from "node:fs";
const pc = createPublicClient({ chain, transport: http(RPC) });
const REG = "0x5b3C5Bf1F7AdA852e8AA783f6299932E32073aFb" as const;
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const rd = (fn: string, args: any[]) => pc.readContract({ address: REG, abi: R.linkedWalletRegistryReadAbi, functionName: fn, args } as any) as Promise<any>;
const r = await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpWalletLinkEvent(order_by:{blockNumber:asc}, limit: 500) { kind main child blockNumber timestamp txHash } }` }) });
const rows = ((await r.json()) as any).data.PerpWalletLinkEvent;
const kinds: Record<string, number> = {};
for (const x of rows) kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;
const now = BigInt(Math.floor(Date.now() / 1000));
const pairs = [...new Set(rows.filter((x: any) => x.kind === "Linked").map((x: any) => `${x.main}|${x.child}`))] as string[];
const out: any = { at: new Date().toISOString(), indexerKinds: kinds, pairs: [] };
for (const p of pairs) {
  const [main, child] = p.split("|") as `0x${string}`[];
  const [mainOf, groupOf, areLinked, lc, lm] = await Promise.all([rd("mainOf", [child]), rd("groupOf", [child]), rd("areLinked", [main, child]), rd("linkageOf", [child]), rd("linkageOf", [main])]);
  const row = { main, child, mainOf, areLinked, groupSize: groupOf.length, linkageOfChild: { main: lc.main, members: lc.members.length, linkedAt: lc.linkedAt.toString(), maturesAt: lc.maturesAt.toString(), mature: lc.maturesAt > 0n && lc.maturesAt <= now }, linkageOfMain: { main: lm.main, members: lm.members.length }, sdkIsChild: (await client.getPerpWalletLinkage(REG, child)).isChild };
  out.pairs.push(row);
  console.log(j(row));
}
console.log("indexer kinds", kinds, "pairs", pairs.length);
writeFileSync(`evidence/probe18-linkage-mature-${Date.now()}.json`, j(out));
process.exit(0);
