import assert from "node:assert/strict";
import test from "node:test";

import { keccak256 } from "viem";

import { buildGraphBundle } from "../src/graph.mjs";

test("direct-native graph packaging preserves exact proxy-hook runtime without a hidden opcode ban", () => {
  const delegatingHookRuntime = "0x5bf400";
  const targets = [
    target({
      targetId: "token",
      componentKind: "token",
      runtimeCode: "0x6000",
      declaredHookPermissions: null,
      applicantSalt: `0x${"00".repeat(32)}`,
    }),
    target({
      targetId: "hook",
      componentKind: "hook",
      runtimeCode: delegatingHookRuntime,
      declaredHookPermissions: ["beforeSwap"],
      applicantSalt: {
        mode: "deterministic-hook-permission-grind-v1",
        start: "0",
        maxAttempts: "262144",
      },
    }),
    target({
      targetId: "initializer",
      componentKind: "other",
      runtimeCode: "0x6001",
      declaredHookPermissions: null,
      applicantSalt: `0x${"01".repeat(32)}`,
    }),
  ];
  const input = {
    targets,
    pool: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      fee: 3_000,
      tickSpacing: 60,
    },
    sourceBundleSha256: `sha256:${"11".repeat(32)}`,
    launchWallet: "0x1111111111111111111111111111111111111111",
    nonce: `0x${"44".repeat(32)}`,
    enforceV4PermissionDependencies: true,
  };
  const built = buildGraphBundle(input);
  const hookRuntime = built.runtimeCodes.find(({ targetId }) => targetId === "hook");
  assert.deepEqual(hookRuntime, { targetId: "hook", runtimeCode: delegatingHookRuntime });
  assert.equal(
    built.graphBundle.targets.find(({ targetId }) => targetId === "hook").expectedRuntimeCodeHash,
    keccak256(delegatingHookRuntime),
  );

  assert.throws(
    () => buildGraphBundle({ ...input, noDelegationRuntimeTargetIds: ["hook"] }),
    /CUSTOM_MODULE_FORBIDDEN_OPCODE:.*DELEGATECALL/u,
  );
});

function target({
  targetId,
  componentKind,
  runtimeCode,
  declaredHookPermissions,
  applicantSalt,
}) {
  return {
    targetId,
    compilationUnitId: "direct-native-runtime-policy-test",
    sourcePath: `src/${targetId}.sol`,
    contractName: targetId,
    compilerVersion: "0.8.26+commit.8a97fa7a",
    abi: [],
    creationBytecode: "0x60006000",
    runtimeCode,
    runtimeMaterialization: null,
    expectedRuntimeCodeHash: keccak256(runtimeCode),
    applicantSalt,
    constructorArguments: [],
    initializer: null,
    deploymentValueWei: "0",
    initializerValueWei: "0",
    componentKind,
    declaredHookPermissions,
  };
}
