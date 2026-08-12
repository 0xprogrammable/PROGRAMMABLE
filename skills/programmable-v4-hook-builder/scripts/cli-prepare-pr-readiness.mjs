import fs from "node:fs";

import { spawnSafeGitSync } from "./repository-root.mjs";
import { parseGitHubRemote } from "./cli-github-source.mjs";
import { CliFailure } from "./cli-runtime.mjs";
import { GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1 } from "./github-exact-object-resolver.mjs";
import { git, runGit } from "./cli-prepare-pr-transport.mjs";
import { requireCommit, requireSafeBranch } from "./cli-prepare-pr-values.mjs";

export function inspectLocalGitReadiness(repositoryRoot, gitImplementation = runGit) {
  const blocked = (status, reason) => ({ status, reason });
  const exactObjectTooling = inspectExactObjectGitTooling();
  let topLevel;
  try {
    topLevel = fs.realpathSync(git(repositoryRoot, ["rev-parse", "--show-toplevel"], gitImplementation));
  } catch (error) {
    const toolingBlocked = error instanceof CliFailure && error.code === "TOOLING_BLOCKED";
    const unavailableReason = toolingBlocked
      ? error.message
      : "selected directory is not a Git worktree";
    return {
      gitRepository: blocked(toolingBlocked ? "toolingBlocked" : "missing", unavailableReason),
      exactObjectTooling,
      cleanWorktree: blocked("notChecked", unavailableReason),
      namedBranch: blocked("notChecked", unavailableReason),
      upstream: blocked("notChecked", unavailableReason),
      pushedRevision: blocked("notChecked", unavailableReason),
      githubRemote: blocked("notChecked", unavailableReason),
      publicReachability: blocked("notChecked", "live anonymous GitHub resolution runs only in prepare-pr"),
      readyForPreparePrLocal: false,
      readyForPublicBeta: false
    };
  }
  if (topLevel !== repositoryRoot) {
    return {
      gitRepository: blocked("wrongRoot", "selected directory is not the Git worktree root"),
      exactObjectTooling,
      cleanWorktree: blocked("notChecked", "select the exact worktree root"),
      namedBranch: blocked("notChecked", "select the exact worktree root"),
      upstream: blocked("notChecked", "select the exact worktree root"),
      pushedRevision: blocked("notChecked", "select the exact worktree root"),
      githubRemote: blocked("notChecked", "select the exact worktree root"),
      publicReachability: blocked("notChecked", "live anonymous GitHub resolution runs only in prepare-pr"),
      readyForPreparePrLocal: false,
      readyForPublicBeta: false
    };
  }

  const status = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"], gitImplementation);
  const clean = status.length === 0;
  let branch = null;
  try {
    branch = requireSafeBranch(git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], gitImplementation), "head branch");
  } catch {
    // Detached and unborn branches are explicit blocked states below.
  }
  let upstreamCommit = null;
  let headCommit = null;
  let remoteName = null;
  let remoteUrl = null;
  let github = null;
  if (branch !== null) {
    try {
      headCommit = requireCommit(git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], gitImplementation), "HEAD");
      upstreamCommit = requireCommit(git(repositoryRoot, ["rev-parse", "--verify", "@{upstream}^{commit}"], gitImplementation), "upstream");
      remoteName = git(repositoryRoot, ["config", "--get", `branch.${branch}.remote`], gitImplementation);
      remoteUrl = git(repositoryRoot, ["config", "--get", `remote.${remoteName}.url`], gitImplementation);
      github = parseGitHubRemote(remoteUrl);
    } catch {
      // The individual blocked states below remain deterministic and read-only.
    }
  }
  const upstreamReady = upstreamCommit !== null && remoteName !== null;
  const pushed = upstreamReady && headCommit === upstreamCommit;
  const githubReady = github !== null;
  const localReady = clean
    && branch !== null
    && upstreamReady
    && pushed
    && githubReady
    && exactObjectTooling.status === "ready";
  return {
    gitRepository: { status: "ready", root: topLevel },
    exactObjectTooling,
    cleanWorktree: clean
      ? { status: "ready" }
      : blocked("dirty", "commit or remove every tracked, untracked and ignored package change before prepare-pr"),
    namedBranch: branch === null
      ? blocked("missing", "prepare-pr requires a named branch with a commit")
      : { status: "ready", branch },
    upstream: upstreamReady
      ? { status: "ready", remote: remoteName }
      : blocked("missing", "the current branch has no resolvable upstream"),
    pushedRevision: !upstreamReady
      ? blocked("notChecked", "the upstream revision is unavailable")
      : pushed
        ? { status: "ready", commit: headCommit }
        : blocked("unpushed", "HEAD does not equal the configured upstream revision"),
    githubRemote: githubReady
      ? { status: "ready", repository: github.repositorySlug, configuredRemoteUrl: remoteUrl }
      : blocked("unsupported", "the upstream remote must be an uncredentialed github.com repository URL"),
    publicReachability: blocked("notChecked", "live anonymous repository, commit and tree resolution runs only in prepare-pr"),
    readyForPreparePrLocal: localReady,
    readyForPublicBeta: false
  };
}

export function inspectExactObjectGitTooling(gitProbe = spawnSafeGitSync) {
  const minimum = GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.minimumGitVersion;
  const versionResult = gitProbe(["--version"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65_536
  });
  const version = parseGitVersion(versionResult?.stdout);
  if (versionResult?.status !== 0 || version === null || compareVersion(version, minimum) < 0) {
    return {
      status: "toolingBlocked",
      version,
      reason: `Git ${minimum} or newer is required for exact public-source verification`
    };
  }

  const backfillResult = gitProbe(["backfill", "-h"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65_536
  });
  const backfillOutput = `${backfillResult?.stdout ?? ""}\n${backfillResult?.stderr ?? ""}`;
  if (!/(?:^|\n)usage: git backfill(?: |\n)/u.test(backfillOutput)) {
    return {
      status: "toolingBlocked",
      version,
      reason: "git backfill --sparse is required for exact public-source verification"
    };
  }

  return {
    status: "ready",
    version,
    capability: "git backfill --sparse"
  };
}

export function parseGitVersion(output) {
  if (typeof output !== "string") return null;
  const match = /^git version ([0-9]+\.[0-9]+\.[0-9]+)(?:[^0-9.]|$)/u.exec(output.trim());
  return match?.[1] ?? null;
}

export function compareVersion(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}
