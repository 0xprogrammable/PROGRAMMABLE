#!/usr/bin/env node

import {
  CliFailure,
  emitFailure,
  emitSuccess,
  parseCli,
  process,
  renderHelp,
  runSourceManifestCli
} from "./open-world-shared.mjs";
import { createOpenWorldRuntime } from "./open-world-runtime.mjs";

const runtime = createOpenWorldRuntime();

const {
  executeApplication,
  executeGitHubStatus,
  executeGitHubTransport,
  executeInit,
  executeMigrate,
  executePrepareRevision,
  executeValidate,
  executeValidateApplication,
  githubStatusCommandSpec,
  githubTransportCommandSpec,
  globalHelp,
  normalizeOpenWorldFailure,
  parseCommand,
  repositoryOption
} = runtime;

const commandSpecs = new Map([
  ["init", {
    usage: "open-world.mjs init --application-id <slug> --idea-file <public-safe.txt> --output <new-directory> [--write | --dry-run] [--repository-root <path>]",
    summary: "Capture one exact public-safe idea into an unconfirmed proposal with versioned fee/security schemas and an honest unassessed proposal-stage security record; preview by default, while a scoped fee instance comes only after architecture and source assessment.",
    options: [
      repositoryOption(),
      { name: "--application-id", key: "applicationId", type: "value", valueName: "slug", description: "Set the lowercase application slug for the new draft." },
      { name: "--idea-file", key: "ideaFile", type: "value", valueName: "public-safe.txt", description: "Read the exact public-safe UTF-8 idea from an in-repository file; inline idea text is not accepted." },
      { name: "--output", key: "output", type: "value", valueName: "new-directory", description: "Select a new in-repository destination; existing targets are always refused." },
      { name: "--write", key: "write", type: "boolean", description: "Explicitly materialize the reviewed preview through a new atomic directory rename." },
      { name: "--dry-run", key: "dryRun", type: "boolean", description: "State the default read-only behavior explicitly; cannot be combined with --write." }
    ],
    positionals: { min: 0, max: 0 }
  }],
  ["validate", {
    usage: "open-world.mjs validate <package-directory> [--repository-root <path>]",
    summary: "Validate one local open-world v2 package without writing files, executing project code, or using the network.",
    options: [repositoryOption()],
    positionals: { min: 1, max: 1, names: ["package-directory"] }
  }],
  ["validate-application", {
    usage: "open-world.mjs validate-application <application-v3-package> [--source-root <repository-ref=git-root>...]",
    summary: "Validate one closed Application V3 package, exact hashes, public-artifact privacy, persisted source evidence, and optional fresh local source closure without network access, writes, or candidate-code execution.",
    options: [
      { name: "--source-root", key: "sourceRoots", type: "value", repeatable: true, valueName: "repository-ref=git-root", description: "Optionally replay every declared source repository from its exact local Git root; when supplied, mappings must cover the complete declared source set." }
    ],
    positionals: { min: 1, max: 1, names: ["application-v3-package"] }
  }],
  ["migrate", {
    usage: "open-world.mjs migrate <legacy-submission.json> --output <new-directory> [--write | --dry-run] [--repository-root <path>]",
    summary: "Preview a source-bound v1 migration by default; --write atomically creates one new in-repository v2 directory.",
    options: [
      repositoryOption(),
      { name: "--output", key: "output", type: "value", valueName: "new-directory", description: "Select a new in-repository destination; existing targets are always refused." },
      { name: "--write", key: "write", type: "boolean", description: "Explicitly materialize the preview through a new atomic directory rename." },
      { name: "--dry-run", key: "dryRun", type: "boolean", description: "State the default read-only behavior explicitly; cannot be combined with --write." }
    ],
    positionals: { min: 1, max: 1, names: ["legacy-submission.json"] }
  }],
  ["application", {
    usage: "open-world.mjs application <v2-package-directory> --application-draft <application.v3.json> --review-package <directory> --security-assessment <json> --security-evidence-bindings <json> --source-root <repository-ref>=<git-root>... --output <absolute-new-directory> [--write | --dry-run] [--repository-root <path>]",
    summary: "After the source prototype is committed, verify every exact manifest and review binding, derive self-reference-free security/report records, and preview a canonical public Application V3 package; explicit --write creates it atomically outside every source repository.",
    options: [
      repositoryOption(),
      { name: "--application-draft", key: "applicationDraft", type: "value", valueName: "application.v3.json", description: "Read the V3 metadata/source template; application-package review, security, and verifier records are replaced by exact derived bindings." },
      { name: "--review-package", key: "reviewPackage", type: "value", valueName: "directory", description: "Read the exact five application-package review files from one non-symlink directory." },
      { name: "--security-assessment", key: "securityAssessment", type: "value", valueName: "json", description: "Read the source-assessed evidence envelope derived after the pinned source commit; it must stay outside source repositories." },
      { name: "--security-evidence-bindings", key: "securityEvidenceBindings", type: "value", valueName: "json", description: "Map non-verifier security evidenceRefs to exact V3 review records; verifier-report mappings are derived locally." },
      { name: "--source-root", key: "sourceRoots", type: "value", repeatable: true, valueName: "repository-ref=git-root", description: "Map every declared primary and companion repository ID to its exact local Git root." },
      { name: "--output", key: "output", type: "value", valueName: "absolute-new-directory", description: "Select a new absolute destination outside all source repositories; existing targets are always refused." },
      { name: "--write", key: "write", type: "boolean", description: "Explicitly materialize the exact verified dynamic package through one atomic directory rename." },
      { name: "--dry-run", key: "dryRun", type: "boolean", description: "State the default read-only behavior explicitly; cannot be combined with --write." }
    ],
    positionals: { min: 1, max: 1, names: ["v2-package-directory"] }
  }],
  ["prepare-revision", {
    usage: "open-world.mjs prepare-revision <application-v3-draft.json> --source-root <repository-ref=git-root>... [--predecessor-source-root <repository-ref=git-root>...] --output <absolute-new-directory> [--write | --dry-run] [--repository-root <path>]",
    summary: "Use authenticated GET-only GitHub reads plus exact local source snapshots to derive the unique next Application V3 revision; preview by default, while --write creates one new atomic local directory.",
    options: [
      repositoryOption(),
      { name: "--source-root", key: "sourceRoots", type: "value", repeatable: true, valueName: "repository-ref=git-root", description: "Map every declared source repository ID to its exact local Git root for pre-network and pre-rename replay." },
      { name: "--predecessor-source-root", key: "predecessorSourceRoots", type: "value", repeatable: true, valueName: "repository-ref=git-root", description: "Map a removed or replaced predecessor repository ID to a local Git object store containing its exact historical commit and tree." },
      { name: "--output", key: "output", type: "value", valueName: "absolute-new-directory", description: "Select a new absolute destination outside the draft input directory, this worktree, and every source repository." },
      { name: "--write", key: "write", type: "boolean", description: "Materialize only the freshly replayed canonical application.v3.json through one atomic directory rename." },
      { name: "--dry-run", key: "dryRun", type: "boolean", description: "State the default read-only local output mode explicitly; GitHub access remains GET-only." }
    ],
    positionals: { min: 1, max: 1, names: ["application-v3-draft.json"] }
  }],
  ["submit", githubTransportCommandSpec("submit")],
  ["update", githubTransportCommandSpec("update")],
  ["status", githubStatusCommandSpec()]
]);
runtime.commandSpecs = commandSpecs;

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  process.stdout.write(`${globalHelp()}\n`);
} else {
  const command = argv[0];
  if (command === "source-manifest") {
    process.exitCode = runSourceManifestCli({ argv: argv.slice(1), stdout: process.stdout });
  } else if (!commandSpecs.has(command)) {
    process.exitCode = emitFailure("open-world", new CliFailure("UNKNOWN_COMMAND", `unknown open-world command ${command}`));
  } else if (argv.slice(1).includes("--help") || argv.slice(1).includes("-h")) {
    process.stdout.write(`${renderHelp({ command: "open-world.mjs", ...commandSpecs.get(command) })}\n`);
  } else {
    try {
      const parsed = parseCommand(command, argv.slice(1));
      const result = command === "init"
        ? executeInit(parsed.options)
        : command === "validate"
          ? executeValidate(parsed.options, parsed.positionals)
          : command === "validate-application"
            ? await executeValidateApplication(parsed.options, parsed.positionals)
          : command === "migrate"
            ? executeMigrate(parsed.options, parsed.positionals)
            : command === "application"
              ? await executeApplication(parsed.options, parsed.positionals)
              : command === "prepare-revision"
                ? await executePrepareRevision(parsed.options, parsed.positionals)
              : command === "status"
                ? await executeGitHubStatus(parsed.options, parsed.positionals)
                : await executeGitHubTransport(command, parsed.options, parsed.positionals);
      emitSuccess("open-world", result);
    } catch (error) {
      process.exitCode = emitFailure("open-world", normalizeOpenWorldFailure(error));
    }
  }
}
