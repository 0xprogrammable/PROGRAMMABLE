import { canonicalizeJson } from "./canonical-json.mjs";
import {
  AGENT_REMEDIATION_CATALOG_URL,
  CLI_DIAGNOSTIC_SCHEMA,
  EXISTING_PROJECT_INTEGRATION_GUIDE_URL,
} from "./constants.mjs";

const DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export class ProgrammableCliDiagnosticError extends TypeError {
  constructor({
    code,
    stage,
    summary,
    expected,
    observed,
    targetId,
    targetRole,
    sourcePath,
    documentationUrl = EXISTING_PROJECT_INTEGRATION_GUIDE_URL,
    remediationUrl = remediationUrlFor(code),
    retryable = false,
    requiresNewRequest = false,
  }) {
    if (typeof code !== "string" || !DIAGNOSTIC_CODE.test(code)) {
      throw new TypeError("CLI diagnostic code is invalid");
    }
    if (typeof stage !== "string" || stage.length === 0) {
      throw new TypeError("CLI diagnostic stage is invalid");
    }
    if (typeof summary !== "string" || summary.length === 0) {
      throw new TypeError("CLI diagnostic summary is invalid");
    }
    const diagnostic = {
      schemaVersion: CLI_DIAGNOSTIC_SCHEMA,
      code,
      severity: "error",
      stage,
      summary,
      ...(targetId === undefined ? {} : { targetId }),
      ...(targetRole === undefined ? {} : { targetRole }),
      ...(sourcePath === undefined ? {} : { sourcePath }),
      expected,
      observed,
      documentationUrl,
      remediationUrl,
      retryable,
      requiresNewRequest,
    };
    super(`${code}: ${summary}\nProgrammable CLI diagnostic: ${canonicalizeJson(diagnostic)}`);
    this.name = "ProgrammableCliDiagnosticError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export function createCliDiagnosticError(value) {
  return new ProgrammableCliDiagnosticError(value);
}

export function createCliWarning({
  code,
  stage,
  summary,
  expected,
  observed,
  targetId,
  targetRole,
  sourcePath,
  documentationUrl = EXISTING_PROJECT_INTEGRATION_GUIDE_URL,
  remediationUrl = remediationUrlFor(code),
}) {
  if (typeof code !== "string" || !DIAGNOSTIC_CODE.test(code)) {
    throw new TypeError("CLI warning code is invalid");
  }
  return {
    schemaVersion: CLI_DIAGNOSTIC_SCHEMA,
    code,
    severity: "warning",
    stage,
    summary,
    ...(targetId === undefined ? {} : { targetId }),
    ...(targetRole === undefined ? {} : { targetRole }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    expected,
    observed,
    documentationUrl,
    remediationUrl,
    retryable: false,
    requiresNewRequest: false,
  };
}

export function remediationUrlFor(code) {
  return `${AGENT_REMEDIATION_CATALOG_URL}#${code}`;
}

export function observedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    errorType: error instanceof Error ? error.name : typeof error,
    ...(typeof error?.code === "string" ? { errorCode: error.code } : {}),
    reason: message.length <= 1_024 ? message : `${message.slice(0, 1_021)}...`,
  };
}
