// Probe 7: insurance fund — chain state vs the documented invariants, and the indexed ledger vs its documented rules.
import { writeFileSync } from "node:fs";
import { client, j } from "./client.mts";
const out: any = { at: new Date().toISOString() };
const cfg = await client.getPerpSystemConfig("0x478769E1177C0773c43A593DCCc4Ad15F15F1394");
const st = await client.getInsuranceFundState(cfg.insuranceFund);
out.state = st;
const sum = st.tiers.reduce((t: bigint, x: any) => t + x.balance, 0n);
console.log("maxTiers", st.maxTiers, "total", st.totalBalance, "sum tiers", sum, "equal", sum === st.totalBalance);
console.log("tiers", st.tiers.map((t: any) => `${t.tier}:${t.balance / 10n ** 18n}/${t.poolCount}p`).join(" "));
const eng = await client.getLiquidationEngineConfig(cfg.liquidationEngine);
out.engine = eng; console.log("engine", j(eng).replace(/\s+/g, " "));

const all: any[] = [];
for (let off = 0; off < 5000; off += 500) {
  const page = await client.listPerpInsuranceFundEvents({ limit: 500, offset: off });
  all.push(...page); if (page.length < 500) break;
}
out.eventCount = all.length;
const kinds: any = {}; for (const r of all) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
console.log("ledger rows", all.length, kinds);
// Rule: covered on BadDebtAuthorised == sum of TierDebited in the same tx.
const byTx: Record<string, any[]> = {};
for (const r of all) (byTx[r.txHash] ??= []).push(r);
const checks: any[] = [];
for (const r of all.filter((x) => x.kind === "BadDebtAuthorised")) {
  const debited = byTx[r.txHash].filter((x) => x.kind === "TierDebited").reduce((t, x) => t + BigInt(x.amount ?? "0"), 0n);
  checks.push({ tx: r.txHash, account: r.account, requested: r.requested, covered: r.covered, debitedSameTx: debited.toString(), match: BigInt(r.covered ?? "0") === debited });
}
out.coveredChecks = checks;
console.log("BadDebtAuthorised", checks.length, "covered==sum(TierDebited same tx):", checks.filter((c) => c.match).length, "mismatch:", checks.filter((c) => !c.match).length);
for (const c of checks.filter((c) => !c.match).slice(0, 5)) console.log(j(c).replace(/\s+/g, " "));
// Ledger replay per tier vs chain balance (inflow +, outflow -, allocation moves).
const net: Record<string, bigint> = {};
const add = (t: string | null, v: bigint) => { if (t == null) return; net[t] = (net[t] ?? 0n) + v; };
for (const r of all) {
  const a = BigInt(r.amount ?? "0");
  if (["TierFunded", "TierFundedFromSource", "TierCredited"].includes(r.kind)) add(r.tier, a);
  else if (["TierDebited", "TierWithdrawn", "TierWithdrawnToTreasury"].includes(r.kind)) add(r.tier, -a);
  else if (r.kind === "TierAllocated") { add(r.tier, -a); add(r.toTier, a); }
}
out.replay = Object.fromEntries(Object.entries(net).map(([k, v]) => [k, v.toString()]));
for (const t of st.tiers) console.log(`tier ${t.tier}: chain ${t.balance} replay ${net[String(t.tier)] ?? 0n} diff ${t.balance - (net[String(t.tier)] ?? 0n)}`);
writeFileSync(`evidence/probe7-insurance-${Date.now()}.json`, j(out));
process.exit(0);
