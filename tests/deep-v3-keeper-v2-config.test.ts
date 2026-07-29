import { describe, expect, it } from "vitest";

import {
  DEEP_V3_KEEPER_V2_CONTROL_PATH,
  DEEP_V3_KEEPER_V2_RELEASE,
  parseDeepV3KeeperV2Config,
} from "../ops/deep-keeper-v3/config-v2.mjs";

const address = (digit: string) =>
  `0x${digit.repeat(40)}` as `0x${string}`;
const hash = (digit: string) =>
  `0x${digit.repeat(64)}` as `0x${string}`;

function environment(overrides: Record<string, string> = {}) {
  return {
    DEEP_V3_KEEPER_ENABLED: "false",
    DEEP_V3_KEEPER_SEND_TRANSACTIONS: "false",
    DEEP_V3_KEEPER_V2_ENABLED: "true",
    DEEP_V3_KEEPER_V2_SEND_TRANSACTIONS: "true",
    DEEP_V3_KEEPER_V2_CHAIN_ID: "1",
    DEEP_V3_KEEPER_V2_RPC_URLS:
      "https://rpc-one.example,https://rpc-two.example",
    DEEP_V3_KEEPER_V2_AUTOMATION_ADDRESS: address("1"),
    DEEP_V3_KEEPER_V2_AUTOMATION_RUNTIME_HASH: hash("1"),
    DEEP_V3_KEEPER_V2_LAUNCHER_ADDRESS: address("2"),
    DEEP_V3_KEEPER_V2_LAUNCHER_RUNTIME_HASH: hash("2"),
    DEEP_V3_KEEPER_V2_VAULT_FACTORY_ADDRESS: address("3"),
    DEEP_V3_KEEPER_V2_VAULT_FACTORY_RUNTIME_HASH: hash("3"),
    DEEP_V3_KEEPER_V2_EXECUTOR_ADDRESS: address("4"),
    DEEP_V3_KEEPER_V2_EXECUTOR_RUNTIME_HASH: hash("4"),
    DEEP_V3_KEEPER_V2_SOURCE_COMMITMENT: hash("5"),
    DEEP_V3_KEEPER_V2_OPS_SOURCE_COMMITMENT: hash("6"),
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    DEEP_V3_KEEPER_V2_SIGNER_ADDRESS: address("7"),
    DEEP_V3_KEEPER_V2_PRIVY_WALLET_ID: "a".repeat(24),
    DEEP_V3_KEEPER_V2_MIN_GROWTH_TO_MAX_GAS_RATIO_BPS: "10000",
    DEEP_V3_KEEPER_V2_MAX_FEE_PER_GAS_WEI: "3000000000",
    DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_TICK:
      "50000000000000000",
    DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_DAY:
      "500000000000000000",
    DEEP_V3_KEEPER_V2_SIGNER_BALANCE_FLOOR_WEI:
      "10000000000000000",
    ...overrides,
  };
}

describe("Deep V3 keeper ops v2 configuration", () => {
  it("binds the isolated release, state path and one default signer lane", () => {
    const config = parseDeepV3KeeperV2Config(environment());

    expect(config.releaseVersion).toBe(DEEP_V3_KEEPER_V2_RELEASE);
    expect(config.controlPath).toBe(DEEP_V3_KEEPER_V2_CONTROL_PATH);
    expect(config.scanPageSize).toBe(32);
    expect(config.maxScanPages).toBe(2);
    expect(config.maxCandidatesPerBatch).toBe(4);
    expect(config.maxNewSubmissionsPerTick).toBe(1);
    expect(config.maxActivePendingBatches).toBe(8);
    expect(config.signerLanes).toEqual([
      expect.objectContaining({
        id: "lane-0",
        partitionId: "partition-0",
        partitionIndex: 0,
        partitionCount: 1,
        signerAddress: address("7"),
      }),
    ]);
  });

  it("fails closed when autonomous execution lacks any economic limit", () => {
    for (const key of [
      "DEEP_V3_KEEPER_V2_MIN_GROWTH_TO_MAX_GAS_RATIO_BPS",
      "DEEP_V3_KEEPER_V2_MAX_FEE_PER_GAS_WEI",
      "DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_TICK",
      "DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_DAY",
      "DEEP_V3_KEEPER_V2_SIGNER_BALANCE_FLOOR_WEI",
    ]) {
      expect(() =>
        parseDeepV3KeeperV2Config(
          environment({ [key]: "" }),
        ),
      ).toThrow(/enabled execution requires/i);
    }
  });

  it("requires an immutable deployment commit when enabled", () => {
    expect(() =>
      parseDeepV3KeeperV2Config(
        environment({ VERCEL_GIT_COMMIT_SHA: "" }),
      ),
    ).toThrow(/VERCEL_GIT_COMMIT_SHA/i);
  });

  it("rejects a configured commit that differs from the Vercel deployment", () => {
    expect(() =>
      parseDeepV3KeeperV2Config(
        environment({
          DEEP_V3_KEEPER_V2_DEPLOYMENT_COMMIT: "b".repeat(40),
        }),
      ),
    ).toThrow(/does not match VERCEL_GIT_COMMIT_SHA/i);
  });

  it("keeps disabled defaults inert without selecting a subsidy policy", () => {
    const config = parseDeepV3KeeperV2Config(
      environment({
        DEEP_V3_KEEPER_V2_ENABLED: "false",
        DEEP_V3_KEEPER_V2_SEND_TRANSACTIONS: "false",
        DEEP_V3_KEEPER_V2_MIN_GROWTH_TO_MAX_GAS_RATIO_BPS: "",
        DEEP_V3_KEEPER_V2_MAX_FEE_PER_GAS_WEI: "",
        DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_TICK: "",
        DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_DAY: "",
        DEEP_V3_KEEPER_V2_SIGNER_BALANCE_FLOOR_WEI: "",
        DEEP_V3_KEEPER_V2_SIGNER_ADDRESS: "",
        DEEP_V3_KEEPER_V2_PRIVY_WALLET_ID: "",
      }),
    );

    expect(config.enabled).toBe(false);
    expect(config.minGrowthToMaxGasRatioBps).toBe(0);
    expect(config.maxFeePerGasWei).toBe(0n);
    expect(config.maxTotalDebitWeiPerTick).toBe(0n);
    expect(config.maxTotalDebitWeiPerDay).toBe(0n);
    expect(config.signerBalanceFloorWei).toBe(0n);
  });

  it("refuses activation while the legacy writer is enabled", () => {
    expect(() =>
      parseDeepV3KeeperV2Config(
        environment({ DEEP_V3_KEEPER_ENABLED: "true" }),
      ),
    ).toThrow(/legacy Deep V3 writer/i);
  });

  it("rejects duplicate RPC providers and private-key escape hatches", () => {
    expect(() =>
      parseDeepV3KeeperV2Config(
        environment({
          DEEP_V3_KEEPER_V2_RPC_URLS:
            "https://same.example/a,https://same.example/b",
        }),
      ),
    ).toThrow(/independent HTTPS hosts/i);

    expect(() =>
      parseDeepV3KeeperV2Config(
        environment({ DEEP_V3_KEEPER_V2_PRIVATE_KEY: hash("9") }),
      ),
    ).toThrow(/remote policy wallet/i);
  });
});
