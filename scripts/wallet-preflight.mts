// Read-only pre-flight for the wallet test. Sends nothing.
// Prints: address, STT, wallet USDso, allowance to the MarginBank, MarginBank account,
// voucher/credit state (Arena paper USDso => STOP), and what a tiny far-from-mark order would pull.
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { chain, RPC } from "./client.mts";
import { address, client, trader } from "./wallet.mts";

const pc = createPublicClient({ chain, transport: http(RPC) });
const BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72" as const;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const R = await import("../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js" as any);
const f = (v: bigint) => formatUnits(v, 18);

console.log("address", address);
console.log("STT", f(await pc.getBalance({ address })));
console.log("wallet USDso", f(await pc.readContract({ address: USDSO, abi: erc20, functionName: "balanceOf", args: [address] })));
console.log("allowance -> MarginBank", f(await pc.readContract({ address: USDSO, abi: erc20, functionName: "allowance", args: [address, BANK] })));
const acct = await client.getMarginAccount(BANK, address);
console.log("MarginBank account", { unlocked: f(BigInt(acct.unlockedCollateralBalance)), locked: f(BigInt(acct.lockedCollateral)), pools: acct.activePerpPools.length, status: acct.marginStatus });
const creditFloor = (await pc.readContract({ address: BANK, abi: R.marginBankReadAbi, functionName: "getCreditFloor", args: [address] })) as bigint;
console.log("voucher creditFloor", f(creditFloor));
const arena = creditFloor > 0n;
console.log(arena ? "STOP: this account holds Arena paper USDso. Do not use it for the bounty test." : "OK: no Arena paper USDso on this account.");
console.log("trader available:", Boolean(trader));

// What a tiny bid at ~50% of mark would need, sized by the SDK itself, with auto-pull.
const mkts = (await client.listPerpMarkets()) as any[];
const m = mkts.find((x) => x.baseSymbol === (process.argv[2] ?? "XRP"))!;
const st: any = await client.getPerpState(m.poolAddress);
const tick = BigInt(m.tickSize), lot = BigInt(m.lotSize), minQ = BigInt(m.minQuantity);
const price = ((st.markPrice / 2n) / tick) * tick;
const quantity = minQ % lot === 0n ? minQ : (minQ / lot + 1n) * lot;
console.log("plan", { market: `${m.baseSymbol}-PERP`, pool: m.poolAddress, mark: f(st.markPrice), price: f(price), quantity: formatUnits(quantity, m.baseDecimals), notional: f((price * quantity) / 10n ** BigInt(m.baseDecimals)) });
const pv = await client.previewPerpOrderMargin({ pool: m.poolAddress, marginBank: BANK, account: address, isBid: true, price, quantity, autoPull: true });
console.log("previewPerpOrderMargin(autoPull)", JSON.stringify(pv, (_k, v) => (typeof v === "bigint" ? f(v) : v)));
process.exit(0);
