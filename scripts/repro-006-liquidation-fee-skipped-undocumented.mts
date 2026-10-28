// Repro 006: the LiquidationEngine emits LiquidationFeeSkipped(account, perpPool, reason, fillNotional, fee)
// and the indexer serves it as PerpFeeRecord kind "LiquidationFeeSkipped", but:
//   - the SDK documents no such fee kind and ships no ABI for the event, and
//   - the indexer row drops `reason` and the skipped `fee` (amount is always "0"), so a skip of a
//     real, computed 1% fee (reason 8) reads the same as a skip with nothing to charge (reason 7).
// The event signature was recovered from its topic0 by keccak match.
// Read-only. Exits 1 while any of the three gaps is present.
//
// Run: npx tsx scripts/repro-006-liquidation-fee-skipped-undocumented.mts
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, decodeEventLog, formatUnits, toEventSelector } from "viem";
import { chain, RPC, INDEXER, j } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const SIG = "event LiquidationFeeSkipped(address indexed account, address indexed perpPool, uint8 indexed reason, uint256 fillNotional, uint256 fee)";
const abi = parseAbi([SIG]);
const topic0 = toEventSelector(abi[0]);

// 1. Is the event in any SDK event ABI? Is the kind named anywhere in the SDK source?
const sdkTopics = new Set((Object.values(ev).filter(Array.isArray).flat() as any[]).filter((x) => x.type === "event").map((x) => toEventSelector(x)));
const sdkHasAbi = sdkTopics.has(topic0);
const historySrc = readFileSync(new URL("../node_modules/@somnia-chain/markets-sdk/src/perp/history.ts", import.meta.url), "utf8");
const sdkDocumentsKind = historySrc.includes("LiquidationFeeSkipped");

// 2. Every indexed row vs its log on chain.
const res = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFeeSkipped"}}, order_by:{timestamp:asc}) { id account pool amount insurancePortion tier fillNotional timestamp txHash } }` }) })).json()) as any;
const rows = res.data.PerpFeeRecord as any[];
const byReason: Record<string, { rows: number; skippedFee: bigint }> = {};
const realFeeSkipped: any[] = [];
for (const row of rows) {
  const rc = await pc.getTransactionReceipt({ hash: row.txHash });
  const log = rc.logs.find((l) => l.topics[0] === topic0 && `${row.txHash}_${l.logIndex}` === row.id)!;
  const d: any = decodeEventLog({ abi, data: log.data, topics: log.topics as any }).args;
  const k = String(d.reason);
  (byReason[k] ??= { rows: 0, skippedFee: 0n }).rows++;
  byReason[k].skippedFee += d.fee;
  if (d.fee > 0n) realFeeSkipped.push({ tx: row.txHash, block: rc.blockNumber, onChain: { reason: d.reason, fillNotional: formatUnits(d.fillNotional, 18), fee: formatUnits(d.fee, 18) }, indexerRow: { kind: "LiquidationFeeSkipped", amount: row.amount, fillNotional: formatUnits(BigInt(row.fillNotional), 18), tier: row.tier, insurancePortion: row.insurancePortion } });
}
const out = {
  at: new Date().toISOString(), topic0, signatureRecovered: SIG,
  sdk: { eventInAnyEventsAbi: sdkHasAbi, kindMentionedInHistoryTs: sdkDocumentsKind },
  indexer: { rows: rows.length, first: rows[0]?.timestamp, last: rows.at(-1)?.timestamp, everyAmountZero: rows.every((r) => r.amount === "0"), rowHasReasonField: rows.length ? "reason" in rows[0] : null },
  onChainByReason: Object.fromEntries(Object.entries(byReason).map(([k, v]) => [k, { rows: v.rows, skippedFeeUSDso: formatUnits(v.skippedFee, 18) }])),
  realFeeSkipped,
};
console.log(j(out));
mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/006-liquidation-fee-skipped-${Date.now()}.json`, j(out));

const lostDetail = realFeeSkipped.length > 0 && realFeeSkipped.every((r) => r.indexerRow.amount === "0");
const bug = rows.length > 0 && (!sdkHasAbi || !sdkDocumentsKind || lostDetail);
console.log(bug
  ? `FAIL: ${rows.length} LiquidationFeeSkipped rows; SDK ABI has the event: ${sdkHasAbi}; SDK documents the kind: ${sdkDocumentsKind}; ${realFeeSkipped.length} rows skipped a real fee (${out.onChainByReason["8"]?.skippedFeeUSDso ?? 0} USDso) yet the indexer stores amount 0 and no reason`
  : "PASS");
process.exit(bug ? 1 : 0);
