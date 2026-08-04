import assert from "node:assert/strict";
import test from "node:test";

import {
  createTrustedGitHubActionsPublicTransportV1,
  GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1
} from "../verify-public-hook-application-core.mjs";

const API_URL = "https://api.github.com/repos/alice/example-hook";

test("trusted Actions transport stays anonymous and preserves the frozen public request", async () => {
  const observed = [];
  const transport = createTransport(async (url, options) => {
    observed.push({ url, options });
    return response(200, "{}", { "content-type": "application/json" }, url);
  });
  const request = publicRequest();
  const result = await transport(request);
  assert.equal(result.status, 200);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, API_URL);
  assert.deepEqual(observed[0].options.headers, request.headers);
  assert.ok(!Object.keys(observed[0].options.headers).some((name) => name.toLowerCase() === "authorization"));
  assert.equal(observed[0].options.redirect, "error");
  assert.equal(observed[0].options.method, "GET");
});

test("candidate-controlled origins are rejected before fetch and never receive a credential", async () => {
  let calls = 0;
  const transport = createTransport(async () => {
    calls += 1;
    return response(200, "{}", {}, API_URL);
  });
  await assert.rejects(
    transport({ ...publicRequest(), url: "https://example.invalid/repos/alice/example-hook" }),
    (error) => error?.code === "GITHUB_PROTOCOL_ERROR"
  );
  assert.equal(calls, 0);
});

test("extra headers including Authorization are rejected before fetch", async () => {
  let calls = 0;
  const transport = createTransport(async () => {
    calls += 1;
    return response(200, "{}", {}, API_URL);
  });
  const request = publicRequest();
  await assert.rejects(
    transport({ ...request, headers: { ...request.headers, Authorization: "Bearer should-not-exist" } }),
    (error) => error?.code === "INVALID_OPTIONS"
  );
  assert.equal(calls, 0);
});

test("an exhausted shared-IP primary limit fails closed without a futile retry", async () => {
  let calls = 0;
  const transport = createTransport(async (url) => {
    calls += 1;
    return response(403, '{"message":"rate limit"}', {
      "retry-after": "0",
      "x-ratelimit-remaining": "0"
    }, url);
  });
  const result = await transport(publicRequest());
  assert.equal(result.status, 403);
  assert.equal(calls, 1);
});

test("one short server-directed secondary-limit retry is allowed and byte bounded", async () => {
  let calls = 0;
  const sleeps = [];
  const transport = createTransport(async (url) => {
    calls += 1;
    if (calls === 1) {
      return response(429, "slow down", {
        "retry-after": "1",
        "x-ratelimit-remaining": "42"
      }, url);
    }
    return response(200, "{}", {}, url);
  }, {
    maximumRetryDelayMs: 1_000,
    minimumIntervalMs: 0,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); }
  });
  const result = await transport(publicRequest());
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1_000]);
});

test("long Retry-After values and oversized error bodies are never retried", async () => {
  for (const fixture of [
    { headers: { "retry-after": "60", "x-ratelimit-remaining": "42" }, body: "slow" },
    { headers: { "retry-after": "0", "x-ratelimit-remaining": "42" }, body: "x".repeat(16 * 1024 + 1) }
  ]) {
    let calls = 0;
    const transport = createTransport(async (url) => {
      calls += 1;
      return response(429, fixture.body, fixture.headers, url);
    });
    const result = await transport(publicRequest());
    assert.equal(result.status, 429);
    assert.equal(calls, 1);
  }
});

test("a transient upstream failure receives at most one bounded retry", async () => {
  let calls = 0;
  const sleeps = [];
  const transport = createTransport(async (url) => {
    calls += 1;
    return response(503, "unavailable", {}, url);
  }, {
    minimumIntervalMs: 0,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    transientRetryDelayMs: 250
  });
  const result = await transport(publicRequest());
  assert.equal(result.status, 503);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [250]);
});

test("redirects are rejected and never retried", async () => {
  let calls = 0;
  const transport = createTransport(async () => {
    calls += 1;
    return response(302, "redirect", { location: "https://example.invalid" }, "https://example.invalid");
  });
  await assert.rejects(transport(publicRequest()), (error) => error?.code === "GITHUB_REDIRECT_REJECTED");
  assert.equal(calls, 1);
});

test("serial requests are paced without extending the configured retry surface", async () => {
  let time = 1_000;
  const sleeps = [];
  const transport = createTransport(async (url) => response(200, "{}", {}, url), {
    minimumIntervalMs: 125,
    now: () => time,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      time += milliseconds;
    }
  });
  await transport(publicRequest());
  await transport(publicRequest());
  assert.deepEqual(sleeps, [125]);
});

test("the admitted source, retry, pacing, provider, and deadline budgets fit exactly", () => {
  const budget = GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1;
  assert.equal(budget.maximumSourceRequests, 48);
  assert.equal(budget.maximumProviderRequests, 60);
  assert.equal(budget.maximumTransportRetries, 12);
  assert.ok(budget.maximumSourceRequests + budget.maximumTransportRetries <= budget.maximumProviderRequests);
  const worstScheduledDelay = ((budget.maximumProviderRequests - 1) * budget.minimumIntervalMs)
    + (budget.maximumTransportRetries * budget.maximumRetryDelayMs);
  assert.equal(worstScheduledDelay, 19_375);
  assert.ok(worstScheduledDelay < budget.timeoutMs);
});

test("concurrent callers receive distinct paced request slots", async () => {
  let time = 1_000;
  const starts = [];
  const transport = createTransport(async (url) => {
    starts.push(time);
    return response(200, "{}", {}, url);
  }, {
    minimumIntervalMs: 125,
    now: () => time,
    sleep: async (milliseconds) => { time += milliseconds; }
  });
  await Promise.all([transport(publicRequest()), transport(publicRequest()), transport(publicRequest())]);
  assert.deepEqual(starts, [1_000, 1_125, 1_250]);
});

test("the physical anonymous quota includes retries and then blocks as a system rate limit", async () => {
  let calls = 0;
  const transport = createTransport(async (url) => {
    calls += 1;
    return response(200, "{}", {}, url);
  });
  for (let index = 0; index < GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumProviderRequests; index += 1) {
    await transport(publicRequest());
  }
  await assert.rejects(
    transport(publicRequest()),
    (error) => error?.code === "GITHUB_RATE_LIMITED" && error.retryable === true
  );
  assert.equal(calls, GITHUB_ANONYMOUS_RESOLUTION_BUDGET_V1.maximumProviderRequests);
});

function createTransport(fetchImplementation, overrides = {}) {
  return createTrustedGitHubActionsPublicTransportV1({
    fetchImplementation,
    minimumIntervalMs: 0,
    now: () => 1_000,
    sleep: async () => {},
    ...overrides
  });
}

function publicRequest() {
  return {
    method: "GET",
    url: API_URL,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "programmable-github-public-source-v1",
      "X-GitHub-Api-Version": "2026-03-10"
    },
    redirect: "error",
    signal: new AbortController().signal,
    maxResponseBytes: 64 * 1024
  };
}

function response(status, body, headers, url) {
  const values = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    status,
    redirected: status >= 300 && status < 400,
    url,
    headers: {
      get(name) { return values.get(name.toLowerCase()) ?? null; }
    },
    body: null,
    async arrayBuffer() { return Buffer.from(body); }
  };
}
