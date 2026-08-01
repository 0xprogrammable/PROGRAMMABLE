import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;

export function exactStagedTarget(value, deploymentId) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("staged target is invalid");
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    !target.hostname.endsWith(".vercel.app") ||
    !/^dpl_[A-Za-z0-9]{20,80}$/u.test(deploymentId ?? "")
  ) {
    throw new Error("staged target must be an exact Vercel deployment");
  }
  return target;
}

function cronSecret(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 32 ||
    Buffer.byteLength(value, "utf8") > 1_024 ||
    /[\r\n]/u.test(value)
  ) {
    throw new Error("CRON_SECRET is required");
  }
  return value;
}

async function jsonRequest({ target, pathName, method = "GET", body, secret, fetchImpl = fetch }) {
  const response = await fetchImpl(new URL(pathName, target), {
    method,
    redirect: "error",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${cronSecret(secret)}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(95_000),
  });
  const text = await response.text();
  if (
    Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES ||
    response.headers.get("cache-control") !== "no-store"
  ) {
    throw new Error("staged worker returned unsafe response metadata");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("staged worker did not return JSON");
  }
  if (!response.ok) throw new Error(`staged worker failed: ${pathName}`);
  return parsed;
}

export function createStagedWorkers(input) {
  const target = exactStagedTarget(input.targetUrl, input.deploymentId);
  const secret = cronSecret(input.cronSecret);
  const common = { target, secret, fetchImpl: input.fetchImpl };
  return Object.freeze({
    runSourceProjector: () => jsonRequest({ ...common, pathName: "/api/ops/projector" }),
    runMarketProjector: () => jsonRequest({ ...common, pathName: "/api/ops/market-projector" }),
    runReconciler: (request) => jsonRequest({
      ...common,
      pathName: "/api/ops/reconcile-preparity",
      method: "POST",
      body: request,
    }),
  });
}

export async function verifyStagedSchedulersDisabled(workers) {
  const [source, market] = await Promise.all([
    workers.runSourceProjector(),
    workers.runMarketProjector(),
  ]);
  if (
    source?.ok !== true ||
    source?.status !== "disabled" ||
    source?.readiness?.status !== "disabled" ||
    source?.readiness?.activationReady !== false ||
    market?.status !== "disabled" ||
    market?.caughtUp !== false
  ) {
    throw new Error("candidate projector scheduling is not stopped");
  }
  return Object.freeze({
    source: Object.freeze({ status: "disabled", activationReady: false }),
    market: Object.freeze({ status: "disabled", caughtUp: false }),
  });
}

function lastJsonLine(value, label) {
  const lines = value.trim().split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines.slice(index).join("\n"));
    } catch {
      // Multi-line JSON may begin on an earlier line.
    }
  }
  throw new Error(`${label} returned invalid JSON`);
}

export async function captureAndGateStagedReadModel(input) {
  const target = exactStagedTarget(input.targetUrl, input.deploymentId);
  const outputDirectory = path.resolve(input.outputDirectory);
  const capture = await (input.execute ?? execute)(
    process.execPath,
    [
      "scripts/perf/read-model-capture.mjs",
      "--target-url",
      target.toString(),
      "--deployment-id",
      input.deploymentId,
      "--output-directory",
      outputDirectory,
      "--kind",
      "preview",
    ],
    {
      cwd: input.workspace,
      env: input.environment ?? process.env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 20 * 60 * 1_000,
    },
  );
  const captureResult = lastJsonLine(capture.stdout, "read-model capture");
  if (
    captureResult?.mode !== "capture" ||
    typeof captureResult.evidencePath !== "string"
  ) {
    throw new Error("read-model capture did not produce evidence");
  }
  const gate = await (input.execute ?? execute)(
    process.execPath,
    [
      "scripts/perf/read-model-gate.mjs",
      "--require-release-evidence",
      "--evidence",
      captureResult.evidencePath,
    ],
    {
      cwd: input.workspace,
      env: {
        ...(input.environment ?? process.env),
        PROGRAMMABLE_READ_MODEL_TARGET_URL: target.toString(),
        PROGRAMMABLE_READ_MODEL_VERCEL_DEPLOYMENT_ID: input.deploymentId,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10 * 60 * 1_000,
    },
  );
  const gateResult = lastJsonLine(gate.stdout, "read-model gate");
  if (
    gateResult?.status !== "accepted" ||
    gateResult?.releaseEvidenceAccepted !== true
  ) {
    throw new Error("read-model gate rejected staged evidence");
  }
  const evidence = JSON.parse(await readFile(captureResult.evidencePath, "utf8"));
  const commitment = evidence?.evidenceSha256 ?? evidence?.releaseEvidenceSha256;
  if (typeof commitment !== "string" || !/^0x[0-9a-f]{64}$/u.test(commitment)) {
    throw new Error("read-model evidence commitment is missing");
  }
  return Object.freeze({
    status: "accepted",
    releaseEvidenceAccepted: true,
    evidenceSha256: commitment,
    evidencePath: captureResult.evidencePath,
  });
}
