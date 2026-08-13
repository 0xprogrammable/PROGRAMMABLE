import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCustomRegistryV2ProductionConstructor,
  loadCustomRegistryV2ProductionPolicy,
} from "../custom-registry-v2-production-policy.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("binds the production constructor to exact committed policy bytes", async () => {
  const loaded = await loadCustomRegistryV2ProductionPolicy(root);
  assert.match(loaded.registryPolicyCommitment, /^0x[0-9a-f]{64}$/u);
  assert.doesNotThrow(() =>
    assertCustomRegistryV2ProductionConstructor(
      {
        initialAdminDelay: 172800n,
        minimumFinalityBlocks: 12n,
        registryPolicyCommitment: loaded.registryPolicyCommitment,
      },
      loaded,
    ),
  );
  assert.throws(
    () =>
      assertCustomRegistryV2ProductionConstructor(
        {
          initialAdminDelay: 172800n,
          minimumFinalityBlocks: 3n,
          registryPolicyCommitment: loaded.registryPolicyCommitment,
        },
        loaded,
      ),
    /committed production policy/u,
  );
});
