import { createCliDiagnosticError } from "./diagnostics.mjs";

export const ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE =
  "ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE";

export const ROBINHOOD_V4_OWNER_FEE_DECISION = Object.freeze({
  chainId: "4663",
  caip2: "eip155:4663",
  platformId: "programmable",
  category: "custom",
  label: "Programmable Custom",
  scope: "new-api-custom-launches",
  ratePpm: "2000",
  rateDenominatorPpm: "1000000",
  recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
  existingLaunchesChanged: false,
  ethereumChanged: false,
});

export function assertCanonicalRobinhoodV4FeeProfileAvailable({ stage }) {
  // Deliberately unconditional: no environment variable, API response, pack
  // config, or client-supplied graph can enable this release. Activation must
  // replace this gate with a reviewed profile validator bound to deployed
  // non-bypassable fee-path evidence.
  throw createCliDiagnosticError({
    code: ROBINHOOD_V4_CANONICAL_FEE_PROFILE_UNAVAILABLE,
    stage,
    summary: "The canonical Robinhood fee profile is unavailable; V4 packaging and validation fail closed.",
    expected: {
      ownerDecision: ROBINHOOD_V4_OWNER_FEE_DECISION,
      requiredAuthorities: [
        "authoritative-versioned-fee-profile-artifact",
        "deployed-non-bypassable-onchain-fee-component",
        "exact-source-creation-runtime-and-reciprocal-composition-binding",
        "canonical-launch-stamp-component-binding",
      ],
      requiredSemantics: [
        "rate",
        "basis",
        "currency",
        "recipient",
        "rounding",
        "accrual",
        "claim",
      ],
    },
    observed: {
      boundCanonicalFeeProfileArtifact: null,
      boundNonBypassableFeeComponent: null,
      boundBasis: null,
      boundCurrency: null,
      boundRounding: null,
      boundAccrual: null,
      boundClaim: null,
      packageState: "fail-closed",
    },
    retryable: false,
    requiresNewRequest: true,
    requiredChange: "Publish the reviewed canonical Robinhood fee profile and deployed non-bypassable component evidence, then rebuild a new request; do not substitute API metadata or Ethereum fee bytes.",
    resumeAt: "pack",
  });
}
