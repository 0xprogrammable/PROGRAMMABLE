import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadEnvioCutoverIdentity } from "./cutover-envio.mjs";

const workspace = path.resolve(import.meta.dirname, "../..");

test("historical candidate cutover rejects the current canonical release", async () => {
  await assert.rejects(
    loadEnvioCutoverIdentity({ workspace }),
    /retired release\/candidate runtime identity/u,
  );
});

test("retained candidate evidence is not relabeled as current production", async () => {
  const [candidate, release] = await Promise.all([
    readFile(path.join(workspace, "config/data-pipeline-envio-candidate.v1.json"), "utf8")
      .then(JSON.parse),
    readFile(path.join(workspace, "config/data-pipeline-release.v1.json"), "utf8")
      .then(JSON.parse),
  ]);

  assert.equal(candidate.deploymentLabel, "production-7f24e63");
  assert.equal(candidate.graphqlEndpoint.includes("/d7a39a2/"), true);
  assert.equal(release.envio.deploymentLabel, "production-92f6373");
  assert.equal(release.envio.graphqlEndpoint.includes("/f6714ef/"), true);
  assert.notEqual(candidate.deploymentLabel, release.envio.deploymentLabel);
  assert.notEqual(candidate.graphqlEndpoint, release.envio.graphqlEndpoint);
});
