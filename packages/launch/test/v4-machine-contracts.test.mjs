import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalizeJson } from "../src/canonical-json.mjs";
import { normalizeV4ExternalContracts } from "../src/v4-contract.mjs";

import {
  validExactWalletTransaction,
  validPreparedArtifactV4,
  validV4ExternalContractDeclaration,
  validV4ExternalProxyContractDeclaration,
  validV4Capabilities,
  validV4Preflight,
  validV4ProjectMetadata,
  validV4Resource,
  v4ChainDeployment,
  v4Profile,
} from "./fixtures/v4.mjs";

const packageSchema = JSON.parse(await readFile(
  new URL("../schemas/programmable-launch-pack-config-v4.json", import.meta.url),
  "utf8",
));
const publicSchema = JSON.parse(await readFile(
  new URL("../../../public/schemas/custom-launch/v4/pack-config.json", import.meta.url),
  "utf8",
));
const openapi = JSON.parse(await readFile(
  new URL("../../../public/openapi/custom-launch-v4.json", import.meta.url),
  "utf8",
));
const publicSchemaFiles = Object.freeze({
  "pack-config.json": "PackConfigV4",
  "custom-launch-create-request.json": "CustomLaunchCreateRequestV4",
  "custom-launch.json": "CustomLaunchResourceV4",
  "capabilities.json": "CustomLaunchCapabilitiesV2",
  "preflight.json": "CustomLaunchPreflightV2",
  "onchain-evidence.json": "CustomLaunchOnchainEvidenceV2",
  "exact-wallet-transaction.json": "ExactWalletTransactionV4",
});
const publicSchemas = new Map(await Promise.all(
  Object.keys(publicSchemaFiles).map(async (name) => [
    name,
    JSON.parse(await readFile(
      new URL(`../../../public/schemas/custom-launch/v4/${name}`, import.meta.url),
      "utf8",
    )),
  ]),
));
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  validateFormats: false,
});
for (const keyword of [
  "x-programmable-status",
  "x-programmable-contract",
  "x-programmable-aggregateCalldataAndHookDataMaximumBytes",
  "x-programmable-maximumBytes",
  "x-programmable-uniqueStepIds",
]) {
  ajv.addKeyword(keyword);
}
ajv.addKeyword({
  keyword: "x-programmable-order",
  schemaType: "string",
  validate: validateProgrammableOrder,
});
ajv.addKeyword({
  keyword: "x-programmable-minUtf8Bytes",
  type: "string",
  schemaType: "number",
  validate: (minimum, value) => Buffer.byteLength(value, "utf8") >= minimum,
});
ajv.addKeyword({
  keyword: "x-programmable-minUnicodeLettersOrNumbers",
  type: "string",
  schemaType: "number",
  validate: (minimum, value) => [...value.matchAll(/[\p{L}\p{N}]/gu)].length >= minimum,
});
const validate = ajv.compile(packageSchema);

const ADMISSION_SCHEMA_DIGEST =
  "sha256:a28a6de6208d6ba7b65b4b706174509570955ba9ce9714624bcb2046ab7beae7";

function frozenV4Profile() {
  const value = structuredClone(v4Profile);
  value.admissionSchemaDigest ??= ADMISSION_SCHEMA_DIGEST;
  value.profileDigest =
    "sha256:484b1dc6e9091804fabc230f2b3a7504940fa00264f8e66e82a66a951e71f1a0";
  return value;
}

test("public and packaged V4 pack schemas are byte-for-byte equivalent JSON contracts", () => {
  assert.deepEqual(publicSchema, packageSchema);
  assert.equal(packageSchema.$id, "https://programmable.market/schemas/custom-launch/v4/pack-config.json");
  assert.deepEqual(packageSchema["x-programmable-contract"], {
    cliReleaseVersion: "4.0.0",
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    minimumTargets: 3,
    maximumTargets: 16,
    fundingModes: ["none", "wallet-transaction-value"],
    walletSigning: "separate-owner-action",
  });
});

test("V4 Safe source commitment is recomputed from the exact non-Sourcify source subject", () => {
  const domain = "programmable.safe-source-commitment.v1";
  const subject = {
    schemaVersion: domain,
    repository: "safe-global/safe-deployments",
    commit: "0974182c16c57ca6fe2b9bba8cffb8a7e55fb83c",
    version: "1.4.1",
    proxy: {
      sourceIdentity: "SafeProxy",
      address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
      runtimeCodeHash:
        "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
    },
    singleton: {
      sourceIdentity: "Safe",
      address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
      runtimeCodeHash:
        "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
    },
    fallbackHandler: {
      sourceIdentity: "CompatibilityFallbackHandler",
      address: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
      runtimeCodeHash:
        "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
    },
    sourcifyExactMatchClaimed: false,
  };
  const expected = packageSchema.$defs.chainDeployment.properties
    .permitAuthoritySourceProvenance.properties.sourceCommitment.const;
  assert.equal(framedSha256Json(domain, subject), expected);
  const mutation = structuredClone(subject);
  mutation.sourcifyExactMatchClaimed = true;
  assert.notEqual(framedSha256Json(domain, mutation), expected);
});

test("V4 pack schema accepts a 3-target Robinhood general-hook graph", () => {
  const config = baseConfig();
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  config.targets.push({ ...config.targets[2], targetId: "fourth" });
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
});

test("V4 pack schema rejects cross-chain, trust-root, profile, funding, and graph bypasses", () => {
  const cases = [
    ["Ethereum chain", (config) => { config.chainId = "1"; }],
    ["Robinhood testnet", (config) => { config.chainId = "46630"; }],
    ["wrong CAIP-2", (config) => { config.caip2 = "eip155:1"; }],
    ["body deployment chain mismatch", (config) => { config.chainDeployment.chainId = "1"; }],
    ["missing Router", (config) => { delete config.chainDeployment.contracts.programmableLaunchStampRouter; }],
    ["zero Router runtime hash", (config) => {
      config.chainDeployment.contracts.programmableLaunchStampRouter.runtimeCodeHash = `0x${"0".repeat(64)}`;
    }],
    ["profile revision drift", (config) => { config.profile.profileRevision = 2; }],
    ["old EIP-3009 funding", (config) => { config.funding.mode = "eip-3009-receive-with-authorization"; }],
    ["none with wallet value", (config) => { config.funding.valueWei = "1"; }],
    ["two targets", (config) => { config.targets.length = 2; }],
    ["seventeen targets", (config) => {
      while (config.targets.length < 17) {
        config.targets.push({ ...config.targets[2], targetId: `target-${config.targets.length}` });
      }
    }],
    ["unknown API key input", (config) => { config.apiKey = "must-never-be-a-config-field"; }],
    ["missing public X metadata", (config) => { config.projectMetadata.presentation.links.pop(); }],
    ["unknown hook permission", (config) => {
      config.targets[1].declaredHookPermissions = ["adminDrain"];
    }],
  ];
  for (const [label, mutate] of cases) {
    const config = baseConfig();
    mutate(config);
    assert.equal(validate(config), false, label);
  }
});

test("V4 chain deployment schema locks atomic, registry, Permit2, Safe, and finality evidence", () => {
  const validateDeployment = machineContractAjv().compile(
    packageSchema.$defs.chainDeployment,
  );
  const golden = deploymentWithSafeEvidence();
  assert.equal(validateDeployment(golden), true, JSON.stringify(validateDeployment.errors));

  const cases = [
    ["atomic chain id", (deployment) => {
      deployment.deploymentEvidence.chainId = "1";
    }],
    ["atomic sender outside the frozen Safe owners", (deployment) => {
      deployment.deploymentEvidence.from = "0x0000000000000000000000000000000000000001";
    }],
    ["atomic calldata hash drift", (deployment) => {
      deployment.deploymentEvidence.calldataHash = `0x${"a".repeat(64)}`;
    }],
    ["atomic receipt failure", (deployment) => {
      deployment.deploymentEvidence.receiptStatus = "0";
    }],
    ["atomic provider order", (deployment) => {
      deployment.deploymentEvidence.providerReadbacks.reverse();
    }],
    ["atomic resulting-contract order", (deployment) => {
      deployment.deploymentEvidence.resultingContracts.reverse();
    }],
    ["atomic result provider order", (deployment) => {
      deployment.deploymentEvidence.resultingContracts[0].providerReadbacks.reverse();
    }],
    ["atomic result predecessor block", (deployment) => {
      deployment.deploymentEvidence.resultingContracts[0]
        .providerReadbacks[0].preDeploymentBlockNumber =
          deployment.deploymentEvidence.blockNumber;
    }],
    ["atomic result predecessor provider disagreement", (deployment) => {
      const providers = deployment.deploymentEvidence.resultingContracts[0].providerReadbacks;
      providers[1].preDeploymentBlockHash = providers[0].preDeploymentBlockHash
        === `0x${"a".repeat(64)}`
        ? `0x${"b".repeat(64)}`
        : `0x${"a".repeat(64)}`;
    }],
    ["atomic source-verification split", (deployment) => {
      deployment.deploymentEvidence.sourceVerification
        .officialSourcePinnedCoveredContracts = ["graphFactory"];
    }],
    ["atomic receipt-log order", (deployment) => {
      deployment.deploymentEvidence.receiptLogs = [
        {
          address: "0x0000000000000000000000000000000000000001",
          topics: [],
          data: "0x",
          logIndex: "2",
        },
        {
          address: "0x0000000000000000000000000000000000000002",
          topics: [],
          data: "0x",
          logIndex: "1",
        },
      ];
    }],
    ["unknown atomic evidence field", (deployment) => {
      deployment.deploymentEvidence.scope = "not-part-of-the-contract";
    }],
    ["Permit2 genesis source drift", (deployment) => {
      deployment.permit2GenesisProvenance.genesisSourceDigest = `sha256:${"0".repeat(64)}`;
    }],
    ["Permit2 provider order", (deployment) => {
      deployment.permit2GenesisProvenance.providerReadbacks.reverse();
    }],
    ["Permit2 provider block disagreement", (deployment) => {
      const primaryHash = deployment.permit2GenesisProvenance.providerReadbacks[0].blockHash;
      deployment.permit2GenesisProvenance.providerReadbacks[1].blockHash = primaryHash
        === `0x${"a".repeat(64)}`
        ? `0x${"b".repeat(64)}`
        : `0x${"a".repeat(64)}`;
    }],
    ["unknown Permit2 evidence field", (deployment) => {
      deployment.permit2GenesisProvenance.scope = "not-part-of-the-contract";
    }],
    ["external root tuple order", (deployment) => {
      deployment.externalRootDeploymentEvidence.reverse();
    }],
    ["external root registry commit drift", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].registrySource.commit =
        "0000000000000000000000000000000000000000";
    }],
    ["external root start block drift", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].startBlock = "9071";
    }],
    ["external root provider order", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].providerReadbacks.reverse();
    }],
    ["external root provider block disagreement", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].providerReadbacks[1].blockHash =
        `0x${"a".repeat(64)}`;
    }],
    ["unknown external root evidence field", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].sourceCommitment =
        `sha256:${"a".repeat(64)}`;
    }],
    ["Safe proxy runtime drift", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence
        .proxyRuntimeCodeHash = `0x${"a".repeat(64)}`;
    }],
    ["Safe source commitment drift", (deployment) => {
      deployment.permitAuthoritySourceProvenance.sourceCommitment =
        `sha256:${"a".repeat(64)}`;
    }],
    ["Safe owner order", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence.owners.reverse();
    }],
    ["Safe threshold drift", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence.threshold = 2;
    }],
    ["Safe atomic result digest disagreement", (deployment) => {
      const safe = deployment.permitAuthoritySourceProvenance.configurationEvidence;
      const resultDigest = deployment.deploymentEvidence.resultingContracts[0]
        .stateEvidenceDigest;
      safe.atomicRootStateEvidenceDigest = resultDigest === `sha256:${"a".repeat(64)}`
        ? `sha256:${"b".repeat(64)}`
        : `sha256:${"a".repeat(64)}`;
    }],
    ["L2 finality provider order", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence.l2Providers.reverse();
    }],
    ["Ethereum finality provider order", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence.ethereumProviders.reverse();
    }],
    ["zero L1 confirmations", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence.l2Providers[0].l1Confirmations = "0";
    }],
    ["finality profile drift", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence.profile.profileRevision = 2;
    }],
    ["Ethereum finalized block before posting", (deployment) => {
      const evidence = deployment.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence;
      evidence.postingBlockNumber = "100";
      evidence.ethereumFinalizedCheckpoint.blockNumber = "99";
    }],
    ["unknown finality field", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence
        .ethereumFinalityEvidence.confirmationClaim = true;
    }],
  ];
  for (const [label, mutate] of cases) {
    const deployment = structuredClone(golden);
    mutate(deployment);
    assert.equal(validateDeployment(deployment), false, label);
  }
});

test("OpenAPI 4.0.0 publishes all required V4 routes and machine schema names", () => {
  assert.equal(openapi.info.version, "4.0.0");
  assert.deepEqual(Object.keys(openapi.paths), [
    "/v4/chains/{chainId}/capabilities",
    "/v4/chains/{chainId}/custom-launches/preflight",
    "/v4/chains/{chainId}/custom-launches",
    "/v4/chains/{chainId}/custom-launches/{launchId}",
    "/v4/chains/{chainId}/finalized-custom-launches",
  ]);
  const expected = {
    CustomLaunchCreateRequestV4: "programmable.custom-launch-create-request.v4",
    CustomLaunchCapabilitiesV2: "programmable.custom-launch-capabilities.v2",
    CustomLaunchPreflightV2: "programmable.custom-launch-preflight.v2",
    CustomLaunchResourceV4: "programmable.custom-launch.v4",
    CustomLaunchOnchainEvidenceV2: "programmable.custom-launch-onchain-evidence.v2",
    ExactWalletTransactionV4: "programmable.exact-wallet-transaction.v4",
  };
  for (const [name, schemaVersion] of Object.entries(expected)) {
    assert.equal(openapi.components.schemas[name].properties.schemaVersion.const, schemaVersion);
  }
  assert.equal(
    JSON.stringify(openapi).includes("apiKey"),
    true,
    "OpenAPI may describe API-key authentication",
  );
  assert.equal(
    JSON.stringify(openapi.components.schemas.CustomLaunchCreateRequestV4)
      .toLowerCase()
      .includes("apikey"),
    false,
    "request body must not accept an API key",
  );
});

test("every standalone V4 schema is self-contained and exactly equals its OpenAPI component", () => {
  for (const [fileName, componentName] of Object.entries(publicSchemaFiles)) {
    const standalone = publicSchemas.get(fileName);
    assert.deepEqual(
      openapi.components.schemas[componentName],
      standalone,
      `${fileName} must exactly equal ${componentName}`,
    );
    assert.equal(
      containsRemoteReference(standalone),
      false,
      `${fileName} must compile without network access`,
    );
  }
});

test("standalone and OpenAPI V4 schemas accept goldens and reject one-field additions in parity", () => {
  const deployment = deploymentWithSafeEvidence();
  const frozenProfile = frozenV4Profile();
  const exactWallet = validExactWalletTransaction();
  exactWallet.chainDeployment = deployment;
  exactWallet.profile = frozenProfile;
  const resource = validV4Resource(undefined, undefined, {
    chainDeployment: deployment,
    profile: frozenProfile,
    status: "wallet_action_required",
    walletTransactionPreimageHash: exactWallet.transactionPreimageHash,
    walletTransaction: exactWallet,
    preparedArtifact: validPreparedArtifactV4(exactWallet.commitments),
    admissionReceipt: null,
    simulationReceipt: null,
    externalContractEvidenceReceipt: externalEvidenceReceipt(),
    actionRequired: {
      kind: "send-router-transaction",
      walletHandoffUrl: "https://programmable.market/developers/api-keys?launchId=70000000-0000-4000-8000-000000000007",
      expiresAt: exactWallet.expiresAt,
    },
  });
  const evidence = {
    schemaVersion: "programmable.custom-launch-onchain-evidence.v2",
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
    chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
    chainDeployment: deployment,
    profile: frozenProfile,
    router: deployment.contracts.programmableLaunchStampRouter.address,
    routerRuntimeCodeHash:
      deployment.contracts.programmableLaunchStampRouter.runtimeCodeHash,
    routerLaunchId: `0x${"1".repeat(64)}`,
    transactionHash: `0x${"2".repeat(64)}`,
    blockNumber: "49210000",
    blockHash: `0x${"3".repeat(64)}`,
    logIndex: 0,
    checkpointType: "ethereum_finalized",
    finalityPolicy: deployment.finality,
    commitments: exactWallet.commitments,
    walletTransactionPreimageHash: exactWallet.transactionPreimageHash,
    evidenceDigest: `sha256:${"4".repeat(64)}`,
    terminal: true,
    observedAt: "2026-08-29T12:30:00.000Z",
  };
  resource.externalContractEvidenceReceipt = externalEvidenceReceipt({
    requestHash: resource.requestHash,
    rawRequestSha256: resource.rawRequestSha256,
    chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
    profile: frozenProfile,
    profileDigest: frozenProfile.profileDigest,
  });
  const capabilities = validV4Capabilities({
    chainDeployment: deployment,
    profile: frozenProfile,
  });
  const preflight = validV4Preflight();
  preflight.profile = frozenProfile;
  const goldens = new Map([
    ["pack-config.json", baseConfig()],
    ["custom-launch-create-request.json", fixtureFromSchema(
      publicSchemas.get("custom-launch-create-request.json"),
    )],
    ["custom-launch.json", resource],
    ["capabilities.json", capabilities],
    ["preflight.json", preflight],
    ["onchain-evidence.json", evidence],
    ["exact-wallet-transaction.json", exactWallet],
  ]);
  for (const [fileName, componentName] of Object.entries(publicSchemaFiles)) {
    const standalone = publicSchemas.get(fileName);
    const component = openapi.components.schemas[componentName];
    const standaloneValidator = machineContractAjv().compile(standalone);
    const componentValidator = machineContractAjv().compile(component);
    const golden = goldens.get(fileName);
    assert.equal(
      standaloneValidator(golden),
      true,
      `${fileName} standalone golden: ${JSON.stringify(standaloneValidator.errors)}`,
    );
    assert.equal(
      componentValidator(golden),
      true,
      `${fileName} OpenAPI golden: ${JSON.stringify(componentValidator.errors)}`,
    );
    const mutation = { ...structuredClone(golden), unexpectedField: true };
    assert.equal(standaloneValidator(mutation), false, `${fileName} standalone mutation`);
    assert.equal(componentValidator(mutation), false, `${fileName} OpenAPI mutation`);
  }
});

test("V4 list and finalized routes publish closed launches/nextCursor envelopes", () => {
  const listSchema = openapi.paths["/v4/chains/{chainId}/custom-launches"]
    .get.responses["200"].content["application/json"].schema;
  const finalizedSchema = openapi.paths["/v4/chains/{chainId}/finalized-custom-launches"]
    .get.responses["200"].content["application/json"].schema;
  assert.deepEqual(listSchema, { $ref: "#/components/schemas/CustomLaunchListV4" });
  assert.deepEqual(finalizedSchema, { $ref: "#/components/schemas/CustomLaunchFinalizedListV4" });
  for (const name of ["CustomLaunchListV4", "CustomLaunchFinalizedListV4"]) {
    const schema = openapi.components.schemas[name];
    assert.equal(schema.additionalProperties, false);
    assert.equal(Object.hasOwn(schema.properties, "launches"), true);
    assert.equal(Object.hasOwn(schema.properties, "nextCursor"), true);
    assert.equal(Object.hasOwn(schema.properties, "items"), false);
  }

  const listValidator = machineContractAjv().compile(
    openapi.components.schemas.CustomLaunchListV4,
  );
  const listGolden = {
    schemaVersion: "programmable.custom-launch-list.v4",
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    generatedAt: "2026-08-29T12:30:00.000Z",
    launches: [validV4Resource(undefined, undefined, {
      chainDeployment: deploymentWithSafeEvidence(),
      profile: frozenV4Profile(),
      externalContractEvidenceReceipt: null,
    })],
    nextCursor: null,
  };
  assert.equal(listValidator(listGolden), true, JSON.stringify(listValidator.errors));
  listGolden.launches[0].unexpectedField = true;
  assert.equal(listValidator(listGolden), false, "list launch item must be closed");

  const finalizedEnvelopeSchema = openapi.components.schemas.CustomLaunchFinalizedListV4;
  const finalizedValidator = machineContractAjv().compile(finalizedEnvelopeSchema);
  const finalizedGolden = {
    schemaVersion: "programmable.custom-launch-list.v4",
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    generatedAt: "2026-08-29T12:30:00.000Z",
    quality: {
      status: "ready",
      sourceRowCount: 1,
      publishedRowCount: 1,
      quarantinedRowCount: 0,
    },
    launches: [fixtureFromSchema(finalizedEnvelopeSchema.properties.launches.items)],
    nextCursor: null,
  };
  assert.equal(
    finalizedValidator(finalizedGolden),
    true,
    JSON.stringify(finalizedValidator.errors),
  );
  finalizedGolden.unexpectedField = true;
  assert.equal(finalizedValidator(finalizedGolden), false, "finalized envelope must be closed");
});

test("V4 schema semantics lock image pixels, evidence state, and proxy facts", () => {
  const capabilitySchema = publicSchemas.get("capabilities.json");
  const validateCapabilities = machineContractAjv().compile(capabilitySchema);
  const oversizedPixels = validV4Capabilities({
    chainDeployment: deploymentWithSafeEvidence(),
    profile: frozenV4Profile(),
  });
  assert.equal(validateCapabilities(oversizedPixels), true, JSON.stringify(validateCapabilities.errors));
  oversizedPixels.metadataImage.maximumPixels = 33_554_432;
  assert.equal(validateCapabilities(oversizedPixels), false);

  const resourceSchema = publicSchemas.get("custom-launch.json");
  const validateResource = machineContractAjv().compile(resourceSchema);
  const received = validV4Resource(undefined, undefined, {
    chainDeployment: deploymentWithSafeEvidence(),
    profile: frozenV4Profile(),
    externalContractEvidenceReceipt: externalEvidenceReceipt(),
  });
  assert.equal(validateResource(received), false, "received state cannot carry evidence");

  const createSchema = publicSchemas.get("custom-launch-create-request.json");
  const validateCreate = machineContractAjv().compile(createSchema);
  const create = fixtureFromSchema(createSchema);
  create.externalContracts = [validV4ExternalContractDeclaration()];
  assert.equal(validateCreate(create), true, JSON.stringify(validateCreate.errors));
  create.externalContracts[0].mutability.kind = "proxy";
  assert.equal(validateCreate(create), false, "proxy facts cannot reuse immutable null fields");

  const evidenceResource = validV4Resource(undefined, undefined, {
    chainDeployment: deploymentWithSafeEvidence(),
    profile: frozenV4Profile(),
    status: "action_required",
    externalContractEvidenceReceipt: externalEvidenceReceipt(),
  });
  assert.equal(validateResource(evidenceResource), true, JSON.stringify(validateResource.errors));
  evidenceResource.externalContractEvidenceReceipt.providers[0].unexpectedField = true;
  assert.equal(validateResource(evidenceResource), false, "provider evidence must be closed");
});

test("V4 external contract start blocks are positive while Permit2 remains genesis-pinned", () => {
  const immutable = validV4ExternalContractDeclaration();
  assert.deepEqual(normalizeV4ExternalContracts([immutable]), [immutable]);
  const zeroExternal = structuredClone(immutable);
  zeroExternal.startBlock = "0";
  assert.throws(
    () => normalizeV4ExternalContracts([zeroExternal]),
    /canonical Robinhood external contract binding/u,
  );

  const proxy = validV4ExternalProxyContractDeclaration();
  assert.deepEqual(normalizeV4ExternalContracts([proxy]), [proxy]);
  const zeroImplementation = structuredClone(proxy);
  zeroImplementation.mutability.implementation.startBlock = "0";
  assert.throws(
    () => normalizeV4ExternalContracts([zeroImplementation]),
    /externalContracts\[0\]\.mutability\.implementation is invalid/u,
  );

  const validatePackExternal = machineContractAjv().compile({
    $schema: packageSchema.$schema,
    $defs: packageSchema.$defs,
    $ref: "#/$defs/externalContract",
  });
  assert.equal(validatePackExternal(immutable), true, JSON.stringify(validatePackExternal.errors));
  assert.equal(validatePackExternal(zeroExternal), false, "pack schema rejects external block zero");
  assert.equal(validatePackExternal(proxy), true, JSON.stringify(validatePackExternal.errors));
  assert.equal(
    validatePackExternal(zeroImplementation),
    false,
    "pack schema rejects proxy implementation block zero",
  );

  const createSchema = publicSchemas.get("custom-launch-create-request.json");
  const validateCreate = machineContractAjv().compile(createSchema);
  for (const [label, declaration] of [
    ["external", zeroExternal],
    ["implementation", zeroImplementation],
  ]) {
    const create = fixtureFromSchema(createSchema);
    create.externalContracts = [declaration];
    assert.equal(validateCreate(create), false, `transport schema rejects ${label} block zero`);
  }

  const validateDeployment = machineContractAjv().compile(packageSchema.$defs.chainDeployment);
  const deployment = deploymentWithSafeEvidence();
  assert.equal(deployment.permit2GenesisProvenance.startBlock, "0");
  assert.equal(validateDeployment(deployment), true, JSON.stringify(validateDeployment.errors));
});

function baseConfig() {
  const target = {
    compilationUnitId: "unit",
    artifact: "artifacts/target.json",
    applicantSalt: `0x${"01".repeat(32)}`,
    constructorArguments: [],
    initializer: null,
    deploymentValueWei: "0",
    initializerValueWei: "0",
    componentKind: "other",
    declaredHookPermissions: null,
    runtimeImmutables: [],
  };
  return {
    schemaVersion: "programmable.launch-pack-config.v4",
    chainId: "4663",
    caip2: "eip155:4663",
    chainDeployment: structuredClone(v4ChainDeployment),
    profile: frozenV4Profile(),
    externalContracts: [],
    launchWallet: "0x1111111111111111111111111111111111111111",
    nonce: `0x${"22".repeat(32)}`,
    permitWindow: { validAfter: "1", deadline: "2" },
    source: {
      root: "project",
      paths: ["src"],
      sourceLineageNonce: "1",
      publicOrigin: {
        url: "https://example.com/source",
        revision: "11".repeat(20),
      },
    },
    compilationUnits: [{ compilationUnitId: "unit", standardJson: "standard-json.json" }],
    targets: [
      { ...target, targetId: "token", componentKind: "token" },
      {
        ...target,
        targetId: "hook",
        componentKind: "hook",
        declaredHookPermissions: ["beforeSwap"],
      },
      { ...target, targetId: "initializer" },
    ],
    pool: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      fee: 3000,
      tickSpacing: 60,
      quoteCurrency: "0x0000000000000000000000000000000000000000",
    },
    projectMetadata: {
      schemaVersion: "programmable.project-metadata-input.v1",
      token: { name: "Robinhood Schema Token", symbol: "RHSCHEMA" },
      presentation: {
        description: "Complete public metadata for the Robinhood V4 schema fixture",
        image: {
          sourcePath: "assets/token.png",
          uri: "https://example.com/token.png",
        },
        links: [
          { kind: "website", uri: "https://example.com/" },
          { kind: "x", uri: "https://x.com/robinhood_schema" },
        ],
      },
    },
    funding: {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "none",
      valueWei: "0",
    },
    liquidityModel: {
      schemaVersion: "programmable.custom-launch-liquidity-model.v1",
      model: "none-empty-pool",
      declaredLaunchState: "pool-not-initialized",
      targetIds: [],
    },
    agentAttestation: {
      agentId: "schema-test",
      checkedAt: "2026-08-29T12:00:00.000Z",
      checks: [{ checkId: "build", evidence: "evidence/build.json" }],
    },
  };
}

function machineContractAjv() {
  const instance = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: false,
  });
  for (const keyword of [
    "x-programmable-status",
    "x-programmable-contract",
    "x-programmable-aggregateCalldataAndHookDataMaximumBytes",
    "x-programmable-maximumBytes",
    "x-programmable-uniqueStepIds",
  ]) {
    instance.addKeyword(keyword);
  }
  instance.addKeyword({
    keyword: "x-programmable-order",
    schemaType: "string",
    validate: validateProgrammableOrder,
  });
  instance.addKeyword({
    keyword: "x-programmable-minUtf8Bytes",
    type: "string",
    schemaType: "number",
    validate: (minimum, value) => Buffer.byteLength(value, "utf8") >= minimum,
  });
  instance.addKeyword({
    keyword: "x-programmable-minUnicodeLettersOrNumbers",
    type: "string",
    schemaType: "number",
    validate: (minimum, value) => [...value.matchAll(/[\p{L}\p{N}]/gu)].length >= minimum,
  });
  return instance;
}

function validateProgrammableOrder(rule, value) {
  if (rule === "strictly increasing logIndex; unique") {
    if (!Array.isArray(value)) return true;
    const indexes = value.map((entry) => entry?.logIndex);
    if (indexes.some((index) => typeof index !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(index))) return true;
    return indexes.every((index, position) => position === 0
      || BigInt(index) > BigInt(indexes[position - 1]));
  }
  if (rule === "providerReadbacks[0].blockHash == providerReadbacks[1].blockHash") {
    const [primary, secondary] = Array.isArray(value?.providerReadbacks)
      ? value.providerReadbacks
      : [];
    if (typeof primary?.blockHash !== "string"
      || typeof secondary?.blockHash !== "string") return true;
    return primary.blockHash === secondary.blockHash;
  }
  if (rule
    === "blockHash == providerReadbacks[0].blockHash == providerReadbacks[1].blockHash") {
    const [primary, secondary] = Array.isArray(value?.providerReadbacks)
      ? value.providerReadbacks
      : [];
    if (typeof value?.blockHash !== "string"
      || typeof primary?.blockHash !== "string"
      || typeof secondary?.blockHash !== "string") return true;
    return value.blockHash === primary.blockHash
      && value.blockHash === secondary.blockHash;
  }
  if (rule
    === "resultingContracts providerReadbacks prove blockNumber - 1 -> blockNumber") {
    if (typeof value?.blockNumber !== "string"
      || !/^[1-9][0-9]*$/u.test(value.blockNumber)
      || typeof value?.blockHash !== "string"
      || !Array.isArray(value?.resultingContracts)) return true;
    const predecessorBlockNumber = (BigInt(value.blockNumber) - 1n).toString(10);
    return value.resultingContracts.every((result) => {
      const [primary, secondary] = Array.isArray(result?.providerReadbacks)
        ? result.providerReadbacks
        : [];
      return primary !== undefined && secondary !== undefined
        && primary.preDeploymentBlockNumber === predecessorBlockNumber
        && secondary.preDeploymentBlockNumber === predecessorBlockNumber
        && primary.preDeploymentBlockHash === secondary.preDeploymentBlockHash
        && primary.preDeploymentRuntimeCodeHash === result.previousBlockRuntimeCodeHash
        && secondary.preDeploymentRuntimeCodeHash === result.previousBlockRuntimeCodeHash
        && primary.deploymentBlockNumber === value.blockNumber
        && secondary.deploymentBlockNumber === value.blockNumber
        && primary.deploymentBlockHash === value.blockHash
        && secondary.deploymentBlockHash === value.blockHash
        && primary.contract === result.contract
        && secondary.contract === result.contract
        && primary.address === result.address
        && secondary.address === result.address
        && primary.deploymentRuntimeCodeHash === result.runtimeCodeHash
        && secondary.deploymentRuntimeCodeHash === result.runtimeCodeHash;
    });
  }
  if (rule
    === "Safe atomicRootStateEvidenceDigest == permitAuthority result stateEvidenceDigest") {
    const safeDigest = value?.permitAuthoritySourceProvenance
      ?.configurationEvidence?.atomicRootStateEvidenceDigest;
    const resultDigest = value?.deploymentEvidence?.resultingContracts?.[0]
      ?.stateEvidenceDigest;
    if (typeof safeDigest !== "string" || typeof resultDigest !== "string") return true;
    return safeDigest === resultDigest;
  }
  if (rule !== "ethereumFinalizedCheckpoint.blockNumber >= postingBlockNumber") {
    return true;
  }
  const postingBlockNumber = value?.postingBlockNumber;
  const finalizedBlockNumber = value?.ethereumFinalizedCheckpoint?.blockNumber;
  if (typeof postingBlockNumber !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(postingBlockNumber)
    || typeof finalizedBlockNumber !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(finalizedBlockNumber)) {
    return true;
  }
  return BigInt(finalizedBlockNumber) >= BigInt(postingBlockNumber);
}

function framedSha256Json(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(Buffer.from([0]))
    .update(canonicalizeJson(value), "utf8")
    .digest("hex")}`;
}

function deploymentWithSafeEvidence() {
  const deployment = structuredClone(v4ChainDeployment);
  assert.equal(
    deployment.permitAuthoritySourceProvenance.configurationEvidence
      .ethereumFinalityEvidence.schemaVersion,
    "programmable.robinhood-l2-checkpoint-ethereum-finality.v1",
    "V4 fixture must carry the complete nested Ethereum-finality receipt",
  );
  return deployment;
}

function externalContractDeclaration() {
  return validV4ExternalContractDeclaration();
}

function externalCheckpoint(blockNumber, digit) {
  return { blockNumber, blockHash: `0x${digit.repeat(64)}` };
}

function externalSourceReceipt(declaration) {
  return {
    address: declaration.address,
    runtimeCodeHash: declaration.runtimeCodeHash,
    sourceEvidenceDigest: declaration.sourceEvidenceDigest,
    sourcify: {
      provider: "sourcify",
      outcome: "exact_match",
      responseSha256: `sha256:${"a".repeat(64)}`,
      errorCode: null,
    },
    blockscout: {
      provider: "blockscout",
      outcome: "unavailable",
      responseSha256: null,
      errorCode: "SOURCE_UNAVAILABLE",
    },
    evidenceDigest: `sha256:${"b".repeat(64)}`,
  };
}

function externalProviderReadback(role, providerId, trustDomain, declaration, digestDigit) {
  return {
    role,
    providerId,
    trustDomain,
    startCheckpoint: externalCheckpoint(declaration.startBlock, "5"),
    auditCheckpoint: externalCheckpoint(declaration.auditBlock, "6"),
    finalizedCheckpoint: externalCheckpoint("49210000", "7"),
    startRuntimeCodeHash: declaration.runtimeCodeHash,
    auditRuntimeCodeHash: declaration.runtimeCodeHash,
    proxy: {
      kind: "immutable",
      proxyType: null,
      implementationAddress: null,
      adminAddress: null,
      beaconAddress: null,
      implementationSlotWord: null,
      adminSlotWord: null,
      beaconSlotWord: null,
      minimalProxyImplementation: null,
    },
    implementationRuntimeCodeHash: null,
    evidenceDigest: `sha256:${digestDigit.repeat(64)}`,
  };
}

function externalEvidenceReceipt(overrides = {}) {
  const declaration = externalContractDeclaration();
  return {
    schemaVersion: "programmable.custom-launch-external-contract-evidence.v4",
    chainId: "4663",
    caip2: "eip155:4663",
    deploymentId: "robinhood-mainnet-custom-launch-v1",
    requestHash: `sha256:${"c".repeat(64)}`,
    rawRequestSha256: `sha256:${"d".repeat(64)}`,
    chainDeploymentDescriptorDigest: `0x${"e".repeat(64)}`,
    profile: frozenV4Profile(),
    profileDigest:
      "sha256:484b1dc6e9091804fabc230f2b3a7504940fa00264f8e66e82a66a951e71f1a0",
    providers: [
      { role: "primary", providerId: "drpc", trustDomain: "drpc.org" },
      { role: "secondary", providerId: "alchemy", trustDomain: "alchemy.com" },
    ],
    references: [{
      referenceDigest: `sha256:${"e".repeat(64)}`,
      declaration,
      startCheckpoint: externalCheckpoint(declaration.startBlock, "5"),
      auditCheckpoint: externalCheckpoint(declaration.auditBlock, "6"),
      finalizedCheckpoint: externalCheckpoint("49210000", "7"),
      providerReadbacks: [
        externalProviderReadback("primary", "drpc", "drpc.org", declaration, "8"),
        externalProviderReadback("secondary", "alchemy", "alchemy.com", declaration, "9"),
      ],
      sourceVerification: {
        contract: externalSourceReceipt(declaration),
        implementation: null,
      },
      verified: true,
      findingCodes: [],
      evidenceDigest: `sha256:${"f".repeat(64)}`,
    }],
    verified: true,
    findingCodes: [],
    observedAt: "2026-08-29T12:15:00.000Z",
    evidenceDigest: `sha256:${"1".repeat(64)}`,
    ...overrides,
  };
}

function containsRemoteReference(value) {
  if (Array.isArray(value)) return value.some(containsRemoteReference);
  if (value === null || typeof value !== "object") return false;
  if (typeof value.$ref === "string" && !value.$ref.startsWith("#/")) return true;
  return Object.values(value).some(containsRemoteReference);
}

function fixtureFromSchema(schema, root = schema, index = 0) {
  if (schema.$ref !== undefined) {
    let target = root;
    for (const encoded of schema.$ref.slice(2).split("/")) {
      target = target[encoded.replaceAll("~1", "/").replaceAll("~0", "~")];
    }
    return fixtureFromSchema(target, root, index);
  }
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (schema.enum !== undefined) return structuredClone(schema.enum[0]);
  if (schema.oneOf !== undefined) return fixtureFromSchema(schema.oneOf[0], root, index);
  if (schema.anyOf !== undefined) return fixtureFromSchema(schema.anyOf[0], root, index);
  if (schema.type === "object" || schema.properties !== undefined) {
    const result = Object.fromEntries((schema.required ?? []).map((name, propertyIndex) => [
      name,
      fixtureFromSchema(schema.properties[name], root, index + propertyIndex),
    ]));
    if (result.kind === "file" && Object.hasOwn(result, "symlinkTarget")) {
      result.symlinkTarget = null;
    }
    if (Object.hasOwn(result, "componentKind")) {
      result.componentKind = index % 3 === 0 ? "token" : index % 3 === 1 ? "hook" : "other";
      result.declaredHookPermissions = result.componentKind === "hook" ? [] : null;
    }
    if (result.deploymentEvidence?.resultingContracts
      && result.permitAuthoritySourceProvenance?.configurationEvidence) {
      alignGeneratedChainDeployment(result);
    }
    return result;
  }
  if (schema.type === "array") {
    if (Array.isArray(schema.prefixItems)) {
      return schema.prefixItems.map((item, itemIndex) =>
        fixtureFromSchema(item, root, index + itemIndex));
    }
    const contained = (schema.allOf ?? [])
      .map((entry) => entry.contains)
      .filter(Boolean);
    const entries = contained.map((entry, entryIndex) => {
      const base = fixtureFromSchema(schema.items, root, index + entryIndex);
      const constraint = fixtureFromSchema(entry, root, index + entryIndex);
      const merged = { ...base, ...constraint };
      if (merged.kind === "website") merged.uri = "https://example.com/";
      if (merged.kind === "x") merged.uri = "https://x.com/schema_fixture";
      return merged;
    });
    const length = Math.max(schema.minItems ?? 0, entries.length);
    while (entries.length < length) {
      const entryIndex = entries.length;
      const entry = fixtureFromSchema(schema.items, root, index + entryIndex);
      const contractEnum = schema.items?.properties?.contract?.enum;
      if (Array.isArray(contractEnum) && entry !== null && typeof entry === "object") {
        entry.contract = contractEnum[entryIndex % contractEnum.length];
      }
      entries.push(entry);
    }
    return entries;
  }
  if (schema.type === "integer" || schema.type === "number") return schema.minimum ?? 1;
  if (schema.type === "boolean") return true;
  if (schema.type === "null") return null;
  return fixtureString(schema, index);
}

function alignGeneratedChainDeployment(deployment) {
  const atomic = deployment.deploymentEvidence;
  const predecessorBlockNumber = (BigInt(atomic.blockNumber) - 1n).toString(10);
  for (const result of atomic.resultingContracts) {
    const predecessorBlockHash = result.providerReadbacks[0].preDeploymentBlockHash;
    for (const readback of result.providerReadbacks) {
      readback.preDeploymentBlockNumber = predecessorBlockNumber;
      readback.preDeploymentBlockHash = predecessorBlockHash;
      readback.preDeploymentRuntimeCodeHash = result.previousBlockRuntimeCodeHash;
      readback.deploymentBlockNumber = atomic.blockNumber;
      readback.deploymentBlockHash = atomic.blockHash;
      readback.contract = result.contract;
      readback.address = result.address;
      readback.deploymentRuntimeCodeHash = result.runtimeCodeHash;
    }
  }
  deployment.permitAuthoritySourceProvenance.configurationEvidence
    .atomicRootStateEvidenceDigest = atomic.resultingContracts[0].stateEvidenceDigest;
}

function fixtureString(schema, index) {
  if (schema.format === "date-time") return "2026-08-29T12:00:00.000Z";
  if (schema.format === "uri") return "https://example.com/schema";
  const pattern = schema.pattern ?? "";
  if (pattern.includes("commit\\.")) return "0.8.26+commit.8a97fa7a";
  if (pattern.includes("sha256:")) return `sha256:${"1".repeat(64)}`;
  if (pattern.includes("0x") && pattern.includes("{40}")) return `0x${"1".repeat(40)}`;
  if (pattern.includes("0x") && pattern.includes("{64}")) return `0x${"1".repeat(64)}`;
  if (pattern.includes("0xe5f6b8cd")) return `0xe5f6b8cd${"00".repeat(32)}`;
  if (pattern.startsWith("^0x") && pattern.includes("{2}")) {
    return pattern.includes("+$") ? "0x00" : "0x";
  }
  if (pattern.includes("0|[1-9]") || pattern.startsWith("^[1-9][0-9]")) return "1";
  if (pattern.includes("[0-9a-f]{8}-")) return "70000000-0000-4000-8000-000000000007";
  if (pattern.includes("[A-Za-z0-9+/]")) return "AA==";
  if (pattern.startsWith("^https://x")) return "https://x.com/schema_fixture";
  if (pattern.startsWith("^https://")) return "https://example.com/schema";
  if (pattern.includes("[0-9a-f]")) return "1".repeat(Math.max(schema.minLength ?? 1, 64));
  const minimum = Math.max(schema.minLength ?? 1, schema["x-programmable-minUtf8Bytes"] ?? 0);
  return `schema${index}`.padEnd(minimum, "x");
}
