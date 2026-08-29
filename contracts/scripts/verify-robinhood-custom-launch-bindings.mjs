#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  SAFE_DEPLOYMENTS_BASE_URL,
  SAFE_DEPLOYMENTS_CURRENT_BASE_URL,
  UNISWAP_CURRENT_URL,
  UNISWAP_PINNED_URL,
  fetchJsonText,
  fetchRobinhoodRuntimeSnapshot,
  fetchSafeRegistrySet,
  sha256Hex,
  verifyRuntimeSnapshot,
  verifySafeRegistries,
  verifyUniswapRegistry,
} from "./robinhood-custom-launch-bindings-core.mjs";
import { prepareOwnerTransaction } from "./prepare-robinhood-custom-launch-owner-transaction.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifestPath = fileURLToPath(
  new URL(
    "../spec/robinhood-custom-launch/chain-4663.v1.json",
    import.meta.url,
  ),
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const deploymentPath = fileURLToPath(
  new URL(
    "../deployments/robinhood-custom-launch-v1.predeployment.json",
    import.meta.url,
  ),
);
const deployment = JSON.parse(await readFile(deploymentPath, "utf8"));

if (
  manifest.schemaVersion !==
  "programmable.robinhood-custom-launch.chain-profile.v1"
) {
  throw new Error(`Unsupported manifest ${manifest.schemaVersion}`);
}
if (manifest.chainId !== "4663" || manifest.caip2 !== "eip155:4663") {
  throw new Error("Manifest is not redundantly bound to Robinhood Mainnet");
}
assert(
  manifest.deploymentState === "prepared-not-broadcast",
  "Manifest unexpectedly claims a live deployment",
);
assert(
  manifest.finality.policyId === "robinhood-stage-finality-v1" &&
    manifest.finality.policyRevision === 1 &&
    manifest.finality.policyDigest ===
      "sha256:537d531423d1285a3808556a57303ec68f1e6bdeea3c9aaf6320f9e5a0e47153",
  "Finality policy reference drift",
);
assert(
  deployment.chainDeploymentDescriptorDigest === null,
  "Predeployment descriptor digest must remain null",
);
assert(
  deployment.live === false && deployment.state === "prepared-not-broadcast",
  "Deployment state drift",
);
assert(
  deployment.foundationSourceCommitment === manifest.sourceCommitment,
  "Foundation source commitment mismatch",
);

const routerSource = await readFile(
  fileURLToPath(
    new URL(
      "../src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
      import.meta.url,
    ),
  ),
);
assert(
  sha256Hex(routerSource) === manifest.sources.router.sha256,
  "Recovered Router source hash drift",
);
const graphSource = await readFile(
  fileURLToPath(
    new URL("../src/ProgrammableCreate2GraphDeployerV1.sol", import.meta.url),
  ),
);
assert(
  sha256Hex(graphSource) === manifest.sources.graphFactory.sha256,
  "GraphFactory source hash drift",
);
const multicallSourceUrl =
  `https://raw.githubusercontent.com/mds1/multicall3/${manifest.sources.multicall3.commit}/` +
  manifest.sources.multicall3.path;
const multicallSourceResponse = await fetch(multicallSourceUrl);
assert(
  multicallSourceResponse.ok,
  `Multicall3 source returned HTTP ${multicallSourceResponse.status}`,
);
const multicallSourceText = await multicallSourceResponse.text();
assert(
  sha256Hex(multicallSourceText) === manifest.sources.multicall3.sha256,
  "Multicall3 source hash drift",
);

const prepared = await prepareOwnerTransaction(
  "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
);
assert(
  prepared.to === manifest.preparedOwnerTransaction.to,
  "Prepared owner transaction target drift",
);
assert(
  prepared.dataHash === manifest.preparedOwnerTransaction.dataHash,
  "Prepared owner calldata hash drift",
);
assert(
  prepared.dataBytes === manifest.preparedOwnerTransaction.dataBytes,
  "Prepared owner calldata size drift",
);
assert(
  prepared.dataHash === deployment.atomicOwnerTransaction.dataHash &&
    prepared.dataBytes === deployment.atomicOwnerTransaction.dataBytes,
  "Deployment view atomic transaction drift",
);
for (const [index, componentCall] of prepared.decodedComponentCalls.entries()) {
  assert(
    componentCall.dataHash ===
      manifest.decodedComponentCalls[index]?.dataHash &&
      componentCall.dataBytes ===
        manifest.decodedComponentCalls[index]?.dataBytes,
    `Prepared component call ${index} drift`,
  );
}

for (const [key, preparedAddress] of Object.entries(
  prepared.preparedAddresses,
)) {
  const profileKey = key === "router" ? "programmableLaunchStampRouter" : key;
  const deploymentKey =
    key === "router" ? "programmableLaunchStampRouter" : key;
  assert(
    preparedAddress.toLowerCase() ===
      manifest.contracts.programmable[profileKey].address.toLowerCase(),
    `${key} profile address drift`,
  );
  assert(
    preparedAddress.toLowerCase() ===
      deployment.contracts[deploymentKey].address.toLowerCase(),
    `${key} deployment address drift`,
  );
}

const pinnedUniswap = await fetchJsonText(UNISWAP_PINNED_URL);
if (sha256Hex(pinnedUniswap.text) !== manifest.sources.uniswapRegistry.sha256) {
  throw new Error(
    "Pinned Uniswap 4663 registry bytes do not match the reviewed SHA-256",
  );
}
verifyUniswapRegistry({
  registry: pinnedUniswap.json,
  expectedBindings: manifest.contracts.uniswap,
});

const currentUniswap = await fetchJsonText(UNISWAP_CURRENT_URL);
verifyUniswapRegistry({
  registry: currentUniswap.json,
  expectedBindings: manifest.contracts.uniswap,
});

const pinnedSafe = await fetchSafeRegistrySet(SAFE_DEPLOYMENTS_BASE_URL);
verifySafeRegistries({
  records: pinnedSafe,
  expectedBindings: manifest.contracts.safeInfrastructure,
});
const currentSafe = await fetchSafeRegistrySet(
  SAFE_DEPLOYMENTS_CURRENT_BASE_URL,
);
verifySafeRegistries({
  records: currentSafe,
  expectedBindings: manifest.contracts.safeInfrastructure,
});

const rpcUrl = process.env.ROBINHOOD_MAINNET_RPC_URL ?? manifest.rpc.public;
const externalBindings = {
  ...manifest.contracts.uniswap,
  ...manifest.contracts.safeInfrastructure,
  ...manifest.contracts.deploymentInfrastructure,
};
const externalSnapshot = await fetchRobinhoodRuntimeSnapshot({
  rpcUrl,
  bindings: externalBindings,
});
verifyRuntimeSnapshot({
  snapshot: externalSnapshot,
  expectedBindings: externalBindings,
});

const programmableSnapshot = await fetchRobinhoodRuntimeSnapshot({
  rpcUrl,
  bindings: manifest.contracts.programmable,
});
if (manifest.deploymentState === "prepared-not-broadcast") {
  verifyRuntimeSnapshot({
    snapshot: programmableSnapshot,
    expectedBindings: manifest.contracts.programmable,
    expectVacant: true,
  });
} else {
  verifyRuntimeSnapshot({
    snapshot: programmableSnapshot,
    expectedBindings: manifest.contracts.programmable,
  });
}

process.stdout.write(
  `${JSON.stringify({
    chainId: externalSnapshot.chainId,
    blockNumber: externalSnapshot.blockNumber,
    blockHash: externalSnapshot.blockHash,
    uniswapRegistry: "current-and-pinned-match",
    safeRegistry: "current-and-pinned-match",
    programmableState: manifest.deploymentState,
    verifiedExternalContracts: Object.keys(externalBindings).length,
    verifiedProgrammableContracts: Object.keys(manifest.contracts.programmable)
      .length,
  })}\n`,
);
