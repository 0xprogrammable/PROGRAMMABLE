import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ROBINHOOD_LIVE_DEPLOYMENT_PATH,
  ROBINHOOD_PREDEPLOYMENT_PATH,
  materializeRobinhoodPromotionBundle,
  verifyRobinhoodPromotionBundle,
} from "../robinhood-custom-launch-postdeploy-core.mjs";
import { runRobinhoodPostdeploymentCli } from "../finalize-robinhood-custom-launch-deployment.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const bindingPath = "docs/operations/releases/custom-launch-v4/cli-release-binding.json";
const sourcePaths = [
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
  "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
  "contracts/src/ProgrammableCreate2GraphDeployerV1.sol",
  "contracts/src/robinhood-custom-launch/ProgrammableLaunchStampRouterV1.sol",
];
const template = JSON.parse(await readFile(path.join(repositoryRoot, bindingPath), "utf8"));
const machinePaths = template.machineContracts.map(({ path: relativePath }) => relativePath);

const ROOTS = Object.freeze({
  programmableLaunchStampRouter: {
    address: "0x34965F2A2ee9254522232C32F02056E92BE0C98a",
    runtimeCodeHash:
      "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
  },
  permitAuthority: {
    address: "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06",
    runtimeCodeHash:
      "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  },
  graphFactory: {
    address: "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd",
    runtimeCodeHash:
      "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
  },
  poolManager: {
    address: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    runtimeCodeHash:
      "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  },
  positionManager: {
    address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
    runtimeCodeHash:
      "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
  },
  stateView: {
    address: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
    runtimeCodeHash:
      "0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6",
  },
  v4Quoter: {
    address: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    runtimeCodeHash:
      "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
  },
  permit2: {
    address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    runtimeCodeHash:
      "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
  },
  universalRouter: {
    address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
    runtimeCodeHash:
      "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
  },
});
const EXTERNAL = Object.freeze({
  poolManager: {
    transactionHash:
      "0x4fb28d4935866f462582c6c931c6f2705e55f5be5eb178c7d8d9329a95c44c41",
    startBlock: "9070",
  },
  positionManager: {
    transactionHash:
      "0x228c18ada6cb46b4fbcc18f4ec1519953415393e256fa8349aafbd5a2db037c8",
    startBlock: "9073",
  },
  stateView: {
    transactionHash:
      "0x3d61e2c9eeb482385b1aa436b9e8f812167ea579cc390e4f93bc5abde00582f4",
    startBlock: "9075",
  },
  v4Quoter: {
    transactionHash:
      "0x6bf436d72a17f87284ddcab43094689bd320dfb39b535213b9a0b669fabc4ab4",
    startBlock: "9074",
  },
  universalRouter: {
    transactionHash:
      "0xdfb76494e158d8dea4376160315239271636a18515207fd4526e574bc7eeb456",
    startBlock: "3347899",
  },
});

test("materializes one closed promotion bundle while preserving the prepared artifact", async () => {
  const fixture = await fixtureRepository();
  try {
    const preparedBefore = await readFile(path.join(fixture.root, ROBINHOOD_PREDEPLOYMENT_PATH));
    const bundle = materializeRobinhoodPromotionBundle({
      repositoryRoot: fixture.root,
      input: buildInput(fixture),
    });
    const repeated = materializeRobinhoodPromotionBundle({
      repositoryRoot: fixture.root,
      input: buildInput(fixture),
    });
    assert.deepEqual(repeated, bundle);
    const result = verifyRobinhoodPromotionBundle({ repositoryRoot: fixture.root, bundle });
    assert.equal(result.releaseReady, true);
    assert.equal(result.startBlock, "49230000");
    assert.match(result.chainDeploymentDescriptorDigest, /^0x[0-9a-f]{64}$/u);
    assert.equal(bundle.artifacts.liveDeployment.path, ROBINHOOD_LIVE_DEPLOYMENT_PATH);
    assert.equal(bundle.artifacts.cliReleaseBinding.value.releaseReady, true);
    assert.deepEqual(bundle.artifacts.cliReleaseBinding.value.blockers, []);
    assert.equal(bundle.consumerInputs.indexer.router.startBlock, "49230000");
    assert.equal(bundle.consumerInputs.indexer.sourceRevision, fixture.revision);
    assert.equal(bundle.consumerInputs.indexer.sourceTree, fixture.tree);
    assert.equal(bundle.consumerInputs.indexer.standardJsonInputs.length, 2);
    assert.deepEqual(Object.keys(bundle), [
      "schemaVersion",
      "state",
      "chainDeploymentId",
      "inputEvidenceDigest",
      "preparedArtifact",
      "sourceVerification",
      "sourceClosure",
      "finalizedBindings",
      "artifacts",
      "consumerInputs",
      "promotionBundleDigest",
    ]);
    assert.deepEqual(Object.keys(bundle.artifacts.liveDeployment.value), [
      "schemaVersion",
      "chainDeploymentId",
      "chainId",
      "caip2",
      "finality",
      "foundationSourceCommitment",
      "deploymentEvidence",
      "permit2GenesisProvenance",
      "permitAuthoritySourceProvenance",
      "externalRootDeploymentEvidence",
      "contracts",
    ]);
    assert.deepEqual(Object.keys(bundle.consumerInputs.indexer), [
      "schemaVersion",
      "chainId",
      "caip2",
      "chainDeploymentId",
      "chainDeploymentDescriptorDigest",
      "router",
      "graphFactory",
      "permitAuthority",
      "finalizedCheckpoint",
      "finalityEvidenceDigest",
      "sourceRevision",
      "sourceTree",
      "sourceClosureDigest",
      "standardJsonInputs",
    ]);
    assert.deepEqual(Object.keys(bundle.consumerInputs.developers), [
      "schemaVersion",
      "status",
      "publicAuthorization",
      "publicWrites",
      "chainId",
      "caip2",
      "chainDeploymentId",
      "chainDeploymentDescriptorDigest",
      "startBlock",
      "finalizedCheckpoint",
      "finalityPolicy",
      "roots",
      "sourceVerificationEvidenceDigest",
      "sourceRevision",
      "sourceTree",
      "sourceClosureDigest",
    ]);
    await assert.rejects(
      readFile(path.join(fixture.root, ROBINHOOD_LIVE_DEPLOYMENT_PATH)),
      /ENOENT/u,
    );
    assert.deepEqual(
      await readFile(path.join(fixture.root, ROBINHOOD_PREDEPLOYMENT_PATH)),
      preparedBefore,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("fails closed on transaction, provider, runtime, Safe, finality, and source drift", async () => {
  const fixture = await fixtureRepository();
  try {
    const cases = [
      ["selector", (input) => { input.providers[0].transaction.selector = "0x00000000"; }, /Multicall3 calldata/u],
      ["target", (input) => {
        input.providers[0].transaction.to = ROOTS.poolManager.address;
      }, /pinned address/u],
      ["value", (input) => { input.providers[0].transaction.valueWei = "1"; }, /Multicall3 calldata/u],
      ["calldata hash", (input) => {
        input.providers[0].transaction.calldataHash = codeHash("d");
      }, /Multicall3 calldata/u],
      ["provider", (input) => { input.providers[1].trustDomain = "same.example"; }, /provider identity/u],
      ["receipt", (input) => { input.providers[0].receipt.status = "0"; }, /successful receipt/u],
      ["D-1", (input) => { input.providers[1].atomicRoots[0].preDeploymentBlockNumber = "1"; }, /D-1 to D/u],
      ["Router", (input) => {
        input.providers[0].routerState.graphFactory = ROOTS.poolManager.address;
      }, /pinned address/u],
      ["Safe", (input) => { input.providers[0].safeState.threshold = 2; }, /Safe state/u],
      ["finality", (input) => {
        input.ethereumFinality.ethereumFinalizedCheckpoint.blockNumber = "900";
      }, /predates the posting block/u],
      ["source", (input) => {
        input.sourceVerification.graphFactory.match = "partial";
      }, /compiler input match/u],
    ];
    for (const [label, mutate, expected] of cases) {
      const input = buildInput(fixture);
      mutate(input);
      assert.throws(
        () => materializeRobinhoodPromotionBundle({ repositoryRoot: fixture.root, input }),
        expected,
        label,
      );
    }
    const changedSourcePath = sourcePaths[3];
    await writeFile(
      path.join(fixture.root, changedSourcePath),
      `${await readFile(path.join(fixture.root, changedSourcePath), "utf8")}\n`,
      "utf8",
    );
    runGit(fixture.root, ["add", changedSourcePath]);
    runGit(fixture.root, [
      "-c", "commit.gpgsign=false",
      "-c", "user.name=Programmable Release Test",
      "-c", "user.email=release-test@programmable.invalid",
      "commit", "-m", "drift source",
    ]);
    const sourceDriftInput = buildInput({
      ...fixture,
      revision: runGit(fixture.root, ["rev-parse", "HEAD"]),
      tree: runGit(fixture.root, ["rev-parse", "HEAD^{tree}"]),
    });
    assert.throws(
      () => materializeRobinhoodPromotionBundle({
        repositoryRoot: fixture.root,
        input: sourceDriftInput,
      }),
      /production source differs/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("CLI assemble, verify, and explicit apply are deterministic and never edit predeployment", async () => {
  const fixture = await fixtureRepository();
  try {
    const inputPath = path.join(fixture.root, "postdeployment-input.json");
    const bundlePath = path.join(fixture.root, "promotion-bundle.json");
    await writeFile(inputPath, `${JSON.stringify(buildInput(fixture), null, 2)}\n`, "utf8");
    const preparedBefore = await readFile(path.join(fixture.root, ROBINHOOD_PREDEPLOYMENT_PATH));
    const assembled = await runRobinhoodPostdeploymentCli([
      "assemble", "--input", inputPath, "--output", bundlePath,
      "--repository-root", fixture.root,
    ]);
    assert.equal(assembled.wroteLiveArtifacts, false);
    const verified = await runRobinhoodPostdeploymentCli([
      "verify", "--bundle", bundlePath, "--repository-root", fixture.root,
    ]);
    assert.equal(verified.releaseReady, true);
    const applied = await runRobinhoodPostdeploymentCli([
      "apply", "--bundle", bundlePath, "--repository-root", fixture.root,
    ]);
    assert.equal(applied.wroteLiveArtifacts, true);
    assert.equal(applied.preparedArtifactPreserved, true);
    assert.deepEqual(
      await readFile(path.join(fixture.root, ROBINHOOD_PREDEPLOYMENT_PATH)),
      preparedBefore,
    );
    const live = JSON.parse(
      await readFile(path.join(fixture.root, ROBINHOOD_LIVE_DEPLOYMENT_PATH), "utf8"),
    );
    const binding = JSON.parse(await readFile(path.join(fixture.root, bindingPath), "utf8"));
    assert.equal(binding.chain.chainDeploymentDescriptorDigest,
      assembled.chainDeploymentDescriptorDigest);
    assert.equal(live.deploymentEvidence.blockNumber, "49230000");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("closed bundle verification rejects consumer and digest tampering", async () => {
  const fixture = await fixtureRepository();
  try {
    const original = materializeRobinhoodPromotionBundle({
      repositoryRoot: fixture.root,
      input: buildInput(fixture),
    });
    const consumerTamper = structuredClone(original);
    consumerTamper.consumerInputs.indexer.router.startBlock = "1";
    assert.throws(
      () => verifyRobinhoodPromotionBundle({ repositoryRoot: fixture.root, bundle: consumerTamper }),
      /consumer inputs/u,
    );
    const descriptorTamper = structuredClone(original);
    descriptorTamper.artifacts.liveDeployment.value.contracts.graphFactory.runtimeCodeHash =
      `0x${"9".repeat(64)}`;
    assert.throws(
      () => verifyRobinhoodPromotionBundle({ repositoryRoot: fixture.root, bundle: descriptorTamper }),
      /artifact|pinned Robinhood root/u,
    );
    const digestTamper = structuredClone(original);
    digestTamper.promotionBundleDigest = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => verifyRobinhoodPromotionBundle({ repositoryRoot: fixture.root, bundle: digestTamper }),
      /bundle digest/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function fixtureRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-robinhood-postdeploy-"));
  for (const relativePath of [
    ROBINHOOD_PREDEPLOYMENT_PATH,
    bindingPath,
    ...sourcePaths,
    ...machinePaths,
  ]) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repositoryRoot, relativePath), destination);
  }
  runGit(root, ["init", "-b", "production"]);
  runGit(root, ["add", "-A"]);
  runGit(root, [
    "-c", "commit.gpgsign=false",
    "-c", "user.name=Programmable Release Test",
    "-c", "user.email=release-test@programmable.invalid",
    "commit", "-m", "fixture",
  ]);
  return {
    root,
    revision: runGit(root, ["rev-parse", "HEAD"]),
    tree: runGit(root, ["rev-parse", "HEAD^{tree}"]),
  };
}

function buildInput(fixture) {
  const blockNumber = "49230000";
  const blockHash = codeHash("2");
  const transactionHash = codeHash("1");
  const preDeploymentBlockNumber = (BigInt(blockNumber) - 1n).toString();
  const atomicRootNames = ["permitAuthority", "graphFactory", "programmableLaunchStampRouter"];
  const externalRootNames = [
    "poolManager", "positionManager", "stateView", "v4Quoter", "universalRouter",
  ];
  const providers = [
    { providerId: "drpc", trustDomain: "drpc.org" },
    { providerId: "alchemy", trustDomain: "alchemy.com" },
  ].map((provider) => ({
    ...provider,
    transaction: {
      hash: transactionHash,
      from: "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
      to: "0xcA11bde05977b3631167028862bE2a173976CA11",
      valueWei: "0",
      selector: "0x82ad56cb",
      calldataHash:
        "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9",
      calldataBytes: 33_412,
      nonce: "7",
      transactionIndex: "2",
      blockNumber,
      blockHash,
    },
    receipt: {
      transactionHash,
      from: "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
      to: "0xcA11bde05977b3631167028862bE2a173976CA11",
      status: "1",
      transactionIndex: "2",
      blockNumber,
      blockHash,
      logs: [],
    },
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      runtimeCodeHash:
        "0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891",
    },
    atomicRoots: atomicRootNames.map((contract) => ({
      contract,
      address: ROOTS[contract].address,
      preDeploymentBlockNumber,
      preDeploymentBlockHash: codeHash("3"),
      preDeploymentRuntimeCodeHash:
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      deploymentBlockNumber: blockNumber,
      deploymentBlockHash: blockHash,
      deploymentRuntimeCodeHash: ROOTS[contract].runtimeCodeHash,
    })),
    routerState: {
      address: ROOTS.programmableLaunchStampRouter.address,
      runtimeCodeHash: ROOTS.programmableLaunchStampRouter.runtimeCodeHash,
      chainId: "4663",
      permitAuthority: ROOTS.permitAuthority.address,
      permitAuthorityRuntimeCodeHash: ROOTS.permitAuthority.runtimeCodeHash,
      graphFactory: ROOTS.graphFactory.address,
      graphFactoryRuntimeCodeHash: ROOTS.graphFactory.runtimeCodeHash,
      poolManager: ROOTS.poolManager.address,
      poolManagerRuntimeCodeHash: ROOTS.poolManager.runtimeCodeHash,
    },
    safeState: {
      blockNumber,
      blockHash,
      proxyAddress: ROOTS.permitAuthority.address,
      proxyRuntimeCodeHash: ROOTS.permitAuthority.runtimeCodeHash,
      singleton: {
        address: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
        runtimeCodeHash:
          "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
        version: "1.4.1",
      },
      fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
      fallbackHandlerRuntimeCodeHash:
        "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
      owners: [
        "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
        "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
      ],
      threshold: 1,
      nonce: "0",
      modules: [],
      modulesNext: "0x0000000000000000000000000000000000000001",
      guard: null,
      singletonSlot: "0x00000000000000000000000041675c099f32341bf84bfc5382af534df5c7461a",
      fallbackHandlerSlot:
        "0x000000000000000000000000fd0732dc9e303f09fcef3a7388ad10a83459ec99",
      guardSlot: `0x${"0".repeat(64)}`,
    },
    permit2Genesis: {
      address: ROOTS.permit2.address,
      blockNumber: "0",
      blockHash: codeHash("4"),
      runtimeCodeHash: ROOTS.permit2.runtimeCodeHash,
      runtimeCodeBytes: 9_152,
    },
    externalRoots: externalRootNames.map((contract, index) => ({
      contract,
      address: ROOTS[contract].address,
      runtimeCodeHash: ROOTS[contract].runtimeCodeHash,
      transactionHash: EXTERNAL[contract].transactionHash,
      startBlock: EXTERNAL[contract].startBlock,
      blockHash: codeHash(String(index + 5)),
      transactionReceiptDigest: digest(String(index + 1)),
    })),
  }));
  return {
    schemaVersion: "programmable.robinhood-custom-launch.postdeployment-input.v1",
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
    providers,
    ethereumFinality: {
      schemaVersion: "programmable.robinhood-l2-checkpoint-ethereum-finality-input.v1",
      l2Checkpoint: { blockNumber, blockHash },
      batchNumber: "153046",
      l2Providers: [
        { providerId: "drpc", trustDomain: "drpc.org", l1Confirmations: "12" },
        { providerId: "alchemy", trustDomain: "alchemy.com", l1Confirmations: "12" },
      ],
      ethereumProviders: [
        { providerId: "drpc", trustDomain: "drpc.org" },
        { providerId: "quicknode", trustDomain: "quicknode.com" },
      ],
      rollup: "0x23A19d23e89166adedbDcB432518AB01e4272D94",
      sequencerInbox: "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
      postingTransactionHash: codeHash("a"),
      postingBlockNumber: "30000000",
      postingBlockHash: codeHash("b"),
      postingLogIndex: "9",
      ethereumFinalizedCheckpoint: {
        blockNumber: "30000012",
        blockHash: codeHash("c"),
        tag: "finalized",
      },
      observedAt: "2026-08-29T18:00:00.000Z",
    },
    sourceVerification: {
      schemaVersion: "programmable.robinhood-custom-launch.source-verification-closure.v1",
      provider: "sourcify-v2",
      graphFactory: {
        chainId: "4663",
        address: ROOTS.graphFactory.address,
        match: "exact",
        standardJsonInputPath:
          "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableCreate2GraphDeployerV1.standard-input.json",
        standardJsonInputSha256:
          "sha256:8ab811a215d70b1d5aef0c71a47153173953ee78d7632725413833888369ec4d",
        verificationResponseDigest: digest("7"),
      },
      programmableLaunchStampRouter: {
        chainId: "4663",
        address: ROOTS.programmableLaunchStampRouter.address,
        match: "exact",
        standardJsonInputPath:
          "contracts/spec/robinhood-custom-launch/standard-json/ProgrammableLaunchStampRouterV1.standard-input.json",
        standardJsonInputSha256:
          "sha256:6abca24d06b013599f4ff63e049976419c3f17455fa9bc343b15ec0d6e6a078a",
        verificationResponseDigest: digest("8"),
      },
      permitAuthority: {
        address: ROOTS.permitAuthority.address,
        kind: "official-source-pinned",
        sourceCommitment:
          "sha256:4591dc35029cba2a869f91919cb3cf7e7c68f26727cc68e4b03d99cdf1bc2ebb",
      },
    },
    sourceClosure: {
      repository: "programmablehq/PROGRAMMABLE",
      branch: "production",
      revision: fixture.revision,
      tree: fixture.tree,
    },
  };
}

function runGit(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

const codeHash = (digit) => `0x${digit.repeat(64)}`;
const digest = (digit) => `sha256:${digit.repeat(64)}`;
