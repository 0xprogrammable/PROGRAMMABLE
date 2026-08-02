import "server-only";

import {
  DataPipelineError,
  dataPipelineError,
  type DataPipelineDependency,
} from "./errors";

export type DataPipelineFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

async function readBoundedBody(
  response: Response,
  maximumBodyBytes: number,
  dependency: DataPipelineDependency,
) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^(0|[1-9]\d*)$/.test(declared) ||
      declared.length > 12 ||
      BigInt(declared) > BigInt(maximumBodyBytes))
  ) {
    throw dataPipelineError({
      dependency,
      code: "response_oversize",
      retryable: true,
      countsTowardCircuit: true,
    });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw dataPipelineError({
      dependency,
      code: "dependency_unavailable",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytesRead = 0;
  let completed = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytesRead += result.value.byteLength;
      if (bytesRead > maximumBodyBytes) {
        throw dataPipelineError({
          dependency,
          code: "response_oversize",
          retryable: true,
          countsTowardCircuit: true,
        });
      }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    completed = true;
    return chunks.join("");
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dataPipelineError({
      dependency,
      code: "invalid_json",
      retryable: true,
      countsTowardCircuit: true,
    });
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function boundedJsonRequest<T = unknown>(input: {
  dependency: DataPipelineDependency;
  endpoint: string;
  timeoutMs: number;
  maximumBodyBytes: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
  fetcher?: DataPipelineFetcher;
}): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = dataPipelineError({
    dependency: input.dependency,
    code: "timeout",
    retryable: true,
    countsTowardCircuit: true,
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, input.timeoutMs);
  });

  const request = (async () => {
    let response: Response;
    try {
      response = await (input.fetcher ?? fetch)(input.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...input.headers,
        },
        body: JSON.stringify(input.body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      if (controller.signal.aborted) throw timeoutError;
      throw dataPipelineError({
        dependency: input.dependency,
        code: "dependency_unavailable",
        retryable: true,
        countsTowardCircuit: true,
      });
    }
    if (!response.ok) {
      throw dataPipelineError({
        dependency: input.dependency,
        code: "dependency_unavailable",
        retryable: response.status >= 500 || response.status === 429,
        countsTowardCircuit: true,
        metadata: { status: response.status },
      });
    }

    const raw = await readBoundedBody(
      response,
      input.maximumBodyBytes,
      input.dependency,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw dataPipelineError({
        dependency: input.dependency,
        code: "invalid_json",
        retryable: true,
        countsTowardCircuit: true,
      });
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      "errors" in parsed &&
      Array.isArray((parsed as { errors?: unknown }).errors) &&
      (parsed as { errors: unknown[] }).errors.length > 0
    ) {
      throw dataPipelineError({
        dependency: input.dependency,
        code: "graphql_error",
        retryable: true,
        countsTowardCircuit: true,
      });
    }
    return parsed as T;
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
