import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyRuntimeSnapshot,
  verifySafeDeploymentRecord,
  verifyUniswapRegistry,
} from "../robinhood-custom-launch-bindings-core.mjs";
import { prepareOwnerTransaction } from "../prepare-robinhood-custom-launch-owner-transaction.mjs";

const uniswap = {
  poolManager: { address: "0x8366a39cc670b4001a1121b8f6a443a643e40951" },
  positionManager: { address: "0x58daec3116aae6d93017baaea7749052e8a04fa7" },
  v4Quoter: { address: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" },
  stateView: { address: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" },
  permit2: { address: "0x000000000022d473030f116ddee9f6b43ac78ba3" },
  universalRouter: { address: "0x06afba43fd06227fa663b0daecf536f6eaa6bf99" },
};

function registry() {
  return {
    chainId: "4663",
    latest: {
      PoolManager: { address: uniswap.poolManager.address },
      PositionManager: { address: uniswap.positionManager.address },
      V4Quoter: { address: uniswap.v4Quoter.address },
      StateView: { address: uniswap.stateView.address },
      Permit2: { address: uniswap.permit2.address },
      UniversalRouter: { address: uniswap.universalRouter.address },
    },
  };
}

test("accepts the exact current Uniswap 4663 registry bindings", () => {
  assert.deepEqual(
    verifyUniswapRegistry({ registry: registry(), expectedBindings: uniswap }),
    {
      verifiedCount: 6,
    },
  );
});

test("rejects the superseded orphaned Universal Router", () => {
  const mutated = registry();
  mutated.latest.UniversalRouter.address =
    "0x8876789976decbfcbbbe364623c63652db8c0904";
  assert.throws(
    () =>
      verifyUniswapRegistry({ registry: mutated, expectedBindings: uniswap }),
    /registry drift for universalRouter/iu,
  );
});

test("requires the Safe 1.4.1 canonical deployment on chain 4663", () => {
  const record = {
    version: "1.4.1",
    networkAddresses: { 4663: "canonical" },
    deployments: {
      canonical: { address: "0x41675C099F32341bf84BFc5382aF534df5C7461a" },
    },
  };
  assert.deepEqual(
    verifySafeDeploymentRecord({
      record,
      expectedAddress: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
      label: "safeSingleton",
    }),
    { address: "0x41675C099F32341bf84BFc5382aF534df5C7461a" },
  );
  record.networkAddresses["4663"] = "unofficial";
  assert.throws(
    () =>
      verifySafeDeploymentRecord({
        record,
        expectedAddress: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
        label: "safeSingleton",
      }),
    /no canonical chain 4663 deployment/iu,
  );
});

test("distinguishes required runtime hashes from prepared vacant addresses", () => {
  const binding = {
    contract: {
      address: "0x1111111111111111111111111111111111111111",
      runtimeCodeHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  };
  const deployed = {
    contracts: {
      contract: {
        code: "0x6000",
        runtimeCodeHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    },
  };
  assert.deepEqual(
    verifyRuntimeSnapshot({ snapshot: deployed, expectedBindings: binding }),
    {
      verifiedCount: 1,
    },
  );
  assert.throws(
    () =>
      verifyRuntimeSnapshot({
        snapshot: deployed,
        expectedBindings: binding,
        expectVacant: true,
      }),
    /no longer vacant/iu,
  );
  const vacant = {
    contracts: { contract: { code: "0x", runtimeCodeHash: null } },
  };
  assert.deepEqual(
    verifyRuntimeSnapshot({
      snapshot: vacant,
      expectedBindings: binding,
      expectVacant: true,
    }),
    { verifiedCount: 1 },
  );
});

test("builds the exact atomic owner transaction without signing", async () => {
  const prepared = await prepareOwnerTransaction(
    "0x032b1c7b96793717F0BD2f11eb86cd10CdefC4a3",
  );
  assert.equal(prepared.to, "0xcA11bde05977b3631167028862bE2a173976CA11");
  assert.equal(prepared.value, "0x0");
  assert.equal(
    prepared.dataHash,
    "0x3ba04469085b17e12843a94c154a335c9c384837f8f6531f179cb4915fd237d9",
  );
  assert.equal(prepared.dataBytes, 33_412);
  assert.equal(prepared.decodedComponentCalls.length, 3);
  assert.equal(prepared.automaticSigningOrBroadcast, false);
});

test("rejects an unobserved deployment sender", async () => {
  await assert.rejects(
    prepareOwnerTransaction("0x1111111111111111111111111111111111111111"),
    /must be 0x032b1c7b/iu,
  );
});
