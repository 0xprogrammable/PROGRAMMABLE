import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalizeJson } from "../src/canonical-json.mjs";
import {
  hashV4ChainDeployment,
  normalizeV4ExternalContracts,
} from "../src/v4-contract.mjs";

import {
  validExactWalletTransaction,
  validPreparedArtifactV4,
  validV4ExternalContractDeclaration,
  validV4ExternalProxyContractDeclaration,
  validV4Capabilities,
  validV4OnchainEvidenceV2,
  validV4OnchainEvidenceV3,
  validV4Preflight,
  validV4ProjectMetadata,
  validV4Resource,
  validV4SourceVerificationStatus,
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
  "source-verification-status.json": "SourceVerificationStatusV4",
  "capabilities.json": "CustomLaunchCapabilitiesV2",
  "preflight.json": "CustomLaunchPreflightV2",
  "onchain-evidence.json": "CustomLaunchOnchainEvidenceV3",
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
const robinhoodV4PlatformFeePolicy = Object.freeze({
  required: true,
  status: "required-default-configuration",
  appliesTo: "new-robinhood-v4-api-custom-launches-only",
  changesExistingLaunches: false,
  changesEthereumLaunches: false,
  rateBps: 20,
  ratePpm: 2_000,
  ratePercent: "0.20%",
  recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
  basis: null,
  feeCurrency: null,
  accountingMode: null,
  rounding: null,
  accrual: null,
  claimMechanism: null,
  enforcement: "not-guaranteed-onchain",
  canonicalOnchainEnforcementProven: false,
  guaranteedRevenue: false,
  feeBehaviorClaim: false,
  universalFeeBehaviorClaim: false,
});
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
const CHAIN_DEPLOYMENT_BINDING_RULE =
  "contracts bind atomic deployment, Permit2 genesis, Safe permit authority, and external root evidence; atomic provider transactionHash copies equal deploymentEvidence.transactionHash; atomic deployment, Safe snapshot, and Ethereum finality agree; programmable Router != universal Router";
const ONCHAIN_EVIDENCE_BINDING_RULE =
  "chainDeploymentDescriptorDigest == keccak256(canonical chainDeployment); router and finalityPolicy match chainDeployment; transactionHash == l2Inclusion.transactionHash; L1 identities match chainDeployment ethereumFinalityEvidence; legacy checkpoint projection follows checkpointType; finalized provider readbacks equal checkpoint";
const V4_ATOMIC_TRUST_ROOT_NAMES = Object.freeze([
  "permitAuthority",
  "graphFactory",
  "programmableLaunchStampRouter",
]);
const V4_EXTERNAL_TRUST_ROOT_NAMES = Object.freeze([
  "poolManager",
  "positionManager",
  "stateView",
  "v4Quoter",
  "universalRouter",
]);
const V4_TRUST_ROOT_NAMES = Object.freeze([
  "programmableLaunchStampRouter",
  "permitAuthority",
  "graphFactory",
  "poolManager",
  "positionManager",
  "stateView",
  "v4Quoter",
  "permit2",
  "universalRouter",
]);

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
    platformFeePolicy: robinhoodV4PlatformFeePolicy,
  });
  assert.equal(Object.hasOwn(packageSchema.$defs, "launchProfile"), false);
  assert.doesNotMatch(
    JSON.stringify(packageSchema),
    /0x4957f49620AFf3Adbbe8195a4f633E49cc93376c/u,
  );
  assert.deepEqual(
    openapi.components.schemas.CustomLaunchCapabilitiesV2.properties.safety.properties,
    {
      serverAuthoritative: { const: true },
      clientBypassAccepted: { const: false },
      walletSignatureProduced: { const: false },
      transactionBroadcast: { const: false },
      feeBehaviorClaim: { const: false },
      universalFeeBehaviorClaim: { const: false },
      genericClaimingLive: { const: false },
    },
  );
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
  config.targets.sort((left, right) => compareUtf8(left.targetId, right.targetId));
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
});

test("V4 programmable-order semantics fail closed for every declared machine rule", () => {
  const declaredRules = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (typeof value["x-programmable-order"] === "string") {
      declaredRules.add(value["x-programmable-order"]);
    }
    Object.values(value).forEach(visit);
  };
  for (const schema of publicSchemas.values()) visit(schema);
  visit(openapi.components.schemas.CustomLaunchFinalizedListV4);
  assert.deepEqual([...declaredRules].sort(compareUtf8), [
    "UTF-8 role, NUL, lowercase address; unique",
    "caller-declared-and-hash-bound",
    "chainDeploymentDescriptorDigest, chainDeployment, profile, and commitments equal onchain counterparts",
    ONCHAIN_EVIDENCE_BINDING_RULE,
    CHAIN_DEPLOYMENT_BINDING_RULE,
    "dependency-topological with UTF-8 tie-break",
    "ethereumFinalizedCheckpoint.blockNumber >= postingBlockNumber",
    "launches.length <= quality.publishedRowCount",
    "previousBlockNumber + 1 == startBlock; previousBlockNumber == providerReadbacks[*].previousBlockNumber; previousBlockHash == providerReadbacks[*].previousBlockHash; startBlock == providerReadbacks[*].blockNumber; blockHash == providerReadbacks[*].blockHash; providerReadbacks[0].rawTransactionDigest == providerReadbacks[1].rawTransactionDigest; providerReadbacks[0].transactionDigest == providerReadbacks[1].transactionDigest; providerReadbacks[0].transactionReceiptDigest == providerReadbacks[1].transactionReceiptDigest",
    "providerReadbacks[0].blockHash == providerReadbacks[1].blockHash",
    "routeEventLogIndex < launchEventLogIndex",
    "resultingContracts providerReadbacks prove blockNumber - 1 -> blockNumber",
    "sourceRowCount == publishedRowCount",
    "strictly increasing logIndex; unique",
    "unique UTF-8 ascending",
    "unique UTF-8 targetId ascending",
    "updatedAt == max components[*].updatedAt",
  ].sort(compareUtf8));
  for (const rule of declaredRules) {
    assert.equal(validateProgrammableOrder(rule, null), false, `${rule} rejects malformed input`);
  }
  assert.equal(validateProgrammableOrder("unknown rule", []), false);

  const externalContracts = [
    { role: "alpha", address: "0x2222222222222222222222222222222222222222" },
    { role: "beta", address: "0x1111111111111111111111111111111111111111" },
  ];
  assert.equal(validateProgrammableOrder(
    "UTF-8 role, NUL, lowercase address; unique",
    externalContracts,
  ), true);
  assert.equal(validateProgrammableOrder(
    "UTF-8 role, NUL, lowercase address; unique",
    externalContracts.toReversed(),
  ), false);

  const targets = [
    { targetId: "alpha", constructorArguments: [] },
    { targetId: "beta", constructorArguments: [{ target: "alpha" }] },
  ];
  assert.equal(validateProgrammableOrder(
    "dependency-topological with UTF-8 tie-break",
    targets,
  ), true);
  assert.equal(validateProgrammableOrder(
    "dependency-topological with UTF-8 tie-break",
    targets.toReversed(),
  ), false);
  assert.equal(validateProgrammableOrder(
    "dependency-topological with UTF-8 tie-break",
    [{ targetId: "alpha", constructorArguments: [{ target: "missing" }] }],
  ), false);

  const steps = [{ stepId: "first" }, { stepId: "second" }];
  assert.equal(validateProgrammableOrder("caller-declared-and-hash-bound", steps), true);
  assert.equal(validateProgrammableOrder(
    "caller-declared-and-hash-bound",
    steps.toReversed(),
  ), true, "caller order remains intentional rather than sorted");
  assert.equal(validateProgrammableOrder(
    "caller-declared-and-hash-bound",
    [{ stepId: "duplicate" }, { stepId: "duplicate" }],
  ), false);

  assert.equal(validateProgrammableOrder("unique UTF-8 ascending", ["alpha", "beta"]), true);
  assert.equal(validateProgrammableOrder("unique UTF-8 ascending", ["beta", "alpha"]), false);
  assert.equal(validateProgrammableOrder("unique UTF-8 ascending", ["alpha", "alpha"]), false);

  const sourceComponents = validV4SourceVerificationStatus().components;
  assert.equal(
    validateProgrammableOrder("unique UTF-8 targetId ascending", sourceComponents),
    true,
  );
  assert.equal(
    validateProgrammableOrder(
      "unique UTF-8 targetId ascending",
      sourceComponents.toReversed(),
    ),
    false,
  );
  const sourceStatus = validV4SourceVerificationStatus();
  assert.equal(
    validateProgrammableOrder(
      "updatedAt == max components[*].updatedAt",
      sourceStatus,
    ),
    true,
  );
  sourceStatus.updatedAt = "2026-08-29T12:31:00.000Z";
  assert.equal(
    validateProgrammableOrder(
      "updatedAt == max components[*].updatedAt",
      sourceStatus,
    ),
    false,
  );
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
  const validateOrdinaryDeployment = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  }).compile(packageSchema.$defs.chainDeployment);
  const golden = deploymentWithSafeEvidence();
  assert.equal(validateDeployment(golden), true, JSON.stringify(validateDeployment.errors));
  assert.equal(
    validateOrdinaryDeployment(golden),
    true,
    JSON.stringify(validateOrdinaryDeployment.errors),
  );

  for (const name of V4_TRUST_ROOT_NAMES) {
    const deployment = structuredClone(golden);
    deployment.contracts[name].address = `0x${"9".repeat(40)}`;
    assert.equal(
      validateOrdinaryDeployment(deployment),
      false,
      `ordinary JSON Schema pins ${name} address`,
    );
    assert.equal(validateDeployment(deployment), false, `machine schema pins ${name} address`);
  }
  const runtimeMutation = structuredClone(golden);
  runtimeMutation.contracts.programmableLaunchStampRouter.runtimeCodeHash =
    `0x${"9".repeat(64)}`;
  assert.equal(
    validateOrdinaryDeployment(runtimeMutation),
    false,
    "ordinary JSON Schema pins Router runtime",
  );

  assert.equal(
    validateProgrammableOrder(CHAIN_DEPLOYMENT_BINDING_RULE, golden),
    true,
    "chain deployment binding rule accepts the canonical evidence graph",
  );
  const semanticBindingCases = [
    ["atomic Router result", (deployment) => {
      deployment.contracts.programmableLaunchStampRouter.address = `0x${"9".repeat(40)}`;
    }],
    ["Permit2 genesis provenance", (deployment) => {
      deployment.contracts.permit2.address = `0x${"9".repeat(40)}`;
    }],
    ["Safe PermitAuthority runtime", (deployment) => {
      deployment.contracts.permitAuthority.runtimeCodeHash = `0x${"9".repeat(64)}`;
    }],
    ["external PoolManager evidence", (deployment) => {
      deployment.contracts.poolManager.address = `0x${"9".repeat(40)}`;
    }],
    ["atomic primary provider transaction copy", (deployment) => {
      deployment.deploymentEvidence.providerReadbacks[0].transactionHash =
        `0x${"9".repeat(64)}`;
    }],
    ["atomic secondary provider transaction copy", (deployment) => {
      deployment.deploymentEvidence.providerReadbacks[1].transactionHash =
        `0x${"9".repeat(64)}`;
    }],
    ["coordinated atomic provider transaction copies", (deployment) => {
      for (const readback of deployment.deploymentEvidence.providerReadbacks) {
        readback.transactionHash = `0x${"9".repeat(64)}`;
      }
    }],
    ["atomic and Safe transaction", (deployment) => {
      deployment.permitAuthoritySourceProvenance.transactionHash = `0x${"9".repeat(64)}`;
    }],
    ["atomic and Safe snapshot", (deployment) => {
      deployment.permitAuthoritySourceProvenance.configurationEvidence.blockHash =
        `0x${"9".repeat(64)}`;
    }],
    ["atomic and Safe finality", (deployment) => {
      const safe = deployment.permitAuthoritySourceProvenance.configurationEvidence;
      safe.ethereumFinalityEvidence = structuredClone(safe.ethereumFinalityEvidence);
      safe.ethereumFinalityEvidence.postingBlockHash = `0x${"9".repeat(64)}`;
    }],
    ["Programmable and Universal Router separation", (deployment) => {
      deployment.contracts.programmableLaunchStampRouter.address =
        deployment.contracts.universalRouter.address;
    }],
  ];
  for (const [label, mutate] of semanticBindingCases) {
    const deployment = structuredClone(golden);
    mutate(deployment);
    assert.equal(
      validateProgrammableOrder(CHAIN_DEPLOYMENT_BINDING_RULE, deployment),
      false,
      label,
    );
    assert.equal(validateDeployment(deployment), false, `${label} through Ajv`);
  }

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
    ["historical Robinhood dRPC primary", (deployment) => {
      deployment.deploymentEvidence.providerReadbacks[0].providerId = "drpc";
      deployment.deploymentEvidence.providerReadbacks[0].trustDomain = "drpc.org";
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
    ["external root top predecessor hash relabel", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].previousBlockHash = `0x${"b".repeat(64)}`;
    }],
    ["external root provider predecessor hash disagreement", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].providerReadbacks[1].previousBlockHash =
        `0x${"b".repeat(64)}`;
    }],
    ["external root top block hash relabel", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].blockHash = `0x${"b".repeat(64)}`;
    }],
    ["external root provider block hash disagreement", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].providerReadbacks[1].blockHash =
        `0x${"b".repeat(64)}`;
    }],
    ["external root predecessor number drift", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].previousBlockNumber = "9068";
    }],
    ["external root raw transaction digest disagreement", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].providerReadbacks[1].rawTransactionDigest =
        `sha256:${"b".repeat(64)}`;
    }],
    ["external root transaction digest disagreement", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].providerReadbacks[1].transactionDigest =
        `sha256:${"b".repeat(64)}`;
    }],
    ["external root receipt digest disagreement", (deployment) => {
      deployment.externalRootDeploymentEvidence[0].providerReadbacks[1]
        .transactionReceiptDigest = `sha256:${"b".repeat(64)}`;
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
    SourceVerificationStatusV4: "programmable.source-verification-status.v4",
    CustomLaunchOnchainEvidenceV2: "programmable.custom-launch-onchain-evidence.v2",
    CustomLaunchOnchainEvidenceV3: "programmable.custom-launch-onchain-evidence.v3",
    CustomLaunchL2InclusionV1: "programmable.custom-launch-l2-inclusion.v1",
    CustomLaunchL1PostingV1: "programmable.custom-launch-l1-posting.v1",
    CustomLaunchL1FinalizedCheckpointV1:
      "programmable.custom-launch-l1-finalized-checkpoint.v1",
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
  const evidence = validV4OnchainEvidenceV3(resource);
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
    ["source-verification-status.json", validV4SourceVerificationStatus()],
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

test("V4 onchain evidence keeps authenticated V2 compatibility and closes V3 stage coordinates", () => {
  const deployment = deploymentWithSafeEvidence();
  const resource = validV4Resource(undefined, undefined, {
    chainDeployment: deployment,
    profile: frozenV4Profile(),
    walletTransactionPreimageHash: `sha256:${"8".repeat(64)}`,
  });
  const resourceOnchain = publicSchemas.get("custom-launch.json").properties.onchain;
  const validateAuthenticatedOnchain = machineContractAjv().compile(resourceOnchain);
  assert.equal(
    validateAuthenticatedOnchain(validV4OnchainEvidenceV2(resource)),
    true,
    JSON.stringify(validateAuthenticatedOnchain.errors),
  );
  assert.equal(
    validateAuthenticatedOnchain(validV4OnchainEvidenceV2(resource, {
      logIndex: 2_147_483_648,
    })),
    true,
    `historical V2 large log index: ${JSON.stringify(validateAuthenticatedOnchain.errors)}`,
  );

  const standalone = publicSchemas.get("onchain-evidence.json");
  const component = openapi.components.schemas.CustomLaunchOnchainEvidenceV3;
  const validators = [
    machineContractAjv().compile(standalone),
    machineContractAjv().compile(component),
  ];
  const ordinaryJsonSchemaValidators = [standalone, component].map((schema) =>
    new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema));
  const stages = [
    ["sequencer_soft_confirmation", "49210000", `0x${"3".repeat(64)}`, 7],
    ["ethereum_posted", "24000001", `0x${"5".repeat(64)}`, 6],
    ["ethereum_finalized", "24000012", `0x${"7".repeat(64)}`, 6],
  ];
  for (const [stage, blockNumber, blockHash, logIndex] of stages) {
    const evidence = validV4OnchainEvidenceV3(resource, stage);
    assert.equal(evidence.blockNumber, blockNumber, `${stage} legacy block number`);
    assert.equal(evidence.blockHash, blockHash, `${stage} legacy block hash`);
    assert.equal(evidence.logIndex, logIndex, `${stage} legacy log index`);
    assert.equal(evidence.transactionHash, evidence.l2Inclusion.transactionHash);
    assert.ok(
      evidence.l2Inclusion.routeEventLogIndex < evidence.l2Inclusion.launchEventLogIndex,
      `${stage} Router route event precedes launch event`,
    );
    for (const validateEvidence of validators) {
      assert.equal(
        validateEvidence(evidence),
        true,
        `${stage}: ${JSON.stringify(validateEvidence.errors)}`,
      );
    }
  }

  const invalidCases = [
    ["top-level L2 transaction alias", (value) => {
      value.transactionHash = `0x${"9".repeat(64)}`;
    }],
    ["missing required milestone key", (value) => { delete value.l1Posting; }],
    ["future-stage leakage", (value) => {
      value.l1Posting = validV4OnchainEvidenceV3(resource, "ethereum_posted").l1Posting;
    }, "sequencer_soft_confirmation"],
    ["wrong L2 chain", (value) => { value.l2Inclusion.chainId = "1"; }],
    ["impossible Router log order", (value) => {
      value.l2Inclusion.routeEventLogIndex = value.l2Inclusion.launchEventLogIndex;
    }],
    ["wrong L1 chain", (value) => { value.l1Posting.chainId = "4663"; }],
    ["posting rollup outside deployment trust root", (value) => {
      value.l1Posting.rollup = `0x${"9".repeat(40)}`;
    }],
    ["legacy checkpoint projection", (value) => { value.logIndex += 1; }],
    ["finalized readback mismatch", (value) => {
      value.l1FinalizedCheckpoint.providerReadbacks[1].blockHash =
        `0x${"8".repeat(64)}`;
    }],
    ["swapped finalized provider identities", (value) => {
      value.l1FinalizedCheckpoint.providerReadbacks.reverse();
    }],
    ["wrong finalized provider trust domain", (value) => {
      value.l1FinalizedCheckpoint.providerReadbacks[0].trustDomain = "wrong.example";
    }],
    ["finalized checkpoint before posting", (value) => {
      value.l1FinalizedCheckpoint.blockNumber = "24000000";
      for (const readback of value.l1FinalizedCheckpoint.providerReadbacks) {
        readback.blockNumber = "24000000";
      }
      value.blockNumber = "24000000";
    }],
    ["nested unknown key", (value) => { value.l2Inclusion.unexpected = true; }],
  ];
  for (const [label, mutate, stage = "ethereum_finalized"] of invalidCases) {
    const evidence = validV4OnchainEvidenceV3(resource, stage);
    mutate(evidence);
    for (const validateEvidence of validators) {
      assert.equal(validateEvidence(evidence), false, label);
    }
  }
  const ordinarySchemaIdentityCases = [
    ["ordinary JSON Schema rejects wrong posting rollup", (value) => {
      value.l1Posting.rollup = `0x${"9".repeat(40)}`;
    }],
    ["ordinary JSON Schema rejects wrong posting inbox", (value) => {
      value.l1Posting.sequencerInbox = `0x${"9".repeat(40)}`;
    }],
    ["ordinary JSON Schema rejects swapped provider identities", (value) => {
      value.l1FinalizedCheckpoint.providerReadbacks.reverse();
    }],
    ["ordinary JSON Schema rejects wrong provider identity", (value) => {
      value.l1FinalizedCheckpoint.providerReadbacks[0].providerId = "quicknode";
      value.l1FinalizedCheckpoint.providerReadbacks[0].trustDomain = "quicknode.com";
    }],
  ];
  for (const [label, mutate] of ordinarySchemaIdentityCases) {
    const evidence = validV4OnchainEvidenceV3(resource);
    mutate(evidence);
    for (const validateEvidence of ordinaryJsonSchemaValidators) {
      assert.equal(validateEvidence(evidence), false, label);
    }
  }
});

test("V4 finalized public items require V3 evidence and server-authored identity", () => {
  const finalizedSchema = openapi.components.schemas.CustomLaunchFinalizedMetadataV4;
  const validateFinalized = machineContractAjv().compile(finalizedSchema);
  const validateFinalizedOrdinary = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  }).compile(finalizedSchema);
  const finalized = validFinalizedMetadataV4();
  assert.equal(validateFinalized(finalized), true, JSON.stringify(validateFinalized.errors));
  assert.equal(
    validateFinalizedOrdinary(finalized),
    true,
    JSON.stringify(validateFinalizedOrdinary.errors),
  );
  assert.equal(finalized.platformId, "programmable");
  assert.equal(finalized.category, "custom");
  assert.equal(finalized.onchain.schemaVersion, "programmable.custom-launch-onchain-evidence.v3");
  assert.equal(Object.hasOwn(finalized.onchain, "walletTransactionPreimageHash"), false);

  const v2 = validV4OnchainEvidenceV2({
    ...finalized,
    walletTransactionPreimageHash: `sha256:${"8".repeat(64)}`,
  });
  delete v2.walletTransactionPreimageHash;
  finalized.onchain = v2;
  assert.equal(validateFinalized(finalized), false, "public finalized item must reject V2");

  const missingIdentity = validFinalizedMetadataV4();
  delete missingIdentity.platformId;
  assert.equal(validateFinalized(missingIdentity), false, "platformId is required");
  const nestedIdentity = validFinalizedMetadataV4();
  nestedIdentity.projectMetadata.platformId = "programmable";
  assert.equal(validateFinalized(nestedIdentity), false, "identity is not project metadata");

  for (const [label, mutate] of [
    ["outer commitments are bound to onchain evidence", (value) => {
      value.commitments.graph = `sha256:${"9".repeat(64)}`;
    }],
    ["outer deployment descriptor is bound to onchain evidence", (value) => {
      value.chainDeploymentDescriptorDigest = `0x${"9".repeat(64)}`;
    }],
    ["onchain descriptor is recomputed from the canonical deployment", (value) => {
      value.chainDeploymentDescriptorDigest = `0x${"9".repeat(64)}`;
      value.onchain.chainDeploymentDescriptorDigest = `0x${"9".repeat(64)}`;
    }],
    ["outer deployment is bound to onchain evidence", (value) => {
      value.chainDeployment.contracts.programmableLaunchStampRouter.address =
        `0x${"9".repeat(40)}`;
    }],
    ["onchain Router is bound to the embedded deployment", (value) => {
      value.onchain.router = `0x${"9".repeat(40)}`;
    }],
    ["onchain Router runtime is bound to the embedded deployment", (value) => {
      value.onchain.routerRuntimeCodeHash = `0x${"9".repeat(64)}`;
    }],
    ["onchain finality policy is bound to the embedded deployment", (value) => {
      value.onchain.finalityPolicy.policyRevision += 1;
    }],
    ["coordinated Router copies cannot drift away from deployment evidence", (value) => {
      const address = `0x${"9".repeat(40)}`;
      const runtimeCodeHash = `0x${"9".repeat(64)}`;
      for (const deployment of [value.chainDeployment, value.onchain.chainDeployment]) {
        deployment.contracts.programmableLaunchStampRouter = { address, runtimeCodeHash };
      }
      value.onchain.router = address;
      value.onchain.routerRuntimeCodeHash = runtimeCodeHash;
    }],
  ]) {
    const mutation = validFinalizedMetadataV4();
    mutate(mutation);
    assert.equal(validateFinalized(mutation), false, label);
  }

  for (const name of V4_TRUST_ROOT_NAMES) {
    const mutation = validFinalizedMetadataV4();
    for (const deployment of [mutation.chainDeployment, mutation.onchain.chainDeployment]) {
      deployment.contracts[name].address = `0x${"9".repeat(40)}`;
    }
    if (name === "programmableLaunchStampRouter") {
      mutation.onchain.router = `0x${"9".repeat(40)}`;
    }
    assert.equal(
      validateFinalizedOrdinary(mutation),
      false,
      `ordinary finalized schema pins coordinated ${name} drift`,
    );
    assert.equal(
      validateFinalized(mutation),
      false,
      `machine finalized schema rejects coordinated ${name} drift`,
    );
  }

  for (const status of ["queued", "retrying", "needs_attention"]) {
    const mutation = validFinalizedMetadataV4();
    mutation.sourceVerification.status = status;
    assert.equal(
      validateFinalizedOrdinary(mutation),
      false,
      `public finalized sourceVerification rejects ${status}`,
    );
  }
  const nonExactComponent = validFinalizedMetadataV4();
  nonExactComponent.sourceVerification.components[0] = {
    targetId: nonExactComponent.sourceVerification.components[0].targetId,
    address: nonExactComponent.sourceVerification.components[0].address,
    status: "needs_attention",
    providerObservation: null,
    exactSourceAuthority: null,
    exactSourceBinding: null,
    updatedAt: nonExactComponent.sourceVerification.components[0].updatedAt,
  };
  assert.equal(
    validateFinalizedOrdinary(nonExactComponent),
    false,
    "public finalized sourceVerification rejects a needs-attention component",
  );
});

test("V4 finalized quality contract is all-or-nothing over eligible V3 rows", () => {
  const quality = openapi.components.schemas.CustomLaunchFinalizedListV4.properties.quality;
  assert.match(
    quality.description,
    /canonical eligible V3-finalized and authoritatively source-verified rows/u,
  );
  assert.match(quality.description, /global finalized-dataset snapshot totals/u);
  assert.match(quality.description, /not current-page counts/u);
  assert.match(
    quality.properties.sourceRowCount.description,
    /canonical eligible V3-finalized and authoritatively source-verified rows/u,
  );
  assert.match(quality.properties.publishedRowCount.description, /emittable/u);
  assert.match(quality.properties.publishedRowCount.description, /equals sourceRowCount/u);
  assert.match(quality.properties.publishedRowCount.description, /current page is a subset/u);
  assert.match(quality.properties.quarantinedRowCount.description, /Always zero/u);
  assert.match(quality.properties.quarantinedRowCount.description, /fails the entire request/u);
  const validateQuality = machineContractAjv().compile(quality);
  assert.equal(validateQuality({
    status: "ready", sourceRowCount: 2, publishedRowCount: 2, quarantinedRowCount: 0,
  }), true, JSON.stringify(validateQuality.errors));
  for (const [label, value] of [
    ["every eligible V3 row is globally published", {
      status: "ready", sourceRowCount: 2, publishedRowCount: 1, quarantinedRowCount: 0,
    }],
    ["successful response cannot quarantine", {
      status: "ready", sourceRowCount: 2, publishedRowCount: 1, quarantinedRowCount: 1,
    }],
    ["partial is an endpoint failure, not a 200 response", {
      status: "partial", sourceRowCount: 2, publishedRowCount: 2, quarantinedRowCount: 0,
    }],
    ["stale is an endpoint failure, not a 200 response", {
      status: "stale", sourceRowCount: 2, publishedRowCount: 2, quarantinedRowCount: 0,
    }],
    ["unavailable is an endpoint failure, not a 200 response", {
      status: "unavailable", sourceRowCount: 0, publishedRowCount: 0, quarantinedRowCount: 0,
    }],
  ]) {
    assert.equal(validateQuality(value), false, label);
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
    launches: [validFinalizedMetadataV4()],
    nextCursor: null,
  };
  assert.equal(
    finalizedValidator(finalizedGolden),
    true,
    JSON.stringify(finalizedValidator.errors),
  );
  const paginatedSubset = structuredClone(finalizedGolden);
  paginatedSubset.quality.sourceRowCount = 2;
  paginatedSubset.quality.publishedRowCount = 2;
  assert.equal(
    finalizedValidator(paginatedSubset),
    true,
    `a page may be smaller than the global published total: ${JSON.stringify(finalizedValidator.errors)}`,
  );
  const impossiblePublishedZeroPage = structuredClone(finalizedGolden);
  impossiblePublishedZeroPage.quality.sourceRowCount = 0;
  impossiblePublishedZeroPage.quality.publishedRowCount = 0;
  assert.equal(
    finalizedValidator(impossiblePublishedZeroPage),
    false,
    "publishedRowCount zero requires an empty page",
  );
  finalizedGolden.unexpectedField = true;
  assert.equal(finalizedValidator(finalizedGolden), false, "finalized envelope must be closed");
});

test("V4 collection routes publish the exact runtime pagination contract", () => {
  const expectedPaginationParameters = [
    {
      name: "limit",
      in: "query",
      required: false,
      description: "Page size. Defaults to 10 and never exceeds 25.",
      schema: { type: "integer", minimum: 1, maximum: 25, default: 10 },
    },
    {
      name: "cursor",
      in: "query",
      required: false,
      description: "Opaque continuation cursor returned by nextCursor. Pass it back unchanged.",
      schema: {
        type: "string",
        minLength: 16,
        maxLength: 512,
        pattern: "^[A-Za-z0-9_-]+$",
      },
    },
  ];
  const expectedNextCursor = {
    oneOf: [
      structuredClone(expectedPaginationParameters[1].schema),
      { type: "null" },
    ],
  };
  for (const [pathName, componentName] of [
    ["/v4/chains/{chainId}/custom-launches", "CustomLaunchListV4"],
    ["/v4/chains/{chainId}/finalized-custom-launches", "CustomLaunchFinalizedListV4"],
  ]) {
    const parameters = openapi.paths[pathName].get.parameters;
    assert.deepEqual(
      parameters.map(({ name, in: location }) => ({ name, in: location })),
      [
        { name: "chainId", in: "path" },
        { name: "limit", in: "query" },
        { name: "cursor", in: "query" },
      ],
      `${pathName} parameter order and uniqueness`,
    );
    assert.deepEqual(parameters.slice(1), expectedPaginationParameters, pathName);
    assert.deepEqual(
      openapi.components.schemas[componentName].properties.nextCursor,
      expectedNextCursor,
      `${componentName} nextCursor must be accepted unchanged by the request cursor`,
    );
  }
});

test("V4 source-verification schemas bind aggregate truth, exact evidence, and finalized readback", () => {
  const standalone = publicSchemas.get("source-verification-status.json");
  const {
    $schema: _schema,
    $id: _id,
    title: _title,
    ...sourceVerificationCore
  } = standalone;
  const resourceSchema = publicSchemas.get("custom-launch.json");
  const embedded = resourceSchema.properties.sourceVerification.oneOf
    .find((candidate) => candidate.type === "object");
  const finalizedSchema = openapi.components.schemas.CustomLaunchFinalizedMetadataV4;
  assert.deepEqual(embedded, sourceVerificationCore);
  const exactComponent = sourceVerificationCore.properties.components.items.oneOf
    .find(({ properties }) => properties.status.const === "exact_match");
  assert.equal(finalizedSchema.properties.sourceVerification.properties.status.const, "exact_match");
  assert.deepEqual(
    finalizedSchema.properties.sourceVerification.properties.components.items,
    exactComponent,
  );
  assert.equal(resourceSchema.required.includes("sourceVerification"), false);
  assert.equal(finalizedSchema.required.includes("sourceVerification"), true);

  const validateSource = machineContractAjv().compile(standalone);
  const exactEvidenceFixture = validV4SourceVerificationStatus().components
    .find(({ status }) => status === "exact_match");
  const asExact = (component) => ({
    ...component,
    status: "exact_match",
    providerObservation: structuredClone(exactEvidenceFixture.providerObservation),
    exactSourceAuthority: exactEvidenceFixture.exactSourceAuthority,
    exactSourceBinding: structuredClone(exactEvidenceFixture.exactSourceBinding),
  });
  const validStates = [
    validV4SourceVerificationStatus(),
    validV4SourceVerificationStatus({
      components: validV4SourceVerificationStatus().components.map((component, index) => {
        const { nextAttemptAt: _nextAttemptAt, ...terminal } = component;
        if (index === 0) {
          return {
            ...terminal,
            status: "queued",
            providerObservation: null,
            exactSourceAuthority: null,
            exactSourceBinding: null,
            nextAttemptAt: "2026-08-29T12:35:00.000Z",
          };
        }
        return asExact(terminal);
      }),
    }),
    validV4SourceVerificationStatus({
      components: validV4SourceVerificationStatus().components.map((component) => {
        const { nextAttemptAt: _nextAttemptAt, ...withoutRetry } = component;
        return asExact(withoutRetry);
      }),
    }),
    validV4SourceVerificationStatus({
      components: validV4SourceVerificationStatus().components.map((component, index) => {
        const { nextAttemptAt: _nextAttemptAt, ...withoutRetry } = component;
        if (index === 0) {
          return {
            ...withoutRetry,
            status: "queued",
            providerObservation: null,
            exactSourceAuthority: null,
            exactSourceBinding: null,
            nextAttemptAt: "2026-08-29T12:35:00.000Z",
          };
        }
        if (index === 1) {
          return {
            ...withoutRetry,
            status: "needs_attention",
            providerObservation: null,
            exactSourceAuthority: null,
            exactSourceBinding: null,
          };
        }
        return {
          ...withoutRetry,
          status: "retrying",
          providerObservation: null,
          exactSourceAuthority: null,
          exactSourceBinding: null,
          nextAttemptAt: "2026-08-29T12:36:00.000Z",
        };
      }),
    }),
  ];
  assert.deepEqual(
    validStates.map(({ status }) => status),
    ["retrying", "queued", "exact_match", "needs_attention"],
  );
  for (const state of validStates) {
    assert.equal(validateSource(state), true, JSON.stringify(validateSource.errors));
  }

  const cases = [
    ["aggregate status", (value) => { value.status = "queued"; }],
    ["aggregate timestamp", (value) => {
      value.updatedAt = "2026-08-29T12:31:00.000Z";
    }],
    ["component order", (value) => { value.components.reverse(); }],
    ["component identity", (value) => {
      value.components[1].targetId = value.components[0].targetId;
    }],
    ["lowercase address", (value) => {
      value.components[0].address = `0x${"A".repeat(40)}`;
    }],
    ["retry schedule", (value) => { delete value.components[1].nextAttemptAt; }],
    ["terminal retry schedule", (value) => {
      value.components[0].nextAttemptAt = "2026-08-29T12:35:00.000Z";
    }],
    ["non-exact evidence", (value) => {
      value.components[1].providerObservation = structuredClone(
        value.components[0].providerObservation,
      );
    }],
    ["provider cannot be exact authority", (value) => {
      value.components[0].exactSourceAuthority = "sourcify-v2";
    }],
    ["provider remains non-authoritative", (value) => {
      value.components[0].providerObservation.releaseAuthority = true;
    }],
    ["provider classification", (value) => {
      value.components[0].providerObservation.classification = "exact_match";
    }],
    ["provider match vocabulary", (value) => {
      value.components[0].providerObservation.match = "exact_match";
    }],
    ["binding authority", (value) => {
      value.components[0].exactSourceBinding.authority = "sourcify-v2";
    }],
    ["binding coverage", (value) => {
      value.components[0].exactSourceBinding.coveredEvidence.pop();
    }],
    ["binding digest", (value) => {
      value.components[0].exactSourceBinding.bindingDigest = `sha256:${"B".repeat(64)}`;
    }],
  ];
  for (const [label, mutate] of cases) {
    const state = structuredClone(validV4SourceVerificationStatus());
    mutate(state);
    assert.equal(validateSource(state), false, label);
  }

  const validateResource = machineContractAjv().compile(resourceSchema);
  const prefinal = validV4Resource(undefined, undefined, {
    sourceVerification: validV4SourceVerificationStatus(),
  });
  assert.equal(validateResource(prefinal), false, "pre-finality source state must stay hidden");
  prefinal.sourceVerification = null;
  assert.equal(validateResource(prefinal), true, JSON.stringify(validateResource.errors));

  const validateFinalized = machineContractAjv().compile(finalizedSchema);
  const finalized = validFinalizedMetadataV4();
  assert.equal(validateFinalized(finalized), true, JSON.stringify(validateFinalized.errors));
  delete finalized.sourceVerification;
  assert.equal(validateFinalized(finalized), false, "finalized readback must carry source state");
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
      {
        ...target,
        targetId: "hook",
        componentKind: "hook",
        declaredHookPermissions: ["beforeSwap"],
      },
      { ...target, targetId: "initializer" },
      { ...target, targetId: "token", componentKind: "token" },
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
  if (rule
    === "chainDeploymentDescriptorDigest, chainDeployment, profile, and commitments equal onchain counterparts") {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || value.onchain === null || typeof value.onchain !== "object"
      || Array.isArray(value.onchain)) return false;
    return value.chainDeploymentDescriptorDigest === value.onchain.chainDeploymentDescriptorDigest
      && canonicalJsonEqual(value.chainDeployment, value.onchain.chainDeployment)
      && canonicalJsonEqual(value.profile, value.onchain.profile)
      && canonicalJsonEqual(value.commitments, value.onchain.commitments);
  }
  if (rule === "UTF-8 role, NUL, lowercase address; unique") {
    if (!Array.isArray(value)) return false;
    const keys = value.map((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)
        || typeof entry.role !== "string" || typeof entry.address !== "string") return null;
      return `${entry.role}\0${entry.address.toLowerCase()}`;
    });
    return keys.every((key, index) => key !== null
      && (index === 0 || compareUtf8(keys[index - 1], key) < 0));
  }
  if (rule === "dependency-topological with UTF-8 tie-break") {
    if (!Array.isArray(value)) return false;
    const byId = new Map();
    for (const target of value) {
      if (target === null || typeof target !== "object" || Array.isArray(target)
        || typeof target.targetId !== "string" || byId.has(target.targetId)
        || !Array.isArray(target.constructorArguments)) return false;
      byId.set(target.targetId, target);
    }
    const indegree = new Map([...byId.keys()].map((targetId) => [targetId, 0]));
    const dependents = new Map([...byId.keys()].map((targetId) => [targetId, new Set()]));
    for (const target of value) {
      const dependencies = new Set();
      collectTargetReferences(target.constructorArguments, dependencies);
      if (dependencies.has(target.targetId)) return false;
      for (const dependency of dependencies) {
        if (!byId.has(dependency)) return false;
        dependents.get(dependency).add(target.targetId);
      }
      indegree.set(target.targetId, dependencies.size);
    }
    const ready = [...indegree.entries()]
      .filter(([, count]) => count === 0)
      .map(([targetId]) => targetId)
      .sort(compareUtf8);
    const orderedIds = [];
    while (ready.length > 0) {
      const targetId = ready.shift();
      orderedIds.push(targetId);
      for (const dependent of [...dependents.get(targetId)].sort(compareUtf8)) {
        const remaining = indegree.get(dependent) - 1;
        indegree.set(dependent, remaining);
        if (remaining === 0) {
          ready.push(dependent);
          ready.sort(compareUtf8);
        }
      }
    }
    return orderedIds.length === value.length
      && orderedIds.every((targetId, index) => targetId === value[index].targetId);
  }
  if (rule === "caller-declared-and-hash-bound") {
    if (!Array.isArray(value)) return false;
    const stepIds = new Set();
    for (const step of value) {
      if (step === null || typeof step !== "object" || Array.isArray(step)
        || typeof step.stepId !== "string" || stepIds.has(step.stepId)) return false;
      stepIds.add(step.stepId);
    }
    return true;
  }
  if (rule === "unique UTF-8 ascending") {
    return Array.isArray(value) && value.every((entry, index) => typeof entry === "string"
      && (index === 0 || compareUtf8(value[index - 1], entry) < 0));
  }
  if (rule === "unique UTF-8 targetId ascending") {
    return Array.isArray(value) && value.every((entry, index) =>
      entry !== null
      && typeof entry === "object"
      && !Array.isArray(entry)
      && typeof entry.targetId === "string"
      && (index === 0
        || compareUtf8(value[index - 1]?.targetId, entry.targetId) < 0));
  }
  if (rule === "updatedAt == max components[*].updatedAt") {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || typeof value.updatedAt !== "string"
      || !Array.isArray(value.components)
      || value.components.length === 0
      || value.components.some((component) =>
        typeof component?.updatedAt !== "string")) return false;
    return value.updatedAt === value.components
      .map((component) => component.updatedAt)
      .reduce((latest, current) => current > latest ? current : latest);
  }
  if (rule
    === "previousBlockNumber + 1 == startBlock; "
      + "previousBlockNumber == providerReadbacks[*].previousBlockNumber; "
      + "previousBlockHash == providerReadbacks[*].previousBlockHash; "
      + "startBlock == providerReadbacks[*].blockNumber; "
      + "blockHash == providerReadbacks[*].blockHash; "
      + "providerReadbacks[0].rawTransactionDigest == providerReadbacks[1].rawTransactionDigest; "
      + "providerReadbacks[0].transactionDigest == providerReadbacks[1].transactionDigest; "
      + "providerReadbacks[0].transactionReceiptDigest == providerReadbacks[1].transactionReceiptDigest") {
    const providerReadbacks = value?.providerReadbacks;
    if (!Array.isArray(providerReadbacks) || providerReadbacks.length !== 2) return false;
    const [primary, secondary] = providerReadbacks;
    if (primary === null || typeof primary !== "object" || Array.isArray(primary)
      || secondary === null || typeof secondary !== "object" || Array.isArray(secondary)
      || typeof value?.previousBlockNumber !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(value.previousBlockNumber)
      || typeof value?.previousBlockHash !== "string"
      || typeof value?.startBlock !== "string"
      || !/^[1-9][0-9]*$/u.test(value.startBlock)
      || typeof value?.blockHash !== "string"
      || typeof primary.rawTransactionDigest !== "string"
      || typeof secondary.rawTransactionDigest !== "string"
      || typeof primary.transactionDigest !== "string"
      || typeof secondary.transactionDigest !== "string"
      || typeof primary.transactionReceiptDigest !== "string"
      || typeof secondary.transactionReceiptDigest !== "string") return false;
    return BigInt(value.previousBlockNumber) + 1n === BigInt(value.startBlock)
      && primary.previousBlockNumber === value.previousBlockNumber
      && secondary.previousBlockNumber === value.previousBlockNumber
      && primary.previousBlockHash === value.previousBlockHash
      && secondary.previousBlockHash === value.previousBlockHash
      && primary.blockNumber === value.startBlock
      && secondary.blockNumber === value.startBlock
      && primary.blockHash === value.blockHash
      && secondary.blockHash === value.blockHash
      && primary.rawTransactionDigest === secondary.rawTransactionDigest
      && primary.transactionDigest === secondary.transactionDigest
      && primary.transactionReceiptDigest === secondary.transactionReceiptDigest;
  }
  if (rule === "strictly increasing logIndex; unique") {
    if (!Array.isArray(value)) return false;
    const indexes = value.map((entry) => entry?.logIndex);
    if (indexes.some((index) => typeof index !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(index))) return false;
    return indexes.every((index, position) => position === 0
      || BigInt(index) > BigInt(indexes[position - 1]));
  }
  if (rule === "providerReadbacks[0].blockHash == providerReadbacks[1].blockHash") {
    const providerReadbacks = value?.providerReadbacks;
    if (!Array.isArray(providerReadbacks) || providerReadbacks.length !== 2) return false;
    const [primary, secondary] = providerReadbacks;
    if (typeof primary?.blockHash !== "string"
      || typeof secondary?.blockHash !== "string") return false;
    return primary.blockHash === secondary.blockHash;
  }
  if (rule
    === "resultingContracts providerReadbacks prove blockNumber - 1 -> blockNumber") {
    if (typeof value?.blockNumber !== "string"
      || !/^[1-9][0-9]*$/u.test(value.blockNumber)
      || typeof value?.blockHash !== "string"
      || !Array.isArray(value?.resultingContracts)
      || value.resultingContracts.length === 0) return false;
    const predecessorBlockNumber = (BigInt(value.blockNumber) - 1n).toString(10);
    return value.resultingContracts.every((result) => {
      if (result === null || typeof result !== "object" || Array.isArray(result)
        || typeof result.contract !== "string" || typeof result.address !== "string"
        || typeof result.previousBlockRuntimeCodeHash !== "string"
        || typeof result.runtimeCodeHash !== "string"
        || !Array.isArray(result.providerReadbacks)
        || result.providerReadbacks.length !== 2) return false;
      const [primary, secondary] = result.providerReadbacks;
      return primary !== null && typeof primary === "object" && !Array.isArray(primary)
        && secondary !== null && typeof secondary === "object" && !Array.isArray(secondary)
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
  if (rule === CHAIN_DEPLOYMENT_BINDING_RULE) {
    return validV4ChainDeploymentBindings(value);
  }
  if (rule === "ethereumFinalizedCheckpoint.blockNumber >= postingBlockNumber") {
    const postingBlockNumber = value?.postingBlockNumber;
    const finalizedBlockNumber = value?.ethereumFinalizedCheckpoint?.blockNumber;
    if (typeof postingBlockNumber !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(postingBlockNumber)
      || typeof finalizedBlockNumber !== "string"
      || !/^(?:0|[1-9][0-9]*)$/u.test(finalizedBlockNumber)) return false;
    return BigInt(finalizedBlockNumber) >= BigInt(postingBlockNumber);
  }
  if (rule === "routeEventLogIndex < launchEventLogIndex") {
    return Number.isInteger(value?.routeEventLogIndex)
      && Number.isInteger(value?.launchEventLogIndex)
      && value.routeEventLogIndex < value.launchEventLogIndex;
  }
  if (rule === "sourceRowCount == publishedRowCount") {
    return Number.isInteger(value?.sourceRowCount)
      && Number.isInteger(value?.publishedRowCount)
      && value.sourceRowCount >= 0
      && value.publishedRowCount >= 0
      && value.sourceRowCount === value.publishedRowCount;
  }
  if (rule === "launches.length <= quality.publishedRowCount") {
    return Array.isArray(value?.launches)
      && Number.isInteger(value?.quality?.publishedRowCount)
      && value.quality.publishedRowCount >= 0
      && value.launches.length <= value.quality.publishedRowCount;
  }
  if (rule === ONCHAIN_EVIDENCE_BINDING_RULE) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || value.l2Inclusion === null || typeof value.l2Inclusion !== "object"
      || Array.isArray(value.l2Inclusion)
      || !matchesV4ChainDeploymentDescriptorDigest(
        value.chainDeploymentDescriptorDigest,
        value.chainDeployment,
      )
      || value.router !== value.chainDeployment?.contracts?.programmableLaunchStampRouter?.address
      || value.routerRuntimeCodeHash
        !== value.chainDeployment?.contracts?.programmableLaunchStampRouter?.runtimeCodeHash
      || !canonicalJsonEqual(value.finalityPolicy, value.chainDeployment?.finality)
      || value.transactionHash !== value.l2Inclusion.transactionHash) return false;
    const ethereumFinality = value.chainDeployment?.permitAuthoritySourceProvenance
      ?.configurationEvidence?.ethereumFinalityEvidence;
    const postingMatchesDeployment = (posting) => posting?.rollup === ethereumFinality?.rollup
      && posting?.sequencerInbox === ethereumFinality?.sequencerInbox;
    let expectedBlockNumber = value.l2Inclusion.blockNumber;
    let expectedBlockHash = value.l2Inclusion.blockHash;
    let expectedLogIndex = value.l2Inclusion.launchEventLogIndex;
    if (value.checkpointType === "sequencer_soft_confirmation") {
      if (value.l1Posting !== null || value.l1FinalizedCheckpoint !== null
        || value.terminal !== false) return false;
    } else if (value.checkpointType === "ethereum_posted") {
      if (value.l1Posting === null || typeof value.l1Posting !== "object"
        || Array.isArray(value.l1Posting) || value.l1FinalizedCheckpoint !== null
        || value.terminal !== false || !postingMatchesDeployment(value.l1Posting)) return false;
      expectedBlockNumber = value.l1Posting.blockNumber;
      expectedBlockHash = value.l1Posting.blockHash;
      expectedLogIndex = value.l1Posting.logIndex;
    } else if (value.checkpointType === "ethereum_finalized") {
      if (value.l1Posting === null || typeof value.l1Posting !== "object"
        || Array.isArray(value.l1Posting)
        || value.l1FinalizedCheckpoint === null
        || typeof value.l1FinalizedCheckpoint !== "object"
        || Array.isArray(value.l1FinalizedCheckpoint)
        || value.terminal !== true || !postingMatchesDeployment(value.l1Posting)) return false;
      const checkpoint = value.l1FinalizedCheckpoint;
      const providers = ethereumFinality?.ethereumProviders;
      if (!Array.isArray(checkpoint.providerReadbacks)
        || checkpoint.providerReadbacks.length !== 2
        || !Array.isArray(providers)
        || providers.length !== 2
        || checkpoint.providerReadbacks.some((readback, index) =>
          readback?.blockNumber !== checkpoint.blockNumber
          || readback?.blockHash !== checkpoint.blockHash
          || readback?.providerId !== providers[index]?.providerId
          || readback?.trustDomain !== providers[index]?.trustDomain)
        || !/^[1-9][0-9]*$/u.test(checkpoint.blockNumber ?? "")
        || !/^[1-9][0-9]*$/u.test(value.l1Posting.blockNumber ?? "")
        || BigInt(checkpoint.blockNumber) < BigInt(value.l1Posting.blockNumber)) return false;
      expectedBlockNumber = checkpoint.blockNumber;
      expectedBlockHash = checkpoint.blockHash;
      expectedLogIndex = value.l1Posting.logIndex;
    } else {
      return false;
    }
    return value.blockNumber === expectedBlockNumber
      && value.blockHash === expectedBlockHash
      && value.logIndex === expectedLogIndex;
  }
  return false;
}

function validV4ChainDeploymentBindings(value) {
  if (!isPlainRecord(value)
    || !isPlainRecord(value.contracts)
    || !isPlainRecord(value.deploymentEvidence)
    || !isPlainRecord(value.permit2GenesisProvenance)
    || !isPlainRecord(value.permitAuthoritySourceProvenance)
    || !Array.isArray(value.externalRootDeploymentEvidence)) return false;

  const contracts = value.contracts;
  if (!canonicalJsonEqual(
    Object.keys(contracts).sort(compareUtf8),
    [...V4_TRUST_ROOT_NAMES].sort(compareUtf8),
  ) || V4_TRUST_ROOT_NAMES.some((name) =>
    !isTrustRootBinding(contracts[name]))) return false;

  const atomic = value.deploymentEvidence;
  if (typeof atomic.transactionHash !== "string"
    || !Array.isArray(atomic.providerReadbacks)
    || atomic.providerReadbacks.length !== 2
    || atomic.providerReadbacks.some((readback) =>
      !isPlainRecord(readback)
      || readback.transactionHash !== atomic.transactionHash)) return false;
  const atomicResults = atomic.resultingContracts;
  if (!Array.isArray(atomicResults)
    || atomicResults.length !== V4_ATOMIC_TRUST_ROOT_NAMES.length) return false;
  const atomicByName = new Map();
  for (const result of atomicResults) {
    if (!isPlainRecord(result)
      || typeof result.contract !== "string"
      || atomicByName.has(result.contract)
      || !sameTrustRoot(result, contracts[result.contract])) return false;
    atomicByName.set(result.contract, result);
  }
  if (V4_ATOMIC_TRUST_ROOT_NAMES.some((name) => !atomicByName.has(name))) return false;

  const permit2 = value.permit2GenesisProvenance;
  if (permit2.address !== contracts.permit2.address
    || !Array.isArray(permit2.providerReadbacks)
    || permit2.providerReadbacks.length !== 2
    || permit2.providerReadbacks.some((readback) =>
      !isPlainRecord(readback)
      || readback.runtimeCodeHash !== contracts.permit2.runtimeCodeHash)) return false;

  const permitAuthority = value.permitAuthoritySourceProvenance;
  const safe = permitAuthority.configurationEvidence;
  if (!isPlainRecord(safe)
    || permitAuthority.address !== contracts.permitAuthority.address
    || safe.proxyRuntimeCodeHash !== contracts.permitAuthority.runtimeCodeHash) return false;

  const comparableAtomicFields = ["transactionHash", "blockNumber", "blockHash"];
  if (comparableAtomicFields.some((field) =>
    typeof atomic[field] !== "string"
    || atomic[field] !== permitAuthority[field])
    || safe.blockNumber !== atomic.blockNumber
    || safe.blockHash !== atomic.blockHash
    || safe.ethereumFinalityEvidence?.l2Checkpoint?.blockNumber !== atomic.blockNumber
    || safe.ethereumFinalityEvidence?.l2Checkpoint?.blockHash !== atomic.blockHash
    || !canonicalJsonEqual(
      atomic.ethereumFinalityEvidence,
      safe.ethereumFinalityEvidence,
    )) return false;

  const permitAuthorityResult = atomicByName.get("permitAuthority");
  if (typeof permitAuthorityResult.stateEvidenceDigest !== "string"
    || permitAuthorityResult.stateEvidenceDigest
      !== safe.atomicRootStateEvidenceDigest) return false;

  const externalByName = new Map();
  if (value.externalRootDeploymentEvidence.length
    !== V4_EXTERNAL_TRUST_ROOT_NAMES.length) return false;
  for (const evidence of value.externalRootDeploymentEvidence) {
    if (!isPlainRecord(evidence)
      || typeof evidence.contract !== "string"
      || externalByName.has(evidence.contract)
      || !sameTrustRoot(evidence, contracts[evidence.contract])) return false;
    externalByName.set(evidence.contract, evidence);
  }
  if (V4_EXTERNAL_TRUST_ROOT_NAMES.some((name) => !externalByName.has(name))) return false;

  return contracts.programmableLaunchStampRouter.address
    !== contracts.universalRouter.address;
}

function matchesV4ChainDeploymentDescriptorDigest(digest, deployment) {
  if (typeof digest !== "string") return false;
  try {
    return digest === hashV4ChainDeployment(deployment);
  } catch {
    return false;
  }
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTrustRootBinding(value) {
  return isPlainRecord(value)
    && typeof value.address === "string"
    && typeof value.runtimeCodeHash === "string";
}

function sameTrustRoot(evidence, binding) {
  return isTrustRootBinding(binding)
    && evidence.address === binding.address
    && evidence.runtimeCodeHash === binding.runtimeCodeHash;
}

function canonicalJsonEqual(left, right) {
  if (left === undefined || right === undefined) return false;
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function collectTargetReferences(value, targetIds) {
  if (Array.isArray(value)) {
    for (const entry of value) collectTargetReferences(entry, targetIds);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Object.keys(value).length === 1 && typeof value.target === "string") {
    targetIds.add(value.target);
    return;
  }
  for (const entry of Object.values(value)) collectTargetReferences(entry, targetIds);
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

function validFinalizedMetadataV4() {
  const resource = validV4Resource(undefined, undefined, {
    chainDeployment: deploymentWithSafeEvidence(),
    profile: frozenV4Profile(),
    walletTransactionPreimageHash: `sha256:${"8".repeat(64)}`,
  });
  const onchain = validV4OnchainEvidenceV3(resource);
  delete onchain.walletTransactionPreimageHash;
  return {
    schemaVersion: "programmable.finalized-custom-launch-metadata.v4",
    apiVersion: "v4",
    launchId: resource.launchId,
    chainId: resource.chainId,
    caip2: resource.caip2,
    chainDeploymentId: resource.chainDeploymentId,
    chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
    chainDeployment: structuredClone(resource.chainDeployment),
    profile: structuredClone(resource.profile),
    platformId: "programmable",
    category: "custom",
    projectMetadata: structuredClone(resource.projectMetadata),
    funding: structuredClone(resource.funding),
    liquidityModel: structuredClone(resource.liquidityModel),
    commitments: structuredClone(resource.commitments),
    onchain,
    sourceVerification: validExactSourceVerificationStatusV4(),
    createdAt: resource.createdAt,
    finalizedAt: "2026-08-29T12:30:00.000Z",
  };
}

function validExactSourceVerificationStatusV4() {
  const value = validV4SourceVerificationStatus();
  const exact = value.components.find(({ status }) => status === "exact_match");
  value.status = "exact_match";
  value.components = value.components.map((component) => {
    const withoutRetry = structuredClone(component);
    delete withoutRetry.nextAttemptAt;
    return {
      ...withoutRetry,
      status: "exact_match",
      providerObservation: structuredClone(exact.providerObservation),
      exactSourceAuthority: exact.exactSourceAuthority,
      exactSourceBinding: structuredClone(exact.exactSourceBinding),
    };
  });
  return value;
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
    if (schema["x-programmable-order"] === "dependency-topological with UTF-8 tie-break") {
      entries.sort((left, right) => compareUtf8(left.targetId, right.targetId));
    } else if (schema["x-programmable-order"] === "UTF-8 role, NUL, lowercase address; unique") {
      entries.sort((left, right) => compareUtf8(
        `${left.role}\0${left.address.toLowerCase()}`,
        `${right.role}\0${right.address.toLowerCase()}`,
      ));
    } else if (schema["x-programmable-order"] === "unique UTF-8 ascending") {
      entries.sort(compareUtf8);
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
