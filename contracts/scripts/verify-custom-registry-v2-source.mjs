#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAddress } from "viem";

import {
  REGISTRY_SOURCE_VERIFICATION_SCHEMA,
  REGISTRY_VERIFICATION_SCHEMA,
  sha256,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  REGISTRY_COMPILER_VERSION,
  REGISTRY_FQCN,
  compileReviewedRegistry,
  verifyRegistrySourceProviders,
} from "./custom-registry-v2-source-verification-core.mjs";
import {
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
  releaseEvidenceRoot,
} from "./custom-registry-v2-release-evidence.mjs";

const root = path.resolve(import.meta.dirname, "../..");
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
const onchainPath = assertReleaseEvidencePath(
  required("REGISTRY_ONCHAIN_VERIFICATION_PATH"),
);
let onchainBytes = await readFile(onchainPath);
if (sha256(onchainBytes) !== required("REGISTRY_ONCHAIN_VERIFICATION_SHA256")) {
  throw new Error("onchain verification digest mismatch");
}
let onchain = JSON.parse(onchainBytes);
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
const commit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const tree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  commit !== onchain.source?.commit ||
  tree !== onchain.source?.tree ||
  ((submitSourcify || submitEtherscan || capture) &&
    execFileSync("/usr/bin/git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }) !== "")
) {
  throw new Error(
    "source verification requires the exact clean reviewed source",
  );
}
if (submitSourcify || submitEtherscan || capture) {
  const directory = await mkdtemp(
    path.join(releaseEvidenceRoot(), "registry-v2-source-trust-root-"),
    { encoding: "utf8" },
  );
  const freshPath = path.join(directory, "fresh-onchain.json");
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(
          root,
          "contracts/scripts/verify-custom-registry-v2-deployment.mjs",
        ),
        "--output",
        freshPath,
      ],
      {
        cwd: root,
        env: process.env,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        "active source verification requires fresh full onchain release verification",
      );
    }
    const freshBytes = await readFile(freshPath);
    const fresh = JSON.parse(freshBytes);
    const stableIdentity = (value) => ({
      schemaVersion: value.schemaVersion,
      status: value.status,
      verified: value.verified,
      chainId: value.chainId,
      source: value.source,
      contractAddress: value.contractAddress,
      transactionHash: value.transactionHash,
      deploymentBlockNumber: value.deploymentBlockNumber,
      deploymentBlockHash: value.deploymentBlockHash,
      deploymentBlockTimestamp: value.deploymentBlockTimestamp,
      deploymentTransactionIndex: value.deploymentTransactionIndex,
      runtimeCodeKeccak256: value.runtimeCodeKeccak256,
      constructorArguments: value.constructorArguments,
      constructorCommitment: value.constructorCommitment,
      registryPolicyCommitment: value.registryPolicyCommitment,
      minimumFinalityBlocks: value.minimumFinalityBlocks,
      controllers: value.controllers,
    });
    if (
      JSON.stringify(stableIdentity(fresh)) !==
      JSON.stringify(stableIdentity(onchain))
    ) {
      throw new Error(
        "fresh full onchain release identity differs from supplied evidence",
      );
    }
    onchain = fresh;
    onchainBytes = freshBytes;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const compilation = await compileReviewedRegistry({
  root,
  source: onchain.source,
});
const planPath = assertReleaseEvidencePath(
  required("REGISTRY_REVIEWED_PLAN_PATH"),
);
const planBytes = await readFile(planPath);
if (sha256(planBytes) !== required("REGISTRY_REVIEWED_PLAN_SHA256")) {
  throw new Error("reviewed plan digest mismatch");
}
const plan = JSON.parse(planBytes);
if (
  plan.source?.commit !== onchain.source.commit ||
  plan.source?.tree !== onchain.source.tree ||
  plan.expectedTransaction?.input !==
    `${compilation.creationBytecode}${onchain.constructorArguments.slice(2)}`
) {
  throw new Error("compiled creation bytecode does not bind the reviewed plan");
}

const address = getAddress(onchain.contractAddress);
if (!submitSourcify && !submitEtherscan && !capture) {
  process.stdout.write(
    `${JSON.stringify({
      mode: "REVIEW_ONLY_NO_EXTERNAL_ACTION",
      chainId: 1,
      address,
      fqcn: REGISTRY_FQCN,
      compilerVersion: REGISTRY_COMPILER_VERSION,
      constructorArguments: onchain.constructorArguments,
      sourceCommit: commit,
      sourceTree: tree,
      standardJsonSha256: sha256(compilation.inputBytes),
      selfCompiledOutputSha256: sha256(compilation.outputBytes),
      localCompilerBinarySha256: compilation.compiler.sha256,
      compilerPlatform: compilation.compiler.platform,
      compilerArchitecture: compilation.compiler.architecture,
      sourceClosure: Object.fromEntries(
        Object.entries(compilation.input.sources).map(
          ([sourcePath, source]) => [
            sourcePath,
            sha256(Buffer.from(source.content)),
          ],
        ),
      ),
      next: [
        "--submit-sourcify",
        "--submit-etherscan",
        "--capture --output <protected release evidence root>/...",
      ],
    })}\n`,
  );
  process.exit(0);
}

if (submitSourcify) {
  const response = await fetch(
    `https://sourcify.dev/server/v2/verify/1/${address}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        stdJsonInput: compilation.input,
        compilerVersion: REGISTRY_COMPILER_VERSION.slice(1),
        contractIdentifier: REGISTRY_FQCN,
        creationTransactionHash: onchain.transactionHash,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = await response.json();
  if (![202, 409].includes(response.status)) {
    throw new Error(`Sourcify v2 submission returned HTTP ${response.status}`);
  }
  process.stdout.write(
    `CUSTOM_REGISTRY_V2_SOURCIFY_SUBMITTED ${body.verificationId ?? "already-verified"}\n`,
  );
  process.exit(0);
}

if (submitEtherscan) {
  const form = new URLSearchParams({
    chainid: "1",
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: JSON.stringify(compilation.input),
    codeformat: "solidity-standard-json-input",
    contractname: REGISTRY_FQCN,
    compilerversion: REGISTRY_COMPILER_VERSION,
    optimizationUsed: "1",
    runs: "1000",
    constructorArguements: onchain.constructorArguments.slice(2),
    evmversion: "cancun",
    licenseType: "3",
    apikey: required("ETHERSCAN_API_KEY"),
  });
  const response = await fetch("https://api.etherscan.io/v2/api", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      accept: "application/json",
    },
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  if (!response.ok || body.status !== "1" || typeof body.result !== "string") {
    throw new Error(`Etherscan submission returned HTTP ${response.status}`);
  }
  process.stdout.write("CUSTOM_REGISTRY_V2_ETHERSCAN_SUBMITTED\n");
  process.exit(0);
}

const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required for capture");
}
const outputPath = assertReleaseEvidenceOutput(process.argv[outputIndex + 1]);
const providers = await verifyRegistrySourceProviders({
  compilation,
  finalized: onchain,
  plan,
  etherscanApiKey: required("ETHERSCAN_API_KEY"),
});
const evidence = {
  schemaVersion: REGISTRY_SOURCE_VERIFICATION_SCHEMA,
  status:
    "SELF_COMPILED_ETHERSCAN_VERIFIED_SOURCE_EXACT_CLOSURE_SOURCIFY_V2_EXACT",
  chainId: 1,
  source: onchain.source,
  onchainVerificationSha256: sha256(onchainBytes),
  reviewedPlanSha256: sha256(planBytes),
  contractAddress: address,
  transactionHash: onchain.transactionHash,
  runtimeCodeKeccak256: onchain.runtimeCodeKeccak256,
  constructorArguments: onchain.constructorArguments,
  fqcn: REGISTRY_FQCN,
  compiler: {
    version: REGISTRY_COMPILER_VERSION,
    platform: compilation.compiler.platform,
    architecture: compilation.compiler.architecture,
    binarySha256: compilation.compiler.sha256,
    standardJsonInputSha256: sha256(compilation.inputBytes),
    standardJsonOutputSha256: sha256(compilation.outputBytes),
  },
  sourceClosure: Object.fromEntries(
    Object.entries(compilation.input.sources).map(([sourcePath, source]) => [
      sourcePath,
      sha256(Buffer.from(source.content)),
    ]),
  ),
  ...providers,
  verified: true,
};
const rendered = `${JSON.stringify(evidence, null, 2)}\n`;
await writeFile(outputPath, rendered, { flag: "wx", mode: 0o600 });
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SOURCE_VERIFIED ${outputPath} ${sha256(Buffer.from(rendered))}\n`,
);
