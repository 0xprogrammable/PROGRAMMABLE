import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { getAddress, keccak256, stringToHex } from "viem";

export const EMPTY_STORAGE_WORD = `0x${"00".repeat(32)}`;

export const EIP1967_SLOTS = Object.freeze({
  implementation:
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin:
    "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  beacon:
    "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
});

export const HOOKLIST_REPOSITORY = "Uniswap/hooklist";
export const HOOKLIST_ISSUE_TEMPLATE = "submit-hook.yml";
export const HOOKLIST_URL = "https://github.com/Uniswap/hooklist";
export const ROUTING_ALLOWLIST_URL =
  "https://share.hsforms.com/15fMHwt6NTzuKuQdxw6nHwws8pgg";

const HOOK_PERMISSION_BITS = Object.freeze([
  ["beforeInitialize", 13n],
  ["afterInitialize", 12n],
  ["beforeAddLiquidity", 11n],
  ["afterAddLiquidity", 10n],
  ["beforeRemoveLiquidity", 9n],
  ["afterRemoveLiquidity", 8n],
  ["beforeSwap", 7n],
  ["afterSwap", 6n],
  ["beforeDonate", 5n],
  ["afterDonate", 4n],
  ["beforeSwapReturnsDelta", 3n],
  ["afterSwapReturnsDelta", 2n],
  ["afterAddLiquidityReturnsDelta", 1n],
  ["afterRemoveLiquidityReturnsDelta", 0n],
]);

const SOURCE_PERMISSION_KEYS = Object.freeze({
  beforeInitialize: "beforeInitialize",
  afterInitialize: "afterInitialize",
  beforeAddLiquidity: "beforeAddLiquidity",
  afterAddLiquidity: "afterAddLiquidity",
  beforeRemoveLiquidity: "beforeRemoveLiquidity",
  afterRemoveLiquidity: "afterRemoveLiquidity",
  beforeSwap: "beforeSwap",
  afterSwap: "afterSwap",
  beforeDonate: "beforeDonate",
  afterDonate: "afterDonate",
  beforeSwapReturnDelta: "beforeSwapReturnsDelta",
  afterSwapReturnDelta: "afterSwapReturnsDelta",
  afterAddLiquidityReturnDelta: "afterAddLiquidityReturnsDelta",
  afterRemoveLiquidityReturnDelta: "afterRemoveLiquidityReturnsDelta",
});

const FINAL_RELEASE_STATUSES = new Set([
  "deployment-and-source-verified",
  "deployment-source-and-lifecycle-verified",
]);

const FINAL_APP_STATUSES = new Set(["ready", "active", "enabled"]);
const VERIFIED_SOURCE_STATUSES = new Set([
  "exact-match",
  "exact_match",
  "match",
  "perfect",
  "perfect-match",
  "verified",
]);
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalAddress(value, label) {
  assert(
    typeof value === "string" && ADDRESS_PATTERN.test(value),
    `${label} must be an Ethereum address`,
  );
  return getAddress(value);
}

function normalizeHex(value) {
  return String(value ?? "").toLowerCase();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function releaseDigest(value) {
  return keccak256(stringToHex(JSON.stringify(stableValue(value))));
}

function normalizedVerificationStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isVerifiedSourceStatus(value) {
  return VERIFIED_SOURCE_STATUSES.has(normalizedVerificationStatus(value));
}

function stripSolidityComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n\r]*/g, "");
}

function sourceSecurityReview(sourceText) {
  assert(
    typeof sourceText === "string" && sourceText.trim().length > 0,
    "Verified hook source is required",
  );
  const source = stripSolidityComments(sourceText);

  const upgradeSignals = [
    /\bUUPSUpgradeable\b/,
    /\bInitializable\b/,
    /\bTransparentUpgradeableProxy\b/,
    /\bUpgradeableBeacon\b/,
    /\bERC1967Upgrade\b/,
    /\b_authorizeUpgrade\b/,
    /\bupgradeTo(?:AndCall)?\b/,
  ].filter((pattern) => pattern.test(source));
  if (upgradeSignals.length > 0) {
    throw new Error(
      "Verified hook source contains an upgradeable or upgrade control signal",
    );
  }

  const proxySignals = [
    /\bdelegatecall\b/i,
    /\bProxyAdmin\b/,
    /\bBeaconProxy\b/,
    /\bERC1967Proxy\b/,
    /\bcontract\s+\w*Proxy\b/,
  ].filter((pattern) => pattern.test(source));
  if (proxySignals.length > 0) {
    throw new Error("Verified hook source contains a proxy or DELEGATECALL");
  }

  const adminSignals = [
    /\bOwnable(?:2Step)?\b/,
    /\bAccessControl\b/,
    /\bonlyOwner\b/,
    /\bonlyAdmin\b/,
    /\bDEFAULT_ADMIN_ROLE\b/,
    /\btransferOwnership\b/,
    /\brenounceOwnership\b/,
    /\bchangeAdmin\b/,
    /\bsetAdmin\b/,
    /(?:^|[;{}])\s*address(?:\s+payable)?\s+(?:(?:public|private|internal)\s+)?(?:immutable\s+)?_?(?:admin|owner)\s*(?:=|;)/m,
  ].filter((pattern) => pattern.test(source));
  if (adminSignals.length > 0) {
    throw new Error(
      "Verified hook source contains an owner or administrative control",
    );
  }

  if (/\bselfdestruct\b/i.test(source)) {
    throw new Error("Verified hook source contains SELFDESTRUCT");
  }

  return {
    upgradeable: false,
    proxy: false,
    administrativeControl: false,
    delegatecall: false,
    selfdestruct: false,
  };
}

function sourceHookPermissions(sourceText) {
  const source = stripSolidityComments(sourceText);
  const functionStart = source.search(/\bfunction\s+getHookPermissions\s*\(/);
  assert(
    functionStart >= 0,
    "Verified hook source must expose getHookPermissions",
  );
  const functionSource = source.slice(functionStart);
  const constructor = functionSource.match(
    /Hooks\.Permissions\s*\(\s*\{([\s\S]*?)\}\s*\)/,
  );
  assert(
    constructor,
    "getHookPermissions must return an explicit Hooks.Permissions struct",
  );

  const permissions = {};
  for (const [sourceKey, outputKey] of Object.entries(
    SOURCE_PERMISSION_KEYS,
  )) {
    const match = constructor[1].match(
      new RegExp(`\\b${sourceKey}\\s*:\\s*(true|false)\\b`),
    );
    assert(
      match,
      `getHookPermissions is missing explicit ${sourceKey}`,
    );
    permissions[outputKey] = match[1] === "true";
  }
  return permissions;
}

export function decodeHookPermissions(hookAddress) {
  const canonical = canonicalAddress(hookAddress, "Hook address");
  const mask = BigInt(canonical) & ((1n << 14n) - 1n);
  return Object.fromEntries(
    HOOK_PERMISSION_BITS.map(([name, bit]) => [
      name,
      (mask & (1n << bit)) !== 0n,
    ]),
  );
}

export function validateHookPermissionDependencies(permissions) {
  const dependencies = [
    ["beforeSwapReturnsDelta", "beforeSwap"],
    ["afterSwapReturnsDelta", "afterSwap"],
    ["afterAddLiquidityReturnsDelta", "afterAddLiquidity"],
    ["afterRemoveLiquidityReturnsDelta", "afterRemoveLiquidity"],
  ];
  for (const [child, parent] of dependencies) {
    if (permissions?.[child] && !permissions?.[parent]) {
      throw new Error(`${child} requires ${parent}`);
    }
  }
  return permissions;
}

function parseSolidityImports(sourceText) {
  const imports = [];
  const expression =
    /\bimport\s+(?:(?:[^"']*?\sfrom\s*)?["']([^"']+)["'])\s*;/g;
  for (const match of sourceText.matchAll(expression)) imports.push(match[1]);
  return imports;
}

function parseFoundryRemappings(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      assert(separator > 0, `Invalid Foundry remapping: ${line}`);
      return {
        prefix: line.slice(0, separator),
        target: line.slice(separator + 1),
      };
    })
    .sort((left, right) => right.prefix.length - left.prefix.length);
}

export async function loadSoliditySourceClosure({
  entryPath,
  contractsRoot,
}) {
  const canonicalRoot = await realpath(contractsRoot);
  const rootPrefix = `${canonicalRoot}${path.sep}`;
  let remappingText = "";
  try {
    remappingText = await readFile(
      path.join(canonicalRoot, "remappings.txt"),
      "utf8",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const remappings = parseFoundryRemappings(remappingText);
  const sources = new Map();

  function unresolvedImport(importPath, importer) {
    throw new Error(
      `Could not resolve Solidity import ${importPath} from ${path.relative(
        canonicalRoot,
        importer,
      )}`,
    );
  }

  async function resolveImport(importPath, importer) {
    let candidate;
    if (importPath.startsWith(".")) {
      candidate = path.resolve(path.dirname(importer), importPath);
    } else {
      const remapping = remappings.find(({ prefix }) =>
        importPath.startsWith(prefix),
      );
      candidate = remapping
        ? path.resolve(
            canonicalRoot,
            remapping.target,
            importPath.slice(remapping.prefix.length),
          )
        : path.resolve(canonicalRoot, importPath);
    }
    let canonical;
    try {
      canonical = await realpath(candidate);
    } catch {
      unresolvedImport(importPath, importer);
    }
    if (
      canonical !== canonicalRoot &&
      !canonical.startsWith(rootPrefix)
    ) {
      throw new Error(`Solidity import leaves contracts root: ${importPath}`);
    }
    return canonical;
  }

  async function visit(file) {
    const canonical = await realpath(file);
    if (
      canonical !== canonicalRoot &&
      !canonical.startsWith(rootPrefix)
    ) {
      throw new Error(`Solidity source leaves contracts root: ${file}`);
    }
    if (sources.has(canonical)) return;
    const content = await readFile(canonical, "utf8");
    sources.set(canonical, content);
    for (const importPath of parseSolidityImports(content)) {
      await visit(await resolveImport(importPath, canonical));
    }
  }

  const canonicalEntry = await realpath(entryPath);
  await visit(canonicalEntry);
  const ordered = [...sources.entries()]
    .map(([file, content]) => ({
      path: path.relative(canonicalRoot, file).replaceAll("\\", "/"),
      content,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    entryText: sources.get(canonicalEntry),
    sources: ordered,
    bundleText: ordered
      .map(
        ({ path: sourcePath, content }) =>
          `// Source: ${sourcePath}\n${content}`,
      )
      .join("\n\n"),
  };
}

function validateSourcePermissionMatch(sourceText, addressPermissions) {
  const declared = sourceHookPermissions(sourceText);
  for (const [name] of HOOK_PERMISSION_BITS) {
    if (declared[name] !== addressPermissions[name]) {
      throw new Error(
        `Hook address permission ${name} does not match verified source`,
      );
    }
  }
  return declared;
}

function validateVerifiedContractDeclaration(sourceText, verifiedFqcn) {
  if (!verifiedFqcn) return;
  const [, contractName] = verifiedFqcn.split(":");
  const escapedName = contractName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(
    `\\b(?:abstract\\s+)?contract\\s+${escapedName}\\b`,
  );
  assert(
    declaration.test(stripSolidityComments(sourceText)),
    `Local source does not declare verified contract ${contractName}`,
  );
}

function releaseId(manifest, manifestPath) {
  if (
    typeof manifest.releaseVersion === "string" &&
    manifest.releaseVersion.length > 0
  ) {
    return manifest.releaseVersion;
  }
  return path.basename(manifestPath, path.extname(manifestPath));
}

function deploymentRecord(manifest) {
  const record =
    manifest.deploymentEvidence?.feeHook ?? manifest.transactions?.feeHook;
  assert(record, "Hook deployment transaction evidence is required");
  assert(
    typeof record.transactionHash === "string" &&
      HASH_PATTERN.test(record.transactionHash),
    "Hook deployment transaction hash is invalid",
  );
  assert(
    Number.isSafeInteger(record.blockNumber) && record.blockNumber > 0,
    "Hook deployment block is invalid",
  );
  if ("receiptStatus" in record) {
    assert(
      record.receiptStatus === "success",
      "Hook deployment receipt must be successful",
    );
  }
  return {
    transactionHash: normalizeHex(record.transactionHash),
    blockNumber: record.blockNumber,
    receiptStatus: record.receiptStatus ?? "verified-by-release-manifest",
  };
}

function sourceVerification(manifest, hookAddress) {
  const source = manifest.sourceVerification;
  assert(source && typeof source === "object", "Source verification is required");

  const detailed = source.contracts?.feeHook;
  const etherscanStatus =
    detailed?.etherscan?.status ?? source.etherscan?.feeHook;
  const sourcifyStatus =
    detailed?.sourcify?.status ??
    (source.provider === "Sourcify" ? detailed?.status : undefined);

  assert(
    isVerifiedSourceStatus(etherscanStatus),
    "Etherscan source verification is required",
  );
  assert(
    isVerifiedSourceStatus(sourcifyStatus),
    "Sourcify source verification is required",
  );

  const lowerAddress = hookAddress.toLowerCase();
  const etherscanUrl =
    detailed?.etherscan?.url ??
    `https://etherscan.io/address/${hookAddress}#code`;
  const sourcifyUrl =
    detailed?.sourcify?.url ??
    `https://repo.sourcify.dev/contracts/full_match/1/${hookAddress}/`;
  assert(
    etherscanUrl.toLowerCase().includes(lowerAddress),
    "Etherscan verification URL does not match the hook address",
  );
  assert(
    sourcifyUrl.toLowerCase().includes(lowerAddress),
    "Sourcify verification URL does not match the hook address",
  );

  return {
    verified: true,
    fqcn: detailed?.fqcn ?? null,
    etherscan: {
      status: normalizedVerificationStatus(etherscanStatus),
      url: etherscanUrl,
    },
    sourcify: {
      status: normalizedVerificationStatus(sourcifyStatus),
      url: sourcifyUrl,
      verificationJob: detailed?.verificationJob ?? null,
    },
  };
}

export function validateHookReleaseManifest(manifest, manifestPath) {
  assert(manifest && typeof manifest === "object", "Release manifest is required");
  assert(manifest.chainId === 1, "Only an Ethereum Mainnet manifest is accepted");
  const isDeep = manifest.model === "deep";
  if (isDeep || "releaseEligible" in manifest) {
    assert(manifest.releaseEligible === true, "releaseEligible must be true");
  }
  assert(
    FINAL_RELEASE_STATUSES.has(manifest.status),
    "Manifest is not in a final deployment/source release status",
  );
  assert(
    typeof manifest.releaseCommit === "string" &&
      /^[0-9a-f]{40}$/i.test(manifest.releaseCommit),
    "Release commit is required",
  );
  assert(
    typeof manifest.sourceCommitment === "string" &&
      HASH_PATTERN.test(manifest.sourceCommitment),
    "Source commitment is required",
  );

  const lifecycle = manifest.lifecycleEvidence;
  if (isDeep) {
    assert(
      /^deep-full-range-v[1-9][0-9]*$/.test(manifest.releaseVersion ?? ""),
      "Deep releaseVersion is invalid",
    );
    assert(
      FINAL_APP_STATUSES.has(manifest.activation?.appStatus),
      "Deep app activation must be ready",
    );
    assert(
      Array.isArray(manifest.blockers) && manifest.blockers.length === 0,
      "Deep release blockers must be empty",
    );
  }

  assert(
    lifecycle?.status === "verified-current-release",
    "Current lifecycle evidence is required",
  );
  assert(
    lifecycle.releaseEligible === true,
    "Lifecycle evidence must be release eligible",
  );
  assert(
    Number(lifecycle.independentRpcCount) >= 2,
    "Lifecycle evidence requires two independent RPCs",
  );

  const hookAddress = canonicalAddress(
    manifest.addresses?.feeHook,
    "Manifest fee hook address",
  );
  const runtimeCodeHash = normalizeHex(
    manifest.runtimeCodeHashes?.feeHook,
  );
  assert(
    HASH_PATTERN.test(runtimeCodeHash),
    "Manifest fee hook runtime code hash is invalid",
  );

  const deployment = deploymentRecord(manifest);
  const verification = sourceVerification(manifest, hookAddress);

  if (verification.fqcn) {
    const [fqcnPath, contractName] = verification.fqcn.split(":");
    assert(
      fqcnPath && contractName,
      "Verified source FQCN is invalid",
    );
  }

  return {
    releaseId: releaseId(manifest, manifestPath),
    isDeep,
    hookAddress,
    runtimeCodeHash,
    deployment,
    sourceVerification: verification,
    deployer: canonicalAddress(
      manifest.addresses?.deployer,
      "Manifest deployer",
    ),
    releaseCommit: manifest.releaseCommit.toLowerCase(),
    sourceCommitment: normalizeHex(manifest.sourceCommitment),
  };
}

function validateMetadata(metadata, verifiedFqcn) {
  assert(metadata && typeof metadata === "object", "Hook metadata is required");
  assert(
    typeof metadata.name === "string" &&
      metadata.name.trim().length >= 1 &&
      metadata.name.trim().length <= 100,
    "Hook name must be between 1 and 100 characters",
  );
  assert(
    typeof metadata.description === "string" &&
      metadata.description.length <= 500,
    "Hook description must be at most 500 characters",
  );
  assert(
    typeof metadata.sourcePath === "string" &&
      metadata.sourcePath.trim().length > 0,
    "Local verified source path is required",
  );
  if (verifiedFqcn) {
    const [fqcnPath] = verifiedFqcn.split(":");
    const normalizedSource = metadata.sourcePath.replaceAll("\\", "/");
    assert(
      normalizedSource.endsWith(fqcnPath),
      "Local source path does not match the verified source FQCN",
    );
  }

  const auditUrl = metadata.auditUrl ?? "";
  assert(
    auditUrl === "" ||
      (typeof auditUrl === "string" && auditUrl.startsWith("https://")),
    "Audit URL must be empty or HTTPS",
  );
  const properties = metadata.properties;
  assert(properties && typeof properties === "object", "Hook properties are required");
  for (const name of [
    "dynamicFee",
    "requiresCustomSwapData",
    "vanillaSwap",
  ]) {
    assert(
      typeof properties[name] === "boolean",
      `${name} must be explicitly true or false`,
    );
  }
  assert(
    ["none", "temporal", "allowlist", "governance", "other"].includes(
      properties.swapAccess,
    ),
    "swapAccess is invalid",
  );

  return {
    name: metadata.name.trim(),
    description: metadata.description.trim(),
    auditUrl,
    sourcePath: metadata.sourcePath,
    properties: {
      dynamicFee: properties.dynamicFee,
      requiresCustomSwapData: properties.requiresCustomSwapData,
      vanillaSwap: properties.vanillaSwap,
      swapAccess: properties.swapAccess,
    },
  };
}

function validateRuntimeEvidence(evidence, release) {
  assert(
    evidence && typeof evidence === "object",
    "Read-only live runtime evidence is required",
  );
  assert(evidence.chainId === 1, "Runtime evidence is not Ethereum Mainnet");
  assert(
    normalizeHex(evidence.hookAddress) ===
      normalizeHex(release.hookAddress),
    "Runtime evidence hook address does not match the manifest",
  );
  assert(
    normalizeHex(evidence.runtimeCodeHash) === release.runtimeCodeHash,
    "Live runtime code hash does not match the manifest",
  );
  assert(
    Number.isSafeInteger(evidence.observedAtBlock) &&
      evidence.observedAtBlock >= release.deployment.blockNumber,
    "Runtime evidence block predates hook deployment",
  );

  for (const slot of ["implementation", "admin", "beacon"]) {
    const value = normalizeHex(evidence.eip1967Slots?.[slot]);
    if (value !== EMPTY_STORAGE_WORD) {
      throw new Error(`EIP-1967 ${slot} slot is populated`);
    }
  }
  assert(evidence.minimalProxy === false, "Hook runtime is a minimal proxy");
  assert(
    evidence.runtimeDelegatecall === false,
    "Hook runtime contains DELEGATECALL",
  );

  return {
    chainId: 1,
    hookAddress: release.hookAddress,
    runtimeCodeHash: release.runtimeCodeHash,
    observedAtBlock: evidence.observedAtBlock,
    eip1967Slots: { ...evidence.eip1967Slots },
    minimalProxy: false,
    runtimeDelegatecall: false,
  };
}

function issueMarkdown(fields) {
  const optional = (value) => (value ? value : "_Not provided_");
  return [
    "# Submit a Hook",
    "",
    "## Chain",
    fields.chain,
    "",
    "## Hook Address",
    fields.address,
    "",
    "## Hook Name",
    fields.name,
    "",
    "## Description",
    optional(fields.description),
    "",
    "## Deployer Address",
    fields.deployer,
    "",
    "## Audit URL",
    optional(fields.audit_url),
    "",
  ].join("\n");
}

function routingMarkdown(intake) {
  const enabledFlags = Object.entries(intake.hook.flags)
    .filter(([, enabled]) => enabled)
    .map(([name]) => `- ${name}`)
    .join("\n");
  return [
    "# Uniswap routing review intake",
    "",
    "**Status: not submitted**",
    "",
    "Hooklist inclusion does not grant routing approval. This packet is for the separate Uniswap routing review only.",
    "",
    "## Hook",
    "",
    `- Name: ${intake.hook.name}`,
    `- Address: ${intake.hook.address}`,
    `- Chain: Ethereum (${intake.hook.chainId})`,
    `- Release: ${intake.release.releaseId}`,
    `- Deployment transaction: https://etherscan.io/tx/${intake.release.deploymentTransaction}`,
    "",
    "## Enabled permissions",
    "",
    enabledFlags || "- None",
    "",
    "## Declared swap behavior",
    "",
    `- Dynamic fee: ${intake.hook.properties.dynamicFee}`,
    `- Custom swap data required: ${intake.hook.properties.requiresCustomSwapData}`,
    `- Vanilla swap compatible: ${intake.hook.properties.vanillaSwap}`,
    `- Swap access: ${intake.hook.properties.swapAccess}`,
    "",
    "## Evidence",
    "",
    `- Etherscan source: ${intake.verification.etherscan}`,
    `- Sourcify source: ${intake.verification.sourcify}`,
    `- Runtime code hash: ${intake.verification.runtimeCodeHash}`,
    `- EIP-1967 slots empty: ${intake.verification.eip1967SlotsEmpty}`,
    `- Runtime proxy/delegatecall checks clear: ${intake.verification.directRuntime}`,
    "",
    "## Operator checks before submission",
    "",
    ...intake.operatorChecks.map((check) => `- [ ] ${check}`),
    "",
    `Submission form: ${intake.submissionUrl}`,
    "",
  ].join("\n");
}

export function buildUniswapHookRelease({
  manifest,
  manifestPath,
  sourceText,
  sourceBundleText = sourceText,
  metadata,
  runtimeEvidence,
}) {
  assert(
    typeof manifestPath === "string" && manifestPath.length > 0,
    "Manifest path is required",
  );
  const release = validateHookReleaseManifest(manifest, manifestPath);
  const reviewedMetadata = validateMetadata(
    metadata,
    release.sourceVerification.fqcn,
  );
  validateVerifiedContractDeclaration(
    sourceText,
    release.sourceVerification.fqcn,
  );
  const sourceReview = sourceSecurityReview(sourceBundleText);
  const permissions = validateHookPermissionDependencies(
    decodeHookPermissions(release.hookAddress),
  );
  validateSourcePermissionMatch(sourceText, permissions);
  const liveRuntime = validateRuntimeEvidence(runtimeEvidence, release);

  const hookEntry = {
    hook: {
      address: release.hookAddress,
      chain: "ethereum",
      chainId: 1,
      name: reviewedMetadata.name,
      description: reviewedMetadata.description,
      deployer: release.deployer,
      verifiedSource: true,
      auditUrl: reviewedMetadata.auditUrl,
    },
    flags: permissions,
    properties: {
      ...reviewedMetadata.properties,
      upgradeable: false,
    },
  };

  const issueFields = {
    chain: "ethereum",
    address: release.hookAddress,
    name: reviewedMetadata.name,
    description: reviewedMetadata.description,
    deployer: release.deployer,
    audit_url: reviewedMetadata.auditUrl,
  };
  const issueJson = {
    repository: HOOKLIST_REPOSITORY,
    issueTemplate: HOOKLIST_ISSUE_TEMPLATE,
    submissionStatus: "not-submitted",
    title: `hook: ${reviewedMetadata.name}`,
    fields: issueFields,
  };

  const evidence = {
    artifactType: "programmable-uniswap-hook-release-evidence-v1",
    releaseId: release.releaseId,
    manifestPath,
    releaseCommit: release.releaseCommit,
    sourceCommitment: release.sourceCommitment,
    chainId: 1,
    hookAddress: release.hookAddress,
    deployer: release.deployer,
    deployment: release.deployment,
    sourceVerification: release.sourceVerification,
    sourcePath: reviewedMetadata.sourcePath,
    permissions,
    sourceSecurityReview: sourceReview,
    liveRuntime,
  };
  evidence.evidenceHash = releaseDigest(evidence);

  const routingIntake = {
    artifactType: "programmable-uniswap-routing-intake-v1",
    purpose: "uniswap-routing-review",
    submissionStatus: "not-submitted",
    submissionUrl: ROUTING_ALLOWLIST_URL,
    registryRelationship:
      "Hooklist inclusion does not grant routing approval.",
    hook: {
      address: release.hookAddress,
      name: reviewedMetadata.name,
      chainId: 1,
      flags: permissions,
      properties: hookEntry.properties,
    },
    release: {
      releaseId: release.releaseId,
      manifestPath,
      releaseCommit: release.releaseCommit,
      deploymentTransaction: release.deployment.transactionHash,
      deploymentBlock: release.deployment.blockNumber,
      evidenceHash: evidence.evidenceHash,
    },
    verification: {
      etherscan: release.sourceVerification.etherscan.url,
      sourcify: release.sourceVerification.sourcify.url,
      runtimeCodeHash: release.runtimeCodeHash,
      eip1967SlotsEmpty: true,
      directRuntime: true,
    },
    operatorChecks: [
      "Confirm current Uniswap routing intake questions and copy only matching facts.",
      "Record successful exact-input and exact-output quotes for the deployed hook pool.",
      "Record successful buy and sell transactions through the intended router path.",
      "Confirm whether hookData is empty and whether swaps require any caller allowlist.",
      "Document partial-fill behavior, fee bounds, and any unsupported swap path.",
      "Attach monitoring and incident contacts without adding secrets to public artifacts.",
    ],
  };

  return {
    evidence,
    hooklist: {
      purpose: "public-hook-registry",
      submissionStatus: "not-submitted",
      repository: HOOKLIST_REPOSITORY,
      upstreamUrl: HOOKLIST_URL,
      entry: hookEntry,
      issueJson,
      issueMarkdown: issueMarkdown(issueFields),
    },
    routingAllowlist: {
      purpose: "uniswap-routing-review",
      submissionStatus: "not-submitted",
      submissionUrl: ROUTING_ALLOWLIST_URL,
      intakeJson: routingIntake,
      intakeMarkdown: routingMarkdown(routingIntake),
    },
  };
}

function containsDelegatecall(runtimeBytecode) {
  const bytes = Buffer.from(runtimeBytecode.slice(2), "hex");
  for (let index = 0; index < bytes.length; index += 1) {
    const opcode = bytes[index];
    if (opcode === 0xf4) return true;
    if (opcode >= 0x60 && opcode <= 0x7f) {
      index += opcode - 0x5f;
    }
  }
  return false;
}

function isMinimalProxyRuntime(runtimeBytecode) {
  const runtime = runtimeBytecode.toLowerCase();
  return (
    /^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/.test(
      runtime,
    ) ||
    /^0x3d3d3d3d363d3d37363d73[0-9a-f]{40}5af43d3d93803e602a57fd5bf3$/.test(
      runtime,
    )
  );
}

async function rpc(fetchImpl, rpcUrl, method, params, id) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert(response.ok, `RPC ${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) {
    throw new Error(
      `RPC ${method} failed: ${body.error.message ?? "unknown error"}`,
    );
  }
  assert("result" in body, `RPC ${method} returned no result`);
  return body.result;
}

export async function inspectLiveHook({
  rpcUrl,
  expectedChainId,
  hookAddress,
  expectedRuntimeCodeHash,
  fetchImpl = fetch,
}) {
  assert(
    typeof rpcUrl === "string" && /^https?:\/\//.test(rpcUrl),
    "An HTTP(S) Ethereum RPC URL is required",
  );
  const address = canonicalAddress(hookAddress, "Hook address");
  const expectedHash = normalizeHex(expectedRuntimeCodeHash);
  assert(
    HASH_PATTERN.test(expectedHash),
    "Expected runtime code hash is invalid",
  );

  let id = 1;
  const chainId = Number(
    BigInt(await rpc(fetchImpl, rpcUrl, "eth_chainId", [], id++)),
  );
  assert(
    chainId === expectedChainId,
    `RPC chainId ${chainId} does not match ${expectedChainId}`,
  );
  const observedAtBlock = Number(
    BigInt(await rpc(fetchImpl, rpcUrl, "eth_blockNumber", [], id++)),
  );
  const latestRuntime = await rpc(
    fetchImpl,
    rpcUrl,
    "eth_getCode",
    [address, "latest"],
    id++,
  );
  const safeRuntime = await rpc(
    fetchImpl,
    rpcUrl,
    "eth_getCode",
    [address, "safe"],
    id++,
  );
  assert(
    /^0x[0-9a-f]+$/i.test(latestRuntime) && latestRuntime !== "0x",
    "Hook has no live runtime code",
  );
  assert(
    normalizeHex(latestRuntime) === normalizeHex(safeRuntime),
    "Latest and safe hook runtime code disagree",
  );
  const runtimeCodeHash = keccak256(latestRuntime);
  assert(
    normalizeHex(runtimeCodeHash) === expectedHash,
    "Live runtime code hash does not match the manifest",
  );

  const eip1967Slots = {};
  for (const [name, slot] of Object.entries(EIP1967_SLOTS)) {
    eip1967Slots[name] = normalizeHex(
      await rpc(
        fetchImpl,
        rpcUrl,
        "eth_getStorageAt",
        [address, slot, "latest"],
        id++,
      ),
    );
    if (eip1967Slots[name] !== EMPTY_STORAGE_WORD) {
      throw new Error(`EIP-1967 ${name} slot is populated`);
    }
  }

  const minimalProxy = isMinimalProxyRuntime(latestRuntime);
  if (minimalProxy) throw new Error("Hook runtime is a minimal proxy");
  const runtimeDelegatecall = containsDelegatecall(latestRuntime);
  if (runtimeDelegatecall) {
    throw new Error("Hook runtime contains DELEGATECALL");
  }

  return {
    chainId,
    hookAddress: address,
    runtimeCodeHash,
    observedAtBlock,
    eip1967Slots,
    minimalProxy,
    runtimeDelegatecall,
  };
}

export async function writeUniswapHookRelease(outputDirectory, release) {
  assert(
    typeof outputDirectory === "string" && outputDirectory.trim().length > 0,
    "Output directory is required",
  );
  const output = path.resolve(outputDirectory);
  try {
    await lstat(output);
    throw new Error("Output directory already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(
    path.join(parent, ".uniswap-hook-release-"),
  );
  const files = {
    "hook-entry.json": stableJson(release.hooklist.entry),
    "hooklist-issue.json": stableJson(release.hooklist.issueJson),
    "hooklist-issue.md": `${release.hooklist.issueMarkdown.trimEnd()}\n`,
    "routing-allowlist-intake.json": stableJson(
      release.routingAllowlist.intakeJson,
    ),
    "routing-allowlist-intake.md": `${release.routingAllowlist.intakeMarkdown.trimEnd()}\n`,
    "release-evidence.json": stableJson(release.evidence),
  };
  try {
    await Promise.all(
      Object.entries(files).map(([filename, contents]) =>
        writeFile(path.join(staging, filename), contents, {
          encoding: "utf8",
          flag: "wx",
        }),
      ),
    );
    await rename(staging, output);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return Object.keys(files).map((filename) =>
    path.join(output, filename),
  );
}
