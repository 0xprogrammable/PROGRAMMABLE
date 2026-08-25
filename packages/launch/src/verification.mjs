import { keccak256 } from "viem";

import { canonicalizeJson } from "./canonical-json.mjs";
import { compareUtf8, sha256Digest } from "./io.mjs";

export const VERIFICATION_BUNDLE_SCHEMA_V1 =
  "programmable.exact-source-verification-bundle.v1";
export const VERIFICATION_BUNDLE_SCHEMA_V2 =
  "programmable.exact-source-verification-bundle.v2";
export const VERIFICATION_BUNDLE_SCHEMA = VERIFICATION_BUNDLE_SCHEMA_V1;

export function buildVerificationBundle(
  units,
  targets,
  predictions,
  { apiVersion = "v1", runtimeCodes = [] } = {},
) {
  if (apiVersion !== "v1" && apiVersion !== "v2") {
    throw new TypeError("verification bundle apiVersion must be v1 or v2");
  }
  const compilerByUnit = new Map();
  for (const target of targets) {
    const prior = compilerByUnit.get(target.compilationUnitId);
    if (prior !== undefined && prior !== target.compilerVersion) {
      throw new TypeError(`compilation unit ${target.compilationUnitId} has conflicting compiler versions`);
    }
    compilerByUnit.set(target.compilationUnitId, target.compilerVersion);
  }
  const compilationUnits = units.map((unit) => {
    const compilerVersion = compilerByUnit.get(unit.compilationUnitId);
    if (compilerVersion === undefined) {
      throw new TypeError(`compilation unit ${unit.compilationUnitId} is not used by a graph target`);
    }
    return {
      compilationUnitId: unit.compilationUnitId,
      compilerVersion,
      standardJsonInputBase64: unit.standardJsonInputBase64,
      standardJsonInputSha256: unit.standardJsonInputSha256,
    };
  }).sort((left, right) => compareUtf8(left.compilationUnitId, right.compilationUnitId));
  const predictionByTarget = new Map(predictions.map((prediction) => [prediction.targetId, prediction]));
  const runtimeCodeByTarget = new Map(runtimeCodes.map(({ targetId, runtimeCode }) => [
    targetId,
    runtimeCode,
  ]));
  const components = targets.map((target) => {
    const prediction = predictionByTarget.get(target.targetId);
    if (!prediction) throw new TypeError(`missing CREATE2 prediction for ${target.targetId}`);
    const common = {
      targetId: target.targetId,
      compilationUnitId: target.compilationUnitId,
      sourcePath: target.sourcePath,
      contractName: target.contractName,
      constructorArguments: prediction.resolvedConstructorArguments,
    };
    if (apiVersion === "v1") return common;
    const runtimeCode = runtimeCodeByTarget.get(target.targetId);
    if (typeof runtimeCode !== "string" || !/^0x(?:[0-9a-f]{2})+$/.test(runtimeCode)
      || target.runtimeMaterialization === null) {
      throw new TypeError(`missing materialized V2 runtime for ${target.targetId}`);
    }
    return {
      ...common,
      runtimeMaterialization: {
        immutableReferences: target.runtimeMaterialization.immutableReferences,
        runtimeImmutables: target.runtimeMaterialization.runtimeImmutables,
        deployedRuntimeCodeBase64: Buffer.from(runtimeCode.slice(2), "hex").toString("base64"),
        deployedRuntimeCodeHash: keccak256(runtimeCode),
      },
    };
  }).sort((left, right) => compareUtf8(left.targetId, right.targetId));
  const schemaVersion = apiVersion === "v1"
    ? VERIFICATION_BUNDLE_SCHEMA_V1
    : VERIFICATION_BUNDLE_SCHEMA_V2;
  const verificationBundle = {
    schemaVersion,
    compilationUnits,
    components,
  };
  const verificationBundleHash = sha256Digest(Buffer.concat([
    Buffer.from(schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(verificationBundle), "utf8"),
  ]));
  return { verificationBundle, verificationBundleHash };
}
