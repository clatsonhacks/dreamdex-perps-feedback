// Probe 4: recent pool margin-pull events (topic0 0x5172d1be...) vs the indexer's PerpMarginPull rows.
// 1000-block windows (the node's getLogs cap), one call at a time with a pause.
import { writeFileSync } from "node:fs";
import { j, RPC, INDEXER } from "./client.mts";

const PULL_TOPIC = process.argv[2]!;
const windows = Number(process.argv[3] ?? "20");
const rpc = async (method: string, params: unknown[]) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const b: any = await r.json();
  if (b.error) throw new Error(b.error.message);
  return b.result;
};
const head = BigInt(await rpc("eth_blockNumber", []));
const found: any[] = [];
for (let i = 0; i < windows; i++) {
  const to = head - BigInt(i) * 1000n;
  const from = to - 999n;
  const logs = await rpc("eth_getLogs", [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [PULL_TOPIC] }]);
  for (const l of logs) found.push({ block: BigInt(l.blockNumber), tx: l.transactionHash, pool: l.address, topics: l.topics, data: l.data });
  await new Promise((r) => setTimeout(r, 300));
}
console.log("head", head, "scanned", windows * 1000, "blocks; pull events on chain:", found.length);
const q = async (tx: string) => {
  const r = await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpMarginPull(where:{txHash:{_eq:"${tx}"}}) { id source amount blockNumber } }` }) });
  return ((await r.json()) as any).data.PerpMarginPull;
};
for (const f of found) { f.indexed = await q(f.tx); }
const missing = found.filter((f) => f.indexed.length === 0);
console.log("of which indexed:", found.length - missing.length, "missing from indexer:", missing.length);
for (const f of found.slice(0, 5)) console.log(f.block, f.tx, f.pool, "indexed rows:", f.indexed.length);
writeFileSync(`evidence/probe4-pull-events-${Date.now()}.json`, j({ head, scannedBlocks: windows * 1000, topic0: PULL_TOPIC, found }));
process.exit(0);
