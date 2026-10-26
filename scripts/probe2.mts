// Probe 2: linked-wallet rail on live Hideki. Indexer history + chain reads, read-only.
import { writeFileSync } from "node:fs";
import { getAddress } from "viem";
import { client, j } from "./client.mts";

const out: any = { at: new Date().toISOString() };
const bank = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
const registry = await client.getPerpLinkedWalletRegistry(bank);
out.registry = registry;

const links = await client.listPerpWalletLinkEvents({ limit: 200 });
out.linkEventCount = links.length;
out.linkKinds = links.reduce((a: any, r: any) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {});
console.log("link events", links.length, out.linkKinds);
out.linkEvents = links;

const pulls = await client.listPerpMarginPulls({ limit: 200 });
out.pullCount = pulls.length;
out.pullSources = pulls.reduce((a: any, r: any) => ((a[r.source] = (a[r.source] ?? 0) + 1), a), {});
console.log("pulls", pulls.length, out.pullSources);
const mainPulls = await client.listPerpMarginPulls({ source: "Main", limit: 200 });
console.log("main pulls", mainPulls.length);
out.mainPulls = mainPulls;
const fundEvents = await client.listPerpMainFundingEvents({ limit: 200 });
console.log("main funding events", fundEvents.length);
out.fundEvents = fundEvents;

// Linkage reads for every main/child we can see, in indexer (lowercase) and checksummed form.
const mains = new Set<string>(), children = new Set<string>();
for (const r of links) if (r.kind === "Linked") { mains.add(r.main); children.add(r.child); }
out.linkage = [];
for (const w of [...mains, ...children].slice(0, 20)) {
  const lower = w.toLowerCase(), cs = getAddress(w);
  const a = await client.getPerpWalletLinkage(registry, lower);
  const b = await client.getPerpWalletLinkage(registry, cs);
  const qa = await client.quotePerpFundingPayer(bank, lower);
  const qb = await client.quotePerpFundingPayer(bank, cs);
  const row = {
    wallet: cs, role: mains.has(w) ? "main(per log)" : "child(per log)", rawMain: b.main, members: b.members.length,
    lower: { isChild: a.isChild, isMain: a.isMain, payer: qa }, checksummed: { isChild: b.isChild, isMain: b.isMain, payer: qb },
  };
  out.linkage.push(row);
  console.log(j(row).replace(/\s+/g, " "));
}
writeFileSync(`evidence/probe2-linked-${Date.now()}.json`, j(out));
process.exit(0);
