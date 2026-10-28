// Repro 004: liquidation fees are charged to traders and the SDK documents them as routed "WHOLLY
// to an Insurance Fund tier", but no Insurance Fund tier (nor the fund's MarginBank account) ever
// receives them. Read-only. Exits 1 while fees > 0 and the fund's balances equal its top-ups.
// Prints both what was charged in each tier's markets and what the indexer books as insurancePortion.
//
// Part A (all history): sum of LiquidationFee rows vs the fund's tier ledger replay vs chain.
// Part B (one tx, optional): pass a fee txHash and the liquidated account to reconcile balances
//   at block-1 / block:  npx tsx scripts/repro-004-liquidation-fee-not-in-insurance-fund.mts <txHash> <account>
//
// Run: npx tsx scripts/repro-004-liquidation-fee-not-in-insurance-fund.mts
import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, formatUnits } from "viem";
import { chain, client, j, RPC } from "./client.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const cfg = await client.getPerpSystemConfig(BANK);
const IF = cfg.insuranceFund as `0x${string}`;
const fmt = (v: bigint) => formatUnits(v, 18);

// ---- Part A
const fees: any[] = [];
for (let offset = 0; ; offset += 500) {
  const page = (await client.listPerpFees({ kind: "LiquidationFee", limit: 500, offset })) as any[];
  fees.push(...page);
  if (page.length < 500) break;
}
const feeTotal = fees.reduce((t, r) => t + BigInt(r.amount), 0n);
const feeByTier: Record<string, bigint> = {};
const insurancePortionByTier: Record<string, bigint> = {};
for (const r of fees) {
  feeByTier[r.tier] = (feeByTier[r.tier] ?? 0n) + BigInt(r.amount);
  insurancePortionByTier[r.tier] = (insurancePortionByTier[r.tier] ?? 0n) + BigInt(r.insurancePortion ?? "0");
}

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
const ifAccount = await client.getMarginAccount(BANK, IF);
const tiers = state.tiers.map((t: any) => ({
  tier: t.tier, chainBalance: fmt(t.balance), ledgerReplay: fmt(replay[String(t.tier)] ?? 0n),
  liquidationFeesChargedInTier: fmt(feeByTier[String(t.tier)] ?? 0n),
  indexedInsurancePortion: fmt(insurancePortionByTier[String(t.tier)] ?? 0n), pools: t.poolCount,
}));
const partA = {
  liquidationFeeRows: fees.length, liquidationFeeTotal: fmt(feeTotal),
  oldest: fees.at(-1)?.timestamp, newest: fees[0]?.timestamp,
  insuranceLedgerKinds: kinds, totalTierBalances: fmt(state.totalBalance),
  insuranceFundBankAccount: fmt(BigInt(ifAccount.unlockedCollateralBalance) + BigInt(ifAccount.lockedCollateral)),
  tiers,
};
console.log(j(partA));
const chainEqualsTopUps = state.tiers.every((t: any) => t.balance === (replay[String(t.tier)] ?? 0n));

// ---- Part B
let partB: any = null;
const [tx, account] = process.argv.slice(2) as [`0x${string}`?, `0x${string}`?];
if (tx && account) {
  const rc = await pc.getTransactionReceipt({ hash: tx });
  const b = rc.blockNumber;
  const total = async (who: string, blockNumber: bigint) => {
    const s: any = await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getAccountState", args: [who], blockNumber });
    return s.unlockedCollateralBalance + s.lockedCollateral;
  };
  const tierAt = async (blockNumber: bigint) => {
    const out: string[] = [];
    for (const t of state.tiers) out.push(fmt((await pc.readContract({ address: IF, abi: R.insuranceFundReadAbi, functionName: "getTierBalance", args: [BigInt(t.tier)], blockNumber })) as bigint));
    return out;
  };
  partB = {
    tx, block: b,
    feeRow: fees.find((r) => r.txHash === tx) ?? null,
    accountDelta: fmt((await total(account, b)) - (await total(account, b - 1n))),
    insuranceFundBankAccountDelta: fmt((await total(IF, b)) - (await total(IF, b - 1n))),
    tiersBefore: await tierAt(b - 1n), tiersAfter: await tierAt(b),
  };
  console.log(j(partB));
}

mkdirSync("evidence", { recursive: true });
writeFileSync(`evidence/004-liquidation-fee-insurance-${Date.now()}.json`, j({ at: new Date().toISOString(), insuranceFund: IF, partA, partB }));

const bug = feeTotal > 0n && chainEqualsTopUps && !kinds.TierCredited;
console.log(bug
  ? `FAIL: ${fmt(feeTotal)} USDso of liquidation fees (${fees.length} rows) charged in tiered markets; every Insurance Fund tier still equals its top-ups minus withdrawals, and the ledger has no TierCredited row`
  : "PASS");
process.exit(bug ? 1 : 0);
