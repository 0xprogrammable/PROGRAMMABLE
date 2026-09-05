import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getContractAddress } from "viem";
import { canonicalizeJson } from "./canonical-json.mjs";
import { sha256Digest } from "./io.mjs";
import { buildLaunch } from "./pack.mjs";
import { normalizeV4ChainDeployment, normalizeV4ProfileRef } from "./v4-contract.mjs";
import { ROBINHOOD_PROFILE_V41, isRobinhoodProfileV41 } from "./profile-v41.mjs";
import { normalizeRobinhoodFundingPlanV1 } from "./funding-plan-v1.mjs";
import { ROBINHOOD_NATIVE_FEE_ARTIFACT_V1 as reviewed, ROBINHOOD_NATIVE_FEE_PERMISSIONS_V1,
  createRobinhoodNativeFeeRuntimeImmutablesV1 } from "./robinhood-native-fee-v1.mjs";

export const NATIVE20_INITIAL_SQRT_PRICE_X96 = "1747735933952748037356115466503453";
const TOKEN_PATH = "src/RobinhoodNative20Token.sol";
const INITIALIZER_PATH = "src/RobinhoodNative20Initializer.sol";
const ZERO = "0x0000000000000000000000000000000000000000";

/** Build a reviewable configuration only. No authentication, signing, or broadcast. */
export async function buildRobinhoodNative20ExampleV41({ projectRoot, capabilities, input, permitWindow, solc }) {
  const root = path.resolve(projectRoot);
  const profile = normalizeV4ProfileRef(capabilities?.profile);
  if (!isRobinhoodProfileV41(profile) || capabilities.chain?.id !== "4663" || capabilities.chain?.caip2 !== "eip155:4663") {
    throw new TypeError(`ROBINHOOD_PROFILE_NOT_AVAILABLE: this example requires the current capabilities profile ${ROBINHOOD_PROFILE_V41.profileVersion} with its complete immutable tuple; do not substitute a historical profile`);
  }
  const chainDeployment = normalizeV4ChainDeployment(capabilities.chainDeployment);
  const funding = { schemaVersion: "programmable.custom-launch-funding-intent.v2", mode: "none", valueWei: "0" };
  const fundingPlan = normalizeRobinhoodFundingPlanV1(input.fundingPlan, funding);
  if (fundingPlan.capitalSource !== "buyer-funded" || fundingPlan.pricingModel !== "concentrated-liquidity") {
    throw new TypeError("This example seeds locked token inventory with buyer-funded concentrated liquidity. Select a matching plan or implement a different reviewed project; no native principal or initial buy is performed here.");
  }
  if (solc.version() !== reviewed.compilerVersion) throw new TypeError(`exact solc ${reviewed.compilerVersion} is required`);
  const dependencies = JSON.parse(await readFile(new URL("../contracts/robinhood-native-fee-v1/native20-dependencies.json", import.meta.url), "utf8"));
  const kernelInput = structuredClone(reviewed.standardJsonInput);
  const exampleInput = { ...structuredClone(kernelInput), sources: {
    ...structuredClone(kernelInput.sources), ...dependencies.sources,
    [TOKEN_PATH]: { content: await readFile(path.join(root, TOKEN_PATH), "utf8") },
    [INITIALIZER_PATH]: { content: await readFile(path.join(root, INITIALIZER_PATH), "utf8") },
  } };
  // Preserve source paths and exact contents; compiler input remains fully self-contained.
  for (const [sourcePath, source] of Object.entries(exampleInput.sources)) {
    const destination = path.join(root, sourcePath);
    let existing;
    try { existing = await readFile(destination, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing !== undefined && existing !== source.content) throw new TypeError(`reviewed dependency source differs: ${sourcePath}`);
    if (existing === undefined) { await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, source.content); }
  }
  const outputs = new Map();
  for (const [name, standardJson] of [["kernel", kernelInput], ["native20", exampleInput]]) {
    // Output selection is not a compiler semantic setting. Additional local metadata is
    // needed for artifact parsing; the submitted reviewed kernel input stays byte-for-byte equivalent.
    const localInput = structuredClone(standardJson);
    localInput.settings.outputSelection["*"]["*"] = [...new Set([
      ...localInput.settings.outputSelection["*"]["*"], "metadata", "evm.bytecode.linkReferences", "evm.deployedBytecode.linkReferences",
    ])];
    const output = JSON.parse(solc.compile(JSON.stringify(localInput)));
    const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
    if (errors.length) throw new TypeError(errors.map(({ formattedMessage }) => formattedMessage).join("\n"));
    outputs.set(name, output);
    await writeJson(path.join(root, `standard-json-${name}.json`), standardJson);
  }
  const kernel = outputs.get("kernel").contracts[reviewed.kernel.sourcePath][reviewed.kernel.contractName];
  const token = outputs.get("native20").contracts[TOKEN_PATH].RobinhoodNative20Token;
  const initializer = outputs.get("native20").contracts[INITIALIZER_PATH].RobinhoodNative20Initializer;
  for (const [name, compiled] of [["hook", kernel], ["token", token], ["initializer", initializer]]) {
    await writeJson(path.join(root, "out", `${name}.json`), { abi: compiled.abi, metadata: compiled.metadata,
      bytecode: compiled.evm.bytecode, deployedBytecode: compiled.evm.deployedBytecode });
  }
  const manager = chainDeployment.contracts.poolManager.address;
  const factory = chainDeployment.contracts.graphFactory.address;
  const immutableValues = { poolManager: manager, token: { target: "token" }, lpFee: "0", tickSpacing: "60",
    initialSqrtPriceX96: NATIVE20_INITIAL_SQRT_PRICE_X96, initializer: { target: "initializer" },
    creatorBuyFeeBps: "0", creatorSellFeeBps: "0", module: ZERO, moduleCodeHash: `0x${"00".repeat(32)}`,
    maxModuleLpFeePips: "0", feeVault: ZERO };
  const initializerImmutables = immutableEntries(outputs.get("native20").sources[INITIALIZER_PATH].ast, initializer,
    { poolManager: manager, graphFactory: factory });
  const common = { initializer: null, deploymentValueWei: "0", initializerValueWei: "0", declaredHookPermissions: null };
  const config = {
    schemaVersion: "programmable.launch-pack-config.v4", chainId: "4663", caip2: "eip155:4663",
    chainDeployment, profile, launchWallet: input.launchWallet, nonce: input.nonce, permitWindow,
    source: { root: ".", paths: ["src", "lib"], sourceLineageNonce: input.sourceLineageNonce ?? "1",
      publicOrigin: input.publicOrigin }, externalContracts: [],
    compilationUnits: [{ compilationUnitId: "kernel", standardJson: "standard-json-kernel.json" },
      { compilationUnitId: "native20", standardJson: "standard-json-native20.json" }],
    targets: [
      { ...common, targetId: "initializer", compilationUnitId: "native20", artifact: "out/initializer.json",
        applicantSalt: `0x${"01".repeat(32)}`, constructorArguments: [manager, factory],
        initializer: { function: "initialize", arguments: [{ target: "token" }, { target: "hook" }] },
        componentKind: "other", runtimeImmutables: initializerImmutables },
      { ...common, targetId: "token", compilationUnitId: "native20", artifact: "out/token.json",
        applicantSalt: `0x${"02".repeat(32)}`, constructorArguments: [{ target: "initializer" }],
        componentKind: "token", runtimeImmutables: [] },
      { ...common, targetId: "hook", compilationUnitId: "kernel", artifact: "out/hook.json",
        applicantSalt: { mode: "deterministic-hook-permission-grind-v1", start: "0", maxAttempts: "262144" },
        constructorArguments: [manager, [{ target: "token" }, 0, 60, NATIVE20_INITIAL_SQRT_PRICE_X96,
          { target: "initializer" }, input.launchWallet, 0, 0, ZERO, 0]],
        componentKind: "hook", declaredHookPermissions: [...ROBINHOOD_NATIVE_FEE_PERMISSIONS_V1],
        runtimeImmutables: createRobinhoodNativeFeeRuntimeImmutablesV1(kernel, immutableValues) },
    ],
    pool: { tokenTargetId: "token", hookTargetId: "hook", fee: 0, tickSpacing: 60, quoteCurrency: ZERO },
    projectMetadata: input.projectMetadata, funding, fundingPlan,
    liquidityModel: { schemaVersion: "programmable.custom-launch-liquidity-model.v1", model: "project-provided-liquidity",
      declaredLaunchState: "liquidity-provided-by-launch", targetIds: ["initializer"] },
    agentAttestation: { agentId: "robinhood-native20-example", checkedAt: input.checkedAt,
      checks: [{ checkId: "exact-build", evidence: "evidence/build.json" }, { checkId: "profile-capabilities", evidence: "evidence/capabilities.json" }] },
  };
  await writeJson(path.join(root, "evidence/capabilities.json"), capabilities);
  await writeJson(path.join(root, "evidence/build.json"), { schemaVersion: "programmable.robinhood-native20-build.v1",
    compilerVersion: solc.version(), kernelStandardJsonSha256: sha256Digest(Buffer.from(canonicalizeJson(kernelInput))),
    exampleStandardJsonSha256: sha256Digest(Buffer.from(canonicalizeJson(exampleInput))), signing: false, broadcast: false });
  const configPath = path.join(root, "programmable-launch.config.json");
  await writeJson(configPath, config);
  const first = await buildLaunch({ configPath });
  const hookAddress = first.predictions.find(({ targetId }) => targetId === "hook").predictedAddress;
  const vaultAddress = getContractAddress({ from: hookAddress, opcode: "CREATE", nonce: 1n });
  config.targets[2].runtimeImmutables = createRobinhoodNativeFeeRuntimeImmutablesV1(kernel, { ...immutableValues, feeVault: vaultAddress });
  await writeJson(configPath, config);
  const built = await buildLaunch({ configPath });
  if (built.predictions.find(({ targetId }) => targetId === "hook").predictedAddress !== hookAddress) throw new Error("native fee child derivation changed the kernel address");
  return { configPath, config, built, vaultAddress };
}

function immutableEntries(ast, compiled, values) {
  const names = new Map();
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.nodeType === "VariableDeclaration" && node.mutability === "immutable") names.set(String(node.id), node.name);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
  }
  walk(ast);
  return Object.keys(compiled.evm.deployedBytecode.immutableReferences).map((immutableId) => {
    const literal = values[names.get(immutableId)];
    if (literal === undefined) throw new TypeError(`unmapped initializer immutable ${immutableId}`);
    return { immutableId, abiType: "address", literal };
  });
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
