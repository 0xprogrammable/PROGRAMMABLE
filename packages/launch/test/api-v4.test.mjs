import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ProgrammableApiError,
  statusLaunch,
  submitLaunch,
  validateLaunchRemote,
} from "../src/api-client.mjs";
import { sha256Digest, sha256Hex } from "../src/io.mjs";
import { canonicalizeJson } from "../src/canonical-json.mjs";
import {
  V4_API_KEY,
  V4_LAUNCH_ID,
  V4_REQUEST_ID,
  jsonResponse,
  validAdmissionReceiptV4,
  validCoordinatedGraphSubstitutionV4,
  validExternalContractEvidenceReceiptV4,
  validExactWalletTransaction,
  validPreparedArtifactV4,
  validSimulationReceiptV4,
  validV4Capabilities,
  validV4Preflight,
  validV4ProjectMetadata,
  validV4Request,
  validV4Resource,
  validV4SourceVerificationStatus,
  v4RequestBytes,
} from "./fixtures/v4.mjs";

const API_ORIGIN = "https://api.programmable.market";
const CAPABILITIES_URL = `${API_ORIGIN}/v4/chains/4663/capabilities`;
const CREATE_URL = `${API_ORIGIN}/v4/chains/4663/custom-launches`;
const PREFLIGHT_URL = `${CREATE_URL}/preflight`;
const STATUS_URL = `${CREATE_URL}/${V4_LAUNCH_ID}`;

test("V4 remote validation fetches unauthenticated chain capabilities before the API key", async () => {
  const request = requestWithWalletContract();
  const requestBytes = v4RequestBytes(request);
  const events = [];
  const calls = [];
  const result = await validateLaunchRemote({
    launchPath: "/does/not/need/to-exist-v4.json",
    configPath: "/does/not/need/to-exist-v4.config.json",
    maxAttempts: 1,
    readLaunchBytesImpl: async () => requestBytes,
    validateLaunchFileImpl: async () => ({
      schemaVersion: request.schemaVersion,
      requestSha256: sha256Digest(requestBytes),
      reproducedFromConfig: true,
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      events.push(`fetch:${url}`);
      if (url === CAPABILITIES_URL) return jsonResponse(validV4Capabilities());
      if (url === PREFLIGHT_URL) return jsonResponse(validV4Preflight(request, requestBytes));
      throw new Error(`unexpected URL ${url}`);
    },
    loadApiKeyImpl: async () => {
      events.push("key");
      return V4_API_KEY;
    },
  });

  assert.deepEqual(events, [`fetch:${CAPABILITIES_URL}`, "key", `fetch:${PREFLIGHT_URL}`]);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(Object.hasOwn(calls[0].options.headers, "authorization"), false);
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.authorization, `Bearer ${V4_API_KEY}`);
  assert.deepEqual(Buffer.from(calls[1].options.body), requestBytes);
  assert.equal(result.apiVersion, "v4");
  assert.equal(result.preflight.chainId, "4663");
  assert.equal(result.preflight.quotaConsumed, false);
  assert.equal(result.preflight.persisted, false);
  assert.equal(result.preflight.walletBroadcastByService, false);
  assert.equal(JSON.stringify(result).includes(V4_API_KEY), false);
});

test("V4 submit journals exact bytes and uses a domain-separated idempotency key across retryable 503", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-v4-submit-"));
  try {
    const request = requestWithWalletContract();
    const requestBytes = v4RequestBytes(request);
    const submitCalls = [];
    const sleeps = [];
    const result = await submitLaunch({
      launchPath: path.join(root, "launch.json"),
      configPath: path.join(root, "config.json"),
      stateDirectory: path.join(root, "state"),
      maxAttempts: 2,
      readLaunchBytesImpl: async () => requestBytes,
      validateLaunchFileImpl: v4Validation(request, requestBytes),
      loadApiKeyImpl: async () => V4_API_KEY,
      sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
      fetchImpl: async (url, options) => {
        if (url === CAPABILITIES_URL) return jsonResponse(validV4Capabilities());
        assert.equal(url, CREATE_URL);
        submitCalls.push({
          body: Buffer.from(options.body),
          idempotencyKey: options.headers["idempotency-key"],
        });
        if (submitCalls.length === 1) {
          return jsonResponse({
            error: { code: "UPSTREAM_BUSY", retryable: true },
          }, { status: 503, headers: { "retry-after": "7" } });
        }
        return jsonResponse(validV4Resource(request, requestBytes), { status: 202 });
      },
    });

    const expectedKey = `programmable-v4-${sha256Hex(requestBytes)}`;
    assert.equal(result.idempotencyKey, expectedKey);
    assert.equal(result.apiVersion, "v4");
    assert.equal(result.chainId, "4663");
    assert.equal(submitCalls.length, 2);
    assert.deepEqual(submitCalls[0].body, requestBytes);
    assert.deepEqual(submitCalls[1].body, requestBytes);
    assert.deepEqual(submitCalls.map(({ idempotencyKey }) => idempotencyKey), [
      expectedKey,
      expectedKey,
    ]);
    assert.deepEqual(sleeps, [7_000]);

    const journalSource = await readFile(result.journalPath, "utf8");
    const journal = JSON.parse(journalSource);
    assert.deepEqual(journal, {
      schemaVersion: "programmable.launch-submit-journal.v2",
      apiVersion: "v4",
      chainId: "4663",
      caip2: "eip155:4663",
      apiOrigin: API_ORIGIN,
      requestPath: "/v4/chains/4663/custom-launches",
      idempotencyKey: expectedKey,
      rawRequestSha256: sha256Digest(requestBytes),
      exactRequestBytesBase64: requestBytes.toString("base64"),
      launchId: V4_LAUNCH_ID,
      status: "received",
      lastResponse: {
        httpStatus: 202,
        retryAfter: null,
        requestId: V4_REQUEST_ID,
        status: "received",
      },
    });
    assert.equal(journalSource.includes(V4_API_KEY), false);
    assert.equal(journalSource.toLowerCase().includes("authorization"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("V4 retries only transport, 429, or explicitly retryable 503 responses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-v4-retry-"));
  try {
    const request = requestWithWalletContract();
    const requestBytes = v4RequestBytes(request);
    let submitCalls = 0;
    await assert.rejects(
      submitLaunch({
        launchPath: path.join(root, "launch.json"),
        configPath: path.join(root, "config.json"),
        stateDirectory: path.join(root, "state"),
        maxAttempts: 5,
        readLaunchBytesImpl: async () => requestBytes,
        validateLaunchFileImpl: v4Validation(request, requestBytes),
        loadApiKeyImpl: async () => V4_API_KEY,
        sleepImpl: async () => assert.fail("nonretryable 503 must not sleep"),
        fetchImpl: async (url) => {
          if (url === CAPABILITIES_URL) return jsonResponse(validV4Capabilities());
          submitCalls += 1;
          return jsonResponse({
            error: { code: "POLICY_UNAVAILABLE", retryable: false },
          }, { status: 503 });
        },
      }),
      (error) => {
        assert.ok(error instanceof ProgrammableApiError);
        assert.equal(error.details.httpStatus, 503);
        assert.equal(error.details.code, "POLICY_UNAVAILABLE");
        return true;
      },
    );
    assert.equal(submitCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("V4 transport ambiguity retries identical bytes then reports an ambiguous result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-v4-ambiguous-"));
  try {
    const request = requestWithWalletContract();
    const requestBytes = v4RequestBytes(request);
    const uploads = [];
    const sleeps = [];
    await assert.rejects(
      submitLaunch({
        launchPath: path.join(root, "launch.json"),
        configPath: path.join(root, "config.json"),
        stateDirectory: path.join(root, "state"),
        maxAttempts: 2,
        readLaunchBytesImpl: async () => requestBytes,
        validateLaunchFileImpl: v4Validation(request, requestBytes),
        loadApiKeyImpl: async () => V4_API_KEY,
        sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
        fetchImpl: async (url, options) => {
          if (url === CAPABILITIES_URL) return jsonResponse(validV4Capabilities());
          uploads.push({
            body: Buffer.from(options.body),
            idempotencyKey: options.headers["idempotency-key"],
          });
          throw new Error("socket closed after upload");
        },
      }),
      (error) => {
        assert.ok(error instanceof ProgrammableApiError);
        assert.equal(error.details.code, "AMBIGUOUS_TRANSPORT_RESULT");
        return true;
      },
    );
    assert.equal(uploads.length, 2);
    assert.deepEqual(uploads[0], uploads[1]);
    assert.deepEqual(uploads[0].body, requestBytes);
    assert.deepEqual(sleeps, [1_000]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("V4 journal refuses one key rebound to different bytes before loading the API key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-v4-conflict-"));
  try {
    const firstRequest = requestWithWalletContract();
    const secondRequest = { ...firstRequest, fixtureCommitment: `sha256:${"e".repeat(64)}` };
    const stateDirectory = path.join(root, "state");
    const key = "v4-explicit-conflict-0001";
    let keyLoads = 0;
    let createCalls = 0;
    const run = async (request) => {
      const requestBytes = v4RequestBytes(request);
      return submitLaunch({
        launchPath: path.join(root, "launch.json"),
        configPath: path.join(root, "config.json"),
        stateDirectory,
        idempotencyKey: key,
        maxAttempts: 1,
        readLaunchBytesImpl: async () => requestBytes,
        validateLaunchFileImpl: v4Validation(request, requestBytes),
        loadApiKeyImpl: async () => {
          keyLoads += 1;
          return V4_API_KEY;
        },
        fetchImpl: async (url, options) => {
          if (url === CAPABILITIES_URL) return jsonResponse(validV4Capabilities());
          createCalls += 1;
          const submittedBytes = Buffer.from(options.body);
          return jsonResponse(validV4Resource(request, submittedBytes), { status: 202 });
        },
      });
    };

    await run(firstRequest);
    await assert.rejects(() => run(secondRequest), /IDEMPOTENCY_BINDING_CONFLICT/u);
    assert.equal(keyLoads, 1);
    assert.equal(createCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("V4 status requires explicit chain selection before network or secret access", async () => {
  let networkCalls = 0;
  let keyLoads = 0;
  await assert.rejects(
    statusLaunch({
      requestId: V4_LAUNCH_ID,
      apiVersion: 4,
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("network must not be reached");
      },
      loadApiKeyImpl: async () => {
        keyLoads += 1;
        return V4_API_KEY;
      },
    }),
    /must be --chain-id 4663/u,
  );
  assert.equal(networkCalls, 0);
  assert.equal(keyLoads, 0);
});

test("V4 wallet handoff validates chain, sender, Router, value, calldata, expiry, and commitments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-v4-wallet-"));
  try {
    const request = requestWithWalletContract();
    const requestBytes = v4RequestBytes(request);
    const baseResource = validV4Resource(request, requestBytes);
    const validWallet = validExactWalletTransaction({
      commitments: {
        ...baseResource.commitments,
        launchIntent: request.launchIntentHash,
      },
    });
    const validResource = walletReadyResource(validV4Resource(request, requestBytes, {
      status: "wallet_action_required",
      walletTransactionPreimageHash: validWallet.transactionPreimageHash,
      walletTransaction: validWallet,
    }));
    const mutations = [
      ["chain", (wallet) => { wallet.chainId = "1"; }],
      ["sender", (wallet) => { wallet.from = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; }],
      ["Router", (wallet) => { wallet.to = "0x2222222222222222222222222222222222222222"; }],
      ["value", (wallet) => { wallet.valueWei = "1"; }],
      ["selector", (wallet) => { wallet.selector = "0x87654321"; }],
      ["calldata", (wallet) => { wallet.calldata = "0x87654321"; }],
      ["expiry", (wallet) => { wallet.expiresAt = "2026-08-29T12:30:00.000Z"; }],
      ["commitments", (wallet) => { wallet.commitments.graph = `sha256:${"9".repeat(64)}`; }],
      ["runtime code", (wallet) => { wallet.routerRuntimeCodeHash = `0x${"9".repeat(64)}`; }],
    ];

    const submitWith = async (resource, directoryName) => submitLaunch({
      launchPath: path.join(root, `${directoryName}.json`),
      configPath: path.join(root, "config.json"),
      stateDirectory: path.join(root, directoryName),
      maxAttempts: 1,
      readLaunchBytesImpl: async () => requestBytes,
      validateLaunchFileImpl: v4Validation(request, requestBytes),
      loadApiKeyImpl: async () => V4_API_KEY,
      fetchImpl: async (url) => url === CAPABILITIES_URL
        ? jsonResponse(validV4Capabilities())
        : jsonResponse(resource, { status: 202 }),
    });

    const result = await submitWith(validResource, "valid");
    assert.equal(result.resource.walletTransaction.from, request.launchWallet);
    assert.equal(result.resource.walletTransaction.valueWei, "0");

    for (const [label, mutate] of mutations) {
      const wallet = structuredClone(validWallet);
      mutate(wallet);
      const resource = structuredClone(validResource);
      resource.walletTransaction = wallet;
      if (label !== "commitments") {
        resource.walletTransactionPreimageHash = wallet.transactionPreimageHash;
      }
      await assert.rejects(
        submitWith(resource, `invalid-${label.replaceAll(" ", "-")}`),
        (error) => {
          assert.match(
            error.message,
            /wallet transaction|wallet preimage|unsafe V4 wallet transaction/u,
            label,
          );
          return true;
        },
      );
    }

    const forgedWallet = structuredClone(validWallet);
    forgedWallet.calldata = `0xe5f6b8cd${"00".repeat(32)}`;
    forgedWallet.transactionPreimageHash = walletPreimageHash(forgedWallet);
    const forgedResource = walletReadyResource(validV4Resource(request, requestBytes, {
      status: "wallet_action_required",
      walletTransactionPreimageHash: forgedWallet.transactionPreimageHash,
      walletTransaction: forgedWallet,
    }));
    await assert.rejects(
      submitWith(forgedResource, "invalid-selector-prefixed-rehashed-wrapper"),
      /calldata|artifact|wallet/u,
    );

    const coordinatedWallet = structuredClone(validWallet);
    coordinatedWallet.commitments.verification = `sha256:${"8".repeat(64)}`;
    coordinatedWallet.commitments.fundingPermit = `sha256:${"9".repeat(64)}`;
    coordinatedWallet.transactionPreimageHash = walletPreimageHash(coordinatedWallet);
    const coordinatedResource = structuredClone(validResource);
    coordinatedResource.commitments.verification = coordinatedWallet.commitments.verification;
    coordinatedResource.commitments.fundingPermit = coordinatedWallet.commitments.fundingPermit;
    coordinatedResource.walletTransaction = coordinatedWallet;
    coordinatedResource.walletTransactionPreimageHash = coordinatedWallet.transactionPreimageHash;
    await assert.rejects(
      submitWith(coordinatedResource, "invalid-coordinated-commitment-forgery"),
      /commitments drifted/u,
    );

    const substitutedResource = structuredClone(validResource);
    const substitutedCommitments = {
      ...substitutedResource.commitments,
      sourceBuild: `sha256:${"a".repeat(64)}`,
      graph: `sha256:${"b".repeat(64)}`,
      metadata: `sha256:${"c".repeat(64)}`,
    };
    const substitutedMetadata = structuredClone(substitutedResource.projectMetadata);
    substitutedMetadata.token.name = "Server-substituted launch";
    substitutedMetadata.token.symbol = "EVIL";
    substitutedResource.sourceBuildCommitment = substitutedCommitments.sourceBuild;
    substitutedResource.graphCommitment = substitutedCommitments.graph;
    substitutedResource.metadataCommitment = substitutedCommitments.metadata;
    substitutedResource.commitments = substitutedCommitments;
    substitutedResource.projectMetadata = substitutedMetadata;
    substitutedResource.preparedArtifact.graphBundleHash = substitutedCommitments.graph;
    substitutedResource.preparedArtifact.projectMetadataHash = substitutedCommitments.metadata;
    substitutedResource.preparedArtifact.projectMetadata = substitutedMetadata;
    substitutedResource.preparedArtifact.artifactHash = preparedArtifactHash(
      substitutedResource.preparedArtifact,
    );
    substitutedResource.walletTransaction.commitments = substitutedCommitments;
    substitutedResource.walletTransaction.launchSummary.name = substitutedMetadata.token.name;
    substitutedResource.walletTransaction.launchSummary.symbol = substitutedMetadata.token.symbol;
    substitutedResource.walletTransaction.transactionPreimageHash = walletPreimageHash(
      substitutedResource.walletTransaction,
    );
    substitutedResource.walletTransactionPreimageHash =
      substitutedResource.walletTransaction.transactionPreimageHash;
    await assert.rejects(
      submitWith(substitutedResource, "invalid-local-artifact-substitution"),
      (error) => {
        assert.match(error.message, /resource commitments drifted/u);
        assert.equal(error.details?.serverDetails?.field, "commitments");
        return true;
      },
    );

    const graphSubstitution = validCoordinatedGraphSubstitutionV4(
      validResource.commitments,
    );
    const graphSubstitutionResource = walletReadyResource(validV4Resource(
      request,
      requestBytes,
      {
        status: "wallet_action_required",
        walletTransactionPreimageHash:
          graphSubstitution.walletTransaction.transactionPreimageHash,
        walletTransaction: graphSubstitution.walletTransaction,
      },
    ), graphSubstitution.preparedArtifact);
    await assert.rejects(
      submitWith(graphSubstitutionResource, "invalid-deployable-graph-substitution"),
      (error) => {
        assert.match(error.message, /calldata or artifact/u);
        assert.match(error.cause?.message ?? error.details?.cause?.message ?? "", /locally validated graph/u);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("V4 status fetches capabilities first and stops at an exact wallet action without signing", async () => {
  const wallet = validExactWalletTransaction();
  const resource = walletReadyResource(validV4Resource(undefined, undefined, {
    status: "awaiting_wallet_signature",
    walletTransactionPreimageHash: wallet.transactionPreimageHash,
    walletTransaction: wallet,
  }));
  const calls = [];
  const result = await statusLaunch({
    requestId: V4_LAUNCH_ID,
    apiVersion: 4,
    chainId: "4663",
    watch: true,
    maxAttempts: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      if (url === CAPABILITIES_URL) return jsonResponse(validV4Capabilities());
      if (url === STATUS_URL) return jsonResponse(resource);
      throw new Error(`unexpected URL ${url}`);
    },
    loadApiKeyImpl: async () => V4_API_KEY,
    sleepImpl: async () => assert.fail("wallet action must stop polling"),
  });

  assert.deepEqual(calls, [
    { url: CAPABILITIES_URL, method: "GET" },
    { url: STATUS_URL, method: "GET" },
  ]);
  assert.equal(result.stopped, true);
  assert.equal(result.walletHandoffReady, true);
  assert.equal(result.walletHandoffStage, "router-transaction-required");
  assert.equal(result.resource.walletTransaction.schemaVersion, "programmable.exact-wallet-transaction.v4");
});

test("V4 finalized status validates and emits the server-authored exact-source state", async () => {
  const sourceVerification = validV4SourceVerificationStatus();
  const wallet = validExactWalletTransaction();
  const resource = walletReadyResource(validV4Resource(undefined, undefined, {
    status: "finalized",
    walletTransactionPreimageHash: wallet.transactionPreimageHash,
    walletTransaction: wallet,
    sourceVerification,
  }));
  const result = await statusLaunch({
    requestId: V4_LAUNCH_ID,
    apiVersion: 4,
    chainId: "4663",
    maxAttempts: 1,
    fetchImpl: async (url) => url === CAPABILITIES_URL
      ? jsonResponse(validV4Capabilities())
      : jsonResponse(resource),
    loadApiKeyImpl: async () => V4_API_KEY,
  });

  assert.deepEqual(result.sourceVerification, sourceVerification);
  assert.deepEqual(result.resource.sourceVerification, sourceVerification);
  assert.equal(result.terminal, true);
  assert.equal(result.resource.sourceVerification.status, "retrying");
  assert.equal(
    result.resource.sourceVerification.components[1].nextAttemptAt,
    "2026-08-29T12:34:00.000Z",
  );
});

test("V4 source-verification parser rejects drift, unsafe evidence, and pre-finality exposure", async () => {
  const submitStatus = async (sourceVerification, status = "finalized") => {
    const wallet = validExactWalletTransaction();
    const resource = walletReadyResource(validV4Resource(undefined, undefined, {
      status,
      walletTransactionPreimageHash: wallet.transactionPreimageHash,
      walletTransaction: wallet,
      sourceVerification,
    }));
    return statusLaunch({
      requestId: V4_LAUNCH_ID,
      apiVersion: 4,
      chainId: "4663",
      maxAttempts: 1,
      fetchImpl: async (url) => url === CAPABILITIES_URL
        ? jsonResponse(validV4Capabilities())
        : jsonResponse(resource),
      loadApiKeyImpl: async () => V4_API_KEY,
    });
  };
  const cases = [
    ["target order", (value) => value.components.reverse(), "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["lowercase address", (value) => {
      value.components[0].address = `0x${"A".repeat(40)}`;
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["provider cannot be exact authority", (value) => {
      value.components[0].exactSourceAuthority = "sourcify-v2";
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["non-exact evidence", (value) => {
      value.components[1].exactSourceBinding = structuredClone(
        value.components[0].exactSourceBinding,
      );
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["provider remains non-authoritative", (value) => {
      value.components[0].providerObservation.releaseAuthority = true;
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["provider partial classification", (value) => {
      value.components[0].providerObservation.classification = "exact_match";
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["provider match vocabulary", (value) => {
      value.components[0].providerObservation.match = "exact_match";
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["binding authority", (value) => {
      value.components[0].exactSourceBinding.authority = "sourcify-v2";
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["binding coverage", (value) => {
      value.components[0].exactSourceBinding.coveredEvidence.pop();
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["binding digest", (value) => {
      value.components[0].exactSourceBinding.bindingDigest = `sha256:${"A".repeat(64)}`;
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["retry schedule", (value) => {
      delete value.components[1].nextAttemptAt;
    }, "CUSTOM_LAUNCH_V4_CONTRACT_INVALID"],
    ["terminal retry schedule", (value) => {
      value.components[0].nextAttemptAt = "2026-08-29T12:35:00.000Z";
    }, "CUSTOM_LAUNCH_V4_CONTRACT_INVALID"],
    ["aggregate status", (value) => {
      value.status = "queued";
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
    ["aggregate timestamp", (value) => {
      value.updatedAt = "2026-08-29T12:31:00.000Z";
    }, "CUSTOM_LAUNCH_V4_RESOURCE_INVALID"],
  ];
  for (const [label, mutate, expectedCode] of cases) {
    const sourceVerification = structuredClone(validV4SourceVerificationStatus());
    mutate(sourceVerification);
    await assert.rejects(
      submitStatus(sourceVerification),
      (error) => {
        assert.ok(error instanceof ProgrammableApiError, label);
        assert.equal(error.details?.code, expectedCode, label);
        return true;
      },
    );
  }

  await assert.rejects(
    submitStatus(validV4SourceVerificationStatus(), "submitted"),
    (error) => {
      assert.ok(error instanceof ProgrammableApiError);
      assert.equal(error.details?.serverDetails?.field, "sourceVerification.status");
      return true;
    },
  );
});

function requestWithWalletContract(overrides = {}) {
  return validV4Request({
    permitWindow: {
      validAfter: "1788004800",
      deadline: "1788006000",
    },
    funding: {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "none",
      valueWei: "0",
    },
    graphBundle: localGraphBundleFixture(),
    projectMetadata: validV4ProjectMetadata(),
    launchIntentHash: `sha256:${"7".repeat(64)}`,
    ...overrides,
  });
}

function v4Validation(request, requestBytes) {
  return async () => {
    const localResource = validV4Resource(request, requestBytes);
    const localArtifact = validPreparedArtifactV4(localResource.commitments);
    return {
      schemaVersion: request.schemaVersion,
      requestSha256: sha256Digest(requestBytes),
      sourceBuildCommitment: localResource.commitments.sourceBuild,
      graphBundleHash: localResource.commitments.graph,
      projectMetadataHash: localResource.commitments.metadata,
      verificationBundleHash: localResource.commitments.verification,
      launchIntentHash: localResource.commitments.launchIntent,
      unboundGraphBundleHash: localArtifact.unboundGraphBundleHash,
      predictions: localArtifact.route.targets.map((target) => ({
        targetId: target.targetId,
        targetIdHash: target.targetIdHash,
        applicantSalt: target.applicantSalt,
        effectiveSalt: target.effectiveSalt,
        predictedAddress: target.predictedAddress,
        initCodeHash: target.initCodeHash,
        resolvedConstructorArguments: "0x",
        resolvedInitializerCalldata: target.initializerCalldata,
      })),
      reproducedFromConfig: true,
    };
  };
}

function localGraphBundleFixture() {
  const artifact = validPreparedArtifactV4();
  const kinds = new Map(
    artifact.predictedComponents.map((component) => [component.targetId, component.componentKind]),
  );
  return {
    schemaVersion: "programmable.custom-graph-bundle.v1",
    sourceBundleSha256: artifact.sourceBundleSha256,
    targets: artifact.route.targets.map((target) => ({
      targetId: target.targetId,
      applicantSalt: target.applicantSalt,
      creationBytecode: target.initCode,
      constructorArguments: "0x",
      initializerCalldata: target.initializerCalldata,
      constructorAddressLocators: [],
      initializerAddressLocators: [],
      deploymentValueWei: target.deploymentValueWei,
      initializerValueWei: target.initializerValueWei,
      expectedRuntimeCodeHash: target.expectedRuntimeCodeHash,
      componentKind: kinds.get(target.targetId),
      declaredHookPermissions: null,
    })),
    pool: {
      tokenTargetId: "token",
      hookTargetId: "hook",
      fee: 3_000,
      tickSpacing: 60,
    },
  };
}

function walletReadyResource(
  resource,
  preparedArtifact = validPreparedArtifactV4(resource.commitments),
) {
  const withArtifact = { ...resource, preparedArtifact };
  const externalContractEvidenceReceipt = validExternalContractEvidenceReceiptV4(withArtifact);
  const admissionReceipt = validAdmissionReceiptV4(withArtifact);
  const simulationReceipt = validSimulationReceiptV4(withArtifact);
  return {
    ...withArtifact,
    admissionReceipt,
    simulationReceipt,
    externalContractEvidenceReceipt,
  };
}

function walletPreimageHash(transaction) {
  const { transactionPreimageHash: _ignored, ...preimage } = transaction;
  return sha256Digest(Buffer.concat([
    Buffer.from("programmable.exact-wallet-transaction-preimage.v4", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(preimage), "utf8"),
  ]));
}

function preparedArtifactHash(artifact) {
  const { artifactHash: _ignored, ...preimage } = artifact;
  return sha256Digest(Buffer.from(canonicalizeJson(preimage), "utf8"));
}
