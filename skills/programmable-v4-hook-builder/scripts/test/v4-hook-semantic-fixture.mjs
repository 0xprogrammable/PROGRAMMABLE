import {
  V4_HOOK_SEMANTIC_CONTRACT_VERSION,
  V4_SWAP_QUADRANTS,
  canonicalV4PermissionMask
} from "../v4-hook-semantic-contract-core.mjs";

export function createV4HookSemanticFixture(permissions, { purpose = "test-only-settlement", hookDataMode = "not-used" } = {}) {
  const permissionMask = canonicalV4PermissionMask(permissions);
  const expectedAddress = `0x${"0".repeat(36)}${permissionMask.slice(2)}`;
  const boundedSwapWitness = hookDataMode === "bounded-swap-witness";
  const returnDeltaActive = [
    "beforeSwapReturnDelta",
    "afterSwapReturnDelta",
    "afterAddLiquidityReturnDelta",
    "afterRemoveLiquidityReturnDelta"
  ].some((name) => permissions?.[name] === true);
  return {
    contractVersion: V4_HOOK_SEMANTIC_CONTRACT_VERSION,
    purpose,
    poolManager: {
      authentication: "exact-msg-sender",
      binding: "immutable-exact-address",
      address: "0x0000000000000000000000000000000000000001"
    },
    poolIsolation: {
      namespace: "pool-id",
      crossPoolSubsidy: false,
      crossPoolNetting: false
    },
    identities: {
      msgSenderRole: "pool-manager",
      senderRole: "router-or-unlock-caller",
      senderTreatedAsEndUser: false,
      endUserAuthentication: "not-used"
    },
    hookData: {
      mode: hookDataMode,
      versioned: false,
      domainBound: false,
      replayProtected: false,
      malformedRejected: true,
      witness: boundedSwapWitness ? {
        encoding: "abi-v2-static",
        solidityType: "uint256",
        exactByteLength: 32,
        valueSemantics: "exact-output-gross-quote-witness",
        executionDeltaBinding: "gross-witness-and-fee-reconciled-to-executed-quote-delta",
        identitySemantics: "none",
        authenticationSemantics: "none",
        replaySemantics: "none"
      } : null
    },
    swapAccounting: {
      supportedQuadrants: [...V4_SWAP_QUADRANTS],
      rejectedQuadrants: [],
      unsupportedRejectedBeforeEffects: true,
      specifiedCurrencyDerived: true,
      unspecifiedCurrencyDerived: true,
      signsDerived: true,
      partialFillPolicy: boundedSwapWitness ? "rejected-before-effects" : "supported-and-tested",
      unlockDeltasClose: true,
      creditsBacked: true,
      erc20Settlement: "sync-transfer-settle",
      rounding: "explicit-bounded",
      tinyAndExtremeValuesTested: true
    },
    returnDelta: {
      beforeSwapUsed: permissions?.beforeSwapReturnDelta === true,
      afterSwapUsed: permissions?.afterSwapReturnDelta === true,
      afterAddLiquidityUsed: permissions?.afterAddLiquidityReturnDelta === true,
      afterRemoveLiquidityUsed: permissions?.afterRemoveLiquidityReturnDelta === true,
      backing: returnDeltaActive ? "hook-owned-assets" : "not-applicable",
      noOpAnalyzed: true,
      hardBounds: true,
      deltaConservation: true,
      justification: returnDeltaActive ? "Exercises the return-delta validation contract in a test-only fixture." : null
    },
    reentrancy: {
      guardModel: "pool-manager-lock-aware",
      nestedUnlocks: "rejected",
      crossFunctionAnalyzed: true,
      externalCallOrderAnalyzed: true
    },
    routing: {
      universalRouter: true,
      v4Planner: true,
      permit2: true,
      nativeEth: true,
      exactInput: true,
      exactOutput: true,
      singleHop: true,
      multiHop: true,
      perHopHookData: true,
      quoteExecutionParity: true
    },
    deployment: {
      state: "preimage-bound",
      creationCodeHash: `sha256:${"11".repeat(32)}`,
      constructorArgsHash: `sha256:${"22".repeat(32)}`,
      initcodeHash: `sha256:${"33".repeat(32)}`,
      permissionMask,
      hookMinerSaltRef: "evidence/hook-miner-salt.json",
      hookMinerSaltSha256: `sha256:${"44".repeat(32)}`,
      expectedAddress,
      runtimeCodeHash: `sha256:${"55".repeat(32)}`,
      poolManagerAddress: "0x0000000000000000000000000000000000000001"
    },
    evidence: {
      unit: ["test:v4-unit"],
      negative: ["test:v4-negative"],
      fuzz: ["test:v4-fuzz"],
      invariant: ["test:v4-invariant"],
      fork: ["test:v4-fork"],
      router: ["test:v4-router"],
      deployment: ["test:v4-deployment"]
    }
  };
}
