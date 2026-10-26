// Probe 12: OI vs maxOpenInterest, and every known holder's |size| vs maxPositionSize (from probe1 data).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { formatUnits } from "viem";
import { client, j } from "./client.mts";
const f = readdirSync("evidence").filter((x) => x.startsWith("probe1-")).sort().pop()!;
const p1 = JSON.parse(readFileSync(`evidence/${f}`, "utf8"));
const out: any = { source: f, rows: [] };
for (const m of p1.markets) {
  const rp: any = await client.getPerpRiskParams(m.pool);
  const st: any = await client.getPerpFeedStatus(m.pool).catch(() => null);
  const oi = BigInt(st?.openInterest ?? 0);
  const sides = p1.adl.filter((a: any) => a.base === m.base && a.holders);
  let maxAbs = 0n, over = 0, n = 0;
  for (const s of sides) for (const h of s.holders) {
    if (h.size == null) continue; n++;
    const a = BigInt(h.size) < 0n ? -BigInt(h.size) : BigInt(h.size);
    if (a > maxAbs) maxAbs = a;
    if (a > BigInt(rp.maxPositionSize)) over++;
  }
  const row = { base: m.base, dec: m.baseDecimals, oi: formatUnits(oi, m.baseDecimals), maxOI: formatUnits(BigInt(rp.maxOpenInterest), m.baseDecimals), oiOverCap: oi > BigInt(rp.maxOpenInterest),
    maxPos: formatUnits(BigInt(rp.maxPositionSize), m.baseDecimals), largestHolder: formatUnits(maxAbs, m.baseDecimals), holdersChecked: n, holdersOverPosCap: over };
  out.rows.push(row);
  console.log(`${m.base.padEnd(9)} OI ${row.oi} / cap ${row.maxOI} ${row.oiOverCap ? "OVER" : ""} | largest ${row.largestHolder} / posCap ${row.maxPos} | over ${over}/${n}`);
}
writeFileSync(`evidence/probe12-caps-${Date.now()}.json`, j(out));
process.exit(0);
