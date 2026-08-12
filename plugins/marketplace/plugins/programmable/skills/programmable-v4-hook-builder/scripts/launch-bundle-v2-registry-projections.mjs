import { canonicalJson } from "./submission-core.mjs";
import {
  canonicalPositiveDecimal,
  isObject,
  sha256Utf8,
  validSlug
} from "./launch-bundle-v2-shared.mjs";

export function hasExactApplicationPackageReviewBinding(application, kind, binding, applicationSourceRef) {
  if (!binding || binding.sourceRef !== applicationSourceRef) return false;
  const records = Array.isArray(application?.reviewPackage?.records)
    ? application.reviewPackage.records
    : [];
  const matches = records.filter((record) => (
    record?.kind === kind
    && record?.source === "application-package"
    && record?.repositoryRef === null
    && record?.path === binding.path
    && record?.mediaType === binding.mediaType
    && record?.byteLength === binding.byteLength
    && record?.sha256 === binding.sha256
  ));
  return matches.length === 1;
}

export function registryVerificationDigestProjection(value) {
  const repositories = (Array.isArray(value) ? value : [])
    .filter(isObject)
    .map((binding) => ({
      repositoryRef: binding.repositoryRef,
      bindingSha256: sha256Utf8(canonicalJson(binding))
    }))
    .sort((left, right) => compareUtf8(String(left.repositoryRef), String(right.repositoryRef)));
  return {
    aggregateSha256: sha256Utf8(canonicalJson(repositories)),
    repositories
  };
}

export function registryTrustedSourceVerificationProjection(source) {
  if (!isObject(source) || !isObject(source.primary) || !Array.isArray(source.companions) || !Array.isArray(source.verificationReports)) {
    return null;
  }
  const repositories = [source.primary, ...source.companions];
  const bindings = source.verificationReports;
  if (
    repositories.length === 0
    || repositories.some((repository) => !isObject(repository) || !validSlug(repository.id))
    || bindings.length !== repositories.length
    || bindings.some((binding) => !isObject(binding) || binding.result !== "VERIFIED" || !validSlug(binding.repositoryRef))
  ) return null;

  const repositoryIds = repositories.map(({ id }) => id);
  const bindingIds = bindings.map(({ repositoryRef }) => repositoryRef);
  if (
    new Set(repositoryIds).size !== repositoryIds.length
    || new Set(bindingIds).size !== bindingIds.length
    || canonicalJson([...repositoryIds].sort(compareUtf8)) !== canonicalJson([...bindingIds].sort(compareUtf8))
  ) return null;

  const bindingsByRepository = new Map(bindings.map((binding) => [binding.repositoryRef, binding]));
  const trustedRepositories = repositories.map((repository) => {
    const binding = bindingsByRepository.get(repository.id);
    return {
      authoritySha256: sha256Utf8(`${canonicalJson({
        numericRepositoryId: repository.numericRepositoryId,
        repositoryUri: repository.repositoryUri,
        revisionObjectId: repository.revisionObjectId,
        treeObjectId: repository.treeObjectId
      })}\n`),
      bindingSha256: sha256Utf8(`${canonicalJson(binding)}\n`),
      closureSha256: binding.closureSha256,
      reportSha256: binding.reportSha256,
      repositoryRef: repository.id
    };
  }).sort((left, right) => compareUtf8(left.repositoryRef, right.repositoryRef));

  return {
    aggregateSha256: sha256Utf8(`${canonicalJson(trustedRepositories)}\n`),
    repositories: trustedRepositories,
    schemaVersion: "1.0.0",
    verifier: {
      builderNumericRepositoryId: "1320085947",
      builderRepository: "0xprogrammable/hookbuilder",
      reportVersion: "1.0.0"
    }
  };
}

export function registryApplicationPackageProjection(application) {
  if (
    !isObject(application)
    || !validSlug(application.applicationId)
    || !canonicalPositiveDecimal(application.applicationRevision)
    || !Array.isArray(application.reviewPackage?.records)
  ) return null;

  const applicationBytes = `${canonicalJson(application)}\n`;
  const files = [
    {
      byteLength: Buffer.byteLength(applicationBytes, "utf8"),
      path: "application.v3.json",
      sha256: sha256Utf8(applicationBytes)
    },
    ...application.reviewPackage.records
      .filter((record) => record?.source === "application-package")
      .map((record) => ({
        byteLength: record.byteLength,
        path: record.path,
        sha256: record.sha256
      }))
  ].sort((left, right) => compareUtf8(left.path, right.path));
  return {
    applicationBytes,
    files,
    packageSha256: sha256Utf8(canonicalJson({
      applicationId: application.applicationId,
      applicationRevision: application.applicationRevision,
      files
    }))
  };
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
