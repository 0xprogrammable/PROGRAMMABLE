import { canonicalizeJson } from "./canonical-json.mjs";
import { compareUtf8, sha256Digest } from "./io.mjs";

export const VERIFICATION_BUNDLE_SCHEMA =
  "programmable.exact-source-verification-bundle.v1";

export function buildVerificationBundle(units, targets, predictions) {
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
  const components = targets.map((target) => {
    const prediction = predictionByTarget.get(target.targetId);
    if (!prediction) throw new TypeError(`missing CREATE2 prediction for ${target.targetId}`);
    return {
      targetId: target.targetId,
      compilationUnitId: target.compilationUnitId,
      sourcePath: target.sourcePath,
      contractName: target.contractName,
      constructorArguments: prediction.resolvedConstructorArguments,
    };
  }).sort((left, right) => compareUtf8(left.targetId, right.targetId));
  const verificationBundle = {
    schemaVersion: VERIFICATION_BUNDLE_SCHEMA,
    compilationUnits,
    components,
  };
  const verificationBundleHash = sha256Digest(Buffer.concat([
    Buffer.from(VERIFICATION_BUNDLE_SCHEMA, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(verificationBundle), "utf8"),
  ]));
  return { verificationBundle, verificationBundleHash };
}
