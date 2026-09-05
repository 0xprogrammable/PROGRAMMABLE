import { canonicalizeJson } from "./canonical-json.mjs";
import { sha256Digest } from "./io.mjs";

const profile = Object.freeze({
  schemaVersion: "programmable.custom-launch-profile-ref.v4",
  structuralProfileId: "programmable.custom-launch.robinhood-mainnet.v1",
  businessProfileId: "robinhood-production-launch",
  admissionDescriptorDigest: "sha256:b09611360e284641873fdb2914b4282e0545e32ea587b278fcd11f4db9a4e7f5",
  admissionPolicyDigest: "sha256:47801f57e2365f89eb7397a2df10d697bd1f756ec01536b9b34755e89809da04",
  admissionBindingDigest: "sha256:5b2486f35fcd44bd476cafd5bfb5a12decf05a756ba237ca191928f5414c721e",
  admissionSchemaDigest: "sha256:6a8194a3b5d8b6432a95ec04da3cd86091ad64c93c0531125caf00ecb919c8cf",
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
