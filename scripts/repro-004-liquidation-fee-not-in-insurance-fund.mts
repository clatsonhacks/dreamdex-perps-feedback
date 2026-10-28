// Repro 004: the SDK documents the liquidation fee as routed "WHOLLY to an Insurance Fund tier", but on
// chain it is paid to MarginBank.getLiquidationFeeRecipient() — a separate address the contract forbids
// from being the Insurance Fund (error LiquidationFeeRecipientCannotBeInsuranceFund) — and the SDK
// exposes no way to find that address (getPerpSystemConfig omits it).
// Read-only. Exits 1 while the SDK text says "Insurance Fund" and the fees reach the recipient instead.
//
// Part A (all history): indexed LiquidationFee total vs the Insurance Fund's tier ledger and balances,
//   and the recipient's MarginBank balance.
// Part B (one tx, optional): recipient / fund / tier deltas at block-1 → block for a fee tx.
//   npx tsx scripts/repro-004-liquidation-fee-not-in-insurance-fund.mts <txHash>
//
// Run: npx tsx scripts/repro-004-liquidation-fee-not-in-insurance-fund.mts
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createPublicClient, http, formatUnits, parseAbi, decodeEventLog } from "viem";
import { chain, client, j, RPC, INDEXER } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const E = await import("../node_modules/@somnia-chain/markets-sdk/dist/contractErrorsAbi.js" as any);
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const cfg = await client.getPerpSystemConfig(BANK);
const IF = cfg.insuranceFund as `0x${string}`;
const fmt = (v: bigint) => formatUnits(v, 18);
const recipient = (await pc.readContract({ address: BANK, abi: parseAbi(["function getLiquidationFeeRecipient() view returns (address)"]), functionName: "getLiquidationFeeRecipient" })) as `0x${string}`;
const bankTotal = async (who: string, blockNumber?: bigint) => {
  const s: any = await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getAccountState", args: [who], blockNumber } as any);
  return s.unlockedCollateralBalance + s.lockedCollateral;
};

// ---- SDK claims
const historySrc = readFileSync(new URL("../node_modules/@somnia-chain/markets-sdk/src/perp/history.ts", import.meta.url), "utf8");
const sdk = {
  historyTsSaysWhollyToInsuranceFund: historySrc.includes("routed WHOLLY to an") && historySrc.includes("Insurance Fund tier"),
  getPerpSystemConfigKeys: Object.keys(cfg),
  getPerpSystemConfigExposesLiquidationFeeRecipient: Object.values(cfg).some((v) => typeof v === "string" && v.toLowerCase() === recipient.toLowerCase()),
  errorAbiHasLiquidationFeeRecipientCannotBeInsuranceFund: JSON.stringify(Object.values(E)).includes("LiquidationFeeRecipientCannotBeInsuranceFund"),
};

// ---- Part A
// Fee rows straight from the indexer in a stable order (by id). Paging client.listPerpFees() is not
// stable (it orders by timestamp only, see 007) and drops/repeats rows that share a timestamp.
const fees: any[] = [];
for (let offset = 0; ; offset += 1000) {
  const r = (await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: `{ PerpFeeRecord(where:{kind:{_eq:"LiquidationFee"}}, order_by:{id:asc}, limit:1000, offset:${offset}) { id amount timestamp txHash } }` }) })).json()) as any;
  fees.push(...r.data.PerpFeeRecord);
  if (r.data.PerpFeeRecord.length < 1000) break;
}
fees.sort((a, b) => Number(BigInt(b.timestamp) - BigInt(a.timestamp)));
const feeTotal = fees.reduce((t, r) => t + BigInt(r.amount), 0n);
const ledger: any[] = [];
for (let offset = 0; ; offset += 500) {
  const page = (await client.listPerpInsuranceFundEvents({ limit: 500, offset })) as any[];
  ledger.push(...page);
  if (page.length < 500) break;
}
const kinds: Record<string, number> = {};
const replay: Record<string, bigint> = {};
const add = (t: string | null, v: bigint) => { if (t != null) replay[t] = (replay[t] ?? 0n) + v; };
for (const r of ledger) {
  kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  const a = BigInt(r.amount ?? "0");
  if (["TierFunded", "TierFundedFromSource", "TierCredited"].includes(r.kind)) add(r.tier, a);
  else if (["TierDebited", "TierWithdrawn", "TierWithdrawnToTreasury"].includes(r.kind)) add(r.tier, -a);
  else if (r.kind === "TierAllocated") { add(r.tier, -a); add(r.toTier, a); }
}
const state = await client.getInsuranceFundState(IF);
const chainEqualsTopUps = state.tiers.every((t: any) => t.balance === (replay[String(t.tier)] ?? 0n));
const partA = {
  liquidationFeeRows: fees.length, liquidationFeeTotal: fmt(feeTotal), oldest: fees.at(-1)?.timestamp, newest: fees[0]?.timestamp,
  insuranceFund: { address: IF, ledgerKinds: kinds, totalTierBalances: fmt(state.totalBalance), bankAccount: fmt(await bankTotal(IF)), tiersEqualTopUpsMinusWithdrawals: chainEqualsTopUps },
  liquidationFeeRecipient: { address: recipient, isInsuranceFund: recipient.toLowerCase() === IF.toLowerCase(), bankAccount: fmt(await bankTotal(recipient)) },
};
console.log(j({ sdk, partA }));

// ---- Part B
let partB: any = null;
const tx = process.argv[2] as `0x${string}` | undefined;
if (tx) {
  const rc = await pc.getTransactionReceipt({ hash: tx });
  const b = rc.blockNumber;
  const all = Object.values(ev).filter(Array.isArray).flat() as any[];
  let fee = 0n, reward = 0n;
  for (const l of rc.logs) { try { const d: any = decodeEventLog({ abi: all, data: l.data, topics: l.topics as any }); if (d.eventName === "LiquidationFeeCharged") fee += d.args.amount; if (d.eventName === "LiquidationKeeperRewardPaid") reward += d.args.amount; } catch {} }
  const tierAt = async (blockNumber: bigint) => Promise.all(state.tiers.map(async (t: any) => fmt((await pc.readContract({ address: IF, abi: R.insuranceFundReadAbi, functionName: "getTierBalance", args: [BigInt(t.tier)], blockNumber })) as bigint)));
  const recDelta = (await bankTotal(recipient, b)) - (await bankTotal(recipient, b - 1n));
  partB = {
    tx, block: b, feeCharged: fmt(fee), keeperReward: fmt(reward),
    recipientDelta: fmt(recDelta), recipientDeltaEqualsFeeMinusReward: recDelta === fee - reward,
    insuranceFundBankDelta: fmt((await bankTotal(IF, b)) - (await bankTotal(IF, b - 1n))),
    tiersBefore: await tierAt(b - 1n), tiersAfter: await tierAt(b),
  };
  console.log(j({ partB }));
}

mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/004-liquidation-fee-routing-${Date.now()}.json`, j({ at: new Date().toISOString(), sdk, partA, partB }));
const bug = sdk.historyTsSaysWhollyToInsuranceFund && feeTotal > 0n && chainEqualsTopUps && !kinds.TierCredited && !partA.liquidationFeeRecipient.isInsuranceFund;
console.log(bug
  ? `FAIL: the SDK says liquidation fees go wholly to an Insurance Fund tier, but ${fmt(feeTotal)} USDso of them (${fees.length} rows) went to the liquidation fee recipient ${recipient} (bank balance ${partA.liquidationFeeRecipient.bankAccount}); the fund's tiers still equal their top-ups and getPerpSystemConfig does not expose the recipient: ${!sdk.getPerpSystemConfigExposesLiquidationFeeRecipient}`
  : "PASS");
process.exit(bug ? 1 : 0);
