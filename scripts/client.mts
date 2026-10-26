// Shared read-only client for Somnia Tokyo (Hideki) testnet, chain 50383. No key.
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { defineChain } from "viem";

export const RPC = "https://api.hideki2.infra.testnet.somnia.network";
export const WS = "wss://api.hideki2.infra.testnet.somnia.network/ws";
export const INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";

export const chain = defineChain({
  id: 50383,
  name: "Somnia Tokyo testnet",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC], webSocket: [WS] } },
});

export const markets = new SomniaMarkets({ chain, wsRpcUrl: WS, indexerUrl: INDEXER } as any);
export const client: any = (markets as any).client;

export const j = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
