import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflowPath = path.resolve(".github/workflows/verify-hook-builder.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");
const normalWorkflow = fs.readFileSync(path.resolve(".github/workflows/verify.yml"), "utf8");
const validatorCore = fs.readFileSync(path.resolve("scripts/verify-public-hook-application-core.mjs"), "utf8");
const permissionBlock = workflow.slice(
  workflow.indexOf("permissions:"),
  workflow.indexOf("concurrency:")
);
const pullRequestTarget = workflow.slice(
  workflow.indexOf("  pull_request_target:"),
  workflow.indexOf("  push:")
);
const publicJob = workflow.slice(
  workflow.indexOf("  public-intake:"),
  workflow.indexOf("  trusted-post-merge:")
);
const postMergeJob = workflow.slice(workflow.indexOf("  trusted-post-merge:"));
const classificationStep = publicJob.slice(
  publicJob.indexOf("- name: Classify candidate data with trusted base code"),
  publicJob.indexOf("- name: Verify closed public application package")
);
const verificationStep = publicJob.slice(
  publicJob.indexOf("- name: Verify closed public application package"),
  publicJob.indexOf("- name: Defer executable builder-maintenance checks to read-only pull-request CI")
);
const hydrationStep = publicJob.slice(
  publicJob.indexOf("- name: Preflight and hydrate only bounded application blobs"),
  publicJob.indexOf("- name: Remove candidate fetch credential")
);
const builderMaintenanceStep = publicJob.slice(
  publicJob.indexOf("- name: Defer executable builder-maintenance checks to read-only pull-request CI"),
  publicJob.indexOf("- name: Preserve legacy pull-request compatibility")
);
const candidateFetchStep = publicJob.slice(
  publicJob.indexOf("- name: Fetch exact candidate merge as blobless data"),
  publicJob.indexOf("- name: Classify candidate data with trusted base code")
);
const credentialCleanupStep = publicJob.slice(
  publicJob.indexOf("- name: Remove candidate fetch credential")
);
const normalMaintenanceJob = normalWorkflow.slice(
  normalWorkflow.indexOf("  hook-builder-maintenance:"),
  normalWorkflow.indexOf("  foundry:")
);

test("pull_request_target runs on every main-branch PR so legacy changes receive an explicit no-op", () => {
  assert.match(pullRequestTarget, /branches:\n\s+- main/u);
  assert.doesNotMatch(pullRequestTarget, /paths:/u);
  assert.match(publicJob, /steps\.classify\.outputs\.mode == 'no-op'/u);
});

test("workflow authority is globally read-only and does not consume secrets", () => {
  assert.match(workflow, /\npermissions:\n  contents: read\n/u);
  assert.doesNotMatch(permissionBlock, /\b(?:write|admin)\b/u);
  assert.doesNotMatch(workflow, /secrets\.|pull-requests:\s|issues:\s|id-token:\s/u);
});

test("external source resolution receives no workflow credential", () => {
  assert.match(verificationStep, /GH_TOKEN: ""/u);
  assert.match(verificationStep, /GITHUB_TOKEN: ""/u);
  assert.doesNotMatch(verificationStep, /\$\{\{\s*(?:github\.token|secrets\.)/u);
  assert.match(verificationStep, /actions\/concepts\/security\/github_token/u);
});

test("application identity binds to GitHub's authenticated pull-request author id and current login", () => {
  assert.match(
    verificationStep,
    /--expected-builder-login "\$\{\{ github\.event\.pull_request\.user\.login \}\}"/u
  );
  assert.match(
    verificationStep,
    /--expected-builder-user-id "\$\{\{ github\.event\.pull_request\.user\.id \}\}"/u
  );
  assert.equal((workflow.match(/github\.event\.pull_request\.user\.login/gu) ?? []).length, 1);
  assert.equal((workflow.match(/github\.event\.pull_request\.user\.id/gu) ?? []).length, 1);
  assert.doesNotMatch(classificationStep, /--expected-builder-login/u);
  assert.doesNotMatch(classificationStep, /--expected-builder-user-id/u);
  assert.doesNotMatch(builderMaintenanceStep, /--expected-builder-login/u);
  assert.doesNotMatch(builderMaintenanceStep, /--expected-builder-user-id/u);
  assert.doesNotMatch(
    publicJob,
    /github\.(?:actor|triggering_actor)|github\.event\.(?:sender\.login|pull_request\.head\.repo\.owner\.login)/u
  );
});

test("every third-party action is pinned to an immutable full commit", () => {
  for (const source of [workflow, normalWorkflow]) {
    const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map((match) => match[1]);
    assert.ok(uses.length >= 2);
    for (const action of uses) assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/u);
  }
});

test("candidate data is an exact base-repository PR merge in a bare blobless object store", () => {
  assert.match(candidateFetchStep, /--fetch-candidate/u);
  assert.match(candidateFetchStep, /--repository "\$\{\{ github\.repository \}\}"/u);
  assert.match(candidateFetchStep, /--pull-request-number "\$\{\{ github\.event\.pull_request\.number \}\}"/u);
  assert.match(candidateFetchStep, /--base-root "\$GITHUB_WORKSPACE\/trusted"/u);
  assert.match(candidateFetchStep, /--expected-base-commit "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
  assert.match(candidateFetchStep, /--expected-candidate-commit "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/u);
  assert.match(candidateFetchStep, /--expected-merge-commit "\$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}"/u);
  assert.match(candidateFetchStep, /--candidate-root "\$GITHUB_WORKSPACE\/candidate\.git"/u);
  assert.match(validatorCore, /init", "--quiet", "--bare", "--object-format=sha1"/u);
  assert.match(validatorCore, /`\+refs\/pull\/\$\{pullRequestNumber\}\/merge:refs\/heads\/candidate-merge`/u);
  assert.match(validatorCore, /"--filter=blob:none"/u);
  assert.match(validatorCore, /"--depth=1"/u);
  assert.match(validatorCore, /\\tpromisor = true/u);
  assert.match(validatorCore, /\\tpartialclonefilter = blob:none/u);
  assert.match(validatorCore, /runBoundedHydrationGitProcess/u);
  assert.match(validatorCore, /observedMergeCommit !== expectedMergeCommit/u);
  assert.match(validatorCore, /await preflightPublicApplicationCandidateFetch/u);
  assert.ok(
    validatorCore.indexOf("await preflightPublicApplicationCandidateFetch")
      < validatorCore.indexOf("const gitDirectory = validateNewCandidateDirectory")
  );
  assert.doesNotMatch(candidateFetchStep, /head\.repo\.full_name|head\.ref|actions\/checkout|checkout|worktree|read-tree|reset|archive/u);
  assert.doesNotMatch(candidateFetchStep, /submodule\s+(?:init|update)|git\s+lfs|smudge/u);
  assert.match(classificationStep, /--candidate-root "\$GITHUB_WORKSPACE\/candidate\.git"/u);
  assert.match(verificationStep, /--candidate-root "\$GITHUB_WORKSPACE\/candidate\.git"/u);
});

test("candidate code, configuration, hooks, filters, and submodules never execute", () => {
  assert.match(publicJob, /GIT_CONFIG_GLOBAL: \/dev\/null/u);
  assert.match(publicJob, /GIT_CONFIG_NOSYSTEM: "1"/u);
  assert.match(validatorCore, /core\.hooksPath=\/dev\/null/u);
  assert.match(validatorCore, /core\.attributesFile=\/dev\/null/u);
  assert.match(validatorCore, /fetch\.recurseSubmodules=false/u);
  assert.match(validatorCore, /submodule\.recurse=false/u);
  assert.match(validatorCore, /protocol\.file\.allow=\$\{allowFileProtocol \? "always" : "never"\}/u);
  assert.match(validatorCore, /protocol\.ext\.allow=never/u);
  assert.match(validatorCore, /protocol\.https\.allow=always/u);
  assert.doesNotMatch(publicJob, /working-directory:\s*(?:candidate|\$\{\{[^}]*candidate)/u);
  assert.doesNotMatch(publicJob, /(?:npm|npx|pnpm|yarn|forge|slither|foundryup)\b/u);
  assert.doesNotMatch(publicJob, /verify-package\.mjs/u);
  assert.doesNotMatch(publicJob, /node\s+["']?\$GITHUB_WORKSPACE\/candidate(?:\.git)?/u);
  assert.doesNotMatch(publicJob, /(?:bash|sh)\s+["']?\$GITHUB_WORKSPACE\/candidate(?:\.git)?/u);
  assert.match(builderMaintenanceStep, /mode == 'builder-maintenance'/u);
  assert.match(builderMaintenanceStep, /No maintenance blob is hydrated or parsed under pull_request_target/u);
  assert.match(builderMaintenanceStep, /only in ordinary read-only pull-request CI/u);
  assert.doesNotMatch(publicJob, /--skill-root|--untrusted-data|candidate\/skills|candidate\.git\/skills/u);
  assert.doesNotMatch(builderMaintenanceStep, /(?:node|bash|sh)\s+["']?\$GITHUB_WORKSPACE\/candidate/u);
});

test("application blobs require bounded metadata preflight and lazy fetching stays disabled", () => {
  assert.match(hydrationStep, /--hydrate-candidate/u);
  assert.match(hydrationStep, /--repository "\$\{\{ github\.repository \}\}"/u);
  assert.match(hydrationStep, /--pull-request-number "\$\{\{ github\.event\.pull_request\.number \}\}"/u);
  assert.match(verificationStep, /--pull-request-number "\$\{\{ github\.event\.pull_request\.number \}\}"/u);
  assert.match(hydrationStep, /CANDIDATE_READ_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(verificationStep, /GIT_NO_LAZY_FETCH: "1"/u);
  assert.match(validatorCore, /GIT_NO_LAZY_FETCH: "1"/u);
  assert.match(validatorCore, /\/git\/trees\/\$\{packageTreeObjectId\}/u);
  assert.match(validatorCore, /record\.size > maximumBytes/u);
  assert.match(validatorCore, /APPLICATION_FILE_TOO_LARGE/u);
  assert.match(validatorCore, /backfill", "--sparse/u);
  assert.match(validatorCore, /ulimit -f/u);
  assert.match(validatorCore, /ulimit -t/u);
  assert.match(validatorCore, /ulimit -v/u);
  assert.match(validatorCore, /CANDIDATE_GIT_ADDRESS_SPACE_BYTES = 512 \* 1024 \* 1024/u);
  assert.match(validatorCore, /core\.deltaBaseCacheLimit=16m/u);
  assert.match(validatorCore, /pack\.threads=1/u);
  assert.match(validatorCore, /measureHydrationDirectory/u);
  assert.match(validatorCore, /process\.kill\(-child\.pid/u);
});

test("the central read credential is scoped, isolated from public resolution, and always removed", () => {
  assert.match(candidateFetchStep, /CANDIDATE_READ_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(validatorCore, /\[http \\"https:\/\/github\.com\/\\"\]/u);
  assert.match(validatorCore, /extraheader = AUTHORIZATION: basic/u);
  assert.match(validatorCore, /Buffer\.from\(`x-access-token:\$\{readToken\}`/u);
  assert.doesNotMatch(candidateFetchStep, /https:\/\/[^\s"$]*@github\.com|credential\.helper/u);
  assert.match(credentialCleanupStep, /if: always\(\)/u);
  assert.match(credentialCleanupStep, /--unset-all http\.https:\/\/github\.com\/\.extraheader/u);
  assert.match(credentialCleanupStep, /\^\(http\\\.\.\*\\\.extraheader\|credential\\\.\)/u);
  assert.match(verificationStep, /GH_TOKEN: ""/u);
  assert.match(verificationStep, /GITHUB_TOKEN: ""/u);
  assert.equal((publicJob.match(/\$\{\{ github\.token \}\}/gu) ?? []).length, 2);
  assert.doesNotMatch(builderMaintenanceStep, /github\.token|CANDIDATE_READ_TOKEN/u);
});

test("workflow fails before candidate fetch when GitHub cannot provide an immutable PR merge", () => {
  const mergePreflight = publicJob.slice(
    publicJob.indexOf("- name: Require immutable PR merge identity"),
    publicJob.indexOf("- name: Fetch exact candidate merge as blobless data")
  );
  assert.match(mergePreflight, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(mergePreflight, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(mergePreflight, /MERGE_SHA: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/u);
  assert.match(mergePreflight, /\^\[a-f0-9\]\{40\}\$/u);
  assert.match(mergePreflight, /Resolve merge conflicts and retry/u);
});

test("classification and validation execute only trusted base-branch validators", () => {
  assert.match(publicJob, /trusted\/scripts\/verify-public-hook-application\.mjs/u);
  assert.doesNotMatch(publicJob, /candidate(?:\.git)?\/skills\/programmable-v4-hook-builder\/scripts/u);
  assert.match(publicJob, /--classify/u);
  assert.match(publicJob, /--expected-base-commit "\$\{\{ github\.event\.pull_request\.base\.sha \}\}"/u);
  assert.match(publicJob, /--expected-candidate-commit "\$\{\{ github\.event\.pull_request\.head\.sha \}\}"/u);
  assert.match(publicJob, /--expected-merge-commit "\$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}"/u);
  assert.match(publicJob, /timeout --signal=KILL 30s/u);
  assert.match(publicJob, /timeout --signal=KILL 120s/u);
});

test("builder maintenance runs only in normal read-only CI with closed offline checks", () => {
  assert.match(normalWorkflow, /\non:\n  pull_request:/u);
  assert.match(normalWorkflow, /\npermissions:\n  contents: read\n/u);
  assert.doesNotMatch(normalWorkflow, /secrets\./u);
  assert.match(normalMaintenanceJob, /persist-credentials: false/u);
  assert.match(normalMaintenanceJob, /lfs: false/u);
  assert.match(normalMaintenanceJob, /submodules: false/u);
  assert.match(normalMaintenanceJob, /npm ci --prefix scripts\/test\/schema-validator --ignore-scripts --no-audit --no-fund/u);
  assert.match(normalMaintenanceJob, /generate-plugin\.mjs --check/u);
  assert.match(normalMaintenanceJob, /plugin-packaging\.test\.mjs/u);
  assert.match(normalMaintenanceJob, /scripts\/evals\/validate-evals\.mjs/u);
  assert.match(normalMaintenanceJob, /node --test evals\/tests\/\*\.test\.mjs/u);
  assert.doesNotMatch(normalMaintenanceJob, /ANTHROPIC_API_KEY|--require-provider|github\.token/u);
});

test("workflow bounds job lifetime and cancels superseded pull-request work", () => {
  assert.match(workflow, /concurrency:[\s\S]*?cancel-in-progress: true/u);
  assert.match(publicJob, /timeout-minutes: 10/u);
  assert.match(postMergeJob, /timeout-minutes: 15/u);
});

test("post-merge validation does not impose a repository-global application cap", () => {
  assert.match(
    postMergeJob,
    /verify-public-hook-application\.mjs" \\\n\s+--verify-maintained \\\n\s+--repository-root "\$source_root"/u
  );
  assert.doesNotMatch(postMergeJob, /maximum_packages|Maintained intake exceeds|head -z/u);
});
