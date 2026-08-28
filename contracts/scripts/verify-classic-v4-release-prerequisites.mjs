import {
  CLASSIC_V4_NEW_CONTRACTS,
  stableStringify,
} from "../../scripts/classic-v4-release-core.mjs";
import { verifyClassicV4DeploymentAtFixedBlock } from "./verify-classic-v4-mainnet-deployment.mjs";
import { verifyClassicV4SourceProviders } from "./verify-classic-v4-mainnet-sources.mjs";
import { resolveClassicV4ReleaseValidation } from "./classic-v4-release-validation.mjs";

function fail(message) {
  throw new Error(message);
}

function withoutSourceObservationTime(evidence) {
  return Object.fromEntries(
    Object.entries(evidence).filter(
      ([key]) => key !== "checkedAt" && key !== "evidenceDigest",
    ),
  );
}

export function assertFreshDeploymentEvidence(saved, freshlyVerified) {
  if (stableStringify(freshlyVerified) !== stableStringify(saved)) {
    fail(
      "Deployment evidence differs from fresh fixed-block independent two-RPC verification",
    );
  }
}

export function assertFreshSourceEvidence(saved, freshlyVerified) {
  const savedTime = Date.parse(saved?.checkedAt);
  const freshTime = Date.parse(freshlyVerified?.checkedAt);
  if (
    Number.isNaN(savedTime) ||
    Number.isNaN(freshTime) ||
    savedTime > freshTime
  ) {
    fail("Saved source evidence checkedAt is later than the fresh provider replay");
  }
  if (
    stableStringify(withoutSourceObservationTime(freshlyVerified)) !==
    stableStringify(withoutSourceObservationTime(saved))
  ) {
    fail("Source evidence differs from fresh source-provider verification");
  }
}

export async function verifyClassicV4ReleasePrerequisites({
  endpoints,
  plan,
  deploymentEvidence,
  sourceEvidence,
  artifacts,
  artifactContext,
  deploymentVerifier = verifyClassicV4DeploymentAtFixedBlock,
  sourceVerifier = verifyClassicV4SourceProviders,
}) {
  const releaseValidation = resolveClassicV4ReleaseValidation(plan);
  releaseValidation.validateArtifacts(plan, artifacts, artifactContext);
  releaseValidation.validateDeploymentEvidence(plan, deploymentEvidence);
  releaseValidation.validateSourceEvidence(
    plan,
    deploymentEvidence,
    sourceEvidence,
  );
  const transactionHashes = Object.fromEntries(
    CLASSIC_V4_NEW_CONTRACTS.map((name) => [
      name,
      deploymentEvidence.contracts[name].transactionHash,
    ]),
  );
  const freshlyVerifiedDeploymentEvidence = await deploymentVerifier({
    endpoints,
    verificationBlock: deploymentEvidence.verificationBlock,
    plan,
    txHashes: transactionHashes,
    artifacts,
    artifactContext,
  });
  assertFreshDeploymentEvidence(
    deploymentEvidence,
    freshlyVerifiedDeploymentEvidence,
  );
  const sourceUsesEtherscan = CLASSIC_V4_NEW_CONTRACTS.some((name) =>
    sourceEvidence.contracts[name].providers.some(
      (provider) => provider.name === "Etherscan",
    ),
  );
  const freshlyVerifiedSourceEvidence = await sourceVerifier({
    plan,
    deploymentEvidence: freshlyVerifiedDeploymentEvidence,
    artifacts,
    artifactContext,
    etherscanApiKey: sourceUsesEtherscan
      ? process.env.ETHERSCAN_API_KEY?.trim() || null
      : null,
  });
  assertFreshSourceEvidence(sourceEvidence, freshlyVerifiedSourceEvidence);
  return {
    deploymentEvidence,
    sourceEvidence,
    freshlyVerifiedDeploymentEvidence,
    freshlyVerifiedSourceEvidence,
  };
}
