#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EXPECTED_SOLC = "0.8.26+commit.8a97fa7a.Emscripten.clang";
const EXPECTED_HOOK_SHA256 =
  "sha256:41294f0701d3911b740a0cea160b936cb0eea4bdf2a664e7c6674a1c1e1b519d";
const EXPECTED_FACTORY_SHA256 =
  "sha256:aa2673f4635543b5c24b140030461fe3161138d2d02d24c1c8c1830c13d60145";
const EXPECTED_LOCK_SHA256 =
  "sha256:5c9d041849aab4d1ec61249f7dab773058ee374c5282bb38145d4b67554498dc";
const EXPECTED_VAULT_DESCRIPTOR_SHA256 =
  "sha256:b3bc25d1471953ab2afd5eb5bb2261bfe39d194e4e597eeabd6bea8d445ae56a";
const EXPECTED_VAULT_STANDARD_JSON_SHA256 =
  "sha256:840f0827714818dd9cf28ce15b684eb907d58b3701d3b3a9f28d0f3be137c7d9";
const EXPECTED_VAULT_CREATION_SHA256 =
  "sha256:7b0d51612be90023839f36cf28ae56963d8146d28ff441dd2a20195d56238b81";
const EXPECTED_VAULT_RUNTIME_SHA256 =
  "sha256:980c0eec1017a7dbbd9010935107440125070a0b1fa4688bca92754e2bf1e649";
const VAULT_RELEASE_BINDING_SHA256 =
  "sha256:39ccdfdf8cd61620bf5c62bf07fb8428adbd66d2608b1cf3ad583343116d7ed9";
const VAULT_SOURCE = "src/ProgrammableSettlementFeeVaultV1.sol";
const VAULT_CONTRACT = "ProgrammableSettlementFeeVaultV1";
const GRAPH_FACTORY = "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887";
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const ENTRYPOINTS = Object.freeze([
  "src/NoBroadcastLaunchTokenV1.sol",
  "src/NoBroadcastFundingInitializerV1.sol",
  "src/ProgrammableVolumeFeeHookV2.sol",
  "src/ProgrammableVolumeFeeHookFactoryV2.sol",
]);

if (process.argv.includes("--help")) {
  process.stdout.write(`direct-native V3 no-broadcast build\n\nRequired environment:\n  PROGRAMMABLE_LAUNCH_WALLET       nonzero Ethereum address\n  PROGRAMMABLE_SOURCE_REVISION     exact lowercase 40-character public Git commit\n  PROGRAMMABLE_LAUNCH_NONCE        nonzero lowercase bytes32\n  PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH relative local PNG/JPEG/WebP/GIF path\n  PROGRAMMABLE_PROJECT_IMAGE_URI   matching canonical HTTPS, ipfs, or ar URI\n  PROGRAMMABLE_WEBSITE_URL         canonical public HTTPS project website\n  PROGRAMMABLE_X_URL               canonical https://x.com/<project_handle> profile\n\nOptional public environment:\n  PROGRAMMABLE_PUBLIC_ORIGIN       credential-free HTTPS URL\n  PROGRAMMABLE_CHECKED_AT          canonical UTC timestamp with milliseconds\n  PROGRAMMABLE_SOURCE_LINEAGE_NONCE canonical uint256 (default 1)\n  PROGRAMMABLE_QUOTE_CURRENCY      native zero address or ERC-20 address\n  PROGRAMMABLE_POOL_FEE            integer 0..999999 (default 3000)\n  PROGRAMMABLE_TICK_SPACING        integer 1..32767 (default 60)\n  PROGRAMMABLE_SELECTED_BUY_RATE   integer 0..999999 (default 1000)\n  PROGRAMMABLE_SELECTED_SELL_RATE  integer 0..999999 (default 1000)\n  PROGRAMMABLE_FUNDING_VALUE       nonzero USDC base-unit uint256 (default 30000000)\n  PROGRAMMABLE_FUNDING_VALID_AFTER uint64 earlier than now\n  PROGRAMMABLE_FUNDING_VALID_BEFORE uint64 later than now; window <=3600 seconds\n  PROGRAMMABLE_TOKEN_NAME          token display name, 1..64 UTF-8 bytes\n  PROGRAMMABLE_TOKEN_SYMBOL        token symbol, 1..16 UTF-8 bytes\n  PROGRAMMABLE_TOKEN_SUPPLY        nonzero uint256 token base units\n  PROGRAMMABLE_PROJECT_DESCRIPTION public description, 20+ characters and at most 4096 UTF-8 bytes\n  PROGRAMMABLE_DISCORD_URL         optional public HTTPS link\n  PROGRAMMABLE_TELEGRAM_URL        optional public HTTPS link\n`);
  process.exit(0);
}
if (process.argv.length !== 2) {
  throw new TypeError("build accepts only --help; configure public inputs through the documented environment");
}

const root = process.cwd();
const launchWallet = address(required("PROGRAMMABLE_LAUNCH_WALLET"), {
  label: "PROGRAMMABLE_LAUNCH_WALLET",
  nonzero: true,
});
const revision = required("PROGRAMMABLE_SOURCE_REVISION");
if (!/^[0-9a-f]{40}$/.test(revision)) {
  throw new TypeError("PROGRAMMABLE_SOURCE_REVISION must be an exact lowercase 40-character Git commit");
}
const nonce = required("PROGRAMMABLE_LAUNCH_NONCE");
if (!/^0x(?!0{64}$)[0-9a-f]{64}$/.test(nonce)) {
  throw new TypeError("PROGRAMMABLE_LAUNCH_NONCE must be a nonzero lowercase bytes32");
}
const publicOrigin = process.env.PROGRAMMABLE_PUBLIC_ORIGIN
  ?? "https://github.com/0xprogrammable/PROGRAMMABLE";
const publicOriginUrl = new URL(publicOrigin);
if (publicOriginUrl.protocol !== "https:" || publicOriginUrl.username || publicOriginUrl.password
  || publicOriginUrl.hash) {
  throw new TypeError("PROGRAMMABLE_PUBLIC_ORIGIN must be credential-free HTTPS without a fragment");
}
const checkedAt = process.env.PROGRAMMABLE_CHECKED_AT ?? new Date().toISOString();
if (new Date(checkedAt).toISOString() !== checkedAt) {
  throw new TypeError("PROGRAMMABLE_CHECKED_AT must be canonical UTC with milliseconds");
}
const sourceLineageNonce = canonicalUint(
  process.env.PROGRAMMABLE_SOURCE_LINEAGE_NONCE ?? "1",
  "PROGRAMMABLE_SOURCE_LINEAGE_NONCE",
);
const quoteCurrency = address(
  process.env.PROGRAMMABLE_QUOTE_CURRENCY ?? NATIVE_CURRENCY,
  { label: "PROGRAMMABLE_QUOTE_CURRENCY" },
);
const poolFee = boundedInteger("PROGRAMMABLE_POOL_FEE", 3000, 0, 999_999);
const tickSpacing = boundedInteger("PROGRAMMABLE_TICK_SPACING", 60, 1, 32_767);
const selectedBuy = String(boundedInteger(
  "PROGRAMMABLE_SELECTED_BUY_RATE",
  1000,
  0,
  999_999,
));
const selectedSell = String(boundedInteger(
  "PROGRAMMABLE_SELECTED_SELL_RATE",
  1000,
  0,
  999_999,
));
const fundingValue = canonicalUint(
  process.env.PROGRAMMABLE_FUNDING_VALUE ?? "30000000",
  "PROGRAMMABLE_FUNDING_VALUE",
  { nonzero: true },
);
const tokenSupply = canonicalUint(
  process.env.PROGRAMMABLE_TOKEN_SUPPLY ?? "1000000000000000000000000",
  "PROGRAMMABLE_TOKEN_SUPPLY",
  { nonzero: true },
);
const tokenName = publicText(
  process.env.PROGRAMMABLE_TOKEN_NAME ?? "No Broadcast V3 Token",
  "PROGRAMMABLE_TOKEN_NAME",
  64,
);
const tokenSymbol = publicText(
  process.env.PROGRAMMABLE_TOKEN_SYMBOL ?? "NBV3",
  "PROGRAMMABLE_TOKEN_SYMBOL",
  16,
  { whitespace: false },
);
const projectDescription = publicText(
  process.env.PROGRAMMABLE_PROJECT_DESCRIPTION ?? "Deterministic no-broadcast V3 reference launch",
  "PROGRAMMABLE_PROJECT_DESCRIPTION",
  4096,
  { multiline: true },
);
if ([...projectDescription].length < 20
  || [...projectDescription.matchAll(/[\p{L}\p{N}]/gu)].length < 8) {
  throw new TypeError(
    "PROGRAMMABLE_PROJECT_DESCRIPTION must contain at least 20 characters and 8 letters or numbers",
  );
}
const projectImage = {
  sourcePath: publicText(
    required("PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH"),
    "PROGRAMMABLE_PROJECT_IMAGE_SOURCE_PATH",
    2048,
  ),
  uri: publicText(
    required("PROGRAMMABLE_PROJECT_IMAGE_URI"),
    "PROGRAMMABLE_PROJECT_IMAGE_URI",
    2048,
  ),
};
const projectLinks = [
  ["website", required("PROGRAMMABLE_WEBSITE_URL")],
  ["x", required("PROGRAMMABLE_X_URL")],
  ["discord", process.env.PROGRAMMABLE_DISCORD_URL],
  ["telegram", process.env.PROGRAMMABLE_TELEGRAM_URL],
].filter(([, uri]) => uri !== undefined).map(([kind, uri]) => ({
  kind,
  uri: publicText(uri, `PROGRAMMABLE_${kind.toUpperCase()}_URL`, 2048),
}));
const fundingWindow = fundingAuthorizationWindow();

const solcExecutable = path.join(root, "node_modules", ".bin", "solcjs");
const compilerVersion = (await runSolc(["--version"])).stdout.trim();
if (compilerVersion !== EXPECTED_SOLC) {
  throw new TypeError(`expected exact locked solc ${EXPECTED_SOLC}, received ${compilerVersion}`);
}

const canonicalHookBytes = await readFile(path.join(root, "src/ProgrammableVolumeFeeHookV2.sol"));
const canonicalFactoryBytes = await readFile(path.join(root, "src/ProgrammableVolumeFeeHookFactoryV2.sol"));
const dependencyLockBytes = await readFile(path.join(root, "package-lock.json"));
assertDigest(canonicalHookBytes, EXPECTED_HOOK_SHA256, "canonical hook source");
assertDigest(canonicalFactoryBytes, EXPECTED_FACTORY_SHA256, "canonical factory source");
assertDigest(dependencyLockBytes, EXPECTED_LOCK_SHA256, "canonical dependency lock");

const vaultDescriptorBytes = await readFile(
  path.join(root, "release-modules/programmable-settlement-fee-vault-v1.json"),
);
const vaultStandardJsonSourceBytes = await readFile(
  path.join(root, "release-modules/programmable-settlement-fee-vault-v1.standard-json.json"),
);
assertDigest(vaultDescriptorBytes, EXPECTED_VAULT_DESCRIPTOR_SHA256, "canonical vault descriptor");
const vaultDescriptor = JSON.parse(vaultDescriptorBytes);
if (vaultDescriptor.moduleId !== "programmable:settlement-fee-vault:v1"
  || vaultDescriptor.sourceUnits?.at(-1)?.sha256
    !== "sha256:0a01ee8c22d103343d14b1d3890902e3edeecef25ea84a0f03f23a3fe8f1042b"
  || vaultDescriptor.creationBytecodeKeccak256
    !== "0xdbc32e835739b50f33a101a8927008fc46af4c11604f7a5da006e5c56288b21e"
  || vaultDescriptor.runtimeBytecodeKeccak256
    !== "0x92620fe3f83839334c9a264bea5bfcc819868ca5607cbd2260e5a9664dbd7554") {
  throw new TypeError("canonical settlement fee vault release descriptor differs");
}
const vaultStandardJson = JSON.parse(vaultStandardJsonSourceBytes);
const vaultStandardJsonBytes = Buffer.from(JSON.stringify(vaultStandardJson), "utf8");
if (vaultStandardJsonBytes.byteLength !== 119_921) {
  throw new TypeError("canonical settlement fee vault Standard JSON length differs");
}
assertDigest(
  vaultStandardJsonBytes,
  EXPECTED_VAULT_STANDARD_JSON_SHA256,
  "canonical settlement fee vault Standard JSON",
);

const sources = await collectSoliditySources(ENTRYPOINTS);
const standardJson = {
  language: "Solidity",
  sources: Object.fromEntries([...sources.entries()]
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([sourceName, content]) => [sourceName, { content }])),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    viaIR: true,
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
        "": ["ast"],
      },
    },
  },
};
const standardJsonBytes = Buffer.from(`${JSON.stringify(standardJson)}\n`, "utf8");
const standardJsonPath = path.join(root, "standard-json/direct-native-v3.json");
const compilerOutputPath = path.join(root, "standard-json/.direct-native-v3-output.json");
await mkdir(path.dirname(standardJsonPath), { recursive: true });
await writeFile(standardJsonPath, standardJsonBytes);
await runSolc(["--standard-json"], standardJsonPath, compilerOutputPath);
const compilerOutputText = await readFile(compilerOutputPath, "utf8");
const jsonStart = compilerOutputText.indexOf("{");
if (jsonStart === -1) throw new TypeError("locked solc returned no Standard JSON output");
const output = JSON.parse(compilerOutputText.slice(jsonStart));
const compilationErrors = (output.errors ?? []).filter(({ severity }) => severity === "error");
if (compilationErrors.length !== 0) {
  throw new TypeError(
    `solc failed:\n${compilationErrors.map(({ formattedMessage }) => formattedMessage).join("\n")}`,
  );
}

const vaultStandardJsonPath = path.join(
  root,
  "standard-json/programmable-settlement-fee-vault-v1.json",
);
const vaultCompilerOutputPath = path.join(
  root,
  "standard-json/.programmable-settlement-fee-vault-v1-output.json",
);
await writeFile(vaultStandardJsonPath, vaultStandardJsonBytes);
await runSolc(["--standard-json"], vaultStandardJsonPath, vaultCompilerOutputPath);
const vaultCompilerOutputText = await readFile(vaultCompilerOutputPath, "utf8");
const vaultJsonStart = vaultCompilerOutputText.indexOf("{");
if (vaultJsonStart === -1) throw new TypeError("locked solc returned no vault Standard JSON output");
const vaultOutput = JSON.parse(vaultCompilerOutputText.slice(vaultJsonStart));
const vaultCompilationErrors = (vaultOutput.errors ?? []).filter(({ severity }) => severity === "error");
if (vaultCompilationErrors.length !== 0) {
  throw new TypeError(
    `vault solc failed:\n${vaultCompilationErrors.map(({ formattedMessage }) => formattedMessage).join("\n")}`,
  );
}
const vaultCompiled = vaultOutput.contracts?.[VAULT_SOURCE]?.[VAULT_CONTRACT];
if (!vaultCompiled?.abi || !vaultCompiled?.evm?.bytecode?.object
  || !vaultCompiled?.evm?.deployedBytecode?.object) {
  throw new TypeError("canonical settlement fee vault compiler output is incomplete");
}
assertDigest(
  Buffer.from(vaultCompiled.evm.bytecode.object, "hex"),
  EXPECTED_VAULT_CREATION_SHA256,
  "canonical settlement fee vault creation bytecode",
);
assertDigest(
  Buffer.from(vaultCompiled.evm.deployedBytecode.object, "hex"),
  EXPECTED_VAULT_RUNTIME_SHA256,
  "canonical settlement fee vault runtime bytecode",
);

const selectedArtifacts = [
  artifact(output, "src/NoBroadcastLaunchTokenV1.sol", "NoBroadcastLaunchTokenV1", "token"),
  artifact(
    output,
    "src/NoBroadcastFundingInitializerV1.sol",
    "NoBroadcastFundingInitializerV1",
    "initializer",
  ),
  artifact(output, "src/ProgrammableVolumeFeeHookV2.sol", "ProgrammableVolumeFeeHookV2", "hook"),
];
selectedArtifacts.push({
  targetId: "settlement-fee-vault",
  compiled: vaultCompiled,
  value: {
    abi: vaultCompiled.abi,
    bytecode: {
      object: vaultCompiled.evm.bytecode.object,
      linkReferences: {},
    },
    deployedBytecode: {
      object: vaultCompiled.evm.deployedBytecode.object,
      linkReferences: {},
      immutableReferences: {},
    },
    metadata: {
      compiler: { version: "0.8.26+commit.8a97fa7a" },
      language: "Solidity",
      settings: {
        ...vaultStandardJson.settings,
        compilationTarget: { [VAULT_SOURCE]: VAULT_CONTRACT },
      },
    },
  },
});
const artifactBytes = new Map(selectedArtifacts.map(({ targetId, value }) => [
  targetId,
  Buffer.from(`${JSON.stringify(value)}\n`, "utf8"),
]));

await mkdir(path.join(root, "artifacts"), { recursive: true });
await mkdir(path.join(root, "evidence"), { recursive: true });
for (const [targetId, bytes] of artifactBytes) {
  await writeFile(path.join(root, `artifacts/${targetId}.json`), bytes);
}

const evidence = {
  schemaVersion: "programmable.direct-native-v3-no-broadcast-evidence.v3",
  profile: {
    profileId: "programmable.direct-native-hook-graph.v1",
    profileVersion: "3.3.0",
    profileRevision: 3,
    productionLaunchAuthorized: true,
  },
  scope: {
    compile: true,
    pack: false,
    validate: false,
    submit: false,
    fundingSignature: false,
    routerTransaction: false,
    walletBroadcast: false,
    stopAt: "pre-pack",
  },
  compilerVersion,
  compilerSettings: {
    evmVersion: "cancun",
    optimizerEnabled: true,
    optimizerRuns: 200,
    viaIR: true,
    metadataBytecodeHash: "none",
    appendCBOR: false,
  },
  checkedAt,
  sourceRevision: revision,
  canonicalHookSourceSha256: sha256(canonicalHookBytes),
  canonicalFactorySourceSha256: sha256(canonicalFactoryBytes),
  dependencyLockSha256: sha256(dependencyLockBytes),
  standardJsonSha256: sha256(standardJsonBytes),
  canonicalSettlementFeeModule: {
    moduleId: "programmable:settlement-fee-vault:v1",
    releaseBindingSha256: VAULT_RELEASE_BINDING_SHA256,
    standardJsonSha256: sha256(vaultStandardJsonBytes),
    creationBytecodeSha256: EXPECTED_VAULT_CREATION_SHA256,
    runtimeBytecodeSha256: EXPECTED_VAULT_RUNTIME_SHA256,
    routeTargetId: "initializer",
    reciprocalLocatorPhase: "constructor",
  },
  artifacts: Object.fromEntries([...artifactBytes].map(([targetId, bytes]) => [targetId, sha256(bytes)])),
  targetCount: 4,
  declaredHookPermissionMask: "0x20cc",
  fundingSignaturePatch: {
    targetId: "initializer",
    schemaVersion: "programmable.eip3009-authorization-patch.v2",
    nonceArgumentPath: [0, 4],
    rArgumentPath: [0, 5, 0],
    sArgumentPath: [0, 5, 1],
    vArgumentPath: [0, 5, 2],
    noncePresent: false,
    signaturePresent: false,
  },
};
const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await writeFile(path.join(root, "evidence/rehearsal.json"), evidenceBytes, { mode: 0o600 });

const initializerRuntimeImmutables = runtimeImmutablesForInitializer(
  output,
  selectedArtifacts[1].compiled,
);
const hookRuntimeImmutables = runtimeImmutablesForHook(output, selectedArtifacts[2].compiled, quoteCurrency);
const config = {
  schemaVersion: "programmable.launch-pack-config.v3",
  launchWallet,
  chainId: "1",
  nonce,
  source: {
    root: ".",
    paths: ["package-lock.json", "release-modules", "src"],
    sourceLineageNonce,
    publicOrigin: { url: publicOriginUrl.toString(), revision },
  },
  compilationUnits: [
    {
      compilationUnitId: "canonical-settlement-fee-vault-v1",
      standardJson: "standard-json/programmable-settlement-fee-vault-v1.json",
    },
    { compilationUnitId: "direct-native-v3-solc", standardJson: "standard-json/direct-native-v3.json" },
  ],
  targets: [
    {
      targetId: "initializer",
      compilationUnitId: "direct-native-v3-solc",
      artifact: "artifacts/initializer.json",
      applicantSalt: `0x${"01".repeat(32)}`,
      constructorArguments: [{ target: "settlement-fee-vault" }],
      initializer: {
        function: "initialize",
        arguments: [[
          launchWallet,
          fundingValue,
          fundingWindow.validAfter,
          fundingWindow.validBefore,
          ZERO_BYTES32,
          [ZERO_BYTES32, ZERO_BYTES32, 0],
        ]],
      },
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "other",
      declaredHookPermissions: null,
      runtimeImmutables: initializerRuntimeImmutables,
    },
    {
      targetId: "token",
      compilationUnitId: "direct-native-v3-solc",
      artifact: "artifacts/token.json",
      applicantSalt: `0x${"02".repeat(32)}`,
      constructorArguments: [tokenName, tokenSymbol, tokenSupply, launchWallet],
      initializer: null,
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "token",
      declaredHookPermissions: null,
      runtimeImmutables: [],
    },
    {
      targetId: "hook",
      compilationUnitId: "direct-native-v3-solc",
      artifact: "artifacts/hook.json",
      applicantSalt: {
        mode: "deterministic-hook-permission-grind-v1",
        start: "0",
        maxAttempts: "262144",
      },
      constructorArguments: [POOL_MANAGER, { target: "initializer" }, quoteCurrency],
      initializer: null,
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "hook",
      declaredHookPermissions: [
        "beforeInitialize",
        "beforeSwap",
        "afterSwap",
        "beforeSwapReturnDelta",
        "afterSwapReturnDelta",
      ],
      runtimeImmutables: hookRuntimeImmutables,
    },
    {
      targetId: "settlement-fee-vault",
      compilationUnitId: "canonical-settlement-fee-vault-v1",
      artifact: "artifacts/settlement-fee-vault.json",
      applicantSalt: `0x${"04".repeat(32)}`,
      constructorArguments: [GRAPH_FACTORY],
      initializer: {
        function: "bindRoute",
        arguments: [{ target: "initializer" }],
      },
      deploymentValueWei: "0",
      initializerValueWei: "0",
      componentKind: "other",
      declaredHookPermissions: null,
      runtimeImmutables: [],
    },
  ],
  pool: {
    tokenTargetId: "token",
    hookTargetId: "hook",
    fee: poolFee,
    tickSpacing,
    quoteCurrency,
  },
  projectMetadata: {
    schemaVersion: "programmable.project-metadata-input.v1",
    token: { name: tokenName, symbol: tokenSymbol },
    presentation: {
      description: projectDescription,
      image: projectImage,
      links: projectLinks,
    },
  },
  launchProfile: {
    schemaVersion: "programmable.direct-native-hook-graph-profile-selection.v3",
    profileId: "programmable.direct-native-hook-graph.v1",
    profileRevision: 3,
    targetRoles: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      initializerTargetId: "initializer",
      platformFeeBindingTargetId: "settlement-fee-vault",
    },
    liquidityModel: {
      schemaVersion: "programmable.direct-native-liquidity-model-intent.v1",
      model: "external-concentrated-liquidity",
      declaredLaunchState: "liquidity_required",
    },
    fundingMode: "eip-3009-receive-with-authorization",
    accountingMode: "inclusive-selected-total",
    assessmentBase: "executed-gross-declared-quote",
    feeCurrency: "declared-quote-currency",
    claimMode: "claim-authority-selected-recipient",
    applicantSelectedBuyHundredthsOfBip: selectedBuy,
    applicantSelectedSellHundredthsOfBip: selectedSell,
  },
  permitWindow: {
    validAfter: fundingWindow.validAfter,
    deadline: fundingWindow.validBefore,
  },
  fundingAuthorization: {
    schemaVersion: "programmable.funding-authorization-input.v1",
    method: "eip-3009-receive-with-authorization",
    value: fundingValue,
    validAfter: fundingWindow.validAfter,
    validBefore: fundingWindow.validBefore,
  },
  fundingSignaturePatch: {
    targetId: "initializer",
    nonceArgumentPath: [0, 4],
    rArgumentPath: [0, 5, 0],
    sArgumentPath: [0, 5, 1],
    vArgumentPath: [0, 5, 2],
  },
  agentAttestation: {
    agentId: "programmable-direct-native-v3-no-broadcast",
    checkedAt,
    checks: [
      { checkId: "exact-build-no-broadcast-rehearsal", evidence: "evidence/rehearsal.json" },
    ],
  },
};
await writeFile(
  path.join(root, "programmable-launch.config.json"),
  `${JSON.stringify(config, null, 2)}\n`,
  { mode: 0o600 },
);

process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.direct-native-v3-config-result.v3",
  profileId: config.launchProfile.profileId,
  profileVersion: "3.3.0",
  profileRevision: config.launchProfile.profileRevision,
  productionLaunchAuthorized: true,
  configPath: path.join(root, "programmable-launch.config.json"),
  standardJsonPath: path.join(root, "standard-json/direct-native-v3.json"),
  evidencePath: path.join(root, "evidence/rehearsal.json"),
  compilerVersion,
  sourceCount: Object.keys(standardJson.sources).length,
  targetCount: config.targets.length,
  hookRuntimeImmutableCount: hookRuntimeImmutables.length,
  fundingSignaturePresent: false,
  submit: false,
  walletBroadcast: false,
  next: "programmable-launch pack, then programmable-launch validate",
}, null, 2)}\n`);

async function collectSoliditySources(entrypoints) {
  const collected = new Map();
  const pending = [...entrypoints];
  while (pending.length !== 0) {
    const sourceName = pending.shift();
    if (collected.has(sourceName)) continue;
    if (path.posix.isAbsolute(sourceName) || sourceName === ".." || sourceName.startsWith("../")) {
      throw new TypeError(`unsafe Solidity source name ${sourceName}`);
    }
    const content = await readSoliditySource(sourceName);
    collected.set(sourceName, content);
    for (const specifier of solidityImports(content)) {
      const imported = specifier.startsWith(".")
        ? path.posix.normalize(path.posix.join(path.posix.dirname(sourceName), specifier))
        : path.posix.normalize(specifier);
      if (imported === ".." || imported.startsWith("../") || path.posix.isAbsolute(imported)) {
        throw new TypeError(`unsafe Solidity import ${specifier} from ${sourceName}`);
      }
      if (!collected.has(imported) && !pending.includes(imported)) pending.push(imported);
    }
  }
  return collected;
}

async function readSoliditySource(sourceName) {
  const local = path.join(root, ...sourceName.split("/"));
  try {
    return await readFile(local, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const dependency = path.join(root, "node_modules", ...sourceName.split("/"));
  try {
    return await readFile(dependency, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new TypeError(`Solidity dependency ${sourceName} is absent; run npm ci first`);
    }
    throw error;
  }
}

function solidityImports(content) {
  const imports = [];
  const pattern = /^\s*import\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']\s*;/gmu;
  for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
    imports.push(match[1]);
  }
  return imports;
}

function artifact(compilerOutput, sourceName, contractName, targetId) {
  const compiled = compilerOutput.contracts?.[sourceName]?.[contractName];
  if (!compiled?.abi || !compiled?.metadata || !compiled?.evm?.bytecode?.object
    || !compiled?.evm?.deployedBytecode?.object) {
    throw new TypeError(`compiler output is incomplete for ${sourceName}:${contractName}`);
  }
  return {
    targetId,
    compiled,
    value: {
      abi: compiled.abi,
      bytecode: compiled.evm.bytecode,
      deployedBytecode: compiled.evm.deployedBytecode,
      metadata: compiled.metadata,
    },
  };
}

function runtimeImmutablesForHook(compilerOutput, compiledHook, quoteCurrencyAddress) {
  const declarations = new Map();
  for (const source of Object.values(compilerOutput.sources ?? {})) walkAst(source.ast, declarations);
  const references = compiledHook.evm.deployedBytecode.immutableReferences ?? {};
  return Object.keys(references).sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1)
    .map((immutableId) => {
      const declaration = declarations.get(immutableId);
      if (!declaration) throw new TypeError(`compiler immutable ${immutableId} has no AST declaration`);
      if (declaration.name === "poolManager") {
        return { immutableId, abiType: "address", literal: POOL_MANAGER };
      }
      if (declaration.name === "registrar") {
        return { immutableId, abiType: "address", target: "initializer" };
      }
      if (declaration.name === "quoteCurrencyAddress") {
        return { immutableId, abiType: "address", literal: quoteCurrencyAddress };
      }
      throw new TypeError(
        `unmapped hook immutable ${immutableId} (${declaration.name}); do not guess runtime materialization`,
      );
    });
}

function runtimeImmutablesForInitializer(compilerOutput, compiledInitializer) {
  const declarations = new Map();
  for (const source of Object.values(compilerOutput.sources ?? {})) walkAst(source.ast, declarations);
  const references = compiledInitializer.evm.deployedBytecode.immutableReferences ?? {};
  return Object.keys(references).sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1)
    .map((immutableId) => {
      const declaration = declarations.get(immutableId);
      if (!declaration) throw new TypeError(`compiler immutable ${immutableId} has no AST declaration`);
      if (declaration.name === "settlementFeeVault") {
        return { immutableId, abiType: "address", target: "settlement-fee-vault" };
      }
      throw new TypeError(
        `unmapped initializer immutable ${immutableId} (${declaration.name}); do not guess runtime materialization`,
      );
    });
}

function walkAst(node, declarations) {
  if (node === null || typeof node !== "object") return;
  if (node.nodeType === "VariableDeclaration" && node.mutability === "immutable"
    && Number.isSafeInteger(node.id) && typeof node.name === "string") {
    declarations.set(String(node.id), { name: node.name, type: node.typeDescriptions?.typeString ?? null });
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, declarations);
    } else if (value !== null && typeof value === "object") {
      walkAst(value, declarations);
    }
  }
}

function fundingAuthorizationWindow() {
  const now = Math.floor(Date.now() / 1000);
  const afterRaw = process.env.PROGRAMMABLE_FUNDING_VALID_AFTER;
  const beforeRaw = process.env.PROGRAMMABLE_FUNDING_VALID_BEFORE;
  if ((afterRaw === undefined) !== (beforeRaw === undefined)) {
    throw new TypeError("set both funding validity bounds or neither");
  }
  const validAfter = canonicalUint64(afterRaw ?? String(now - 60), "PROGRAMMABLE_FUNDING_VALID_AFTER");
  const validBefore = canonicalUint64(beforeRaw ?? String(now + 3540), "PROGRAMMABLE_FUNDING_VALID_BEFORE");
  if (!(BigInt(validAfter) < BigInt(now) && BigInt(now) < BigInt(validBefore))) {
    throw new TypeError("funding validity requires validAfter < now < validBefore");
  }
  if (BigInt(validBefore) - BigInt(validAfter) > 3600n) {
    throw new TypeError("funding validity window must not exceed 3600 seconds");
  }
  return { validAfter, validBefore };
}

function canonicalUint64(value, label) {
  const normalized = canonicalUint(value, label);
  if (BigInt(normalized) >= 1n << 64n) throw new TypeError(`${label} must fit uint64`);
  return normalized;
}

function canonicalUint(value, label, { nonzero = false } = {}) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)
    || BigInt(value) >= 1n << 256n || (nonzero && value === "0")) {
    throw new TypeError(`${label} must be a canonical ${nonzero ? "nonzero " : ""}uint256`);
  }
  return value;
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) throw new TypeError(`${name} must be a canonical integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function address(value, { label, nonzero = false }) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)
    || (nonzero && /^0x0{40}$/i.test(value))) {
    throw new TypeError(`${label} must be a ${nonzero ? "nonzero " : ""}Ethereum address`);
  }
  return value;
}

function publicText(value, label, maximumBytes, {
  empty = false,
  multiline = false,
  whitespace = true,
} = {}) {
  if (typeof value !== "string" || value !== value.normalize("NFC") || value.trim() !== value
    || (!empty && value.length === 0) || Buffer.byteLength(value, "utf8") > maximumBytes
    || (multiline
      ? /[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(value)
      : /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(value))
    || (!whitespace && /\s/u.test(value))) {
    throw new TypeError(`${label} must be canonical public text within ${maximumBytes} UTF-8 bytes`);
  }
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

function assertDigest(bytes, expected, label) {
  const actual = sha256(bytes);
  if (actual !== expected) throw new TypeError(`${label} differs: expected ${expected}, received ${actual}`);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function runSolc(args, inputPath = null, outputPath = null) {
  const inputHandle = inputPath === null ? null : await open(inputPath, "r");
  const outputHandle = outputPath === null ? null : await open(outputPath, "w", 0o600);
  return new Promise((resolve, reject) => {
    const child = spawn(solcExecutable, args, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${path.dirname(solcExecutable)}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdio: [inputHandle?.fd ?? "ignore", outputHandle?.fd ?? "pipe", "pipe"],
    });
    void inputHandle?.close();
    void outputHandle?.close();
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new TypeError("locked solcjs is absent; run npm ci before npm run build"));
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new TypeError(`locked solcjs exited ${String(code)}: ${stderr.trim()}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
