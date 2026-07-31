import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertProductionDualRpcProviders,
  createProductionDualRpcProviders,
} from "../../lib/data-pipeline/rpc-providers.server";

const ALCHEMY =
  "https://eth-mainnet.g.alchemy.com/v2/alchemy-test-key";
const QUICKNODE =
  "https://programmable.ethereum.quiknode.pro/quicknode-test-token/";

describe("production dual-RPC providers", () => {
  it("derives fixed independent identities from exact paid-provider URLs", () => {
    const providers = createProductionDualRpcProviders({
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
    });

    expect(providers[0].identity).toMatch(
      /^alchemy-mainnet-[0-9a-f]{32}$/u,
    );
    expect(providers[1].identity).toMatch(
      /^quicknode-mainnet-[0-9a-f]{32}$/u,
    );
    expect(providers.map(({ vendorGroup }) => vendorGroup)).toEqual([
      "alchemy",
      "quicknode",
    ]);
    expect(providers[0].client).not.toBe(providers[1].client);
    expect(providers[0].endpointCommitment).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(providers[1].endpointCommitment).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(providers[0].endpointCommitment).not.toBe(
      providers[1].endpointCommitment,
    );
    expect(providers[0].endpointOriginCommitment).toMatch(
      /^0x[0-9a-f]{64}$/u,
    );
    expect(providers[1].endpointOriginCommitment).toMatch(
      /^0x[0-9a-f]{64}$/u,
    );
    expect(Object.isFrozen(providers)).toBe(true);
    expect(Object.isFrozen(providers[0])).toBe(true);
    expect(Object.isFrozen(providers[0].client)).toBe(true);
    expect(Object.isFrozen(providers[1].client)).toBe(true);
    expect(() =>
      Object.defineProperty(providers[0].client, "getChainId", {
        value: async () => 11155111,
      }),
    ).toThrow(TypeError);
    expect(JSON.stringify(providers)).not.toContain("alchemy-test-key");
    expect(JSON.stringify(providers)).not.toContain("quicknode-test-token");
    expect(JSON.stringify(providers)).not.toContain(
      "programmable.ethereum.quiknode.pro",
    );
  });

  it("fails closed when a production platform marker conflicts with NODE_ENV=test", () => {
    const providers = createProductionDualRpcProviders({
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
    });
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "production");
    try {
      expect(() => assertProductionDualRpcProviders(providers)).not.toThrow();
      expect(() =>
        assertProductionDualRpcProviders([
          { ...providers[0] },
          { ...providers[1] },
        ]),
      ).toThrowError(
        expect.objectContaining({
          dependency: "rpc",
          code: "invalid_input",
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects a structurally identical but unregistered pair in production", () => {
    const providers = createProductionDualRpcProviders({
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
    });
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => assertProductionDualRpcProviders(providers)).not.toThrow();
      expect(() =>
        assertProductionDualRpcProviders([
          { ...providers[0] },
          { ...providers[1] },
        ]),
      ).toThrowError(
        expect.objectContaining({
          dependency: "rpc",
          code: "invalid_input",
        }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    [{}, "missing URLs"],
    [
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
          "https://eth-sepolia.g.alchemy.com/v2/alchemy-test-key",
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
      },
      "wrong Alchemy network",
    ],
    [
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
          "https://example.com/quicknode-test-token/",
      },
      "non-QuickNode secondary",
    ],
    [
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: `${ALCHEMY}?leak=true`,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
      },
      "query-bearing endpoint",
    ],
    [
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
          "https://user:password@programmable.ethereum.quiknode.pro/quicknode-test-token/",
      },
      "embedded basic auth",
    ],
    [
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
          "http://eth-mainnet.g.alchemy.com/v2/alchemy-test-key",
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
      },
      "non-TLS endpoint",
    ],
    [
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL:
          "https://eth-mainnet.g.alchemy.com/v2/docs-demo",
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
      },
      "public Alchemy demo credential",
    ],
    [
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL:
          "https://docs-demo.quiknode.pro/docs-demo/",
      },
      "public QuickNode demo credential",
    ],
    [
      {
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
        PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE,
        NEXT_PUBLIC_PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY,
      },
      "browser-exposed Alchemy endpoint",
    ],
  ] as const)("rejects %s (%s)", (environment, label) => {
    expect(label.length).toBeGreaterThan(0);
    expect(() => createProductionDualRpcProviders(environment)).toThrowError(
      expect.objectContaining({
        dependency: "config",
        code: "invalid_input",
      }),
    );
  });
});
