import { canonicalizeJson } from "./canonical-json.mjs";
import {
  AGENT_REMEDIATION_CATALOG_URL,
  CLI_DIAGNOSTIC_SCHEMA,
  EXISTING_PROJECT_INTEGRATION_GUIDE_URL,
} from "./constants.mjs";

const DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

const REMEDIATION_BY_CODE = Object.freeze({
  PACK_CONFIG_V3_MISSING: {
    pointer: "/remediations/0",
    requiredChange: "Inspect the exact project and create programmable-launch.config.json from the published pack-config contract.",
    resumeAt: "pack",
  },
  PACK_CONFIG_V3_INVALID: {
    pointer: "/remediations/1",
    requiredChange: "Use only the published V3 fields and exact nested shapes, then regenerate structured values from exact source and build artifacts.",
    resumeAt: "pack",
  },
  FUNDING_SIGNATURE_PATCH_NOT_TOP_LEVEL: {
    pointer: "/remediations/3",
    requiredChange: "Migrate to the V2 authorization patch and configure numeric ABI paths for the zero nonce, r, s and v leaves.",
    resumeAt: "pack",
  },
  FUNDING_SIGNATURE_PATCH_V1_LEGACY: {
    pointer: "/remediations/3",
    requiredChange: "Migrate new integrations to the V2 authorization patch; retain V1 only for an immutable legacy retry.",
    resumeAt: "pack",
  },
  FUNDING_AUTHORIZATION_PATCH_PATH_INVALID: {
    pointer: "/remediations/4",
    requiredChange: "Configure four distinct numeric ABI paths to zero bytes32 nonce, bytes32 r, bytes32 s and uint8 v leaves.",
    resumeAt: "pack",
  },
  FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED: {
    pointer: "/remediations/11",
    requiredChange: "Inspect the initializer and adapters and forward the exact CLI-derived EIP-3009 descriptor without a conflicting nonce derivation.",
    resumeAt: "validate",
  },
  FUNDING_NONCE_CONFORMANCE_UNPROVEN: {
    pointer: "/remediations/12",
    requiredChange: "Inspect the funding nonce dataflow, preserve the warning and do not present execution simulation as a safety claim.",
    resumeAt: "validate",
  },
});

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
    requiredChange = REMEDIATION_BY_CODE[code]?.requiredChange,
    resumeAt = REMEDIATION_BY_CODE[code]?.resumeAt,
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
      ...(requiredChange === undefined ? {} : { requiredChange }),
      ...(resumeAt === undefined ? {} : { resumeAt }),
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
  requiredChange = REMEDIATION_BY_CODE[code]?.requiredChange,
  resumeAt = REMEDIATION_BY_CODE[code]?.resumeAt,
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
    ...(requiredChange === undefined ? {} : { requiredChange }),
    ...(resumeAt === undefined ? {} : { resumeAt }),
  };
}

export function remediationUrlFor(code) {
  const pointer = REMEDIATION_BY_CODE[code]?.pointer;
  return pointer === undefined
    ? AGENT_REMEDIATION_CATALOG_URL
    : `${AGENT_REMEDIATION_CATALOG_URL}#${pointer}`;
}

export function observedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    errorType: error instanceof Error ? error.name : typeof error,
    ...(typeof error?.code === "string" ? { errorCode: error.code } : {}),
    reason: message.length <= 1_024 ? message : `${message.slice(0, 1_021)}...`,
  };
}
