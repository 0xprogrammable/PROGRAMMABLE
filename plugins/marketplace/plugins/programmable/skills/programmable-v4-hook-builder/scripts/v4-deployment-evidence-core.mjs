import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJsonV2 } from "./canonical-json-core.mjs";
import { keccak256Hex } from "./evm-encoding-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { validateAgainstSchema } from "./submission-core.mjs";
import { canonicalV4PermissionMask } from "./v4-hook-semantic-contract-core.mjs";

// Builder-local V4 deployment and trade-runner evidence; neither grants approval.
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaCache = new Map();
export const TRADE_TEST_RUNNER_CONTRACT_V1 = "forge-test-json-v1";
const V2_REFERENCE_KERNEL_INVENTORY_SHA256 = "sha256:3324a4bc09c058f97ff03e17dd02ac9fe34e8e2aeb63684ff575ba808496f475";

/** Copy the reviewed V2 source/test kernel. This never claims approval or live routing. */
export function materializeTradableReferenceKernel({ skillRoot: sourceSkillRoot, outputRoot }) {
  const sourceRoot = path.join(
    requireRealDirectory(sourceSkillRoot, "skill root"),
    "assets",
    "reference-kernels",
    "programmable-volume-fee-v2"
  );
  requireRealDirectory(sourceRoot, "V2 reference kernel");
  const sourceFiles = referenceKernelInventory(sourceRoot);
  const inventorySha256 = hashReferenceKernelInventory(sourceFiles);
  if (inventorySha256 !== V2_REFERENCE_KERNEL_INVENTORY_SHA256) {
    throw new Error(`V2 reference-kernel inventory drift: expected ${V2_REFERENCE_KERNEL_INVENTORY_SHA256}, observed ${inventorySha256}.`);
  }
  if (typeof outputRoot !== "string" || outputRoot.length === 0 || outputRoot.includes("\0")) {
    throw new Error("Reference-kernel output root must be a non-empty path.");
  }
  const destinationRoot = path.resolve(outputRoot);
  if (fs.existsSync(destinationRoot)) throw new Error("Reference-kernel output root must not already exist.");
  requireRealDirectory(path.dirname(destinationRoot), "reference-kernel output parent");

  fs.mkdirSync(destinationRoot, { mode: 0o700 });
  try {
    for (const file of sourceFiles) {
      const source = path.join(sourceRoot, ...file.path.split("/"));
      const destination = path.join(destinationRoot, ...file.path.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
    const copiedInventorySha256 = hashReferenceKernelInventory(referenceKernelInventory(destinationRoot));
    if (copiedInventorySha256 !== inventorySha256) {
      throw new Error(`Copied V2 reference-kernel inventory mismatch: expected ${inventorySha256}, observed ${copiedInventorySha256}.`);
    }
  } catch (error) {
    fs.rmSync(destinationRoot, { recursive: true, force: true });
    throw error;
  }

  return Object.freeze({
    profileId: "programmable-volume-fee-v2",
    status: "NOT_APPROVED",
    assurance: "REFERENCE_KERNEL_SOURCE_AND_TESTS_ONLY",
    sourceRoot,
    outputRoot: destinationRoot,
    files: Object.freeze(sourceFiles.map(Object.freeze)),
    inventorySha256,
    packageLockPath: "package-lock.json",
    routeImplementationPath: "src/ProgrammableVolumeFeeHookV2.sol",
    routeImplementationClosurePaths: Object.freeze(sourceFiles.map(({ path: filePath }) => filePath)),
    routeProfile: Object.freeze({
      routeType: "standard-uniswap-v4",
      routeShape: "single-pool",
      quoteEntrypoint: "V4Quoter.quoteExactInputSingle/quoteExactOutputSingle",
      executionEntrypoint: "UniversalRouter.execute",
      erc20Funding: "Permit2 allowance transfer",
      nativeFunding: "msg.value",
      nativeExactOutputRefund: "Universal Router SWEEP to msg.sender",
      hookData: "empty for exact-input; bounded-swap-witness for exact-output (ABI uint256, exactly 32 bytes; no identity, authentication or replay semantics)",
      executionDeltaBinding: "gross witness and fee reconciled to executed quote delta",
      partialFillPolicy: "rejected-before-effects",
      modes: Object.freeze([
        "zero-for-one-exact-input",
        "zero-for-one-exact-output",
        "one-for-zero-exact-input",
        "one-for-zero-exact-output"
      ])
    })
  });
}

export function forgeTradeTestMatchPathV1(workingDirectory, testSourcePath) {
  if (typeof workingDirectory !== "string" || typeof testSourcePath !== "string") return null;
  if (workingDirectory === ".") return testSourcePath;
  const relative = path.posix.relative(workingDirectory, testSourcePath);
  if (relative === "" || path.posix.isAbsolute(relative) || relative === ".." || relative.startsWith("../")) return null;
  return relative;
}

export function forgeTradeTestMatchTestV1(testSignature) {
  if (typeof testSignature !== "string") return null;
  return `^${testSignature.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`;
}

export function inspectForgeTradeTestDeclarationV1(record) {
  const expectedMatchPath = forgeTradeTestMatchPathV1(record?.command?.workingDirectory, record?.testSourceArtifact?.path);
  if (expectedMatchPath === null) return invalidRunner("TRADE_TEST_SOURCE_RUNNER_BINDING_INVALID", "Forge --match-path cannot resolve the declared test source from the command working directory.");
  const argv = record?.command?.argv;
  if (!Array.isArray(argv) || argv.length !== 9 || argv[0] !== "forge" || argv[1] !== "test" || argv[2] !== "--offline" || argv[3] !== "--json" || argv[4] !== "-vvvv" || argv[5] !== "--match-path" || argv[7] !== "--match-test") return invalidRunner("TRADE_EVM_TEST_RUNNER_REQUIRED", "Trade evidence must use the exact offline Forge JSON test runner contract.");
  if (argv[6] !== expectedMatchPath) return invalidRunner("TRADE_TEST_SOURCE_RUNNER_BINDING_INVALID", "Forge --match-path must equal the declared test source relative to the command working directory.");
  if (typeof record?.runnerTestSignature !== "string" || !/^test[A-Za-z0-9_]*\(\)$/u.test(record.runnerTestSignature)) return invalidRunner("TRADE_TEST_SIGNATURE_RUNNER_BINDING_INVALID", "The declared Forge test signature must name one zero-argument Solidity test function.");
  const expectedMatchTest = forgeTradeTestMatchTestV1(record.runnerTestSignature);
  if (argv[8] !== expectedMatchTest) return invalidRunner("TRADE_TEST_SIGNATURE_RUNNER_BINDING_INVALID", "Forge --match-test must be an exact anchored match for the declared test signature.");
  return Object.freeze({ valid: true, runnerContract: TRADE_TEST_RUNNER_CONTRACT_V1, matchPath: expectedMatchPath, matchTest: expectedMatchTest, testSignature: record.runnerTestSignature });
}

export function validateV4DeploymentEvidence(record, hook, inventory, repositoryRoot, recordIndex) {
  const findings = [];
  const add = (code, findingPath, message, details = {}) => findings.push({ severity: "blocker", code, path: findingPath, message, details });
  const base = `$.v4HookSemanticContracts[${recordIndex}]`;
  const deploymentArtifacts = (record.deploymentArtifactIds ?? []).map((id) => inventory.byId.get(id)).filter(Boolean);
  const artifactByKind = new Map();
  for (const artifact of deploymentArtifacts) {
    if (artifactByKind.has(artifact.kind)) add("V4_DEPLOYMENT_ARTIFACT_KIND_DUPLICATE", `${base}.deploymentArtifactIds`, `Deployment evidence contains duplicate ${artifact.kind} artifacts.`);
    artifactByKind.set(artifact.kind, artifact);
  }
  const preimageArtifact = artifactByKind.get("v4-deployment-preimage");
  const manifestArtifact = artifactByKind.get("v4-deployment-manifest");
  const runtimeArtifact = artifactByKind.get("v4-runtime-code");
  if (!preimageArtifact || !manifestArtifact || !runtimeArtifact) return findings;

  const root = fs.realpathSync(repositoryRoot);
  const preimage = readJsonArtifact(root, preimageArtifact, `${base}.deploymentArtifactIds`, "V4_DEPLOYMENT_PREIMAGE_JSON_INVALID", add);
  const manifest = readJsonArtifact(root, manifestArtifact, `${base}.deploymentArtifactIds`, "V4_DEPLOYMENT_MANIFEST_JSON_INVALID", add);
  if (!preimage || !manifest) return findings;
  validateSchema(preimage, "v4-deployment-preimage-v1.schema.json", "V4_DEPLOYMENT_PREIMAGE_SCHEMA_INVALID", `${base}.deploymentArtifactIds`, add);
  validateSchema(manifest, "v4-deployment-evidence-v1.schema.json", "V4_DEPLOYMENT_MANIFEST_SCHEMA_INVALID", `${base}.deploymentArtifactIds`, add);

  bind(preimage.systemRef, record.systemRef, "V4_PREIMAGE_SYSTEM_REF_MISMATCH", add, base);
  bind(manifest.systemRef, record.systemRef, "V4_MANIFEST_SYSTEM_REF_MISMATCH", add, base);
  bind(manifest.preimageArtifactId, preimageArtifact.id, "V4_MANIFEST_PREIMAGE_ARTIFACT_MISMATCH", add, base);
  bind(manifest.runtimeArtifactId, runtimeArtifact.id, "V4_MANIFEST_RUNTIME_ARTIFACT_MISMATCH", add, base);

  let bytes;
  try {
    bytes = {
      creationCode: exactHexBytes(preimage.creationCode, false),
      constructorArgs: exactHexBytes(preimage.constructorArgs, true),
      salt: exactHexBytes(preimage.salt, false)
    };
  } catch (error) {
    add("V4_DEPLOYMENT_PREIMAGE_HEX_INVALID", `${base}.deploymentArtifactIds`, error.message);
    return findings;
  }
  if (bytes.salt.length !== 32) {
    add("V4_HOOK_MINER_SALT_LENGTH_INVALID", `${base}.deploymentArtifactIds`, "HookMiner CREATE2 salt must be exactly 32 bytes.");
    return findings;
  }
  const initcode = Buffer.concat([bytes.creationCode, bytes.constructorArgs]);
  const derived = {
    creationCodeKeccak256: keccak256Hex(bytes.creationCode),
    constructorArgsKeccak256: keccak256Hex(bytes.constructorArgs),
    initcodeKeccak256: keccak256Hex(initcode),
    saltSha256: sha256Bytes(bytes.salt)
  };
  for (const key of ["creationCodeKeccak256", "constructorArgsKeccak256", "initcodeKeccak256"]) bind(manifest.hashes?.[key], derived[key], "V4_ETHEREUM_PREIMAGE_HASH_MISMATCH", add, base, { field: key });
  bind(manifest.hookMiner?.saltSha256, derived.saltSha256, "V4_HOOK_MINER_SALT_HASH_MISMATCH", add, base);

  const deployer = exactAddressBytes(manifest.create2Deployer?.address);
  if (deployer === null) {
    add("V4_CREATE2_DEPLOYER_INVALID", `${base}.deploymentArtifactIds`, "CREATE2 deployer must be one exact nonzero Ethereum address.");
    return findings;
  }
  const create2Digest = keccak256Hex(Buffer.concat([
    Buffer.from([0xff]),
    deployer,
    bytes.salt,
    Buffer.from(derived.initcodeKeccak256.slice(2), "hex")
  ]));
  const expectedAddress = `0x${create2Digest.slice(-40)}`;
  bind(manifest.addresses?.expected, expectedAddress, "V4_CREATE2_EXPECTED_ADDRESS_MISMATCH", add, base);
  bind(manifest.addresses?.actual, expectedAddress, "V4_CREATE2_ACTUAL_ADDRESS_MISMATCH", add, base);

  const permissionMask = canonicalV4PermissionMask(hook.permissions);
  const addressMask = `0x${(BigInt(expectedAddress) & 0x3fffn).toString(16).padStart(4, "0")}`;
  bind(manifest.permissions?.permissionMask, permissionMask, "V4_PERMISSION_MASK_MISMATCH", add, base);
  bind(manifest.permissions?.getHookPermissionsMask, permissionMask, "V4_GET_HOOK_PERMISSIONS_MISMATCH", add, base);
  bind(manifest.permissions?.addressLowBitsMask, permissionMask, "V4_ADDRESS_PERMISSION_BITS_MISMATCH", add, base, { observedAddressMask: addressMask });
  bind(addressMask, permissionMask, "V4_ADDRESS_PERMISSION_BITS_MISMATCH", add, base);

  const runtimePath = resolveInside(root, runtimeArtifact.path);
  if (runtimePath === null || !fs.existsSync(runtimePath)) return findings;
  const runtimeBytes = fs.readFileSync(runtimePath);
  bind(manifest.runtime?.byteLength, runtimeBytes.length, "V4_RUNTIME_LENGTH_MISMATCH", add, base);
  bind(manifest.runtime?.codeSha256, sha256Bytes(runtimeBytes), "V4_RUNTIME_SHA256_MISMATCH", add, base);
  bind(manifest.runtime?.codeKeccak256, keccak256Hex(runtimeBytes), "V4_RUNTIME_KECCAK256_MISMATCH", add, base);

  bind(hook.profile?.deployment?.creationCodeHash, sha256Bytes(bytes.creationCode), "V4_PROFILE_CREATION_CODE_SHA256_MISMATCH", add, base);
  bind(hook.profile?.deployment?.constructorArgsHash, sha256Bytes(bytes.constructorArgs), "V4_PROFILE_CONSTRUCTOR_ARGS_SHA256_MISMATCH", add, base);
  bind(hook.profile?.deployment?.initcodeHash, sha256Bytes(initcode), "V4_PROFILE_INITCODE_SHA256_MISMATCH", add, base);
  bind(hook.profile?.deployment?.hookMinerSaltSha256, sha256Bytes(bytes.salt), "V4_PROFILE_SALT_SHA256_MISMATCH", add, base);
  bind(hook.profile?.deployment?.expectedAddress?.toLowerCase(), expectedAddress, "V4_PROFILE_EXPECTED_ADDRESS_MISMATCH", add, base);
  bind(hook.profile?.deployment?.runtimeCodeHash, sha256Bytes(runtimeBytes), "V4_PROFILE_RUNTIME_SHA256_MISMATCH", add, base);
  bind(hook.profile?.deployment?.permissionMask, permissionMask, "V4_PROFILE_PERMISSION_MASK_MISMATCH", add, base);
  bind(hook.profile?.poolManager?.address?.toLowerCase(), manifest.chainProfile?.poolManager, "V4_CHAIN_PROFILE_POOL_MANAGER_MISMATCH", add, base);
  bind(hook.profile?.deployment?.poolManagerAddress?.toLowerCase(), manifest.chainProfile?.poolManager, "V4_DEPLOYMENT_POOL_MANAGER_MISMATCH", add, base);

  for (const evidencePath of [manifest.chainProfile?.evidenceRef, manifest.create2Deployer?.evidenceRef]) {
    const evidenceArtifact = inventory.byPath.get(evidencePath);
    if (!evidenceArtifact || evidenceArtifact.status !== "verified") add("V4_DEPLOYMENT_EXTERNAL_BINDING_EVIDENCE_MISSING", `${base}.deploymentArtifactIds`, `Deployment binding evidence ${evidencePath} is not a verified repository artifact.`, { path: evidencePath ?? null });
  }
  return findings;
}

export function expectedTradeRunnerCallsV1(result, test) {
  const binding = result?.observation?.callBinding;
  if (test?.resultContract === "trade-quote-test-result-v1") {
    const routeType = result?.context?.route?.type;
    const callKind = routeType === "standard-uniswap-v4"
      ? "CALL"
      : routeType === "canonical-programmable-adapter" ? "STATICCALL" : null;
    return [{ role: "quote-target", target: binding?.target, callKind, calldataSha256: result?.observation?.callDataSha256, outcome: "succeeded", outputSha256: result?.observation?.returnDataSha256 }];
  }
  const adapter = binding?.adapterExecution;
  return [
    ...(isPlainObject(adapter) ? [{ role: "adapter-build-target", target: adapter.buildTarget, callKind: "STATICCALL", calldataSha256: adapter.buildCallDataSha256, outcome: "succeeded", outputSha256: adapter.buildReturnDataSha256 }] : []),
    { role: "execution-target", target: adapter?.returnedTarget ?? binding?.target, callKind: "CALL", calldataSha256: adapter?.returnedCalldataSha256 ?? result?.observation?.calldataSha256, outcome: result?.outcome === "reverted-before-effects" ? "reverted" : "succeeded", outputSha256: result?.outcome === "reverted-before-effects" ? test?.expectedRevertDataSha256 : null }
  ];
}

export function inspectForgeTradeTestRunnerOutputV1(stdout, test, commandId = test?.commandId ?? "<unknown>", jsonLimits = {}) {
  const fail = (code, message, details = {}) => Object.freeze({ valid: false, error: Object.freeze({ code, message, commandId, ...details }) });
  const runner = inspectForgeTradeTestDeclarationV1(test);
  if (!runner.valid || test?.runnerContract !== TRADE_TEST_RUNNER_CONTRACT_V1) return fail(runner.code ?? "TRADE_EVM_TEST_RUNNER_REQUIRED", runner.message ?? "Trade test does not declare the recognized Forge runner contract.");
  let output;
  try { output = parseBoundedStrictJsonBytes(Buffer.from(stdout, "utf8"), jsonLimits); } catch (error) { return fail("TRADE_TEST_RUNNER_OUTPUT_INVALID", "Trade test must emit strict Forge JSON output.", { cause: error.code }); }
  if (!isPlainObject(output)) return fail("TRADE_TEST_RUNNER_OUTPUT_INVALID", "Forge output must be an object.");
  const suites = Object.entries(output);
  if (suites.length === 0) return fail("TRADE_TEST_RUNNER_ZERO_TESTS", "Forge produced no test suite or test evidence.");
  if (suites.length !== 1) return fail("TRADE_TEST_RUNNER_CARDINALITY_INVALID", "Forge must produce exactly one test suite.", { suitesObserved: suites.length });
  const [suiteName, suite] = suites[0];
  if (!suiteName.startsWith(`${runner.matchPath}:`)) return fail("TRADE_TEST_RUNNER_SOURCE_MISMATCH", "Forge suite does not bind the declared --match-path.", { suiteName });
  const tests = isPlainObject(suite?.test_results) ? Object.entries(suite.test_results) : [];
  if (tests.length === 0) return fail("TRADE_TEST_RUNNER_ZERO_TESTS", "Forge produced no test evidence.");
  if (tests.length !== 1) return fail("TRADE_TEST_RUNNER_CARDINALITY_INVALID", "Forge must produce exactly one test result.", { testsObserved: tests.length });
  const [signature, observed] = tests[0];
  if (signature !== runner.testSignature) return fail("TRADE_TEST_RUNNER_SIGNATURE_MISMATCH", "Forge result does not bind the declared --match-test signature.", { observedTestSignature: signature });
  if (observed?.status !== "Success") return fail("TRADE_TEST_RUNNER_TEST_FAILED", "Forge test did not succeed.", { status: observed?.status ?? null });
  const unitGas = observed?.kind?.Unit?.gas;
  if (!Number.isSafeInteger(unitGas) || unitGas <= 0) return fail("TRADE_TEST_RUNNER_EVIDENCE_INVALID", "Forge result lacks nonzero runner gas evidence.", { unitGas: unitGas ?? null });
  const logs = Array.isArray(observed?.decoded_logs) ? observed.decoded_logs.filter((entry) => typeof entry === "string" && entry.startsWith("PROGRAMMABLE_TRADE_RESULT_V1:")) : [];
  if (logs.length !== 1) return fail("TRADE_TEST_RESULT_LOG_CARDINALITY_INVALID", "Forge test must emit exactly one typed result log.", { resultLogsObserved: logs.length });
  const resultText = logs[0].slice("PROGRAMMABLE_TRADE_RESULT_V1:".length);
  let result;
  try { result = parseBoundedStrictJsonBytes(Buffer.from(resultText, "utf8")); } catch (error) { return fail("TRADE_TEST_RESULT_LOG_INVALID", "Forge test emitted an invalid typed result log.", { cause: error.code }); }
  if (![canonicalJsonV2(result), `${canonicalJsonV2(result)}\n`].includes(resultText)) return fail("TRADE_TEST_RESULT_LOG_NOT_CANONICAL", "Typed result log must contain canonical JSON with at most one trailing newline.");
  const arenas = Array.isArray(observed?.traces) ? observed.traces.filter((entry) => Array.isArray(entry) && entry[0] === "Execution" && isPlainObject(entry[1])).flatMap((entry) => Array.isArray(entry[1].arena) ? entry[1].arena : []) : [];
  const calls = arenas.map((node) => node?.trace).filter((trace) => isPlainObject(trace) && ["CALL", "STATICCALL"].includes(trace.kind));
  if (calls.length === 0) return fail("TRADE_TEST_TRACE_EVIDENCE_MISSING", "Forge result lacks Execution call traces.");
  const callEvidence = [];
  for (const expected of expectedTradeRunnerCallsV1(result, test)) {
    if (typeof expected.target !== "string" || typeof expected.calldataSha256 !== "string") return fail("TRADE_TEST_TRACE_BINDING_INVALID", "Typed result lacks a trace-bindable target or calldata digest.", { role: expected.role });
    const matches = calls.filter((trace) => String(trace.address).toLowerCase() === expected.target.toLowerCase() && trace.kind === expected.callKind && sha256NullableHex(trace.data) === expected.calldataSha256 && (expected.outcome === "succeeded" ? trace.success === true : trace.success === false && String(trace.status).toLowerCase().includes("revert")));
    const outputs = matches.map(({ output: value }) => sha256NullableHex(value)).filter(Boolean);
    if (matches.length === 0 || outputs.length === 0 || (expected.outputSha256 !== null && !outputs.includes(expected.outputSha256))) return fail("TRADE_TEST_TRACE_BINDING_INVALID", `Forge result lacks a bound ${expected.role} call trace.`, { role: expected.role, target: expected.target });
    callEvidence.push(Object.freeze({ ...expected, outputSha256: expected.outputSha256 ?? outputs[0], occurrences: matches.length }));
  }
  const bytes = Buffer.from(stdout, "utf8");
  return Object.freeze({ valid: true, execution: Object.freeze({ result, runnerEvidence: Object.freeze({
    contract: TRADE_TEST_RUNNER_CONTRACT_V1, matchPath: runner.matchPath, testSignature: runner.testSignature,
    sourcePath: test.testSourceArtifact.path, sourceArtifactSha256: test.testSourceArtifact.sha256, sourceArtifactByteLength: test.testSourceArtifact.byteLength,
    suitesObserved: 1, testsObserved: 1, passedTests: 1, failedTests: 0, resultLogsObserved: 1, unitGas,
    callEvidence: Object.freeze(callEvidence), runnerOutputSha256: sha256Bytes(bytes), runnerOutputByteLength: bytes.length
  }) }) });
}

export function tradeRunnerDomainEvidenceMatchesV1(receipt, test, result) {
  const evidence = receipt?.domainEvidence?.runnerEvidence;
  const declaration = inspectForgeTradeTestDeclarationV1(test);
  if (any(!declaration.valid, !isPlainObject(evidence), evidence?.contract !== TRADE_TEST_RUNNER_CONTRACT_V1, evidence?.matchPath !== declaration.matchPath, evidence?.testSignature !== test.runnerTestSignature, evidence?.sourcePath !== test.testSourceArtifact.path, evidence?.sourceArtifactSha256 !== test.testSourceArtifact.sha256, evidence?.sourceArtifactByteLength !== test.testSourceArtifact.byteLength, evidence?.suitesObserved !== 1, evidence?.testsObserved !== 1, evidence?.passedTests !== 1, evidence?.failedTests !== 0, evidence?.resultLogsObserved !== 1, !Number.isSafeInteger(evidence?.unitGas), evidence?.unitGas <= 0, evidence?.runnerOutputSha256 !== receipt?.stdoutSha256, evidence?.runnerOutputByteLength !== receipt?.stdoutByteLength)) return false;
  const expected = expectedTradeRunnerCallsV1(result, test);
  return Array.isArray(evidence.callEvidence) && evidence.callEvidence.length === expected.length && !expected.some((contract, index) => {
    const call = evidence.callEvidence[index];
    return any(!isPlainObject(call), call?.role !== contract.role, call?.target !== contract.target, call?.callKind !== contract.callKind, call?.calldataSha256 !== contract.calldataSha256, call?.outcome !== contract.outcome, all(contract.outputSha256 !== null, call?.outputSha256 !== contract.outputSha256), !/^sha256:[0-9a-f]{64}$/u.test(coalesce(call?.outputSha256, "")), !Number.isSafeInteger(call?.occurrences), call?.occurrences <= 0);
  });
}

export function prepareIsolatedSolidityCompilerCacheV1(temporaryHome, { homeDirectory = process.env.HOME, svmHome = process.env.SVM_HOME } = {}) {
  const originalHome = typeof homeDirectory === "string" && homeDirectory.length > 0 && !homeDirectory.includes("\0") && path.isAbsolute(homeDirectory) ? homeDirectory : null;
  const explicitSvmHome = typeof svmHome === "string" && svmHome.length > 0 && !svmHome.includes("\0") && path.isAbsolute(svmHome) ? svmHome : null;
  if (originalHome === null && explicitSvmHome === null) return;
  const roots = [], rootKeys = new Set();
  for (const candidateRoot of [explicitSvmHome, originalHome === null ? null : path.join(originalHome, "Library", "Application Support", "svm"), originalHome === null ? null : path.join(originalHome, ".svm")]) {
    if (typeof candidateRoot !== "string" || candidateRoot.length === 0 || candidateRoot.includes("\0") || !path.isAbsolute(candidateRoot)) continue;
    const rootKey = path.normalize(candidateRoot); if (!rootKeys.has(rootKey)) { rootKeys.add(rootKey); roots.push(rootKey); }
  }
  const candidates = [], candidateKeys = new Set();
  for (const root of roots) for (const version of compilerEntries(root).filter((entry) => /^0\.[0-9]+\.[0-9]+$/u.test(entry))) {
    const candidate = path.join(root, version, `solc-${version}`), key = `${version}\0${candidate}`;
    if (!candidateKeys.has(key)) { candidateKeys.add(key); candidates.push([version, candidate]); }
  }
  if (originalHome !== null) for (const entry of compilerEntries(path.join(originalHome, ".solc-select", "artifacts"))) { const match = /^solc-(0\.[0-9]+\.[0-9]+)$/u.exec(entry); if (match) candidates.push([match[1], path.join(originalHome, ".solc-select", "artifacts", entry, entry)]); }
  for (const [version, candidate] of candidates.slice(0, 64)) try {
    const resolved = fs.realpathSync(candidate); const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 512 * 1024 * 1024 || (stat.mode & 0o111) === 0) continue;
    const directory = path.join(temporaryHome, ".svm", version); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, `solc-${version}`); if (!fs.existsSync(target)) fs.symlinkSync(resolved, target, "file");
  } catch (error) { if (!["ENOENT", "ENOTDIR", "EACCES"].includes(error?.code)) throw error; }
}

function readJsonArtifact(root, artifact, findingPath, code, add) {
  const resolved = resolveInside(root, artifact.path);
  if (resolved === null || !fs.existsSync(resolved)) return null;
  try {
    return parseBoundedStrictJsonBytes(fs.readFileSync(resolved));
  } catch (error) {
    add(code, findingPath, error.message, { artifactId: artifact.id, path: artifact.path });
    return null;
  }
}

function validateSchema(value, schemaName, code, findingPath, add) {
  let schema = schemaCache.get(schemaName);
  if (!schema) {
    schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", schemaName), "utf8"));
    schemaCache.set(schemaName, schema);
  }
  for (const finding of validateAgainstSchema(value, schema)) add(code, finding.path ?? findingPath, `${finding.code ?? "SCHEMA"}: ${finding.message ?? String(finding)}`, { schema: schema.$id, schemaCode: finding.code ?? null });
}

function bind(observed, expected, code, add, base, details = {}) {
  if (observed !== expected) add(code, `${base}.deploymentArtifactIds`, "Bound deployment value does not match the recomputed Ethereum evidence.", { ...details, expected, observed: observed ?? null });
}

function exactHexBytes(value, allowEmpty) {
  const pattern = allowEmpty ? /^0x(?:[0-9a-f]{2})*$/u : /^0x(?:[0-9a-f]{2})+$/u;
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError("Ethereum byte strings must be canonical lowercase even-length hex");
  return Buffer.from(value.slice(2), "hex");
}

function exactAddressBytes(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/u.test(value) || /^0x0{40}$/u.test(value)) return null;
  return Buffer.from(value.slice(2), "hex");
}

function resolveInside(root, repositoryPath) {
  if (typeof repositoryPath !== "string") return null;
  const resolved = path.resolve(root, repositoryPath);
  const relative = path.relative(root, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved : null;
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function invalidRunner(code, message) {
  return Object.freeze({ valid: false, code, message });
}

function compilerEntries(directory) {
  try { const stat = fs.lstatSync(directory); return stat.isDirectory() && !stat.isSymbolicLink() ? fs.readdirSync(directory).slice(0, 64) : []; }
  catch (error) { if (["ENOENT", "ENOTDIR", "EACCES"].includes(error?.code)) return []; throw error; }
}

function sha256NullableHex(value) {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/u.test(value) ? sha256Bytes(Buffer.from(value.slice(2), "hex")) : null;
}

function referenceKernelInventory(root) {
  const files = [];
  const transientDirectories = new Set(["node_modules", "cache", "out"]);
  const visit = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Reference kernel must not contain symlinks: ${relative}.`);
      if (entry.isDirectory() && transientDirectories.has(entry.name)) continue;
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push(Object.freeze({
          path: relative,
          sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
          byteLength: bytes.length
        }));
      } else throw new Error(`Reference kernel contains an unsupported entry: ${relative}.`);
    }
  };
  visit(root);
  return files;
}

function hashReferenceKernelInventory(files) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex")}`;
}

function requireRealDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
  return fs.realpathSync(resolved);
}

function isPlainObject(value) {
  return all(value !== null, typeof value === "object", !Array.isArray(value));
}

function any(...conditions) {
  return conditions.some(Boolean);
}

function all(...conditions) {
  return conditions.every(Boolean);
}

function coalesce(value, fallback) {
  return value == null ? fallback : value;
}
