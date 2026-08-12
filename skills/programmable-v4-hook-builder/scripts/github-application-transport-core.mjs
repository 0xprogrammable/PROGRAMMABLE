import childProcess from "node:child_process";
import process from "node:process";

import { canonicalJson } from "./submission-core.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";

import {
  CHECK_RUNS_PER_PAGE,
  DEFAULT_GET_ATTEMPTS,
  DEFAULT_GET_BACKOFF_MS,
  MAX_API_INPUT_BYTES,
  MAX_API_OUTPUT_BYTES,
  MAX_API_RESPONSE_HEADER_BYTES,
  MAX_CHECK_RUNS,
  MAX_GET_ATTEMPTS,
  MAX_GET_BACKOFF_MS,
  MAX_GET_BACKOFF_TOTAL_MS,
  MAX_PULL_FILES,
  MAX_PULL_FILE_METADATA_BYTES,
  MAX_REVIEWS,
  MAX_SEARCH_RESULTS,
  PULL_FILES_PER_PAGE,
  REVIEWS_PER_PAGE
} from "./github-application-constants.mjs";

import {
  apiCommit,
  apiOpaqueDecimal,
  apiPullNumber,
  apiRepositoryPath,
  apiSlug,
  compareUtf8,
  defaultSleep,
  fail,
  isPlainObject,
  requireApiInteger,
  requireBoundedMultilineText,
  requireBoundedText,
  requireBranch,
  requireGitHubLogin,
  requireRepositorySlug,
  sanitizeMessage
} from "./github-application-primitives.mjs";

export function isSafeGitHubApiEndpoint(endpoint) {
  if (
    typeof endpoint !== "string"
    || endpoint.length === 0
    || endpoint.startsWith("/")
    || endpoint.endsWith("/")
    || endpoint.includes("//")
    || !/^[A-Za-z0-9_./?%=&:+-]+$/u.test(endpoint)
    || /%(?![0-9A-Fa-f]{2})/u.test(endpoint)
  ) return false;

  const queryIndex = endpoint.indexOf("?");
  if (queryIndex !== endpoint.lastIndexOf("?")) return false;
  const pathname = queryIndex === -1 ? endpoint : endpoint.slice(0, queryIndex);
  if (pathname.length === 0) return false;
  for (const rawSegment of pathname.split("/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(rawSegment);
    } catch {
      return false;
    }
    if (
      decoded.length === 0
      || decoded.includes("\\")
      || hasForbiddenInvisibleOrBidi(decoded)
      || decoded.split("/").some((segment) => segment === "." || segment === "..")
    ) return false;
  }
  return true;
}

export function createGhTransport({
  runner = defaultCommandRunner,
  sleep = defaultSleep,
  now = Date.now,
  getAttempts = DEFAULT_GET_ATTEMPTS
} = {}) {
  if (typeof runner !== "function") throw new TypeError("runner must be a function");
  if (typeof sleep !== "function") throw new TypeError("sleep must be a function");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (!Number.isSafeInteger(getAttempts) || getAttempts < 1 || getAttempts > MAX_GET_ATTEMPTS) {
    throw new TypeError("getAttempts must be a bounded positive integer");
  }
  const request = async ({
    method = "GET",
    endpoint,
    body = null,
    allowNotFound = false,
    requireResponse = false
  }) => {
    if (!/^(?:GET|POST|PATCH)$/u.test(method)) fail("INTERNAL_ERROR", "unsupported GitHub API method");
    if (!isSafeGitHubApiEndpoint(endpoint)) {
      fail("INTERNAL_ERROR", "unsafe GitHub API endpoint");
    }
    const args = [
      "api",
      "--hostname", "github.com",
      "--method", method,
      ...(method === "GET" ? ["--include"] : []),
      "--header", "Accept: application/vnd.github+json",
      "--header", "X-GitHub-Api-Version: 2022-11-28",
      endpoint
    ];
    let stdin = "";
    if (body !== null) {
      stdin = canonicalJson(body);
      if (Buffer.byteLength(stdin, "utf8") > MAX_API_INPUT_BYTES) {
        fail("GITHUB_REQUEST_TOO_LARGE", "the bounded GitHub request body is too large");
      }
      args.push("--input", "-");
    }
    let totalBackoffMs = 0;
    const maximumAttempts = method === "GET" ? getAttempts : 1;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const result = await runner({
        command: "gh",
        args,
        stdin,
        timeoutMs: 30_000,
        maxOutputBytes: MAX_API_OUTPUT_BYTES + MAX_API_RESPONSE_HEADER_BYTES
      });
      const rawStdout = String(result?.stdout ?? "");
      const stderr = String(result?.stderr ?? "");
      if (Buffer.byteLength(rawStdout, "utf8") > MAX_API_OUTPUT_BYTES + MAX_API_RESPONSE_HEADER_BYTES) {
        fail("GITHUB_OUTPUT_INVALID", "GitHub returned an oversized response");
      }
      const response = splitIncludedGitHubResponse(rawStdout, result?.headers);
      const httpStatus = response.statusCode ?? extractGitHubHttpStatus(stderr);
      const terminalNotFound = response.statusCode === 404
        || (response.statusCode === null && /(?:^|\s)(?:\(HTTP 404\)|HTTP 404)\s*$/iu.test(stderr));
      if (allowNotFound && terminalNotFound) return null;
      const failed = result?.status !== 0 || (httpStatus !== null && (httpStatus < 200 || httpStatus >= 300));
      if (failed) {
        const failure = classifyGitHubGetFailure({
          method,
          httpStatus,
          headers: response.headers,
          stderr,
          attempt,
          nowMs: now()
        });
        if (failure.retryable && attempt < maximumAttempts) {
          const remainingBudget = MAX_GET_BACKOFF_TOTAL_MS - totalBackoffMs;
          const delayMs = Math.min(failure.delayMs, MAX_GET_BACKOFF_MS, remainingBudget);
          if (delayMs >= 0 && failure.delayMs <= MAX_GET_BACKOFF_MS && remainingBudget >= failure.delayMs) {
            totalBackoffMs += delayMs;
            await sleep(delayMs);
            continue;
          }
        }
        if (failure.rateLimited) {
          fail("GITHUB_RATE_LIMITED", "GitHub rate-limited the bounded read-only request", {
            details: githubTransportFailureDetails({ method, failure, attempt, maximumAttempts, totalBackoffMs })
          });
        }
        if (method === "GET" && failure.retryable) {
          fail("GITHUB_GET_RETRY_EXHAUSTED", "the bounded read-only GitHub request did not succeed after retry", {
            details: githubTransportFailureDetails({ method, failure, attempt, maximumAttempts, totalBackoffMs })
          });
        }
        fail("GITHUB_REQUEST_FAILED", sanitizeMessage(stderr) || "the GitHub request failed", {
          details: githubTransportFailureDetails({ method, failure, attempt, maximumAttempts, totalBackoffMs })
        });
      }
      if (response.body.length === 0) {
        if (requireResponse) fail("GITHUB_OUTPUT_INVALID", "GitHub returned an empty response");
        return null;
      }
      try {
        return parseBoundedStrictJson(response.body, {
          maxSourceBytes: MAX_API_OUTPUT_BYTES,
          maxDepth: 256,
          maxNodes: 250_000,
          maxNumberCharacters: MAX_API_OUTPUT_BYTES
        });
      } catch {
        fail("GITHUB_OUTPUT_INVALID", "GitHub returned malformed JSON");
      }
    }
    fail("INTERNAL_ERROR", "bounded GitHub request loop terminated unexpectedly");
  };

  return Object.freeze({
    async getViewer() {
      return request({ method: "GET", endpoint: "user" });
    },
    async getRepository(slug, { allowNotFound = false } = {}) {
      return request({ method: "GET", endpoint: `repos/${apiSlug(slug)}`, allowNotFound });
    },
    async listViewerRepositories(login) {
      return request({
        method: "GET",
        endpoint: `users/${encodeURIComponent(requireGitHubLogin(login, "active GitHub account"))}/repos?type=owner&sort=full_name&direction=asc&per_page=100`
      });
    },
    async getGitCommit(slug, commit) {
      return request({ method: "GET", endpoint: `repos/${apiSlug(slug)}/git/commits/${apiCommit(commit)}` });
    },
    async getGitTree(slug, tree, { recursive = true } = {}) {
      if (typeof recursive !== "boolean") fail("INTERNAL_ERROR", "Git tree recursion flag is invalid");
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(slug)}/git/trees/${apiCommit(tree)}${recursive ? "?recursive=1" : ""}`
      });
    },
    async getWorkflowRun(slug, runId) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(slug)}/actions/runs/${apiOpaqueDecimal(runId, "workflow run id")}`
      });
    },
    async getRef(slug, branch, { allowNotFound = false } = {}) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(slug)}/git/ref/heads/${encodeURIComponent(requireBranch(branch, "GitHub branch"))}`,
        allowNotFound
      });
    },
    async getContent(slug, filePath, ref, { allowNotFound = false } = {}) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(slug)}/contents/${apiRepositoryPath(filePath)}?ref=${encodeURIComponent(apiCommit(ref))}`,
        allowNotFound
      });
    },
    async listPullsByHead({ centralRepository, baseBranch, head }) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(centralRepository)}/pulls?state=open&base=${encodeURIComponent(requireBranch(baseBranch, "base branch"))}&head=${encodeURIComponent(requireBoundedText(head, "pull-request head", 200))}&per_page=100`
      });
    },
    async searchOpenPulls({ centralRepository, login, title }) {
      const author = requireGitHubLogin(login, "active GitHub account");
      const query = `repo:${requireRepositorySlug(centralRepository, "central repository")} is:pr is:open author:${author} in:title \"${requireBoundedText(title, "pull-request title", 200)}\"`;
      return request({
        method: "GET",
        endpoint: `search/issues?q=${encodeURIComponent(query)}&per_page=${MAX_SEARCH_RESULTS}`
      });
    },
    async getPull(centralRepository, number) {
      return request({ method: "GET", endpoint: `repos/${apiSlug(centralRepository)}/pulls/${apiPullNumber(number)}` });
    },
    async getPullFiles(centralRepository, number, {
      expectedCount = null,
      maxFiles = MAX_PULL_FILES,
      maxTotalBytes = MAX_PULL_FILE_METADATA_BYTES
    } = {}) {
      if (expectedCount !== null && (!Number.isSafeInteger(expectedCount) || expectedCount < 0)) {
        fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request changed-file count is invalid");
      }
      if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_PULL_FILES) {
        fail("INTERNAL_ERROR", "invalid GitHub pull-file count budget");
      }
      if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > MAX_PULL_FILE_METADATA_BYTES) {
        fail("INTERNAL_ERROR", "invalid GitHub pull-file metadata budget");
      }
      if (expectedCount !== null && expectedCount > maxFiles) {
        fail("GITHUB_PULL_FILES_REVIEW_BUDGET_EXCEEDED", "GitHub pull-request file count exceeds the bounded review budget");
      }
      const files = [];
      const seenFilenames = new Set();
      let totalBytes = 0;
      for (let page = 1; files.length < (expectedCount ?? maxFiles); page += 1) {
        const records = await request({
          method: "GET",
          endpoint: `repos/${apiSlug(centralRepository)}/pulls/${apiPullNumber(number)}/files?per_page=${PULL_FILES_PER_PAGE}&page=${page}`
        });
        if (!Array.isArray(records) || records.length > PULL_FILES_PER_PAGE) {
          fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request file page is malformed");
        }
        totalBytes += Buffer.byteLength(canonicalJson(records), "utf8");
        if (totalBytes > maxTotalBytes) {
          fail("GITHUB_PULL_FILES_REVIEW_BUDGET_EXCEEDED", "GitHub pull-request file metadata exceeds the bounded review budget");
        }
        for (const record of records) {
          const filename = record?.filename;
          if (typeof filename !== "string" || filename.length === 0) {
            fail("GITHUB_OUTPUT_INVALID", "GitHub pull-request file page contains an invalid filename");
          }
          if (seenFilenames.has(filename)) {
            fail("GITHUB_PULL_FILES_CHANGED", "GitHub pull-request file identity changed or duplicated during pagination");
          }
          seenFilenames.add(filename);
          files.push(record);
          if (files.length > maxFiles || (expectedCount !== null && files.length > expectedCount)) {
            fail("GITHUB_PULL_FILES_CHANGED", "GitHub pull-request file count changed during pagination");
          }
        }
        if (expectedCount !== null && files.length === expectedCount) {
          return files.sort((left, right) => compareUtf8(left.filename, right.filename));
        }
        if (records.length < PULL_FILES_PER_PAGE) {
          if (expectedCount === null) return files.sort((left, right) => compareUtf8(left.filename, right.filename));
          fail("GITHUB_PULL_FILES_CHANGED", "GitHub pull-request file pagination ended before the declared changed-file count");
        }
        if (records.length === 0) {
          fail("GITHUB_PULL_FILES_CHANGED", "GitHub pull-request file pagination made no progress");
        }
      }
      if (expectedCount === null && files.length === maxFiles) {
        fail("GITHUB_PULL_FILES_REVIEW_BUDGET_EXCEEDED", "GitHub pull-request file count reaches the bounded review budget without a terminal page");
      }
      return files.sort((left, right) => compareUtf8(left.filename, right.filename));
    },
    async getPullReviews(centralRepository, number) {
      const reviews = [];
      for (let page = 1; reviews.length < MAX_REVIEWS; page += 1) {
        const records = await request({
          method: "GET",
          endpoint: `repos/${apiSlug(centralRepository)}/pulls/${apiPullNumber(number)}/reviews?per_page=${REVIEWS_PER_PAGE}&page=${page}`
        });
        if (!Array.isArray(records) || records.length > REVIEWS_PER_PAGE) {
          fail("GITHUB_OUTPUT_INVALID", "GitHub review page output is malformed");
        }
        reviews.push(...records);
        if (records.length < REVIEWS_PER_PAGE) return reviews;
      }
      fail(
        "GITHUB_REVIEW_HISTORY_TOO_LARGE",
        `GitHub review history exceeds the bounded ${MAX_REVIEWS}-record status projection`
      );
    },
    async getCheckRuns(centralRepository, commit) {
      const checkRuns = [];
      let expectedTotal = null;
      for (let page = 1; checkRuns.length < MAX_CHECK_RUNS; page += 1) {
        const response = await request({
          method: "GET",
          endpoint: `repos/${apiSlug(centralRepository)}/commits/${apiCommit(commit)}/check-runs?per_page=${CHECK_RUNS_PER_PAGE}&page=${page}`
        });
        if (!isPlainObject(response) || !Array.isArray(response.check_runs) || response.check_runs.length > CHECK_RUNS_PER_PAGE) {
          fail("GITHUB_OUTPUT_INVALID", "GitHub check-run page output is malformed");
        }
        const observedTotal = requireApiInteger(response.total_count, "GitHub check-run count", 0, 1_000_000);
        if (observedTotal > MAX_CHECK_RUNS) {
          fail(
            "GITHUB_CHECK_HISTORY_TOO_LARGE",
            `GitHub check-run history exceeds the bounded ${MAX_CHECK_RUNS}-record status projection`
          );
        }
        if (expectedTotal === null) expectedTotal = observedTotal;
        if (observedTotal !== expectedTotal) {
          fail("GITHUB_CHECK_HISTORY_CHANGED", "GitHub check-run history changed during the bounded status read");
        }
        checkRuns.push(...response.check_runs);
        if (checkRuns.length === expectedTotal) {
          return { total_count: expectedTotal, check_runs: checkRuns };
        }
        if (checkRuns.length > expectedTotal || response.check_runs.length < CHECK_RUNS_PER_PAGE) {
          fail("GITHUB_CHECK_HISTORY_INCOMPLETE", "GitHub returned an incomplete check-run history");
        }
      }
      fail(
        "GITHUB_CHECK_HISTORY_TOO_LARGE",
        `GitHub check-run history exceeds the bounded ${MAX_CHECK_RUNS}-record status projection`
      );
    },
    async compareBranch({ centralRepository, baseCommit, headLogin, headBranch }) {
      return request({
        method: "GET",
        endpoint: `repos/${apiSlug(centralRepository)}/compare/${apiCompareSpec(baseCommit, headLogin, headBranch)}?per_page=100`
      });
    },
    async createFork(centralRepository) {
      return request({ method: "POST", endpoint: `repos/${apiSlug(centralRepository)}/forks`, body: {} });
    },
    async createTree(repository, { baseTree, files }) {
      return request({
        method: "POST",
        endpoint: `repos/${apiSlug(repository)}/git/trees`,
        body: {
          base_tree: apiCommit(baseTree),
          tree: files.map(({ path: filePath, content }) => ({
            path: apiRepositoryPath(filePath),
            mode: "100644",
            type: "blob",
            content
          }))
        }
      });
    },
    async createCommit(repository, { message, tree, parents }) {
      return request({
        method: "POST",
        endpoint: `repos/${apiSlug(repository)}/git/commits`,
        body: {
          message: requireBoundedMultilineText(message, "commit message", 500),
          tree: apiCommit(tree),
          parents: parents.map(apiCommit)
        }
      });
    },
    async createRef(repository, { branch, commit }) {
      return request({
        method: "POST",
        endpoint: `repos/${apiSlug(repository)}/git/refs`,
        body: { ref: `refs/heads/${requireBranch(branch, "application branch")}`, sha: apiCommit(commit) }
      });
    },
    async updateRef(repository, { branch, commit }) {
      return request({
        method: "PATCH",
        endpoint: `repos/${apiSlug(repository)}/git/refs/heads/${encodeURIComponent(requireBranch(branch, "application branch"))}`,
        body: { sha: apiCommit(commit), force: false }
      });
    },
    async createDraftPull(centralRepository, { title, body, head, base }) {
      return request({
        method: "POST",
        endpoint: `repos/${apiSlug(centralRepository)}/pulls`,
        body: {
          title: requireBoundedText(title, "pull-request title", 200),
          body: requireBoundedMultilineText(body, "pull-request body", 64_000),
          head: requireBoundedText(head, "pull-request head", 200),
          base: requireBranch(base, "pull-request base"),
          draft: true,
          maintainer_can_modify: false
        },
        allowNotFound: true,
        requireResponse: true
      });
    },
    async updatePull(centralRepository, number, { title, body }) {
      return request({
        method: "PATCH",
        endpoint: `repos/${apiSlug(centralRepository)}/pulls/${apiPullNumber(number)}`,
        body: {
          title: requireBoundedText(title, "pull-request title", 200),
          body: requireBoundedMultilineText(body, "pull-request body", 64_000)
        }
      });
    }
  });
}

function apiCompareSpec(baseCommit, headLogin, headBranch) {
  const head = `${requireGitHubLogin(headLogin, "comparison head login")}:${requireBranch(headBranch, "comparison head branch")}`;
  return encodeURIComponent(`${apiCommit(baseCommit)}...${head}`).replaceAll(".", "%2E");
}


function splitIncludedGitHubResponse(stdout, explicitHeaders = null) {
  let body = stdout;
  let statusCode = null;
  let headers = normalizeGitHubResponseHeaders(explicitHeaders);
  let consumedHeaderBytes = 0;
  for (let blockCount = 0; blockCount < 8 && /^HTTP\/[0-9.]+\s+[0-9]{3}(?:\s|$)/u.test(body); blockCount += 1) {
    const match = /\r?\n\r?\n/u.exec(body);
    if (match === null) fail("GITHUB_OUTPUT_INVALID", "GitHub returned an incomplete response header block");
    const headerBlock = body.slice(0, match.index);
    consumedHeaderBytes += Buffer.byteLength(headerBlock, "utf8") + match[0].length;
    if (consumedHeaderBytes > MAX_API_RESPONSE_HEADER_BYTES) {
      fail("GITHUB_OUTPUT_INVALID", "GitHub returned oversized response headers");
    }
    const lines = headerBlock.split(/\r?\n/u);
    const statusMatch = /^HTTP\/[0-9.]+\s+([0-9]{3})(?:\s|$)/u.exec(lines.shift() ?? "");
    if (statusMatch === null) fail("GITHUB_OUTPUT_INVALID", "GitHub returned a malformed response status line");
    statusCode = Number(statusMatch[1]);
    headers = {};
    for (const line of lines) {
      const separator = line.indexOf(":");
      if (separator <= 0) fail("GITHUB_OUTPUT_INVALID", "GitHub returned a malformed response header");
      const name = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (!/^[a-z0-9-]+$/u.test(name) || value.length > 8_192) {
        fail("GITHUB_OUTPUT_INVALID", "GitHub returned a malformed response header");
      }
      headers[name] = value;
    }
    body = body.slice(match.index + match[0].length);
  }
  if (Buffer.byteLength(body, "utf8") > MAX_API_OUTPUT_BYTES) {
    fail("GITHUB_OUTPUT_INVALID", "GitHub returned an oversized response body");
  }
  return { body, statusCode, headers };
}

function normalizeGitHubResponseHeaders(value) {
  if (value === null || value === undefined) return {};
  if (!isPlainObject(value)) return {};
  const normalized = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.toLowerCase();
    const headerValue = Array.isArray(rawValue) ? rawValue.at(-1) : rawValue;
    if (/^[a-z0-9-]+$/u.test(name) && typeof headerValue === "string" && headerValue.length <= 8_192) {
      normalized[name] = headerValue.trim();
    }
  }
  return normalized;
}

function extractGitHubHttpStatus(stderr) {
  const matches = [...String(stderr ?? "").matchAll(/\bHTTP(?:\/[0-9.]+)?(?:\s+|:\s*)([0-9]{3})\b/giu)];
  return matches.length === 0 ? null : Number(matches.at(-1)[1]);
}

function classifyGitHubGetFailure({ method, httpStatus, headers, stderr, attempt, nowMs }) {
  const retryAfterSeconds = parseRetryAfterSeconds(headers["retry-after"], nowMs);
  const rateLimitRemaining = parseNonNegativeDecimalHeader(headers["x-ratelimit-remaining"]);
  const rateLimitResetEpochSeconds = parseNonNegativeDecimalHeader(headers["x-ratelimit-reset"]);
  const rateLimitResource = boundedHeaderToken(headers["x-ratelimit-resource"]);
  const secondaryRateLimit = /secondary rate limit|abuse detection/iu.test(stderr);
  const rateLimited = method === "GET" && (
    httpStatus === 429
    || (httpStatus === 403 && (rateLimitRemaining === "0" || retryAfterSeconds !== null || secondaryRateLimit))
  );
  let rateLimitDelayMs = null;
  if (retryAfterSeconds !== null) rateLimitDelayMs = retryAfterSeconds * 1_000;
  else if (rateLimitResetEpochSeconds !== null) {
    const resetMs = Number(rateLimitResetEpochSeconds) * 1_000;
    if (Number.isSafeInteger(resetMs)) rateLimitDelayMs = Math.max(0, resetMs - nowMs);
  }
  const transientStatus = httpStatus === null
    || new Set([408, 425, 429, 500, 502, 503, 504]).has(httpStatus)
    || rateLimited;
  const defaultDelayMs = DEFAULT_GET_BACKOFF_MS * (2 ** Math.max(0, attempt - 1));
  return {
    retryable: method === "GET" && transientStatus,
    rateLimited,
    httpStatus,
    retryAfterSeconds,
    rateLimitRemaining,
    rateLimitResetEpochSeconds,
    rateLimitResource,
    delayMs: rateLimitDelayMs ?? defaultDelayMs
  };
}

function parseRetryAfterSeconds(value, nowMs) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (/^[0-9]{1,9}$/u.test(value)) return Number(value);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - nowMs) / 1_000));
}

function parseNonNegativeDecimalHeader(value) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]{0,18})$/u.test(value) ? value : null;
}

function boundedHeaderToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/u.test(value) ? value : null;
}

function githubTransportFailureDetails({ method, failure, attempt, maximumAttempts, totalBackoffMs }) {
  return {
    requestMethod: method,
    attempts: attempt,
    maximumAttempts,
    totalBackoffMs,
    httpStatus: failure.httpStatus,
    retryAfterSeconds: failure.retryAfterSeconds,
    rateLimitRemaining: failure.rateLimitRemaining,
    rateLimitResetEpochSeconds: failure.rateLimitResetEpochSeconds,
    rateLimitResource: failure.rateLimitResource
  };
}


function defaultCommandRunner({ command, args, stdin, timeoutMs, maxOutputBytes }) {
  if (command !== "gh" || !Array.isArray(args)) throw new TypeError("unsupported command runner input");
  const environment = { ...process.env };
  delete environment.GH_HOST;
  delete environment.GH_REPO;
  environment.GH_PROMPT_DISABLED = "1";
  environment.GH_PAGER = "cat";
  environment.PAGER = "cat";
  const result = childProcess.spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    env: environment,
    input: stdin,
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes
  });
  if (result.error) {
    return { status: 1, stdout: "", stderr: result.error.message };
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
