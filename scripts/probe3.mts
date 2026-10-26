// Probe 3: are owner auto-pulls still happening on chain after the indexer's last PerpMarginPull row?
// Reads USDso Transfer(from, to = MarginBank) logs, then each tx's `to`. A tx sent to a pool is a pull.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem, getAddress } from "viem";
import { chain, j, RPC } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72";
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const pools = new Set<string>(JSON.parse(process.argv[2] ?? "[]").map((p: string) => p.toLowerCase()));

const head = await pc.getBlockNumber();
const span = BigInt(process.argv[3] ?? "200000");
const step = 50_000n;
const hits: any[] = [];
for (let from = head - span; from < head; from += step) {
  const to = from + step - 1n < head ? from + step - 1n : head;
  try {
    const logs = await pc.getLogs({ address: USDSO, event: transfer, args: { to: BANK }, fromBlock: from, toBlock: to });
    for (const l of logs) hits.push(l);
  } catch (e: any) { console.log("getLogs failed", from, to, String(e.shortMessage ?? e.message).slice(0, 160)); }
}
console.log("Transfer->bank logs in last", span.toString(), "blocks:", hits.length);
const rows: any[] = [];
for (const l of hits.slice(-60)) {
  const tx = await pc.getTransaction({ hash: l.transactionHash });
  const viaPool = tx.to ? pools.has(tx.to.toLowerCase()) : false;
  rows.push({ block: l.blockNumber, tx: l.transactionHash, from: l.args.from, value: l.args.value, txTo: tx.to, viaPool });
}
const viaPool = rows.filter((r) => r.viaPool);
console.log("sampled", rows.length, "sent to a pool (auto-pull):", viaPool.length);
for (const r of viaPool.slice(-5)) console.log(r.block, r.tx, r.from, r.value);
writeFileSync(`evidence/probe3-onchain-pulls-${Date.now()}.json`, j({ head, span, total: hits.length, rows }));
process.exit(0);
