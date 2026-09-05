#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseStrictJson, canonicalizeJson } from "../packages/launch/src/canonical-json.mjs";
import * as legacyCleanRoom from "./programmable-launch-v4-clean-room.mjs";
import * as legacyBinding from "./programmable-launch-v4-release-binding.mjs";
import * as legacyActivation from "../lib/custom-launch/v4-api-activation.mjs";

export function createActivationImportTools({
  cleanRoom = legacyCleanRoom, binding = legacyBinding, activation = legacyActivation,
  artifactPrefix = "programmable-launch-v4-clean-room",
  trustedVerifierPaths = [legacyActivation.CLEAN_ROOM_WORKFLOW, "scripts/programmable-launch-v4-clean-room.mjs"],
} = {}) {
  const { validateCleanRoomEvidence, validateReviewedReleaseCoordinate, REVIEWED_RELEASE_COORDINATE_PATH } = cleanRoom;
  const { V4_RELEASE_BINDING_PATH } = binding;
  const { ACTIVATION_SCHEMA, ACTIVATION_PATH, SUCCESS_EVIDENCE_PATH, SUCCESS_ATTESTATION_PATH, CLEAN_ROOM_WORKFLOW, REPOSITORY, assertActivationRecord, bytesDigest, jsonDigest } = activation;

  const REF = "refs/heads/production";
  const FILES = [path.basename(SUCCESS_ATTESTATION_PATH), path.basename(SUCCESS_EVIDENCE_PATH)].sort();
  const canonicalBytes = value => Buffer.from(`${canonicalizeJson(value)}\n`);
  const parse = bytes => parseStrictJson(bytes.toString("utf8"), { maximumBytes: 16 * 1024 * 1024 });
  const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
  function assertActivationJsonEqual(actual, expected, message) {
    assert.equal(canonicalizeJson(actual), canonicalizeJson(expected), message);
  }
  function command(file, args, root) {
    const env = {};
    for (const name of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "GH_TOKEN", "GITHUB_TOKEN", "GH_CONFIG_DIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"])
      if (process.env[name] !== undefined) env[name] = process.env[name];
    Object.assign(env, { GH_HOST: "github.com", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
    try { return execFileSync(file, args, { cwd: root, env, maxBuffer: 32 * 1024 * 1024, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }); }
    catch { throw new Error(`V4 activation ${file} verification failed`); }
  }
  const gh = (endpoint, root) => parse(command("gh", ["api", "--hostname", "github.com", "--method", "GET", endpoint], root));
  function regular(file) {
    const stat = lstatSync(file);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 16 * 1024 * 1024, "V4 activation file is not bounded and regular");
    return readFileSync(file);
  }
  function inputs(root) {
    const bindingBytes = regular(path.join(root, V4_RELEASE_BINDING_PATH));
    const coordinateBytes = regular(path.join(root, REVIEWED_RELEASE_COORDINATE_PATH));
    return { bindingBytes, coordinateBytes, binding: parse(bindingBytes), coordinate: parse(coordinateBytes) };
  }
  function assertRunMetadata(run, evidence) {
    const producer = evidence.producer;
    const expected = { id: Number(producer.runId), run_attempt: 1, event: "workflow_dispatch", head_branch: "production", head_sha: producer.sourceSha, status: "completed", conclusion: "success" };
    for (const [key, value] of Object.entries(expected)) assert.equal(run[key], value, `V4 activation run ${key} differs`);
    assert.equal(run.path, CLEAN_ROOM_WORKFLOW);
    assert.equal(run.repository?.full_name, REPOSITORY);
    assert.equal(run.repository?.id, 1314365508);
    assert.equal(run.head_commit?.id, producer.sourceSha);
    for (const key of ["actor", "triggering_actor"]) {
      assert.equal(run[key]?.login, "hazarxyz"); assert.equal(run[key]?.id, 258789013);
    }
    return run;
  }
  function assertProducerMetadata(run, artifact, evidence, artifactRef) {
    assertRunMetadata(run, evidence);
    const producer = evidence.producer;
    assert.equal(String(artifact.id), artifactRef.id);
    assert.equal(artifact.digest, artifactRef.digest);
    assert.equal(artifact.name, `${artifactPrefix}-evidence-attestation-${producer.runId}-1`);
    // Retention controls archive downloads, not the validity of the imported signed proof.
    assert.equal(artifact.workflow_run?.id, Number(producer.runId));
    assert.equal(artifact.workflow_run?.head_sha, producer.sourceSha);
    assert.equal(artifact.workflow_run?.head_branch, "production");
    assert.equal(artifact.workflow_run?.repository_id, 1314365508);
    assert.equal(artifact.workflow_run?.head_repository_id, 1314365508);
  }
  function assertVerifiedAttestation(output, evidenceBytes, producer) {
    requireValue(Array.isArray(output) && output.length === 1, "V4 activation requires one verified attestation");
    const result = output[0]?.verificationResult;
    const certificate = result?.signature?.certificate;
    const uri = `https://github.com/${REPOSITORY}`;
    const workflowUri = `${uri}/${CLEAN_ROOM_WORKFLOW}@${REF}`;
    const fields = {
      issuer: "https://token.actions.githubusercontent.com", githubWorkflowTrigger: "workflow_dispatch",
      githubWorkflowSHA: producer.sourceSha, githubWorkflowRepository: REPOSITORY, githubWorkflowRef: REF,
      runnerEnvironment: "github-hosted", sourceRepositoryURI: uri, sourceRepositoryDigest: producer.sourceSha,
      sourceRepositoryRef: REF, sourceRepositoryIdentifier: "1314365508", buildConfigURI: workflowUri,
      buildConfigDigest: producer.sourceSha, buildSignerURI: workflowUri, buildSignerDigest: producer.sourceSha,
      buildTrigger: "workflow_dispatch", runInvocationURI: `${uri}/actions/runs/${producer.runId}/attempts/1`,
      subjectAlternativeName: workflowUri,
    };
    for (const [key, value] of Object.entries(fields)) assert.equal(certificate?.[key], value, `V4 activation certificate ${key} differs`);
    assert.equal(result.statement?.predicateType, "https://slsa.dev/provenance/v1");
    assert.equal(result.statement?.subject?.length, 1);
    assert.equal(result.statement.subject[0]?.digest?.sha256, bytesDigest(evidenceBytes).slice(7));
  }
  function createActivationRecord(bindingBytes, coordinateBytes, evidenceBytes, bundleBytes, artifact) {
    const binding = parse(bindingBytes);
    const coordinate = validateReviewedReleaseCoordinate(parse(coordinateBytes), { releaseReady: binding.releaseReady, bindingSha256: bytesDigest(bindingBytes) });
    const evidence = validateCleanRoomEvidence(parse(evidenceBytes));
    assert.ok(canonicalBytes(evidence).equals(evidenceBytes), "V4 activation evidence must be canonical");
    const record = { schemaVersion: ACTIVATION_SCHEMA, scope: "api-until-wallet", proof: {
      releaseBinding: { sha256: bytesDigest(bindingBytes), jsonSha256: jsonDigest(binding) },
      cliCoordinate: { sha256: bytesDigest(coordinateBytes), jsonSha256: jsonDigest(coordinate) },
      cleanRoom: { path: SUCCESS_EVIDENCE_PATH, sha256: bytesDigest(evidenceBytes), attestationPath: SUCCESS_ATTESTATION_PATH,
        attestationSha256: bytesDigest(bundleBytes), artifact, evidence },
    } };
    assert.equal(assertActivationRecord(record, binding, coordinate), true);
    return record;
  }
  function verifyBoundEvidence(root, record, data, evidenceBytes, bundleBytes, verifyArchiveMetadata = false) {
    const clean = record.proof.cleanRoom;
    assertActivationJsonEqual(record, createActivationRecord(data.bindingBytes, data.coordinateBytes, evidenceBytes, bundleBytes, clean.artifact), "V4 activation record differs");
    const evidence = clean.evidence;
    const producer = evidence.producer;
    const run = gh(`repos/${REPOSITORY}/actions/runs/${producer.runId}`, root);
    assertRunMetadata(run, evidence);
    if (verifyArchiveMetadata) {
      const artifact = gh(`repos/${REPOSITORY}/actions/artifacts/${clean.artifact.id}`, root);
      assertProducerMetadata(run, artifact, evidence, clean.artifact);
    }
    // Subsequent audits authenticate the preserved signed subject and exact producer run.
    // Expiring GitHub's ZIP retention cannot invalidate those committed proof bytes.
    const git = args => command("git", ["-C", root, ...args], root);
    assert.equal(git(["remote", "get-url", "origin"]).toString().trim(), `https://github.com/${REPOSITORY}`);
    git(["merge-base", "--is-ancestor", producer.sourceSha, "HEAD"]);
    assert.equal(git(["rev-parse", `${producer.sourceSha}^{tree}`]).toString().trim(), run.head_commit.tree_id);
    // The authenticated clean-room producer ran the full protected release-binding audit.
    // Replay its byte closure without manufacturing a protected GitHub execution context.
    for (const [relative, bytes] of [[V4_RELEASE_BINDING_PATH, data.bindingBytes], [REVIEWED_RELEASE_COORDINATE_PATH, data.coordinateBytes]])
      assert.ok(git(["show", `${producer.sourceSha}:${relative}`]).equals(bytes), `V4 activation producer ${relative} differs`);
    assert.ok(git(["show", `${data.coordinate.source.commitSha}:${V4_RELEASE_BINDING_PATH}`]).equals(data.bindingBytes));
    git(["merge-base", "--is-ancestor", data.coordinate.source.commitSha, producer.sourceSha]);
    for (const relative of trustedVerifierPaths)
      assert.ok(git(["show", `${producer.sourceSha}:${relative}`]).equals(regular(path.join(root, relative))), `V4 activation trusted verifier changed: ${relative}`);
    const release = gh(`repos/${REPOSITORY}/releases/tags/${data.coordinate.tag}`, root);
    requireValue(release.immutable === true && release.draft === false && release.prerelease === false, "V4 activation CLI release is not public immutable");
    assertActivationJsonEqual(release.assets.map(({name, digest}) => ({name, sha256: digest})).sort((a,b) => a.name.localeCompare(b.name)), data.coordinate.assets, "V4 activation release assets differ");
    const tag = gh(`repos/${REPOSITORY}/git/ref/tags/${data.coordinate.tag}`, root);
    assert.equal(tag.object?.type, "commit"); assert.equal(tag.object?.sha, data.coordinate.source.commitSha);
    const temp = mkdtempSync(path.join(os.tmpdir(), "programmable-v4-activation-"));
    chmodSync(temp, 0o700);
    try {
      const subject = path.join(temp, FILES[1]); const bundle = path.join(temp, FILES[0]);
      writeFileSync(subject, evidenceBytes, { mode: 0o600, flag: "wx" });
      writeFileSync(bundle, bundleBytes, { mode: 0o600, flag: "wx" });
      const verified = parse(command("gh", ["attestation", "verify", subject, "--hostname", "github.com", "--bundle", bundle,
        "--repo", REPOSITORY, "--signer-workflow", `${REPOSITORY}/${CLEAN_ROOM_WORKFLOW}`, "--source-ref", REF,
        "--source-digest", producer.sourceSha, "--signer-digest", producer.sourceSha, "--deny-self-hosted-runners", "--format", "json"], root));
      assertVerifiedAttestation(verified, evidenceBytes, producer);
    } finally { rmSync(temp, { recursive: true, force: true }); }
    return { releaseReady: true, sourceSha: producer.sourceSha, runId: producer.runId, artifactId: clean.artifact.id };
  }
  function auditActivation(root) {
    root = realpathSync(root);
    const data = inputs(root);
    const record = parse(regular(path.join(root, ACTIVATION_PATH)));
    if (assertActivationRecord(record, data.binding, data.coordinate) === false) return { releaseReady: false, scope: "api-until-wallet" };
    return verifyBoundEvidence(root, record, data, regular(path.join(root, SUCCESS_EVIDENCE_PATH)), regular(path.join(root, SUCCESS_ATTESTATION_PATH)));
  }
  function generate(options) {
    const root = realpathSync(options["repository-root"]);
    requireValue(/^[1-9][0-9]*$/.test(options["run-id"]) && /^[1-9][0-9]*$/.test(options["artifact-id"])
      && /^sha256:[0-9a-f]{64}$/.test(options["artifact-digest"]), "Exact V4 activation coordinates required");
    const archive = realpathSync(options.archive);
    assert.equal(bytesDigest(regular(archive)), options["artifact-digest"]);
    assert.deepEqual(command("unzip", ["-Z1", archive], root).toString().trim().split("\n").sort(), FILES);
    const listing = command("zipinfo", ["-l", archive], root).toString();
    for (const name of FILES) requireValue(listing.split("\n").some(line => line.startsWith("-") && line.endsWith(` ${name}`)), "V4 activation ZIP file is not regular");
    const evidenceBytes = command("unzip", ["-p", archive, path.basename(SUCCESS_EVIDENCE_PATH)], root);
    const bundleBytes = command("unzip", ["-p", archive, path.basename(SUCCESS_ATTESTATION_PATH)], root);
    const data = inputs(root);
    const record = createActivationRecord(data.bindingBytes, data.coordinateBytes, evidenceBytes, bundleBytes, { id: options["artifact-id"], digest: options["artifact-digest"] });
    assert.equal(record.proof.cleanRoom.evidence.producer.runId, options["run-id"]);
    const result = verifyBoundEvidence(root, record, data, evidenceBytes, bundleBytes, true);
    const out = path.resolve(options["output-directory"]);
    const parent = realpathSync(path.dirname(out));
    requireValue(parent !== root && !parent.startsWith(`${root}${path.sep}`), "V4 activation outputs must be outside the repository");
    mkdirSync(out, { mode: 0o700 });
    for (const [relative, bytes] of [[ACTIVATION_PATH, Buffer.from(`${JSON.stringify(record, null, 2)}\n`)], [SUCCESS_EVIDENCE_PATH, evidenceBytes], [SUCCESS_ATTESTATION_PATH, bundleBytes]]) {
      const dest = path.join(out, relative); mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, bytes, { flag: "wx", mode: 0o644 });
    }
    return { ...result, outputDirectory: out };
  }
  function runCli(argv) {
    try {
      const [mode, ...args] = argv; const options = {};
      requireValue(args.length % 2 === 0, "V4 activation argument pair required");
      for (let i=0; i<args.length; i+=2) {
        requireValue(args[i].startsWith("--") && !Object.hasOwn(options,args[i].slice(2)), "V4 activation argument differs");
        options[args[i].slice(2)] = args[i+1];
      }
      const expected = mode === "audit" ? ["repository-root"] : mode === "generate"
        ? ["repository-root","run-id","artifact-id","artifact-digest","archive","output-directory"] : [];
      requireValue(expected.length > 0, "V4 activation command differs");
      assert.deepEqual(Object.keys(options).sort(), expected.sort());
      return mode === "audit" ? auditActivation(options["repository-root"]) : generate(options);
    } catch (error) { throw error; }
  }
  return Object.freeze({ assertActivationJsonEqual, assertRunMetadata, assertProducerMetadata, assertVerifiedAttestation, createActivationRecord, auditActivation, runCli });
}
export const { assertActivationJsonEqual, assertRunMetadata, assertProducerMetadata, assertVerifiedAttestation, createActivationRecord, auditActivation } = createActivationImportTools();
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.stdout.write(`${JSON.stringify(createActivationImportTools().runCli(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
