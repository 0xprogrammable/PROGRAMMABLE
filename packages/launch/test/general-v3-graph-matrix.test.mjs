import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import solc from "solc";

import canonicalSettlementFeeVaultArtifact from "./fixtures/programmable-settlement-fee-vault-v1.json" with { type: "json" };

import { submitLaunch } from "../src/api-client.mjs";
import {
  HOOK_PERMISSION_BITS,
  GRAPH_FACTORY,
  MAINNET_USDC,
  POOL_MANAGER,
} from "../src/constants.mjs";
import { buildLaunch, packLaunch } from "../src/pack.mjs";
import { validateLaunchFile } from "../src/validate.mjs";
import { jsonResponse, validCapabilities } from "./fixtures/capabilities.mjs";

const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const FIXED_PERMISSIONS = [
  "beforeInitialize",
  "beforeSwap",
  "afterSwap",
  "beforeSwapReturnDelta",
  "afterSwapReturnDelta",
];

test("V3 pack and validate preserve a nine-target project graph plus the canonical fee vault", {
  timeout: 120_000,
}, async () => {
  const fixture = await materializeGeneralGraphFixture();
  try {
    const fixedLaunchPath = path.join(fixture.root, "fixed-launch.json");
    const fixedPack = await packLaunch({
      configPath: fixture.configPath,
      outputPath: fixedLaunchPath,
    });
    const fixedValidation = await validateLaunchFile({
      launchPath: fixedLaunchPath,
      configPath: fixture.configPath,
    });
    const fixedRequest = JSON.parse(await readFile(fixedLaunchPath, "utf8"));

    assert.equal(fixedValidation.reproducedFromConfig, true);
    assert.equal(fixedValidation.requestSha256, fixedPack.requestSha256);
    assert.equal(fixedRequest.launchProfile.profileVersion, "3.4.0");
    assert.equal(
      fixedRequest.launchProfile.projectMetadataPolicy.schemaVersion,
      "programmable.project-metadata-policy.v1",
    );
    assert.equal(fixedRequest.projectMetadata.token.name, "General Graph Token");
    assert.equal(fixedRequest.projectMetadata.token.symbol, "GGT");
    assert.match(fixedRequest.projectMetadataHash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(fixedPack.projectMetadataHash, fixedRequest.projectMetadataHash);
    assert.match(fixedPack.unboundGraphBundleHash, /^sha256:[0-9a-f]{64}$/u);
    assert.notEqual(fixedPack.graphBundleHash, fixedPack.unboundGraphBundleHash);
    assert.equal(fixedRequest.graphBundle.targets.length, 10);
    assert.equal(fixedRequest.verificationBundle.components.length, 10);
    assert.deepEqual(fixedRequest.launchProfileSelection.targetRoles, {
      tokenTargetId: "project-token",
      hookTargetId: "project-hook",
      initializerTargetId: "funding-initializer",
      platformFeeBindingTargetId: "settlement-fee-vault",
    });
    assert.equal(
      fixedRequest.graphBundle.targets.find(({ targetId }) => targetId === "project-token")
        .componentKind,
      "token",
    );
    assert.equal(
      fixedRequest.graphBundle.targets.find(({ targetId }) => targetId === "project-hook")
        .componentKind,
      "hook",
    );
    const verificationByTarget = new Map(
      fixedRequest.verificationBundle.components.map((component) => [
        component.targetId,
        component,
      ]),
    );
    assert.equal(verificationByTarget.get("project-token").contractName, "ProjectToken");
    assert.equal(verificationByTarget.get("project-hook").contractName, "ProjectHook");
    assert.equal(
      fixedPack.predictions.some(({ targetId }) => targetId === "project-token"),
      true,
    );
    assert.equal(
      fixedPack.predictions.some(({ targetId }) => targetId === "project-hook"),
      true,
    );
    assert.equal(fixedRequest.launchProfileSelection.hookPermissionMask, 0x20cc);
    assert.equal(
      fixedRequest.launchProfileSelection.platformFeeBinding.accountingMode,
      "inclusive-selected-total",
    );
    assert.equal(
      fixedRequest.launchProfileSelection.fundingMode,
      "eip-3009-receive-with-authorization",
    );
    assert.equal(fixedRequest.fundingAuthorization.token, MAINNET_USDC);
    assert.deepEqual(
      [
        fixedRequest.launchProfileSelection.poolKey.currency0,
        fixedRequest.launchProfileSelection.poolKey.currency1,
      ].map((address) => address.toLowerCase()).includes(MAINNET_USDC.toLowerCase()),
      true,
    );
    assert.deepEqual(fixedRequest.launchProfileSelection.fundingSignaturePatch, {
      schemaVersion: "programmable.eip3009-signature-patch.v1",
      targetId: "funding-initializer",
      unsignedInitializerCalldataSha256:
        fixedRequest.launchProfileSelection.fundingSignaturePatch
          .unsignedInitializerCalldataSha256,
      initializerCalldataLengthBytes: 100,
      signatureEncoding: "eip3009-r-s-v-abi-words",
      rOffsetBytes: 4,
      sOffsetBytes: 36,
      vOffsetBytes: 68,
    });
    assert.equal(Object.hasOwn(fixedRequest, "signature"), false);

    const legacyMetadataConfig = structuredClone(fixture.config);
    legacyMetadataConfig.projectMetadata.presentation.description = "";
    legacyMetadataConfig.projectMetadata.presentation.image = null;
    legacyMetadataConfig.projectMetadata.presentation.links = [];
    await writeFile(
      fixture.configPath,
      `${JSON.stringify(legacyMetadataConfig, null, 2)}\n`,
      "utf8",
    );
    const legacyMetadataBuilt = await buildLaunch({
      configPath: fixture.configPath,
      directNativeProfileVersion: "3.2.0",
    });
    assert.equal(legacyMetadataBuilt.request.launchProfile.profileVersion, "3.2.0");
    assert.equal(
      Object.hasOwn(legacyMetadataBuilt.request.launchProfile, "projectMetadataPolicy"),
      false,
    );
    assert.equal(legacyMetadataBuilt.request.projectMetadata.presentation.image, null);

    const legacyConfig = structuredClone(fixture.config);
    delete legacyConfig.projectMetadata;
    await writeFile(
      fixture.configPath,
      `${JSON.stringify(legacyConfig, null, 2)}\n`,
      "utf8",
    );
    const preMetadataBuilt = await buildLaunch({
      configPath: fixture.configPath,
      directNativeProfileVersion: "3.1.0",
    });
    assert.equal(preMetadataBuilt.request.launchProfile.profileVersion, "3.1.0");
    assert.equal(Object.hasOwn(preMetadataBuilt.request, "projectMetadata"), false);
    assert.equal(Object.hasOwn(preMetadataBuilt.receipt, "projectMetadataHash"), false);

    const legacyBuilt = await buildLaunch({
      configPath: fixture.configPath,
      directNativeProfileVersion: "3.0.0",
    });
    const legacyLaunchPath = path.join(fixture.root, "legacy-launch.json");
    await writeFile(legacyLaunchPath, legacyBuilt.requestBytes);
    const legacyValidation = await validateLaunchFile({
      launchPath: legacyLaunchPath,
      configPath: fixture.configPath,
    });
    assert.equal(legacyBuilt.request.launchProfile.profileVersion, "3.0.0");
    assert.equal(Object.hasOwn(legacyBuilt.request, "projectMetadata"), false);
    assert.equal(Object.hasOwn(legacyBuilt.receipt, "projectMetadataHash"), false);
    assert.equal(legacyValidation.reproducedFromConfig, true);
    assert.equal(legacyValidation.requestSha256, legacyBuilt.requestSha256);

    const dynamicConfig = structuredClone(fixture.config);
    dynamicConfig.nonce = `0x${"33".repeat(32)}`;
    dynamicConfig.pool.fee = 0x800000;
    dynamicConfig.targets.find(({ targetId }) => targetId === "project-hook")
      .declaredHookPermissions = ["beforeSwap"];
    await writeFile(
      fixture.configPath,
      `${JSON.stringify(dynamicConfig, null, 2)}\n`,
      "utf8",
    );

    const dynamicLaunchPath = path.join(fixture.root, "dynamic-launch.json");
    const dynamicPack = await packLaunch({
      configPath: fixture.configPath,
      outputPath: dynamicLaunchPath,
    });
    const dynamicValidation = await validateLaunchFile({
      launchPath: dynamicLaunchPath,
      configPath: fixture.configPath,
    });
    const dynamicRequest = JSON.parse(await readFile(dynamicLaunchPath, "utf8"));

    assert.equal(dynamicValidation.reproducedFromConfig, true);
    assert.equal(dynamicValidation.requestSha256, dynamicPack.requestSha256);
    assert.equal(dynamicRequest.graphBundle.targets.length, 10);
    assert.equal(dynamicRequest.graphBundle.pool.fee, 0x800000);
    assert.equal(
      dynamicRequest.launchProfileSelection.hookPermissionMask,
      1 << HOOK_PERMISSION_BITS.beforeSwap,
    );
    assert.notEqual(dynamicRequest.launchProfileSelection.hookPermissionMask, 0x20cc);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("V2 authorization patch preserves final-graph nonce diagnostics through submit before wallet handoff", {
  timeout: 120_000,
}, async () => {
  const fixture = await materializeGeneralGraphFixture({
    authorizationPatchV2: true,
  });
  try {
    const launchPath = path.join(fixture.root, "v2-conflict-launch.json");
    const packed = await packLaunch({
      configPath: fixture.configPath,
      outputPath: launchPath,
    });
    const validation = await validateLaunchFile({
      launchPath,
      configPath: fixture.configPath,
    });
    const conflict = packed.diagnostics?.find(
      ({ code }) => code === "FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED",
    );
    assert.equal(conflict?.severity, "warning");
    assert.equal(conflict?.observed.blocking, false);
    assert.match(conflict?.observed.indicators[0].observedDomain, /graphCommitment/u);
    assert.equal(
      packed.diagnostics.some(({ code }) => code === "FUNDING_SIGNATURE_PATCH_V1_LEGACY"),
      false,
    );
    assert.deepEqual(validation.diagnostics, packed.diagnostics);

    const apiOrigin = "https://api.programmable.market";
    const requestId = "9c2f751c-d7cf-4288-8de8-9c39d85f0e31";
    const walletHandoffUrl = `https://programmable.market/developers/api-keys/${requestId}`;
    let networkCalls = 0;
    const submitted = await submitLaunch({
      launchPath,
      configPath: fixture.configPath,
      idempotencyKey: "v2-funding-diagnostic-submit-0001",
      apiOrigin,
      stateDirectory: path.join(fixture.root, "state"),
      maxAttempts: 1,
      fetchImpl: async (url) => {
        networkCalls += 1;
        if (url.endsWith("/v3/capabilities")) {
          return jsonResponse(validCapabilities());
        }
        return new Response(JSON.stringify({
          schemaVersion: "programmable.custom-launch.v3",
          requestId,
          launchId: requestId,
          status: "awaiting_funding_authorization",
          output: {
            actionRequired: {
              kind: "funding-signature-required",
              message: "Review the exact EIP-3009 authorization in the wallet handoff.",
            },
            walletHandoffUrl,
          },
        }), { status: 202, headers: { "content-type": "application/json" } });
      },
      loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
    });

    assert.equal(networkCalls, 2);
    assert.deepEqual(submitted.diagnostics, validation.diagnostics);
    assert.equal(submitted.walletHandoffUrl, walletHandoffUrl);
    assert.ok(
      Object.keys(submitted).indexOf("diagnostics") < Object.keys(submitted).indexOf("resource"),
    );
    assert.ok(
      Object.keys(submitted).indexOf("diagnostics") < Object.keys(submitted).indexOf("walletHandoffUrl"),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function materializeGeneralGraphFixture({
  authorizationPatchV2 = false,
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-general-v3-matrix-"));
  await Promise.all([
    mkdir(path.join(root, "src"), { recursive: true }),
    mkdir(path.join(root, "artifacts"), { recursive: true }),
    mkdir(path.join(root, "evidence"), { recursive: true }),
    mkdir(path.join(root, "assets"), { recursive: true }),
  ]);

  const sources = {
    "src/ProjectToken.sol": {
      content: `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract ProjectToken {
    string public constant name = "Project Token";
    string public constant symbol = "PRJ";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(address controller) {
        require(controller != address(0));
        totalSupply = 1_000_000 ether;
        balanceOf[controller] = totalSupply;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0) && balanceOf[msg.sender] >= amount);
        unchecked {
            balanceOf[msg.sender] -= amount;
            balanceOf[to] += amount;
        }
        return true;
    }
}
`,
    },
    "src/ProjectHook.sol": {
      content: `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract ProjectHook {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    address public controller;
    address public poolManager;
    address public settlementFeeVault;

    constructor(address controller_, address poolManager_, address settlementFeeVault_) {
        require(
            controller_ != address(0)
                && poolManager_ != address(0)
                && settlementFeeVault_ != address(0)
        );
        controller = controller_;
        poolManager = poolManager_;
        settlementFeeVault = settlementFeeVault_;
    }

    modifier onlyPoolManager() {
        require(msg.sender == poolManager);
        _;
    }

    function beforeInitialize(address, PoolKey calldata, uint160)
        external view onlyPoolManager returns (bytes4)
    {
        return this.beforeInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external view onlyPoolManager returns (bytes4, int256, uint24)
    {
        return (this.beforeSwap.selector, 0, 0);
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, int256, bytes calldata)
        external view onlyPoolManager returns (bytes4, int128)
    {
        return (this.afterSwap.selector, 0);
    }
}
`,
    },
    "src/FundingInitializer.sol": {
      content: authorizationPatchV2 ? `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract FundingInitializer {
    bytes32 internal constant AUTHORIZATION_NONCE_DOMAIN =
        keccak256("HookemonAuthorizationNonce(bytes32 graphCommitment)");

    event AuthorizationWords(bytes32 nonce, bytes32 r, bytes32 s, uint8 v);

    function authorizationNonce(bytes32 graphCommitment) external pure returns (bytes32) {
        return keccak256(abi.encode(AUTHORIZATION_NONCE_DOMAIN, graphCommitment));
    }

    function initialize(bytes32 nonce, bytes32 r, bytes32 s, uint8 v) external {
        emit AuthorizationWords(nonce, r, s, v);
    }
}
` : `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract FundingInitializer {
    event AuthorizationWords(bytes32 r, bytes32 s, uint8 v);

    function initialize(bytes32 r, bytes32 s, uint8 v) external {
        emit AuthorizationWords(r, s, v);
    }
}
`,
    },
    "src/AuxiliaryComponent.sol": {
      content: `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract AuxiliaryComponent {
    function componentMarker() external pure returns (bytes4) {
        return this.componentMarker.selector;
    }
}
`,
    },
  };
  const standardJson = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      viaIR: false,
      metadata: { bytecodeHash: "none", appendCBOR: false, useLiteralContent: true },
      libraries: {},
      remappings: [],
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "metadata",
            "evm.bytecode.object",
            "evm.bytecode.linkReferences",
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.linkReferences",
            "evm.deployedBytecode.immutableReferences",
          ],
        },
      },
    },
  };
  const compilerOutput = JSON.parse(solc.compile(JSON.stringify(standardJson)));
  const errors = (compilerOutput.errors ?? []).filter(({ severity }) => severity === "error");
  assert.deepEqual(errors, []);

  const standardJsonPath = path.join(root, "standard-json.json");
  await writeFile(standardJsonPath, `${JSON.stringify(standardJson)}\n`, "utf8");
  const settlementFeeVaultStandardJsonSource = (await readFile(
    new URL(
      "./fixtures/programmable-settlement-fee-vault-v1.standard-json.json",
      import.meta.url,
    ),
    "utf8",
  )).trimEnd();
  const settlementFeeVaultStandardJson = JSON.parse(
    settlementFeeVaultStandardJsonSource,
  );
  const settlementFeeVaultSource = settlementFeeVaultStandardJson.sources[
    "src/ProgrammableSettlementFeeVaultV1.sol"
  ].content;
  const settlementFeeVaultStandardJsonPath = path.join(
    root,
    "settlement-fee-vault-standard-json.json",
  );
  await writeFile(
    settlementFeeVaultStandardJsonPath,
    settlementFeeVaultStandardJsonSource,
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "ProgrammableSettlementFeeVaultV1.sol"),
    settlementFeeVaultSource,
    "utf8",
  );
  const artifactPaths = {};
  for (const [sourcePath, contractName, artifactName] of [
    ["src/ProjectToken.sol", "ProjectToken", "project-token"],
    ["src/ProjectHook.sol", "ProjectHook", "project-hook"],
    ["src/FundingInitializer.sol", "FundingInitializer", "funding-initializer"],
    ["src/AuxiliaryComponent.sol", "AuxiliaryComponent", "auxiliary-component"],
  ]) {
    const compiled = compilerOutput.contracts[sourcePath][contractName];
    const artifactPath = path.join(root, "artifacts", `${artifactName}.json`);
    await writeFile(artifactPath, `${JSON.stringify({
      abi: compiled.abi,
      bytecode: compiled.evm.bytecode,
      deployedBytecode: compiled.evm.deployedBytecode,
      metadata: compiled.metadata,
    })}\n`, "utf8");
    artifactPaths[artifactName] = path.relative(root, artifactPath);
  }
  const settlementFeeVaultArtifactPath = path.join(
    root,
    "artifacts",
    "settlement-fee-vault.json",
  );
  await writeFile(settlementFeeVaultArtifactPath, `${JSON.stringify({
    abi: [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: [{ name: "bindingAuthority_", type: "address" }],
      },
      {
        type: "function",
        name: "bindRoute",
        stateMutability: "nonpayable",
        inputs: [{ name: "route", type: "address" }],
        outputs: [],
      },
    ],
    bytecode: {
      object: canonicalSettlementFeeVaultArtifact.creationBytecode.slice(2),
      linkReferences: {},
    },
    deployedBytecode: {
      object: canonicalSettlementFeeVaultArtifact.runtimeBytecode.slice(2),
      linkReferences: {},
      immutableReferences: {},
    },
    metadata: JSON.stringify({
      compiler: { version: "0.8.26+commit.8a97fa7a" },
      language: "Solidity",
      settings: {
        compilationTarget: {
          "src/ProgrammableSettlementFeeVaultV1.sol":
            "ProgrammableSettlementFeeVaultV1",
        },
        optimizer: { enabled: true, runs: 1_000 },
        evmVersion: "paris",
        viaIR: false,
        metadata: { bytecodeHash: "none", appendCBOR: false, useLiteralContent: false },
        libraries: {},
        remappings: ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"],
      },
    }),
  })}\n`, "utf8");
  artifactPaths["settlement-fee-vault"] = path.relative(
    root,
    settlementFeeVaultArtifactPath,
  );
  await writeFile(
    path.join(root, "evidence", "exact-build.txt"),
    `compiler=${solc.version()}\nerrors=0\n`,
    "utf8",
  );
  await writeFile(path.join(root, "assets", "token.png"), TINY_PNG);

  const launchWallet = "0x1111111111111111111111111111111111111111";
  const compilationUnitId = "general-v3-solc";
  const commonTarget = {
    compilationUnitId,
    constructorArguments: [],
    initializer: null,
    deploymentValueWei: "0",
    initializerValueWei: "0",
    componentKind: "other",
    declaredHookPermissions: null,
    runtimeImmutables: [],
  };
  const config = {
    schemaVersion: "programmable.launch-pack-config.v3",
    launchWallet,
    chainId: "1",
    nonce: `0x${"22".repeat(32)}`,
    source: {
      root: ".",
      paths: ["src"],
      sourceLineageNonce: "1",
      publicOrigin: {
        url: "https://example.com/general-v3-source",
        revision: "11".repeat(20),
      },
    },
    compilationUnits: [
      { compilationUnitId, standardJson: path.basename(standardJsonPath) },
      {
        compilationUnitId: "canonical-settlement-fee-vault-v1",
        standardJson: path.basename(settlementFeeVaultStandardJsonPath),
      },
    ],
    targets: [
      {
        ...commonTarget,
        targetId: "project-token",
        artifact: artifactPaths["project-token"],
        applicantSalt: `0x${"01".repeat(32)}`,
        constructorArguments: [launchWallet],
        componentKind: "token",
      },
      {
        ...commonTarget,
        targetId: "project-hook",
        artifact: artifactPaths["project-hook"],
        applicantSalt: {
          mode: "deterministic-hook-permission-grind-v1",
          start: "0",
          maxAttempts: "262144",
        },
        constructorArguments: [
          launchWallet,
          POOL_MANAGER,
          { target: "settlement-fee-vault" },
        ],
        componentKind: "hook",
        declaredHookPermissions: FIXED_PERMISSIONS,
      },
      {
        ...commonTarget,
        targetId: "funding-initializer",
        artifact: artifactPaths["funding-initializer"],
        applicantSalt: `0x${"02".repeat(32)}`,
        initializer: {
          function: "initialize",
          arguments: authorizationPatchV2
            ? [ZERO_BYTES32, ZERO_BYTES32, ZERO_BYTES32, 0]
            : [ZERO_BYTES32, ZERO_BYTES32, 0],
        },
      },
      {
        ...commonTarget,
        targetId: "settlement-fee-vault",
        compilationUnitId: "canonical-settlement-fee-vault-v1",
        artifact: artifactPaths["settlement-fee-vault"],
        applicantSalt: `0x${"09".repeat(32)}`,
        constructorArguments: [GRAPH_FACTORY],
        initializer: {
          function: "bindRoute",
          arguments: [{ target: "project-hook" }],
        },
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...commonTarget,
        targetId: `component-${index + 1}`,
        artifact: artifactPaths["auxiliary-component"],
        applicantSalt: `0x${(index + 3).toString(16).padStart(2, "0").repeat(32)}`,
      })),
    ],
    pool: {
      tokenTargetId: "project-token",
      hookTargetId: "project-hook",
      fee: 3_000,
      tickSpacing: 60,
      quoteCurrency: MAINNET_USDC,
    },
    projectMetadata: {
      schemaVersion: "programmable.project-metadata-input.v1",
      token: { name: "General Graph Token", symbol: "GGT" },
      presentation: {
        description: "Nine-target general graph fixture",
        image: {
          sourcePath: "assets/token.png",
          uri: "https://example.com/general-v3-token.png",
        },
        links: [
          { kind: "website", uri: "https://example.com/general-v3-source" },
          { kind: "x", uri: "https://x.com/general_v3" },
        ],
      },
    },
    behaviorScenarioInputs: {
      schemaVersion: "programmable.custom-launch-behavior-scenario-inputs.v1",
      steps: [{
        stepId: "reference-swap",
        phase: "swap",
        actor: "secondary-user",
        target: { kind: "runner-harness", harness: "v4-actions-v1" },
        valueWei: "0",
        calldata: "0x",
        hookData: "0x",
      }],
    },
    launchProfile: {
      schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 3,
      targetRoles: {
        tokenTargetId: "project-token",
        hookTargetId: "project-hook",
        initializerTargetId: "funding-initializer",
        platformFeeBindingTargetId: "settlement-fee-vault",
      },
      fundingMode: "eip-3009-receive-with-authorization",
      accountingMode: "inclusive-selected-total",
      assessmentBase: "executed-gross-declared-quote",
      feeCurrency: "declared-quote-currency",
      claimMode: "claim-authority-selected-recipient",
      applicantSelectedBuyHundredthsOfBip: "2500",
      applicantSelectedSellHundredthsOfBip: "5000",
    },
    permitWindow: { validAfter: "1000", deadline: "2000" },
    fundingAuthorization: {
      schemaVersion: "programmable.funding-authorization-input.v1",
      method: "eip-3009-receive-with-authorization",
      value: "30000000",
      validAfter: "1000",
      validBefore: "2000",
    },
    fundingSignaturePatch: authorizationPatchV2
      ? {
          targetId: "funding-initializer",
          nonceArgumentPath: [0],
          rArgumentPath: [1],
          sArgumentPath: [2],
          vArgumentPath: [3],
        }
      : {
          targetId: "funding-initializer",
          rOffsetBytes: 4,
          sOffsetBytes: 36,
          vOffsetBytes: 68,
        },
    agentAttestation: {
      agentId: "general-v3-regression",
      checkedAt: "2026-08-26T12:00:00.000Z",
      checks: [{ checkId: "exact-build", evidence: "evidence/exact-build.txt" }],
    },
  };
  const configPath = path.join(root, "programmable-launch.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { root, configPath, config };
}
