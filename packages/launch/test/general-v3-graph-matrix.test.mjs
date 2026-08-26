import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import solc from "solc";

import {
  HOOK_PERMISSION_BITS,
  MAINNET_USDC,
  POOL_MANAGER,
} from "../src/constants.mjs";
import { packLaunch } from "../src/pack.mjs";
import { validateLaunchFile } from "../src/validate.mjs";

const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const FIXED_PERMISSIONS = [
  "beforeInitialize",
  "beforeSwap",
  "afterSwap",
  "beforeSwapReturnDelta",
  "afterSwapReturnDelta",
];

test("V3 pack and validate cover a nine-target project graph and a second dynamic-fee mask", {
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
    assert.equal(fixedRequest.graphBundle.targets.length, 9);
    assert.equal(fixedRequest.verificationBundle.components.length, 9);
    assert.deepEqual(fixedRequest.launchProfileSelection.targetRoles, {
      tokenTargetId: "project-token",
      hookTargetId: "project-hook",
      initializerTargetId: "funding-initializer",
      platformFeeBindingTargetId: "project-hook",
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
    assert.equal(dynamicRequest.graphBundle.targets.length, 9);
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

async function materializeGeneralGraphFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-general-v3-matrix-"));
  await Promise.all([
    mkdir(path.join(root, "src"), { recursive: true }),
    mkdir(path.join(root, "artifacts"), { recursive: true }),
    mkdir(path.join(root, "evidence"), { recursive: true }),
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

    constructor(address controller_, address poolManager_) {
        require(controller_ != address(0) && poolManager_ != address(0));
        controller = controller_;
        poolManager = poolManager_;
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
      content: `// SPDX-License-Identifier: MIT
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
  await writeFile(
    path.join(root, "evidence", "exact-build.txt"),
    `compiler=${solc.version()}\nerrors=0\n`,
    "utf8",
  );

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
    compilationUnits: [{ compilationUnitId, standardJson: path.basename(standardJsonPath) }],
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
        constructorArguments: [launchWallet, POOL_MANAGER],
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
          arguments: [ZERO_BYTES32, ZERO_BYTES32, 0],
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
    launchProfile: {
      schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v2",
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 2,
      targetRoles: {
        tokenTargetId: "project-token",
        hookTargetId: "project-hook",
        initializerTargetId: "funding-initializer",
        platformFeeBindingTargetId: "project-hook",
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
    fundingSignaturePatch: {
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
