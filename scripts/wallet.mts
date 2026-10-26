// Signing client for the bounty test wallet. The key is read from .env (git-ignored) and is
// never printed or written anywhere; only the derived address is.
import { readFileSync } from "node:fs";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, RPC, WS, INDEXER } from "./client.mts";

const line = readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("PRIVATE_KEY="));
const raw = line?.slice("PRIVATE_KEY=".length).trim().replace(/^["']|["']$/g, "") ?? "";
const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("PRIVATE_KEY in .env is not a 32-byte hex key");

const account = privateKeyToAccount(pk);
export const address = account.address;
export const walletClient = createWalletClient({ account, chain, transport: http(RPC) });
export const markets = new SomniaMarkets({ chain, wsRpcUrl: WS, indexerUrl: INDEXER, privateKey: pk } as any);
export const client: any = (markets as any).client;
export const trader: any = (markets as any).trader;
