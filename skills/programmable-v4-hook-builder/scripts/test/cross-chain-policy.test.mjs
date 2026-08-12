import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  analyzeSubmission,
  validateAgainstSchema
} from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const template = JSON.parse(fs.readFileSync(path.join(skillRoot, "assets", "templates", "submission.example.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "submission.schema.json"), "utf8"));

test("proposal may leave cross-chain architecture unresolved without becoming schema-invalid", () => {
  const submission = crossChainSubmission({ stage: "proposal", complete: false });

  const schemaFindings = validateAgainstSchema(submission, schema);
  const report = analyzeSubmission(submission, { schema });

  assert.deepEqual(
    schemaFindings.filter(({ path: findingPath }) => findingPath.startsWith("$.capabilities.crossChain")),
    []
  );
  assert.ok(report.findings.some(({ code }) => code === "CROSS_CHAIN_POLICY_INCOMPLETE"));
});

test("complete cross-chain prototype profile passes its structural security preflight", () => {
  const report = analyzeSubmission(crossChainSubmission(), { schema });

  assert.deepEqual(crossChainFindings(report), [], JSON.stringify(crossChainFindings(report)));
  assert.ok(report.risk.featureTriggers.includes("cross-chain"));
  assert.ok(report.requiredGates.some(({ id }) => id === "cross-chain-replay-finality-and-failure-tests"));
  assert.ok(report.requiredGates.some(({ id }) => id === "bridge-and-cross-domain-review"));
});

test("complete profile accepts a canonical non-EVM source network and sender", () => {
  const submission = crossChainSubmission();
  submission.capabilities.crossChain.source = {
    network: {
      namespace: "solana",
      reference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    },
    domain: "solana-mainnet",
    authenticatedSender: {
      encoding: "base58",
      value: "Vote111111111111111111111111111111111111111",
      canonicalizationRule: null
    }
  };

  const schemaFindings = validateAgainstSchema(submission, schema);
  const report = analyzeSubmission(submission, { schema });

  assert.deepEqual(
    schemaFindings.filter(({ path: findingPath }) => findingPath.startsWith("$.capabilities.crossChain")),
    []
  );
  assert.deepEqual(crossChainFindings(report), [], JSON.stringify(crossChainFindings(report)));
  assert.ok(report.risk.featureTriggers.includes("cross-chain"));
});

test("outbound launch-chain routes may target a canonical non-EVM network", () => {
  const submission = crossChainSubmission();
  submission.capabilities.crossChain.direction = "outbound-from-launch-chain";
  submission.capabilities.crossChain.source = {
    network: { namespace: "eip155", reference: "1" },
    domain: "ethereum-mainnet",
    authenticatedSender: {
      encoding: "evm-address",
      value: address("3"),
      canonicalizationRule: null
    }
  };
  submission.capabilities.crossChain.destination = {
    network: {
      namespace: "solana",
      reference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    },
    domain: "solana-mainnet",
    receiver: {
      encoding: "base58",
      value: "Vote111111111111111111111111111111111111111",
      canonicalizationRule: null
    }
  };

  const report = analyzeSubmission(submission, { schema });

  assert.deepEqual(crossChainFindings(report), [], JSON.stringify(crossChainFindings(report)));
  assert.ok(report.requiredGates.some(({ id }) => id === "bridge-and-cross-domain-review"));
});

test("bridge domain identifiers may be short canonical values", () => {
  const submission = crossChainSubmission();
  submission.capabilities.crossChain.source.domain = "10";
  submission.capabilities.crossChain.destination.domain = "1";

  const report = analyzeSubmission(submission, { schema });

  assert.deepEqual(crossChainFindings(report), [], JSON.stringify(crossChainFindings(report)));
});

test("provider names and declared risk triggers cannot disable cross-chain review", async (t) => {
  for (const providerText of ["Wormhole VAA", "LayerZero EndpointV2"]) {
    await t.test(providerText, () => {
      const submission = crossChainSubmission();
      submission.model.summary = `Consume one authenticated ${providerText} before updating pool state.`;
      submission.capabilities.crossChain = unresolvedCrossChainPolicy();
      submission.capabilities.crossChain.used = false;
      submission.dependencies.onchain = [];
      submission.risk.featureTriggers = [];

      assertFinding(
        submission,
        "CROSS_CHAIN_PROFILE_MISMATCH",
        "$.capabilities.crossChain.used"
      );
    });
  }

  await t.test("declared cross-chain trigger", () => {
    const submission = crossChainSubmission();
    submission.model.summary = "Consume one authenticated remote message before updating pool state.";
    submission.capabilities.crossChain = unresolvedCrossChainPolicy();
    submission.capabilities.crossChain.used = false;
    submission.dependencies.onchain = [];
    submission.risk.featureTriggers = ["cross-chain"];

    assertFinding(
      submission,
      "CROSS_CHAIN_PROFILE_MISMATCH",
      "$.capabilities.crossChain.used"
    );
  });
});

test("cross-chain prototype binds one pinned onchain bridge dependency", async (t) => {
  await t.test("missing dependency id", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.localBridgeDependencyId = "missing-bridge";

    assertFinding(submission, "CROSS_CHAIN_BRIDGE_DEPENDENCY_UNBOUND", "$.capabilities.crossChain.localBridgeDependencyId");
  });

  await t.test("offchain record cannot stand in for the destination bridge contract", () => {
    const submission = crossChainSubmission();
    const dependencyIndex = submission.dependencies.onchain.findIndex(({ id }) => id === "canonical-bridge-caller");
    submission.dependencies.offchain.push(...submission.dependencies.onchain.splice(dependencyIndex, 1));

    assertFinding(submission, "CROSS_CHAIN_BRIDGE_DEPENDENCY_NOT_ONCHAIN", "$.capabilities.crossChain.localBridgeDependencyId");
  });

  await t.test("unpinned bridge source is rejected", () => {
    const submission = crossChainSubmission();
    submission.dependencies.onchain.find(({ id }) => id === "canonical-bridge-caller").revision = null;

    assertFinding(submission, "CROSS_CHAIN_BRIDGE_DEPENDENCY_UNPINNED", "$.capabilities.crossChain.localBridgeDependencyId");
  });

  await t.test("mutable package tag is not immutable source evidence", () => {
    const submission = crossChainSubmission();
    const dependency = submission.dependencies.onchain.find(({ id }) => id === "canonical-bridge-caller");
    dependency.revision = null;
    dependency.packageVersion = "latest";

    assertFinding(submission, "CROSS_CHAIN_BRIDGE_DEPENDENCY_UNPINNED", "$.capabilities.crossChain.localBridgeDependencyId");
  });

  await t.test("local bridge address must match its pinned deployment", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.localBridgeAddress = address("9");

    assertFinding(submission, "CROSS_CHAIN_BRIDGE_CALLER_MISMATCH", "$.capabilities.crossChain.localBridgeAddress");
  });
});

test("cross-chain prototype rejects the wrong source, sender, destination or domain", async (t) => {
  await t.test("source and destination chain are the same", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.source.network = {
      namespace: "eip155",
      reference: "1"
    };

    assertFinding(submission, "CROSS_CHAIN_SOURCE_DESTINATION_CONFLICT", "$.capabilities.crossChain.source.network");
  });

  await t.test("inbound destination differs from the launch target", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.destination.network.reference = "8453";

    assertFinding(submission, "CROSS_CHAIN_LOCAL_ENDPOINT_MISMATCH", "$.capabilities.crossChain.destination.network");
  });

  await t.test("local bridge differs from the pinned bridge address", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.localBridgeAddress = address("9");

    assertFinding(submission, "CROSS_CHAIN_BRIDGE_CALLER_MISMATCH", "$.capabilities.crossChain.localBridgeAddress");
  });

  await t.test("source network namespace is not a valid CAIP-2 namespace", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.source.network.namespace = "EIP_155";

    assertFinding(submission, "SCHEMA_PATTERN", "$.capabilities.crossChain.source.network.namespace");
  });

  for (const reference of ["0", "01", "+1", "0x1"]) {
    await t.test(`destination eip155 reference ${reference} is not canonical`, () => {
      const submission = crossChainSubmission();
      submission.capabilities.crossChain.destination.network.reference = reference;

      assertFinding(
        submission,
        "CROSS_CHAIN_DESTINATION_NETWORK_INVALID",
        "$.capabilities.crossChain.destination.network.reference"
      );
    });
  }

  await t.test("source sender value does not match its declared encoding", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.source.authenticatedSender = {
      encoding: "bytes32",
      value: address("2")
    };

    assertFinding(submission, "CROSS_CHAIN_SOURCE_SENDER_ENCODING_INVALID", "$.capabilities.crossChain.source.authenticatedSender.value");
  });

  await t.test("bridge-native sender identifier contains whitespace", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.source.authenticatedSender = {
      encoding: "bridge-native",
      value: "sender with spaces"
    };

    assertFinding(submission, "CROSS_CHAIN_SOURCE_SENDER_ENCODING_INVALID", "$.capabilities.crossChain.source.authenticatedSender.value");
  });

  for (const field of ["sourceNetwork", "sourceDomain", "sourceSender", "destinationNetwork", "destinationDomain", "payloadHash", "timestampOrExpiry"]) {
    await t.test(`${field} is not authenticated`, () => {
      const submission = crossChainSubmission();
      submission.capabilities.crossChain.message.domainBindings[field] = false;

      assertFinding(
        submission,
        "CROSS_CHAIN_DOMAIN_BINDING_INCOMPLETE",
        `$.capabilities.crossChain.message.domainBindings.${field}`
      );
    });
  }
});

test("cross-chain prototype rejects replay and duplicate-message gaps", async (t) => {
  await t.test("message identity has no nonce derivation", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.message.nonceDerivation = null;

    assertFinding(submission, "CROSS_CHAIN_MESSAGE_POLICY_INCOMPLETE", "$.capabilities.crossChain.message.nonceDerivation");
  });

  await t.test("idempotency state is not consumed atomically", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.message.atomicConsumption = false;

    assertFinding(submission, "CROSS_CHAIN_REPLAY_NOT_ATOMIC", "$.capabilities.crossChain.message.atomicConsumption");
  });

  await t.test("duplicate behavior is unresolved", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.message.duplicateBehavior = null;

    assertFinding(submission, "CROSS_CHAIN_MESSAGE_POLICY_INCOMPLETE", "$.capabilities.crossChain.message.duplicateBehavior");
  });
});

test("cross-chain prototype rejects weak finality, delayed messages and unbounded ordering", async (t) => {
  await t.test("optimistic route has no challenge period", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.finality.mode = "optimistic-challenge-window";
    submission.capabilities.crossChain.finality.challengePeriodSeconds = 0;

    assertFinding(submission, "CROSS_CHAIN_FINALITY_WINDOW_INVALID", "$.capabilities.crossChain.finality.challengePeriodSeconds");
  });

  await t.test("reorg behavior is unresolved", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.finality.reorgBehavior = null;

    assertFinding(submission, "CROSS_CHAIN_FINALITY_POLICY_INCOMPLETE", "$.capabilities.crossChain.finality.reorgBehavior");
  });

  await t.test("delayed-message bound is unresolved", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.staleness.maximumMessageAgeSeconds = null;

    assertFinding(submission, "CROSS_CHAIN_STALENESS_POLICY_INCOMPLETE", "$.capabilities.crossChain.staleness.maximumMessageAgeSeconds");
  });

  await t.test("out-of-order queue is unbounded", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.ordering.maximumPendingMessages = 0;

    assertFinding(submission, "CROSS_CHAIN_ORDERING_BOUND_INVALID", "$.capabilities.crossChain.ordering.maximumPendingMessages");
  });

  for (const field of ["queueOverflowBehavior", "cleanupRule", "releaseRule"]) {
    await t.test(`bounded queue leaves ${field} unresolved`, () => {
      const submission = crossChainSubmission();
      submission.capabilities.crossChain.ordering[field] = null;

      assertFinding(
        submission,
        "CROSS_CHAIN_ORDERING_POLICY_INCOMPLETE",
        `$.capabilities.crossChain.ordering.${field}`
      );
    });
  }

  await t.test("pending messages do not expire", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.ordering.pendingMessageExpirySeconds = 0;

    assertFinding(
      submission,
      "CROSS_CHAIN_ORDERING_EXPIRY_INVALID",
      "$.capabilities.crossChain.ordering.pendingMessageExpirySeconds"
    );
  });

  await t.test("unordered mode cannot declare an out-of-order queue", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.ordering.mode = "unordered-idempotent";

    assertFinding(
      submission,
      "CROSS_CHAIN_ORDERING_MODE_CONFLICT",
      "$.capabilities.crossChain.ordering"
    );
  });
});

test("cross-chain quarantine has bounded storage, expiry and release semantics", async (t) => {
  for (const [name, configure] of [
    ["failure quarantine", (policy) => { policy.failureBehavior = "quarantine-no-execution"; }],
    ["stale-message quarantine", (policy) => { policy.staleness.staleMessageBehavior = "quarantine-no-execution"; }],
    ["reorg reconciliation", (policy) => { policy.finality.reorgBehavior = "pause-and-reconcile-without-execution"; }],
    ["fallback reconciliation", (policy) => { policy.fallback.mode = "manual-reconciliation-no-execution"; }]
  ]) {
    await t.test(`${name} cannot leave quarantine disabled`, () => {
      const submission = crossChainSubmission();
      configure(submission.capabilities.crossChain);

      assertFinding(
        submission,
        "CROSS_CHAIN_QUARANTINE_PROFILE_MISMATCH",
        "$.capabilities.crossChain.quarantine.used"
      );
    });
  }

  await t.test("required quarantine usage cannot remain unresolved", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.failureBehavior = "quarantine-no-execution";
    submission.capabilities.crossChain.quarantine.used = null;

    assertFinding(
      submission,
      "CROSS_CHAIN_QUARANTINE_USAGE_UNRESOLVED",
      "$.capabilities.crossChain.quarantine.used"
    );
  });

  await t.test("quarantine storage is unbounded", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.failureBehavior = "quarantine-no-execution";
    submission.capabilities.crossChain.quarantine = completeQuarantinePolicy();
    submission.capabilities.crossChain.quarantine.maximumEntries = 0;

    assertFinding(
      submission,
      "CROSS_CHAIN_QUARANTINE_BOUND_INVALID",
      "$.capabilities.crossChain.quarantine.maximumEntries"
    );
  });

  await t.test("quarantine entries never expire", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.failureBehavior = "quarantine-no-execution";
    submission.capabilities.crossChain.quarantine = completeQuarantinePolicy();
    submission.capabilities.crossChain.quarantine.entryExpirySeconds = 0;

    assertFinding(
      submission,
      "CROSS_CHAIN_QUARANTINE_EXPIRY_INVALID",
      "$.capabilities.crossChain.quarantine.entryExpirySeconds"
    );
  });

  await t.test("quarantine release is not atomic", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.failureBehavior = "quarantine-no-execution";
    submission.capabilities.crossChain.quarantine = completeQuarantinePolicy();
    submission.capabilities.crossChain.quarantine.atomicRelease = false;

    assertFinding(
      submission,
      "CROSS_CHAIN_QUARANTINE_RELEASE_NOT_ATOMIC",
      "$.capabilities.crossChain.quarantine.atomicRelease"
    );
  });

  await t.test("retry cannot use the expiry-cleanup authority", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.failureBehavior = "quarantine-no-execution";
    submission.capabilities.crossChain.quarantine = completeQuarantinePolicy();
    submission.capabilities.crossChain.quarantine.releaseAuthority = "permissionless-expiry-cleanup";

    assertFinding(
      submission,
      "CROSS_CHAIN_QUARANTINE_RELEASE_AUTHORITY_CONFLICT",
      "$.capabilities.crossChain.quarantine.releaseAuthority"
    );
  });
});

test("custom cross-chain identities and domains require explicit derivation and candidate review", async (t) => {
  await t.test("bridge-native sender lacks canonicalization", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.source.authenticatedSender = {
      encoding: "bridge-native",
      value: "wormhole:sender:canonical",
      canonicalizationRule: null
    };

    assertFinding(
      submission,
      "CROSS_CHAIN_SOURCE_SENDER_CANONICALIZATION_MISSING",
      "$.capabilities.crossChain.source.authenticatedSender.canonicalizationRule"
    );
  });

  await t.test("custom nonce scope lacks derivation", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.message.nonceScope = "custom-reviewed";
    submission.capabilities.crossChain.message.customNonceRule = null;

    assertFinding(
      submission,
      "CROSS_CHAIN_CUSTOM_NONCE_RULE_MISSING",
      "$.capabilities.crossChain.message.customNonceRule"
    );
  });

  await t.test("custom finality lacks a rule", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.finality.mode = "custom-reviewed";
    submission.capabilities.crossChain.finality.customFinalityRule = null;

    assertFinding(
      submission,
      "CROSS_CHAIN_CUSTOM_FINALITY_RULE_MISSING",
      "$.capabilities.crossChain.finality.customFinalityRule"
    );
  });

  await t.test("custom timestamp lacks a derivation", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.staleness.timestampSource = "custom-reviewed";
    submission.capabilities.crossChain.staleness.customTimestampRule = null;

    assertFinding(
      submission,
      "CROSS_CHAIN_CUSTOM_TIMESTAMP_RULE_MISSING",
      "$.capabilities.crossChain.staleness.customTimestampRule"
    );
  });

  await t.test("complete custom rules require their dedicated candidate reviews", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.source.authenticatedSender = {
      encoding: "bridge-native",
      value: "wormhole:sender:canonical",
      canonicalizationRule: "Decode the reviewed bridge emitter bytes and preserve the exact 32-byte value without text normalization."
    };
    submission.capabilities.crossChain.message.nonceScope = "custom-reviewed";
    submission.capabilities.crossChain.message.customNonceRule = "Hash the bridge version, source network, source domain, canonical sender, channel and unsigned 64-bit source nonce.";
    submission.capabilities.crossChain.finality.mode = "custom-reviewed";
    submission.capabilities.crossChain.finality.customFinalityRule = "Accept only the reviewed bridge quorum after its source-finality delay, then reject any conflicting reorg evidence.";
    submission.capabilities.crossChain.staleness.timestampSource = "custom-reviewed";
    submission.capabilities.crossChain.staleness.customTimestampRule = "Decode the authenticated unsigned source timestamp in seconds and compare it with destination block time using the declared skew.";

    const report = analyzeSubmission(submission, { schema });
    const candidateGateIds = new Set(
      report.requiredGates
        .filter(({ stage }) => stage === "candidate")
        .map(({ id }) => id)
    );

    assert.deepEqual(crossChainFindings(report), [], JSON.stringify(crossChainFindings(report)));
    for (const gateId of [
      "custom-cross-chain-source-identity-review",
      "custom-cross-chain-nonce-review",
      "custom-cross-chain-finality-review",
      "custom-cross-chain-timestamp-review"
    ]) {
      assert.ok(candidateGateIds.has(gateId), gateId);
    }
  });
});

test("cross-chain fallback cannot introduce an undeclared authority", async (t) => {
  await t.test("fail-closed route names an administrator", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.fallback.authority = "bridge-admin";

    assertFinding(submission, "CROSS_CHAIN_FALLBACK_AUTHORITY_CONFLICT", "$.capabilities.crossChain.fallback.authority");
  });

  await t.test("pause route names a role absent from declared authorities", () => {
    const submission = crossChainSubmission();
    submission.capabilities.crossChain.fallback.mode = "pause-cross-chain-path";
    submission.capabilities.crossChain.fallback.authority = "bridge-admin";

    assertFinding(submission, "CROSS_CHAIN_FALLBACK_AUTHORITY_UNBOUND", "$.capabilities.crossChain.fallback.authority");
  });
});

function crossChainSubmission({ stage = "prototype", complete = true } = {}) {
  const submission = structuredClone(template);
  submission.stage = stage;
  submission.model.summary = "Consume one authenticated cross-chain bridge message before recording pool-scoped state.";
  submission.model.whyV4 = "The admitted message changes only the exact canonical PoolId after destination authentication and replay checks.";
  submission.dependencies.onchain = [bridgeCallerDependency()];
  submission.capabilities.crossChain = complete ? completeCrossChainPolicy() : unresolvedCrossChainPolicy();
  submission.risk.featureTriggers = ["cross-chain"];
  return submission;
}

function completeCrossChainPolicy() {
  return {
    used: true,
    direction: "inbound-to-launch-chain",
    localBridgeDependencyId: "canonical-bridge-caller",
    localBridgeAddress: address("1"),
    source: {
      network: {
        namespace: "eip155",
        reference: "10"
      },
      domain: "optimism-mainnet",
      authenticatedSender: {
        encoding: "evm-address",
        value: address("2"),
        canonicalizationRule: null
      }
    },
    destination: {
      network: {
        namespace: "eip155",
        reference: "1"
      },
      domain: "ethereum-mainnet",
      receiver: {
        encoding: "evm-address",
        value: address("3"),
        canonicalizationRule: null
      }
    },
    message: {
      identifierDerivation: "keccak256 of source chain, source domain, authenticated sender, nonce and payload hash.",
      nonceDerivation: "The bridge-authenticated source nonce is scoped to the exact sender and channel.",
      nonceScope: "per-source-sender-and-channel",
      customNonceRule: null,
      payloadHashRule: "Hash the exact ABI-encoded action, model version, PoolId, recipient, value bounds and expiry.",
      idempotencyKeyRule: "Use keccak256 of bridge dependency, source identity, destination identity, message identifier and nonce.",
      idempotencyStorage: "Store each consumed idempotency key before the destination action makes any external call.",
      atomicConsumption: true,
      duplicateBehavior: "ignore-after-authentication",
      domainBindings: {
        localBridgeDependencyId: true,
        sourceNetwork: true,
        sourceDomain: true,
        sourceSender: true,
        destinationNetwork: true,
        destinationDomain: true,
        destinationReceiver: true,
        modelId: true,
        poolId: true,
        action: true,
        payloadHash: true,
        timestampOrExpiry: true,
        messageId: true,
        nonce: true
      }
    },
    finality: {
      mode: "source-finalized",
      minimumSourceConfirmations: 64,
      challengePeriodSeconds: 0,
      attestationRule: "The pinned destination bridge verifies source finality and the exact authenticated sender before delivery.",
      reorgBehavior: "reject-unfinalized",
      customFinalityRule: null
    },
    ordering: {
      mode: "per-key-sequential",
      sequenceKey: "Source chain, source domain, authenticated sender and channel form one independent sequence.",
      outOfOrderBehavior: "queue-bounded",
      maximumPendingMessages: 32,
      queueOverflowBehavior: "reject-new",
      pendingMessageExpirySeconds: 3600,
      cleanupRule: "Permissionless cleanup removes only authenticated entries whose bounded expiry has passed.",
      releaseRule: "Release only the next expected authenticated nonce before expiry after all destination checks are repeated."
    },
    staleness: {
      timestampSource: "bridge-attested-source-time",
      customTimestampRule: null,
      maximumMessageAgeSeconds: 3600,
      maximumFutureSkewSeconds: 60,
      staleMessageBehavior: "revert"
    },
    failureBehavior: "revert-no-state-change",
    failureRule: "Any authentication, finality, ordering, freshness or execution failure reverts without consuming value or partial state.",
    fallback: {
      mode: "none-fail-closed",
      authority: "none",
      rule: "No alternate bridge or unauthenticated delivery path exists; a new route requires a new reviewed model version."
    },
    quarantine: {
      used: false,
      storageRule: null,
      maximumEntries: null,
      entryExpirySeconds: null,
      overflowBehavior: null,
      cleanupRule: null,
      releaseMode: null,
      releaseRule: null,
      releaseAuthority: null,
      atomicRelease: null
    }
  };
}

function completeQuarantinePolicy() {
  return {
    used: true,
    storageRule: "Store only authenticated message ids, expiry, failure code and payload hash in one bounded PoolId-scoped quarantine.",
    maximumEntries: 64,
    entryExpirySeconds: 86400,
    overflowBehavior: "reject-new",
    cleanupRule: "Permissionless cleanup removes only expired entries and cannot execute or redirect their payload.",
    releaseMode: "revalidate-and-retry",
    releaseRule: "Retry only before expiry after repeating bridge caller, source, domain, payload, ordering, replay and finality checks.",
    releaseAuthority: "permissionless-after-revalidation",
    atomicRelease: true
  };
}

function unresolvedCrossChainPolicy() {
  const policy = completeCrossChainPolicy();
  policy.direction = null;
  policy.localBridgeDependencyId = null;
  policy.localBridgeAddress = null;
  policy.source = {
    network: { namespace: null, reference: null },
    domain: null,
    authenticatedSender: { encoding: null, value: null, canonicalizationRule: null }
  };
  policy.destination = {
    network: { namespace: null, reference: null },
    domain: null,
    receiver: { encoding: null, value: null, canonicalizationRule: null }
  };
  for (const key of Object.keys(policy.message)) {
    policy.message[key] = key === "domainBindings"
      ? Object.fromEntries(Object.keys(policy.message.domainBindings).map((field) => [field, null]))
      : null;
  }
  policy.finality = {
    mode: null,
    minimumSourceConfirmations: null,
    challengePeriodSeconds: null,
    attestationRule: null,
    reorgBehavior: null,
    customFinalityRule: null
  };
  policy.ordering = {
    mode: null,
    sequenceKey: null,
    outOfOrderBehavior: null,
    maximumPendingMessages: null,
    queueOverflowBehavior: null,
    pendingMessageExpirySeconds: null,
    cleanupRule: null,
    releaseRule: null
  };
  policy.staleness = {
    timestampSource: null,
    customTimestampRule: null,
    maximumMessageAgeSeconds: null,
    maximumFutureSkewSeconds: null,
    staleMessageBehavior: null
  };
  policy.failureBehavior = null;
  policy.failureRule = null;
  policy.fallback = { mode: null, authority: null, rule: null };
  policy.quarantine = {
    used: null,
    storageRule: null,
    maximumEntries: null,
    entryExpirySeconds: null,
    overflowBehavior: null,
    cleanupRule: null,
    releaseMode: null,
    releaseRule: null,
    releaseAuthority: null,
    atomicRelease: null
  };
  return policy;
}

function bridgeCallerDependency() {
  return {
    id: "canonical-bridge-caller",
    name: "Canonical bridge caller",
    kind: "authenticated destination bridge caller",
    repository: "https://github.com/example/canonical-bridge.git",
    revision: "1".repeat(40),
    packageVersion: null,
    license: "MIT",
    sourceProvenance: "pinned-source",
    deploymentRecordId: "canonical-bridge-caller-ethereum",
    chainAddress: address("1"),
    runtimeHash: `0x${"a".repeat(64)}`,
    deploymentEvidencePath: "models/cross-chain/evidence/bridge-deployment.json",
    trust: "The exact authenticated bridge caller, runtime and pinned source revision are checked before prototype review.",
    failure: "A missing or mismatched bridge caller blocks the destination action and leaves state unchanged.",
    fallback: "No alternate bridge caller is selected automatically."
  };
}

function receiverDependency() {
  return {
    id: "cross-chain-receiver",
    name: "Cross-chain receiver",
    kind: "destination message receiver",
    repository: "https://github.com/example/cross-chain-receiver.git",
    revision: "2".repeat(40),
    packageVersion: null,
    license: "MIT",
    sourceProvenance: "pinned-source",
    deploymentRecordId: "cross-chain-receiver-ethereum",
    chainAddress: address("3"),
    runtimeHash: `0x${"b".repeat(64)}`,
    deploymentEvidencePath: "models/cross-chain/evidence/receiver-deployment.json",
    trust: "The exact destination receiver, runtime and pinned source revision are checked before prototype review.",
    failure: "A missing or mismatched receiver blocks message delivery and leaves state unchanged.",
    fallback: "No alternate receiver is selected automatically."
  };
}

function crossChainFindings(report) {
  return report.findings.filter(({ code }) => code.startsWith("CROSS_CHAIN_"));
}

function assertFinding(submission, code, findingPath) {
  const report = analyzeSubmission(submission, { schema });
  assert.ok(
    report.findings.some((finding) => finding.code === code && finding.path === findingPath),
    JSON.stringify(crossChainFindings(report))
  );
}

function address(character) {
  return `0x${character.repeat(40)}`;
}
