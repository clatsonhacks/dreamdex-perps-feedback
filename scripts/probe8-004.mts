// Probe 8: decode every log of one liquidation-fee tx with the SDK's own event ABIs, and read
// the InsuranceFund's MarginBank account. Read-only.
import { writeFileSync } from "node:fs";
import { createPublicClient, http, decodeEventLog, formatUnits, parseAbi } from "viem";
import { chain, j, RPC, client } from "./client.mts";
const pc = createPublicClient({ chain, transport: http(RPC) });
const ev = await import("../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js" as any);
const abis = Object.entries(ev).filter(([, v]) => Array.isArray(v)) as [string, any[]][];
const erc20 = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const tx = process.argv[2] as `0x${string}`;
const rc = await pc.getTransactionReceipt({ hash: tx });
const out: any = { tx, block: rc.blockNumber, logs: [] };
for (const l of rc.logs) {
  let dec: any = null;
  for (const [name, abi] of [["erc20", erc20] as [string, any], ...abis]) {
    try { const d = decodeEventLog({ abi, data: l.data, topics: l.topics as any }); dec = { abi: name, event: d.eventName, args: d.args }; break; } catch {}
  }
  out.logs.push({ address: l.address, logIndex: l.logIndex, topic0: l.topics[0], decoded: dec });
  console.log(l.logIndex, l.address.slice(0, 10), dec ? `${dec.event} ${j(dec.args).replace(/\s+/g, " ").slice(0, 260)}` : `UNDECODED ${l.topics[0]}`);
}
const IF = "0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80";
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
try { const acct = await client.getMarginAccount(BANK, IF); out.ifBankAccount = acct; console.log("IF MarginBank account:", j(acct).replace(/\s+/g, " ").slice(0, 400)); } catch (e: any) { console.log("getMarginAccount(IF) failed", e?.message?.slice(0, 200)); }
writeFileSync(`evidence/probe8-liqfee-tx-${Date.now()}.json`, j(out));
process.exit(0);
