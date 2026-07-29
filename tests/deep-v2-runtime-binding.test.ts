import { describe, expect, it } from "vitest";
import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  assertDeepV2KeeperRuntimeBinding,
  requireIndependentDeepV2RpcUrls,
  type DeepV2RuntimeBindingClient,
} from "../lib/deep-v2-runtime-binding";

const launcher = getAddress(
  "0x1000000000000000000000000000000000000001",
);
const automation = getAddress(
  "0x1000000000000000000000000000000000000002",
);
const keeperExecutor = getAddress(
  "0x1000000000000000000000000000000000000003",
);
const runtimeCode = "0x6000" as Hex;
const runtimeCodeHash = keccak256(runtimeCode);
const snapshotHash = `0x${"11".repeat(32)}` as Hex;

const release = {
  launcher,
  automation,
  keeperExecutor,
  deploymentBlock: 100,
  keeperExecutorDeploymentBlock: 101,
  keeperExecutorRuntimeCodeHash: runtimeCodeHash,
  runtimeCodeHashes: {
    automation: runtimeCodeHash,
  },
};

function client(
  overrides: Partial<DeepV2RuntimeBindingClient> = {},
): DeepV2RuntimeBindingClient {
  return {
    getChainId: async () => 1,
    getFinalizedBlock: async () => ({
      number: 500n,
      hash: snapshotHash,
    }),
    getBlock: async ({ blockNumber }) => ({
      number: blockNumber,
      hash: snapshotHash,
    }),
    getCode: async () => runtimeCode,
    readKeeperAutomation: async () => automation,
    readAutomationLauncher: async () => launcher,
    readLauncherAutomation: async () => automation,
    ...overrides,
  };
}

describe("Deep V2 launch runtime binding", () => {
  it("pins the executor and automation topology to one finalized two-RPC snapshot", async () => {
    const result = await assertDeepV2KeeperRuntimeBinding({
      clients: [client(), client()],
      chainId: 1,
      release,
    });

    expect(result).toEqual({
      blockNumber: 500n,
      blockHash: snapshotHash,
    });
  });

  it("rejects an executor runtime that differs from the reviewed release", async () => {
    const changedCode = "0x6001" as Hex;
    const changed = client({
      getCode: async ({ address }) =>
        address === keeperExecutor ? changedCode : runtimeCode,
    });

    await expect(
      assertDeepV2KeeperRuntimeBinding({
        clients: [changed, changed],
        chainId: 1,
        release,
      }),
    ).rejects.toThrow("keeper executor runtime");
  });

  it("rejects an executor bound to another automation contract", async () => {
    const otherAutomation =
      "0x2000000000000000000000000000000000000002" as Address;
    const changed = client({
      readKeeperAutomation: async () => otherAutomation,
    });

    await expect(
      assertDeepV2KeeperRuntimeBinding({
        clients: [changed, changed],
        chainId: 1,
        release,
      }),
    ).rejects.toThrow("keeper executor automation binding");
  });

  it("rejects RPCs that disagree on the finalized canonical block", async () => {
    const otherHash = `0x${"22".repeat(32)}` as Hex;

    await expect(
      assertDeepV2KeeperRuntimeBinding({
        clients: [
          client(),
          client({
            getBlock: async ({ blockNumber }) => ({
              number: blockNumber,
              hash: otherHash,
            }),
          }),
        ],
        chainId: 1,
        release,
      }),
    ).rejects.toThrow("finalized block");
  });

  it("requires two distinct HTTPS RPC provider hosts", () => {
    expect(
      requireIndependentDeepV2RpcUrls(
        "https://rpc-a.example/project",
        "https://rpc-b.example/project",
      ),
    ).toEqual([
      "https://rpc-a.example/project",
      "https://rpc-b.example/project",
    ]);
    expect(() =>
      requireIndependentDeepV2RpcUrls(
        "https://rpc-a.example/project-a",
        "https://rpc-a.example/project-b",
      ),
    ).toThrow("independent");
    expect(() =>
      requireIndependentDeepV2RpcUrls(
        "https://rpc-a.example/project",
        undefined,
      ),
    ).toThrow("two");
  });
});
