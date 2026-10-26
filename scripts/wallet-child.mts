// Signing client for the CHILD test wallet of the linked-wallet test. The key is read from
// .env (git-ignored, CHILD_PRIVATE_KEY) and is never printed or written anywhere.
import { readFileSync } from "node:fs";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, RPC, WS, INDEXER } from "./client.mts";

const line = readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("CHILD_PRIVATE_KEY="));
const pk = (line?.slice("CHILD_PRIVATE_KEY=".length).trim() ?? "") as `0x${string}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("CHILD_PRIVATE_KEY in .env is not a 32-byte hex key");

const account = privateKeyToAccount(pk);
export const childAddress = account.address;
export const childWallet = createWalletClient({ account, chain, transport: http(RPC) });
export const childMarkets = new SomniaMarkets({ chain, wsRpcUrl: WS, indexerUrl: INDEXER, privateKey: pk } as any);
export const childTrader: any = (childMarkets as any).trader;
