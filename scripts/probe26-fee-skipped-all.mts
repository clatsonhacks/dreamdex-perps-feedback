// Probe 26: every LiquidationFeeSkipped the indexer knows about, decoded from its receipt with the
// event signature recovered from the topic (keccak match): LiquidationFeeSkipped(address,address,uint8,uint256,uint256).
// Compares the on-chain reason / fillNotional / fee with the indexer row, and tallies reason codes.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, decodeEventLog, formatUnits } from "viem";
import { chain, RPC, INDEXER, j } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const abi = parseAbi(["event LiquidationFeeSkipped(address indexed account, address indexed perpPool, uint8 indexed reason, uint256 fillNotional, uint256 fee)"]);
const TOPIC = "0xabddd75762e0d6f38592eb52d5227a748603b3ae167f9f546fd3712d63ce991d";
const STAGE = "0x1d68b7d3e7dc3becd79d240b343718f2c6dcb5efca01640951f2951368b3b2e2";
const r = await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFeeSkipped"}}, order_by:{timestamp:asc}) { id account pool amount insurancePortion tier fillNotional timestamp txHash } }` }) })).json() as any;
const rows = r.data.PerpFeeRecord;
const out: any[] = []; const reasons: Record<string, { n: number; skippedFee: bigint }> = {}; const stageVals: Record<string, number> = {};
let mismatch = 0;
for (const row of rows) {
  const rc = await pc.getTransactionReceipt({ hash: row.txHash });
  for (const l of rc.logs) if (l.topics[0] === STAGE) stageVals[BigInt(l.data).toString()] = (stageVals[BigInt(l.data).toString()] ?? 0) + 1;
  const l = rc.logs.find((x) => x.topics[0] === TOPIC && `${row.txHash}_${x.logIndex}` === row.id);
  if (!l) { out.push({ id: row.id, missingOnChain: true }); mismatch++; continue; }
  const d: any = decodeEventLog({ abi, data: l.data, topics: l.topics as any }).args;
  const k = String(d.reason); reasons[k] ??= { n: 0, skippedFee: 0n }; reasons[k].n++; reasons[k].skippedFee += d.fee;
  const same = d.account.toLowerCase() === row.account && d.perpPool.toLowerCase() === row.pool && d.fillNotional.toString() === row.fillNotional;
  if (!same) mismatch++;
  out.push({ id: row.id, ts: row.timestamp, chain: { reason: d.reason, fillNotional: d.fillNotional.toString(), fee: d.fee.toString(), feeBpsOfFill: d.fillNotional ? Number((d.fee * 1000000n) / d.fillNotional) / 100 : null }, indexer: { amount: row.amount, tier: row.tier, insurancePortion: row.insurancePortion, fillNotional: row.fillNotional }, same });
}
const summary = { rows: rows.length, mismatch, reasons: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, { n: v.n, skippedFeeUSDso: formatUnits(v.skippedFee, 18) }])), totalSkippedFeeUSDso: formatUnits(Object.values(reasons).reduce((t, v) => t + v.skippedFee, 0n), 18), indexerAmountsAllZero: rows.every((x: any) => x.amount === "0"), stageEventValuesInTheseTxs: stageVals, first: rows[0]?.timestamp, last: rows.at(-1)?.timestamp };
console.log(j(summary)); console.log("sample", j(out.slice(0, 2)));
writeFileSync(`evidence/probe26-fee-skipped-${Date.now()}.json`, j({ summary, rows: out }));
process.exit(0);
