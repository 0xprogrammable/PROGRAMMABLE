import "server-only";

export type DataPipelineDependency =
  | "config"
  | "envio"
  | "rpc"
  | "postgres"
  | "uniswap"
  | "blob";

export type DataPipelineErrorCode =
  | "invalid_config"
  | "invalid_input"
  | "validation_failed"
  | "dependency_unavailable"
  | "timeout"
  | "circuit_open"
  | "response_oversize"
  | "invalid_json"
  | "graphql_error"
  | "query_failed";

type SafeMetadataValue = string | number | boolean;

const SAFE_MESSAGES: Record<DataPipelineErrorCode, string> = {
  invalid_config: "Invalid data-pipeline configuration",
  invalid_input: "Invalid data-pipeline input",
  validation_failed: "Data-pipeline response validation failed",
  dependency_unavailable: "Data-pipeline dependency unavailable",
  timeout: "Data-pipeline dependency timed out",
  circuit_open: "Data-pipeline dependency circuit is open",
  response_oversize: "Data-pipeline response exceeded its size limit",
  invalid_json: "Data-pipeline dependency returned invalid JSON",
  graphql_error: "Data-pipeline dependency returned a GraphQL error",
  query_failed: "Data-pipeline database query failed",
};

const SAFE_METADATA_KEYS = new Set([
  "operation",
  "status",
  "limit",
  "state",
  "page",
  "dependency",
]);

function sanitizeMetadata(
  metadata: Readonly<Record<string, SafeMetadataValue>> | undefined,
) {
  if (!metadata) return undefined;
  const safe: Record<string, SafeMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (
      typeof value === "string" &&
      (value.length > 96 ||
        /(?:https?:\/\/|postgres(?:ql)?:\/\/|password|token|secret|key=)/i.test(
          value,
        ))
    ) {
      continue;
    }
    safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? Object.freeze(safe) : undefined;
}
export class DataPipelineError extends Error {
  readonly dependency: DataPipelineDependency;
  readonly code: DataPipelineErrorCode;
  readonly retryable: boolean;
  readonly countsTowardCircuit: boolean;
  readonly safeMetadata?: Readonly<Record<string, SafeMetadataValue>>;

  constructor(input: {
    dependency: DataPipelineDependency;
    code: DataPipelineErrorCode;
    retryable: boolean;
    countsTowardCircuit: boolean;
    metadata?: Readonly<Record<string, SafeMetadataValue>>;
  }) {
    super(SAFE_MESSAGES[input.code]);
    this.name = "DataPipelineError";
    this.dependency = input.dependency;
    this.code = input.code;
    this.retryable = input.retryable;
    this.countsTowardCircuit = input.countsTowardCircuit;
    this.safeMetadata = sanitizeMetadata(input.metadata);
  }

  toJSON() {
    return {
      name: this.name,
      dependency: this.dependency,
      code: this.code,
      retryable: this.retryable,
      ...(this.safeMetadata ? { metadata: this.safeMetadata } : {}),
    };
  }
}

export function dataPipelineError(
  input: ConstructorParameters<typeof DataPipelineError>[0],
) {
  return new DataPipelineError(input);
}

export function validationError(
  dependency: DataPipelineDependency,
  operation?: string,
) {
  return dataPipelineError({
    dependency,
    code: "validation_failed",
    retryable: true,
    countsTowardCircuit: true,
    metadata: operation ? { operation } : undefined,
  });
}

export function invalidInput(
  dependency: DataPipelineDependency,
  operation?: string,
) {
  return dataPipelineError({
    dependency,
    code: "invalid_input",
    retryable: false,
    countsTowardCircuit: false,
    metadata: operation ? { operation } : undefined,
  });
}
