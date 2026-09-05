import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { EXPECTED } from "../late-migration-deployment-preflight-core.mjs";
import {
  SOURCE_ABI,
  appendLateMigrationStageTransaction,
  createLateMigrationStageJournal,
  deriveDisabledLateMigrationActivationManifest,
  lateMigrationEndpointCommitment,
  prepareDepositActivation,
  productionProvidersFromEnvironment,
  unwrapLateMigrationStageJournal,
  verifyLateMigrationStageContext,
} from "../late-migration-deployment-stages-core.mjs";
import { runLateMigrationStageCli } from "../prepare-late-migration-stage.mjs";
import { prepareLateMigrationProviderCommitments } from "../prepare-late-migration-provider-commitments.mjs";
import {
  activationHash,
  blockHash,
  deploymentHash,
  fixture,
} from "./fixtures/late-migration-tooling-fixture.mjs";
function verify(f, { production = false, activated = false, ...extra } = {}) {
  const set = production ? f.production() : null;
  let journal = createLateMigrationStageJournal(deploymentHash);
  if (activated)
    journal = appendLateMigrationStageTransaction(
      journal,
      "depositActivation",
      activationHash,
    );
  const providers = set?.providers ?? f.providers;
  return {
    providers,
    promise: verifyLateMigrationStageContext({
      ...f,
      journal,
      sourceProviders: providers,
      productionProviderSets: set ? { source: set } : null,
      requireProductionActivationProviders: production,
      ...extra,
    }),
  };
}
test("only source deployment and one activation are valid journal stages", () => {
  const journal = createLateMigrationStageJournal(deploymentHash);
  assert.deepEqual(Object.keys(journal.transactions), [
    "sourceDeployment",
    "depositActivation",
  ]);
  const activated = appendLateMigrationStageTransaction(
    journal,
    "depositActivation",
    activationHash,
  );
  assert.equal(activated.transactions.depositActivation, activationHash);
  assert.throws(
    () =>
      appendLateMigrationStageTransaction(
        activated,
        "depositActivation",
        activationHash,
      ),
    /only one/,
  );
  for (const stage of [
    "targetDeployment",
    "targetBinding",
    "sourceBindingRetryable",
    "reserveFunding",
    "reserveSealing",
  ])
    assert.throws(
      () => appendLateMigrationStageTransaction(journal, stage, activationHash),
      /only one/,
    );
  assert.throws(
    () =>
      appendLateMigrationStageTransaction(
        journal,
        "depositActivation",
        deploymentHash,
      ),
    /separate/,
  );
  const legacy = structuredClone(journal);
  legacy.schema = "programmable-late-migration-deployment-journal/v1";
  assert.throws(() => unwrapLateMigrationStageJournal(legacy), /schema/);
});
test("source deployment verification binds initcode, canonical receipt, runtime, frozen fields and closed state", async () => {
  const f = fixture();
  const context = await verify(f).promise;
  assert.equal(context.state, "deployment-finalized-deposits-closed");
  assert.equal(context.sourceAddress, f.sourceAddress);
  assert.equal(context.deployment.transactionHash, deploymentHash);
  assert.equal(context.deployment.blockHash, blockHash(900));
  assert.equal(context.intakeState.activationAuthority, EXPECTED.owner);
  assert.equal(context.productionProviderEvidence, null);
  assert.equal(context.signingAllowed, false);
});
for (const [name, mutate] of [
  [
    "creation calldata mismatch",
    (v, m) => (m === "eth_getTransactionByHash" ? { ...v, input: "0x00" } : v),
  ],
  [
    "receipt failure",
    (v, m) => (m === "eth_getTransactionReceipt" ? { ...v, status: "0x0" } : v),
  ],
  [
    "wrong CREATE address",
    (v, m) =>
      m === "eth_getTransactionReceipt"
        ? { ...v, contractAddress: EXPECTED.oldToken }
        : v,
  ],
  [
    "wrong deployer",
    (v, m) =>
      m === "eth_getTransactionByHash"
        ? { ...v, from: EXPECTED.oldTokenRecipient }
        : v,
  ],
  [
    "nonzero ETH",
    (v, m) => (m === "eth_getTransactionByHash" ? { ...v, value: "0x1" } : v),
  ],
  [
    "wrong chain",
    (v, m) =>
      m === "eth_getTransactionByHash" ? { ...v, chainId: "0x1237" } : v,
  ],
  [
    "missing canonical transaction",
    (v, m, p) =>
      m === "eth_getBlockByNumber" && p[0] === "0x384"
        ? { ...v, transactions: [] }
        : v,
  ],
  [
    "reorged receipt",
    (v, m, p) =>
      m === "eth_getBlockByNumber" && p[0] === "0x384"
        ? { ...v, hash: blockHash(901) }
        : v,
  ],
  [
    "unfinalized receipt",
    (v, m) =>
      m === "eth_getTransactionReceipt" ? { ...v, blockNumber: "0x500" } : v,
  ],
  [
    "literal-finalized hash conflict",
    (v, m, p) =>
      m === "eth_getBlockByNumber" && p[0] === "finalized"
        ? { ...v, hash: blockHash(999) }
        : v,
  ],
  [
    "deployed runtime drift",
    (v, m, p) =>
      m === "eth_getCode" &&
      p[0].toLowerCase() !== EXPECTED.oldToken.toLowerCase()
        ? "0x00"
        : v,
  ],
  [
    "wrong runtime recipient",
    (v, m, p) =>
      m === "eth_call" &&
      p[0].to.toLowerCase() !== EXPECTED.oldToken.toLowerCase() &&
      decodeFunctionData({ abi: SOURCE_ABI, data: p[0].data }).functionName ===
        "OLD_TOKEN_RECIPIENT"
        ? encodeFunctionResult({
            abi: SOURCE_ABI,
            functionName: "OLD_TOKEN_RECIPIENT",
            result: EXPECTED.owner,
          })
        : v,
  ],
])
  test(`source verification rejects ${name}`, async () => {
    await assert.rejects(verify(fixture({ mutate })).promise);
  });

test("public provider verification cannot prepare irreversible activation", async () => {
  const f = fixture();
  const context = await verify(f).promise;
  await assert.rejects(
    prepareDepositActivation({ context, providers: f.providers }),
    /authenticated production/,
  );
});
test("activation preparation is source-only zero-value exact calldata with immutable disclosures", async () => {
  const f = fixture();
  const { promise, providers } = verify(f, { production: true });
  const context = await promise;
  const result = await prepareDepositActivation({
    context,
    providers,
    nowSeconds: f.nowSeconds,
  });
  assert.equal(result.stage, "one-time-source-activation");
  assert.equal(result.transactions.length, 1);
  const tx = result.transactions[0];
  assert.equal(tx.chainId, 1);
  assert.equal(tx.from, EXPECTED.owner);
  assert.equal(tx.to, f.sourceAddress);
  assert.equal(tx.value, "0");
  assert.equal(tx.data, "0xe5703512");
  assert.equal(tx.nonce, "11");
  assert.equal(tx.gasLimit, "120000");
  assert.equal(tx.decoded.oldTokenRecipient, EXPECTED.oldTokenRecipient);
  assert.equal(tx.decoded.manualPayoutBps, 8000);
  assert.equal(result.expiresAt - result.generatedAt, 300);
  assert.equal(result.signingAllowed, false);
  assert.equal(result.broadcastAllowed, false);
  assert(
    f.trace.some(
      (read) =>
        read.method === "eth_call" &&
        read.params[0].data === tx.data &&
        read.params[1] === "latest",
    ),
  );
  await assert.rejects(
    prepareDepositActivation({ context: structuredClone(context), providers }),
    /fresh in-process/,
  );
  await assert.rejects(
    prepareDepositActivation({
      context,
      providers,
      nowSeconds: f.nowSeconds + 301,
    }),
    /fresh in-process/,
  );
  await assert.rejects(
    prepareDepositActivation({ context, providers: [...providers] }),
    /provider identity/,
  );
});
test("canonical finalized activation event yields a disabled manifest with sponsor fields still null", async () => {
  const f = fixture({ activated: true });
  const context = await verify(f, { production: true, activated: true })
    .promise;
  assert.equal(context.state, "activation-finalized");
  assert.equal(context.activation.transactionHash, activationHash);
  assert.equal(context.activation.logIndex, "2");
  assert.equal(
    context.intakeState.activationAuthority,
    "0x0000000000000000000000000000000000000000",
  );
  const candidate = deriveDisabledLateMigrationActivationManifest({
    activation: f.activation,
    context,
  });
  assert.equal(candidate.enabled, false);
  assert.equal(candidate.sourceContractAddress, f.sourceAddress);
  assert.equal(candidate.sourceDeploymentBlockNumber, "900");
  assert.equal(candidate.activatedAtBlock, "950");
  for (const field of [
    "relayerAddress",
    "relayerFundingBalanceWei",
    "relayerWalletOwnerId",
    "relayerPolicyOwnerId",
    "totalRelayerBudgetWei",
  ])
    assert.equal(candidate[field], null);
  const changed = { ...f.activation, oldTokenRecipient: EXPECTED.owner };
  assert.throws(
    () =>
      deriveDisabledLateMigrationActivationManifest({
        activation: changed,
        context,
      }),
    /unchanged activation/,
  );
});
for (const [name, mutate] of [
  [
    "missing activation event",
    (v, m, p) =>
      m === "eth_getTransactionReceipt" && p[0] === activationHash
        ? { ...v, logs: [] }
        : v,
  ],
  [
    "duplicate activation event",
    (v, m, p) =>
      m === "eth_getTransactionReceipt" && p[0] === activationHash
        ? { ...v, logs: [...v.logs, ...v.logs] }
        : v,
  ],
  [
    "removed activation log",
    (v, m, p) =>
      m === "eth_getTransactionReceipt" && p[0] === activationHash
        ? { ...v, logs: v.logs.map((log) => ({ ...log, removed: true })) }
        : v,
  ],
  [
    "wrong event transaction",
    (v, m, p) =>
      m === "eth_getTransactionReceipt" && p[0] === activationHash
        ? {
            ...v,
            logs: v.logs.map((log) => ({
              ...log,
              transactionHash: deploymentHash,
            })),
          }
        : v,
  ],
  [
    "wrong event block",
    (v, m, p) =>
      m === "eth_getTransactionReceipt" && p[0] === activationHash
        ? {
            ...v,
            logs: v.logs.map((log) => ({ ...log, blockHash: blockHash(951) })),
          }
        : v,
  ],
  [
    "wrong activation calldata",
    (v, m, p) =>
      m === "eth_getTransactionByHash" && p[0] === activationHash
        ? { ...v, input: "0x00" }
        : v,
  ],
  [
    "authority not erased",
    (v, m, p) =>
      m === "eth_call" &&
      p[0].to.toLowerCase() !== EXPECTED.oldToken.toLowerCase() &&
      decodeFunctionData({ abi: SOURCE_ABI, data: p[0].data }).functionName ===
        "activationAuthority"
        ? encodeFunctionResult({
            abi: SOURCE_ABI,
            functionName: "activationAuthority",
            result: EXPECTED.owner,
          })
        : v,
  ],
])
  test(`activation verification rejects ${name}`, async () => {
    const f = fixture({ activated: true, mutate });
    await assert.rejects(
      verify(f, { activated: true, production: true }).promise,
    );
  });

test("provider commitments are source-only, stable and never return credentials", () => {
  const entry = {
    id: "alpha",
    trustDomain: "alpha.test",
    url: "https://rpc.alpha.test/key-path",
    headers: { Authorization: "Bearer private-test-only" },
  };
  const commitment = lateMigrationEndpointCommitment(entry);
  assert.equal(
    commitment,
    lateMigrationEndpointCommitment({
      ...entry,
      headers: { authorization: entry.headers.Authorization },
    }),
  );
  const result = prepareLateMigrationProviderCommitments({
    argv: ["source"],
    env: {
      LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON: JSON.stringify([
        entry,
        {
          ...entry,
          id: "beta",
          trustDomain: "beta.test",
          url: "https://rpc.beta.test/key-path",
        },
      ]),
    },
  });
  assert.equal(result.secretValuesIncluded, false);
  assert(!JSON.stringify(result).includes("private-test-only"));
  assert(!JSON.stringify(result).includes("key-path"));
  assert.throws(
    () => prepareLateMigrationProviderCommitments({ argv: ["target"] }),
    /usage/,
  );
});
test("production provider set rejects unauthenticated, uncommitted, duplicate-domain or target providers", () => {
  const f = fixture();
  assert.throws(
    () =>
      productionProvidersFromEnvironment({
        chain: "target",
        policy: f.preflight.activationProviderPolicy,
      }),
    /Ethereum source/,
  );
  assert.throws(
    () =>
      lateMigrationEndpointCommitment({
        url: "https://rpc.alpha.test",
        headers: {},
      }),
    /authentication headers/,
  );
  const entry = {
    id: "alpha",
    trustDomain: "alpha.test",
    url: "https://rpc.alpha.test",
    headers: { authorization: "Bearer test-token" },
  };
  entry.endpointCommitmentSha256 = lateMigrationEndpointCommitment(entry);
  const env = {
    LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON: JSON.stringify([
      entry,
      { ...entry, id: "beta" },
    ]),
  };
  assert.throws(
    () =>
      productionProvidersFromEnvironment({
        policy: f.preflight.activationProviderPolicy,
        env,
      }),
    /independent/,
  );
  const changed = {
    ...entry,
    endpointCommitmentSha256: "sha256:" + "0".repeat(64),
  };
  env.LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON = JSON.stringify([
    changed,
    changed,
  ]);
  assert.throws(
    () =>
      productionProvidersFromEnvironment({
        policy: f.preflight.activationProviderPolicy,
        env,
      }),
    /endpoint commitment/,
  );
});
test("CLI removes obsolete stages and rejects signing, sending and funding options", async () => {
  for (const command of [
    "prepare-target",
    "prepare-bind",
    "prepare-source-binding-retryable",
    "prepare-funding",
    "prepare-seal",
  ])
    await assert.rejects(
      runLateMigrationStageCli({ argv: [command, "anything.json"] }),
      /usage/,
    );
  for (const option of [
    "--broadcast",
    "--private-key=x",
    "--send",
    "--sign",
    "--fund",
    "--write",
  ])
    await assert.rejects(
      runLateMigrationStageCli({
        argv: ["prepare-activate", "anything.json", option],
      }),
      /forbidden/,
    );
});

test("provider-specific optional block, receipt and transaction fields do not break canonical agreement", async () => {
  const f = fixture({
    activated: true,
    mutate(value, method, params, index) {
      if (
        index === 1 &&
        [
          "eth_getBlockByNumber",
          "eth_getTransactionByHash",
          "eth_getTransactionReceipt",
        ].includes(method)
      ) {
        return {
          ...value,
          providerExtraField: "ignored",
          totalDifficulty: "0xdead",
          effectiveGasPrice: "0xbeef",
        };
      }
      return value;
    },
  });
  const context = await verify(f, { activated: true, production: true })
    .promise;
  assert.equal(context.state, "activation-finalized");
});
