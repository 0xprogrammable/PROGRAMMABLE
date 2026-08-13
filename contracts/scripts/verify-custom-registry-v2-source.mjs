#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getAddress, keccak256, toHex } from "viem";

import {
  REGISTRY_SOURCE_VERIFICATION_SCHEMA,
  REGISTRY_VERIFICATION_SCHEMA,
  sha256,
} from "./custom-registry-v2-deployment-guards.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const contractsRoot = path.join(root, "contracts");
const fqcn =
  "src/ProgrammableCustomRegistryV2.sol:ProgrammableCustomRegistryV2";
const contractName = "ProgrammableCustomRegistryV2";
const compilerVersion = "v0.8.26+commit.8a97fa7a";
const submitSourcify = process.argv.includes("--submit-sourcify");
const submitEtherscan = process.argv.includes("--submit-etherscan");
const capture = process.argv.includes("--capture");
if ([submitSourcify, submitEtherscan, capture].filter(Boolean).length > 1) {
  throw new Error("choose one source-verification mode");
}
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const onchainPath = path.resolve(required("REGISTRY_ONCHAIN_VERIFICATION_PATH"));
if (!onchainPath.startsWith("/tmp/")) {
  throw new Error("onchain verification must be under /tmp");
}
const onchainBytes = await readFile(onchainPath);
if (
  sha256(onchainBytes) !== required("REGISTRY_ONCHAIN_VERIFICATION_SHA256")
) {
  throw new Error("onchain verification digest mismatch");
}
const onchain = JSON.parse(onchainBytes);
if (
  onchain.schemaVersion !== REGISTRY_VERIFICATION_SCHEMA ||
  onchain.status !== "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE" ||
  onchain.verified !== false ||
  onchain.chainId !== 1 ||
  !/^0x[0-9a-fA-F]{64}$/u.test(onchain.transactionHash ?? "") ||
  !/^0x[0-9a-fA-F]{64}$/u.test(onchain.runtimeCodeKeccak256 ?? "") ||
  !/^0x[0-9a-fA-F]*$/u.test(onchain.constructorArguments ?? "")
) {
  throw new Error("onchain verification is invalid or already finalized");
}
const address = getAddress(onchain.contractAddress);

const forgeArguments = (verifier) => {
  const values = [
    "verify-contract",
    "--watch",
    "--chain",
    "1",
    "--compiler-version",
    "0.8.26",
    "--num-of-optimizations",
    "1000",
    "--evm-version",
    "cancun",
    "--verifier",
    verifier,
    "--constructor-args",
    onchain.constructorArguments,
  ];
  if (verifier === "etherscan") {
    values.push("--etherscan-api-key", required("ETHERSCAN_API_KEY"));
  }
  values.push(address, fqcn);
  return values;
};
const standardJson = () => {
  const result = execFileSync(
    "forge",
    [
      "verify-contract",
      "--show-standard-json-input",
      "--compiler-version",
      "0.8.26",
      "--num-of-optimizations",
      "1000",
      "--evm-version",
      "cancun",
      "--constructor-args",
      onchain.constructorArguments,
      address,
      fqcn,
    ],
    {
      cwd: contractsRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const parsed = JSON.parse(result);
  if (
    parsed.language !== "Solidity" ||
    parsed.settings?.optimizer?.enabled !== true ||
    parsed.settings?.optimizer?.runs !== 1000 ||
    parsed.settings?.evmVersion !== "cancun" ||
    parsed.settings?.metadata?.bytecodeHash !== "none" ||
    parsed.settings?.metadata?.appendCBOR !== false ||
    !parsed.sources?.["src/ProgrammableCustomRegistryV2.sol"]?.content
  ) {
    throw new Error("local exact standard-json compiler input is invalid");
  }
  return { parsed, bytes: Buffer.from(result) };
};
const exactLocalCompiler = async (standardJsonBytes) => {
  const solcCandidates = [
    path.join(os.homedir(), ".svm/0.8.26/solc-0.8.26"),
    path.join(os.homedir(), ".svm/0.8.26/solc"),
    path.join(
      os.homedir(),
      "Library/Caches/hardhat-nodejs/compilers-v2/macosx-amd64/solc-macosx-amd64-v0.8.26+commit.8a97fa7a",
    ),
  ];
  let solcPath;
  for (const candidate of solcCandidates) {
    try {
      await access(candidate);
      solcPath = candidate;
      break;
    } catch {}
  }
  if (!solcPath) {
    throw new Error("exact local solc 0.8.26 binary was not found");
  }
  const solcBytes = await readFile(solcPath);
  const solcVersionOutput = execFileSync(solcPath, ["--version"], {
    encoding: "utf8",
  });
  if (!solcVersionOutput.includes("0.8.26+commit.8a97fa7a")) {
    throw new Error("local solc binary version is invalid");
  }
  const outputBytes = execFileSync(solcPath, ["--standard-json"], {
    input: standardJsonBytes,
    maxBuffer: 128 * 1024 * 1024,
  });
  const output = JSON.parse(outputBytes.toString("utf8"));
  if (output.errors?.some(({ severity }) => severity === "error")) {
    throw new Error("exact standard-json compilation failed");
  }
  const artifact = JSON.parse(
    await readFile(
      path.join(
        contractsRoot,
        "out/ProgrammableCustomRegistryV2.sol/ProgrammableCustomRegistryV2.json",
      ),
    ),
  );
  const compiled =
    output.contracts?.["src/ProgrammableCustomRegistryV2.sol"]?.[
      contractName
    ];
  if (
    `0x${compiled?.evm?.bytecode?.object ?? ""}` !== artifact.bytecode.object ||
    `0x${compiled?.evm?.deployedBytecode?.object ?? ""}` !==
      artifact.deployedBytecode.object
  ) {
    throw new Error("exact standard-json output differs from reviewed artifact");
  }
  return { solcBytes, outputBytes };
};

if (submitSourcify || submitEtherscan) {
  const verifier = submitSourcify ? "sourcify" : "etherscan";
  const result = spawnSync("forge", forgeArguments(verifier), {
    cwd: contractsRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Registry ${verifier} source submission failed`);
  }
  process.stdout.write(`CUSTOM_REGISTRY_V2_${verifier.toUpperCase()}_SUBMITTED\n`);
  process.exit(0);
}

const { parsed: localStandardJson, bytes: standardJsonBytes } = standardJson();
const localCompiler = await exactLocalCompiler(standardJsonBytes);
if (!capture) {
  process.stdout.write(
    `${JSON.stringify({
      mode: "REVIEW_ONLY_NO_EXTERNAL_ACTION",
      chainId: 1,
      address,
      fqcn,
      compilerVersion,
      constructorArguments: onchain.constructorArguments,
      standardJsonSha256: sha256(standardJsonBytes),
      standardJsonOutputSha256: sha256(localCompiler.outputBytes),
      localCompilerBinarySha256: sha256(localCompiler.solcBytes),
      next: ["--submit-sourcify", "--submit-etherscan", "--capture --output /tmp/..."],
    })}\n`,
  );
  process.exit(0);
}
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required for capture");
}
const outputPath = path.resolve(process.argv[outputIndex + 1]);
if (!outputPath.startsWith("/tmp/")) {
  throw new Error("source verification output must be under /tmp");
}

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
};
const parseEtherscanSource = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Etherscan returned no source");
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    return JSON.parse(trimmed.slice(1, -1));
  }
  const parsed = JSON.parse(trimmed);
  if (!parsed.language || !parsed.sources) {
    throw new Error("Etherscan did not return standard-json source");
  }
  return parsed;
};
const materialCompilerSettings = (settings) => ({
  optimizer: settings?.optimizer,
  evmVersion: settings?.evmVersion,
  viaIR: settings?.viaIR ?? false,
  metadata: settings?.metadata,
  remappings: settings?.remappings ?? [],
  libraries: settings?.libraries ?? {},
});
const assertExactSourceClosure = (remote, label) => {
  if (
    remote.language !== localStandardJson.language ||
    JSON.stringify(materialCompilerSettings(remote.settings)) !==
      JSON.stringify(materialCompilerSettings(localStandardJson.settings))
  ) {
    throw new Error(`${label} compiler settings do not match`);
  }
  const localPaths = Object.keys(localStandardJson.sources).sort();
  const remotePaths = Object.keys(remote.sources ?? {}).sort();
  if (JSON.stringify(localPaths) !== JSON.stringify(remotePaths)) {
    throw new Error(`${label} source closure differs`);
  }
  for (const sourcePath of localPaths) {
    if (
      localStandardJson.sources[sourcePath].content !==
      remote.sources[sourcePath]?.content
    ) {
      throw new Error(`${label} source differs at ${sourcePath}`);
    }
  }
};

const etherscanUrl = new URL("https://api.etherscan.io/v2/api");
etherscanUrl.searchParams.set("chainid", "1");
etherscanUrl.searchParams.set("module", "contract");
etherscanUrl.searchParams.set("action", "getsourcecode");
etherscanUrl.searchParams.set("address", address);
etherscanUrl.searchParams.set("apikey", required("ETHERSCAN_API_KEY"));
const [etherscanPayload, sourcifyPayload, sourcifyMetadata] = await Promise.all([
  fetchJson(etherscanUrl),
  fetchJson(`https://sourcify.dev/server/v2/contract/1/${address}`),
  fetchJson(
    `https://repo.sourcify.dev/contracts/full_match/1/${address}/metadata.json`,
  ),
]);
const etherscan = etherscanPayload?.result?.[0];
if (
  etherscanPayload?.status !== "1" ||
  etherscan?.ContractName !== contractName ||
  etherscan?.CompilerVersion !== compilerVersion ||
  etherscan?.OptimizationUsed !== "1" ||
  etherscan?.Runs !== "1000" ||
  etherscan?.EVMVersion !== "cancun" ||
  etherscan?.Proxy !== "0" ||
  etherscan?.Implementation !== "" ||
  (etherscan?.ConstructorArguments ?? "").toLowerCase() !==
    onchain.constructorArguments.slice(2).toLowerCase()
) {
  throw new Error("Etherscan exact source metadata does not match");
}
assertExactSourceClosure(parseEtherscanSource(etherscan.SourceCode), "Etherscan");
if (
  sourcifyPayload?.match !== "match" ||
  sourcifyMetadata?.compiler?.version !== compilerVersion ||
  JSON.stringify(materialCompilerSettings(sourcifyMetadata?.settings)) !==
    JSON.stringify(materialCompilerSettings(localStandardJson.settings)) ||
  sourcifyMetadata?.settings?.compilationTarget?.[
    "src/ProgrammableCustomRegistryV2.sol"
  ] !== contractName
) {
  throw new Error("Sourcify exact source metadata does not match");
}
const localSourcePaths = Object.keys(localStandardJson.sources).sort();
const sourcifySourcePaths = Object.keys(sourcifyMetadata.sources ?? {}).sort();
if (JSON.stringify(localSourcePaths) !== JSON.stringify(sourcifySourcePaths)) {
  throw new Error("Sourcify source closure differs");
}
for (const [sourcePath, source] of Object.entries(localStandardJson.sources)) {
  const expectedKeccak = keccak256(toHex(source.content));
  const metadataHash = sourcifyMetadata.sources?.[sourcePath]?.keccak256;
  if (metadataHash !== expectedKeccak) {
    throw new Error(`Sourcify source differs at ${sourcePath}`);
  }
}
const standardJsonInputPath = `${outputPath}.standard-json-input.json`;
const standardJsonOutputPath = `${outputPath}.standard-json-output.json`;
await writeFile(standardJsonInputPath, standardJsonBytes, {
  flag: "wx",
  mode: 0o600,
});
await writeFile(standardJsonOutputPath, localCompiler.outputBytes, {
  flag: "wx",
  mode: 0o600,
});
const evidence = {
  schemaVersion: REGISTRY_SOURCE_VERIFICATION_SCHEMA,
  status: "ETHERSCAN_EXACT_AND_SOURCIFY_MATCH",
  chainId: 1,
  source: onchain.source,
  onchainVerificationSha256: sha256(onchainBytes),
  contractAddress: address,
  transactionHash: onchain.transactionHash,
  runtimeCodeKeccak256: onchain.runtimeCodeKeccak256,
  constructorArguments: onchain.constructorArguments,
  fqcn,
  compiler: {
    version: compilerVersion,
    optimizerEnabled: true,
    optimizerRuns: 1000,
    evmVersion: "cancun",
    metadataBytecodeHash: "none",
    appendCBOR: false,
    localBinarySha256: sha256(localCompiler.solcBytes),
    standardJsonInputSha256: sha256(standardJsonBytes),
    standardJsonOutputSha256: sha256(localCompiler.outputBytes),
    standardJsonInputEvidenceFile: path.basename(standardJsonInputPath),
    standardJsonOutputEvidenceFile: path.basename(standardJsonOutputPath),
  },
  etherscan: {
    status: "exact-match",
    url: `https://etherscan.io/address/${address}#code`,
  },
  sourcify: {
    status: "full-match",
    url: `https://repo.sourcify.dev/contracts/full_match/1/${address}/`,
  },
  verified: true,
};
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SOURCE_VERIFIED ${outputPath} ${sha256(Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`))}\n`,
);
