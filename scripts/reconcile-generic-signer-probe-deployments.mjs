#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readBoundedResponseText } from "./read-bounded-response.mjs";

const SCHEMA =
  "programmable.website-generic-launch-read-stage-probe-reconciliation.v1";
const PROBE_MARKER = "one-shot-v1";
const REPOSITORY_ID = "1314365508";
const RECOVERY_ID = /^[0-9a-f]{32}\.[0-9]{1,20}\.[1-9][0-9]{0,5}\.[0-9a-f]{40}$/u;
const GIT_OID = /^[0-9a-f]{40}$/u;
const TEAM_ID = /^team_[A-Za-z0-9]{20,80}$/u;
const PROJECT_ID = /^prj_[A-Za-z0-9]{20,80}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const DEPLOYMENT_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/u;
const MAXIMUM_RESPONSE_BYTES = 2_097_152;
const MAXIMUM_PAGES = 20;
const MAXIMUM_ATTEMPTS = 12;
const RETRY_DELAY_MS = 5_000;
const REQUIRED_EMPTY_OBSERVATIONS = 3;

export async function reconcileGenericSignerProbeDeploymentsV1(input) {
  const token = secret(input.token, "Vercel token");
  const teamId = exact(input.teamId, TEAM_ID, "Vercel team ID");
  const projectId = exact(input.projectId, PROJECT_ID, "Vercel project ID");
  const allProjectProbes = input.allProjectProbes === true;
  const recoveryId = allProjectProbes
    ? null : exact(input.recoveryId, RECOVERY_ID, "probe recovery ID");
  const websiteHead = allProjectProbes
    ? null : exact(input.websiteHead, GIT_OID, "Website head");
  const expectedDeploymentId = input.expectedDeploymentId === undefined
    ? undefined
    : exact(input.expectedDeploymentId, DEPLOYMENT_ID, "expected deployment ID");
  const request = input.fetchImpl ?? fetch;
  const wait = input.sleep ?? sleep;
  const clock = input.now ?? (() => new Date());
  const authority = Object.freeze({
    token, teamId, projectId, recoveryId, websiteHead, allProjectProbes, request,
  });
  const matched = new Map();
  const deletion = [];
  let consecutiveEmpty = 0;
  let providerListAbsent = false;
  for (let attempt = 0; attempt < MAXIMUM_ATTEMPTS; attempt += 1) {
    const current = await listMatches(authority);
    if (current.length === 0) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty === REQUIRED_EMPTY_OBSERVATIONS) {
        providerListAbsent = true;
        break;
      }
    } else {
      consecutiveEmpty = 0;
      for (const deployment of current) {
        matched.set(deployment.id, deployment);
        if (deletion.some(({ deploymentId }) =>
          deploymentId === deployment.id)) continue;
        const providerDeleteStatus = await deleteDeployment(
          authority,
          deployment.id,
        );
        const providerGetAfterStatus = await waitForStatus({
          request: () => providerRequest(authority,
            `/v13/deployments/${deployment.id}`, { method: "GET" }),
          accepted: new Set([404]),
          wait,
          label: `provider absence ${deployment.id}`,
        });
        const publicOriginStatus = await waitForStatus({
          request: () => request(deployment.origin, {
            method: "GET", redirect: "error",
            signal: AbortSignal.timeout(30_000),
          }),
          accepted: new Set([404, 410]),
          wait,
          label: `public absence ${deployment.id}`,
        });
        deletion.push(Object.freeze({
          deploymentId: deployment.id,
          origin: deployment.origin,
          providerDeleteStatus,
          providerGetAfterStatus,
          publicOriginStatus,
          observedAt: iso(clock(), "deletion observation"),
        }));
      }
    }
    if (attempt < MAXIMUM_ATTEMPTS - 1) await wait(RETRY_DELAY_MS);
  }
  if (!providerListAbsent) {
    throw new Error("Vercel probe deployment list did not become empty");
  }
  const matches = Object.freeze([...matched.values()].sort((left, right) =>
    left.id.localeCompare(right.id)));
  const result = Object.freeze({
    schemaVersion: SCHEMA,
    status: "clean",
    scope: allProjectProbes ? "all-project-probes" : "exact-recovery",
    recoveryId,
    websiteHead,
    projectId,
    matchedDeployments: Object.freeze(matches),
    deletion: Object.freeze(deletion),
    providerListAbsent,
    observedAt: iso(clock(), "reconciliation observation"),
  });
  if (expectedDeploymentId !== undefined
    && (matches.length !== 1 || matches[0].id !== expectedDeploymentId)) {
    throw new Error("reconciled deployment differs from the staged probe");
  }
  return result;
}

async function listMatches(authority) {
  const deployments = [];
  const seenPages = new Set();
  let until;
  for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
    const query = new URLSearchParams({
      projectId: authority.projectId,
      target: "production",
      limit: "100",
      "meta-programmableGenericSignerProbe": PROBE_MARKER,
      "meta-programmableRepositoryId": REPOSITORY_ID,
      teamId: authority.teamId,
    });
    if (!authority.allProjectProbes) {
      query.set(
        "meta-programmableGenericSignerProbeRecoveryId",
        authority.recoveryId,
      );
      query.set("meta-githubCommitSha", authority.websiteHead);
    }
    if (until !== undefined) query.set("until", until);
    const response = await providerRequest(
      authority,
      `/v6/deployments?${query.toString()}`,
      { method: "GET" },
    );
    if (response.status !== 200) throw new Error("Vercel deployment list failed");
    const value = await responseJson(response, "Vercel deployment list");
    if (!Array.isArray(value?.deployments)) {
      throw new Error("Vercel deployment list is invalid");
    }
    for (const raw of value.deployments) {
      const id = exact(raw?.id, DEPLOYMENT_ID, "probe deployment ID");
      const host = exact(
        String(raw?.url ?? "").replace(/^https?:\/\//u, "").replace(/\/$/u, ""),
        DEPLOYMENT_HOST,
        "probe deployment host",
      );
      if (raw?.target !== "production"
        || raw?.meta?.programmableGenericSignerProbe !== PROBE_MARKER
        || raw?.meta?.programmableRepositoryId !== REPOSITORY_ID
        || !RECOVERY_ID.test(
          raw?.meta?.programmableGenericSignerProbeRecoveryId ?? "",
        )
        || !GIT_OID.test(raw?.meta?.githubCommitSha ?? "")
        || (!authority.allProjectProbes
          && (raw.meta.programmableGenericSignerProbeRecoveryId
            !== authority.recoveryId
            || raw.meta.githubCommitSha !== authority.websiteHead))) {
        throw new Error("Vercel returned an unbound probe deployment");
      }
      deployments.push(Object.freeze({ id, origin: `https://${host}` }));
    }
    const next = value?.pagination?.next;
    if (next === null || next === undefined) break;
    const parsed = String(next);
    if (!/^[1-9][0-9]{0,19}$/u.test(parsed) || seenPages.has(parsed)) {
      throw new Error("Vercel deployment pagination is invalid");
    }
    seenPages.add(parsed);
    until = parsed;
    if (page === MAXIMUM_PAGES - 1) {
      throw new Error("Vercel deployment pagination exceeded its bound");
    }
  }
  const ids = deployments.map(({ id }) => id);
  const origins = deployments.map(({ origin }) => origin);
  if (new Set(ids).size !== ids.length || new Set(origins).size !== origins.length) {
    throw new Error("Vercel returned duplicate probe deployments");
  }
  return Object.freeze([...deployments].sort((left, right) =>
    left.id.localeCompare(right.id)));
}

async function deleteDeployment(authority, id) {
  const response = await providerRequest(
    authority,
    `/v13/deployments/${id}`,
    { method: "DELETE" },
  );
  if (![200, 204].includes(response.status)) {
    throw new Error(`Vercel probe deletion failed for ${id}`);
  }
  return response.status;
}

async function providerRequest(authority, path, init) {
  return authority.request(new URL(path, "https://api.vercel.com"), {
    ...init,
    redirect: "error",
    headers: { authorization: `Bearer ${authority.token}` },
    signal: AbortSignal.timeout(30_000),
  });
}

async function waitForStatus({ request, accepted, wait, label }) {
  let status = 0;
  for (let attempt = 0; attempt < MAXIMUM_ATTEMPTS; attempt += 1) {
    const response = await request();
    status = response.status;
    if (accepted.has(status)) return status;
    if (attempt < MAXIMUM_ATTEMPTS - 1) await wait(RETRY_DELAY_MS);
  }
  throw new Error(`${label} was not proven; last status ${status}`);
}

async function responseJson(response, label) {
  const source = await readBoundedResponseText(response, {
    maximumBytes: MAXIMUM_RESPONSE_BYTES,
    label,
  });
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} is not JSON`);
  }
}

function canonical(value) {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exact(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function secret(value, label) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 20
    || Buffer.byteLength(value, "utf8") > 8_192 || /[\r\n]/u.test(value)) {
    throw new Error(`${label} is unavailable`);
  }
  return value;
}

function iso(value, label) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} is invalid`);
  }
  return value.toISOString();
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!/^--[a-z][a-z-]*$/u.test(flag ?? "") || value === undefined
      || value.startsWith("--") || result[flag.slice(2)] !== undefined) {
      throw new Error("probe reconciliation arguments are invalid");
    }
    result[flag.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = resolve(args.output ?? "");
  const githubOutput = resolve(args["github-output"] ?? "");
  if (!args.output || !args["github-output"] || output === githubOutput) {
    throw new Error("probe reconciliation output paths are invalid");
  }
  const result = await reconcileGenericSignerProbeDeploymentsV1({
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_ORG_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
    ...(args.scope === "all-project-probes" ? {
      allProjectProbes: true,
    } : args.scope === undefined || args.scope === "exact-recovery" ? {
      recoveryId: args["recovery-id"],
      websiteHead: args["website-head"],
    } : (() => { throw new Error("probe reconciliation scope is invalid"); })()),
    ...(args["expected-deployment-id"] === undefined ? {} : {
      expectedDeploymentId: args["expected-deployment-id"],
    }),
  });
  const bytes = `${canonical(result)}\n`;
  writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
  const values = [
    `reconciliation_path=${output}`,
    `reconciliation_sha256=${sha256(bytes)}`,
    `match_count=${result.matchedDeployments.length}`,
    `observed_at=${result.observedAt}`,
  ];
  if (result.deletion.length === 1) {
    const [entry] = result.deletion;
    values.push(
      `deployment_id=${entry.deploymentId}`,
      `target_url=${entry.origin}`,
      `delete_status=${entry.providerDeleteStatus}`,
      `get_status=${entry.providerGetAfterStatus}`,
      `public_status=${entry.publicOriginStatus}`,
      `deletion_observed_at=${entry.observedAt}`,
    );
  }
  appendFileSync(githubOutput, `${values.join("\n")}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    recoveryId: result.recoveryId,
    matchedDeploymentCount: result.matchedDeployments.length,
    reconciliationSha256: sha256(bytes),
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error
      ? error.message : "probe reconciliation failed"}\n`);
    process.exitCode = 1;
  });
}
