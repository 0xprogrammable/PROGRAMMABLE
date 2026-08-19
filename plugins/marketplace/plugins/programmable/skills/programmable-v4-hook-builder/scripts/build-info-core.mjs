import {
  FOUNDRY_BUILD_INFO_FORMAT,
  finalize,
  isPlainObject,
  validateJsonStructure
} from "./build-info-shared.mjs";
import {
  collectReviewSources,
  validateBuildInfoIdentity,
  validateCompilerInput,
  validateDeclaredCompiler,
  validatePathMetadata
} from "./build-info-input-validation.mjs";
import { validateCompilerOutput } from "./build-info-output-validation.mjs";

export { FOUNDRY_BUILD_INFO_FORMAT };


/**
 * Validate a full Foundry build-info object without reading files, invoking a
 * compiler or executing repository code.
 *
 * The caller supplies trusted compiler and repository path metadata. The
 * returned array is deduplicated and sorted so the same input has the same
 * result regardless of object insertion order.
 *
 * This is a self-consistency check for untrusted build-info. It does not prove
 * which compiler executable produced the file and does not attest a compiler
 * binary digest.
 *
 * @param {{
 *   buildInfo: object,
 *   reviewTarget: {files: Array<{path: string, bytes: number, sha256: string}>},
 *   declaredCompiler: {
 *     solidity: string,
 *     sourceRevision: string,
 *     evmVersion: string,
 *     optimizer: boolean,
 *     optimizerRuns: number,
 *     viaIR: boolean,
 *     metadataBytecodeHash: string,
 *     cborMetadata: boolean
 *   },
 *   pathMetadata: {
 *     repositoryRoot: string,
 *     buildInfoPath: string,
 *     firstPartyRoots: string[],
 *     remappings: string[]
 *   }
 * }} input
 * @returns {string[]}
 */
export function validateFoundryBuildInfo(input = {}) {
  const errors = [];
  if (!isPlainObject(input)) return ["build info validation input must be an object"];

  const {
    buildInfo,
    reviewTarget,
    declaredCompiler,
    pathMetadata
  } = input;

  const structuresValid = [
    validateJsonStructure(buildInfo, "build info JSON", errors),
    validateJsonStructure(reviewTarget, "review target JSON", errors),
    validateJsonStructure(declaredCompiler, "declared compiler JSON", errors),
    validateJsonStructure(pathMetadata, "repository path metadata JSON", errors)
  ].every(Boolean);
  if (!structuresValid) return finalize(errors);

  if (!isPlainObject(buildInfo)) errors.push("build info must be an object");
  if (!isPlainObject(reviewTarget)) errors.push("review target must be an object");
  if (!isPlainObject(declaredCompiler)) errors.push("declared compiler must be an object");
  if (!isPlainObject(pathMetadata)) errors.push("repository path metadata must be an object");
  if (errors.length > 0) return finalize(errors);

  const repositoryPaths = validatePathMetadata(pathMetadata, errors);
  const compiler = validateDeclaredCompiler(declaredCompiler, errors);

  validateBuildInfoIdentity(buildInfo, compiler, errors);

  const reviewSources = collectReviewSources(reviewTarget, errors);
  const inputSources = validateCompilerInput(
    buildInfo.input,
    reviewSources,
    compiler,
    repositoryPaths,
    errors
  );
  validateCompilerOutput(
    buildInfo.output,
    buildInfo.source_id_to_path,
    inputSources,
    errors
  );

  return finalize(errors);
}
