// Probe 22: after the 10-26..10-29 indexer change, are the rows our own transactions produced still there and unchanged?
import { client, INDEXER, j } from "./client.mts";
const M = "0xE488bb2bd58E9C425F525293856FAA529f7b1db3", C = "0x7400346f9492cf6Ac73c13A3B2D0b864b0F5080d";
const q = async (query: string) => ((await (await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).json()) as any);
console.log("head", j(await q("{ chain_metadata { latest_processed_block start_block first_event_block_number num_events_processed is_hyper_sync latest_fetched_block_number block_height } }")));
console.log("main pulls", j(await client.listPerpMarginPulls({ account: M })));
console.log("child pulls", j(await client.listPerpMarginPulls({ account: C })));
console.log("child funding", j(await client.listPerpMainFundingEvents({ account: C })));
console.log("link events", j(await client.listPerpWalletLinkEvents({ child: C })));
const kinds = ["LiquidationFee", "Trade", "Taker", "Maker"];
for (const k of kinds) { try { const r = await client.listPerpFees({ kind: k, limit: 3 }); console.log("fees", k, r.length, j(r.map((x: any) => ({ amt: x.amount, ip: x.insurancePortion, tier: x.tier, ts: x.timestamp })))); } catch (e: any) { console.log("fees", k, "ERR", e.message?.slice(0, 120)); } }
process.exit(0);
