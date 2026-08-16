import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { utils } = require("ethers");
const { Actions, URVersion, V4Planner } = require("@uniswap/v4-sdk");
const { CommandType, RoutePlanner } = require("@uniswap/universal-router-sdk");

const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const MSG_SENDER = "0x0000000000000000000000000000000000000001";
const CURRENCY_A = "0x0000000000000000000000000000000000000011";
const CURRENCY_B = "0x0000000000000000000000000000000000000022";
const CURRENCY_C = "0x0000000000000000000000000000000000000033";
const HOOK = "0x00000000000000000000000000000000000000AA";
const WITNESS = utils.defaultAbiCoder.encode(["uint256"], ["1000000"]);

const vectorsUrl = new URL("./vectors/v4-routing-parity-vectors.json", import.meta.url);
const packageLockUrl = new URL("../package-lock.json", import.meta.url);
const vectors = JSON.parse(await readFile(vectorsUrl, "utf8"));
const packageLock = JSON.parse(await readFile(packageLockUrl, "utf8"));

function finalize(id, planner, currencyIn, currencyOut, takeAmount, refundNativeInput = false) {
  planner.addAction(Actions.SETTLE, [currencyIn, "0", true]);
  planner.addAction(Actions.TAKE, [currencyOut, MSG_SENDER, takeAmount]);

  const routePlanner = new RoutePlanner();
  const finalized = planner.finalize();
  routePlanner.addCommand(CommandType.V4_SWAP, [finalized]);
  if (refundNativeInput) {
    routePlanner.addCommand(CommandType.SWEEP, [ADDRESS_ZERO, MSG_SENDER, "0"]);
  }

  return {
    id,
    actions: planner.actions,
    v4PlannerFinalizedKeccak256: utils.keccak256(finalized),
    routePlannerCommands: routePlanner.commands,
    routePlannerInputKeccak256: utils.keccak256(routePlanner.inputs[0]),
    routePlannerInputCount: routePlanner.inputs.length,
    routePlannerInputKeccak256es: routePlanner.inputs.map((input) => utils.keccak256(input)),
  };
}

function buildVectors() {
  const generated = [];

  let planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{
    poolKey: {
      currency0: CURRENCY_A,
      currency1: CURRENCY_B,
      fee: 3000,
      tickSpacing: 60,
      hooks: HOOK,
    },
    zeroForOne: true,
    amountIn: "1000000000000000000",
    amountOutMinimum: "123",
    hookData: "0x010203",
  }]);
  generated.push(finalize("single-exact-input", planner, CURRENCY_A, CURRENCY_B, "0"));

  planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_OUT_SINGLE, [{
    poolKey: {
      currency0: CURRENCY_A,
      currency1: CURRENCY_B,
      fee: 3000,
      tickSpacing: 60,
      hooks: HOOK,
    },
    zeroForOne: false,
    amountOut: "456",
    amountInMaximum: "789",
    hookData: WITNESS,
  }]);
  generated.push(finalize("single-exact-output", planner, CURRENCY_B, CURRENCY_A, "456"));

  planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN, [{
    currencyIn: CURRENCY_A,
    path: [
      {
        intermediateCurrency: CURRENCY_B,
        fee: 3000,
        tickSpacing: 60,
        hooks: HOOK,
        hookData: "0x3344",
      },
      {
        intermediateCurrency: CURRENCY_C,
        fee: 500,
        tickSpacing: 10,
        hooks: ADDRESS_ZERO,
        hookData: "0x556677",
      },
    ],
    minHopPriceX36: [],
    amountIn: "1000000000000000000",
    amountOutMinimum: "321",
  }], URVersion.V2_1_1);
  generated.push(finalize("multihop-exact-input", planner, CURRENCY_A, CURRENCY_C, "0"));

  planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_OUT, [{
    currencyOut: CURRENCY_C,
    path: [
      {
        intermediateCurrency: CURRENCY_A,
        fee: 500,
        tickSpacing: 10,
        hooks: ADDRESS_ZERO,
        hookData: "0x1122",
      },
      {
        intermediateCurrency: CURRENCY_B,
        fee: 3000,
        tickSpacing: 60,
        hooks: HOOK,
        hookData: WITNESS,
      },
    ],
    minHopPriceX36: [],
    amountOut: "654",
    amountInMaximum: "987",
  }], URVersion.V2_1_1);
  generated.push(finalize("multihop-exact-output", planner, CURRENCY_A, CURRENCY_C, "654"));

  planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_OUT_SINGLE, [{
    poolKey: {
      currency0: ADDRESS_ZERO,
      currency1: CURRENCY_B,
      fee: 3000,
      tickSpacing: 60,
      hooks: HOOK,
    },
    zeroForOne: true,
    amountOut: "456",
    amountInMaximum: "789",
    hookData: WITNESS,
  }]);
  generated.push(finalize(
    "single-exact-output-native-input-refund",
    planner,
    ADDRESS_ZERO,
    CURRENCY_B,
    "456",
    true,
  ));

  return generated;
}

test("pinned V4Planner and RoutePlanner reproduce every checked-in ABI vector", () => {
  assert.deepEqual(buildVectors(), vectors.vectors);
});

test("routing dependencies retain the reviewed exact source and package integrity", () => {
  const expected = [
    ["node_modules/@uniswap/permit2", vectors.compatibilityProfile.permit2.integrity],
    ["node_modules/@uniswap/universal-router", vectors.compatibilityProfile.universalRouter.integrity],
    ["node_modules/@uniswap/universal-router-sdk", vectors.compatibilityProfile.universalRouterSdk.integrity],
    ["node_modules/@uniswap/v4-core", vectors.compatibilityProfile.v4Core.integrity],
    ["node_modules/@uniswap/v4-periphery", vectors.compatibilityProfile.v4Periphery.integrity],
    ["node_modules/@uniswap/v4-sdk", vectors.compatibilityProfile.v4Sdk.integrity],
    ["node_modules/solmate-permit2", vectors.compatibilityProfile.permit2Solmate.integrity],
  ];

  for (const [path, integrity] of expected) {
    assert.equal(packageLock.packages[path].integrity, integrity, `${path} integrity drifted`);
  }
  assert.equal(
    packageLock.packages["node_modules/@uniswap/permit2"].resolved,
    `https://codeload.github.com/Uniswap/permit2/tar.gz/${vectors.compatibilityProfile.permit2.sourceCommit}`,
  );
  assert.equal(
    packageLock.packages["node_modules/solmate-permit2"].resolved,
    `https://codeload.github.com/transmissions11/solmate/tar.gz/${vectors.compatibilityProfile.permit2Solmate.sourceCommit}`,
  );

  const universalRouterArtifact = require(
    "@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json",
  );
  assert.equal(
    utils.keccak256(universalRouterArtifact.bytecode),
    vectors.compatibilityProfile.universalRouter.creationCodeKeccak256,
  );
  assert.equal(
    utils.keccak256(universalRouterArtifact.deployedBytecode),
    vectors.compatibilityProfile.universalRouter.unlinkedRuntimeKeccak256,
  );
});
