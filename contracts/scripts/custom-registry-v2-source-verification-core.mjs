import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getAddress, keccak256 } from "viem";

import { sha256 } from "./custom-registry-v2-deployment-guards.mjs";

export const REGISTRY_FQCN =
  "src/ProgrammableCustomRegistryV2.sol:ProgrammableCustomRegistryV2";
export const REGISTRY_CONTRACT_NAME = "ProgrammableCustomRegistryV2";
export const REGISTRY_COMPILER_VERSION = "v0.8.26+commit.8a97fa7a";
export const OPENZEPPELIN_COMMIT = "21c8312b022f495ebe3621d5daeed20552b43ff9";
export const AUTHORITY_SOURCE_PATHS = [
  "src/ProgrammableCustomRegistryV2.sol",
  "src/interfaces/IProgrammableCustomRegistryV2.sol",
  "lib/openzeppelin-contracts/contracts/access/AccessControl.sol",
  "lib/openzeppelin-contracts/contracts/access/IAccessControl.sol",
  "lib/openzeppelin-contracts/contracts/access/extensions/AccessControlDefaultAdminRules.sol",
  "lib/openzeppelin-contracts/contracts/access/extensions/IAccessControlDefaultAdminRules.sol",
  "lib/openzeppelin-contracts/contracts/interfaces/IERC5313.sol",
  "lib/openzeppelin-contracts/contracts/utils/Context.sol",
  "lib/openzeppelin-contracts/contracts/utils/Panic.sol",
  "lib/openzeppelin-contracts/contracts/utils/introspection/ERC165.sol",
  "lib/openzeppelin-contracts/contracts/utils/introspection/IERC165.sol",
  "lib/openzeppelin-contracts/contracts/utils/math/Math.sol",
  "lib/openzeppelin-contracts/contracts/utils/math/SafeCast.sol",
];

const git = (cwd, args, options = {}) =>
  execFileSync("/usr/bin/git", args, {
    cwd,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

export function assertGitSourceIdentity({ root, commit, tree }) {
  if (
    !/^[0-9a-f]{40}$/u.test(commit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(tree ?? "") ||
    git(root, ["rev-parse", "--verify", `${commit}^{commit}`]).trim() !==
      commit ||
    git(root, ["rev-parse", `${commit}^{tree}`]).trim() !== tree
  ) {
    throw new Error("reviewed git source identity is invalid");
  }
}

const gitBlob = (repository, object, objectPath) =>
  git(repository, ["show", `${object}:${objectPath}`], { encoding: "buffer" });

export function buildRegistrySourceClosure({ root, commit, tree }) {
  assertGitSourceIdentity({ root, commit, tree });
  const dependencyPins = JSON.parse(
    gitBlob(root, commit, "contracts/dependencies/source-pins.json").toString(
      "utf8",
    ),
  );
  const openZeppelinPin = dependencyPins.dependencies?.find(
    ({ name }) => name === "OpenZeppelin Contracts",
  );
  if (openZeppelinPin?.commit !== OPENZEPPELIN_COMMIT) {
    throw new Error("reviewed OpenZeppelin source pin is invalid");
  }
  const openZeppelinRepository = path.join(
    root,
    "contracts/lib/openzeppelin-contracts",
  );
  if (
    git(openZeppelinRepository, [
      "rev-parse",
      "--verify",
      `${OPENZEPPELIN_COMMIT}^{commit}`,
    ]).trim() !== OPENZEPPELIN_COMMIT
  ) {
    throw new Error("pinned OpenZeppelin git object is unavailable");
  }
  const sources = {};
  for (const sourcePath of AUTHORITY_SOURCE_PATHS) {
    const content = sourcePath.startsWith("lib/openzeppelin-contracts/")
      ? gitBlob(
          openZeppelinRepository,
          OPENZEPPELIN_COMMIT,
          sourcePath.slice("lib/openzeppelin-contracts/".length),
        )
      : gitBlob(root, commit, `contracts/${sourcePath}`);
    if (content.length === 0 || content.includes(0)) {
      throw new Error(`reviewed source is empty or binary at ${sourcePath}`);
    }
    sources[sourcePath] = { content: content.toString("utf8") };
  }
  return sources;
}

const imports = (content) =>
  [
    ...content.matchAll(
      /\bimport\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']\s*;/gu,
    ),
  ].map((match) => match[1]);

const resolveImport = (from, imported) => {
  if (imported.startsWith("@openzeppelin/contracts/")) {
    return `lib/openzeppelin-contracts/contracts/${imported.slice(
      "@openzeppelin/contracts/".length,
    )}`;
  }
  if (imported.startsWith(".")) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(from), imported),
    );
  }
  throw new Error(`unapproved Registry import ${imported}`);
};

export function assertRegistryImportGraph(sources) {
  const paths = Object.keys(sources).sort();
  if (
    JSON.stringify(paths) !== JSON.stringify([...AUTHORITY_SOURCE_PATHS].sort())
  ) {
    throw new Error("Registry source closure path set is not exact");
  }
  const reachable = new Set();
  const visit = (sourcePath) => {
    if (reachable.has(sourcePath)) return;
    const source = sources[sourcePath];
    if (!source || typeof source.content !== "string" || !source.content) {
      throw new Error(`Registry source closure is missing ${sourcePath}`);
    }
    reachable.add(sourcePath);
    for (const imported of imports(source.content)) {
      const resolved = resolveImport(sourcePath, imported);
      if (!sources[resolved]) {
        throw new Error(
          `Registry import is outside exact closure: ${resolved}`,
        );
      }
      visit(resolved);
    }
  };
  visit("src/ProgrammableCustomRegistryV2.sol");
  if (reachable.size !== paths.length) {
    throw new Error("Registry source closure contains an unreachable source");
  }
}

export function buildRegistryStandardJsonInput(sources) {
  assertRegistryImportGraph(sources);
  return {
    language: "Solidity",
    sources,
    settings: {
      remappings: [
        "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
      ],
      optimizer: { enabled: true, runs: 1000 },
      metadata: {
        useLiteralContent: false,
        bytecodeHash: "none",
        appendCBOR: false,
      },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.immutableReferences",
          ],
        },
      },
      evmVersion: "cancun",
      viaIR: false,
      libraries: {},
    },
  };
}

const SOLC_LOCK = {
  darwin: {
    sha256:
      "0x0ff016aef2396b12d1fc65429d8ea6cf53c2ee4b041bb8925644615ee1c30ab9",
    candidates: [
      path.join(
        os.homedir(),
        "Library/Caches/hardhat-nodejs/compilers-v2/macosx-amd64/solc-macosx-amd64-v0.8.26+commit.8a97fa7a",
      ),
      path.join(os.homedir(), ".svm/0.8.26/solc-0.8.26"),
    ],
    url: "https://binaries.soliditylang.org/macosx-amd64/solc-macosx-amd64-v0.8.26+commit.8a97fa7a",
  },
  linux: {
    sha256:
      "0xd5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef",
    candidates: [path.join(os.homedir(), ".svm/0.8.26/solc-0.8.26")],
    url: "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.26+commit.8a97fa7a",
  },
};

export function expectedPinnedSolcDigest() {
  return SOLC_LOCK[process.platform]?.sha256;
}

export async function resolvePinnedSolc() {
  const lock = SOLC_LOCK[process.platform];
  if (!lock || !["arm64", "x64"].includes(process.arch)) {
    throw new Error("unsupported production solc platform or architecture");
  }
  const candidates = [
    ...(process.env.REGISTRY_SOLC_PATH ? [process.env.REGISTRY_SOLC_PATH] : []),
    ...lock.candidates,
  ];
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(candidate);
      if (sha256(bytes) !== lock.sha256) continue;
      const version = execFileSync(candidate, ["--version"], {
        encoding: "utf8",
      });
      if (!version.includes("0.8.26+commit.8a97fa7a")) continue;
      return {
        path: candidate,
        sha256: lock.sha256,
        platform: process.platform,
        architecture: process.arch,
        version: REGISTRY_COMPILER_VERSION,
      };
    } catch {}
  }
  const response = await fetch(lock.url, { redirect: "error" });
  if (!response.ok) {
    throw new Error("official digest-pinned solc download failed");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== lock.sha256) {
    throw new Error("downloaded official solc digest mismatch");
  }
  const downloadDirectory = await mkdtemp(
    path.join(os.tmpdir(), "programmable-solc-0.8.26-"),
  );
  const downloaded = path.join(downloadDirectory, "solc");
  await writeFile(downloaded, bytes, { mode: 0o700 });
  await chmod(downloaded, 0o700);
  const version = execFileSync(downloaded, ["--version"], {
    encoding: "utf8",
  });
  if (!version.includes("0.8.26+commit.8a97fa7a")) {
    await rm(downloadDirectory, { recursive: true, force: true });
    throw new Error("downloaded official solc version mismatch");
  }
  return {
    path: downloaded,
    sha256: lock.sha256,
    platform: process.platform,
    architecture: process.arch,
    version: REGISTRY_COMPILER_VERSION,
    cleanupDirectory: downloadDirectory,
  };
}

export function materialCompilerSettings(settings) {
  return {
    remappings: settings?.remappings ?? [],
    optimizer: settings?.optimizer,
    metadata: settings?.metadata,
    evmVersion: settings?.evmVersion,
    viaIR: settings?.viaIR ?? false,
    libraries: settings?.libraries ?? {},
    debug: settings?.debug ?? {},
  };
}

const allowedCompilerSettingKeys = new Set([
  "remappings",
  "optimizer",
  "metadata",
  "evmVersion",
  "viaIR",
  "libraries",
  "debug",
  "outputSelection",
  "compilationTarget",
]);

export function assertExactSourceClosure(remote, local, label) {
  if (
    remote?.language !== local.language ||
    JSON.stringify(materialCompilerSettings(remote.settings)) !==
      JSON.stringify(materialCompilerSettings(local.settings)) ||
    Object.keys(remote.settings ?? {}).some(
      (key) => !allowedCompilerSettingKeys.has(key),
    )
  ) {
    throw new Error(`${label} compiler settings differ from reviewed source`);
  }
  const localPaths = Object.keys(local.sources).sort();
  const remotePaths = Object.keys(remote.sources ?? {}).sort();
  if (JSON.stringify(localPaths) !== JSON.stringify(remotePaths)) {
    throw new Error(`${label} source closure path set differs`);
  }
  for (const sourcePath of localPaths) {
    if (
      typeof remote.sources[sourcePath]?.content !== "string" ||
      remote.sources[sourcePath].content !== local.sources[sourcePath].content
    ) {
      throw new Error(`${label} source content differs at ${sourcePath}`);
    }
  }
}

const normalizeImmutableReferences = (value) =>
  Object.values(value ?? {})
    .flat()
    .map(({ start, length }) => ({ start, length }))
    .sort((a, b) => a.start - b.start || a.length - b.length);
const canonicalJson = (value) =>
  JSON.stringify(value, (_, item) => {
    if (item === null || Array.isArray(item) || typeof item !== "object") {
      return item;
    }
    return Object.fromEntries(
      Object.entries(item).sort(([first], [second]) =>
        first.localeCompare(second),
      ),
    );
  });
const canonicalAbi = (abi) =>
  [...abi].sort((first, second) => {
    const key = (entry) =>
      `${entry.type}:${entry.name ?? ""}:$${(entry.inputs ?? [])
        .map(({ type }) => type)
        .join(",")}`;
    return key(first).localeCompare(key(second));
  });

export async function compileReviewedRegistry({ root, source }) {
  const sources = buildRegistrySourceClosure({
    root,
    commit: source.commit,
    tree: source.tree,
  });
  const input = buildRegistryStandardJsonInput(sources);
  const inputBytes = Buffer.from(JSON.stringify(input));
  const compiler = await resolvePinnedSolc();
  let outputBytes;
  try {
    outputBytes = execFileSync(compiler.path, ["--standard-json"], {
      input: inputBytes,
      maxBuffer: 128 * 1024 * 1024,
    });
  } finally {
    if (compiler.cleanupDirectory) {
      await rm(compiler.cleanupDirectory, { recursive: true, force: true });
    }
  }
  const output = JSON.parse(outputBytes.toString("utf8"));
  if (output.errors?.some(({ severity }) => severity === "error")) {
    throw new Error("self-owned exact Registry compilation failed");
  }
  const compiled =
    output.contracts?.["src/ProgrammableCustomRegistryV2.sol"]?.[
      REGISTRY_CONTRACT_NAME
    ];
  if (!compiled) throw new Error("compiled Registry target is missing");
  const [manifest, abiDocument] = await Promise.all([
    Promise.resolve(
      JSON.parse(
        gitBlob(
          root,
          source.commit,
          "contracts/spec/custom-registry-v2-predeployment.json",
        ).toString("utf8"),
      ),
    ),
    Promise.resolve(
      JSON.parse(
        gitBlob(
          root,
          source.commit,
          "docs/security/abi/ProgrammableCustomRegistryV2.json",
        ).toString("utf8"),
      ),
    ),
  ]);
  const creationBytecode = `0x${compiled.evm.bytecode.object}`;
  const runtimeTemplate = `0x${compiled.evm.deployedBytecode.object}`;
  if (
    canonicalJson(canonicalAbi(compiled.abi)) !==
      canonicalJson(canonicalAbi(abiDocument.abi)) ||
    keccak256(creationBytecode) !==
      manifest.artifact.creationBytecodeKeccak256 ||
    keccak256(runtimeTemplate) !== manifest.artifact.runtimeTemplateKeccak256 ||
    JSON.stringify(
      normalizeImmutableReferences(
        compiled.evm.deployedBytecode.immutableReferences,
      ),
    ) !== JSON.stringify(manifest.artifact.runtimeImmutableReferences)
  ) {
    throw new Error("self-owned compilation differs from committed release");
  }
  return {
    compiler,
    input,
    inputBytes,
    output,
    outputBytes,
    compiled,
    creationBytecode,
    runtimeTemplate,
    manifest,
    abiDocument,
  };
}

const uint256Word = (value) => BigInt(value).toString(16).padStart(64, "0");

export function assertMaterializedRegistryRuntime({ compilation, finalized }) {
  const template = compilation.runtimeTemplate.slice(2);
  const live = finalized.runtimeCode?.slice(2);
  if (
    !live ||
    !/^[0-9a-fA-F]+$/u.test(live) ||
    live.length !== template.length ||
    keccak256(`0x${live}`) !== finalized.runtimeCodeKeccak256
  ) {
    throw new Error("fresh Registry runtime bytes are missing or invalid");
  }
  const references =
    compilation.compiled.evm.deployedBytecode.immutableReferences;
  const observedValues = [];
  let materialized = template;
  for (const group of Object.values(references)) {
    const values = group.map(({ start, length }) =>
      live.slice(start * 2, (start + length) * 2).toLowerCase(),
    );
    if (new Set(values).size !== 1 || values[0].length !== 64) {
      throw new Error("Registry immutable references disagree in live runtime");
    }
    observedValues.push(values[0]);
    for (const { start, length } of group) {
      materialized =
        materialized.slice(0, start * 2) +
        values[0] +
        materialized.slice((start + length) * 2);
    }
  }
  const expectedValues = [
    uint256Word(1),
    uint256Word(finalized.minimumFinalityBlocks),
    finalized.registryPolicyCommitment.slice(2).toLowerCase(),
  ].sort();
  if (
    JSON.stringify(observedValues.sort()) !== JSON.stringify(expectedValues) ||
    materialized.toLowerCase() !== live.toLowerCase()
  ) {
    throw new Error(
      "self-compiled runtime constructor immutables do not reproduce live bytes",
    );
  }
}

export async function fetchJsonEvidence({
  label,
  url,
  publicQuery,
  maximumBytes = 16 * 1024 * 1024,
}) {
  let response;
  let bytes;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error(`${label} request failed`);
  }
  if (!response.ok || bytes.length === 0 || bytes.length > maximumBytes) {
    throw new Error(`${label} returned unusable HTTP ${response.status}`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} returned malformed JSON`);
  }
  return {
    value,
    evidence: {
      provider: label,
      fetchedAtTimestamp: Math.floor(Date.now() / 1000),
      request: {
        origin: url.origin,
        pathname: url.pathname,
        query: publicQuery,
        redactedQueryKeys: [...url.searchParams.keys()].filter(
          (key) => !(key in publicQuery),
        ),
      },
      rawResponseSha256: sha256(bytes),
      rawResponseBytes: bytes.length,
      rawResponseBase64: bytes.toString("base64"),
      semanticSha256: sha256(Buffer.from(JSON.stringify(value))),
    },
  };
}

export function parseEtherscanStandardJsonSource(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Etherscan returned no Standard JSON source");
  }
  const trimmed = value.trim();
  const parsed =
    trimmed.startsWith("{{") && trimmed.endsWith("}}")
      ? JSON.parse(trimmed.slice(1, -1))
      : JSON.parse(trimmed);
  if (parsed?.language !== "Solidity" || !parsed.sources) {
    throw new Error("Etherscan source is not Solidity Standard JSON");
  }
  return parsed;
}

const normalizedHex = (value) => (value ?? "").toLowerCase();

export async function verifyRegistrySourceProviders({
  compilation,
  finalized,
  plan,
  etherscanApiKey,
}) {
  assertMaterializedRegistryRuntime({ compilation, finalized });
  if (!etherscanApiKey) throw new Error("ETHERSCAN_API_KEY is required");
  const address = getAddress(finalized.contractAddress);
  const sourceQuery = {
    chainid: "1",
    module: "contract",
    action: "getsourcecode",
    address,
  };
  const sourceUrl = new URL("https://api.etherscan.io/v2/api");
  for (const [key, value] of Object.entries(sourceQuery)) {
    sourceUrl.searchParams.set(key, value);
  }
  sourceUrl.searchParams.set("apikey", etherscanApiKey);
  const creationQuery = {
    chainid: "1",
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: address,
  };
  const creationUrl = new URL("https://api.etherscan.io/v2/api");
  for (const [key, value] of Object.entries(creationQuery)) {
    creationUrl.searchParams.set(key, value);
  }
  creationUrl.searchParams.set("apikey", etherscanApiKey);
  const sourcifyQuery = {
    fields:
      "creationBytecode,runtimeBytecode,deployment,compilation,sources,stdJsonInput,proxyResolution",
  };
  const sourcifyUrl = new URL(
    `https://sourcify.dev/server/v2/contract/1/${address}`,
  );
  sourcifyUrl.searchParams.set("fields", sourcifyQuery.fields);
  const [etherscanSourceResult, etherscanCreationResult, sourcifyResult] =
    await Promise.all([
      fetchJsonEvidence({
        label: "etherscan-source",
        url: sourceUrl,
        publicQuery: sourceQuery,
      }),
      fetchJsonEvidence({
        label: "etherscan-creation",
        url: creationUrl,
        publicQuery: creationQuery,
      }),
      fetchJsonEvidence({
        label: "sourcify-v2",
        url: sourcifyUrl,
        publicQuery: sourcifyQuery,
      }),
    ]);
  const etherscanPayload = etherscanSourceResult.value;
  const etherscan = etherscanPayload?.result?.[0];
  if (
    etherscanPayload?.status !== "1" ||
    etherscanPayload?.message !== "OK" ||
    etherscanPayload.result?.length !== 1 ||
    etherscan?.ContractName !== REGISTRY_CONTRACT_NAME ||
    (etherscan.ContractFileName &&
      etherscan.ContractFileName !== "src/ProgrammableCustomRegistryV2.sol") ||
    (etherscan.CompilerType && etherscan.CompilerType !== "solc") ||
    etherscan?.CompilerVersion !== REGISTRY_COMPILER_VERSION ||
    etherscan?.OptimizationUsed !== "1" ||
    etherscan?.Runs !== "1000" ||
    etherscan?.EVMVersion !== "cancun" ||
    etherscan?.Proxy !== "0" ||
    (etherscan?.Implementation ?? "") !== "" ||
    ((etherscan?.SimilarMatch ?? "") !== "" &&
      !/^0x[0-9a-fA-F]{40}$/u.test(etherscan.SimilarMatch)) ||
    (etherscan?.Library ?? "") !== "" ||
    normalizedHex(etherscan?.ConstructorArguments) !==
      normalizedHex(finalized.constructorArguments.slice(2))
  ) {
    throw new Error("Etherscan exact source metadata differs from release");
  }
  const etherscanInput = parseEtherscanStandardJsonSource(etherscan.SourceCode);
  assertExactSourceClosure(etherscanInput, compilation.input, "Etherscan");
  if (
    etherscanInput.settings?.compilationTarget?.[
      "src/ProgrammableCustomRegistryV2.sol"
    ] !== REGISTRY_CONTRACT_NAME ||
    canonicalJson(canonicalAbi(JSON.parse(etherscan.ABI))) !==
      canonicalJson(canonicalAbi(compilation.compiled.abi))
  ) {
    throw new Error("Etherscan target or ABI differs from release");
  }
  const creationPayload = etherscanCreationResult.value;
  const creation = creationPayload?.result?.[0];
  if (
    creationPayload?.status !== "1" ||
    creationPayload?.message !== "OK" ||
    creationPayload.result?.length !== 1 ||
    getAddress(creation?.contractAddress) !== address ||
    getAddress(creation?.contractCreator) !==
      getAddress(plan.expectedTransaction.from) ||
    creation?.txHash !== finalized.transactionHash ||
    String(creation?.blockNumber) !== finalized.deploymentBlockNumber ||
    String(creation?.timestamp) !== finalized.deploymentBlockTimestamp ||
    (creation?.contractFactory ?? "") !== "" ||
    normalizedHex(creation?.creationBytecode) !==
      normalizedHex(plan.expectedTransaction.input)
  ) {
    throw new Error("Etherscan creation evidence differs from release");
  }

  const sourcify = sourcifyResult.value;
  if (
    sourcify?.match !== "exact_match" ||
    sourcify?.creationMatch !== "exact_match" ||
    sourcify?.runtimeMatch !== "exact_match" ||
    sourcify?.chainId !== "1" ||
    getAddress(sourcify?.address) !== address ||
    sourcify.compilation?.language !== "Solidity" ||
    sourcify.compilation?.compiler !== "solc" ||
    !["0.8.26+commit.8a97fa7a", REGISTRY_COMPILER_VERSION].includes(
      sourcify.compilation?.compilerVersion,
    ) ||
    sourcify.compilation?.name !== REGISTRY_CONTRACT_NAME ||
    sourcify.compilation?.fullyQualifiedName !== REGISTRY_FQCN ||
    sourcify.proxyResolution?.isProxy !== false ||
    sourcify.proxyResolution?.proxyType !== null ||
    sourcify.proxyResolution?.implementations?.length !== 0 ||
    sourcify.proxyResolution?.proxyResolutionError !== undefined
  ) {
    throw new Error("Sourcify v2 exact identity differs from release");
  }
  assertExactSourceClosure(
    sourcify.stdJsonInput,
    compilation.input,
    "Sourcify v2",
  );
  const sourcifyPaths = Object.keys(sourcify.sources ?? {}).sort();
  const localPaths = Object.keys(compilation.input.sources).sort();
  if (JSON.stringify(sourcifyPaths) !== JSON.stringify(localPaths)) {
    throw new Error("Sourcify v2 source closure differs");
  }
  for (const sourcePath of localPaths) {
    if (
      sourcify.sources[sourcePath]?.content !==
      compilation.input.sources[sourcePath].content
    ) {
      throw new Error(`Sourcify v2 source differs at ${sourcePath}`);
    }
  }
  const deployment = sourcify.deployment;
  const creationTransformations =
    sourcify.creationBytecode?.transformations ?? [];
  const runtimeTransformations =
    sourcify.runtimeBytecode?.transformations ?? [];
  if (
    deployment?.transactionHash !== finalized.transactionHash ||
    String(deployment?.blockNumber) !== finalized.deploymentBlockNumber ||
    String(deployment?.transactionIndex) !==
      String(finalized.deploymentTransactionIndex) ||
    getAddress(deployment?.deployer) !==
      getAddress(plan.expectedTransaction.from) ||
    normalizedHex(sourcify.creationBytecode?.onchainBytecode) !==
      normalizedHex(plan.expectedTransaction.input) ||
    normalizedHex(sourcify.creationBytecode?.recompiledBytecode) !==
      normalizedHex(compilation.creationBytecode) ||
    normalizedHex(
      sourcify.creationBytecode?.transformationValues?.constructorArguments,
    ) !== normalizedHex(finalized.constructorArguments) ||
    keccak256(sourcify.runtimeBytecode?.onchainBytecode ?? "0x") !==
      finalized.runtimeCodeKeccak256 ||
    normalizedHex(sourcify.runtimeBytecode?.recompiledBytecode) !==
      normalizedHex(compilation.runtimeTemplate) ||
    creationTransformations.length !== 1 ||
    creationTransformations[0]?.reason !== "constructorArguments" ||
    runtimeTransformations.length === 0 ||
    runtimeTransformations.some(({ reason }) => reason !== "immutable") ||
    JSON.stringify(
      normalizeImmutableReferences(
        sourcify.runtimeBytecode?.immutableReferences,
      ),
    ) !==
      JSON.stringify(
        normalizeImmutableReferences(
          compilation.compiled.evm.deployedBytecode.immutableReferences,
        ),
      )
  ) {
    throw new Error("Sourcify v2 bytecode or deployment differs from release");
  }
  return {
    etherscan: {
      status: "verified-source-exact-closure",
      similarMatch: etherscan.SimilarMatch || null,
      sourceResponse: etherscanSourceResult.evidence,
      creationResponse: etherscanCreationResult.evidence,
      url: `https://etherscan.io/address/${address}#code`,
    },
    sourcify: {
      status: "exact-match",
      response: sourcifyResult.evidence,
      url: `https://sourcify.dev/server/v2/contract/1/${address}`,
    },
  };
}
