import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const paths = [
  "contracts/src/interfaces/IProgrammableCustomRegistryV2.sol",
  "contracts/src/ProgrammableCustomRegistryV2.sol",
  "contracts/test/ProgrammableCustomRegistryV2.t.sol",
  "contracts/script/DeployProgrammableCustomRegistryV2.s.sol",
  "contracts/scripts/generate-custom-registry-v2-artifacts.mjs",
  "contracts/scripts/prepare-custom-registry-v2-deployment.mjs",
  "contracts/scripts/authorize-custom-registry-v2-deployment.mjs",
  "contracts/scripts/custom-registry-v2-deployment-guards.mjs",
  "contracts/scripts/broadcast-custom-registry-v2-deployment.mjs",
  "contracts/scripts/test/custom-registry-v2-deployment-guards.test.mjs",
  "contracts/scripts/test/custom-registry-v2-deployment-cli.test.mjs",
  "contracts/spec/custom-registry-v2-predeployment.json",
  "docs/security/abi/ProgrammableCustomRegistryV2.json",
  "docs/security/CUSTOM_REGISTRY_EVENT_SET_V2.json",
  "config/custom-registry-v2-release-policy.json",
];
const forbidden = [/providerId/i, /partnerId/i, /partnerFactoryRegistry/i, /repositoryId/i, /repositoryOwner/i];

for (const relative of paths) {
  const contents = await readFile(path.join(root, relative), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(contents)) throw new Error(`${relative} contains forbidden coupling ${pattern}`);
  }
}

const manifest = JSON.parse(await readFile(path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"), "utf8"));
const releasePolicy = JSON.parse(await readFile(path.join(root, "config/custom-registry-v2-release-policy.json"), "utf8"));
if (
  manifest.status !== "SOURCE_ONLY_NOT_DEPLOYED" ||
  manifest.activationAllowed !== false ||
  Object.values(manifest.deployment).some((value) => value !== null) ||
  manifest.policy.market.protocolFeeBps !== 10 ||
  manifest.policy.noMarket.protocolFeeBps !== 0
  || releasePolicy.releaseOwner !== manifest.releaseAuthorization.owner
  || releasePolicy.maximumAuthorizationValiditySeconds !== 300
  || releasePolicy.activationAllowed !== false
) {
  throw new Error("neutral predeployment manifest is not fail-closed");
}

process.stdout.write("CUSTOM_REGISTRY_V2_NEUTRALITY_VERIFIED\n");
