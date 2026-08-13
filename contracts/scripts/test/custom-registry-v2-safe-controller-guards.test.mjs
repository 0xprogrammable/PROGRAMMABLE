import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDistinctControllerOwners,
  assertSafeRuntimeState,
  predictSafeProxyAddress,
  safeInitializer,
} from "../custom-registry-v2-safe-controller-guards.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const setup = {
  threshold: 1,
  to: ZERO,
  data: "0x",
  fallbackHandler: ZERO,
  paymentToken: ZERO,
  payment: "0",
  paymentReceiver: ZERO,
};

test("predicts a stable owner-bound Safe CREATE2 address", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const initializer = safeInitializer(owner, setup);
  const input = {
    factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    proxyCreationCode: "0x6080604052600080fd",
    initializer,
    saltNonce: "1",
  };
  const first = predictSafeProxyAddress(input);
  assert.equal(first, predictSafeProxyAddress(input));
  assert.notEqual(first, predictSafeProxyAddress({ ...input, saltNonce: "2" }));
  assert.notEqual(
    first,
    predictSafeProxyAddress({
      ...input,
      initializer: safeInitializer(
        "0x2222222222222222222222222222222222222222",
        setup,
      ),
    }),
  );
});

test("requires isolated deployer, admin, release owner, and Safe owners", () => {
  const addresses = Array.from(
    { length: 7 },
    (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
  );
  assert.doesNotThrow(() =>
    assertDistinctControllerOwners({
      deployer: addresses[0],
      admin: addresses[1],
      releaseOwner: addresses[2],
      owners: addresses.slice(3),
    }),
  );
  assert.throws(
    () =>
      assertDistinctControllerOwners({
        deployer: addresses[0],
        admin: addresses[1],
        releaseOwner: addresses[2],
        owners: [addresses[3], addresses[3], addresses[5], addresses[6]],
      }),
    /must be distinct/u,
  );
});

test("requires one owner, threshold one, no modules, fallback, or guard", () => {
  const expected = {
    version: "1.4.1",
    singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
    owner: "0x1111111111111111111111111111111111111111",
  };
  const actual = {
    version: "1.4.1",
    masterCopy: expected.singleton,
    owners: [expected.owner],
    threshold: 1n,
    modules: [],
    nextModule: "0x0000000000000000000000000000000000000001",
    fallbackStorage: `0x${"0".repeat(64)}`,
    guardStorage: `0x${"0".repeat(64)}`,
  };
  assert.doesNotThrow(() => assertSafeRuntimeState({ actual, expected }));
  assert.throws(
    () =>
      assertSafeRuntimeState({
        actual: { ...actual, threshold: 2n },
        expected,
      }),
    /state is invalid/u,
  );
});
