import { describe, expect, it } from "vitest";

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import {
  WEBSITE_MAINNET_RPC_ENV,
  websiteMainnetRpcPair,
} from "../lib/onchain/website-rpc-providers.server";

const ALCHEMY_URL =
  "https://eth-mainnet.g.alchemy.com/v2/alchemy-test-key";
const DRPC_URL = "https://lb.drpc.live/ethereum/drpc-test-key";
const QUICKNODE_URL =
  "https://programmable-mainnet.quiknode.pro/quicknode-test-key/";
const MULTI_LABEL_QUICKNODE_URL =
  "https://programmable.base-mainnet.quiknode.pro/quicknode-test-key/";

function environment(input?: Readonly<{
  primaryProvider?: string;
  primaryUrl?: string;
  primaryCommitment?: string;
  secondaryProvider?: string;
  secondaryUrl?: string;
  secondaryCommitment?: string;
}>) {
  return {
    [WEBSITE_MAINNET_RPC_ENV.primaryProvider]:
      input?.primaryProvider ?? "drpc",
    [WEBSITE_MAINNET_RPC_ENV.primaryUrl]:
      input?.primaryUrl ?? DRPC_URL,
    [WEBSITE_MAINNET_RPC_ENV.primaryCommitment]:
      input?.primaryCommitment ??
      rpcProviderCommitment("endpoint", input?.primaryUrl ?? DRPC_URL),
    [WEBSITE_MAINNET_RPC_ENV.secondaryProvider]:
      input?.secondaryProvider ?? "quicknode",
    [WEBSITE_MAINNET_RPC_ENV.secondaryUrl]:
      input?.secondaryUrl ?? QUICKNODE_URL,
    [WEBSITE_MAINNET_RPC_ENV.secondaryCommitment]:
      input?.secondaryCommitment ??
      rpcProviderCommitment(
        "endpoint",
        input?.secondaryUrl ?? QUICKNODE_URL,
      ),
  };
}

describe("Website Mainnet RPC provider bindings", () => {
  it("binds a dRPC primary and QuickNode secondary by explicit roles", () => {
    expect(websiteMainnetRpcPair(environment())).toEqual({
      source: "role-bound-v1",
      primary: {
        provider: "drpc",
        url: DRPC_URL,
        endpointCommitment: rpcProviderCommitment("endpoint", DRPC_URL),
      },
      secondary: {
        provider: "quicknode",
        url: QUICKNODE_URL,
        endpointCommitment:
          rpcProviderCommitment("endpoint", QUICKNODE_URL),
      },
    });
  });

  it("keeps provider roles interchangeable across the reviewed vendors", () => {
    const selected = websiteMainnetRpcPair(environment({
      primaryProvider: "quicknode",
      primaryUrl: QUICKNODE_URL,
      secondaryProvider: "alchemy",
      secondaryUrl: ALCHEMY_URL,
    }));

    expect(selected).toMatchObject({
      source: "role-bound-v1",
      primary: { provider: "quicknode", url: QUICKNODE_URL },
      secondary: { provider: "alchemy", url: ALCHEMY_URL },
    });
  });

  it("accepts commitment-bound QuickNode endpoints with valid subdomains", () => {
    const selected = websiteMainnetRpcPair(environment({
      secondaryProvider: "quicknode",
      secondaryUrl: MULTI_LABEL_QUICKNODE_URL,
    }));

    expect(selected.secondary).toEqual({
      provider: "quicknode",
      url: MULTI_LABEL_QUICKNODE_URL,
      endpointCommitment:
        rpcProviderCommitment("endpoint", MULTI_LABEL_QUICKNODE_URL),
    });
  });

  it("ignores legacy bindings only after a complete role-bound pair is valid", () => {
    const selected = websiteMainnetRpcPair({
      ...environment(),
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_URL,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", ALCHEMY_URL),
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", QUICKNODE_URL),
    });

    expect(selected.source).toBe("role-bound-v1");
    expect(selected.primary.provider).toBe("drpc");
  });

  it("fails closed on partial role configuration", () => {
    expect(() => websiteMainnetRpcPair({
      PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER: "drpc",
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_URL,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
    })).toThrow("Website secondary RPC provider binding is invalid");
  });

  it("rejects unknown providers, provider-host drift and public fallbacks", () => {
    expect(() => websiteMainnetRpcPair(environment({
      primaryProvider: "generic",
    }))).toThrow("Website primary RPC provider binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      primaryProvider: "drpc",
      primaryUrl: ALCHEMY_URL,
    }))).toThrow("Website primary RPC binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      primaryProvider: "drpc",
      primaryUrl: "https://eth.drpc.org/",
    }))).toThrow("Website primary RPC binding is invalid");
    for (const secondaryUrl of [
      "https://quiknode.pro/quicknode-test-key/",
      "https://programmable.quiknode.pro.evil.example/quicknode-test-key/",
      "https://evilquiknode.pro/quicknode-test-key/",
    ]) {
      expect(() => websiteMainnetRpcPair(environment({
        secondaryProvider: "quicknode",
        secondaryUrl,
      }))).toThrow("Website secondary RPC binding is invalid");
    }
  });

  it("requires independent vendor identities, not only distinct URLs", () => {
    const secondary =
      "https://lb.drpc.live/ethereum/second-drpc-test-key";
    expect(() => websiteMainnetRpcPair(environment({
      secondaryProvider: "drpc",
      secondaryUrl: secondary,
    }))).toThrow("Website RPC providers are not independent");
  });

  it("rejects endpoint drift without retaining credentials in errors", () => {
    const candidate = environment({
      primaryCommitment: `0x${"ab".repeat(32)}`,
    });
    const error = (() => {
      try {
        websiteMainnetRpcPair(candidate);
      } catch (value) {
        return value;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Website primary RPC endpoint commitment mismatch",
    );
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("drpc-test-key");
    expect(serialized).not.toContain("quicknode-test-key");
  });
});
