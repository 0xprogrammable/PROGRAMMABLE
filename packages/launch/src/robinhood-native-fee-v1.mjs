import { readFileSync } from "node:fs";
import { canonicalizeJson } from "./canonical-json.mjs";
import { assertExactKeys, sha256Digest } from "./io.mjs";

export const ROBINHOOD_NATIVE_FEE_ARTIFACT_SHA256_V1 = "sha256:917c03d59c7b6c051d6aa238cd0b2a91aa02c8993ccbfce6421d5c6341d5380e";
export const ROBINHOOD_NATIVE_FEE_ARTIFACT_V1 = deepFreeze(JSON.parse(readFileSync(
  new URL("../contracts/robinhood-native-fee-v1/artifact.json", import.meta.url), "utf8",
)));
if (sha256Digest(Buffer.from(JSON.stringify(ROBINHOOD_NATIVE_FEE_ARTIFACT_V1)))
  !== ROBINHOOD_NATIVE_FEE_ARTIFACT_SHA256_V1) {
  throw new Error("ROBINHOOD_FEE_ARTIFACT_INTEGRITY: reviewed native fee source kit has changed");
}
export const ROBINHOOD_NATIVE_FEE_PERMISSIONS_V1 = Object.freeze([
  "beforeInitialize", "beforeSwap", "afterSwap", "beforeSwapReturnDelta", "afterSwapReturnDelta",
]);

/** Exact local build matching only. Backend admission and onchain evidence remain separate. */
export function assertRobinhoodNativeFeeKernelBuildV1({ target, unit }) {
  const reviewed = ROBINHOOD_NATIVE_FEE_ARTIFACT_V1;
  if (!target || !unit || target.sourcePath !== reviewed.kernel.sourcePath
    || target.contractName !== reviewed.kernel.contractName
    || target.compilerVersion !== reviewed.compilerVersion.replace(/\.Emscripten\.clang$/u, "")
    || target.creationBytecode !== reviewed.kernel.creationBytecode
    || target.runtimeCode !== reviewed.kernel.runtimeTemplate
    || canonicalizeJson(unit.standardJsonInput) !== canonicalizeJson(reviewed.standardJsonInput)) {
    const error = new TypeError("ROBINHOOD_NATIVE_FEE_KERNEL_REQUIRED: profile 4.1 requires the reviewed native fee kernel and its exact Standard JSON build. Use the distributed robinhood-native-fee-v1 source kit; put custom logic in a separate reviewed module target.");
    error.code = "ROBINHOOD_NATIVE_FEE_KERNEL_REQUIRED";
    throw error;
  }
}

/** Map reviewed names to this exact compiler's immutable IDs without guessing AST numbering. */
export function createRobinhoodNativeFeeRuntimeImmutablesV1(compiledKernel, values) {
  const artifact = ROBINHOOD_NATIVE_FEE_ARTIFACT_V1.kernel;
  assertExactKeys(values, Object.keys(artifact.immutables), "native fee immutable values");
  const references = compiledKernel?.evm?.deployedBytecode?.immutableReferences;
  if (compiledKernel?.evm?.deployedBytecode?.object !== artifact.runtimeTemplate.slice(2)
    || !references) throw new TypeError("exact reviewed compiled kernel is required");
  const entries = Object.entries(artifact.immutables).map(([name, immutable]) => {
    const matches = Object.entries(references).filter(([, ranges]) =>
      canonicalizeJson(ranges) === canonicalizeJson(immutable.ranges));
    if (matches.length !== 1) throw new TypeError(`reviewed immutable ranges differ for ${name}`);
    const source = values[name];
    if (source !== null && typeof source === "object" && !Array.isArray(source)) {
      assertExactKeys(source, ["target"], `native fee immutable ${name}`);
      if (immutable.abiType !== "address") throw new TypeError(`${name} cannot use a target address`);
      return { immutableId: matches[0][0], abiType: immutable.abiType, target: source.target };
    }
    return { immutableId: matches[0][0], abiType: immutable.abiType, literal: source };
  });
  if (entries.length !== Object.keys(references).length) throw new TypeError("reviewed immutable coverage differs");
  return entries.sort((a, b) => Number(BigInt(a.immutableId) - BigInt(b.immutableId)));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
