import { canonicalizeJson } from "./canonical-json.mjs";
import { sha256Digest } from "./io.mjs";

const profile = Object.freeze({
  schemaVersion: "programmable.custom-launch-profile-ref.v4",
  structuralProfileId: "programmable.custom-launch.robinhood-mainnet.v1",
  businessProfileId: "robinhood-production-launch",
  admissionDescriptorDigest: "sha256:a2ed199d421634ac1ee821769ac4526cae46cc3a1357a374a87aa49ee5c649d6",
  admissionPolicyDigest: "sha256:4307368bef409e6c7609a1a775f88f45f94f34cfefe8b1d2316589d5244661e8",
  admissionBindingDigest: "sha256:4553def3ee66dba41dd0296a3ae12fd5989c34a3b595d657226fa25239f17ea2",
  admissionSchemaDigest: "sha256:55ec992f3f93d4ed57c09bd41ef257e65e492bf3e9a12b2a780d01252a9ccf89",
  profileRevision: 2,
  profileVersion: "4.1.0",
});

export const ROBINHOOD_PROFILE_V41 = Object.freeze({
  ...profile,
  profileDigest: sha256Digest(Buffer.concat([
    Buffer.from(profile.schemaVersion), Buffer.from([0]), Buffer.from(canonicalizeJson(profile)),
  ])),
});

export const OPENAPI_URL_V41 = "https://programmable.market/openapi/custom-launch-v4.1.json";
export const PACK_CONFIG_V41_CONTRACT_URL = "https://programmable.market/schemas/custom-launch/v4.1/pack-config.json";

/** Used only after the complete profile tuple has passed exact normalization. */
export function isRobinhoodProfileV41(profileValue) {
  return canonicalizeJson(profileValue) === canonicalizeJson(ROBINHOOD_PROFILE_V41);
}

export const PACK_CONFIG_V41_EXAMPLE_URL = "https://github.com/programmablehq/PROGRAMMABLE/blob/programmable-launch-v4.1.0/packages/launch/examples/robinhood-v4-native20/README.md";
