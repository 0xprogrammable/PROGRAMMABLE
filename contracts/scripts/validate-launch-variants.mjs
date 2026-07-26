import { readFile } from "node:fs/promises";

const specificationDirectory = new URL("../spec/", import.meta.url);
const configurationDirectory = new URL("../config/", import.meta.url);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(directory, file) {
  return JSON.parse(await readFile(new URL(file, directory), "utf8"));
}

const [
  catalog,
  directStandard,
  existingUerc20Standard,
  auctionStandard,
  behaviorCatalog,
  deployment,
] = await Promise.all([
    readJson(specificationDirectory, "launch-variants.v1.json"),
    readJson(specificationDirectory, "direct-standard-v1.json"),
    readJson(specificationDirectory, "existing-uerc20-standard-v1.json"),
    readJson(specificationDirectory, "verified-standard-v1.json"),
    readJson(specificationDirectory, "behavior-modules.v1.json"),
    readJson(configurationDirectory, "deployment-inputs.v1.json"),
  ]);

assert(catalog.schemaVersion === 1, "Unsupported launch catalog schema");
assert(Array.isArray(catalog.variants), "Launch variants are missing");
assert(catalog.variants.length > 0, "Launch catalog is empty");

const validStatuses = new Set(Object.keys(catalog.statusDefinitions));
const variantIds = new Set();
const protocolTestedIds = new Set();

for (const variant of catalog.variants) {
  assert(typeof variant.id === "string" && variant.id, "Variant ID is missing");
  assert(!variantIds.has(variant.id), `Duplicate variant ID ${variant.id}`);
  variantIds.add(variant.id);

  assert(
    validStatuses.has(variant.status),
    `${variant.id} uses undefined status ${variant.status}`,
  );
  assert(
    typeof variant.humanSummary === "string" && variant.humanSummary,
    `${variant.id} has no human summary`,
  );

  for (const axis of catalog.compositionAxes) {
    assert(variant[axis], `${variant.id} is missing composition axis ${axis}`);
  }

  if (variant.status === "protocol-tested") {
    assert(
      Array.isArray(variant.implementation) && variant.implementation.length > 0,
      `${variant.id} has no implementation evidence`,
    );
    assert(
      Array.isArray(variant.evidence) && variant.evidence.length > 0,
      `${variant.id} has no test evidence`,
    );
    protocolTestedIds.add(variant.id);
  }
}

for (const requiredId of [
  "auction-fixed-fee-locked-v1",
  "direct-fixed-fee-locked-v1",
  "direct-existing-token-locked-v1",
]) {
  assert(
    protocolTestedIds.has(requiredId),
    `${requiredId} must remain protocol-tested`,
  );
}

assert(
  directStandard.productionApproved === false,
  "Direct standard must not claim production approval",
);
assert(
  auctionStandard.productionApproved === false,
  "Auction standard must not claim production approval",
);
assert(
  existingUerc20Standard.productionApproved === false,
  "Existing UERC20 standard must not claim production approval",
);
assert(
  directStandard.platformFee.percentage ===
    deployment.platform.platformFeePercentage,
  "Direct standard fee differs from deployment configuration",
);
assert(
  auctionStandard.platformFee.percentage ===
    deployment.platform.platformFeePercentage,
  "Auction standard fee differs from deployment configuration",
);
assert(
  existingUerc20Standard.platformFee.percentage ===
    deployment.platform.platformFeePercentage,
  "Existing UERC20 standard fee differs from deployment configuration",
);

const configuredTreasury = deployment.platform.treasury.toLowerCase();
assert(
  catalog.verifiedBoundary.treasury.toLowerCase() === configuredTreasury,
  "Launch catalog treasury differs from deployment configuration",
);
assert(
  directStandard.platformFee.treasury.toLowerCase() === configuredTreasury,
  "Direct standard treasury differs from deployment configuration",
);
assert(
  auctionStandard.platformFee.treasury.toLowerCase() === configuredTreasury,
  "Auction standard treasury differs from deployment configuration",
);
assert(
  existingUerc20Standard.platformFee.treasury.toLowerCase() ===
    configuredTreasury,
  "Existing UERC20 standard treasury differs from deployment configuration",
);

const behaviorIds = new Set();
for (const behavior of behaviorCatalog.modules) {
  assert(
    typeof behavior.id === "string" && behavior.id,
    "Behavior module ID is missing",
  );
  assert(
    !behaviorIds.has(behavior.id),
    `Duplicate behavior module ID ${behavior.id}`,
  );
  behaviorIds.add(behavior.id);
  assert(
    Array.isArray(behavior.invariants) && behavior.invariants.length > 0,
    `${behavior.id} has no invariants`,
  );
}

assert(
  behaviorIds.has("SYS-01") &&
    behaviorIds.has("SYS-02") &&
    behaviorIds.has("SYS-03") &&
    behaviorIds.has("M-01") &&
    behaviorIds.has("C-01"),
  "A required V1 behavior module is missing",
);

console.log(
  `Validated ${catalog.variants.length} launch variants, ${protocolTestedIds.size} protocol-tested variants and ${behaviorIds.size} behavior modules`,
);
