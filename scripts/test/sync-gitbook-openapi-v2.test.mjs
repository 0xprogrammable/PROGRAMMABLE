import assert from "node:assert/strict";
import { cp, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEVELOPERS_SOURCE,
  GITBOOK_ENTRYPOINT,
  GITBOOK_RECEIPT,
  GITBOOK_SCHEMA_ROOT,
  checkGitBookOpenApiMirror,
  syncGitBookOpenApiMirror,
} from "../sync-gitbook-openapi-v2.mjs";

const repositoryRoot = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

test("committed GitBook OpenAPI mirror is the complete pinned local closure", async () => {
  const result = await checkGitBookOpenApiMirror({ repositoryRoot });
  assert.equal(
    DEVELOPERS_SOURCE.commit,
    "edaa839148897781c710d92650dbf9f1f52a86e8",
  );
  assert.equal(result.entrypointDigest, `sha256:${DEVELOPERS_SOURCE.entrypointSha256}`);
  assert.equal(result.localDocumentCount, 18);
  assert.equal(result.localReferenceDocumentCount, 17);
  assert.equal(result.externalReferences.length, 1);
  assert.match(result.closureDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.receiptDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("offline check rejects mirrored byte drift", async () => {
  const fixture = await materializeMirror();
  try {
    await writeFile(
      path.join(fixture, GITBOOK_SCHEMA_ROOT, "problem.schema.json"),
      "{}\n",
    );
    await assert.rejects(
      checkGitBookOpenApiMirror({ repositoryRoot: fixture }),
      /byte drift|digest drift/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("offline check rejects missing and unexpected transitive schema files", async () => {
  const missing = await materializeMirror();
  try {
    await unlink(path.join(missing, GITBOOK_SCHEMA_ROOT, "common.schema.json"));
    await assert.rejects(
      checkGitBookOpenApiMirror({ repositoryRoot: missing }),
      /Missing GitBook OpenAPI schema files/u,
    );
  } finally {
    await rm(missing, { recursive: true, force: true });
  }

  const unexpected = await materializeMirror();
  try {
    await writeFile(
      path.join(unexpected, GITBOOK_SCHEMA_ROOT, "not-in-closure.schema.json"),
      "{}\n",
    );
    await assert.rejects(
      checkGitBookOpenApiMirror({ repositoryRoot: unexpected }),
      /Unexpected GitBook OpenAPI schema entries/u,
    );
  } finally {
    await rm(unexpected, { recursive: true, force: true });
  }
});

test("write mode rejects a repository that is not the pinned Developers commit", async () => {
  await assert.rejects(
    syncGitBookOpenApiMirror({
      developersRoot: repositoryRoot,
      repositoryRoot,
    }),
    /Developers commit drift/u,
  );
});

async function materializeMirror() {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "programmable-gitbook-openapi-"));
  await Promise.all([
    cp(
      path.join(repositoryRoot, GITBOOK_ENTRYPOINT),
      path.join(fixture, GITBOOK_ENTRYPOINT),
      { recursive: true },
    ),
    cp(
      path.join(repositoryRoot, GITBOOK_RECEIPT),
      path.join(fixture, GITBOOK_RECEIPT),
      { recursive: true },
    ),
    cp(
      path.join(repositoryRoot, GITBOOK_SCHEMA_ROOT),
      path.join(fixture, GITBOOK_SCHEMA_ROOT),
      { recursive: true },
    ),
  ]);
  return fixture;
}
