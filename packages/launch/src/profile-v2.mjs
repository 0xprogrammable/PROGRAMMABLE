import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  toFunctionSelector,
} from "viem";

import { canonicalIdentifier } from "./build.mjs";
import { canonicalizeJson } from "./canonical-json.mjs";
import {
  CREATE_REQUEST_SCHEMA_V2,
  GRAPH_FACTORY,
  LAUNCH_INTENT_HASH_DOMAIN,
  LAUNCH_PROFILE_BINDING_SCHEMA,
  LAUNCH_PROFILE_HASH_DOMAIN,
  LAUNCH_PROFILE_ID,
  LAUNCH_PROFILE_REVISION,
  LAUNCH_PROFILE_SCHEMA,
  LAUNCH_PROFILE_SELECTION_SCHEMA,
  LAUNCH_PROFILE_VERSION,
  MAINNET_CHAIN_ID,
  POOL_MANAGER,
  ROUTER,
} from "./constants.mjs";
import { assertExactKeys, sha256Digest } from "./io.mjs";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_PARAMETER = { type: "address" };
const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
];
const BIND_ADAPTER_ABI = [{
  type: "function",
  name: "bindAdapter",
  stateMutability: "nonpayable",
  inputs: [{ name: "adapter", type: "address" }],
  outputs: [],
}];
const BIND_POOL_ABI = [{
  type: "function",
  name: "bindPool",
  stateMutability: "nonpayable",
  inputs: [
    { name: "key", type: "tuple", components: POOL_KEY_COMPONENTS },
    { name: "initializer", type: "address" },
    { name: "initialSqrtPriceX96", type: "uint160" },
  ],
  outputs: [],
}];
const PROFILE_KEYS = [
  "schemaVersion",
  "profileId",
  "profileRevision",
  "profileVersion",
  "productionLaunchAuthorized",
  "chainId",
  "router",
  "routerRuntimeCodeHash",
  "graphFactory",
  "graphFactoryRuntimeCodeHash",
  "poolManager",
  "poolManagerRuntimeCodeHash",
  "policy",
  "feePolicy",
  "lpFeePolicy",
  "customHookPolicy",
  "contractBuildBindings",
  "graphRolePolicy",
  "requiredHookPermissions",
  "requiredHookPermissionMask",
];

export function validateLaunchProfileSelection(selection) {
  assertExactKeys(selection, [
    "schemaVersion",
    "profileId",
    "profileRevision",
    "targetRoles",
  ], "launchProfile selection");
  if (selection.schemaVersion !== LAUNCH_PROFILE_SELECTION_SCHEMA
    || selection.profileId !== LAUNCH_PROFILE_ID
    || selection.profileRevision !== LAUNCH_PROFILE_REVISION) {
    throw new TypeError("launchProfile selection does not resolve to an embedded RC profile");
  }
  return {
    schemaVersion: LAUNCH_PROFILE_SELECTION_SCHEMA,
    profileId: LAUNCH_PROFILE_ID,
    profileRevision: LAUNCH_PROFILE_REVISION,
    targetRoles: normalizeTargetRoles(selection.targetRoles),
  };
}

export function resolveLaunchProfile(selection) {
  validateLaunchProfileSelection(selection);
  return {
    schemaVersion: LAUNCH_PROFILE_SCHEMA,
    profileId: LAUNCH_PROFILE_ID,
    profileRevision: LAUNCH_PROFILE_REVISION,
    profileVersion: LAUNCH_PROFILE_VERSION,
    productionLaunchAuthorized: false,
    chainId: MAINNET_CHAIN_ID,
    router: ROUTER,
    routerRuntimeCodeHash: "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
    graphFactory: GRAPH_FACTORY,
    graphFactoryRuntimeCodeHash: "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
    poolManager: POOL_MANAGER,
    poolManagerRuntimeCodeHash: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
    policy: {
      policyId: "programmable-central-launch-policy",
      policyVersion: "2.1.0",
      effectiveAt: "2026-08-20T00:00:00Z",
      sourceRepository: "https://github.com/0xprogrammable/submit-launch",
      sourceCommit: "afafed19da43f0246d5ba8827aec634fa596e091",
      sourceBlob: "af10761f1643297969295aef894ea664f61a2686",
      sourceContentSha256: "sha256:9f081e02b626b421bcdc38d84f25b5cf3cfb92bd77f27a987520fa0bae675b67",
      productionLaunchEnabled: false,
      requiredRuleIds: [
        "LAUNCH.ETHEREUM_AND_TREASURY_10_BPS",
        "LAUNCH.ETHEREUM_FINALIZED_ROUTER_STAMP_BEFORE_PROMOTION",
        "LAUNCH.ETHEREUM_FINALIZED_RUNTIME_FEE_SETTLEMENT_BEFORE_PROMOTION",
        "LAUNCH.ETHEREUM_ROUTER_PROVENANCE_READINESS",
      ],
    },
    feePolicy: {
      version: 2,
      domain: "0x33cc5abe080f32ea2b4807d880e066addaf5e95d32d2f9004a9978cc79de3ed9",
      policyId: "0xb7ff874d418bc714d0ec6c36a2df03ea6251bc8b6eb125adc4f5b6b4899d2517",
      policyIdStatus: "frozen-security-owner",
      profile: "isolated-after-swap-zero-delta-opcode-safe",
      profileId: "0x4609b37c12248e1e8c98997685cc2e399a287344dea932b6ed703e4a99c532c2",
      profileIdStatus: "frozen-security-owner",
      basis: "gross-unspecified-pool-currency-amount",
      basisId: "0xcef243267fe4fe76e78f4e2d8930c8e4c08ebb084d5ac1366bd94e2727748b2c",
      assetMode: "unspecified-pool-currency-per-swap",
      assetModeId: "0x8c14f942404691d75bd9939170ccaff13ea802db838c3840be078bef75218320",
      ratePpm: "1000",
      denominator: "1000000",
      recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
      deploymentProfileDomain:
        "0x488c459f8205469dce228b8c9066c76c51ab7e052e9737aa51c40426858774ca",
      compositionDomain:
        "0xa73855a80721b25f863bf5a3a2709f5cd205f7d63b238913eadc82f3d981868e",
    },
    lpFeePolicy: {
      mode: "static",
      maximumPpm: "100000",
      disclosure: "separate-from-platform-fee",
    },
    customHookPolicy: {
      customDeltaAccountBinding: "zero-address",
      maximumCustomDeltaAbsolute: "0",
      customModuleRuntimeBinding: "graph-expected-runtime-code-hash",
      delegationMode: "direct-runtime-only",
      forbiddenRuntimeOpcodes: ["CALLCODE", "DELEGATECALL", "SELFDESTRUCT"],
      externalCallRisk: "custom-risk-disclosed",
    },
    contractBuildBindings: {
      activationStatus: "canary",
      compilerVersion: "0.8.26+commit.8a97fa7a",
      compilerSettingsHash: "0xd8985cd6554daab2848a8df4d90f9d5e0d81f15d062ee04bcd8414f292ccaf43",
      compilerSettings: {
        evmVersion: "cancun",
        optimizer: { enabled: true, runs: 1000 },
        viaIR: false,
        metadata: { bytecodeHash: "ipfs", appendCBOR: true },
      },
      commitmentMode: "exact-standard-json-creation-runtime-template-v1",
      requiredComponents: [
        {
          role: "token",
          sourcePath: "src/ProgrammableLaunchTokenV2.sol",
          contractName: "ProgrammableLaunchTokenV2",
          compilerVersion: "0.8.26+commit.8a97fa7a",
          standardJsonInputSha256:
            "sha256:72af5d9faedef9188f1d9e20e2d8a37557e2bb14d44be54ce3aacb11c71ef877",
          creationBytecodeSha256:
            "sha256:963532489c0d8546e7a20ab53f7a9acd6a43572fefe5180b2a0678ce941dcf05",
          creationBytecodeHash:
            "0x71660c7252993788cbab7c257ce654622c5661611623c4cb288f68f157d1b25d",
          runtimeTemplateSha256:
            "sha256:db814ae78127e1a46807f5c2a6fab670bdcf1ce7b45e352d6e239d8bdf8c17cb",
          runtimeTemplateCodeHash:
            "0xf98eb029ee9c1face4b56fafd83612be8b813bf15a402a959ac107de8b203eef",
          runtimeCodeHash:
            "0xf98eb029ee9c1face4b56fafd83612be8b813bf15a402a959ac107de8b203eef",
          immutableReferences: [],
          runtimeImmutables: [],
          constructorBindingSchema:
            "string-name,string-symbol,uint256-fixed-supply,address-launch-controller",
          initializerBindingSchema: "none",
        },
        {
          role: "feeVault",
          sourcePath: "src/ProgrammableFeeVaultV2.sol",
          contractName: "ProgrammableFeeVaultV2",
          compilerVersion: "0.8.26+commit.8a97fa7a",
          standardJsonInputSha256:
            "sha256:788d188b7f8fa86ecf49db7c0371c70a147f8ef99e4d617597feb2cdef2a9995",
          creationBytecodeSha256:
            "sha256:6c076e3c8c7c06190973205adf186630bf93f5dd05cb8d00c12a39f2803def5d",
          creationBytecodeHash:
            "0x0167ff8e72e4739491a8fbf1647cc4f583986f3a43ce16ae5289dd149b9a040c",
          runtimeTemplateSha256:
            "sha256:228c49d3eb3efd2515d0eebc2ad246d2521c1e9a789f7cb5892fa1148c6bce2a",
          runtimeTemplateCodeHash:
            "0x2c1d5986b9356fb81dbc37051b13effec4ad1e403fcb0d4c5cb236610ee2522d",
          runtimeCodeHash:
            "0xf2cbc21a3f07c05909d664ba8d8b66fe6576eb8a5d016faa53e31e73ed6acbd4",
          immutableReferences: [
            {
              immutableId: "2534",
              ranges: [
                { start: 620, length: 32 },
                { start: 1094, length: 32 },
                { start: 1418, length: 32 },
                { start: 1642, length: 32 },
                { start: 2493, length: 32 },
                { start: 2815, length: 32 },
                { start: 3417, length: 32 },
                { start: 3702, length: 32 },
                { start: 4022, length: 32 },
                { start: 4198, length: 32 },
                { start: 4814, length: 32 },
                { start: 6214, length: 32 },
              ],
            },
            {
              immutableId: "2536",
              ranges: [
                { start: 1133, length: 32 },
                { start: 6288, length: 32 },
              ],
            },
          ],
          runtimeImmutables: [
            {
              immutableId: "2534",
              abiType: "address",
              literal: POOL_MANAGER,
            },
            {
              immutableId: "2536",
              abiType: "address",
              literal: GRAPH_FACTORY,
            },
          ],
          constructorBindingSchema: "no-arguments-canonical-dependencies",
          initializerBindingSchema: "bindAdapter(address-fee-hook)",
        },
        {
          role: "feeHook",
          sourcePath: "src/ProgrammableAdditiveFeeHookV2.sol",
          contractName: "ProgrammableIsolatedAfterSwapFeeHookV2",
          compilerVersion: "0.8.26+commit.8a97fa7a",
          standardJsonInputSha256:
            "sha256:fad58023346d0d09d5508a4493854bcf0bb3d360e966a411d715a6a971aac803",
          creationBytecodeSha256:
            "sha256:8adff8b70acd33b57b7d7a059efee7e6fc56ea431ccb577ed76a9ad484fb3695",
          creationBytecodeHash:
            "0x6cd2dbd66351cf83194fb942ace4b4f4356c9499d567619b15a922d5cad730b3",
          runtimeTemplateSha256:
            "sha256:671ee2655a6bb86ca8fa3a678d051fa8ad5abd93ea63d54862635dde276e0684",
          runtimeTemplateCodeHash:
            "0x0a461fa65d04305fa2e583d9a6fba369b3b2ff66aa5856f56d0782c2ff72e19c",
          runtimeCodeHash:
            "0x0a461fa65d04305fa2e583d9a6fba369b3b2ff66aa5856f56d0782c2ff72e19c",
          immutableReferences: [],
          runtimeImmutables: [],
          constructorBindingSchema: "address-fee-vault,address-custom-module",
          initializerBindingSchema:
            "bindPool(pool-key,address-authorized-initializer,uint160-initial-sqrt-price)",
        },
        {
          role: "poolInitializer",
          sourcePath: "src/ProgrammableFeePoolInitializerV2.sol",
          contractName: "ProgrammableFeePoolInitializerV2",
          compilerVersion: "0.8.26+commit.8a97fa7a",
          standardJsonInputSha256:
            "sha256:ebda2869af9fb1dcd567913768cd37547ccb68171e07e5aff645ea6053f3414c",
          creationBytecodeSha256:
            "sha256:9ea1c403abb3fe3ee5b65db03ab30788fa6e5c158aa524b577660c6590ff87e9",
          creationBytecodeHash:
            "0xf6e047132a68eb0692f314975b45af88c6dd873ab7ecaa7b0c3c84a490b9454c",
          runtimeTemplateSha256:
            "sha256:ac526fd77fa003f6bb33c774a16f76d7f739f941d3d90d0eaeab42b2aa85d66b",
          runtimeTemplateCodeHash:
            "0x4df0f570bc27f05baa99ad297e4b7666d15f3101f43ba2e2863ce026432f43e4",
          runtimeCodeHash:
            "0x4df0f570bc27f05baa99ad297e4b7666d15f3101f43ba2e2863ce026432f43e4",
          immutableReferences: [],
          runtimeImmutables: [],
          constructorBindingSchema:
            "address-fee-vault,address-fee-hook,address-token,uint24-static-lp-fee,int24-tick-spacing,uint160-initial-sqrt-price",
          initializerBindingSchema: "initializePool()",
        },
      ],
    },
    graphRolePolicy: {
      requiredRoleCount: 5,
      roles: [
        { role: "token", componentKind: "token", admission: "profile-exact-build" },
        {
          role: "customModule",
          componentKind: "other",
          admission: "request-exact-source-runtime-and-opcode-gate",
        },
        { role: "feeVault", componentKind: "other", admission: "profile-exact-build" },
        { role: "feeHook", componentKind: "hook", admission: "profile-exact-build" },
        { role: "poolInitializer", componentKind: "other", admission: "profile-exact-build" },
      ],
    },
    requiredHookPermissions: ["beforeInitialize", "afterSwap", "afterSwapReturnDelta"],
    requiredHookPermissionMask: "0x2044",
  };
}

export function validateEmbeddedLaunchProfile(value) {
  assertExactKeys(value, PROFILE_KEYS, "launchProfile");
  const resolved = resolveLaunchProfile({
    schemaVersion: LAUNCH_PROFILE_SELECTION_SCHEMA,
    profileId: value.profileId,
    profileRevision: value.profileRevision,
    targetRoles: {
      tokenTargetId: "token",
      customModuleTargetId: "customModule",
      feeVaultTargetId: "feeVault",
      feeHookTargetId: "feeHook",
      poolInitializerTargetId: "poolInitializer",
    },
  });
  if (canonicalizeJson(value) !== canonicalizeJson(resolved)) {
    throw new TypeError("launchProfile differs from its closed embedded profile manifest");
  }
  return resolved;
}

export function buildLaunchProfileBinding(selection, context) {
  const normalizedSelection = validateLaunchProfileSelection(selection);
  assertExactKeys(
    context,
    ["graphBundle", "predictions"],
    "launchProfile binding context",
  );
  const launchProfile = resolveLaunchProfile(normalizedSelection);
  const parameters = buildProfileParameters(
    launchProfile,
    normalizedSelection.targetRoles,
    context.graphBundle,
    context.predictions,
  );
  return {
    schemaVersion: LAUNCH_PROFILE_BINDING_SCHEMA,
    profileId: LAUNCH_PROFILE_ID,
    profileRevision: LAUNCH_PROFILE_REVISION,
    targetRoles: normalizedSelection.targetRoles,
    profileParameters: parameters,
  };
}

export function validateLaunchProfileBinding(value, { launchProfile, graphBundle, predictions }) {
  assertExactKeys(value, [
    "schemaVersion",
    "profileId",
    "profileRevision",
    "targetRoles",
    "profileParameters",
  ], "launchProfileSelection");
  const normalized = buildLaunchProfileBinding({
    schemaVersion: LAUNCH_PROFILE_SELECTION_SCHEMA,
    profileId: value.profileId,
    profileRevision: value.profileRevision,
    targetRoles: value.targetRoles,
  }, {
    graphBundle,
    predictions,
  });
  if (launchProfile.profileId !== normalized.profileId
    || launchProfile.profileRevision !== normalized.profileRevision
    || canonicalizeJson(value) !== canonicalizeJson(normalized)) {
    throw new TypeError("launchProfileSelection does not bind the static profile to this launch graph");
  }
  return normalized;
}

export function validateFeeEnforcedProfileBuilds(
  launchProfile,
  launchProfileSelection,
  graphBundle,
  verificationBundle,
) {
  const roleKey = {
    token: "tokenTargetId",
    feeVault: "feeVaultTargetId",
    feeHook: "feeHookTargetId",
    poolInitializer: "poolInitializerTargetId",
  };
  const targets = new Map(graphBundle.targets.map((target) => [target.targetId, target]));
  const components = new Map(
    verificationBundle.components.map((component) => [component.targetId, component]),
  );
  const units = new Map(
    verificationBundle.compilationUnits.map((unit) => [unit.compilationUnitId, unit]),
  );
  const commitments = launchProfile.contractBuildBindings.requiredComponents;
  if (!Array.isArray(commitments) || commitments.length !== 4) {
    throw new TypeError("closed fee profile must bind exactly four fixed contract builds");
  }
  for (const commitment of commitments) {
    const targetId = launchProfileSelection.targetRoles[roleKey[commitment.role]];
    const target = targets.get(targetId);
    const component = components.get(targetId);
    const unit = units.get(component?.compilationUnitId);
    if (target === undefined || component === undefined || unit === undefined) {
      throw new TypeError(`PROFILE_BUILD_MISMATCH: missing ${commitment.role} build evidence`);
    }
    if (component.sourcePath !== commitment.sourcePath
      || component.contractName !== commitment.contractName
      || unit.compilerVersion !== commitment.compilerVersion
      || unit.standardJsonInputSha256 !== commitment.standardJsonInputSha256) {
      throw new TypeError(`PROFILE_BUILD_MISMATCH: ${commitment.role} compiler identity differs`);
    }
    const creationBytes = Buffer.from(target.creationBytecode.slice(2), "hex");
    if (sha256Digest(creationBytes) !== commitment.creationBytecodeSha256
      || keccak256(target.creationBytecode) !== commitment.creationBytecodeHash) {
      throw new TypeError(`PROFILE_BUILD_MISMATCH: ${commitment.role} creation template differs`);
    }
    const materialization = component.runtimeMaterialization;
    if (canonicalizeJson(materialization.immutableReferences)
        !== canonicalizeJson(commitment.immutableReferences)
      || canonicalizeJson(materialization.runtimeImmutables)
        !== canonicalizeJson(commitment.runtimeImmutables)) {
      throw new TypeError(`PROFILE_BUILD_MISMATCH: ${commitment.role} immutable bindings differ`);
    }
    const runtimeBytes = Buffer.from(materialization.deployedRuntimeCodeBase64, "base64");
    const templateBytes = Buffer.from(runtimeBytes);
    for (const reference of materialization.immutableReferences) {
      for (const range of reference.ranges) {
        templateBytes.fill(0, range.start, range.start + range.length);
      }
    }
    const runtimeTemplate = `0x${templateBytes.toString("hex")}`;
    if (sha256Digest(templateBytes) !== commitment.runtimeTemplateSha256
      || keccak256(runtimeTemplate) !== commitment.runtimeTemplateCodeHash
      || target.expectedRuntimeCodeHash !== commitment.runtimeCodeHash
      || materialization.deployedRuntimeCodeHash !== commitment.runtimeCodeHash) {
      throw new TypeError(`PROFILE_BUILD_MISMATCH: ${commitment.role} runtime differs`);
    }
  }
}

export function hashLaunchProfile(launchProfile) {
  return hashCanonicalDomain(LAUNCH_PROFILE_HASH_DOMAIN, launchProfile);
}

export function buildLaunchIntentHash({
  launchWallet,
  chainId,
  nonce,
  sourceDescriptor,
  sourceBundleManifest,
  graphBundleHash,
  verificationBundleHash,
  launchProfileHash,
  launchProfileSelection,
}) {
  if (![graphBundleHash, verificationBundleHash, launchProfileHash].every(
    (value) => typeof value === "string" && SHA256.test(value),
  )) {
    throw new TypeError("launch intent requires canonical graph, verification, and profile hashes");
  }
  return hashCanonicalDomain(LAUNCH_INTENT_HASH_DOMAIN, {
    schemaVersion: CREATE_REQUEST_SCHEMA_V2,
    launchWallet: getAddress(launchWallet),
    chainId,
    nonce,
    sourceDescriptor,
    sourceBundleManifest,
    graphBundleHash,
    verificationBundleHash,
    launchProfileHash,
    launchProfileSelection,
  });
}

export function validateFeeEnforcedProfileGraph(
  launchProfile,
  launchProfileSelection,
  graphBundle,
  launchWallet,
) {
  const roles = launchProfileSelection.targetRoles;
  if (!Array.isArray(graphBundle?.targets) || graphBundle.targets.length !== 5) {
    throw new TypeError(
      "fee-enforced V2 profile requires exactly token, custom module, fee vault, fee hook, and pool initializer targets",
    );
  }
  const byId = new Map(graphBundle.targets.map((target) => [target.targetId, target]));
  const token = byId.get(roles.tokenTargetId);
  const customModule = byId.get(roles.customModuleTargetId);
  const vault = byId.get(roles.feeVaultTargetId);
  const hook = byId.get(roles.feeHookTargetId);
  const poolInitializer = byId.get(roles.poolInitializerTargetId);
  if (token?.componentKind !== "token" || customModule?.componentKind !== "other"
    || vault?.componentKind !== "other" || hook?.componentKind !== "hook"
    || poolInitializer?.componentKind !== "other") {
    throw new TypeError("launchProfile target roles do not match graph component kinds");
  }
  if (graphBundle.pool?.tokenTargetId !== roles.tokenTargetId
    || graphBundle.pool?.hookTargetId !== roles.feeHookTargetId) {
    throw new TypeError("launchProfile target roles do not match the graph pool");
  }
  if ((graphBundle.pool.fee & 0x800000) !== 0 || graphBundle.pool.fee > 100_000) {
    throw new TypeError("fee-enforced V2 profile permits only disclosed static LP fees up to 100000 ppm");
  }
  if (canonicalizeJson(hook.declaredHookPermissions)
    !== canonicalizeJson(launchProfile.requiredHookPermissions)) {
    throw new TypeError("fee hook permissions do not match the closed launch profile");
  }
  if (typeof customModule.expectedRuntimeCodeHash !== "string"
    || !/^0x(?!0{64}$)[0-9a-f]{64}$/.test(customModule.expectedRuntimeCodeHash)) {
    throw new TypeError("custom module runtime hash is not bound in the graph");
  }
  for (const target of [token, customModule, vault, hook, poolInitializer]) {
    if (target.deploymentValueWei !== "0" || target.initializerValueWei !== "0") {
      throw new TypeError("fee-enforced V2 profile does not authorize target or initializer value");
    }
  }
  assertLocatorList(token.constructorAddressLocators, [], "launch token constructor");
  assertLocatorList(vault.constructorAddressLocators, [], "fee vault constructor");
  assertLocatorList(hook.constructorAddressLocators, [
    locator(roles.feeVaultTargetId, 0),
    locator(roles.customModuleTargetId, 32),
  ], "fee hook constructor");
  assertLocatorList(poolInitializer.constructorAddressLocators, [
    locator(roles.feeVaultTargetId, 0),
    locator(roles.feeHookTargetId, 32),
    locator(roles.tokenTargetId, 64),
  ], "pool initializer constructor");

  const tokenConstructorTypes = [
    { type: "string" },
    { type: "string" },
    { type: "uint256" },
    ADDRESS_PARAMETER,
  ];
  const tokenArguments = decodeAbiParameters(tokenConstructorTypes, token.constructorArguments);
  if (encodeAbiParameters(tokenConstructorTypes, tokenArguments) !== token.constructorArguments
    || Buffer.byteLength(tokenArguments[0], "utf8") === 0
    || Buffer.byteLength(tokenArguments[0], "utf8") > 64
    || Buffer.byteLength(tokenArguments[1], "utf8") === 0
    || Buffer.byteLength(tokenArguments[1], "utf8") > 16
    || BigInt(tokenArguments[2]) === 0n
    || BigInt(tokenArguments[2]) > (1n << 128n) - 1n
    || getAddress(tokenArguments[3]) !== getAddress(launchWallet)) {
    throw new TypeError(
      "launch token constructor must bind canonical metadata, fixed supply, and the launch controller",
    );
  }
  if (vault.constructorArguments !== "0x") {
    throw new TypeError("fee vault constructor must use the closed canonical no-argument build");
  }
  const expectedHookConstructor = encodeAbiParameters(
    [ADDRESS_PARAMETER, ADDRESS_PARAMETER],
    [ZERO_ADDRESS, ZERO_ADDRESS],
  );
  if (hook.constructorArguments !== expectedHookConstructor) {
    throw new TypeError(
      "fee hook constructor must bind exactly the profile vault and custom module targets",
    );
  }
  const initializerConstructorTypes = [
    ADDRESS_PARAMETER,
    ADDRESS_PARAMETER,
    ADDRESS_PARAMETER,
    { type: "uint24" },
    { type: "int24" },
    { type: "uint160" },
  ];
  const initializerArguments = decodeAbiParameters(
    initializerConstructorTypes,
    poolInitializer.constructorArguments,
  );
  const initialSqrtPriceX96 = BigInt(initializerArguments[5]);
  const expectedInitializerConstructor = encodeAbiParameters(initializerConstructorTypes, [
    ZERO_ADDRESS,
    ZERO_ADDRESS,
    ZERO_ADDRESS,
    graphBundle.pool.fee,
    graphBundle.pool.tickSpacing,
    initialSqrtPriceX96,
  ]);
  if (poolInitializer.constructorArguments !== expectedInitializerConstructor
    || initialSqrtPriceX96 === 0n) {
    throw new TypeError("pool initializer constructor does not match the closed fee profile");
  }

  const expectedVaultInitializer = encodeFunctionData({
    abi: BIND_ADAPTER_ABI,
    functionName: "bindAdapter",
    args: [ZERO_ADDRESS],
  });
  if (vault.initializerCalldata !== expectedVaultInitializer) {
    throw new TypeError("fee vault initializer must be exactly bindAdapter(feeHook)");
  }
  assertLocatorList(vault.initializerAddressLocators, [
    locator(roles.feeHookTargetId, 4),
  ], "fee vault initializer");

  const expectedHookInitializer = encodeFunctionData({
    abi: BIND_POOL_ABI,
    functionName: "bindPool",
    args: [[
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      graphBundle.pool.fee,
      graphBundle.pool.tickSpacing,
      ZERO_ADDRESS,
    ], ZERO_ADDRESS, initialSqrtPriceX96],
  });
  if (hook.initializerCalldata !== expectedHookInitializer) {
    throw new TypeError("fee hook initializer must exactly bind the graph pool and initializer");
  }
  assertLocatorList(hook.initializerAddressLocators, [
    locator(roles.tokenTargetId, 36),
    locator(roles.feeHookTargetId, 132),
    locator(roles.poolInitializerTargetId, 164),
  ], "fee hook initializer");

  if (poolInitializer.initializerCalldata !== toFunctionSelector("initializePool()")) {
    throw new TypeError("pool initializer must call initializePool() exactly once");
  }
  assertLocatorList(poolInitializer.initializerAddressLocators, [], "pool initializer");
  if (token.initializerCalldata !== "0x" || customModule.initializerCalldata !== "0x"
    || token.initializerAddressLocators.length !== 0
    || customModule.initializerAddressLocators.length !== 0) {
    throw new TypeError("token and custom module do not permit graph initializer calls in this profile");
  }
  const customModuleIndex = graphBundle.targets.indexOf(customModule);
  const tokenIndex = graphBundle.targets.indexOf(token);
  const vaultIndex = graphBundle.targets.indexOf(vault);
  const hookIndex = graphBundle.targets.indexOf(hook);
  const initializerIndex = graphBundle.targets.indexOf(poolInitializer);
  if (!(customModuleIndex < hookIndex
    && vaultIndex < hookIndex
    && tokenIndex < initializerIndex
    && hookIndex < initializerIndex)) {
    throw new TypeError(
      "graph order must deploy module and vault before hook, then token and hook before pool initialization",
    );
  }
}

function buildProfileParameters(launchProfile, roles, graphBundle, predictions) {
  if (!Array.isArray(graphBundle?.targets) || !Array.isArray(predictions)) {
    throw new TypeError("launchProfile binding requires a resolved graph and CREATE2 predictions");
  }
  const targets = new Map(graphBundle.targets.map((target) => [target.targetId, target]));
  const addresses = new Map(predictions.map((prediction) => [
    prediction.targetId,
    prediction.predictedAddress,
  ]));
  const token = requireRoleTarget(targets, roles.tokenTargetId, "token");
  const customModule = requireRoleTarget(
    targets,
    roles.customModuleTargetId,
    "custom module",
  );
  const vault = requireRoleTarget(targets, roles.feeVaultTargetId, "fee vault");
  const hook = requireRoleTarget(targets, roles.feeHookTargetId, "fee hook");
  const initializer = requireRoleTarget(
    targets,
    roles.poolInitializerTargetId,
    "pool initializer",
  );
  const tokenAddress = requirePredictedAddress(addresses, roles.tokenTargetId);
  const customModuleAddress = requirePredictedAddress(addresses, roles.customModuleTargetId);
  const vaultAddress = requirePredictedAddress(addresses, roles.feeVaultTargetId);
  const hookAddress = requirePredictedAddress(addresses, roles.feeHookTargetId);
  const initializerAddress = requirePredictedAddress(addresses, roles.poolInitializerTargetId);
  const initializerArguments = decodeAbiParameters([
    ADDRESS_PARAMETER,
    ADDRESS_PARAMETER,
    ADDRESS_PARAMETER,
    { type: "uint24" },
    { type: "int24" },
    { type: "uint160" },
  ], initializer.constructorArguments);
  const initialSqrtPriceX96 = BigInt(initializerArguments[5]);
  const poolId = keccak256(encodeAbiParameters([{
    type: "tuple",
    components: POOL_KEY_COMPONENTS,
  }], [[
    ZERO_ADDRESS,
    tokenAddress,
    graphBundle.pool.fee,
    graphBundle.pool.tickSpacing,
    hookAddress,
  ]]));
  const deploymentProfileHash = keccak256(encodeAbiParameters([
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    ADDRESS_PARAMETER,
    { type: "bytes32" },
    ADDRESS_PARAMETER,
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "uint128" },
  ], [
    launchProfile.feePolicy.deploymentProfileDomain,
    launchProfile.feePolicy.policyId,
    launchProfile.contractBuildBindings.compilerSettingsHash,
    launchProfile.poolManager,
    launchProfile.poolManagerRuntimeCodeHash,
    launchProfile.graphFactory,
    launchProfile.graphFactoryRuntimeCodeHash,
    hook.expectedRuntimeCodeHash,
    vault.expectedRuntimeCodeHash,
    token.expectedRuntimeCodeHash,
    customModule.expectedRuntimeCodeHash,
    0n,
  ]));
  const platformSubHash = keccak256(encodeAbiParameters([
    ADDRESS_PARAMETER,
    { type: "bytes32" },
    ADDRESS_PARAMETER,
    { type: "bytes32" },
    ADDRESS_PARAMETER,
    { type: "bytes32" },
  ], [
    hookAddress,
    hook.expectedRuntimeCodeHash,
    vaultAddress,
    vault.expectedRuntimeCodeHash,
    initializerAddress,
    initializer.expectedRuntimeCodeHash,
  ]));
  const poolSubHash = keccak256(encodeAbiParameters([
    { type: "bytes32" },
    { type: "uint160" },
    ADDRESS_PARAMETER,
    { type: "bytes32" },
  ], [poolId, initialSqrtPriceX96, tokenAddress, token.expectedRuntimeCodeHash]));
  const customSubHash = keccak256(encodeAbiParameters([
    ADDRESS_PARAMETER,
    { type: "bytes32" },
    ADDRESS_PARAMETER,
    { type: "uint128" },
  ], [customModuleAddress, customModule.expectedRuntimeCodeHash, ZERO_ADDRESS, 0n]));
  const compositionHash = keccak256(encodeAbiParameters([
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
    { type: "bytes32" },
  ], [
    launchProfile.feePolicy.compositionDomain,
    deploymentProfileHash,
    platformSubHash,
    poolSubHash,
    customSubHash,
  ]));
  return {
    customDeltaAccount: ZERO_ADDRESS,
    customModuleRuntimeCodeHash: customModule.expectedRuntimeCodeHash,
    maximumCustomDeltaAbsolute: "0",
    poolId,
    initialSqrtPriceX96: initialSqrtPriceX96.toString(),
    authorizedInitializer: initializerAddress,
    tokenRuntimeCodeHash: token.expectedRuntimeCodeHash,
    feeVaultRuntimeCodeHash: vault.expectedRuntimeCodeHash,
    feeHookRuntimeCodeHash: hook.expectedRuntimeCodeHash,
    poolInitializerRuntimeCodeHash: initializer.expectedRuntimeCodeHash,
    deploymentProfileHash,
    compositionHash,
  };
}

function requireRoleTarget(targets, targetId, label) {
  const target = targets.get(targetId);
  if (target === undefined || typeof target.expectedRuntimeCodeHash !== "string"
    || !/^0x(?!0{64}$)[0-9a-f]{64}$/.test(target.expectedRuntimeCodeHash)) {
    throw new TypeError(`launchProfile ${label} target is missing its exact runtime hash`);
  }
  return target;
}

function requirePredictedAddress(addresses, targetId) {
  const value = addresses.get(targetId);
  if (typeof value !== "string") {
    throw new TypeError(`launchProfile target ${targetId} is missing its CREATE2 prediction`);
  }
  return getAddress(value);
}

function locator(targetId, byteOffset) {
  return { targetId, byteOffset, encoding: "abi-address-word" };
}

function assertLocatorList(actual, expected, label) {
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) {
    throw new TypeError(`${label} target locators do not match the closed profile`);
  }
}

function hashCanonicalDomain(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function normalizeTargetRoles(value) {
  assertExactKeys(value, [
    "tokenTargetId",
    "customModuleTargetId",
    "feeVaultTargetId",
    "feeHookTargetId",
    "poolInitializerTargetId",
  ], "launchProfile.targetRoles");
  const normalized = {
    tokenTargetId: canonicalIdentifier(value.tokenTargetId, "launchProfile.targetRoles.tokenTargetId"),
    customModuleTargetId: canonicalIdentifier(
      value.customModuleTargetId,
      "launchProfile.targetRoles.customModuleTargetId",
    ),
    feeVaultTargetId: canonicalIdentifier(
      value.feeVaultTargetId,
      "launchProfile.targetRoles.feeVaultTargetId",
    ),
    feeHookTargetId: canonicalIdentifier(
      value.feeHookTargetId,
      "launchProfile.targetRoles.feeHookTargetId",
    ),
    poolInitializerTargetId: canonicalIdentifier(
      value.poolInitializerTargetId,
      "launchProfile.targetRoles.poolInitializerTargetId",
    ),
  };
  if (new Set(Object.values(normalized)).size !== 5) {
    throw new TypeError("launchProfile target roles must reference five distinct targets");
  }
  return normalized;
}
