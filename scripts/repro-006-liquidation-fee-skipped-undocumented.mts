// Repro 006: the LiquidationEngine emits LiquidationFeeSkipped(account, perpPool, reason, fillNotional, fee).
// The indexer serves it as PerpFeeRecord kind "LiquidationFeeSkipped" WITH `skipReason` and
// `requestedAmount`, but the SDK:
//   - documents no such fee kind (PerpFeeRecord.kind lists four others),
//   - ships no ABI for the event, and
//   - drops `skipReason` and `requestedAmount` in `client.listPerpFees()` (its query does not select
//     them and its type has no field for them), so through the SDK a skip of a real, computed 1% fee
//     (reason 8) is indistinguishable from a skip with nothing to charge (reason 7).
// The event signature was recovered from its topic0 by keccak match.
// Read-only. Exits 1 while any of the three gaps is present.
//
// Run: npx tsx scripts/repro-006-liquidation-fee-skipped-undocumented.mts
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, decodeEventLog, formatUnits, toEventSelector } from "viem";
import { chain, client, RPC, INDEXER, j } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const SIG = "event LiquidationFeeSkipped(address indexed account, address indexed perpPool, uint8 indexed reason, uint256 fillNotional, uint256 fee)";
const abi = parseAbi([SIG]);
const topic0 = toEventSelector(abi[0]);

// 1. SDK: event ABI and kind documentation.
const sdkTopics = new Set((Object.values(ev).filter(Array.isArray).flat() as any[]).filter((x) => x.type === "event").map((x) => toEventSelector(x)));
const sdkHasAbi = sdkTopics.has(topic0);
const historySrc = readFileSync(new URL("../node_modules/@somnia-chain/markets-sdk/src/perp/history.ts", import.meta.url), "utf8");
const sdkDocumentsKind = historySrc.includes("LiquidationFeeSkipped");

// 2. The same rows three ways: SDK listPerpFees, raw indexer, chain log.
const sdkRows = (await client.listPerpFees({ kind: "LiquidationFeeSkipped", limit: 500 })) as any[];
const res = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFeeSkipped"}}, order_by:{blockNumber:asc}) { id amount skipReason requestedAmount fillNotional blockNumber txHash } }` }) })).json()) as any;
const rawRows = res.data.PerpFeeRecord as any[];
const sdkById = new Map(sdkRows.map((r) => [r.id, r]));
const byReason: Record<string, { rows: number; skippedFee: bigint }> = {};
const realFeeSkipped: any[] = [];
let indexerMatchesChain = 0;
for (const row of rawRows) {
  const rc = await pc.getTransactionReceipt({ hash: row.txHash });
  const log = rc.logs.find((l) => l.topics[0] === topic0 && `${row.txHash}_${l.logIndex}` === row.id)!;
  const d: any = decodeEventLog({ abi, data: log.data, topics: log.topics as any }).args;
  if (Number(row.skipReason) === d.reason && BigInt(row.requestedAmount ?? 0) === d.fee) indexerMatchesChain++;
  const k = String(d.reason);
  (byReason[k] ??= { rows: 0, skippedFee: 0n }).rows++;
  byReason[k].skippedFee += d.fee;
  if (d.fee > 0n) {
    const s: any = sdkById.get(row.id);
    realFeeSkipped.push({
      tx: row.txHash, block: row.blockNumber,
      chain: { reason: d.reason, fillNotional: formatUnits(d.fillNotional, 18), fee: formatUnits(d.fee, 18) },
      indexer: { skipReason: row.skipReason, requestedAmount: formatUnits(BigInt(row.requestedAmount), 18), amount: row.amount },
      sdkListPerpFees: s ? { keys: Object.keys(s), amount: s.amount, skipReason: s.skipReason, requestedAmount: s.requestedAmount } : null,
    });
  }
}
const sdkDropsFields = sdkRows.length > 0 && sdkRows.every((r) => !("skipReason" in r) && !("requestedAmount" in r));
const out = {
  at: new Date().toISOString(), topic0, signatureRecovered: SIG,
  sdk: { eventInAnyEventsAbi: sdkHasAbi, kindMentionedInHistoryTs: sdkDocumentsKind, listPerpFeesRows: sdkRows.length, listPerpFeesRowKeys: sdkRows[0] ? Object.keys(sdkRows[0]) : [], dropsSkipReasonAndRequestedAmount: sdkDropsFields },
  indexer: { rows: rawRows.length, rowsWhoseSkipReasonAndRequestedAmountMatchChain: indexerMatchesChain },
  onChainByReason: Object.fromEntries(Object.entries(byReason).map(([k, v]) => [k, { rows: v.rows, skippedFeeUSDso: formatUnits(v.skippedFee, 18) }])),
  realFeeSkipped,
};
console.log(j(out));
mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/006-liquidation-fee-skipped-${Date.now()}.json`, j(out));

const bug = rawRows.length > 0 && (!sdkHasAbi || !sdkDocumentsKind || sdkDropsFields);
console.log(bug
  ? `FAIL: ${rawRows.length} LiquidationFeeSkipped rows (indexer reason/amount match chain on ${indexerMatchesChain}); SDK ABI has the event: ${sdkHasAbi}; SDK documents the kind: ${sdkDocumentsKind}; listPerpFees drops skipReason and requestedAmount: ${sdkDropsFields} (hides ${out.onChainByReason["8"]?.skippedFeeUSDso ?? 0} USDso of skipped fees on ${realFeeSkipped.length} rows)`
  : "PASS");
process.exit(bug ? 1 : 0);
