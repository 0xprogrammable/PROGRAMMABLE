import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  assertCentralBaseUnchanged,
  deriveApplicationRevision,
  resolveCentralApplicationBase
} from "../cli-central-base.mjs";
import { CENTRAL_APPLICATION_FILES } from "../cli-central-package.mjs";
import { CliFailure } from "../cli-runtime.mjs";
import { canonicalJson } from "../submission-core.mjs";

const baseCommit = "a".repeat(40);
const baseTree = "b".repeat(40);
const movedCommit = "c".repeat(40);
const primaryCommit = "d".repeat(40);
const primaryTree = "e".repeat(40);
const builderIdentity = Object.freeze({ githubUserId: "9007199254740993", githubLogin: "example" });

test("resolves a first revision from the fixed central ref and immutable tree without credentials", async () => {
  const fixture = createCentralFetch();
  const observed = await resolveCentralApplicationBase({
    baseBranch: "main",
    applicationId: "example-app",
    fetchImplementation: fixture.fetch,
    sleepImplementation: async () => {}
  });

  assert.equal(observed.repositorySlug, "0xprogrammable/submit-launch");
  assert.equal(observed.baseCommit, baseCommit);
  assert.equal(observed.baseTree, baseTree);
  assert.equal(observed.existingApplication, false);
  assert.equal(observed.priorApplication, null);
  assert.equal(observed.priorCentralPackage, null);
  assert.equal(deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: null,
    nextBuilder: builderIdentity,
    nextSource: makeSource()
  }), 1);
  assert.equal(fixture.calls.length, 3);
  for (const { options } of fixture.calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "User-Agent", "X-GitHub-Api-Version"].sort());
  }
});

test("loads one exact canonical prior package and derives the next revision", async () => {
  const prior = makePriorPackage({ applicationRevision: 7 });
  const fixture = createCentralFetch({ files: prior.files });
  const observed = await resolveCentralApplicationBase({
    baseBranch: "main",
    applicationId: "example-app",
    fetchImplementation: fixture.fetch,
    sleepImplementation: async () => {}
  });

  assert.equal(observed.existingApplication, true);
  assert.equal(observed.priorApplicationRevision, 7);
  assert.equal(observed.priorCentralPackage.compatibilityResult, "architecture-review-required");
  assert.deepEqual(observed.priorCentralPackage.fileOrder, CENTRAL_APPLICATION_FILES);
  assert.deepEqual(
    observed.priorCentralPackage.files.map(({ content }) => content),
    CENTRAL_APPLICATION_FILES.map((name) => prior.files.get(name).toString("utf8"))
  );

  const nextSource = makeSource({
    primary: makeRepository({ commit: "f".repeat(40), tree: "1".repeat(40) })
  });
  assert.equal(deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: observed.priorApplication,
    nextBuilder: builderIdentity,
    nextSource
  }), 8);
});

test("rejects stale or malicious prior bytes even when Git blob identities are self-consistent", async () => {
  const prior = makePriorPackage();
  prior.files.set("PROPOSAL.md", Buffer.from("# Proposal\nmalicious replacement bytes that do not match the prior review index\n"));
  const fixture = createCentralFetch({ files: prior.files });
  await rejectsCode(
    () => resolveCentralApplicationBase({
      baseBranch: "main",
      applicationId: "example-app",
      fetchImplementation: fixture.fetch,
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_INVALID"
  );

  const noncanonical = makePriorPackage();
  const application = JSON.parse(noncanonical.files.get("application.json").toString("utf8"));
  noncanonical.files.set("application.json", Buffer.from(`${JSON.stringify(application, null, 2)}\n`));
  await rejectsCode(
    () => resolveCentralApplicationBase({
      baseBranch: "main",
      applicationId: "example-app",
      fetchImplementation: createCentralFetch({ files: noncanonical.files }).fetch,
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_INVALID"
  );

  const mismatchedCompatibility = makePriorPackage();
  const compatibility = JSON.parse(
    mismatchedCompatibility.files.get("compatibility-report.json").toString("utf8")
  );
  compatibility.source.revisionObjectId = "9".repeat(40);
  mismatchedCompatibility.files.set(
    "compatibility-report.json",
    Buffer.from(`${canonicalJson(compatibility)}\n`)
  );
  await rejectsCode(
    () => resolveCentralApplicationBase({
      baseBranch: "main",
      applicationId: "example-app",
      fetchImplementation: createCentralFetch({ files: mismatchedCompatibility.files }).fetch,
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_INVALID"
  );
});

test("rejects same-value, conflicting and escaped duplicate keys in central GitHub JSON before projection", async () => {
  const secret = "central-private-key-must-not-echo";
  const applicationDuplicates = [
    `"applicationRevision":1,"privateKey":"${secret}"`,
    `"applicationRevision":2,"privateKey":"${secret}"`,
    `"applicationRevisi\\u006fn":2,"privateKey":"${secret}"`
  ];
  const compatibilityDuplicates = [
    `"result":"architecture-review-required","privateKey":"${secret}"`,
    `"result":"prototype-ready","privateKey":"${secret}"`,
    `"res\\u0075lt":"prototype-ready","privateKey":"${secret}"`
  ];

  for (const [name, variants] of [
    ["application.json", applicationDuplicates],
    ["compatibility-report.json", compatibilityDuplicates]
  ]) {
    for (const duplicate of variants) {
      const prior = makePriorPackage();
      const source = prior.files.get(name).toString("utf8").trimEnd();
      prior.files.set(name, Buffer.from(`${source.slice(0, -1)},${duplicate}}\n`));
      await assert.rejects(
        resolveCentralApplicationBase({
          baseBranch: "main",
          applicationId: "example-app",
          fetchImplementation: createCentralFetch({ files: prior.files }).fetch,
          sleepImplementation: async () => {}
        }),
        (error) => {
          assert.equal(error?.code, "CENTRAL_BASE_INVALID");
          assert.equal(String(error?.message).includes(secret), false);
          return true;
        }
      );
    }
  }
});

test("accepts a companion-only authority revision but blocks unchanged, locator-only and incoherent sources", () => {
  const companionBefore = makeRepository({
    id: "22",
    uri: "https://github.com/example/companion",
    commit: "2".repeat(40),
    tree: "3".repeat(40)
  });
  const priorSource = makeSource({ companions: [companionBefore] });
  const prior = makePriorPackage({ source: priorSource, applicationRevision: 3 }).application;
  const companionAfter = makeRepository({
    id: "22",
    uri: "https://github.com/example/companion",
    commit: "4".repeat(40),
    tree: "5".repeat(40)
  });

  assert.equal(deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: { ...builderIdentity, githubLogin: "renamed-example" },
    nextSource: makeSource({ companions: [companionAfter] })
  }), 4);
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: { githubUserId: "999", githubLogin: "example" },
    nextSource: makeSource({ companions: [companionAfter] })
  }), "BUILDER_IDENTITY_CHANGED");
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: builderIdentity,
    nextSource: priorSource
  }), "SOURCE_REVISION_UNCHANGED");
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: builderIdentity,
    nextSource: makeSource({
      primary: makeRepository({ uri: "https://github.com/renamed/project" }),
      companions: [companionBefore]
    })
  }), "SOURCE_REVISION_UNCHANGED");
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: builderIdentity,
    nextSource: makeSource({
      primary: makeRepository({ commit: "6".repeat(40), tree: primaryTree }),
      companions: [companionBefore]
    })
  }), "SOURCE_REVISION_INCOHERENT");
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: builderIdentity,
    nextSource: makeSource({
      primary: makeRepository({ commit: primaryCommit, tree: "6".repeat(40) }),
      companions: [companionBefore]
    })
  }), "SOURCE_REVISION_INCOHERENT");
  rejectsSyncCode(() => deriveApplicationRevision({
    applicationId: "example-app",
    priorApplication: prior,
    nextBuilder: builderIdentity,
    nextSource: makeSource({
      primary: makeRepository({ id: "999", commit: "6".repeat(40), tree: "7".repeat(40) }),
      companions: [companionBefore]
    })
  }), "PRIMARY_SOURCE_LINEAGE_CHANGED");
});

test("detects a central base ref move before materialization", async () => {
  const fixture = createCentralFetch({ refCommits: [baseCommit, movedCommit] });
  const observed = await resolveCentralApplicationBase({
    baseBranch: "main",
    applicationId: "example-app",
    fetchImplementation: fixture.fetch,
    sleepImplementation: async () => {}
  });
  await rejectsCode(
    () => assertCentralBaseUnchanged({
      observation: observed,
      fetchImplementation: fixture.fetch,
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_MOVED"
  );
});

test("rejects unsafe central branch input before network access", async () => {
  let fetches = 0;
  await rejectsCode(
    () => resolveCentralApplicationBase({
      baseBranch: "refs/heads/main",
      applicationId: "example-app",
      fetchImplementation: async () => {
        fetches += 1;
        throw new Error("must not fetch");
      },
      sleepImplementation: async () => {}
    }),
    "CENTRAL_BASE_INVALID"
  );
  assert.equal(fetches, 0);
});

function makePriorPackage({ applicationRevision = 1, source = makeSource() } = {}) {
  const files = new Map([
    ["PROPOSAL.md", Buffer.from("# Proposal\nA substantive canonical proposal body for central revision testing.\n")],
    ["TEST_PLAN.md", Buffer.from("# Test plan\nA substantive canonical test plan body for central revision testing.\n")],
    ["THREAT_MODEL.md", Buffer.from("# Threat model\nA substantive canonical threat model body for central revision testing.\n")],
    ["compatibility-report.json", Buffer.from(`${canonicalJson({
      schemaVersion: 1,
      applicationId: "example-app",
      source: {
        numericRepositoryId: source.primary.numericRepositoryId,
        revisionObjectId: source.primary.revisionObjectId,
        treeObjectId: source.primary.treeObjectId
      },
      result: "architecture-review-required",
      findings: [],
      disclaimer: "Builder-declared compatibility evidence; not an audit, approval, deployment, Uniswap endorsement, or launch."
    })}\n`)],
    ["evidence-index.json", Buffer.from("{\"evidence\":[]}\n")]
  ]);
  const application = {
    schemaVersion: 2,
    applicationId: "example-app",
    applicationRevision,
    stage: "proposal",
    title: "Example App",
    summary: "A sufficiently complete summary for deterministic central revision tests.",
    builder: {
      githubUserId: builderIdentity.githubUserId,
      githubLogin: "example",
      contact: "https://github.com/example"
    },
    builderTemplate: {
      schemaVersion: "1.0.0",
      source: "manual",
      templateSelection: null
    },
    source,
    programmableFee: {},
    reviewPackage: CENTRAL_APPLICATION_FILES.slice(1).map((name) => ({
      path: name,
      sha256: digest(files.get(name)),
      byteLength: files.get(name).length
    })),
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true
    }
  };
  files.set("application.json", Buffer.from(`${canonicalJson(application)}\n`));
  return {
    application,
    files: new Map(CENTRAL_APPLICATION_FILES.map((name) => [name, files.get(name)]))
  };
}

function makeSource({ primary = makeRepository(), companions = [] } = {}) {
  return {
    schemaVersion: "1.0.0",
    primary,
    companions
  };
}

function makeRepository({
  id = "11",
  uri = "https://github.com/example/project",
  commit = primaryCommit,
  tree = primaryTree
} = {}) {
  return {
    repositoryUri: uri,
    numericRepositoryId: id,
    revisionObjectId: commit,
    treeObjectId: tree,
    sourcePaths: [],
    contractPaths: [],
    githubActionsRunIds: []
  };
}

function createCentralFetch({ files = null, refCommits = [baseCommit] } = {}) {
  const calls = [];
  let refReads = 0;
  const submissionsTree = "7".repeat(40);
  const applicationTree = "8".repeat(40);
  const blobs = files === null
    ? new Map()
    : new Map([...files].map(([name, bytes]) => [name, { bytes, sha: gitBlobDigest(bytes) }]));
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const prefix = "https://api.github.com/repos/0xprogrammable/submit-launch";
    if (url === `${prefix}/git/ref/heads/main`) {
      const commit = refCommits[Math.min(refReads, refCommits.length - 1)];
      refReads += 1;
      return response(200, {
        ref: "refs/heads/main",
        object: { type: "commit", sha: commit }
      });
    }
    if (url === `${prefix}/git/commits/${baseCommit}`) {
      return response(200, { sha: baseCommit, tree: { sha: baseTree } });
    }
    if (url === `${prefix}/git/trees/${baseTree}`) {
      return response(200, {
        sha: baseTree,
        truncated: false,
        tree: files === null ? [] : [treeEntry("submissions", "040000", "tree", submissionsTree)]
      });
    }
    if (url === `${prefix}/git/trees/${submissionsTree}`) {
      return response(200, {
        sha: submissionsTree,
        truncated: false,
        tree: [treeEntry("example-app", "040000", "tree", applicationTree)]
      });
    }
    if (url === `${prefix}/git/trees/${applicationTree}`) {
      return response(200, {
        sha: applicationTree,
        truncated: false,
        tree: CENTRAL_APPLICATION_FILES.map((name) => treeEntry(name, "100644", "blob", blobs.get(name).sha))
      });
    }
    for (const { bytes, sha } of blobs.values()) {
      if (url === `${prefix}/git/blobs/${sha}`) {
        return response(200, { sha, encoding: "base64", content: bytes.toString("base64") });
      }
    }
    throw new Error(`unexpected central URL: ${url}`);
  };
  return { calls, fetch };
}

function treeEntry(path, mode, type, sha) {
  return { path, mode, type, sha };
}

function response(status, value) {
  const source = canonicalJson(value);
  return {
    status,
    redirected: false,
    url: "",
    headers: {
      get(name) {
        if (name.toLowerCase() === "content-length") return String(Buffer.byteLength(source));
        if (name.toLowerCase() === "content-type") return "application/json";
        return null;
      }
    },
    async arrayBuffer() {
      return Buffer.from(source);
    }
  };
}

function gitBlobDigest(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

async function rejectsCode(operation, code) {
  await assert.rejects(Promise.resolve().then(operation), (error) => {
    assert.ok(error instanceof CliFailure, error?.stack ?? String(error));
    assert.equal(error.code, code);
    return true;
  });
}

function rejectsSyncCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof CliFailure, error?.stack ?? String(error));
    assert.equal(error.code, code);
    return true;
  });
}
