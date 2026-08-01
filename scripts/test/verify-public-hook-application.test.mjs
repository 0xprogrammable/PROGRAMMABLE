import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "./schema-validator/node_modules/ajv/dist/2020.js";

import {
  canonicalJson,
  classifyPublicIntakePullRequest,
  createTrustedPublicApplicationResolutionSessionV1,
  PUBLIC_APPLICATION_FILES,
  PUBLIC_APPLICATION_SCHEMA_ID,
  PUBLIC_BETA_DISCLAIMER,
  PUBLIC_INTAKE_STATES,
  PublicIntakeError,
  resolvePublicApplicationEvidence,
  resolvePublicCompanionClosure,
  resolvePublicGitHubSource,
  validatePublicApplicationPackageFiles,
  verifyPublicHookApplication,
  VALIDATOR_VERSION
} from "../verify-public-hook-application-core.mjs";
import {
  generatePublicApplicationSchema,
  serializePublicApplicationSchema
} from "../../skills/programmable-v4-hook-builder/scripts/generate-public-pr-application-schema.mjs";
import { GitHubPublicSourceError } from "../../skills/programmable-v4-hook-builder/scripts/github-public-source-core.mjs";
import {
  COMPANION_MANIFEST_V2,
  verifyCompanionManifestV2Closure
} from "../../skills/programmable-v4-hook-builder/scripts/companion-manifest-contract.mjs";

const PRIMARY = Object.freeze({
  repositoryUri: "https://github.com/alice/example-hook",
  numericRepositoryId: "123456789",
  revisionObjectId: "a".repeat(40),
  treeObjectId: "b".repeat(40),
  sourcePaths: ["compatibility-report.json", "test/ExampleHook.t.sol"],
  contractPaths: ["src/ExampleHook.sol"],
  githubActionsRunIds: []
});
const BUILDER_USER_ID = "9007199254740993";
const PULL_REQUEST_NUMBER = "7";
const EVIDENCE_BYTES = Buffer.from("exact builder-owned compatibility evidence for the declared source revision\n", "utf8");
const EVIDENCE_SHA256 = `sha256:${crypto.createHash("sha256").update(EVIDENCE_BYTES).digest("hex")}`;

test("the frozen six-file package and public schema identity are exported", () => {
  assert.equal(VALIDATOR_VERSION, "1.8.0");
  assert.deepEqual(PUBLIC_APPLICATION_FILES, [
    "application.json",
    "PROPOSAL.md",
    "TEST_PLAN.md",
    "THREAT_MODEL.md",
    "compatibility-report.json",
    "evidence-index.json"
  ]);
  assert.equal(PUBLIC_APPLICATION_SCHEMA_ID, "https://programmable.money/schemas/public-pr-application-v1.json");
  assert.deepEqual(PUBLIC_INTAKE_STATES, ["prelaunch", "open", "paused-new", "paused-all"]);
});

test("the checked-in trusted intake status is a closed canonical regular file", () => {
  const statusPath = path.resolve("docs/builder/intake-status.json");
  const status = fs.lstatSync(statusPath);
  assert.equal(status.isSymbolicLink(), false);
  assert.equal(status.isFile(), true);
  assert.equal(status.mode & 0o111, 0);
  const source = fs.readFileSync(statusPath, "utf8");
  assert.ok(Buffer.byteLength(source, "utf8") <= 32 * 1024);
  const value = JSON.parse(source);
  assert.deepEqual(Object.keys(value).sort(compareUtf8), ["continuingPullRequests", "schemaVersion", "state"]);
  assert.equal(value.schemaVersion, 2);
  assert.ok(PUBLIC_INTAKE_STATES.includes(value.state));
  assert.deepEqual(value.continuingPullRequests, []);
  assert.equal(source, `${canonicalJson(value)}\n`);
});

test("pure package validation accepts a canonical hash-bound review package", () => {
  const files = makePackage();
  const result = validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files });
  assert.equal(result.application.applicationRevision, 1);
  assert.equal(result.compatibility.result, "architecture-review-required");
  assert.equal(result.evidenceIndex.attestation, "builder-declared-untrusted");
});

test("a generated valid package matches the published application schema and review order contract", () => {
  const schemaPath = path.resolve(
    "skills/programmable-v4-hook-builder/references/public-pr-application.schema.json"
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const sourceSchema = JSON.parse(fs.readFileSync(
    path.join(path.dirname(schemaPath), "github-public-source-contract-v1.schema.json"),
    "utf8"
  ));
  const application = makeSchemaApplication();
  assert.equal(schema.$id, PUBLIC_APPLICATION_SCHEMA_ID);
  assert.equal(
    schema.properties.source.$ref,
    "#/$defs/githubSource__GitHubPublicSourceRequestV1"
  );
  assert.deepEqual(schema["x-programmable-derived-from"], {
    schemaId: sourceSchema.$id,
    definition: "#/$defs/GitHubPublicSourceRequestV1",
    semanticSha256: "sha256:a5f4aafaf3cb497701e628359dcc25f3079a729e658d9fe0d53f1b5d55e38145"
  });
  assert.equal(
    serializePublicApplicationSchema(generatePublicApplicationSchema(schema, sourceSchema)),
    fs.readFileSync(schemaPath, "utf8"),
    "the self-contained schema must be a deterministic projection of the canonical source schema"
  );
  assert.deepEqual(
    collectSchemaReferences(schema).filter((reference) => !reference.startsWith("#")),
    [],
    "portable application schemas must not require an external reference resolver"
  );
  assert.equal(sourceSchema.$defs.GitHubPublicSourceRequestV1.properties.companions.maxItems, 8);
  assert.equal(sourceSchema.$defs.GitHubPublicRepositoryRequestV1.properties.sourcePaths.maxItems, 512);
  assert.equal(sourceSchema.$defs.GitHubPublicRepositoryRequestV1.properties.contractPaths.maxItems, 512);
  assert.deepEqual(
    sourceSchema.$defs.GitHubPublicRepositoryRequestV1.required,
    ["repositoryUri", "numericRepositoryId", "revisionObjectId", "treeObjectId"]
  );
  assert.deepEqual(Object.keys(application).sort(compareUtf8), [...schema.required].sort(compareUtf8));
  const schemaReviewOrder = schema.properties.reviewPackage.prefixItems.map(
    (entry) => schema.$defs[entry.$ref.split("/").at(-1)].allOf[1].properties.path.const
  );
  const schemaReviewByteLimits = schema.properties.reviewPackage.prefixItems.map((entry) => {
    const definition = schema.$defs[entry.$ref.split("/").at(-1)];
    return definition.allOf[1].properties.byteLength?.maximum
      ?? schema.$defs.reviewRecord.properties.byteLength.maximum;
  });
  assert.deepEqual(application.reviewPackage.map((entry) => entry.path), schemaReviewOrder);
  assert.deepEqual(schemaReviewOrder, PUBLIC_APPLICATION_FILES.filter((entry) => entry !== "application.json"));
  assert.deepEqual(schemaReviewByteLimits, [65536, 65536, 65536, 163840, 163840]);
});

test("a draft 2020-12 validator accepts the canonical application and resolves every reference locally", () => {
  const validate = compilePublicApplicationSchema();
  const application = makeSchemaApplication();
  application.source.primary.numericRepositoryId = "9".repeat(64);
  application.source.primary.sourcePaths = Array.from(
    { length: 512 },
    (_, index) => `src/échange hook ${String(index).padStart(3, "0")}.sol`
  );
  assert.equal(validate(application), true, JSON.stringify(validate.errors));
});

test("the public application schema rejects adversarial source and package manifests", () => {
  const validApplication = makeSchemaApplication();
  const cases = [
    ["stage is mandatory", (value) => { delete value.stage; }],
    ["companion closure receipt index is mandatory", (value) => { delete value.companionClosure; }],
    ["stage cannot claim candidate readiness", (value) => { value.stage = "candidate"; }],
    ["numeric repository ids are opaque strings", (value) => { value.source.primary.numericRepositoryId = 9007199254740992; }],
    ["leading-zero repository ids are non-canonical", (value) => { value.source.primary.numericRepositoryId = "0123"; }],
    ["mixed-case repository URIs are non-canonical", (value) => { value.source.primary.repositoryUri = "https://github.com/Alice/example-hook"; }],
    ["path traversal is forbidden", (value) => { value.source.primary.sourcePaths = ["../secret.sol"]; }],
    ["source records remain closed", (value) => { value.source.primary.branch = "main"; }],
    ["companion repositories stay bounded", (value) => { value.source.companions = Array.from({ length: 9 }, () => structuredClone(value.source.primary)); }],
    ["review files cannot be reordered", (value) => { [value.reviewPackage[0], value.reviewPackage[1]] = [value.reviewPackage[1], value.reviewPackage[0]]; }],
    ["review hashes must be lowercase SHA-256", (value) => { value.reviewPackage[0].sha256 = `sha256:${"A".repeat(64)}`; }],
    ["declarations are fail-closed", (value) => { value.declarations.noUniswapEndorsementClaim = false; }],
    ["builder user ids are opaque strings", (value) => { value.builder.githubUserId = 9007199254740992; }],
    ["leading-zero builder user ids are non-canonical", (value) => { value.builder.githubUserId = "0123"; }],
    ["builder contact must be an absolute URI", (value) => { value.builder.contact = "/relative"; }]
  ];
  for (const [name, mutate] of cases) {
    const candidate = structuredClone(validApplication);
    mutate(candidate);
    const validate = compilePublicApplicationSchema();
    assert.equal(validate(candidate), false, `${name}: schema unexpectedly accepted the candidate`);
    assert.ok(validate.errors?.length > 0, `${name}: validator did not report an error`);
  }
});

test("trusted intake accepts one new application and verifies exact public source identity", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "add application");
  const report = await verifyPublicHookApplication(inputFor(fixture, candidateCommit));
  assert.equal(report.result, "valid-public-application-package");
  assert.equal(report.intakeState, "open");
  assert.equal(report.applicationId, "example-hook");
  assert.match(report.mergeCommit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(report.builderIdentity, {
    authentication: "github-pull-request-author",
    immutableGitHubUserId: BUILDER_USER_ID,
    authenticatedLogin: "alice",
    manifestLogin: "alice",
    normalizedLogin: "alice",
    provesSourceRepositoryOwnership: false
  });
  assert.deepEqual(report.sourceBinding.primary, {
    repositoryUri: PRIMARY.repositoryUri,
    numericRepositoryId: PRIMARY.numericRepositoryId,
    revisionObjectId: PRIMARY.revisionObjectId,
    treeObjectId: PRIMARY.treeObjectId
  });
  assert.equal(report.evidenceBindings[0].sha256, EVIDENCE_SHA256);
  assert.equal(report.evidenceBindings[0].statusAuthority, "builder-declared-untrusted");
});

test("trusted intake independently recomputes an exact companion v2 receipt", async (t) => {
  const closure = makeCompanionClosureFixture();
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage({
    primary: closure.primary,
    mutateApplication(application) {
      application.source = makeSourceRequest(closure.primary, [closure.companion]);
      application.companionClosure = [closure.receipt];
    }
  }));
  const candidateCommit = commitAll(fixture.candidate, "add exact companion closure application");
  const report = await verifyPublicHookApplication({
    ...inputFor(fixture, candidateCommit),
    resolveCompanionClosure(request) {
      return resolvePublicCompanionClosure(request, {
        exactObjectResolver: closure.exactObjectResolver
      });
    }
  });
  assert.equal(report.result, "valid-public-application-package");
  assert.equal(closure.requests.length, 2);
  assert.deepEqual(closure.requests[0].paths, [closure.manifestPath]);
  assert.deepEqual(closure.requests[1].paths, [
    ".github/workflows/ci.yml",
    "index.html",
    "package-lock.json",
    "package.json",
    "src/main.js",
    "src/math.js",
    "test/main.test.js"
  ]);
});

test("a handcrafted six-file PR cannot forge companion receipt facts", async (t) => {
  const mutations = [
    ["status", (receipt) => { receipt.status = "builder-verified"; }, "COMPANION_CLOSURE_RECEIPT_INVALID"],
    ["closure hash", (receipt) => { receipt.closureHash = `sha256:${"f".repeat(64)}`; }],
    ["file count", (receipt) => { receipt.fileCount += 1; }],
    ["package count", (receipt) => { receipt.packageCount += 1; }],
    ["dependency count", (receipt) => { receipt.dependencyEdgeCount += 1; }],
    ["module count", (receipt) => { receipt.moduleResolutionCount += 1; }],
    ["workflow object", (receipt) => { receipt.workflowReceipts[0].workflowObjectId = "f".repeat(40); }],
    ["build script", (receipt) => { receipt.workflowReceipts[0].buildScript = "forged-build"; }],
    ["test script", (receipt) => { receipt.workflowReceipts[0].testScript = "forged-test"; }]
  ];
  for (const [label, mutate, expectedCode = "COMPANION_CLOSURE_RECEIPT_RECOMPUTE_MISMATCH"] of mutations) {
    await t.test(label, async (subtest) => {
      const closure = makeCompanionClosureFixture();
      const receipt = structuredClone(closure.receipt);
      mutate(receipt);
      const fixture = createRevisionPair(subtest);
      writePackage(fixture.candidate, makePackage({
        primary: closure.primary,
        mutateApplication(application) {
          application.source = makeSourceRequest(closure.primary, [closure.companion]);
          application.companionClosure = [receipt];
        }
      }));
      const candidateCommit = commitAll(fixture.candidate, `forge companion ${label}`);
      await rejectsCode(
        () => verifyPublicHookApplication({
          ...inputFor(fixture, candidateCommit),
          resolveCompanionClosure(request) {
            return resolvePublicCompanionClosure(request, {
              exactObjectResolver: closure.exactObjectResolver
            });
          }
        }),
        expectedCode
      );
    });
  }
});

test("trusted intake accepts a prototype that remains in architecture review", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage({
    stage: "prototype",
    compatibilityResult: "architecture-review-required"
  }));
  const candidateCommit = commitAll(fixture.candidate, "add prototype for architecture review");
  const report = await verifyPublicHookApplication(inputFor(fixture, candidateCommit));
  assert.equal(report.result, "valid-public-application-package");
  assert.equal(report.applicationId, "example-hook");
});

test("trusted intake rejects a formerly complete public prototype-ready claim before external resolution", async (t) => {
  const primary = { ...PRIMARY, githubActionsRunIds: ["123"] };
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage({
    stage: "prototype",
    compatibilityResult: "prototype-ready",
    primary,
    mutateEvidence(index) {
      index.evidence[0].url = `${primary.repositoryUri}/actions/runs/123`;
      index.evidence[0].sha256 = null;
    }
  }));
  const candidateCommit = commitAll(fixture.candidate, "attempt public prototype-ready claim");
  let resolverCalls = 0;
  await assert.rejects(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      resolveSource: async (source) => {
        resolverCalls += 1;
        return exactSourceResolver(source);
      }
    }),
    (error) => error instanceof PublicIntakeError
      && error.code === "PROTOTYPE_READY_REQUIRES_TRUSTED_REVIEW_TARGET"
      && error.kind === "candidate"
  );
  assert.equal(resolverCalls, 0, "the trusted base must reject before resolving external candidate evidence");
});

test("trusted base intake state enforces the complete new-versus-update matrix before candidate validation", async (t) => {
  const cases = [
    ["prelaunch", false, "INTAKE_PRELAUNCH"],
    ["prelaunch", true, "INTAKE_PRELAUNCH"],
    ["paused-new", false, "INTAKE_PAUSED_NEW"],
    ["paused-all", false, "INTAKE_PAUSED_ALL"],
    ["paused-all", true, "INTAKE_PAUSED_ALL"]
  ];
  for (const [state, isUpdate, expectedCode] of cases) {
    await t.test(`${state} ${isUpdate ? "update" : "new"}`, async (t2) => {
      const fixture = createRevisionPair(t2);
      const candidateCommit = configureIntakeApplicationChange(fixture, { state, isUpdate });
      let sourceResolverCalls = 0;
      let evidenceResolverCalls = 0;
      await assert.rejects(
        () => verifyPublicHookApplication({
          ...inputFor(fixture, candidateCommit),
          resolveSource: async () => { sourceResolverCalls += 1; },
          resolveEvidence: async () => { evidenceResolverCalls += 1; }
        }),
        (error) => error instanceof PublicIntakeError
          && error.kind === "system"
          && error.code === expectedCode
      );
      assert.equal(sourceResolverCalls, 0);
      assert.equal(evidenceResolverCalls, 0);
    });
  }
});

test("paused-new permits an existing application update and reports the trusted state", async (t) => {
  const fixture = createRevisionPair(t);
  const candidateCommit = configureIntakeApplicationChange(fixture, { state: "paused-new", isUpdate: true });
  const report = await verifyPublicHookApplication(inputFor(fixture, candidateCommit));
  assert.equal(report.result, "valid-public-application-package");
  assert.equal(report.applicationRevision, 2);
  assert.equal(report.intakeState, "paused-new");
});

test("paused-new treats only a closed trusted six-file base package as an existing application", async (t) => {
  for (const [name, mutate] of [
    ["missing file", (base) => fs.unlinkSync(path.join(base, "submissions/example-hook/TEST_PLAN.md"))],
    ["extra file", (base) => writeFile(base, "submissions/example-hook/extra.txt", "extra\n")]
  ]) {
    await t.test(name, async (t2) => {
      const fixture = createRevisionPair(t2);
      setIntakeStatus(fixture.base, "paused-new");
      writePackage(fixture.base, makePackage());
      mutate(fixture.base);
      fixture.baseCommit = commitAll(fixture.base, `invalid trusted base ${name}`);
      resetClone(fixture);
      writePackage(fixture.candidate, makePackage({
        revision: 2,
        primary: { ...PRIMARY, revisionObjectId: "c".repeat(40), treeObjectId: "d".repeat(40) }
      }));
      const candidateCommit = commitAll(fixture.candidate, "attempt update against invalid trusted base");
      await assert.rejects(
        () => verifyPublicHookApplication(inputFor(fixture, candidateCommit)),
        (error) => error instanceof PublicIntakeError
          && error.kind === "system"
          && error.code === "INTAKE_BASE_APPLICATION_INVALID"
      );
    });
  }
});

test("paused-new permits only the exact trusted new-application continuation identity", async (t) => {
  const fixture = createRevisionPair(t);
  setIntakeStatus(fixture.base, "paused-new", [continuationRecord()]);
  fixture.baseCommit = commitAll(fixture.base, "trusted paused-new continuation");
  resetClone(fixture);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "continue exact new application");
  const report = await verifyPublicHookApplication(inputFor(fixture, candidateCommit));
  assert.equal(report.result, "valid-public-application-package");
  assert.equal(report.pullRequestNumber, PULL_REQUEST_NUMBER);
  assert.equal(report.continuationAuthorized, true);
});

test("trusted continuation records are closed, unique, canonical, bounded, and state-scoped", async (t) => {
  const second = continuationRecord({ applicationId: "second-hook", pullRequestNumber: "8" });
  const malformedCases = [
    ["nonempty outside paused-new", "open", [continuationRecord()]],
    ["duplicate pull request", "paused-new", [continuationRecord(), second, continuationRecord({ applicationId: "third-hook" })]],
    ["duplicate application id", "paused-new", [continuationRecord(), continuationRecord({ pullRequestNumber: "8" })]],
    ["unsorted pull requests", "paused-new", [second, continuationRecord()]],
    ["leading-zero pull request", "paused-new", [continuationRecord({ pullRequestNumber: "07" })]],
    ["extra record field", "paused-new", [{ ...continuationRecord(), note: "candidate" }]],
    ["numeric application id", "paused-new", [continuationRecord({ applicationId: 123 })]],
    ["numeric builder id", "paused-new", [continuationRecord({ builderGitHubUserId: 123 })]],
    ["numeric primary id", "paused-new", [continuationRecord({ primaryNumericRepositoryId: 123 })]],
    ["numeric pull request", "paused-new", [continuationRecord({ pullRequestNumber: 7 })]],
    ["numeric companion id", "paused-new", [continuationRecord({ companionNumericRepositoryIds: [123] })]],
    ["unsorted companions", "paused-new", [continuationRecord({ companionNumericRepositoryIds: ["2", "10"] })]],
    ["duplicate companions", "paused-new", [continuationRecord({ companionNumericRepositoryIds: ["10", "10"] })]],
    ["primary repeated as companion", "paused-new", [continuationRecord({ companionNumericRepositoryIds: [PRIMARY.numericRepositoryId] })]],
    ["too many records", "paused-new", Array.from({ length: 33 }, (_, index) => continuationRecord({
      applicationId: `hook-${String(index).padStart(2, "0")}`,
      pullRequestNumber: String(index + 1)
    }))]
  ];
  for (const [name, state, records] of malformedCases) {
    await t.test(name, async (t2) => {
      const fixture = createRevisionPair(t2);
      setIntakeStatus(fixture.base, state, records);
      fixture.baseCommit = commitAll(fixture.base, `malformed ${name} continuation status`);
      resetClone(fixture);
      writePackage(fixture.candidate, makePackage());
      const candidateCommit = commitAll(fixture.candidate, "application against malformed continuation status");
      await assert.rejects(
        () => verifyPublicHookApplication(inputFor(fixture, candidateCommit)),
        (error) => error instanceof PublicIntakeError
          && error.kind === "system"
          && error.code === "INTAKE_STATUS_INVALID"
      );
    });
  }
});

test("missing or malformed trusted intake status always system-blocks", async (t) => {
  const malformedCases = [
    ["missing", null, "INTAKE_STATUS_MISSING"],
    ["invalid UTF-8", Buffer.from([0xff, 0x0a]), "INTAKE_STATUS_INVALID"],
    ["invalid JSON", Buffer.from("{\n", "utf8"), "INTAKE_STATUS_INVALID"],
    ["noncanonical JSON", Buffer.from('{"continuingPullRequests":[], "schemaVersion":2,"state":"open"}\n', "utf8"), "INTAKE_STATUS_INVALID"],
    ["unsupported schema", Buffer.from('{"continuingPullRequests":[],"schemaVersion":1,"state":"open"}\n', "utf8"), "INTAKE_STATUS_INVALID"],
    ["unsupported state", Buffer.from('{"continuingPullRequests":[],"schemaVersion":2,"state":"closed"}\n', "utf8"), "INTAKE_STATUS_INVALID"],
    ["extra property", Buffer.from('{"continuingPullRequests":[],"note":"candidate","schemaVersion":2,"state":"open"}\n', "utf8"), "INTAKE_STATUS_INVALID"],
    ["oversize", Buffer.alloc((32 * 1024) + 1, 0x20), "INTAKE_STATUS_INVALID"]
  ];
  for (const [name, contents, expectedCode] of malformedCases) {
    await t.test(name, async (t2) => {
      const fixture = createRevisionPair(t2);
      const statusPath = path.join(fixture.base, "docs/builder/intake-status.json");
      if (contents === null) fs.unlinkSync(statusPath);
      else fs.writeFileSync(statusPath, contents);
      fixture.baseCommit = commitAll(fixture.base, `trusted ${name} intake status`);
      resetClone(fixture);
      writePackage(fixture.candidate, makePackage());
      const candidateCommit = commitAll(fixture.candidate, "application against invalid trusted intake status");
      await assert.rejects(
        () => verifyPublicHookApplication(inputFor(fixture, candidateCommit)),
        (error) => error instanceof PublicIntakeError
          && error.kind === "system"
          && error.code === expectedCode
      );
    });
  }
});

test("trusted intake status must be a non-executable regular base-revision blob", async (t) => {
  for (const [name, mutate] of [
    ["executable", (statusPath) => fs.chmodSync(statusPath, 0o755)],
    ["symlink", (statusPath) => {
      fs.unlinkSync(statusPath);
      fs.symlinkSync("../../README.md", statusPath);
    }]
  ]) {
    await t.test(name, async (t2) => {
      const fixture = createRevisionPair(t2);
      mutate(path.join(fixture.base, "docs/builder/intake-status.json"));
      fixture.baseCommit = commitAll(fixture.base, `${name} trusted intake status`);
      resetClone(fixture);
      writePackage(fixture.candidate, makePackage());
      const candidateCommit = commitAll(fixture.candidate, "application against unsafe trusted status entry");
      await assert.rejects(
        () => verifyPublicHookApplication(inputFor(fixture, candidateCommit)),
        (error) => error instanceof PublicIntakeError
          && error.kind === "system"
          && error.code === "INTAKE_STATUS_INVALID"
      );
    });
  }
});

test("an application pull request cannot open intake by changing candidate data", async (t) => {
  const fixture = createRevisionPair(t);
  setIntakeStatus(fixture.base, "prelaunch");
  fixture.baseCommit = commitAll(fixture.base, "trusted prelaunch status");
  resetClone(fixture);
  setIntakeStatus(fixture.candidate, "open");
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "candidate attempts to open intake");
  await rejectsCode(
    () => verifyPublicHookApplication(inputFor(fixture, candidateCommit)),
    "CHANGED_PATH_NOT_ALLOWED"
  );
});

test("stale PR ignores newer base-only files and classifies the candidate-authored six-file package", (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "candidate application from base v1");

  writeFile(fixture.base, "README.md", "trusted base v2\n");
  fixture.baseCommit = commitAll(fixture.base, "unrelated base-only documentation update");

  const result = classifyPublicIntakePullRequest(inputFor(fixture, candidateCommit));
  assert.equal(result.mode, "application");
  assert.deepEqual(result.changes.map((change) => change.path), [
    "submissions/example-hook/PROPOSAL.md",
    "submissions/example-hook/TEST_PLAN.md",
    "submissions/example-hook/THREAT_MODEL.md",
    "submissions/example-hook/application.json",
    "submissions/example-hook/compatibility-report.json",
    "submissions/example-hook/evidence-index.json"
  ]);
});

test("stale PR still rejects a candidate-authored path outside the intake allowlist", (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  writeFile(fixture.candidate, ".github/workflows/attacker.yml", "name: attacker\n");
  const candidateCommit = commitAll(fixture.candidate, "candidate package with forbidden path");

  writeFile(fixture.base, "README.md", "trusted base v2\n");
  fixture.baseCommit = commitAll(fixture.base, "unrelated base-only documentation update");

  assert.throws(
    () => classifyPublicIntakePullRequest(inputFor(fixture, candidateCommit)),
    hasCode("CHANGED_PATH_NOT_ALLOWED")
  );
});

test("a depth-one PR merge checkout retains the exact base/head parent contract", (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "candidate application");
  const input = inputFor(fixture, candidateCommit);
  const shallowCandidate = path.join(fixture.root, "candidate-shallow");
  const clone = childProcess.spawnSync(
    "git",
    ["clone", "--quiet", "--depth=1", `file://${fixture.candidate}`, shallowCandidate],
    { encoding: "utf8", shell: false }
  );
  assert.equal(clone.status, 0, clone.stderr);

  const result = classifyPublicIntakePullRequest({ ...input, candidateRoot: shallowCandidate });
  assert.equal(result.mode, "application");
  assert.equal(result.candidate.commit, candidateCommit);
  assert.equal(result.candidate.mergeCommit, input.expectedMergeCommit);
});

test("a PR merge checkout whose parents differ from the GitHub event fails closed", (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "candidate application");
  const input = inputFor(fixture, candidateCommit);
  assert.throws(
    () => classifyPublicIntakePullRequest({ ...input, expectedCandidateCommit: "c".repeat(40) }),
    (error) => error instanceof PublicIntakeError
      && error.kind === "system"
      && error.code === "PR_MERGE_PARENT_MISMATCH"
  );
});

test("a PR merge checkout with reversed base and head parents fails closed", (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "candidate application");
  git(fixture.candidate, ["fetch", "--quiet", "--no-tags", fixture.base, fixture.baseCommit]);
  const mergedTree = git(fixture.candidate, ["merge-tree", "--write-tree", fixture.baseCommit, candidateCommit]);
  const reversedMergeCommit = git(fixture.candidate, [
    "commit-tree",
    mergedTree,
    "-p", candidateCommit,
    "-p", fixture.baseCommit,
    "-m", "Synthetic merge with reversed parents"
  ]);
  git(fixture.candidate, ["reset", "--hard", reversedMergeCommit]);

  assert.throws(
    () => classifyPublicIntakePullRequest({
      baseRoot: fixture.base,
      candidateRoot: fixture.candidate,
      expectedBaseCommit: fixture.baseCommit,
      expectedCandidateCommit: candidateCommit,
      expectedMergeCommit: reversedMergeCommit
    }),
    (error) => error instanceof PublicIntakeError
      && error.kind === "system"
      && error.code === "PR_MERGE_PARENT_MISMATCH"
  );
});

test("builder login binding follows GitHub's case-insensitive identity semantics", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage({ mutateApplication: (application) => {
    application.builder.githubLogin = "Alice";
  } }));
  const candidateCommit = commitAll(fixture.candidate, "case-normalized builder");
  const report = await verifyPublicHookApplication({
    ...inputFor(fixture, candidateCommit),
    expectedBuilderLogin: "aLiCe",
    resolveSource: exactSourceResolver
  });
  assert.deepEqual(report.builderIdentity, {
    authentication: "github-pull-request-author",
    immutableGitHubUserId: BUILDER_USER_ID,
    authenticatedLogin: "aLiCe",
    manifestLogin: "Alice",
    normalizedLogin: "alice",
    provesSourceRepositoryOwnership: false
  });
});

test("an application cannot impersonate a builder other than the authenticated PR author", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage({ mutateApplication: (application) => {
    application.builder.githubLogin = "mallory";
  } }));
  const candidateCommit = commitAll(fixture.candidate, "impersonated builder");
  let resolverCalls = 0;
  await rejectsCode(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      resolveSource: async () => { resolverCalls += 1; }
    }),
    "BUILDER_LOGIN_PR_AUTHOR_MISMATCH"
  );
  assert.equal(resolverCalls, 0);
});

test("an application cannot substitute a GitHub user id for the authenticated PR author", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "application with mismatched builder id");
  let resolverCalls = 0;
  await rejectsCode(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      expectedBuilderUserId: "999",
      resolveSource: async () => { resolverCalls += 1; }
    }),
    "BUILDER_ID_PR_AUTHOR_MISMATCH"
  );
  assert.equal(resolverCalls, 0);
});

test("a malformed trusted PR-author login blocks verification before source resolution", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "application with malformed event context");
  let resolverCalls = 0;
  await assert.rejects(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      expectedBuilderLogin: "alice/forged",
      resolveSource: async () => { resolverCalls += 1; }
    }),
    (error) => error instanceof PublicIntakeError
      && error.code === "EXPECTED_BUILDER_LOGIN_INVALID"
      && error.kind === "system"
  );
  assert.equal(resolverCalls, 0);
});

test("a malformed trusted PR-author id blocks verification before source resolution", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "application with malformed author id context");
  let resolverCalls = 0;
  await assert.rejects(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      expectedBuilderUserId: "01",
      resolveSource: async () => { resolverCalls += 1; }
    }),
    (error) => error instanceof PublicIntakeError
      && error.code === "EXPECTED_BUILDER_ID_INVALID"
      && error.kind === "system"
  );
  assert.equal(resolverCalls, 0);
});

test("pure package validation stays structural and rejects malformed manifest logins", () => {
  const packageFiles = makePackage({ mutateApplication: (application) => {
    application.builder.githubLogin = "alice/forged";
  } });
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles }),
    hasCode("STRING_PATTERN_INVALID")
  );
});

test("trusted Git tree inspection accepts unrelated NFC UTF-8 paths with spaces", async (t) => {
  const fixture = createRevisionPair(t);
  writeFile(fixture.base, "examples/échange hook/README note.md", "canonical UTF-8 path\n");
  fixture.baseCommit = commitAll(fixture.base, "add canonical unicode path");
  resetClone(fixture);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "add application");

  const report = await verifyPublicHookApplication({
    ...inputFor(fixture, candidateCommit),
    resolveSource: exactSourceResolver
  });
  assert.equal(report.result, "valid-public-application-package");
});

test("legacy model pull requests classify as no-op and are not forced through builder intake", (t) => {
  const fixture = createRevisionPair(t);
  writeFile(fixture.candidate, "models/legacy/model.json", "{}\n");
  const candidateCommit = commitAll(fixture.candidate, "legacy model change");
  const result = classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit));
  assert.equal(result.mode, "no-op");
});

test("legacy model pull requests may retain ordinary root documentation changes", (t) => {
  const fixture = createRevisionPair(t);
  writeFile(fixture.candidate, "models/legacy/model.json", "{}\n");
  writeFile(fixture.candidate, "README.md", "legacy model documentation\n");
  const candidateCommit = commitAll(fixture.candidate, "legacy model and root documentation change");
  const result = classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit));
  assert.equal(result.mode, "no-op");
});

test("first-party builder infrastructure classifies as builder maintenance", (t) => {
  const fixture = createRevisionPair(t);
  for (const relativePath of [
    ".github/workflows/verify-hook-builder.yml",
    "BUILDER_PROGRAM.md",
    "README.md",
    "SUPPORT.md",
    "docs/README.md",
    "docs/builder/PUBLIC_GITHUB_PR_BETA.md",
    "docs/builder/intake-status.json",
    "evals/suites/programmable-v4-hook-builder/suite.json",
    "plugins/marketplace/metadata/plugin.json",
    "scripts/check-documentation-links.mjs",
    "scripts/evals/validate-evals.mjs",
    "scripts/test/check-documentation-links.test.mjs",
    "scripts/test/schema-validator/package.json",
    "scripts/test/verify-public-hook-application-maintained.test.mjs",
    "scripts/test/verify-public-hook-application-workflow.test.mjs",
    "scripts/verify-public-hook-application-core.mjs",
    "skills/programmable-v4-hook-builder/SKILL.md"
  ]) {
    writeFile(fixture.candidate, relativePath, `maintenance fixture for ${relativePath}\n`);
  }
  const candidateCommit = commitAll(fixture.candidate, "builder maintenance change");
  const result = classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit));
  assert.equal(result.mode, "builder-maintenance");
});

test("shared builder documentation remains no-op without a builder-maintenance trigger", (t) => {
  const fixture = createRevisionPair(t);
  for (const relativePath of [
    "README.md",
    "SUPPORT.md",
    "docs/README.md",
    "scripts/check-documentation-links.mjs",
    "scripts/test/check-documentation-links.test.mjs"
  ]) {
    writeFile(fixture.candidate, relativePath, `shared documentation fixture for ${relativePath}\n`);
  }
  const candidateCommit = commitAll(fixture.candidate, "shared builder documentation only");
  const result = classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit));
  assert.equal(result.mode, "no-op");
});

test("trusted CLI classification needs no builder identity for legacy or builder-maintenance changes", async (t) => {
  for (const [name, relativePath, expectedMode] of [
    ["legacy", "models/legacy/model.json", "no-op"],
    ["builder-maintenance", "skills/programmable-v4-hook-builder/SKILL.md", "builder-maintenance"]
  ]) {
    await t.test(name, (t2) => {
      const fixture = createRevisionPair(t2);
      writeFile(fixture.candidate, relativePath, "fixture\n");
      const candidateCommit = commitAll(fixture.candidate, `${name} classification`);
      const input = classificationInputFor(fixture, candidateCommit);
      const result = runTrustedCli([
        "--classify",
        "--base-root", input.baseRoot,
        "--candidate-root", input.candidateRoot,
        "--expected-base-commit", input.expectedBaseCommit,
        "--expected-candidate-commit", input.expectedCandidateCommit,
        "--expected-merge-commit", input.expectedMergeCommit
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), expectedMode);
      assert.doesNotMatch(result.stderr, /expected-builder-login/u);
      assert.doesNotMatch(result.stderr, /expected-builder-user-id/u);
    });
  }
});

test("trusted CLI application verification requires authenticated builder context", (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "application without CLI author context");
  const input = classificationInputFor(fixture, candidateCommit);
  const result = runTrustedCli([
    "--pull-request-number", PULL_REQUEST_NUMBER,
    "--base-root", input.baseRoot,
    "--candidate-root", input.candidateRoot,
    "--expected-base-commit", input.expectedBaseCommit,
    "--expected-candidate-commit", input.expectedCandidateCommit,
    "--expected-merge-commit", input.expectedMergeCommit
  ]);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stderr), {
    schemaVersion: 1,
    result: "system-blocked",
    code: "CLI_ARGUMENT_MISSING",
    message: "Application verification requires the authenticated pull-request author login and immutable user id."
  });
});

test("trusted CLI requires the event PR number for hydration and final verification only", () => {
  const revisionArguments = [
    "--base-root", "/missing/base",
    "--candidate-root", "/missing/candidate",
    "--expected-base-commit", "a".repeat(40),
    "--expected-candidate-commit", "b".repeat(40),
    "--expected-merge-commit", "c".repeat(40)
  ];
  for (const prefix of [
    ["--expected-builder-login", "alice", "--expected-builder-user-id", BUILDER_USER_ID],
    ["--hydrate-candidate", "--repository", "central/repository"]
  ]) {
    const result = runTrustedCli([...prefix, ...revisionArguments]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stderr).code, "CLI_ARGUMENT_MISSING");
    assert.match(JSON.parse(result.stderr).message, /exact pull-request number/u);
  }
  const classify = runTrustedCli([
    "--classify",
    "--pull-request-number", PULL_REQUEST_NUMBER,
    ...revisionArguments
  ]);
  assert.equal(classify.status, 2);
  assert.equal(JSON.parse(classify.stderr).code, "CLI_ARGUMENT_INVALID");
});

test("trusted CLI emits operational intake states as system blockers without reaching GitHub", async (t) => {
  for (const [state, isUpdate, expectedCode] of [
    ["prelaunch", false, "INTAKE_PRELAUNCH"],
    ["paused-new", false, "INTAKE_PAUSED_NEW"],
    ["paused-all", true, "INTAKE_PAUSED_ALL"]
  ]) {
    await t.test(`${state} ${isUpdate ? "update" : "new"}`, (t2) => {
      const fixture = createRevisionPair(t2);
      const candidateCommit = configureIntakeApplicationChange(fixture, { state, isUpdate });
      const input = classificationInputFor(fixture, candidateCommit);
      const result = runTrustedCli([
        "--pull-request-number", PULL_REQUEST_NUMBER,
        "--base-root", input.baseRoot,
        "--candidate-root", input.candidateRoot,
        "--expected-base-commit", input.expectedBaseCommit,
        "--expected-builder-login", "alice",
        "--expected-builder-user-id", BUILDER_USER_ID,
        "--expected-candidate-commit", input.expectedCandidateCommit,
        "--expected-merge-commit", input.expectedMergeCommit
      ]);
      assert.equal(result.status, 2, result.stderr);
      const failure = JSON.parse(result.stderr);
      assert.equal(failure.result, "system-blocked");
      assert.equal(failure.code, expectedCode);
    });
  }
});

test("trusted CLI permits paused-new updates before applying ordinary candidate checks", (t) => {
  const fixture = createRevisionPair(t);
  setIntakeStatus(fixture.base, "paused-new");
  writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, "existing application under paused-new intake");
  resetClone(fixture);
  const nextPrimary = {
    ...PRIMARY,
    revisionObjectId: "c".repeat(40),
    treeObjectId: "d".repeat(40)
  };
  writePackage(fixture.candidate, makePackage({
    revision: 2,
    primary: nextPrimary,
    mutateApplication(application) {
      application.builder.githubLogin = "mallory";
    }
  }));
  const candidateCommit = commitAll(fixture.candidate, "paused-new update with wrong PR author");
  const input = classificationInputFor(fixture, candidateCommit);
  const result = runTrustedCli([
    "--pull-request-number", PULL_REQUEST_NUMBER,
    "--base-root", input.baseRoot,
    "--candidate-root", input.candidateRoot,
    "--expected-base-commit", input.expectedBaseCommit,
    "--expected-builder-login", "alice",
    "--expected-builder-user-id", BUILDER_USER_ID,
    "--expected-candidate-commit", input.expectedCandidateCommit,
    "--expected-merge-commit", input.expectedMergeCommit
  ]);
  assert.equal(result.status, 1, result.stderr);
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.result, "invalid-public-application-package");
  assert.equal(failure.code, "BUILDER_LOGIN_PR_AUTHOR_MISMATCH");
});

test("an application mixed with a workflow or any other central-repository file is rejected", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  writeFile(fixture.candidate, ".github/workflows/pwn.yml", "name: pwn\n");
  const candidateCommit = commitAll(fixture.candidate, "mixed malicious change");
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "CHANGED_PATH_NOT_ALLOWED"
  );
});

test("any submissions change mixed with builder maintenance is rejected", (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  writeFile(fixture.candidate, "skills/programmable-v4-hook-builder/SKILL.md", "candidate policy fork\n");
  const candidateCommit = commitAll(fixture.candidate, "mixed application and builder maintenance");
  assert.throws(
    () => classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit)),
    hasCode("CHANGED_PATH_NOT_ALLOWED")
  );
});

test("submissions documentation uses the separate builder-maintenance path", (t) => {
  const fixture = createRevisionPair(t);
  writeFile(fixture.candidate, "submissions/README.md", "maintainer-reviewed intake rules\n");
  const candidateCommit = commitAll(fixture.candidate, "maintain submissions documentation");
  const result = classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit));
  assert.equal(result.mode, "builder-maintenance");
});

test("submissions documentation cannot be mixed into an application", (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  writeFile(fixture.candidate, "submissions/README.md", "candidate-controlled intake rules\n");
  const candidateCommit = commitAll(fixture.candidate, "mixed application and submissions documentation");
  assert.throws(
    () => classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit)),
    hasCode("CHANGED_PATH_NOT_ALLOWED")
  );
});

test("builder maintenance cannot be mixed with unrelated central-repository changes", (t) => {
  const fixture = createRevisionPair(t);
  writeFile(fixture.candidate, "docs/builder/PUBLIC_GITHUB_PR_BETA.md", "builder documentation\n");
  writeFile(fixture.candidate, "src/Unrelated.sol", "contract Unrelated {}\n");
  const candidateCommit = commitAll(fixture.candidate, "mixed maintenance and unrelated code");
  assert.throws(
    () => classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit)),
    hasCode("CHANGED_PATH_NOT_ALLOWED")
  );
});

test("unsafe builder-maintenance Git entries are rejected before candidate code can run", (t) => {
  const fixture = createRevisionPair(t);
  const skillPath = path.join(fixture.candidate, "skills/programmable-v4-hook-builder/SKILL.md");
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.symlinkSync("../../../README.md", skillPath);
  const candidateCommit = commitAll(fixture.candidate, "symlinked maintenance file");
  assert.throws(
    () => classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit)),
    hasCode("LINKED_CONTENT_FORBIDDEN")
  );
});

test("executable builder-maintenance Git entries are rejected deterministically", (t) => {
  const fixture = createRevisionPair(t);
  writeFile(fixture.candidate, "docs/builder/PUBLIC_GITHUB_PR_BETA.md", "executable documentation\n");
  fs.chmodSync(path.join(fixture.candidate, "docs/builder/PUBLIC_GITHUB_PR_BETA.md"), 0o755);
  const candidateCommit = commitAll(fixture.candidate, "executable maintenance file");
  assert.throws(
    () => classifyPublicIntakePullRequest(classificationInputFor(fixture, candidateCommit)),
    hasCode("FILE_MODE_FORBIDDEN")
  );
});

test("candidate scripts are rejected as unexpected data and never executed", async (t) => {
  const fixture = createRevisionPair(t);
  const marker = path.join(fixture.root, "candidate-script-executed");
  writePackage(fixture.candidate, makePackage());
  writeFile(
    fixture.candidate,
    "submissions/example-hook/postinstall.js",
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\n`
  );
  const candidateCommit = commitAll(fixture.candidate, "candidate script");
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "CHANGED_PATH_NOT_ALLOWED"
  );
  assert.equal(fs.existsSync(marker), false);
});

test("symlinked allowlisted files are rejected from the Git tree before content reads", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const proposal = path.join(fixture.candidate, "submissions/example-hook/PROPOSAL.md");
  fs.unlinkSync(proposal);
  fs.symlinkSync("../../README.md", proposal);
  const candidateCommit = commitAll(fixture.candidate, "symlink package file");
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "LINKED_CONTENT_FORBIDDEN"
  );
});

test("submodule gitlinks are rejected without initializing or executing them", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const object = fixture.baseCommit;
  git(fixture.candidate, [
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${object},submissions/example-hook/linked-repository`
  ]);
  const candidateCommit = git(fixture.candidate, ["commit", "-m", "gitlink package entry"]);
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "LINKED_CONTENT_FORBIDDEN"
  );
});

test("executable allowlisted files are rejected before candidate bytes are interpreted", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  fs.chmodSync(path.join(fixture.candidate, "submissions/example-hook/TEST_PLAN.md"), 0o755);
  const candidateCommit = commitAll(fixture.candidate, "executable review file");
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "FILE_MODE_FORBIDDEN"
  );
});

test("application updates cannot delete one of the six frozen files", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, "existing application");
  resetClone(fixture);
  fs.unlinkSync(path.join(fixture.candidate, "submissions/example-hook/PROPOSAL.md"));
  const candidateCommit = commitAll(fixture.candidate, "delete review file");
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "APPLICATION_FILE_DELETED"
  );
});

test("one pull request cannot add multiple application directories", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  writePackage(fixture.candidate, makePackage({ applicationId: "second-hook" }), "second-hook");
  const candidateCommit = commitAll(fixture.candidate, "two applications");
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "APPLICATION_COUNT_INVALID"
  );
});

test("source paths cannot escape the external public repository", () => {
  const files = makePackage({ mutateApplication: (application) => {
    application.source.primary.sourcePaths = ["../private-key"];
  } });
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
    hasCode("SOURCE_CONTRACT_INVALID")
  );
});

test("trusted package paths accept NFC UTF-8 and spaces through 1024 bytes but reject controls and noncanonical forms", () => {
  const exactBound = `z/${"x".repeat(1_022)}`;
  assert.equal(Buffer.byteLength(exactBound, "utf8"), 1_024);
  const accepted = makePackage({ mutateApplication: (application) => {
    application.source.primary.sourcePaths = [
      "compatibility-report.json",
      "src/échange hook.sol",
      "test/ExampleHook.t.sol",
      exactBound
    ];
  } });
  assert.doesNotThrow(() => validatePublicApplicationPackageFiles({
    applicationId: "example-hook",
    packageFiles: accepted
  }));

  for (const invalidPath of [
    `z/${"x".repeat(1_023)}`,
    "src/control\u0085.sol",
    "src/bidi\u202e.sol",
    "src/cafe\u0301.sol",
    "src/../secret.sol"
  ]) {
    const files = makePackage({ mutateApplication: (application) => {
      application.source.primary.sourcePaths = [invalidPath];
    } });
    assert.throws(
      () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
      (error) => error instanceof PublicIntakeError
        && ["SOURCE_CONTRACT_INVALID", "JSON_TEXT_UNSAFE"].includes(error.code)
    );
  }
});

test("finding paths share the NFC UTF-8 1024-byte source-path contract", () => {
  const exactBound = `z/${"x".repeat(1_022)}`;
  const accepted = makePackage();
  setFindingPath(accepted, exactBound);
  assert.doesNotThrow(() => validatePublicApplicationPackageFiles({
    applicationId: "example-hook",
    packageFiles: accepted
  }));

  for (const invalidPath of [`z/${"x".repeat(1_023)}`, "src/../secret.sol", "src/bidi\u202e.sol"]) {
    const files = makePackage();
    setFindingPath(files, invalidPath);
    assert.throws(
      () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
      (error) => error instanceof PublicIntakeError
        && ["FINDING_PATH_INVALID", "JSON_TEXT_UNSAFE"].includes(error.code)
    );
  }
});

test("closed JSON rejects additional manifest properties even when canonical", () => {
  const files = makePackage({ mutateApplication: (application) => {
    application.execute = "candidate-script.js";
  } });
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
    hasCode("OBJECT_NOT_CLOSED")
  );
});

test("the trusted core requires a proposal or prototype stage", () => {
  for (const stage of [undefined, "candidate", "approved"]) {
    const files = makePackage({
      mutateApplication(application) {
        if (stage === undefined) delete application.stage;
        else application.stage = stage;
      }
    });
    assert.throws(
      () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
      hasCode(stage === undefined ? "OBJECT_NOT_CLOSED" : "APPLICATION_STAGE_INVALID")
    );
  }
});

test("prototype-ready preserves prior error priority and valid public claims require trusted reconstruction", () => {
  assert.throws(
    () => validatePublicApplicationPackageFiles({
      applicationId: "example-hook",
      packageFiles: makePackage({ stage: "proposal", compatibilityResult: "prototype-ready" })
    }),
    hasCode("COMPATIBILITY_STAGE_MISMATCH")
  );

  assert.throws(
    () => validatePublicApplicationPackageFiles({
      applicationId: "example-hook",
      packageFiles: makePackage({ stage: "prototype", compatibilityResult: "prototype-ready" })
    }),
    hasCode("COMPATIBILITY_EVIDENCE_MISMATCH")
  );

  const actionPrimary = { ...PRIMARY, githubActionsRunIds: ["123"] };
  assert.throws(
    () => validatePublicApplicationPackageFiles({
      applicationId: "example-hook",
      packageFiles: makePackage({
        stage: "prototype",
        compatibilityResult: "prototype-ready",
        primary: actionPrimary,
        mutateEvidence(index) {
          index.evidence[0].url = `${actionPrimary.repositoryUri}/actions/runs/123`;
          index.evidence[0].sha256 = null;
        }
      })
    }),
    (error) => error instanceof PublicIntakeError
      && error.code === "PROTOTYPE_READY_REQUIRES_TRUSTED_REVIEW_TARGET"
      && error.kind === "candidate"
  );

  const cases = [
    ["proposal", "architecture-review-required", "passed", []],
    ["proposal", "changes-required", "failed", [actionableFinding("PROPOSAL_CHANGE", "warning")]],
    ["proposal", "tooling-blocked", "blocked", []],
    ["prototype", "architecture-review-required", "passed", []],
    ["prototype", "changes-required", "failed", [actionableFinding("TEST_FAILURE", "warning")]],
    ["prototype", "tooling-blocked", "blocked", []]
  ];
  for (const [stage, compatibilityResult, evidenceStatus, findings] of cases) {
    assert.doesNotThrow(
      () => validatePublicApplicationPackageFiles({
        applicationId: "example-hook",
        packageFiles: makePackage({ stage, compatibilityResult, evidenceStatus, findings })
      }),
      `${stage} ${compatibilityResult}`
    );
  }
});

test("compatibility result, findings, and evidence statuses must agree", () => {
  const cases = [
    ["prototype-ready with failed evidence", { stage: "prototype", compatibilityResult: "prototype-ready", evidenceStatus: "failed" }],
    ["prototype-ready with a warning", {
      stage: "prototype",
      compatibilityResult: "prototype-ready",
      findings: [actionableFinding("OPEN_WARNING", "warning")]
    }],
    ["changes-required without a failure or finding", { stage: "prototype", compatibilityResult: "changes-required" }],
    ["tooling-blocked with only passed evidence", { stage: "prototype", compatibilityResult: "tooling-blocked" }]
  ];
  for (const [name, options] of cases) {
    assert.throws(
      () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: makePackage(options) }),
      hasCode("COMPATIBILITY_EVIDENCE_MISMATCH"),
      name
    );
  }
});

test("rebinding hashes cannot hide unsupported claims in any of the six public files", () => {
  const cases = new Map([
    ["application.json", "This hook is officially approved by Uniswap for public use."],
    ["compatibility-report.json", "This hook has been independently audited for production use."],
    ["evidence-index.json", "This hook is rug-free and cannot be rugged by its creator."],
    ["PROPOSAL.md", "This hook is officially approved by Programmable for builders."],
    ["THREAT_MODEL.md", "This hook is guaranteed safe and secure for every user."],
    ["TEST_PLAN.md", "This hook is deployed and available now for production use."]
  ]);
  for (const [fileName, claim] of cases) {
    const files = makePackage();
    injectUnsupportedClaim(files, fileName, claim);
    assert.throws(
      () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
      hasCode("UNSUPPORTED_PUBLIC_CLAIM"),
      fileName
    );
  }
});

test("true declarations do not substitute for scanning actual public claims", () => {
  const files = makePackage();
  injectUnsupportedClaim(files, "application.json", "This hook is officially certified by Uniswap.");
  const application = JSON.parse(files.get("application.json").toString("utf8"));
  assert.ok(Object.values(application.declarations).every((value) => value === true));
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
    hasCode("UNSUPPORTED_PUBLIC_CLAIM")
  );
});

test("honest negations and evidence-status wording remain acceptable public copy", () => {
  const files = makePackage({
    mutateApplication(application) {
      application.summary = "This hook is not approved by Uniswap or Programmable and is not deployed.";
    },
    markdown: {
      "PROPOSAL.md": "# Proposal\nThis hook is not audited, is not guaranteed safe, and is not deployed or available.\n",
      "TEST_PLAN.md": "# Test plan\nBuilder unit-test evidence status: passed for the exact immutable source revision.\n"
    }
  });
  assert.doesNotThrow(() =>
    validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files })
  );
});

test("claim scanning ignores machine identifiers, repository names, paths, contacts and evidence URLs", () => {
  const primary = {
    ...PRIMARY,
    repositoryUri: "https://github.com/alice/unruggable",
    sourcePaths: ["risk-free-hooks/results.json", "tests/rug-proof.t.sol"],
    contractPaths: ["src/production-ready.sol"]
  };
  const files = makePackage({
    primary,
    mutateApplication(application) {
      application.builder.contact = "https://example.com/risk-free-hooks";
    },
    mutateEvidence(evidence) {
      evidence.evidence[0].url = `${primary.repositoryUri}/blob/${primary.revisionObjectId}/risk-free-hooks/results.json`;
    }
  });
  assert.doesNotThrow(() =>
    validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files })
  );
});

test("the trusted core requires at least one evidence record", () => {
  const files = makePackage();
  const evidence = JSON.parse(files.get("evidence-index.json").toString("utf8"));
  evidence.evidence = [];
  files.set("evidence-index.json", jsonBytes(evidence));
  rebindApplicationReviewPackage(files);
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
    hasCode("EVIDENCE_COUNT_INVALID")
  );
});

test("evidence is bound to an exact declared blob or Actions run", () => {
  const cases = [
    ["generic repository page", "https://github.com/alice/example-hook", "sha256:" + "e".repeat(64), "EVIDENCE_URL_SOURCE_MISMATCH"],
    ["wrong commit", `https://github.com/alice/example-hook/blob/${"c".repeat(40)}/compatibility-report.json`, "sha256:" + "e".repeat(64), "EVIDENCE_URL_SOURCE_MISMATCH"],
    ["undeclared path", `https://github.com/alice/example-hook/blob/${PRIMARY.revisionObjectId}/other-report.json`, "sha256:" + "e".repeat(64), "EVIDENCE_URL_SOURCE_MISMATCH"],
    ["missing blob hash", `https://github.com/alice/example-hook/blob/${PRIMARY.revisionObjectId}/compatibility-report.json`, null, "EVIDENCE_BLOB_HASH_REQUIRED"]
  ];
  for (const [name, url, sha256, code] of cases) {
    const files = makePackage();
    mutateFirstEvidence(files, (record) => Object.assign(record, { url, sha256 }));
    assert.throws(
      () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
      hasCode(code),
      name
    );
  }

  const actionPrimary = { ...PRIMARY, githubActionsRunIds: ["123"] };
  const actionFiles = makePackage({ primary: actionPrimary });
  mutateFirstEvidence(actionFiles, (record) => Object.assign(record, {
    url: "https://github.com/alice/example-hook/actions/runs/123",
    sha256: null
  }));
  assert.doesNotThrow(() =>
    validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: actionFiles })
  );
  mutateFirstEvidence(actionFiles, (record) => { record.sha256 = "sha256:" + "e".repeat(64); });
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: actionFiles }),
    hasCode("EVIDENCE_ACTION_HASH_INVALID")
  );

  const duplicateTarget = makePackage({
    mutateEvidence(index) {
      index.evidence.push({ ...index.evidence[0], id: "unit-tests-two" });
    }
  });
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: duplicateTarget }),
    hasCode("EVIDENCE_TARGET_DUPLICATE")
  );
});

test("trusted blob evidence resolves exact GitHub Blob API bytes and recomputes SHA-256", async () => {
  const requests = [];
  const transport = makeEvidenceTransport({ requests });
  const evidence = makePackageEvidence();
  const observations = await resolvePublicApplicationEvidence(
    { primary: PRIMARY, evidence, limits: {} },
    { transport }
  );
  assert.deepEqual(requests.map((request) => request.url), [
    `https://api.github.com/repos/alice/example-hook/git/trees/${PRIMARY.treeObjectId}?recursive=1`,
    `https://api.github.com/repos/alice/example-hook/git/blobs/${gitBlobObjectId(EVIDENCE_BYTES)}`
  ]);
  assert.equal(observations[0].blobObjectId, gitBlobObjectId(EVIDENCE_BYTES));
  assert.deepEqual(observations[0].bytes, EVIDENCE_BYTES);
  assert.ok(requests.every((request) => request.method === "GET" && request.redirect === "error"));
  assert.ok(requests.every((request) => !Object.keys(request.headers).some((key) => key.toLowerCase() === "authorization")));
});

test("trusted exact evidence resolution batches declared paths without REST", async () => {
  const calls = [];
  const evidence = makePackageEvidence();
  const objectId = gitBlobObjectId(EVIDENCE_BYTES);
  const observations = await resolvePublicApplicationEvidence(
    { primary: PRIMARY, evidence, limits: {} },
    {
      exactObjectResolver: async (request) => {
        calls.push(request);
        return {
          records: new Map([["compatibility-report.json", {
            bytes: Buffer.from(EVIDENCE_BYTES),
            mode: "100644",
            objectId
          }]])
        };
      }
    }
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].paths, ["compatibility-report.json"]);
  assert.equal(calls[0].maximumFileBytes, 2_000_000);
  assert.equal(calls[0].maximumTotalBytes, 20_000_000);
  assert.equal(observations[0].blobObjectId, objectId);
  assert.deepEqual(observations[0].bytes, EVIDENCE_BYTES);
});

test("one application session reuses source bytes for evidence and makes only three REST control-plane reads", async () => {
  const evidence = makePackageEvidence();
  const declaredBlobs = new Map([
    ["compatibility-report.json", EVIDENCE_BYTES],
    ["test/ExampleHook.t.sol", Buffer.from("contract ExampleHookTest {}\n")],
    ["src/ExampleHook.sol", Buffer.from("contract ExampleHook {}\n")]
  ]);
  const restRequests = [];
  const exactRequests = [];
  const transport = async (request) => {
    restRequests.push(request.url);
    let body;
    if (request.url.endsWith(`/git/commits/${PRIMARY.revisionObjectId}`)) {
      body = {
        sha: PRIMARY.revisionObjectId,
        tree: { sha: PRIMARY.treeObjectId },
        html_url: `${PRIMARY.repositoryUri}/commit/${PRIMARY.revisionObjectId}`
      };
    } else if (request.url.endsWith(`/git/trees/${PRIMARY.treeObjectId}`)) {
      body = { sha: PRIMARY.treeObjectId, truncated: false, tree: [] };
    } else {
      body = {
        id: Number(PRIMARY.numericRepositoryId),
        private: false,
        visibility: "public",
        full_name: "alice/example-hook",
        default_branch: "main",
        html_url: PRIMARY.repositoryUri
      };
    }
    return { status: 200, headers: {}, body: JSON.stringify(body), redirected: false, responseUrl: request.url };
  };
  const exactObjectResolver = async (request) => {
    exactRequests.push(request);
    return {
      records: new Map(request.paths.map((filePath) => {
        const bytes = declaredBlobs.get(filePath);
        assert.ok(bytes, `unexpected exact path ${filePath}`);
        return [filePath, { bytes, mode: "100644", objectId: gitBlobObjectId(bytes) }];
      }))
    };
  };
  const session = createTrustedPublicApplicationResolutionSessionV1(
    { primary: PRIMARY, evidence },
    { exactObjectResolver, transport }
  );
  await session.resolveSource(makeSourceRequest(PRIMARY));
  const observations = await session.resolveEvidence({ primary: PRIMARY, evidence, limits: {} });
  assert.equal(exactRequests.length, 1, "evidence must use the exact source-byte cache");
  assert.equal(restRequests.length, 3);
  assert.equal(restRequests.some((url) => url.includes("?recursive=1")), false);
  assert.deepEqual(observations[0].bytes, EVIDENCE_BYTES);
});

test("trusted blob evidence rejects absent paths and bytes that do not match the exact Git object", async () => {
  const request = { primary: PRIMARY, evidence: makePackageEvidence(), limits: {} };
  await assert.rejects(
    () => resolvePublicApplicationEvidence(request, {
      transport: makeEvidenceTransport({ treeEntries: [] })
    }),
    hasCode("EVIDENCE_BLOB_UNAVAILABLE")
  );

  const exactBlobObjectId = gitBlobObjectId(EVIDENCE_BYTES);
  await assert.rejects(
    () => resolvePublicApplicationEvidence(request, {
      transport: makeEvidenceTransport({
        contentBytes: Buffer.from("different bytes under a forged Git blob identity\n", "utf8"),
        treeBlobObjectId: exactBlobObjectId,
        responseBlobObjectId: exactBlobObjectId
      })
    }),
    hasCode("EVIDENCE_BLOB_INVALID")
  );
});

test("trusted blob evidence fails closed on malformed GitHub trees, blobs, redirects, and resolution limits", async () => {
  const duplicate = { path: "compatibility-report.json", type: "blob", sha: gitBlobObjectId(EVIDENCE_BYTES) };
  const cases = [
    ["truncated tree", makeEvidenceTransport({ treeTruncated: true }), {}, "EVIDENCE_TREE_INVALID"],
    ["duplicate tree entry", makeEvidenceTransport({ treeEntries: [duplicate, duplicate] }), {}, "EVIDENCE_TREE_INVALID"],
    ["invalid base64", makeEvidenceTransport({ base64Content: "@@==", contentSize: 1 }), {}, "EVIDENCE_BLOB_INVALID"],
    ["blob byte limit", makeEvidenceTransport(), { maximumEvidenceBlobBytes: EVIDENCE_BYTES.length - 1 }, "EVIDENCE_BLOB_UNAVAILABLE"],
    ["request limit", makeEvidenceTransport(), { maximumEvidenceRequests: 1 }, "EVIDENCE_REQUEST_LIMIT"],
    ["aggregate response limit", makeEvidenceTransport(), { maximumEvidenceResolutionBytes: 32 }, "EVIDENCE_RESPONSE_LIMIT"],
    ["redirect", makeEvidenceTransport({ redirected: true }), {}, "GITHUB_PROTOCOL_ERROR"]
  ];
  for (const [name, transport, limits, code] of cases) {
    await assert.rejects(
      () => resolvePublicApplicationEvidence({ primary: PRIMARY, evidence: makePackageEvidence(), limits }, { transport }),
      hasCode(code),
      name
    );
  }
});

test("trusted REST fallback indexes one complete tree before loading nested evidence bytes", async () => {
  const nestedPrimary = {
    ...PRIMARY,
    sourcePaths: ["reports/compatibility-report.json", "src", "test"]
  };
  const blobObjectId = gitBlobObjectId(EVIDENCE_BYTES);
  const evidence = [{
    id: "unit-tests",
    kind: "unit",
    status: "passed",
    scope: "Builder-owned unit checks for the exact declared source revision.",
    url: `${nestedPrimary.repositoryUri}/blob/${nestedPrimary.revisionObjectId}/reports/compatibility-report.json`,
    sha256: EVIDENCE_SHA256
  }];
  const requests = [];
  const transport = async (request) => {
    requests.push(request.url);
    let body;
    if (request.url.endsWith(`/git/trees/${nestedPrimary.treeObjectId}?recursive=1`)) {
      body = {
        sha: nestedPrimary.treeObjectId,
        truncated: false,
        tree: [{ path: "reports/compatibility-report.json", type: "blob", sha: blobObjectId }]
      };
    } else if (request.url.endsWith(`/git/blobs/${blobObjectId}`)) {
      body = {
        sha: blobObjectId,
        encoding: "base64",
        size: EVIDENCE_BYTES.length,
        content: EVIDENCE_BYTES.toString("base64")
      };
    } else {
      assert.fail(`unexpected nested evidence request: ${request.url}`);
    }
    return {
      status: 200,
      headers: {},
      body: JSON.stringify(body),
      redirected: false,
      responseUrl: request.url
    };
  };
  const observations = await resolvePublicApplicationEvidence(
    { primary: nestedPrimary, evidence, limits: {} },
    { transport }
  );
  assert.equal(observations[0].path, "reports/compatibility-report.json");
  assert.deepEqual(requests, [
    `https://api.github.com/repos/alice/example-hook/git/trees/${nestedPrimary.treeObjectId}?recursive=1`,
    `https://api.github.com/repos/alice/example-hook/git/blobs/${blobObjectId}`
  ]);
});

test("rebinding the central package cannot make a false external blob digest pass", async (t) => {
  const files = makePackage({
    mutateEvidence(index) {
      index.evidence[0].sha256 = `sha256:${"f".repeat(64)}`;
    }
  });
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, files);
  const candidateCommit = commitAll(fixture.candidate, "false evidence digest");
  const transport = makeEvidenceTransport();
  await rejectsCode(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      resolveEvidence: (request) => resolvePublicApplicationEvidence(request, { transport })
    }),
    "EVIDENCE_BLOB_DIGEST_MISMATCH"
  );
});

test("Actions evidence binds the exact run attempt and accepts only semantically matching outcomes", async (t) => {
  const validCases = [
    ["passed", "completed", "success"],
    ["failed", "completed", "failure"],
    ["blocked", "in_progress", null],
    ["not-run", "completed", "skipped"]
  ];
  for (const [declaredStatus, status, conclusion] of validCases) {
    await t.test(`valid ${declaredStatus}`, async (t2) => {
      const { files } = makeActionPackage(declaredStatus);
      const fixture = createRevisionPair(t2);
      writePackage(fixture.candidate, files);
      const candidateCommit = commitAll(fixture.candidate, `valid Actions ${declaredStatus}`);
      const report = await verifyPublicHookApplication({
        ...inputFor(fixture, candidateCommit),
        resolveSource: actionSourceResolver({ status, conclusion, runAttempt: "7" })
      });
      assert.deepEqual(report.evidenceBindings[0], {
        id: "unit-tests",
        kind: "unit",
        declaredStatus,
        statusAuthority: "github-observed",
        identityAuthority: "github-observed",
        location: "github-actions",
        runId: "123",
        runAttempt: "7",
        workflowId: "456",
        workflowPath: ".github/workflows/ci.yml",
        headRevision: PRIMARY.revisionObjectId,
        headTree: PRIMARY.treeObjectId,
        event: "push",
        status,
        conclusion,
        htmlUrl: `${PRIMARY.repositoryUri}/actions/runs/123`
      });
    });
  }

  const invalidCases = [
    ["passed", "completed", "failure"],
    ["failed", "completed", "success"],
    ["blocked", "completed", "success"],
    ["not-run", "completed", "neutral"]
  ];
  for (const [declaredStatus, status, conclusion] of invalidCases) {
    await t.test(`invalid ${declaredStatus}`, async (t2) => {
      const { files } = makeActionPackage(declaredStatus);
      const fixture = createRevisionPair(t2);
      writePackage(fixture.candidate, files);
      const candidateCommit = commitAll(fixture.candidate, `invalid Actions ${declaredStatus}`);
      await rejectsCode(
        () => verifyPublicHookApplication({
          ...inputFor(fixture, candidateCommit),
          resolveSource: actionSourceResolver({ status, conclusion })
        }),
        "EVIDENCE_ACTION_STATUS_MISMATCH"
      );
    });
  }
});

test("per-file and aggregate package byte ceilings are enforced by the pure core", () => {
  const files = makePackage();
  const totalBytes = [...files.values()].reduce((total, bytes) => total + bytes.length, 0);
  assert.throws(
    () => validatePublicApplicationPackageFiles({
      applicationId: "example-hook",
      packageFiles: files,
      limits: { maximumPackageBytes: totalBytes - 1 }
    }),
    hasCode("APPLICATION_PACKAGE_TOO_LARGE")
  );
  assert.throws(
    () => validatePublicApplicationPackageFiles({
      applicationId: "example-hook",
      packageFiles: files,
      limits: { maximumFileBytes: { "PROPOSAL.md": files.get("PROPOSAL.md").length - 1 } }
    }),
    hasCode("APPLICATION_FILE_TOO_LARGE")
  );
});

test("the frozen source contract rejects noncanonical URI casing and array order", () => {
  const uppercase = makePackage({ mutateApplication: (application) => {
    application.source.primary.repositoryUri = "https://github.com/Alice/example-hook";
  } });
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: uppercase }),
    hasCode("SOURCE_CONTRACT_INVALID")
  );

  const unsorted = makePackage({ mutateApplication: (application) => {
    application.source.primary.sourcePaths = ["test", "src"];
  } });
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: unsorted }),
    hasCode("SOURCE_CONTRACT_ORDER_INVALID")
  );
});

test("review files are cryptographically bound to application.json", () => {
  const files = makePackage();
  files.set("THREAT_MODEL.md", Buffer.from("# Threat model\nChanged after the manifest hash was created.\n"));
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
    hasCode("REVIEW_FILE_BINDING_MISMATCH")
  );
});

test("noncanonical JSON and duplicate-key spellings cannot pass canonical closure", () => {
  const files = makePackage();
  const parsed = JSON.parse(files.get("evidence-index.json").toString("utf8"));
  files.set("evidence-index.json", Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`));
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
    hasCode("JSON_NOT_CANONICAL")
  );
});

test("active markdown, embedded images, unsafe schemes, controls, and bidi overrides are rejected", () => {
  const substantivePrefix = "# Proposal\nThis review body is intentionally long enough to reach the active-content checks.\n";
  for (const maliciousSuffix of [
    "<script>alert(1)</script>\n",
    "<img src=https://example.invalid/pixel>\n",
    "![pixel](https://example.invalid/pixel)\n",
    "![pixel][tracking]\n\n[tracking]: https://example.invalid/pixel\n",
    "[jump](javascript:alert(1))\n",
    "<https://example.invalid/autolink>\n",
    "[jump](jav&#x61;script:alert(1))\n",
    "unsafe\u202econtent\n",
    "unsafe\u200bcontent\n"
  ]) {
    const malicious = `${substantivePrefix}${maliciousSuffix}`;
    const files = makePackage({ markdown: { "PROPOSAL.md": malicious } });
    assert.throws(
      () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
      (error) => error instanceof PublicIntakeError && ["MARKDOWN_ACTIVE_CONTENT", "MARKDOWN_EMBEDDED_CONTENT", "MARKDOWN_TEXT_UNSAFE"].includes(error.code)
    );
  }
});

test("review markdown cannot be an empty heading shell", () => {
  const files = makePackage({ markdown: { "PROPOSAL.md": "# Proposal\nplaceholder\n" } });
  assert.throws(
    () => validatePublicApplicationPackageFiles({ applicationId: "example-hook", packageFiles: files }),
    hasCode("MARKDOWN_CONTENT_INCOMPLETE")
  );
});

test("repository id, revision, tree, visibility, and canonical URI are independently checked", async (t) => {
  for (const [field, value, expectedCode] of [
    ["numericRepositoryId", "999", "GITHUB_REPOSITORY_ID_MISMATCH"],
    ["revisionObjectId", "c".repeat(40), "GITHUB_COMMIT_MISMATCH"],
    ["treeObjectId", "d".repeat(40), "GITHUB_TREE_MISMATCH"],
    ["repositoryUri", "https://github.com/mallory/other", "GITHUB_REPOSITORY_LOCATOR_MISMATCH"],
    ["visibility", "private", "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE"]
  ]) {
    await t.test(field, async (t2) => {
      const fixture = createRevisionPair(t2);
      writePackage(fixture.candidate, makePackage());
      const candidateCommit = commitAll(fixture.candidate, `mismatch ${field}`);
      await rejectsCode(
        () => verifyPublicHookApplication({
          ...inputFor(fixture, candidateCommit),
          resolveSource: async (source) => mutateObservation(await exactSourceResolver(source), field, value)
        }),
        expectedCode
      );
    });
  }
});

test("trusted intake classifies unavailable exact-Git tooling as a system blocker", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.candidate, makePackage());
  const candidateCommit = commitAll(fixture.candidate, "exact Git tooling unavailable");
  await assert.rejects(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      resolveSource: async () => {
        throw new GitHubPublicSourceError(
          "GITHUB_UPSTREAM_REJECTED",
          "Exact Git object tooling is unavailable: git backfill --sparse is required"
        );
      }
    }),
    (error) => error instanceof PublicIntakeError
      && error.code === "TOOLING_BLOCKED"
      && error.kind === "system"
  );
});

test("directory binding makes duplicate application ids impossible", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, "existing application");
  resetClone(fixture);
  const duplicate = makePackage({ applicationId: "second-directory", mutateApplication: (application) => {
    application.applicationId = "example-hook";
  } });
  writePackage(fixture.candidate, duplicate, "second-directory");
  const candidateCommit = commitAll(fixture.candidate, "duplicate application id");
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "APPLICATION_ID_PATH_MISMATCH"
  );
});

test("intake has no global application-count cap with more than 64 existing applications", async (t) => {
  const fixture = createRevisionPair(t);
  for (let index = 0; index < 70; index += 1) {
    const applicationId = `existing-${String(index).padStart(3, "0")}`;
    writePackage(fixture.base, makePackage({ applicationId }), applicationId);
  }
  fixture.baseCommit = commitAll(fixture.base, "large existing application registry");
  resetClone(fixture);
  writePackage(fixture.candidate, makePackage({ applicationId: "new-hook" }), "new-hook");
  const candidateCommit = commitAll(fixture.candidate, "add application after registry growth");
  const report = await verifyPublicHookApplication({
    ...inputFor(fixture, candidateCommit),
    resolveSource: exactSourceResolver
  });
  assert.equal(report.applicationId, "new-hook");
  assert.equal(report.result, "valid-public-application-package");
});

test("an existing application cannot update review prose without a new source commit and tree", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, "application revision one");
  resetClone(fixture);
  const unchangedSource = makePackage({ revision: 2, markdown: { "PROPOSAL.md": "# Proposal\nUpdated review text without source change.\n" } });
  writePackage(fixture.candidate, unchangedSource);
  const candidateCommit = commitAll(fixture.candidate, "stale source revision");
  await rejectsCode(
    () => verifyPublicHookApplication({ ...inputFor(fixture, candidateCommit), resolveSource: exactSourceResolver }),
    "PRIMARY_SOURCE_REVISION_UNCHANGED"
  );
});

test("an existing application can update an exact companion authority without changing primary HEAD", async (t) => {
  const fixture = createRevisionPair(t);
  const companionV1 = {
    ...PRIMARY,
    repositoryUri: "https://github.com/alice/companion",
    numericRepositoryId: "987654321",
    revisionObjectId: "c".repeat(40),
    treeObjectId: "d".repeat(40),
    sourcePaths: ["src/Companion.sol"],
    contractPaths: []
  };
  const companionV2 = {
    ...companionV1,
    revisionObjectId: "e".repeat(40),
    treeObjectId: "f".repeat(40)
  };
  writePackage(fixture.base, makePackage({ mutateApplication: (application) => {
    application.source = makeSourceRequest(PRIMARY, [companionV1]);
  } }));
  fixture.baseCommit = commitAll(fixture.base, "application revision one with companion");
  resetClone(fixture);

  const next = makePackage({ revision: 2, mutateApplication: (application) => {
    application.source = makeSourceRequest(PRIMARY, [companionV2]);
  } });
  const compatibility = JSON.parse(next.get("compatibility-report.json").toString("utf8"));
  compatibility.result = "changes-required";
  compatibility.findings = [actionableFinding("COMPANION_REVISION_REVIEW_REQUIRED", "warning")];
  next.set("compatibility-report.json", jsonBytes(compatibility));
  const evidence = JSON.parse(next.get("evidence-index.json").toString("utf8"));
  evidence.evidence[0].scope = "Builder-owned unit checks regenerated for the exact companion source revision.";
  next.set("evidence-index.json", jsonBytes(evidence));
  rebindApplicationReviewPackage(next);
  writePackage(fixture.candidate, next);
  const candidateCommit = commitAll(fixture.candidate, "update exact companion authority");

  const report = await verifyPublicHookApplication({
    ...inputFor(fixture, candidateCommit),
    resolveSource: exactSourceResolver
  });
  assert.equal(report.result, "valid-public-application-package");
  assert.equal(report.sourceBinding.companions[0].revisionObjectId, companionV2.revisionObjectId);
});

test("a revision update must regenerate both compatibility and evidence JSON", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, "application revision one");
  resetClone(fixture);
  const nextPrimary = { ...PRIMARY, revisionObjectId: "c".repeat(40), treeObjectId: "d".repeat(40) };
  const next = makePackage({ revision: 2, primary: nextPrimary });
  const priorEvidence = makePackage().get("evidence-index.json");
  next.set("evidence-index.json", priorEvidence);
  rebindApplicationReviewPackage(next);
  writePackage(fixture.candidate, next);
  const candidateCommit = commitAll(fixture.candidate, "incomplete evidence refresh");
  await rejectsCode(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      resolveSource: exactSourceResolver
    }),
    "REVIEW_SOURCE_BINDING_MISMATCH"
  );
});

test("an application revision allows a display-login rename when the immutable user id is unchanged", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, "application before builder login rename");
  resetClone(fixture);
  const nextPrimary = {
    ...PRIMARY,
    revisionObjectId: "c".repeat(40),
    treeObjectId: "d".repeat(40)
  };
  writePackage(fixture.candidate, makePackage({
    revision: 2,
    primary: nextPrimary,
    mutateApplication(application) {
      application.builder.githubLogin = "Alice-Renamed";
      application.builder.contact = "https://github.com/Alice-Renamed";
    }
  }));
  const candidateCommit = commitAll(fixture.candidate, "application after builder login rename");
  const result = await verifyPublicHookApplication({
    ...inputFor(fixture, candidateCommit),
    expectedBuilderLogin: "Alice-Renamed",
    resolveSource: exactSourceResolver
  });
  assert.equal(result.builderIdentity.immutableGitHubUserId, BUILDER_USER_ID);
  assert.equal(result.builderIdentity.manifestLogin, "Alice-Renamed");
});

test("an application revision cannot replace its immutable builder user id even when the event matches", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, "application before builder id substitution");
  resetClone(fixture);
  const nextPrimary = {
    ...PRIMARY,
    revisionObjectId: "c".repeat(40),
    treeObjectId: "d".repeat(40)
  };
  writePackage(fixture.candidate, makePackage({
    revision: 2,
    primary: nextPrimary,
    mutateApplication(application) {
      application.builder.githubUserId = "999";
    }
  }));
  const candidateCommit = commitAll(fixture.candidate, "application with substituted builder id");
  await rejectsCode(
    () => verifyPublicHookApplication({
      ...inputFor(fixture, candidateCommit),
      expectedBuilderUserId: "999",
      resolveSource: exactSourceResolver
    }),
    "BUILDER_IDENTITY_CHANGED"
  );
});

test("a repository rename preserves lineage when GitHub keeps the same numeric id", async (t) => {
  const fixture = createRevisionPair(t);
  writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, "application before repository rename");
  resetClone(fixture);
  const renamedPrimary = {
    ...PRIMARY,
    repositoryUri: "https://github.com/alice/renamed-hook",
    revisionObjectId: "c".repeat(40),
    treeObjectId: "d".repeat(40)
  };
  writePackage(fixture.candidate, makePackage({ revision: 2, primary: renamedPrimary }));
  const candidateCommit = commitAll(fixture.candidate, "application after repository rename");
  const result = await verifyPublicHookApplication({
    ...inputFor(fixture, candidateCommit),
    resolveSource: exactSourceResolver
  });
  assert.equal(result.sourceBinding.primary.numericRepositoryId, PRIMARY.numericRepositoryId);
  assert.equal(result.sourceBinding.primary.repositoryUri, renamedPrimary.repositoryUri);
});

test("the application adapter uses the frozen credential-free GitHubPublicSourceContractV1 interface", async () => {
  const requests = [];
  const declaredBlobs = new Map([
    ["compatibility-report.json", Buffer.from("{}\n")],
    ["test/ExampleHook.t.sol", Buffer.from("contract ExampleHookTest {}\n")],
    ["src/ExampleHook.sol", Buffer.from("contract ExampleHook {}\n")]
  ]);
  const blobRecords = [...declaredBlobs].map(([blobPath, bytes]) => ({
    path: blobPath,
    bytes,
    sha: crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex")
  }));
  const transport = async (request) => {
    requests.push(request);
    let body;
    if (request.url.endsWith(`/git/commits/${PRIMARY.revisionObjectId}`)) {
      body = {
        sha: PRIMARY.revisionObjectId,
        tree: { sha: PRIMARY.treeObjectId },
        html_url: `${PRIMARY.repositoryUri}/commit/${PRIMARY.revisionObjectId}`
      };
    } else if (request.url.includes(`/git/trees/${PRIMARY.treeObjectId}`)) {
      body = {
        sha: PRIMARY.treeObjectId,
        truncated: false,
        tree: []
      };
    } else if (request.url.includes("/git/blobs/")) {
      assert.fail(`the batched exact-object path must not request REST blobs: ${request.url}`);
    } else {
      body = {
        id: Number(PRIMARY.numericRepositoryId),
        private: false,
        visibility: "public",
        full_name: "alice/example-hook",
        default_branch: "main",
        html_url: PRIMARY.repositoryUri
      };
    }
    return { status: 200, headers: {}, body: JSON.stringify(body), redirected: false, responseUrl: request.url };
  };
  const exactObjectRequests = [];
  const observed = await resolvePublicGitHubSource(makeSourceRequest(PRIMARY), {
    transport,
    exactObjectResolver: async (request) => {
      exactObjectRequests.push(request);
      return {
        records: new Map(request.paths.map((sourcePath) => {
          const record = blobRecords.find((candidate) => candidate.path === sourcePath);
          assert.ok(record, `unexpected exact object path: ${sourcePath}`);
          return [sourcePath, { bytes: record.bytes, mode: "100644", objectId: record.sha }];
        }))
      };
    }
  });
  assert.deepEqual(observed.primary.authority, {
    numericRepositoryId: PRIMARY.numericRepositoryId,
    revisionObjectId: PRIMARY.revisionObjectId,
    treeObjectId: PRIMARY.treeObjectId
  });
  assert.deepEqual(requests.map((entry) => entry.url), [
    "https://api.github.com/repos/alice/example-hook",
    `https://api.github.com/repos/alice/example-hook/git/commits/${PRIMARY.revisionObjectId}`,
    `https://api.github.com/repos/alice/example-hook/git/trees/${PRIMARY.treeObjectId}`
  ]);
  assert.equal(exactObjectRequests.length, 1);
  assert.deepEqual(exactObjectRequests[0].paths, [...PRIMARY.sourcePaths, ...PRIMARY.contractPaths].sort());
  assert.ok(requests.every((entry) => entry.method === "GET" && entry.redirect === "error"));
  assert.ok(requests.every((entry) => !Object.keys(entry.headers).some((key) => key.toLowerCase() === "authorization")));
  assert.ok(requests.every((entry) => entry.headers["X-GitHub-Api-Version"] === "2026-03-10"));
});

function makeCompanionClosureFixture() {
  const manifestPath = ".programmable/companions/game.json";
  const primary = {
    ...PRIMARY,
    sourcePaths: [manifestPath, ...PRIMARY.sourcePaths].sort(compareUtf8)
  };
  const companion = {
    repositoryUri: "https://github.com/alice/example-game",
    numericRepositoryId: "987654321",
    revisionObjectId: "c".repeat(40),
    treeObjectId: "d".repeat(40),
    sourcePaths: ["index.html", "src/main.js", "src/math.js", "test/main.test.js"],
    contractPaths: ["package-lock.json", "package.json"],
    githubActionsRunIds: ["7001"]
  };
  const manifest = {
    build: {
      buildScript: "build",
      configurationPaths: [],
      packageLockPath: "package-lock.json",
      packageManifestPath: "package.json",
      testScript: "test"
    },
    closureMethod: COMPANION_MANIFEST_V2.closureMethod,
    githubActionsRunIds: [...companion.githubActionsRunIds],
    numericRepositoryId: companion.numericRepositoryId,
    repositoryUri: companion.repositoryUri,
    revisionObjectId: companion.revisionObjectId,
    runtimePaths: ["index.html"],
    schemaVersion: "2.0.0",
    sourcePaths: ["src/main.js", "src/math.js"],
    testPaths: ["test/main.test.js"],
    treeObjectId: companion.treeObjectId
  };
  const workflow = `${JSON.stringify({
    name: "Programmable companion closure",
    on: ["push"],
    permissions: { contents: "read" },
    jobs: {
      "programmable-companion-closure": {
        "runs-on": "ubuntu-24.04",
        "timeout-minutes": 15,
        steps: [
          { uses: `actions/checkout@${"1".repeat(40)}` },
          {
            uses: `actions/setup-node@${"2".repeat(40)}`,
            with: {
              "node-version": "22.17.0",
              cache: "npm",
              "cache-dependency-path": "package-lock.json"
            }
          },
          { run: "npm ci --ignore-scripts --no-audit --no-fund" },
          { run: "npm run build" },
          { run: "npm run test" }
        ]
      }
    }
  }, null, 2)}\n`;
  const companionFiles = new Map(Object.entries({
    ".github/workflows/ci.yml": workflow,
    "index.html": '<script type="module" src="/src/main.js"></script>\n',
    "package-lock.json": `${JSON.stringify({
      name: "example-game",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: { "": { name: "example-game", version: "1.0.0" } }
    }, null, 2)}\n`,
    "package.json": `${JSON.stringify({
      name: "example-game",
      version: "1.0.0",
      scripts: {
        build: "node --check src/main.js",
        test: "node --test test/main.test.js"
      }
    }, null, 2)}\n`,
    "src/main.js": 'import { add } from "./math.js";\nexport const score = add(1, 2);\n',
    "src/math.js": "export const add = (left, right) => left + right;\n",
    "test/main.test.js": 'import { score } from "../src/main.js";\nif (score !== 3) throw new Error("bad score");\n'
  }).map(([filePath, source]) => [filePath, exactObjectRecord(Buffer.from(source, "utf8"))]));
  const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  const primaryFiles = new Map([[manifestPath, exactObjectRecord(manifestBytes)]]);
  const actionsEvidence = [{
    runId: "7001",
    status: "completed",
    conclusion: "success",
    headRevision: companion.revisionObjectId,
    headTree: companion.treeObjectId,
    event: "push",
    workflowPath: ".github/workflows/ci.yml"
  }];
  const receipt = verifyCompanionManifestV2Closure(
    manifest,
    companionFiles,
    actionsEvidence,
    { manifestPath }
  );
  const requests = [];
  const exactObjectResolver = async (request) => {
    requests.push(request);
    const repositoryFiles = request.repositoryUri === primary.repositoryUri
      ? primaryFiles
      : request.repositoryUri === companion.repositoryUri
        ? companionFiles
        : null;
    assert.ok(repositoryFiles, `unexpected exact repository ${request.repositoryUri}`);
    return {
      records: new Map(request.paths.map((filePath) => {
        const record = repositoryFiles.get(filePath);
        assert.ok(record, `unexpected exact path ${filePath}`);
        return [filePath, { ...record, bytes: Buffer.from(record.bytes) }];
      }))
    };
  };
  return { companion, exactObjectResolver, manifestPath, primary, receipt, requests };
}

function exactObjectRecord(bytes) {
  return {
    bytes,
    mode: "100644",
    objectId: gitBlobObjectId(bytes)
  };
}

function makePackage({
  applicationId = "example-hook",
  revision = 1,
  primary = PRIMARY,
  stage = "proposal",
  compatibilityResult = stage === "prototype" ? "prototype-ready" : "architecture-review-required",
  evidenceStatus = "passed",
  findings = [],
  markdown = {},
  mutateApplication = null,
  mutateCompatibility = null,
  mutateEvidence = null
} = {}) {
  const files = new Map();
  const markdownDefaults = {
    "PROPOSAL.md": "# Proposal\nA bounded public application for an exact external GitHub source revision.\n",
    "THREAT_MODEL.md": "# Threat model\nPoolManager authority, value conservation, custody, exits, and failure paths require review.\n",
    "TEST_PLAN.md": "# Test plan\nRun builder-owned unit, fuzz, invariant, static-analysis, and integration evidence.\n"
  };
  for (const [fileName, source] of Object.entries({ ...markdownDefaults, ...markdown })) {
    files.set(fileName, Buffer.from(source));
  }
  const sourceProjectionValue = sourceProjection(primary);
  const evidenceIndex = {
    schemaVersion: 1,
    applicationId,
    source: sourceProjectionValue,
    attestation: "builder-declared-untrusted",
    evidence: [
      {
        id: "unit-tests",
        kind: "unit",
        status: evidenceStatus,
        scope: "Builder-owned unit checks for the exact declared source revision.",
        url: `${primary.repositoryUri}/blob/${primary.revisionObjectId}/compatibility-report.json`,
        sha256: EVIDENCE_SHA256
      }
    ]
  };
  mutateEvidence?.(evidenceIndex);
  const compatibility = {
    schemaVersion: 1,
    applicationId,
    source: sourceProjectionValue,
    result: compatibilityResult,
    findings,
    disclaimer: PUBLIC_BETA_DISCLAIMER
  };
  mutateCompatibility?.(compatibility);
  files.set("compatibility-report.json", jsonBytes(compatibility));
  files.set("evidence-index.json", jsonBytes(evidenceIndex));
  const application = {
    schemaVersion: 1,
    applicationId,
    applicationRevision: revision,
    stage,
    title: "Example external hook application",
    summary: "A public GitHub source binding with a bounded central review package.",
    builder: {
      githubUserId: BUILDER_USER_ID,
      githubLogin: "alice",
      contact: "https://github.com/alice"
    },
    source: makeSourceRequest(primary),
    companionClosure: [],
    reviewPackage: reviewRecords(files),
    declarations: {
      publicInformationAcknowledged: true,
      noSecretsDeclared: true,
      noApprovalClaim: true,
      noUniswapEndorsementClaim: true
    }
  };
  mutateApplication?.(application);
  files.set("application.json", jsonBytes(application));
  return files;
}

function makePackageEvidence() {
  return JSON.parse(makePackage().get("evidence-index.json").toString("utf8")).evidence;
}

function makeActionPackage(declaredStatus) {
  const primary = { ...PRIMARY, githubActionsRunIds: ["123"] };
  const files = makePackage({
    primary,
    evidenceStatus: declaredStatus,
    mutateEvidence(index) {
      index.evidence[0].url = `${primary.repositoryUri}/actions/runs/123`;
      index.evidence[0].sha256 = null;
    }
  });
  return { files, primary };
}

function actionSourceResolver({ status, conclusion, runAttempt = "1" }) {
  return async (source) => {
    const observation = await exactSourceResolver(source);
    Object.assign(observation.primary.githubActionsEvidence[0], { status, conclusion, runAttempt });
    return observation;
  };
}

function makeEvidenceTransport({
  base64Content = null,
  contentBytes = EVIDENCE_BYTES,
  contentSize = null,
  redirected = false,
  requests = [],
  responseBlobObjectId = null,
  treeBlobObjectId = gitBlobObjectId(contentBytes),
  treeEntries = null,
  treeTruncated = false
} = {}) {
  const responseObjectId = responseBlobObjectId ?? treeBlobObjectId;
  return async (request) => {
    requests.push(request);
    let body;
    if (request.url.endsWith(`/git/trees/${PRIMARY.treeObjectId}?recursive=1`)) {
      body = {
        sha: PRIMARY.treeObjectId,
        truncated: treeTruncated,
        tree: treeEntries ?? [{ path: "compatibility-report.json", type: "blob", sha: treeBlobObjectId }]
      };
    } else if (request.url.endsWith(`/git/blobs/${treeBlobObjectId}`)) {
      body = {
        sha: responseObjectId,
        encoding: "base64",
        size: contentSize ?? contentBytes.length,
        content: base64Content ?? `${contentBytes.toString("base64")}\n`
      };
    } else {
      assert.fail(`unexpected evidence request: ${request.url}`);
    }
    return {
      status: 200,
      headers: {},
      body: JSON.stringify(body),
      redirected,
      responseUrl: request.url
    };
  };
}

function actionableFinding(code, severity) {
  return {
    code,
    path: "$",
    severity,
    summary: "The declared compatibility evidence requires a concrete source change.",
    remediation: "Change the source and regenerate all compatibility evidence for the next revision.",
    evidenceIds: ["unit-tests"]
  };
}

function injectUnsupportedClaim(files, fileName, claim) {
  if (fileName === "application.json") {
    const application = JSON.parse(files.get(fileName).toString("utf8"));
    application.summary = claim;
    files.set(fileName, jsonBytes(application));
    return;
  }
  if (fileName === "compatibility-report.json") {
    const compatibility = JSON.parse(files.get(fileName).toString("utf8"));
    compatibility.findings = [{
      code: "FALSE_PUBLIC_CLAIM",
      path: "$",
      severity: "warning",
      summary: claim,
      remediation: "Remove the unsupported public claim before resubmitting this application.",
      evidenceIds: []
    }];
    files.set(fileName, jsonBytes(compatibility));
  } else if (fileName === "evidence-index.json") {
    const evidence = JSON.parse(files.get(fileName).toString("utf8"));
    evidence.evidence[0].scope = claim;
    files.set(fileName, jsonBytes(evidence));
  } else {
    const heading = {
      "PROPOSAL.md": "# Proposal",
      "THREAT_MODEL.md": "# Threat model",
      "TEST_PLAN.md": "# Test plan"
    }[fileName];
    files.set(fileName, Buffer.from(`${heading}\n${claim}\n`, "utf8"));
  }
  rebindApplicationReviewPackage(files);
}

function rebindApplicationReviewPackage(files) {
  const application = JSON.parse(files.get("application.json").toString("utf8"));
  application.reviewPackage = reviewRecords(files);
  files.set("application.json", jsonBytes(application));
}

function mutateFirstEvidence(files, mutate) {
  const evidence = JSON.parse(files.get("evidence-index.json").toString("utf8"));
  mutate(evidence.evidence[0]);
  files.set("evidence-index.json", jsonBytes(evidence));
  rebindApplicationReviewPackage(files);
}

function setFindingPath(files, findingPath) {
  const compatibility = JSON.parse(files.get("compatibility-report.json").toString("utf8"));
  compatibility.findings = [{
    code: "PATH_REVIEW",
    evidenceIds: [],
    path: findingPath,
    remediation: "Review the exact declared source path before accepting the application package.",
    severity: "informational",
    summary: "The exact declared source path is included for bounded compatibility review."
  }];
  files.set("compatibility-report.json", jsonBytes(compatibility));
  rebindApplicationReviewPackage(files);
}

function reviewRecords(files) {
  return [...files.entries()]
    .filter(([fileName]) => fileName !== "application.json")
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([fileName, bytes]) => ({
      path: fileName,
      sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
      byteLength: bytes.length
    }));
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function sourceProjection(binding) {
  return {
    numericRepositoryId: binding.numericRepositoryId,
    revisionObjectId: binding.revisionObjectId,
    treeObjectId: binding.treeObjectId
  };
}

function makeSourceRequest(primary = PRIMARY, companions = []) {
  const cloneRepositoryRequest = (repository) => ({
    repositoryUri: repository.repositoryUri,
    numericRepositoryId: repository.numericRepositoryId,
    revisionObjectId: repository.revisionObjectId,
    treeObjectId: repository.treeObjectId,
    sourcePaths: [...(repository.sourcePaths ?? [])],
    contractPaths: [...(repository.contractPaths ?? [])],
    githubActionsRunIds: [...(repository.githubActionsRunIds ?? [])]
  });
  return {
    schemaVersion: "1.0.0",
    primary: cloneRepositoryRequest(primary),
    companions: companions.map(cloneRepositoryRequest)
  };
}

function writePackage(repository, files, directoryId = "example-hook") {
  for (const [fileName, bytes] of files) {
    writeFile(repository, `submissions/${directoryId}/${fileName}`, bytes);
  }
}

function createRevisionPair(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-hook-intake-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, "base");
  const candidate = path.join(root, "candidate");
  fs.mkdirSync(base);
  git(base, ["init", "-b", "main"]);
  git(base, ["config", "user.name", "Trusted Test"]);
  git(base, ["config", "user.email", "trusted@example.invalid"]);
  writeFile(base, "README.md", "trusted base\n");
  setIntakeStatus(base, "open");
  const baseCommit = commitAll(base, "trusted base");
  cloneRepository(base, candidate);
  return { root, base, candidate, baseCommit };
}

function configureIntakeApplicationChange(fixture, { state, isUpdate }) {
  setIntakeStatus(fixture.base, state);
  if (isUpdate) writePackage(fixture.base, makePackage());
  fixture.baseCommit = commitAll(fixture.base, `trusted ${state} intake base`);
  resetClone(fixture);
  if (isUpdate) {
    const nextPrimary = {
      ...PRIMARY,
      revisionObjectId: "c".repeat(40),
      treeObjectId: "d".repeat(40)
    };
    writePackage(fixture.candidate, makePackage({ revision: 2, primary: nextPrimary }));
  } else {
    writePackage(fixture.candidate, makePackage());
  }
  return commitAll(fixture.candidate, `${isUpdate ? "update" : "add"} application under ${state}`);
}

function setIntakeStatus(repository, state, continuingPullRequests = []) {
  writeFile(
    repository,
    "docs/builder/intake-status.json",
    Buffer.from(`${canonicalJson({ continuingPullRequests, schemaVersion: 2, state })}\n`, "utf8")
  );
}

function continuationRecord(overrides = {}) {
  return {
    applicationId: "example-hook",
    builderGitHubUserId: BUILDER_USER_ID,
    companionNumericRepositoryIds: [],
    primaryNumericRepositoryId: PRIMARY.numericRepositoryId,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    ...overrides
  };
}

function resetClone(fixture) {
  fs.rmSync(fixture.candidate, { recursive: true, force: true });
  cloneRepository(fixture.base, fixture.candidate);
}

function cloneRepository(source, destination) {
  const result = childProcess.spawnSync("git", ["clone", "--quiet", "--no-local", source, destination], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 0, result.stderr);
  git(destination, ["config", "user.name", "Candidate Test"]);
  git(destination, ["config", "user.email", "candidate@example.invalid"]);
}

function writeFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function commitAll(repository, message) {
  git(repository, ["add", "-A"]);
  return git(repository, ["commit", "-m", message]);
}

function git(repository, args) {
  const result = childProcess.spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  if (args[0] === "commit") return git(repository, ["rev-parse", "HEAD"]);
  return result.stdout.trim();
}

function inputFor(fixture, candidateCommit) {
  return {
    ...classificationInputFor(fixture, candidateCommit),
    pullRequestNumber: PULL_REQUEST_NUMBER,
    expectedBuilderLogin: "alice",
    expectedBuilderUserId: BUILDER_USER_ID,
    resolveSource: exactSourceResolver,
    resolveEvidence: exactEvidenceResolver
  };
}

function classificationInputFor(fixture, candidateCommit) {
  const expectedMergeCommit = createPullRequestMerge(fixture, candidateCommit);
  return {
    baseRoot: fixture.base,
    candidateRoot: fixture.candidate,
    expectedBaseCommit: fixture.baseCommit,
    expectedCandidateCommit: candidateCommit,
    expectedMergeCommit
  };
}

function createPullRequestMerge(fixture, candidateCommit) {
  git(fixture.candidate, ["fetch", "--quiet", "--no-tags", fixture.base, fixture.baseCommit]);
  const mergedTree = git(fixture.candidate, ["merge-tree", "--write-tree", fixture.baseCommit, candidateCommit]);
  assert.match(mergedTree, /^[a-f0-9]{40}$/u);
  const mergeCommit = git(fixture.candidate, [
    "commit-tree",
    mergedTree,
    "-p", fixture.baseCommit,
    "-p", candidateCommit,
    "-m", "Synthetic GitHub pull request merge"
  ]);
  assert.match(mergeCommit, /^[a-f0-9]{40}$/u);
  git(fixture.candidate, ["reset", "--hard", mergeCommit]);
  return mergeCommit;
}

function runTrustedCli(argumentsList) {
  return childProcess.spawnSync(
    process.execPath,
    [path.resolve("scripts/verify-public-hook-application.mjs"), ...argumentsList],
    { encoding: "utf8", shell: false }
  );
}

async function exactSourceResolver(source) {
  const observeRepository = (binding, role) => {
    const url = new URL(binding.repositoryUri);
    const [owner, repository] = url.pathname.slice(1).split("/");
    return {
      role,
      authority: {
        numericRepositoryId: binding.numericRepositoryId,
        revisionObjectId: binding.revisionObjectId,
        treeObjectId: binding.treeObjectId
      },
      display: {
        repositoryUri: binding.repositoryUri,
        owner,
        repository,
        defaultBranch: "main"
      },
      visibility: "public",
      sourcePaths: [...(binding.sourcePaths ?? [])],
      contractPaths: [...(binding.contractPaths ?? [])],
      githubActionsEvidence: (binding.githubActionsRunIds ?? []).map((runId) => ({
        runId,
        runAttempt: "1",
        workflowId: "456",
        workflowPath: ".github/workflows/ci.yml",
        headRevision: binding.revisionObjectId,
        headTree: binding.treeObjectId,
        event: "push",
        status: "completed",
        conclusion: "success",
        htmlUrl: `${binding.repositoryUri}/actions/runs/${runId}`
      }))
    };
  };
  return {
    schemaVersion: "1.0.0",
    kind: "github-public-source",
    canonicalProviderOrigin: "https://github.com",
    githubApiVersion: "2026-03-10",
    primary: observeRepository(source.primary, "primary"),
    companions: source.companions.map((entry) => observeRepository(entry, "companion"))
  };
}

async function exactEvidenceResolver({ primary, evidence }) {
  return evidence.map((record) => {
    const prefix = `${primary.repositoryUri}/blob/${primary.revisionObjectId}/`;
    assert.ok(record.url.startsWith(prefix));
    return {
      id: record.id,
      path: decodeURIComponent(record.url.slice(prefix.length)),
      blobObjectId: gitBlobObjectId(EVIDENCE_BYTES),
      bytes: Buffer.from(EVIDENCE_BYTES)
    };
  });
}

function gitBlobObjectId(bytes) {
  return crypto.createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function mutateObservation(observation, field, value) {
  const mutated = structuredClone(observation);
  if (field === "visibility") mutated.primary.visibility = value;
  else if (field === "repositoryUri") mutated.primary.display.repositoryUri = value;
  else mutated.primary.authority[field] = value;
  return mutated;
}

async function rejectsCode(operation, code) {
  await assert.rejects(operation, hasCode(code));
}

function hasCode(code) {
  return (error) => error instanceof PublicIntakeError && error.code === code;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function makeSchemaApplication() {
  const application = JSON.parse(makePackage().get("application.json").toString("utf8"));
  application.stage = "proposal";
  return application;
}

function compilePublicApplicationSchema() {
  const schema = JSON.parse(fs.readFileSync(
    path.resolve("skills/programmable-v4-hook-builder/references/public-pr-application.schema.json"),
    "utf8"
  ));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true, strictTypes: false });
  ajv.addKeyword({ keyword: "x-programmable-derived-from", schemaType: "object", valid: true });
  ajv.addFormat("uri", {
    type: "string",
    validate(value) {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }
  });
  return ajv.compile(schema);
}

function collectSchemaReferences(value, references = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectSchemaReferences(entry, references);
    return references;
  }
  if (!value || typeof value !== "object") return references;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string") references.push(entry);
    else collectSchemaReferences(entry, references);
  }
  return references;
}
