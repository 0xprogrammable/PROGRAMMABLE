#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseCli, renderHelp } from "./cli-args.mjs";
import { inspectLocalGitReadiness, preparePullRequest } from "./cli-prepare-pr.mjs";
import { assertInsideRepository, resolveRepositoryRoot } from "./repository-root.mjs";
import {
  CliFailure,
  emitFailure,
  emitSuccess,
  requireJsonResult,
  runBundledCommand
} from "./cli-runtime.mjs";

const commandSpecs = new Map([
  ["doctor", {
    usage: "cli.mjs doctor [--repository-root <path>]",
    summary: "Inspect local builder readiness and emit one JSON result.",
    options: [repositoryOption()],
    positionals: { min: 0, max: 0 }
  }],
  ["scaffold", {
    usage: "cli.mjs scaffold <model-id> [--name <display-name>] [--destination <path>] [--repository-root <path>]",
    summary: "Create one isolated proposal package through the canonical scaffolder.",
    options: [
      repositoryOption(),
      { name: "--name", key: "modelName", type: "value", valueName: "display-name", description: "Set the model display name." },
      { name: "--destination", key: "destination", type: "value", valueName: "path", description: "Create below this repository directory." }
    ],
    positionals: { min: 1, max: 1, names: ["model-id"] }
  }],
  ["check", {
    usage: "cli.mjs check <submission.json> [--write-report <path>] [--require-ready] [--repository-root <path>]",
    summary: "Run the canonical deterministic compatibility preflight.",
    options: [
      repositoryOption(),
      { name: "--write-report", key: "reportPath", type: "value", valueName: "path", description: "Write the report inside the repository." },
      { name: "--require-ready", key: "requireReady", type: "boolean", description: "Fail unless the result is PROTOTYPE_READY." }
    ],
    positionals: { min: 1, max: 1, names: ["submission.json"] }
  }],
  ["package", {
    usage: "cli.mjs package <submission-directory> [--repository-root <path>]",
    summary: "Run the canonical public intake package gate without executing project code.",
    options: [repositoryOption()],
    positionals: { min: 1, max: 1, names: ["submission-directory"] }
  }],
  ["prepare-pr", {
    usage: "cli.mjs prepare-pr <submission-directory> [--base <branch>] [--companion-manifest <path>]... [--output-dir <path>] [--replace-existing | --replace-draft] [--repository-root <path>]",
    summary: "Prepare deterministic PR metadata for one clean, pushed, public GitHub revision without opening it.",
    options: [
      repositoryOption(),
      { name: "--base", key: "baseBranch", type: "value", valueName: "branch", description: "Select the fixed 0xprogrammable/programmable target base branch. Defaults to main." },
      {
        name: "--companion-manifest",
        key: "companionManifests",
        type: "value",
        repeatable: true,
        valueName: "path",
        description: "Bind one canonical companion manifest committed in the primary repository HEAD. Repeat up to eight times."
      },
      { name: "--output-dir", key: "outputDirectory", type: "value", valueName: "path", description: "Materialize the frozen six-file package in the exact application-id directory." },
      { name: "--replace-existing", key: "replaceExisting", type: "boolean", description: "Create the first next-revision draft by replacing only an exact package from immutable main." },
      { name: "--replace-draft", key: "replaceDraft", type: "boolean", description: "Replace one self-consistent local draft while keeping the revision authorized by immutable main." }
    ],
    positionals: { min: 1, max: 1, names: ["submission-directory"] }
  }]
]);

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  process.stdout.write(`${globalHelp()}\n`);
  process.exit(0);
}

const command = argv[0];
if (!commandSpecs.has(command)) {
  process.exitCode = emitFailure(command, new CliFailure("UNKNOWN_COMMAND", `unknown command ${command}`));
} else if (argv.slice(1).includes("--help") || argv.slice(1).includes("-h")) {
  process.stdout.write(`${renderHelp({ command: "cli.mjs", ...commandSpecs.get(command) })}\n`);
} else {
  try {
    const { options, positionals } = parseCommand(command, argv.slice(1));
    const result = await execute(command, options, positionals);
    emitSuccess(command, result);
  } catch (error) {
    process.exitCode = emitFailure(command, error);
  }
}

async function execute(command, options, positionals) {
  if (command === "prepare-pr" && options.replaceExisting && options.replaceDraft) {
    throw new CliFailure("USAGE_ERROR", "--replace-existing and --replace-draft are mutually exclusive");
  }
  if (
    command === "prepare-pr"
    && (options.replaceExisting || options.replaceDraft)
    && options.outputDirectory === null
  ) {
    throw new CliFailure("USAGE_ERROR", "replacement requires --output-dir");
  }
  const repositoryRoot = resolveRoot(options.repositoryRoot);
  if (command === "doctor") {
    const tooling = requireJsonResult(
      runBundledCommand(
        "doctor.mjs",
        ["--json", "--repository-root", repositoryRoot],
        { cwd: repositoryRoot, failureCode: "DOCTOR_FAILED" }
      ),
      "doctor.mjs"
    );
    const publicBetaGit = inspectLocalGitReadiness(repositoryRoot);
    return {
      ...tooling,
      publicBetaGit,
      readyForPublicBeta: false,
      publicBetaNote: publicBetaGit.readyForPreparePrLocal
        ? "Local Git gates are ready; public GitHub repository, commit and tree reachability remain notChecked until prepare-pr."
        : "One or more local Git gates block prepare-pr; public reachability remains notChecked."
    };
  }
  if (command === "scaffold") {
    const [modelId] = positionals;
    const args = [modelId, "--repository-root", repositoryRoot];
    if (options.modelName !== null) args.push("--name", options.modelName);
    if (options.destination !== null) args.push("--destination", options.destination);
    const result = runBundledCommand("scaffold-submission.mjs", args, {
      cwd: repositoryRoot,
      failureCode: "SCAFFOLD_FAILED"
    });
    const destinationRoot = path.resolve(repositoryRoot, options.destination ?? "submissions");
    const packageRoot = resolveInside(repositoryRoot, path.join(destinationRoot, modelId));
    return {
      package: relative(repositoryRoot, packageRoot),
      filesCreated: fs.readdirSync(packageRoot).sort(),
      message: result.stdout
    };
  }
  if (command === "check") {
    const submission = resolveRegularFile(repositoryRoot, positionals[0]);
    const args = [submission, "--repository-root", repositoryRoot];
    const result = requireJsonResult(
      runBundledCommand("validate-submission.mjs", args, {
        cwd: repositoryRoot,
        failureCode: "CHECK_FAILED"
      }),
      "validate-submission.mjs"
    );
    const reportPath = options.reportPath === null
      ? path.join(path.dirname(submission), "compatibility-report.json")
      : resolveWritablePath(repositoryRoot, options.reportPath);
    writeJsonAtomically(reportPath, result);
    const completed = {
      ...result,
      reportWritten: {
        path: relative(repositoryRoot, reportPath),
        submissionHash: result.submissionHash
      }
    };
    if (
      options.requireReady
      && (result.decision !== "PROTOTYPE_READY" || result.closure?.status !== "complete")
    ) {
      throw new CliFailure(
        "CHECK_NOT_READY",
        "the exact repository revision is not ready for prototype work",
        { exitCode: 1, details: completed }
      );
    }
    return completed;
  }
  if (command === "package") {
    const packageRoot = resolveDirectory(repositoryRoot, positionals[0]);
    try {
      return requireJsonResult(
        runBundledCommand(
          "verify-package.mjs",
          ["--repository-root", repositoryRoot, packageRoot],
          { cwd: repositoryRoot, failureCode: "PACKAGE_INVALID" }
        ),
        "verify-package.mjs"
      );
    } catch (error) {
      if (error instanceof CliFailure && error.details?.validationState === "TOOLING_BLOCKED") {
        throw new CliFailure(
          "TOOLING_BLOCKED",
          "declared source/test content requires materialization or supported tooling before packaging",
          { exitCode: 1, details: error.details }
        );
      }
      throw error;
    }
  }
  return preparePullRequest({
    repositoryRoot,
    packageInput: positionals[0],
    baseBranch: options.baseBranch ?? "main",
    companionManifestInputs: options.companionManifests,
    outputDirectory: options.outputDirectory,
    replaceExisting: options.replaceExisting,
    replaceDraft: options.replaceDraft
  });
}

function parseCommand(command, args) {
  try {
    return parseCli({ command: "cli.mjs", ...commandSpecs.get(command) }, args);
  } catch (error) {
    throw new CliFailure("USAGE_ERROR", error.message);
  }
}

function resolveRoot(input) {
  try {
    return resolveRepositoryRoot(input);
  } catch (error) {
    throw new CliFailure("REPOSITORY_REQUIRED", error.message);
  }
}

function resolveInside(repositoryRoot, target, { allowMissing = false } = {}) {
  try {
    return assertInsideRepository(repositoryRoot, target, { allowMissing });
  } catch (error) {
    throw new CliFailure("INVALID_PATH", error.message);
  }
}

function resolveRegularFile(repositoryRoot, input) {
  if (unsafePathInput(input)) throw new CliFailure("INVALID_PATH", "path contains unsafe characters");
  const target = resolveInside(repositoryRoot, path.resolve(repositoryRoot, input));
  if (!fs.statSync(target).isFile()) throw new CliFailure("INVALID_PATH", "path is not a regular file");
  return target;
}

function resolveDirectory(repositoryRoot, input) {
  if (unsafePathInput(input)) throw new CliFailure("INVALID_PATH", "path contains unsafe characters");
  const target = resolveInside(repositoryRoot, path.resolve(repositoryRoot, input));
  if (!fs.statSync(target).isDirectory()) throw new CliFailure("INVALID_PATH", "path is not a directory");
  return target;
}

function resolveWritablePath(repositoryRoot, input) {
  if (unsafePathInput(input)) throw new CliFailure("INVALID_PATH", "path contains unsafe characters");
  return resolveInside(repositoryRoot, path.resolve(repositoryRoot, input), { allowMissing: true });
}

function unsafePathInput(value) {
  return typeof value !== "string"
    || value.length === 0
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function relative(repositoryRoot, target) {
  return path.relative(repositoryRoot, target).split(path.sep).join("/");
}

function writeJsonAtomically(target, value) {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(path.join(directory, ".programmable-check-"));
  const temporaryPath = path.join(temporaryDirectory, "compatibility-report.json");
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporaryPath, target);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function repositoryOption() {
  return {
    name: "--repository-root",
    key: "repositoryRoot",
    type: "value",
    valueName: "path",
    description: "Use this Git worktree instead of the current directory."
  };
}

function globalHelp() {
  return [
    "Usage: cli.mjs <command> [options]",
    "",
    "Host-neutral JSON entry point for the Programmable v4 Builder.",
    "",
    "Commands:",
    "  doctor      Inspect local tooling and repository readiness.",
    "  scaffold    Create one isolated proposal package.",
    "  check       Run deterministic compatibility preflight.",
    "  package     Validate a complete public intake package.",
    "  prepare-pr  Generate PR metadata without pushing or opening a PR.",
    "",
    "Run 'cli.mjs <command> --help' for command options."
  ].join("\n");
}
