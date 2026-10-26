// Probe 16: (a) indexer Market.openInterest / fundingRate vs chain, per market, now;
// (b) indexer FundingPayment rows vs FundingSettled events decoded from one known tx.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, formatUnits, decodeEventLog } from "viem";
import { chain, client, j, RPC, INDEXER } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const out: any = { at: new Date().toISOString(), markets: [] };

const now = Math.floor(Date.now() / 1000);
const markets = (await client.listPerpMarkets()) as any[];
for (const m of markets) {
  const st: any = await client.getPerpState(m.poolAddress);
  const d = m.baseDecimals;
  const row = {
    market: `${m.baseSymbol}-PERP`,
    oiIndexer: formatUnits(BigInt(m.openInterest ?? 0), d), oiChain: formatUnits(st.openInterest, d),
    oiDiffPct: st.openInterest > 0n ? Number(((BigInt(m.openInterest ?? 0) - st.openInterest) * 10000n) / st.openInterest) / 100 : null,
    oiUpdatedAgoS: m.openInterestUpdatedAt ? now - Number(m.openInterestUpdatedAt) : null,
    fundingIndexer: m.fundingRate, fundingChain: st.fundingRate.toString(),
    fundingUpdatedAgoS: m.fundingUpdatedAt ? now - Number(m.fundingUpdatedAt) : null,
  };
  out.markets.push(row);
  console.log(`${row.market.padEnd(14)} OI idx ${row.oiIndexer} chain ${row.oiChain} (${row.oiDiffPct}%) upd ${row.oiUpdatedAgoS}s ago | funding idx ${row.fundingIndexer} chain ${row.fundingChain} upd ${row.fundingUpdatedAgoS}s ago`);
}

const tx = (process.argv[2] ?? "0x432a26feb292abbfbd8612d4a3191cbdb5a64b1e2c54eb2f36c906aa60689c20") as `0x${string}`;
const rc = await pc.getTransactionReceipt({ hash: tx });
const settled: any[] = [];
for (const l of rc.logs) {
  try {
    const d: any = decodeEventLog({ abi: ev.marginBankEventsAbi, data: l.data, topics: l.topics as any });
    if (d.eventName === "FundingSettled") settled.push({ account: d.args.account.toLowerCase(), pool: d.args.perpPool.toLowerCase(), payment: d.args.payment.toString(), logIndex: l.logIndex });
  } catch {}
}
const fr = await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ FundingPayment(where:{txHash:{_eq:"${tx}"}}) { id account pool amount timestamp txHash } }` }) });
const indexed = ((await fr.json()) as any).data?.FundingPayment ?? [];
out.funding = { tx, onChain: settled, indexed };
console.log("FundingSettled on chain:", j(settled));
console.log("FundingPayment rows in indexer for that tx:", j(indexed));
writeFileSync(`evidence/probe16-indexer-oi-funding-${Date.now()}.json`, j(out));
process.exit(0);
