import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import {
  parseDeepV3KeeperV2Config,
} from "../ops/deep-keeper-v3/config-v2.mjs";
import {
  evaluateDeepV3KeeperV2ReleaseGate,
} from "../ops/deep-keeper-v3/release-gate-v2.mjs";
import { computeDeepV3OpsV2SourceCommitment } from "../ops/deep-keeper-v3/source-commitment-v2.mjs";
import { buildDeepV3OpsV2Promotion } from "../contracts/scripts/deep-v3-ops-v2-promotion-core.mjs";
import pendingBinding from "../ops/deep-keeper-v3/reviewed-ops-v2-binding.json";
import {
  DEEP_V3_TEST_ADDRESSES,
  DEEP_V3_TEST_CREATOR,
  DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
  DEEP_V3_TEST_RELEASE_COMMIT,
  DEEP_V3_TEST_RUNTIME_HASH,
  deepV3LiveManifestFixture,
  deepV3ReviewedBindingFixture,
} from "./deep-v3-fixture";
import {
  DEEP_V3_SOURCE_COMMITMENT,
} from "../lib/onchain/deep-v3-read-model";

const environment = (
  overrides: Record<string, string | undefined> = {},
) => ({
  DEEP_V3_KEEPER_ENABLED: "false",
  DEEP_V3_KEEPER_SEND_TRANSACTIONS: "false",
  DEEP_V3_KEEPER_V2_ENABLED: "true",
  DEEP_V3_KEEPER_V2_SEND_TRANSACTIONS: "true",
  DEEP_V3_KEEPER_V2_CHAIN_ID: "1",
  DEEP_V3_KEEPER_V2_RELEASE_MANIFEST:
    "contracts/deployments/mainnet-deep-full-range-v3.json",
  DEEP_V3_KEEPER_V2_RPC_URLS:
    "https://rpc-a.example/key,https://rpc-b.example/key",
  DEEP_V3_KEEPER_V2_AUTOMATION_ADDRESS:
    DEEP_V3_TEST_ADDRESSES.automation,
  DEEP_V3_KEEPER_V2_AUTOMATION_RUNTIME_HASH:
    DEEP_V3_TEST_RUNTIME_HASH,
  DEEP_V3_KEEPER_V2_LAUNCHER_ADDRESS:
    DEEP_V3_TEST_ADDRESSES.launcher,
  DEEP_V3_KEEPER_V2_LAUNCHER_RUNTIME_HASH:
    DEEP_V3_TEST_RUNTIME_HASH,
  DEEP_V3_KEEPER_V2_VAULT_FACTORY_ADDRESS:
    DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
  DEEP_V3_KEEPER_V2_VAULT_FACTORY_RUNTIME_HASH:
    DEEP_V3_TEST_RUNTIME_HASH,
  DEEP_V3_KEEPER_V2_EXECUTOR_ADDRESS:
    DEEP_V3_TEST_ADDRESSES.keeperExecutor,
  DEEP_V3_KEEPER_V2_EXECUTOR_RUNTIME_HASH:
    DEEP_V3_TEST_RUNTIME_HASH,
  DEEP_V3_KEEPER_V2_SOURCE_COMMITMENT:
    DEEP_V3_SOURCE_COMMITMENT,
  DEEP_V3_KEEPER_V2_OPS_SOURCE_COMMITMENT:
    DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
  VERCEL_GIT_COMMIT_SHA: DEEP_V3_TEST_RELEASE_COMMIT,
  DEEP_V3_KEEPER_V2_SIGNER_ADDRESS: DEEP_V3_TEST_CREATOR,
  DEEP_V3_KEEPER_V2_PRIVY_WALLET_ID: "a".repeat(24),
  DEEP_V3_KEEPER_V2_MIN_GROWTH_TO_MAX_GAS_RATIO_BPS: "10000",
  DEEP_V3_KEEPER_V2_MAX_FEE_PER_GAS_WEI: "3000000000",
  DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_TICK:
    "54000000000000000",
  DEEP_V3_KEEPER_V2_MAX_TOTAL_DEBIT_WEI_PER_DAY:
    "864000000000000000",
  DEEP_V3_KEEPER_V2_SIGNER_BALANCE_FLOOR_WEI:
    "100000000000000000",
  ...overrides,
});
const root = resolve(import.meta.dirname, "..");

describe("Deep V3 keeper ops v2 release gate", () => {
  it("rejects private-key fallback and an active legacy writer", () => {
    expect(() =>
      parseDeepV3KeeperV2Config({
        ...environment(),
        PRIVATE_KEY: `0x${"11".repeat(32)}`,
      }),
    ).toThrow("not accepted");
    expect(() =>
      parseDeepV3KeeperV2Config({
        ...environment(),
        DEEP_V3_KEEPER_ENABLED: "true",
      }),
    ).toThrow("legacy Deep V3 writer must be disabled");
  });

  it("keeps the checked-in pending binding fail-closed", () => {
    const gate = evaluateDeepV3KeeperV2ReleaseGate(
      deepV3LiveManifestFixture(),
      parseDeepV3KeeperV2Config(environment()),
      pendingBinding,
      DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
    );
    expect(gate.ready).toBe(false);
    expect(gate.reasons).toContain(
      "reviewed Deep V3 ops v2 binding",
    );
  });

  it("accepts only the exact reviewed deployment, signer and policy", () => {
    const manifest = deepV3LiveManifestFixture();
    const config = parseDeepV3KeeperV2Config(environment());
    const binding = deepV3ReviewedBindingFixture();

    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        manifest,
        config,
        binding,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ),
    ).toEqual({ ready: true, reasons: [] });

    const runtimeDrift = structuredClone(manifest);
    (
      runtimeDrift.runtimeCodeHashes as Record<string, string>
    ).automation =
      `0x${"ff".repeat(32)}`;
    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        runtimeDrift,
        config,
        binding,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ).reasons,
    ).toContain("automation runtime binding");

    const signerDrift = structuredClone(manifest);
    signerDrift.keeperPolicy.signerAddress =
      DEEP_V3_TEST_ADDRESSES.launcher;
    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        signerDrift,
        config,
        binding,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ).reasons,
    ).toContain("keeper policy");
  });

  it("fails closed on deployment, ops-source and economic-policy drift", () => {
    const config = parseDeepV3KeeperV2Config(environment());
    const binding = deepV3ReviewedBindingFixture();

    const commitDrift = deepV3LiveManifestFixture();
    commitDrift.keeperPolicy.deploymentCommit = "2".repeat(40);
    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        commitDrift,
        config,
        binding,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ).reasons,
    ).toContain("keeper policy");

    const vercelCommitDrift = parseDeepV3KeeperV2Config(
      environment({
        VERCEL_GIT_COMMIT_SHA: "3".repeat(40),
      }),
    );
    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        deepV3LiveManifestFixture(),
        vercelCommitDrift,
        binding,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ).reasons,
    ).toContain("deployment commit");

    const bindingCommitDrift = structuredClone(binding);
    bindingCommitDrift.releaseCommit = "4".repeat(40);
    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        deepV3LiveManifestFixture(),
        config,
        bindingCommitDrift,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ).reasons,
    ).toContain("deployment commit");

    const sourceDrift = deepV3LiveManifestFixture();
    sourceDrift.keeperPolicy.opsSourceCommitment =
      `0x${"fe".repeat(32)}`;
    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        sourceDrift,
        config,
        binding,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ).reasons,
    ).toContain("source commitments");

    const budgetDrift = deepV3LiveManifestFixture();
    budgetDrift.keeperPolicy.maxTotalDebitWeiPerTick = "1";
    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        budgetDrift,
        config,
        binding,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ).reasons,
    ).toContain("keeper policy");

    const gasDrift = deepV3LiveManifestFixture();
    gasDrift.keeperPolicy.gasMixtures[4].theoreticalGas =
      "17623019";
    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        gasDrift,
        config,
        binding,
        DEEP_V3_TEST_OPS_SOURCE_COMMITMENT,
      ).reasons,
    ).toContain("keeper policy");

    expect(
      evaluateDeepV3KeeperV2ReleaseGate(
        deepV3LiveManifestFixture(),
        config,
        binding,
        `0x${"fd".repeat(32)}`,
      ).reasons,
    ).toContain("source commitments");
  });

  it("derives the promotion binding from the reviewed source and policy", () => {
    const opsSourceCommitment =
      computeDeepV3OpsV2SourceCommitment(root);
    const config = parseDeepV3KeeperV2Config(
      environment({
        DEEP_V3_KEEPER_V2_OPS_SOURCE_COMMITMENT:
          opsSourceCommitment,
      }),
    );
    const promotion = buildDeepV3OpsV2Promotion({
      manifest: deepV3LiveManifestFixture(),
      config,
      root,
    });

    expect(promotion.opsSourceCommitment).toBe(
      opsSourceCommitment,
    );
    expect(promotion.manifest.keeperPolicy).toMatchObject({
      status: "reviewed-active",
      enabled: true,
      transactionSubmission: true,
      opsSourceCommitment,
      deploymentCommit: DEEP_V3_TEST_RELEASE_COMMIT,
    });
    expect(promotion.binding).toMatchObject({
      status: "reviewed",
      releaseCommit: DEEP_V3_TEST_RELEASE_COMMIT,
      opsSourceCommitment,
      signerAddress: DEEP_V3_TEST_CREATOR,
    });
  });
});
