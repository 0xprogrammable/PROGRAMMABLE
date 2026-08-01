import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  bytesToHex,
  concat,
  encodeAbiParameters,
  hexToBytes,
  keccak256,
  parseAbiItem,
  toBytes,
  toEventSelector,
  toFunctionSelector,
} from "viem";

import {
  BOOTSTRAP_PLAN_KIND,
  canonicalJson,
  sha256,
} from "./hosted-db-operator-core.mjs";

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const SELECTOR = /^0x[0-9a-f]{8}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NONZERO_BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const POSITIVE_INTEGER_TEXT = /^[1-9][0-9]*$/u;
const NONNEGATIVE_INTEGER_TEXT = /^(?:0|[1-9][0-9]*)$/u;
const EXACT_RELEASES = Object.freeze([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
]);
const POOL_MANAGER_WORD =
  "0x000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90";
const COMMITMENT_DOMAIN = "programmable:data-pipeline:bootstrap-commitment:v1";
const IMMUTABLE_REFERENCE_DOMAIN = toBytes(
  "programmable:data-pipeline:immutable-references:v1\0",
);

function exactCommitment(label, value) {
  return sha256(`${COMMITMENT_DOMAIN}\0${label}\0${canonicalJson(value)}`);
}

function deterministicUuid(label, value) {
  const raw = exactCommitment(`uuid:${label}`, value).slice(2, 34).split("");
  raw[12] = "5";
  raw[16] = (8 + (Number.parseInt(raw[16], 16) & 3)).toString(16);
  return `${raw.slice(0, 8).join("")}-${raw.slice(8, 12).join("")}-${raw.slice(12, 16).join("")}-${raw.slice(16, 20).join("")}-${raw.slice(20).join("")}`;
}

function canonicalNonzeroBytes32(value, label) {
  const result = canonicalBytes32(value, label);
  if (!NONZERO_BYTES32.test(result)) throw new Error(`${label} is zero`);
  return result;
}

function normalizeAbiParameter(parameter) {
  const normalized = {
    name: parameter.name ?? "",
    type: parameter.type,
    indexed: parameter.indexed ?? false,
  };
  if (Array.isArray(parameter.components)) {
    normalized.components = parameter.components.map(normalizeAbiParameter);
  }
  return normalized;
}

function normalizeAbiEvent(event) {
  return {
    type: "event",
    name: event.name,
    anonymous: event.anonymous ?? false,
    inputs: event.inputs.map(normalizeAbiParameter),
  };
}

function authorizedAbiEventEvidence(signatures, artifact, contractName) {
  if (!Array.isArray(signatures) || signatures.length < 1) {
    throw new Error(`authorized ABI event set is empty: ${contractName}`);
  }
  const artifactEvents = artifact.abi.filter(({ type }) => type === "event");
  const events = signatures.map((signature) => {
    const parsed = parseAbiItem(`event ${signature}`);
    const selector = toEventSelector(parsed);
    const expected = normalizeAbiEvent(parsed);
    const matches = artifactEvents.filter(
      (candidate) =>
        candidate.name === parsed.name &&
        toEventSelector(candidate) === selector &&
        canonicalJson(normalizeAbiEvent(candidate)) === canonicalJson(expected),
    );
    if (matches.length !== 1) {
      throw new Error(`artifact ABI event drift: ${contractName}.${parsed.name}`);
    }
    return { signature, selector, abi: expected };
  });
  const eventNames = events.map(({ abi }) => abi.name);
  if (new Set(eventNames).size !== eventNames.length) {
    throw new Error(`overloaded event names are unsupported: ${contractName}`);
  }
  return Object.freeze({
    eventNames: Object.freeze(eventNames),
    commitment: sha256(
      Buffer.from(
        `programmable:data-pipeline:abi-event-set:v1\0${canonicalJson({
          contractName,
          events,
        })}`,
        "utf8",
      ),
    ),
  });
}

function exactRecoverySelector(artifact, configured, contractName) {
  const launchFunctions = artifact.abi.filter(
    (item) => item.type === "function" && item.name === "launch",
  );
  if (configured === null) {
    if (launchFunctions.length !== 0) {
      throw new Error(`recovery selector is missing: ${contractName}`);
    }
    return null;
  }
  if (!SELECTOR.test(configured ?? "")) {
    throw new Error(`recovery selector is invalid: ${contractName}`);
  }
  if (
    launchFunctions.length !== 1 ||
    toFunctionSelector(launchFunctions[0]) !== configured
  ) {
    throw new Error(`recovery selector drift: ${contractName}`);
  }
  return configured;
}

function canonicalAddress(value, label) {
  const result = typeof value === "string" ? value.toLowerCase() : "";
  if (!ADDRESS.test(result)) throw new Error(`${label} is not an address`);
  return result;
}

function canonicalBytes32(value, label) {
  const result = typeof value === "string" ? value.toLowerCase() : "";
  if (!BYTES32.test(result)) throw new Error(`${label} is not bytes32`);
  return result;
}

function eventName(signature) {
  const match = /^([A-Za-z][A-Za-z0-9]*)\(/u.exec(signature);
  if (!match) throw new Error("event declaration is invalid");
  return match[1];
}

function immutableReferences(artifact) {
  const groups = artifact?.deployedBytecode?.immutableReferences;
  if (groups === null || typeof groups !== "object" || Array.isArray(groups)) {
    return [];
  }
  return Object.values(groups)
    .flat()
    .map(({ start, length }) => ({ start, length }))
    .sort((left, right) => left.start - right.start || left.length - right.length);
}

function immutableReferencesCommitment(references, runtimeCodeLength) {
  return keccak256(
    concat([
      IMMUTABLE_REFERENCE_DOMAIN,
      encodeAbiParameters(
        [{ type: "uint32" }, { type: "uint32[]" }, { type: "uint32[]" }],
        [
          runtimeCodeLength,
          references.map(({ start }) => start),
          references.map(({ length }) => length),
        ],
      ),
    ]),
  );
}

function normalizedRuntimeHash(runtimeCode, references) {
  const bytes = Uint8Array.from(hexToBytes(runtimeCode));
  for (const { start, length } of references) {
    bytes.fill(0, start, start + length);
  }
  return keccak256(bytesToHex(bytes));
}

async function loadArtifact(workspace, artifactName) {
  if (!/^[A-Z][A-Za-z0-9]{0,127}$/u.test(artifactName ?? "")) {
    throw new Error("artifact name is invalid");
  }
  const relativePath = `contracts/out/${artifactName}.sol/${artifactName}.json`;
  const absolutePath = path.join(workspace, relativePath);
  const bytes = await readFile(absolutePath);
  const artifact = JSON.parse(bytes.toString("utf8"));
  const creationCode = artifact?.bytecode?.object;
  const runtimeCode = artifact?.deployedBytecode?.object;
  if (
    !Array.isArray(artifact?.abi) ||
    typeof creationCode !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(creationCode) ||
    typeof runtimeCode !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(runtimeCode) ||
    artifact.bytecode?.linkReferences === null ||
    typeof artifact.bytecode?.linkReferences !== "object" ||
    Array.isArray(artifact.bytecode.linkReferences) ||
    Object.keys(artifact.bytecode.linkReferences).length !== 0 ||
    artifact.deployedBytecode?.linkReferences === null ||
    typeof artifact.deployedBytecode?.linkReferences !== "object" ||
    Array.isArray(artifact.deployedBytecode.linkReferences) ||
    Object.keys(artifact.deployedBytecode.linkReferences).length !== 0
  ) {
    throw new Error(`artifact bytecode is invalid: ${artifactName}`);
  }
  const references = immutableReferences(artifact);
  const runtimeCodeLength = (runtimeCode.length - 2) / 2;
  return Object.freeze({
    artifactName,
    abi: Object.freeze(artifact.abi),
    relativePath,
    fileSha256: sha256(bytes),
    creationCodeHash: keccak256(creationCode),
    runtimeTemplateHash: keccak256(runtimeCode),
    normalizedRuntimeCodeHash:
      references.length === 0
        ? keccak256(runtimeCode)
        : normalizedRuntimeHash(runtimeCode, references),
    immutableReferences: Object.freeze(references),
    immutableReferencesCommitment:
      references.length === 0
        ? null
        : immutableReferencesCommitment(references, runtimeCodeLength),
    runtimeCodeLength,
  });
}

function manifestDeploymentEvidence(manifest, source) {
  const verification =
    manifest?.sourceVerification?.contracts?.[source.deploymentKey] ??
    manifest?.sourceVerification?.[source.deploymentKey];
  const transactionEntry = manifest?.transactions?.[source.deploymentKey];
  const transactionHash =
    typeof transactionEntry === "string"
      ? transactionEntry
      : typeof transactionEntry?.transactionHash === "string"
        ? transactionEntry.transactionHash
      : typeof verification?.deploymentTransaction === "string"
        ? verification.deploymentTransaction
        : null;
  const deploymentBlock = Number.isSafeInteger(verification?.deploymentBlock)
    ? verification.deploymentBlock
    : Number.isSafeInteger(transactionEntry?.blockNumber)
      ? transactionEntry.blockNumber
    : Number.isSafeInteger(manifest?.deploymentBlocks?.[source.deploymentKey])
      ? manifest.deploymentBlocks[source.deploymentKey]
      : null;
  return Object.freeze({
    releaseCommit:
      typeof manifest.releaseCommit === "string" ? manifest.releaseCommit : null,
    sourceCommitment:
      typeof manifest.sourceCommitment === "string"
        ? canonicalBytes32(manifest.sourceCommitment, "manifest source commitment")
        : null,
    transactionHash:
      typeof transactionHash === "string"
        ? canonicalBytes32(transactionHash, "deployment transaction")
        : null,
    deploymentBlock,
    sourceVerificationStatus:
      typeof verification?.status === "string" ? verification.status : null,
  });
}

function providerBinding(provider, createdAt) {
  const identity = {
    providerType: provider.providerType,
    redactedIdentity: provider.redactedIdentity,
    deploymentCommitment: canonicalNonzeroBytes32(
      provider.deploymentCommitment,
      "provider deployment commitment",
    ),
    schemaCommitment: canonicalNonzeroBytes32(
      provider.schemaCommitment,
      "provider schema commitment",
    ),
  };
  const rpc = provider.providerType === "rpc_provider"
    ? {
        chainId: provider.chainId,
        vendor: provider.vendor,
        constructorVersion: provider.constructorVersion,
        endpointUrlCommitment: canonicalNonzeroBytes32(
          provider.endpointUrlCommitment,
          "RPC endpoint URL commitment",
        ),
        endpointOriginCommitment: canonicalNonzeroBytes32(
          provider.endpointOriginCommitment,
          "RPC endpoint origin commitment",
        ),
        endpointEvidenceDomain: provider.endpointEvidenceDomain,
      }
    : null;
  const providerDeploymentId = deterministicUuid("provider", { ...identity, rpc });
  const endpointEvidenceCommitment = rpc === null
    ? null
    : exactCommitment("rpc-endpoint-evidence", {
        providerDeploymentId,
        ...rpc,
      });
  const inputCommitment = exactCommitment("provider-registration", {
    providerDeploymentId,
    ...identity,
    rpc,
    endpointEvidenceCommitment,
  });
  return Object.freeze({
    ...provider,
    providerDeploymentId,
    ...(rpc === null ? {} : { endpointEvidenceCommitment }),
    inputCommitment,
    createdAt,
  });
}

function projectionRule({
  epochId,
  contractName,
  sourceRole,
  signature,
  ordinal,
  authority,
}) {
  const type = eventName(signature);
  const exact = authority.get(`${contractName}\0${type}`);
  if (!exact || exact.sourceRole !== sourceRole) {
    throw new Error(`event has no exact projector authority: ${contractName}.${type}`);
  }
  const projectionKind = exact.projectionKind;
  if (!IDENTIFIER.test(projectionKind ?? "")) {
    throw new Error(`projector kind is invalid: ${contractName}.${type}`);
  }
  const value = { epochId, projectionKind, sourceRole, eventType: type };
  return Object.freeze({
    ordinal,
    projectionEventRuleId: deterministicUuid("projection-event-rule", value),
    ...value,
    ruleCommitment: exactCommitment("projection-event-rule", value),
  });
}

function exactObjectKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson(expected.slice().sort())
  ) {
    throw new Error(`${label} shape is invalid`);
  }
}

function validateCandidateEnvioEvidence(evidence) {
  exactObjectKeys(
    evidence,
    [
      "path",
      "fileSha256",
      "status",
      "deploymentLabel",
      "graphqlEndpoint",
      "sourceCommit",
      "redactedIdentity",
      "deploymentCommitment",
      "schemaCommitment",
      "auditEvidenceCommitment",
      "policyCommitment",
    ],
    "candidate Envio evidence",
  );
  if (
    evidence.path !== "config/data-pipeline-envio-candidate.v1.json" ||
    !NONZERO_BYTES32.test(evidence.fileSha256 ?? "") ||
    evidence.status !== "deployed-synced-audited-not-promoted" ||
    !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(evidence.deploymentLabel ?? "") ||
    evidence.redactedIdentity !== `envio:${evidence.deploymentLabel}` ||
    !/^https:\/\/indexer\.hyperindex\.xyz\/[a-z0-9]{7,64}\/v1\/graphql$/u.test(
      evidence.graphqlEndpoint ?? "",
    ) ||
    !/^[0-9a-f]{40}$/u.test(evidence.sourceCommit ?? "") ||
    !NONZERO_BYTES32.test(evidence.deploymentCommitment ?? "") ||
    !NONZERO_BYTES32.test(evidence.schemaCommitment ?? "") ||
    !NONZERO_BYTES32.test(evidence.auditEvidenceCommitment ?? "") ||
    !NONZERO_BYTES32.test(evidence.policyCommitment ?? "")
  ) {
    throw new Error("candidate Envio evidence is invalid");
  }
}

function validateProviderSet(providers, candidateEnvioEvidence) {
  validateCandidateEnvioEvidence(candidateEnvioEvidence);
  if (!Array.isArray(providers) || providers.length !== 4) {
    throw new Error("bootstrap provider set is incomplete");
  }
  if (
    canonicalJson(
      providers.map(({ providerType, vendor = null }) => ({
        providerType,
        vendor,
      })),
    ) !==
      canonicalJson([
        { providerType: "envio_deployment", vendor: null },
        { providerType: "rpc_provider", vendor: "alchemy" },
        { providerType: "rpc_provider", vendor: "quicknode" },
        { providerType: "uniswap_subgraph", vendor: null },
      ])
  ) {
    throw new Error("bootstrap provider order is not canonical");
  }
  const envio = providers.filter(
    ({ providerType }) => providerType === "envio_deployment",
  );
  const rpc = providers.filter(
    ({ providerType }) => providerType === "rpc_provider",
  );
  const graph = providers.filter(
    ({ providerType }) => providerType === "uniswap_subgraph",
  );
  if (
    envio.length !== 1 ||
    rpc.length !== 2 ||
    graph.length !== 1 ||
    envio[0].redactedIdentity !== candidateEnvioEvidence.redactedIdentity ||
    envio[0].deploymentCommitment !==
      candidateEnvioEvidence.deploymentCommitment ||
    envio[0].schemaCommitment !== candidateEnvioEvidence.schemaCommitment
  ) {
    throw new Error("bootstrap provider set does not match candidate evidence");
  }
  exactObjectKeys(
    envio[0],
    [
      "providerType",
      "redactedIdentity",
      "deploymentCommitment",
      "schemaCommitment",
    ],
    "candidate Envio provider",
  );
  exactObjectKeys(
    graph[0],
    [
      "providerType",
      "redactedIdentity",
      "deploymentCommitment",
      "schemaCommitment",
      "subgraphId",
      "deployment",
    ],
    "Uniswap subgraph provider",
  );
  const vendors = rpc.map(({ vendor }) => vendor).sort();
  if (canonicalJson(vendors) !== canonicalJson(["alchemy", "quicknode"])) {
    throw new Error("bootstrap RPC vendors are not the canonical independent pair");
  }
  for (const provider of rpc) {
    exactObjectKeys(
      provider,
      [
        "providerType",
        "redactedIdentity",
        "vendor",
        "chainId",
        "constructorVersion",
        "endpointUrlCommitment",
        "endpointOriginCommitment",
        "endpointEvidenceDomain",
        "deploymentCommitment",
        "schemaCommitment",
      ],
      "RPC provider",
    );
    if (
      provider.chainId !== 1 ||
      provider.redactedIdentity !== `rpc:1:${provider.vendor}` ||
      provider.constructorVersion !== "rpc-provider-v1" ||
      provider.endpointEvidenceDomain !== "rpc-endpoint-commitments-v1"
    ) {
      throw new Error("bootstrap RPC endpoint evidence is invalid");
    }
    canonicalNonzeroBytes32(
      provider.endpointUrlCommitment,
      "RPC endpoint URL commitment",
    );
    canonicalNonzeroBytes32(
      provider.endpointOriginCommitment,
      "RPC endpoint origin commitment",
    );
  }
  if (
    graph[0].redactedIdentity !==
      `uniswap-v4:ethereum:${graph[0].deployment}` ||
    !/^[1-9A-HJ-NP-Za-km-z]{8,96}$/u.test(graph[0].subgraphId ?? "") ||
    !/^[1-9A-HJ-NP-Za-km-z]{8,96}$/u.test(graph[0].deployment ?? "")
  ) {
    throw new Error("Uniswap subgraph evidence is invalid");
  }
  if (new Set(providers.map(({ redactedIdentity }) => redactedIdentity)).size !== 4) {
    throw new Error("bootstrap provider identities are not unique");
  }
}

function validateCatalogAuthority(catalog, binding) {
  exactObjectKeys(
    catalog,
    [
      "schemaVersion",
      "chainId",
      "sourceGroup",
      "catalogVersion",
      "createdAt",
      "releaseBindingPath",
      "dynamicBindingSpecs",
      "releases",
    ],
    "bootstrap semantic catalog",
  );
  if (
    catalog.schemaVersion !== 1 ||
    catalog.chainId !== binding.chainId ||
    catalog.sourceGroup !== "core" ||
    !IDENTIFIER.test(catalog.catalogVersion ?? "") ||
    catalog.releaseBindingPath !== "config/data-pipeline-release.v1.json" ||
    typeof catalog.createdAt !== "string" ||
    Number.isNaN(Date.parse(catalog.createdAt)) ||
    new Date(catalog.createdAt).toISOString() !== catalog.createdAt ||
    catalog.dynamicBindingSpecs === null ||
    typeof catalog.dynamicBindingSpecs !== "object" ||
    Array.isArray(catalog.dynamicBindingSpecs) ||
    !Array.isArray(catalog.releases) ||
    canonicalJson(catalog.releases.map(({ releaseId }) => releaseId)) !==
      canonicalJson(EXACT_RELEASES)
  ) {
    throw new Error("bootstrap semantic catalog is invalid");
  }
  for (const release of catalog.releases) {
    exactObjectKeys(
      release,
      [
        "releaseId",
        "modelId",
        "activation",
        "deploymentManifestPath",
        "sources",
        "dynamicSources",
        "launchRequirements",
      ],
      "bootstrap semantic release",
    );
    exactObjectKeys(
      release.activation,
      ["epochNumber", "expectedGeneration", "nextGeneration"],
      "bootstrap release activation",
    );
    if (
      release.activation.epochNumber !== 1 ||
      release.activation.expectedGeneration !== 0 ||
      release.activation.nextGeneration !== 1 ||
      !/^contracts\/deployments\/mainnet-[a-z0-9-]+\.json$/u.test(
        release.deploymentManifestPath ?? "",
      ) ||
      !Array.isArray(release.sources) ||
      !Array.isArray(release.dynamicSources) ||
      !Array.isArray(release.launchRequirements)
    ) {
      throw new Error(`bootstrap release authority is invalid: ${release.releaseId}`);
    }
    const expectedModel = release.releaseId.startsWith("classic-")
      ? "classic"
      : "stock-paired";
    if (
      release.modelId !== expectedModel ||
      release.sources.length < 1 ||
      release.launchRequirements.length < 1 ||
      new Set(release.sources.map(({ contractName }) => contractName)).size !==
        release.sources.length ||
      new Set(
        release.dynamicSources.map(({ contractName }) => contractName),
      ).size !== release.dynamicSources.length
    ) {
      throw new Error(`bootstrap release coverage is invalid: ${release.releaseId}`);
    }
    for (const source of release.sources) {
      exactObjectKeys(
        source,
        [
          "contractName",
          "sourceRole",
          "sourceType",
          "artifact",
          "deploymentKey",
          "recoverySelector",
        ],
        "bootstrap static source",
      );
      if (
        source.sourceType !== "ethereum_contract" ||
        !IDENTIFIER.test(source.contractName ?? "") ||
        !IDENTIFIER.test(source.sourceRole ?? "") ||
        !/^[A-Z][A-Za-z0-9]{0,127}$/u.test(source.artifact ?? "") ||
        !IDENTIFIER.test(source.deploymentKey ?? "")
      ) {
        throw new Error(`bootstrap source semantics are invalid: ${source.contractName}`);
      }
    }
    for (const dynamic of release.dynamicSources) {
      exactObjectKeys(
        dynamic,
        [
          "contractName",
          "artifact",
          "parentContractName",
          "parentSourceRole",
          "factoryEventType",
          "deployedAddressField",
          "deployedSourceRole",
          "bindingSpec",
          "factoryConfigurationField",
          "bindingPolicy",
        ],
        "bootstrap dynamic source",
      );
      if (
        dynamic.deployedAddressField !== "vault" ||
        dynamic.deployedSourceRole !== "reward_vault" ||
        !/^[A-Z][A-Za-z0-9]{0,127}$/u.test(dynamic.artifact ?? "") ||
        !IDENTIFIER.test(dynamic.parentContractName ?? "") ||
        !IDENTIFIER.test(dynamic.parentSourceRole ?? "") ||
        !IDENTIFIER.test(dynamic.factoryEventType ?? "") ||
        !IDENTIFIER.test(dynamic.bindingSpec ?? "") ||
        ![
          "factory-event-and-constants",
          "factory-event-constants-and-deferred-allocation",
        ].includes(dynamic.bindingPolicy) ||
        (dynamic.bindingPolicy === "factory-event-and-constants" &&
          typeof dynamic.factoryConfigurationField !== "string") ||
        (dynamic.bindingPolicy ===
          "factory-event-constants-and-deferred-allocation" &&
          dynamic.factoryConfigurationField !== null)
      ) {
        throw new Error(`bootstrap dynamic semantics are invalid: ${dynamic.contractName}`);
      }
    }
    const requirementKeys = new Set();
    for (const requirement of release.launchRequirements) {
      exactObjectKeys(
        requirement,
        ["occurrenceRole", "eventType", "requiredWhen"],
        "bootstrap launch requirement",
      );
      const key = `${requirement.occurrenceRole}\0${requirement.eventType}`;
      if (
        !IDENTIFIER.test(requirement.occurrenceRole ?? "") ||
        !IDENTIFIER.test(requirement.eventType ?? "") ||
        !["always", "reward_vault", "locked_custody", "eth_funded"].includes(
          requirement.requiredWhen,
        ) ||
        requirementKeys.has(key)
      ) {
        throw new Error(
          `bootstrap launch requirement is invalid: ${release.releaseId}`,
        );
      }
      requirementKeys.add(key);
    }
  }
}

function validateDeploymentManifest(manifest, semantic) {
  if (
    manifest?.chainId !== 1 ||
    manifest?.lifecycleEvidence?.status !== "verified-current-release" ||
    manifest?.lifecycleEvidence?.releaseEligible !== true ||
    !["match", "verified"].includes(manifest?.sourceVerification?.status) ||
    !/^[0-9a-f]{40}$/u.test(manifest?.releaseCommit ?? "") ||
    !NONZERO_BYTES32.test(
      typeof manifest?.sourceCommitment === "string"
        ? manifest.sourceCommitment.toLowerCase()
        : "",
    ) ||
    manifest.addresses === null ||
    typeof manifest.addresses !== "object" ||
    Array.isArray(manifest.addresses)
  ) {
    throw new Error(`deployment manifest is not release eligible: ${semantic.releaseId}`);
  }
}

function validateDynamicBindingSpec({
  spec,
  dynamic,
  artifact,
  factoryEvent,
  manifest,
}) {
  exactObjectKeys(
    spec,
    [
      "factoryConfigurationField",
      "normalizedRuntimeCodeHash",
      "immutableReferencesCommitment",
      "runtimeCodeLength",
      "bindings",
    ],
    "dynamic immutable binding specification",
  );
  if (
    dynamic.factoryConfigurationField !== spec.factoryConfigurationField ||
    !Array.isArray(spec.bindings) ||
    spec.bindings.length !== artifact.immutableReferences.length
  ) {
    throw new Error(`dynamic immutable binding coverage drift: ${dynamic.contractName}`);
  }
  const eventFields = new Map(
    factoryEvent.inputs.map((input) => [input.name, input.type]),
  );
  const reviewedConstants = new Set([POOL_MANAGER_WORD]);
  if (typeof manifest.addresses.ctoAuthority === "string") {
    reviewedConstants.add(
      `0x${"0".repeat(24)}${canonicalAddress(
        manifest.addresses.ctoAuthority,
        "CTO authority",
      ).slice(2)}`,
    );
  }
  let deferredConfiguration = 0;
  let deferredBeneficiaryCount = 0;
  for (const [index, binding] of spec.bindings.entries()) {
    const expectedReference = artifact.immutableReferences[index];
    const expectedKeys = ["ordinal", "offset", "length", "source", "encoding"];
    if (binding?.source === "factory_event") expectedKeys.push("field");
    if (binding?.source === "constant") expectedKeys.push("value");
    if (binding?.source === "deferred_allocation_evidence") {
      expectedKeys.push("evidenceRole");
    }
    exactObjectKeys(binding, expectedKeys, "dynamic immutable binding");
    if (
      binding.ordinal !== String(index) ||
      binding.offset !== String(expectedReference.start) ||
      binding.length !== String(expectedReference.length) ||
      !["address", "bytes"].includes(binding.encoding)
    ) {
      throw new Error(`dynamic immutable binding offset drift: ${dynamic.contractName}`);
    }
    if (binding.source === "factory_event") {
      const fieldType = eventFields.get(binding.field);
      if (
        (binding.encoding === "address" && fieldType !== "address") ||
        (binding.encoding === "bytes" && fieldType !== "bytes32")
      ) {
        throw new Error(`dynamic factory binding type drift: ${dynamic.contractName}`);
      }
    } else if (binding.source === "constant") {
      if (
        !reviewedConstants.has(binding.value) ||
        binding.value.length !== 2 + expectedReference.length * 2
      ) {
        throw new Error(`dynamic immutable constant is not reviewed: ${dynamic.contractName}`);
      }
    } else if (binding.source === "deferred_allocation_evidence") {
      if (
        binding.encoding !== "bytes" ||
        expectedReference.length !== 32 ||
        !["configuration_hash", "beneficiary_count"].includes(
          binding.evidenceRole,
        )
      ) {
        throw new Error(`dynamic deferred evidence is invalid: ${dynamic.contractName}`);
      }
      if (binding.evidenceRole === "configuration_hash") {
        deferredConfiguration += 1;
      } else {
        deferredBeneficiaryCount += 1;
      }
    } else if (
      binding.source !== "deployed_address" ||
      binding.encoding !== "address"
    ) {
      throw new Error(`dynamic immutable source is invalid: ${dynamic.contractName}`);
    }
  }
  if (
    (spec.factoryConfigurationField === null &&
      (deferredConfiguration !== 1 || deferredBeneficiaryCount < 1)) ||
    (typeof spec.factoryConfigurationField === "string" &&
      (eventFields.get(spec.factoryConfigurationField) !== "bytes32" ||
        deferredConfiguration !== 0 ||
        deferredBeneficiaryCount !== 0))
  ) {
    throw new Error(`dynamic configuration evidence is invalid: ${dynamic.contractName}`);
  }
}

export async function buildReviewedBootstrapPlan({
  workspace,
  repositoryCommit,
  binding,
  bindingSha256,
  providers,
  eventSignatures,
  projectionRules,
  createdAt,
  candidateEnvioEvidence,
}) {
  if (!/^[0-9a-f]{40}$/u.test(repositoryCommit) || !BYTES32.test(bindingSha256)) {
    throw new Error("bootstrap checkout evidence is invalid");
  }
  if (
    typeof createdAt !== "string" ||
    Number.isNaN(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  ) {
    throw new Error("bootstrap creation time is invalid");
  }
  const catalogPath = "config/data-pipeline-bootstrap.v1.json";
  const catalogBytes = await readFile(path.join(workspace, catalogPath));
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  validateCatalogAuthority(catalog, binding);
  if (catalog.createdAt !== createdAt) {
    throw new Error("bootstrap creation time does not match the reviewed catalog");
  }
  const sourceByName = new Map(binding.sources.map((source) => [source.contractName, source]));
  const releaseById = new Map(binding.releases.map((release) => [release.releaseVersion, release]));
  const projectionRuleAuthority = new Map(
    projectionRules.map((rule) => [
      `${rule.contractName}\0${rule.eventName}`,
      rule,
    ]),
  );
  if (projectionRuleAuthority.size !== projectionRules.length) {
    throw new Error("projector rule authority is not unique");
  }
  const artifactCache = new Map();
  const artifactEvidence = async (name) => {
    if (!artifactCache.has(name)) {
      artifactCache.set(name, await loadArtifact(workspace, name));
    }
    return artifactCache.get(name);
  };

  validateProviderSet(providers, candidateEnvioEvidence);
  const providerBindings = providers.map((provider) =>
    providerBinding(provider, createdAt),
  );
  const candidateEnvioProvider = providerBindings.find(
    ({ providerType }) => providerType === "envio_deployment",
  );
  if (
    !candidateEnvioProvider ||
    candidateEnvioProvider.redactedIdentity !==
      candidateEnvioEvidence.redactedIdentity
  ) {
    throw new Error("candidate-only database requires the audited Envio candidate");
  }
  const candidateInitializationInputCommitment = exactCommitment(
    "candidate-database-initialization",
    {
      providerDeploymentId: candidateEnvioProvider.providerDeploymentId,
      deploymentCommitment: candidateEnvioProvider.deploymentCommitment,
      schemaCommitment: candidateEnvioProvider.schemaCommitment,
      evidencePath: candidateEnvioEvidence.path,
      evidenceFileSha256: candidateEnvioEvidence.fileSha256,
      auditEvidenceCommitment:
        candidateEnvioEvidence.auditEvidenceCommitment,
      policyCommitment: candidateEnvioEvidence.policyCommitment,
      sourceCommit: candidateEnvioEvidence.sourceCommit,
      initializedAt: createdAt,
    },
  );
  const releases = [];
  const usedDynamicBindingSpecs = new Set();
  for (const [releaseIndex, semantic] of catalog.releases.entries()) {
    const bindingRelease = releaseById.get(semantic.releaseId);
    if (
      !bindingRelease || bindingRelease.model !== semantic.modelId ||
      binding.releases[releaseIndex]?.releaseVersion !== semantic.releaseId ||
      JSON.stringify(bindingRelease.sourceContracts) !==
        JSON.stringify(semantic.sources.map(({ contractName }) => contractName)) ||
      JSON.stringify(bindingRelease.dynamicContracts) !==
        JSON.stringify(semantic.dynamicSources.map(({ contractName }) => contractName))
    ) {
      throw new Error(`semantic release drift: ${semantic.releaseId}`);
    }
    const manifestBytes = await readFile(
      path.join(workspace, semantic.deploymentManifestPath),
    );
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    validateDeploymentManifest(manifest, semantic);
    const allArtifactEntries = await Promise.all([
      ...semantic.sources.map(async (source) => ({
        contractName: source.contractName,
        artifact: await artifactEvidence(source.artifact),
      })),
      ...semantic.dynamicSources.map(async (source) => ({
        contractName: source.contractName,
        artifact: await artifactEvidence(source.artifact),
      })),
    ]);
    const artifactCreationCodeCommitment = exactCommitment(
      "release-artifact-creation-set",
      allArtifactEntries
        .map(({ contractName, artifact }) => ({
          contractName,
          artifactFileSha256: artifact.fileSha256,
          creationCodeHash: artifact.creationCodeHash,
        }))
        .sort((left, right) => left.contractName.localeCompare(right.contractName)),
    );
    const scope = {
      chainId: 1,
      releaseId: semantic.releaseId,
      modelId: semantic.modelId,
      sourceGroup: catalog.sourceGroup,
    };
    const epochId = deterministicUuid("release-epoch", {
      ...scope,
      epochNumber: semantic.activation.epochNumber,
      artifactCreationCodeCommitment,
    });
    const sourceBindings = [];
    for (const [sourceIndex, source] of semantic.sources.entries()) {
      const pinned = sourceByName.get(source.contractName);
      if (!pinned) throw new Error(`source binding is missing: ${source.contractName}`);
      const address = canonicalAddress(pinned.address, "source address");
      const manifestAddress = canonicalAddress(
        manifest.addresses[source.deploymentKey],
        `deployment address: ${source.contractName}`,
      );
      if (manifestAddress !== address) {
        throw new Error(`deployment address drift: ${source.contractName}`);
      }
      const runtimeCodeHash = canonicalBytes32(pinned.runtimeCodeHash, "runtime code hash");
      const artifact = await artifactEvidence(source.artifact);
      const signatures = eventSignatures[source.contractName];
      const abiEvidence = authorizedAbiEventEvidence(
        signatures,
        artifact,
        source.contractName,
      );
      const recoverySelector = exactRecoverySelector(
        artifact,
        source.recoverySelector,
        source.contractName,
      );
      const bindingValue = {
        epochId,
        sourceName: source.contractName,
        sourceRole: source.sourceRole,
        sourceType: source.sourceType,
        sourceAddress: address,
        recoverySelector,
        inclusiveStartBlock: String(pinned.startBlock),
        abiEventSetCommitment: abiEvidence.commitment,
        artifactCreationCodeCommitment,
        artifactFileSha256: artifact.fileSha256,
        artifactCreationCodeHash: artifact.creationCodeHash,
        runtimeCodeHash,
      };
      const bindingId = deterministicUuid("release-source-binding", bindingValue);
      sourceBindings.push(Object.freeze({
        ordinal: sourceIndex + 1,
        bindingId,
        ...bindingValue,
        deploymentEvidence: manifestDeploymentEvidence(manifest, source),
        bindingCommitment: exactCommitment("release-source-binding", {
          bindingId,
          ...bindingValue,
        }),
        inputCommitment: exactCommitment("release-source-binding-input", {
          bindingId,
          ...bindingValue,
        }),
        createdAt,
      }));
    }
    const sourceBindingByName = new Map(
      sourceBindings.map((source) => [source.sourceName, source]),
    );
    const dynamicSourceTemplates = [];
    for (const [dynamicIndex, dynamic] of semantic.dynamicSources.entries()) {
      const parent = sourceBindingByName.get(dynamic.parentContractName);
      const artifact = await artifactEvidence(dynamic.artifact);
      const spec = catalog.dynamicBindingSpecs[dynamic.bindingSpec];
      const parentSemantic = semantic.sources.find(
        ({ contractName }) => contractName === dynamic.parentContractName,
      );
      if (
        !parent ||
        !parentSemantic ||
        parent.sourceRole !== dynamic.parentSourceRole ||
        !spec
      ) {
        throw new Error("dynamic template parent/spec is missing or mismatched");
      }
      usedDynamicBindingSpecs.add(dynamic.bindingSpec);
      const parentArtifact = await artifactEvidence(parentSemantic.artifact);
      const factorySignature = eventSignatures[dynamic.parentContractName]?.find(
        (signature) => signature.startsWith(`${dynamic.factoryEventType}(`),
      );
      if (!factorySignature) {
        throw new Error(`dynamic factory event is unauthorized: ${dynamic.contractName}`);
      }
      const factoryEvent = parseAbiItem(`event ${factorySignature}`);
      authorizedAbiEventEvidence(
        [factorySignature],
        parentArtifact,
        dynamic.parentContractName,
      );
      if (
        factoryEvent.inputs.find(
          (input) => input.name === dynamic.deployedAddressField,
        )?.type !== "address"
      ) {
        throw new Error(`dynamic deployed address field is invalid: ${dynamic.contractName}`);
      }
      const references = spec.bindings.map(({ offset, length }) => ({
        start: Number(offset),
        length: Number(length),
      }));
      if (
        JSON.stringify(references) !== JSON.stringify(artifact.immutableReferences) ||
        canonicalBytes32(spec.normalizedRuntimeCodeHash, "normalized runtime hash") !==
          artifact.normalizedRuntimeCodeHash ||
        canonicalBytes32(spec.immutableReferencesCommitment, "immutable refs commitment") !==
          artifact.immutableReferencesCommitment ||
        Number(spec.runtimeCodeLength) !== artifact.runtimeCodeLength
      ) {
        throw new Error(`dynamic artifact evidence drift: ${dynamic.contractName}`);
      }
      validateDynamicBindingSpec({
        spec,
        dynamic,
        artifact,
        factoryEvent,
        manifest,
      });
      const immutableBindingSpec = {
        factoryConfigurationField: dynamic.factoryConfigurationField,
        bindings: spec.bindings,
      };
      const immutableBindingCommitment = exactCommitment(
        "dynamic-immutable-binding",
        immutableBindingSpec,
      );
      const dynamicAbiEvidence = authorizedAbiEventEvidence(
        eventSignatures[dynamic.contractName],
        artifact,
        dynamic.contractName,
      );
      const dynamicValue = {
        epochId,
        parentFactoryReleaseBindingId: parent.bindingId,
        parentFactoryBindingCommitment: parent.bindingCommitment,
        parentSourceRole: dynamic.parentSourceRole,
        factoryEventType: dynamic.factoryEventType,
        deployedAddressField: dynamic.deployedAddressField,
        deployedSourceRole: dynamic.deployedSourceRole,
        deployedArtifactCreationCodeCommitment: artifact.creationCodeHash,
        deployedArtifactCreationCodeHash: artifact.creationCodeHash,
        artifactFileSha256: artifact.fileSha256,
        expectedInstanceRuntimeCodeHash: null,
        normalizedRuntimeCodeHash: artifact.normalizedRuntimeCodeHash,
        immutableReferencesCommitment: artifact.immutableReferencesCommitment,
        immutableBindingSpec,
        immutableBindingCommitment,
        runtimeCodeLength: String(artifact.runtimeCodeLength),
        abiEventSetCommitment: dynamicAbiEvidence.commitment,
        evidencePolicy: dynamic.bindingPolicy,
      };
      const dynamicSourceTemplateId = deterministicUuid(
        "dynamic-source-template",
        dynamicValue,
      );
      dynamicSourceTemplates.push(Object.freeze({
        ordinal: dynamicIndex + 1,
        dynamicSourceTemplateId,
        contractName: dynamic.contractName,
        ...dynamicValue,
        templateCommitment: exactCommitment("dynamic-source-template", {
          dynamicSourceTemplateId,
          ...dynamicValue,
        }),
        createdAt,
      }));
    }
    const projectionEventRules = [];
    for (const source of [...sourceBindings, ...dynamicSourceTemplates.map((template) => ({
      sourceName: template.contractName,
      sourceRole: template.deployedSourceRole,
    }))]) {
      for (const signature of eventSignatures[source.sourceName]) {
        projectionEventRules.push(projectionRule({
          epochId,
          contractName: source.sourceName,
          sourceRole: source.sourceRole,
          signature,
          ordinal: projectionEventRules.length + 1,
          authority: projectionRuleAuthority,
        }));
      }
    }
    const uniqueRuleKeys = new Set(
      projectionEventRules.map(({ sourceRole, eventType }) => `${sourceRole}\0${eventType}`),
    );
    if (uniqueRuleKeys.size !== projectionEventRules.length) {
      throw new Error(`duplicate writer event rule: ${semantic.releaseId}`);
    }
    for (const requirement of semantic.launchRequirements) {
      if (
        !uniqueRuleKeys.has(
          `${requirement.occurrenceRole}\0${requirement.eventType}`,
        )
      ) {
        throw new Error(
          `launch requirement has no exact projector rule: ${semantic.releaseId}`,
        );
      }
    }
    const launchCompletenessRequirements = semantic.launchRequirements.map(
      (requirement, index) => {
        const value = {
          epochId,
          requirementOrdinal: index,
          occurrenceRole: requirement.occurrenceRole,
          eventType: requirement.eventType,
          requiredWhen: requirement.requiredWhen,
        };
        return Object.freeze({
          ordinal: index + 1,
          launchRequirementId: deterministicUuid("launch-requirement", value),
          ...value,
          requirementCommitment: exactCommitment("launch-requirement", value),
          createdAt,
        });
      },
    );
    if (
      !Number.isSafeInteger(bindingRelease.activationBlock) ||
      bindingRelease.activationBlock < 1
    ) {
      throw new Error(`release activation block is invalid: ${semantic.releaseId}`);
    }
    const epochValue = {
      scope,
      epochId,
      epochNumber: String(semantic.activation.epochNumber),
      activationBlock: String(bindingRelease.activationBlock),
      artifactCreationCodeCommitment,
      sourceBindings: sourceBindings.map(({ bindingCommitment }) => bindingCommitment),
      dynamicSourceTemplates: dynamicSourceTemplates.map(({ templateCommitment }) => templateCommitment),
      projectionEventRules: projectionEventRules.map(({ ruleCommitment }) => ruleCommitment),
      launchCompletenessRequirements: launchCompletenessRequirements.map(
        ({ requirementCommitment }) => requirementCommitment,
      ),
    };
    const epochCommitment = exactCommitment("release-epoch", epochValue);
    releases.push(Object.freeze({
      ordinal: releaseIndex + 1,
      scope,
      activationBlock: String(bindingRelease.activationBlock),
      epochId,
      epochNumber: String(semantic.activation.epochNumber),
      epochCommitment,
      artifactCreationCodeCommitment,
      createInputCommitment: exactCommitment("release-epoch-create-input", {
        ...epochValue,
        epochCommitment,
      }),
      sourceBindings: Object.freeze(sourceBindings),
      dynamicSourceTemplates: Object.freeze(dynamicSourceTemplates),
      projectionEventRules: Object.freeze(projectionEventRules),
      launchCompletenessRequirements: Object.freeze(launchCompletenessRequirements),
      activation: Object.freeze({
        expectedGeneration: String(semantic.activation.expectedGeneration),
        nextGeneration: String(semantic.activation.nextGeneration),
        inputCommitment: exactCommitment("release-epoch-activation", {
          scope,
          epochId,
          epochCommitment,
          expectedGeneration: String(
            semantic.activation.expectedGeneration,
          ),
          nextGeneration: String(semantic.activation.nextGeneration),
        }),
        changedAt: createdAt,
      }),
      deploymentManifest: Object.freeze({
        path: semantic.deploymentManifestPath,
        sha256: sha256(manifestBytes),
        releaseCommit: manifest.releaseCommit ?? null,
        sourceCommitment: manifest.sourceCommitment ?? null,
      }),
    }));
  }

  if (
    canonicalJson(Object.keys(catalog.dynamicBindingSpecs).sort()) !==
    canonicalJson([...usedDynamicBindingSpecs].sort())
  ) {
    throw new Error("bootstrap dynamic binding specification is orphaned");
  }

  const payload = {
    kind: BOOTSTRAP_PLAN_KIND,
    schemaVersion: 2,
    repositoryCommit,
    createdAt,
    catalog: {
      path: catalogPath,
      sha256: sha256(catalogBytes),
      version: catalog.catalogVersion,
    },
    releaseBinding: {
      path: catalog.releaseBindingPath,
      sha256: bindingSha256,
      chainId: binding.chainId,
      startBlock: String(binding.startBlock),
      confirmations: binding.confirmations,
    },
    providerBindings: Object.freeze(providerBindings),
    releases: Object.freeze(releases),
    candidateIsolation: Object.freeze({
      databaseMode: "candidate-only",
      candidateEvidencePath: candidateEnvioEvidence.path,
      candidateEvidenceSha256: candidateEnvioEvidence.fileSha256,
      candidateAuditEvidenceCommitment:
        candidateEnvioEvidence.auditEvidenceCommitment,
      candidatePolicyCommitment: candidateEnvioEvidence.policyCommitment,
      candidateSourceCommit: candidateEnvioEvidence.sourceCommit,
      candidateEnvioIdentity: candidateEnvioProvider.redactedIdentity,
      candidateEnvioProviderDeploymentId:
        candidateEnvioProvider.providerDeploymentId,
      candidateInitializationInputCommitment,
      legacyProductionEnvioIdentity: `envio:${binding.envio.deploymentLabel}`,
      legacyProductionDeploymentRegistered: false,
      publicationAllowedBeforePromotion: false,
      promotionPolicy: "atomic-attestation-then-vercel-cutover",
      reason: "provider-neutral candidate identifiers are safe only because this database contains exactly one Envio deployment before promotion",
    }),
    execution: Object.freeze({
      mode: "reviewed-atomic-bootstrap",
      targetDatabaseMode: "candidate-only",
      ready: true,
      exactReplayOnlyAfterFirstApply: true,
      mixedGenerationPolicy: "reject",
      expectedProductGenerations: Object.freeze(
        releases.map(({ scope }) => ({ ...scope, before: "0", after: "1" })),
      ),
      runtimeStartGate: "separate-dual-rpc-genesis-evidence-required",
    }),
  };
  return Object.freeze({
    ...payload,
    planSha256: sha256(canonicalJson(payload)),
  });
}

function exactIsoTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validateReviewedProvider(provider, createdAt) {
  const rpc = provider.providerType === "rpc_provider";
  const graph = provider.providerType === "uniswap_subgraph";
  exactObjectKeys(
    provider,
    rpc
      ? [
          "providerType",
          "redactedIdentity",
          "vendor",
          "chainId",
          "constructorVersion",
          "endpointUrlCommitment",
          "endpointOriginCommitment",
          "endpointEvidenceDomain",
          "deploymentCommitment",
          "schemaCommitment",
          "providerDeploymentId",
          "endpointEvidenceCommitment",
          "inputCommitment",
          "createdAt",
        ]
      : graph
        ? [
            "providerType",
            "redactedIdentity",
            "deploymentCommitment",
            "schemaCommitment",
            "subgraphId",
            "deployment",
            "providerDeploymentId",
            "inputCommitment",
            "createdAt",
          ]
        : [
            "providerType",
            "redactedIdentity",
            "deploymentCommitment",
            "schemaCommitment",
            "providerDeploymentId",
            "inputCommitment",
            "createdAt",
          ],
    "reviewed provider binding",
  );
  if (
    !["envio_deployment", "rpc_provider", "uniswap_subgraph"].includes(
      provider.providerType,
    ) ||
    !IDENTIFIER.test(provider.redactedIdentity ?? "") ||
    !UUID.test(provider.providerDeploymentId ?? "") ||
    provider.createdAt !== createdAt
  ) {
    throw new Error("reviewed provider identity is invalid");
  }
  const identity = {
    providerType: provider.providerType,
    redactedIdentity: provider.redactedIdentity,
    deploymentCommitment: canonicalNonzeroBytes32(
      provider.deploymentCommitment,
      "reviewed provider deployment commitment",
    ),
    schemaCommitment: canonicalNonzeroBytes32(
      provider.schemaCommitment,
      "reviewed provider schema commitment",
    ),
  };
  const rpcEvidence = rpc
    ? {
        chainId: provider.chainId,
        vendor: provider.vendor,
        constructorVersion: provider.constructorVersion,
        endpointUrlCommitment: canonicalNonzeroBytes32(
          provider.endpointUrlCommitment,
          "reviewed RPC endpoint URL commitment",
        ),
        endpointOriginCommitment: canonicalNonzeroBytes32(
          provider.endpointOriginCommitment,
          "reviewed RPC endpoint origin commitment",
        ),
        endpointEvidenceDomain: provider.endpointEvidenceDomain,
      }
    : null;
  const providerDeploymentId = deterministicUuid("provider", {
    ...identity,
    rpc: rpcEvidence,
  });
  if (provider.providerDeploymentId !== providerDeploymentId) {
    throw new Error("reviewed provider deterministic identity drifted");
  }
  const endpointEvidenceCommitment = rpc
    ? exactCommitment("rpc-endpoint-evidence", {
        providerDeploymentId,
        ...rpcEvidence,
      })
    : null;
  if (
    rpc &&
    provider.endpointEvidenceCommitment !== endpointEvidenceCommitment
  ) {
    throw new Error("reviewed RPC endpoint evidence drifted");
  }
  const expectedInput = exactCommitment("provider-registration", {
    providerDeploymentId,
    ...identity,
    rpc: rpcEvidence,
    endpointEvidenceCommitment,
  });
  if (provider.inputCommitment !== expectedInput) {
    throw new Error("reviewed provider input commitment drifted");
  }
}

function validatePlanImmutableBindingSpec(spec, runtimeCodeLength) {
  exactObjectKeys(
    spec,
    ["factoryConfigurationField", "bindings"],
    "reviewed immutable binding specification",
  );
  if (
    !Array.isArray(spec.bindings) ||
    spec.bindings.length < 1 ||
    spec.bindings.length > 64 ||
    !(
      spec.factoryConfigurationField === null ||
      /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(
        spec.factoryConfigurationField ?? "",
      )
    )
  ) {
    throw new Error("reviewed immutable binding specification is invalid");
  }
  let previousEnd = 0;
  let deferredConfiguration = 0;
  let deferredBeneficiary = 0;
  for (const [index, binding] of spec.bindings.entries()) {
    const expectedKeys = ["ordinal", "offset", "length", "source", "encoding"];
    if (binding?.source === "factory_event") expectedKeys.push("field");
    if (binding?.source === "constant") expectedKeys.push("value");
    if (binding?.source === "deferred_allocation_evidence") {
      expectedKeys.push("evidenceRole");
    }
    exactObjectKeys(binding, expectedKeys, "reviewed immutable binding");
    const offset = Number(binding.offset);
    const length = Number(binding.length);
    if (
      binding.ordinal !== String(index) ||
      !NONNEGATIVE_INTEGER_TEXT.test(binding.offset ?? "") ||
      !POSITIVE_INTEGER_TEXT.test(binding.length ?? "") ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      length > 32 ||
      offset < previousEnd ||
      offset + length > Number(runtimeCodeLength) ||
      !["address", "bytes"].includes(binding.encoding)
    ) {
      throw new Error("reviewed immutable binding coordinates are invalid");
    }
    if (binding.source === "factory_event") {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(binding.field ?? "")) {
        throw new Error("reviewed factory-event binding is invalid");
      }
    } else if (binding.source === "constant") {
      if (
        !/^0x(?:[0-9a-f]{2})+$/u.test(binding.value ?? "") ||
        binding.value.length !== 2 + length * 2
      ) {
        throw new Error("reviewed constant binding is invalid");
      }
    } else if (binding.source === "deployed_address") {
      if (binding.encoding !== "address" || ![20, 32].includes(length)) {
        throw new Error("reviewed deployed-address binding is invalid");
      }
    } else if (binding.source === "deferred_allocation_evidence") {
      if (
        binding.encoding !== "bytes" ||
        length !== 32 ||
        !["configuration_hash", "beneficiary_count"].includes(
          binding.evidenceRole,
        )
      ) {
        throw new Error("reviewed deferred binding is invalid");
      }
      if (binding.evidenceRole === "configuration_hash") {
        deferredConfiguration += 1;
      } else {
        deferredBeneficiary += 1;
      }
    } else {
      throw new Error("reviewed immutable binding source is invalid");
    }
    previousEnd = offset + length;
  }
  if (
    (spec.factoryConfigurationField === null &&
      (deferredConfiguration !== 1 || deferredBeneficiary < 1)) ||
    (spec.factoryConfigurationField !== null &&
      (deferredConfiguration !== 0 || deferredBeneficiary !== 0))
  ) {
    throw new Error("reviewed immutable binding evidence policy is invalid");
  }
}

function validateReviewedRelease(release, index, createdAt) {
  exactObjectKeys(
    release,
    [
      "ordinal",
      "scope",
      "activationBlock",
      "epochId",
      "epochNumber",
      "epochCommitment",
      "artifactCreationCodeCommitment",
      "createInputCommitment",
      "sourceBindings",
      "dynamicSourceTemplates",
      "projectionEventRules",
      "launchCompletenessRequirements",
      "activation",
      "deploymentManifest",
    ],
    "reviewed release bootstrap",
  );
  exactObjectKeys(
    release.scope,
    ["chainId", "releaseId", "modelId", "sourceGroup"],
    "reviewed release scope",
  );
  const expectedReleaseId = EXACT_RELEASES[index];
  const expectedModel = expectedReleaseId.startsWith("classic-")
    ? "classic"
    : "stock-paired";
  if (
    release.ordinal !== index + 1 ||
    release.scope.chainId !== 1 ||
    release.scope.releaseId !== expectedReleaseId ||
    release.scope.modelId !== expectedModel ||
    release.scope.sourceGroup !== "core" ||
    !POSITIVE_INTEGER_TEXT.test(release.activationBlock ?? "") ||
    release.epochNumber !== "1" ||
    !UUID.test(release.epochId ?? "") ||
    !Array.isArray(release.sourceBindings) ||
    release.sourceBindings.length < 1 ||
    !Array.isArray(release.dynamicSourceTemplates) ||
    !Array.isArray(release.projectionEventRules) ||
    release.projectionEventRules.length < 1 ||
    !Array.isArray(release.launchCompletenessRequirements) ||
    release.launchCompletenessRequirements.length < 1
  ) {
    throw new Error("reviewed release identity is invalid");
  }
  exactObjectKeys(
    release.deploymentManifest,
    ["path", "sha256", "releaseCommit", "sourceCommitment"],
    "reviewed deployment manifest evidence",
  );
  if (
    !/^contracts\/deployments\/mainnet-[a-z0-9-]+\.json$/u.test(
      release.deploymentManifest.path ?? "",
    ) ||
    !NONZERO_BYTES32.test(release.deploymentManifest.sha256 ?? "") ||
    !/^[0-9a-f]{40}$/u.test(release.deploymentManifest.releaseCommit ?? "") ||
    !NONZERO_BYTES32.test(
      release.deploymentManifest.sourceCommitment?.toLowerCase?.() ?? "",
    )
  ) {
    throw new Error("reviewed deployment manifest evidence is invalid");
  }

  const sourceNames = new Set();
  const sourceByBindingId = new Map();
  const artifactEntries = [];
  for (const [sourceIndex, source] of release.sourceBindings.entries()) {
    exactObjectKeys(
      source,
      [
        "ordinal",
        "bindingId",
        "epochId",
        "sourceName",
        "sourceRole",
        "sourceType",
        "sourceAddress",
        "recoverySelector",
        "inclusiveStartBlock",
        "abiEventSetCommitment",
        "artifactCreationCodeCommitment",
        "artifactFileSha256",
        "artifactCreationCodeHash",
        "runtimeCodeHash",
        "deploymentEvidence",
        "bindingCommitment",
        "inputCommitment",
        "createdAt",
      ],
      "reviewed static source binding",
    );
    if (
      source.ordinal !== sourceIndex + 1 ||
      source.epochId !== release.epochId ||
      !UUID.test(source.bindingId ?? "") ||
      !IDENTIFIER.test(source.sourceName ?? "") ||
      sourceNames.has(source.sourceName) ||
      !IDENTIFIER.test(source.sourceRole ?? "") ||
      source.sourceType !== "ethereum_contract" ||
      !ADDRESS.test(source.sourceAddress ?? "") ||
      !(source.recoverySelector === null || SELECTOR.test(source.recoverySelector)) ||
      !POSITIVE_INTEGER_TEXT.test(source.inclusiveStartBlock ?? "") ||
      source.createdAt !== createdAt
    ) {
      throw new Error("reviewed static source identity is invalid");
    }
    for (const field of [
      "abiEventSetCommitment",
      "artifactCreationCodeCommitment",
      "artifactFileSha256",
      "artifactCreationCodeHash",
      "runtimeCodeHash",
      "bindingCommitment",
      "inputCommitment",
    ]) {
      canonicalNonzeroBytes32(source[field], `reviewed source ${field}`);
    }
    const bindingValue = {
      epochId: release.epochId,
      sourceName: source.sourceName,
      sourceRole: source.sourceRole,
      sourceType: source.sourceType,
      sourceAddress: source.sourceAddress,
      recoverySelector: source.recoverySelector,
      inclusiveStartBlock: source.inclusiveStartBlock,
      abiEventSetCommitment: source.abiEventSetCommitment,
      artifactCreationCodeCommitment:
        source.artifactCreationCodeCommitment,
      artifactFileSha256: source.artifactFileSha256,
      artifactCreationCodeHash: source.artifactCreationCodeHash,
      runtimeCodeHash: source.runtimeCodeHash,
    };
    if (
      source.bindingId !==
        deterministicUuid("release-source-binding", bindingValue) ||
      source.bindingCommitment !==
        exactCommitment("release-source-binding", {
          bindingId: source.bindingId,
          ...bindingValue,
        }) ||
      source.inputCommitment !==
        exactCommitment("release-source-binding-input", {
          bindingId: source.bindingId,
          ...bindingValue,
        })
    ) {
      throw new Error("reviewed static source commitment drifted");
    }
    exactObjectKeys(
      source.deploymentEvidence,
      [
        "releaseCommit",
        "sourceCommitment",
        "transactionHash",
        "deploymentBlock",
        "sourceVerificationStatus",
      ],
      "reviewed source deployment evidence",
    );
    if (
      source.deploymentEvidence.releaseCommit !==
        release.deploymentManifest.releaseCommit ||
      source.deploymentEvidence.sourceCommitment?.toLowerCase?.() !==
        release.deploymentManifest.sourceCommitment.toLowerCase() ||
      !(
        source.deploymentEvidence.transactionHash === null ||
        BYTES32.test(
          source.deploymentEvidence.transactionHash?.toLowerCase?.() ?? "",
        )
      ) ||
      !(
        source.deploymentEvidence.deploymentBlock === null ||
        (Number.isSafeInteger(source.deploymentEvidence.deploymentBlock) &&
          source.deploymentEvidence.deploymentBlock > 0)
      ) ||
      !(
        source.deploymentEvidence.sourceVerificationStatus === null ||
        IDENTIFIER.test(source.deploymentEvidence.sourceVerificationStatus)
      )
    ) {
      throw new Error("reviewed source deployment evidence drifted");
    }
    sourceNames.add(source.sourceName);
    sourceByBindingId.set(source.bindingId, source);
    artifactEntries.push({
      contractName: source.sourceName,
      artifactFileSha256: source.artifactFileSha256,
      creationCodeHash: source.artifactCreationCodeHash,
    });
  }

  const dynamicNames = new Set();
  for (const [dynamicIndex, template] of release.dynamicSourceTemplates.entries()) {
    exactObjectKeys(
      template,
      [
        "ordinal",
        "dynamicSourceTemplateId",
        "contractName",
        "epochId",
        "parentFactoryReleaseBindingId",
        "parentFactoryBindingCommitment",
        "parentSourceRole",
        "factoryEventType",
        "deployedAddressField",
        "deployedSourceRole",
        "deployedArtifactCreationCodeCommitment",
        "deployedArtifactCreationCodeHash",
        "artifactFileSha256",
        "expectedInstanceRuntimeCodeHash",
        "normalizedRuntimeCodeHash",
        "immutableReferencesCommitment",
        "immutableBindingSpec",
        "immutableBindingCommitment",
        "runtimeCodeLength",
        "abiEventSetCommitment",
        "evidencePolicy",
        "templateCommitment",
        "createdAt",
      ],
      "reviewed dynamic source template",
    );
    const parent = sourceByBindingId.get(
      template.parentFactoryReleaseBindingId,
    );
    if (
      template.ordinal !== dynamicIndex + 1 ||
      template.epochId !== release.epochId ||
      !UUID.test(template.dynamicSourceTemplateId ?? "") ||
      !IDENTIFIER.test(template.contractName ?? "") ||
      dynamicNames.has(template.contractName) ||
      !parent ||
      parent.bindingCommitment !== template.parentFactoryBindingCommitment ||
      parent.sourceRole !== template.parentSourceRole ||
      !IDENTIFIER.test(template.factoryEventType ?? "") ||
      template.deployedAddressField !== "vault" ||
      template.deployedSourceRole !== "reward_vault" ||
      template.expectedInstanceRuntimeCodeHash !== null ||
      !POSITIVE_INTEGER_TEXT.test(template.runtimeCodeLength ?? "") ||
      ![
        "factory-event-and-constants",
        "factory-event-constants-and-deferred-allocation",
      ].includes(template.evidencePolicy) ||
      template.createdAt !== createdAt
    ) {
      throw new Error("reviewed dynamic source identity is invalid");
    }
    for (const field of [
      "parentFactoryBindingCommitment",
      "deployedArtifactCreationCodeCommitment",
      "deployedArtifactCreationCodeHash",
      "artifactFileSha256",
      "normalizedRuntimeCodeHash",
      "immutableReferencesCommitment",
      "immutableBindingCommitment",
      "abiEventSetCommitment",
      "templateCommitment",
    ]) {
      canonicalNonzeroBytes32(template[field], `reviewed template ${field}`);
    }
    if (
      template.deployedArtifactCreationCodeCommitment !==
        template.deployedArtifactCreationCodeHash
    ) {
      throw new Error("reviewed dynamic creation-code evidence drifted");
    }
    validatePlanImmutableBindingSpec(
      template.immutableBindingSpec,
      template.runtimeCodeLength,
    );
    const immutableBindingCommitment = exactCommitment(
      "dynamic-immutable-binding",
      template.immutableBindingSpec,
    );
    if (template.immutableBindingCommitment !== immutableBindingCommitment) {
      throw new Error("reviewed immutable binding commitment drifted");
    }
    const dynamicValue = {
      epochId: template.epochId,
      parentFactoryReleaseBindingId:
        template.parentFactoryReleaseBindingId,
      parentFactoryBindingCommitment:
        template.parentFactoryBindingCommitment,
      parentSourceRole: template.parentSourceRole,
      factoryEventType: template.factoryEventType,
      deployedAddressField: template.deployedAddressField,
      deployedSourceRole: template.deployedSourceRole,
      deployedArtifactCreationCodeCommitment:
        template.deployedArtifactCreationCodeCommitment,
      deployedArtifactCreationCodeHash:
        template.deployedArtifactCreationCodeHash,
      artifactFileSha256: template.artifactFileSha256,
      expectedInstanceRuntimeCodeHash:
        template.expectedInstanceRuntimeCodeHash,
      normalizedRuntimeCodeHash: template.normalizedRuntimeCodeHash,
      immutableReferencesCommitment:
        template.immutableReferencesCommitment,
      immutableBindingSpec: template.immutableBindingSpec,
      immutableBindingCommitment: template.immutableBindingCommitment,
      runtimeCodeLength: template.runtimeCodeLength,
      abiEventSetCommitment: template.abiEventSetCommitment,
      evidencePolicy: template.evidencePolicy,
    };
    if (
      template.dynamicSourceTemplateId !==
        deterministicUuid("dynamic-source-template", dynamicValue) ||
      template.templateCommitment !==
        exactCommitment("dynamic-source-template", {
          dynamicSourceTemplateId: template.dynamicSourceTemplateId,
          ...dynamicValue,
        })
    ) {
      throw new Error("reviewed dynamic source commitment drifted");
    }
    dynamicNames.add(template.contractName);
    artifactEntries.push({
      contractName: template.contractName,
      artifactFileSha256: template.artifactFileSha256,
      creationCodeHash: template.deployedArtifactCreationCodeHash,
    });
  }

  const artifactCreationCodeCommitment = exactCommitment(
    "release-artifact-creation-set",
    artifactEntries.sort((left, right) =>
      left.contractName.localeCompare(right.contractName),
    ),
  );
  if (
    release.artifactCreationCodeCommitment !==
      artifactCreationCodeCommitment ||
    release.sourceBindings.some(
      (source) =>
        source.artifactCreationCodeCommitment !==
        artifactCreationCodeCommitment,
    )
  ) {
    throw new Error("reviewed release creation-code commitment drifted");
  }
  const expectedEpochId = deterministicUuid("release-epoch", {
    ...release.scope,
    epochNumber: 1,
    artifactCreationCodeCommitment,
  });
  if (release.epochId !== expectedEpochId) {
    throw new Error("reviewed release epoch identity drifted");
  }

  const ruleKeys = new Set();
  for (const [ruleIndex, rule] of release.projectionEventRules.entries()) {
    exactObjectKeys(
      rule,
      [
        "ordinal",
        "projectionEventRuleId",
        "epochId",
        "projectionKind",
        "sourceRole",
        "eventType",
        "ruleCommitment",
      ],
      "reviewed projection event rule",
    );
    const value = {
      epochId: release.epochId,
      projectionKind: rule.projectionKind,
      sourceRole: rule.sourceRole,
      eventType: rule.eventType,
    };
    const key = `${rule.sourceRole}\0${rule.eventType}`;
    if (
      rule.ordinal !== ruleIndex + 1 ||
      rule.epochId !== release.epochId ||
      !IDENTIFIER.test(rule.projectionKind ?? "") ||
      !IDENTIFIER.test(rule.sourceRole ?? "") ||
      !IDENTIFIER.test(rule.eventType ?? "") ||
      ruleKeys.has(key) ||
      rule.projectionEventRuleId !==
        deterministicUuid("projection-event-rule", value) ||
      rule.ruleCommitment !==
        exactCommitment("projection-event-rule", value)
    ) {
      throw new Error("reviewed projection event rule drifted");
    }
    ruleKeys.add(key);
  }

  for (const [requirementIndex, requirement] of
    release.launchCompletenessRequirements.entries()) {
    exactObjectKeys(
      requirement,
      [
        "ordinal",
        "launchRequirementId",
        "epochId",
        "requirementOrdinal",
        "occurrenceRole",
        "eventType",
        "requiredWhen",
        "requirementCommitment",
        "createdAt",
      ],
      "reviewed launch completeness requirement",
    );
    const value = {
      epochId: release.epochId,
      requirementOrdinal: requirementIndex,
      occurrenceRole: requirement.occurrenceRole,
      eventType: requirement.eventType,
      requiredWhen: requirement.requiredWhen,
    };
    if (
      requirement.ordinal !== requirementIndex + 1 ||
      requirement.requirementOrdinal !== requirementIndex ||
      requirement.epochId !== release.epochId ||
      !ruleKeys.has(
        `${requirement.occurrenceRole}\0${requirement.eventType}`,
      ) ||
      !["always", "reward_vault", "locked_custody", "eth_funded"].includes(
        requirement.requiredWhen,
      ) ||
      requirement.createdAt !== createdAt ||
      requirement.launchRequirementId !==
        deterministicUuid("launch-requirement", value) ||
      requirement.requirementCommitment !==
        exactCommitment("launch-requirement", value)
    ) {
      throw new Error("reviewed launch completeness requirement drifted");
    }
  }

  const epochValue = {
    scope: release.scope,
    epochId: release.epochId,
    epochNumber: release.epochNumber,
    activationBlock: release.activationBlock,
    artifactCreationCodeCommitment,
    sourceBindings: release.sourceBindings.map(
      ({ bindingCommitment }) => bindingCommitment,
    ),
    dynamicSourceTemplates: release.dynamicSourceTemplates.map(
      ({ templateCommitment }) => templateCommitment,
    ),
    projectionEventRules: release.projectionEventRules.map(
      ({ ruleCommitment }) => ruleCommitment,
    ),
    launchCompletenessRequirements:
      release.launchCompletenessRequirements.map(
        ({ requirementCommitment }) => requirementCommitment,
      ),
  };
  const epochCommitment = exactCommitment("release-epoch", epochValue);
  if (
    release.epochCommitment !== epochCommitment ||
    release.createInputCommitment !==
      exactCommitment("release-epoch-create-input", {
        ...epochValue,
        epochCommitment,
      })
  ) {
    throw new Error("reviewed release epoch commitment drifted");
  }
  exactObjectKeys(
    release.activation,
    ["expectedGeneration", "nextGeneration", "inputCommitment", "changedAt"],
    "reviewed release activation",
  );
  if (
    release.activation.expectedGeneration !== "0" ||
    release.activation.nextGeneration !== "1" ||
    release.activation.changedAt !== createdAt ||
    release.activation.inputCommitment !==
      exactCommitment("release-epoch-activation", {
        scope: release.scope,
        epochId: release.epochId,
        epochCommitment: release.epochCommitment,
        expectedGeneration: "0",
        nextGeneration: "1",
      })
  ) {
    throw new Error("reviewed release activation input drifted");
  }
}

export function validateReviewedBootstrapPlan(plan) {
  exactObjectKeys(
    plan,
    [
      "kind",
      "schemaVersion",
      "repositoryCommit",
      "createdAt",
      "catalog",
      "releaseBinding",
      "providerBindings",
      "releases",
      "candidateIsolation",
      "execution",
      "planSha256",
    ],
    "reviewed bootstrap plan",
  );
  if (
    plan.kind !== BOOTSTRAP_PLAN_KIND ||
    plan.schemaVersion !== 2 ||
    !/^[0-9a-f]{40}$/u.test(plan.repositoryCommit ?? "") ||
    !BYTES32.test(plan.planSha256 ?? "") ||
    !Array.isArray(plan.providerBindings) ||
    plan.providerBindings.length !== 4 ||
    !Array.isArray(plan.releases) ||
    plan.releases.length !== EXACT_RELEASES.length
  ) {
    throw new Error("reviewed bootstrap plan is invalid");
  }
  exactIsoTimestamp(plan.createdAt, "reviewed bootstrap creation time");
  const { planSha256, ...payload } = plan;
  if (sha256(canonicalJson(payload)) !== planSha256) {
    throw new Error("reviewed bootstrap plan commitment does not match");
  }
  exactObjectKeys(
    plan.catalog,
    ["path", "sha256", "version"],
    "reviewed bootstrap catalog evidence",
  );
  if (
    plan.catalog.path !== "config/data-pipeline-bootstrap.v1.json" ||
    !NONZERO_BYTES32.test(plan.catalog.sha256 ?? "") ||
    !IDENTIFIER.test(plan.catalog.version ?? "")
  ) {
    throw new Error("reviewed bootstrap catalog evidence is invalid");
  }
  exactObjectKeys(
    plan.releaseBinding,
    ["path", "sha256", "chainId", "startBlock", "confirmations"],
    "reviewed release binding evidence",
  );
  if (
    plan.releaseBinding.path !== "config/data-pipeline-release.v1.json" ||
    !NONZERO_BYTES32.test(plan.releaseBinding.sha256 ?? "") ||
    plan.releaseBinding.chainId !== 1 ||
    !POSITIVE_INTEGER_TEXT.test(plan.releaseBinding.startBlock ?? "") ||
    plan.releaseBinding.confirmations !== 12
  ) {
    throw new Error("reviewed release binding evidence is invalid");
  }

  for (const provider of plan.providerBindings) {
    validateReviewedProvider(provider, plan.createdAt);
  }
  const providerTypes = plan.providerBindings.map(
    ({ providerType, vendor = null }) => ({ providerType, vendor }),
  );
  if (
    canonicalJson(providerTypes) !==
      canonicalJson([
        { providerType: "envio_deployment", vendor: null },
        { providerType: "rpc_provider", vendor: "alchemy" },
        { providerType: "rpc_provider", vendor: "quicknode" },
        { providerType: "uniswap_subgraph", vendor: null },
      ]) ||
    new Set(
      plan.providerBindings.map(({ redactedIdentity }) => redactedIdentity),
    ).size !== 4
  ) {
    throw new Error("reviewed provider set is invalid");
  }
  const [candidate, alchemy, quicknode, graph] = plan.providerBindings;
  if (
    candidate.redactedIdentity !==
      plan.candidateIsolation.candidateEnvioIdentity ||
    candidate.providerDeploymentId !==
      plan.candidateIsolation.candidateEnvioProviderDeploymentId ||
    alchemy.chainId !== 1 ||
    quicknode.chainId !== 1 ||
    alchemy.redactedIdentity !== "rpc:1:alchemy" ||
    quicknode.redactedIdentity !== "rpc:1:quicknode" ||
    alchemy.constructorVersion !== "rpc-provider-v1" ||
    quicknode.constructorVersion !== "rpc-provider-v1" ||
    alchemy.endpointEvidenceDomain !== "rpc-endpoint-commitments-v1" ||
    quicknode.endpointEvidenceDomain !== "rpc-endpoint-commitments-v1" ||
    graph.redactedIdentity !==
      `uniswap-v4:ethereum:${graph.deployment}`
  ) {
    throw new Error("reviewed provider semantics are invalid");
  }

  exactObjectKeys(
    plan.candidateIsolation,
    [
      "databaseMode",
      "candidateEvidencePath",
      "candidateEvidenceSha256",
      "candidateAuditEvidenceCommitment",
      "candidatePolicyCommitment",
      "candidateSourceCommit",
      "candidateEnvioIdentity",
      "candidateEnvioProviderDeploymentId",
      "candidateInitializationInputCommitment",
      "legacyProductionEnvioIdentity",
      "legacyProductionDeploymentRegistered",
      "publicationAllowedBeforePromotion",
      "promotionPolicy",
      "reason",
    ],
    "reviewed candidate database isolation",
  );
  if (
    plan.candidateIsolation.databaseMode !== "candidate-only" ||
    plan.candidateIsolation.candidateEvidencePath !==
      "config/data-pipeline-envio-candidate.v1.json" ||
    !NONZERO_BYTES32.test(
      plan.candidateIsolation.candidateEvidenceSha256 ?? "",
    ) ||
    !NONZERO_BYTES32.test(
      plan.candidateIsolation.candidateAuditEvidenceCommitment ?? "",
    ) ||
    !NONZERO_BYTES32.test(
      plan.candidateIsolation.candidatePolicyCommitment ?? "",
    ) ||
    !/^[0-9a-f]{40}$/u.test(
      plan.candidateIsolation.candidateSourceCommit ?? "",
    ) ||
    !/^envio:[a-z0-9][a-z0-9-]{0,127}$/u.test(
      plan.candidateIsolation.legacyProductionEnvioIdentity ?? "",
    ) ||
    plan.candidateIsolation.legacyProductionEnvioIdentity ===
      candidate.redactedIdentity ||
    plan.candidateIsolation.legacyProductionDeploymentRegistered !== false ||
    plan.candidateIsolation.publicationAllowedBeforePromotion !== false ||
    plan.candidateIsolation.promotionPolicy !==
      "atomic-attestation-then-vercel-cutover" ||
    plan.candidateIsolation.reason !==
      "provider-neutral candidate identifiers are safe only because this database contains exactly one Envio deployment before promotion"
  ) {
    throw new Error("reviewed candidate database isolation is invalid");
  }
  const candidateInitializationInputCommitment = exactCommitment(
    "candidate-database-initialization",
    {
      providerDeploymentId: candidate.providerDeploymentId,
      deploymentCommitment: candidate.deploymentCommitment,
      schemaCommitment: candidate.schemaCommitment,
      evidencePath: plan.candidateIsolation.candidateEvidencePath,
      evidenceFileSha256:
        plan.candidateIsolation.candidateEvidenceSha256,
      auditEvidenceCommitment:
        plan.candidateIsolation.candidateAuditEvidenceCommitment,
      policyCommitment:
        plan.candidateIsolation.candidatePolicyCommitment,
      sourceCommit: plan.candidateIsolation.candidateSourceCommit,
      initializedAt: plan.createdAt,
    },
  );
  if (
    plan.candidateIsolation.candidateInitializationInputCommitment !==
      candidateInitializationInputCommitment
  ) {
    throw new Error("reviewed candidate initialization input drifted");
  }

  plan.releases.forEach((release, index) =>
    validateReviewedRelease(release, index, plan.createdAt),
  );

  exactObjectKeys(
    plan.execution,
    [
      "mode",
      "targetDatabaseMode",
      "ready",
      "exactReplayOnlyAfterFirstApply",
      "mixedGenerationPolicy",
      "expectedProductGenerations",
      "runtimeStartGate",
    ],
    "reviewed bootstrap execution gate",
  );
  if (
    plan.execution.mode !== "reviewed-atomic-bootstrap" ||
    plan.execution.targetDatabaseMode !== "candidate-only" ||
    plan.execution.ready !== true ||
    plan.execution.exactReplayOnlyAfterFirstApply !== true ||
    plan.execution.mixedGenerationPolicy !== "reject" ||
    plan.execution.runtimeStartGate !==
      "separate-dual-rpc-genesis-evidence-required" ||
    !Array.isArray(plan.execution.expectedProductGenerations) ||
    canonicalJson(plan.execution.expectedProductGenerations) !==
      canonicalJson(
        plan.releases.map(({ scope }) => ({
          ...scope,
          before: "0",
          after: "1",
        })),
      )
  ) {
    throw new Error("reviewed bootstrap execution gate is invalid");
  }
  return plan;
}
