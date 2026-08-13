import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertProductionDualRpcProviders,
  boundedRpcExecutor,
  createProductionDualRpcProviders,
} from "../../lib/data-pipeline/rpc-providers.server";
import { productionMainnetRpcEnvironment } from
  "../../lib/onchain/website-rpc-providers.server";

const DRPC =
  "https://lb.drpc.live/ethereum/drpc-test-key";
const QUICKNODE =
  "https://programmable.ethereum-mainnet.quiknode.pro/quicknode-test-token/";
const rpcEnvironment = (primary = DRPC, secondary = QUICKNODE) =>
  productionMainnetRpcEnvironment(primary, secondary);

describe("production dual-RPC providers", () => {
  it("paces provider calls below the sustained request ceiling", async () => {
    vi.useFakeTimers();
    try {
      const execute = boundedRpcExecutor(20);
      const starts: number[] = [];
      const calls = Array.from({ length: 21 }, () =>
        execute(async () => {
          starts.push(Date.now());
        })
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(starts).toHaveLength(20);
      await vi.advanceTimersByTimeAsync(999);
      expect(starts).toHaveLength(20);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all(calls);
      expect(starts).toHaveLength(21);
      expect(starts[20]! - starts[0]!).toBeGreaterThanOrEqual(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("derives fixed independent identities from exact paid-provider URLs", () => {
    const providers = createProductionDualRpcProviders(rpcEnvironment());

    expect(providers[0].identity).toMatch(
      /^drpc-mainnet-[0-9a-f]{32}$/u,
    );
    expect(providers[1].identity).toMatch(
      /^quicknode-mainnet-[0-9a-f]{32}$/u,
    );
    expect(providers.map(({ vendorGroup }) => vendorGroup)).toEqual([
      "drpc",
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
    expect(JSON.stringify(providers)).not.toContain("drpc-test-key");
    expect(JSON.stringify(providers)).not.toContain("quicknode-test-token");
    expect(JSON.stringify(providers)).not.toContain(
      "programmable.ethereum-mainnet.quiknode.pro",
    );
  });

  it("fails closed when a production platform marker conflicts with NODE_ENV=test", () => {
    const providers = createProductionDualRpcProviders(rpcEnvironment());
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
    const providers = createProductionDualRpcProviders(rpcEnvironment());
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
      rpcEnvironment("https://eth-sepolia.drpc.org/drpc-test-key"),
      "wrong dRPC network",
    ],
    [
      rpcEnvironment(DRPC, "https://example.com/quicknode-test-token/"),
      "non-QuickNode secondary",
    ],
    [
      rpcEnvironment(`${DRPC}?leak=true`),
      "query-bearing endpoint",
    ],
    [
      rpcEnvironment(
        DRPC,
        "https://user:password@programmable.ethereum-mainnet.quiknode.pro/quicknode-test-token/",
      ),
      "embedded basic auth",
    ],
    [
      rpcEnvironment("http://lb.drpc.live/ethereum/drpc-test-key"),
      "non-TLS endpoint",
    ],
    [
      rpcEnvironment("https://lb.drpc.live/ethereum/docs-demo"),
      "public dRPC demo credential",
    ],
    [
      rpcEnvironment(
        DRPC,
        "https://docs-demo.ethereum-mainnet.quiknode.pro/docs-demo/",
      ),
      "public QuickNode demo credential",
    ],
    [
      {
        ...rpcEnvironment(),
        NEXT_PUBLIC_PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL: DRPC,
      },
      "browser-exposed dRPC endpoint",
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
