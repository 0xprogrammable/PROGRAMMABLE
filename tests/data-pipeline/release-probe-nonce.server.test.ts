import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DataPipelineError } from "../../lib/data-pipeline/errors";
import {
  createReleaseProbeNonceConsumer,
  type ReleaseProbeNonceInput,
} from "../../lib/data-pipeline/release-probe-nonce.server";
import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";

type RecordedQuery = Readonly<{
  text: string;
  values: readonly PostgresParameter[];
}>;

class FakeExecutor implements PostgresExecutor {
  readonly queries: RecordedQuery[] = [];
  readonly close = vi.fn(async () => undefined);

  constructor(
    private readonly responder: (
      text: string,
      values: readonly PostgresParameter[],
    ) => Promise<readonly Record<string, unknown>[]>,
  ) {}

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        this.queries.push({ text, values });
        return (await this.responder(text, values)) as readonly Row[];
      },
    });
  }
}

const issuedAt = new Date("2026-07-31T20:00:00.000Z");
const expiresAt = new Date("2026-07-31T20:05:00.000Z");
const candidate: ReleaseProbeNonceInput = {
  route: "explore-token",
  nonce: `${issuedAt.valueOf()}-${"ab".repeat(32)}-1`,
  issuedAt,
  expiresAt,
};

function identityRow() {
  return {
    session_user: "programmable_release_probe_nonce_login",
    active_role: "programmable_release_probe_nonce",
  };
}

describe("distributed release-probe nonce consumer", () => {
  it("uses only the dedicated role and atomically consumes one SHA-256 digest", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (/session_user::text/.test(text)) return [identityRow()];
      if (/consume_release_probe_nonce_v1/.test(text)) {
        return [{ consumed: true }];
      }
      return [];
    });
    const consumer = createReleaseProbeNonceConsumer({ executor });

    await expect(consumer.consume(candidate)).resolves.toBe(true);

    expect(executor.queries[0]?.text).toBe(
      "set local role programmable_release_probe_nonce",
    );
    const consume = executor.queries.find((query) =>
      query.text.includes("consume_release_probe_nonce_v1"),
    );
    expect(consume?.values[0]).toBe("explore-token");
    expect(consume?.values[1]).toBeInstanceOf(Uint8Array);
    expect((consume?.values[1] as Uint8Array).byteLength).toBe(32);
    expect(consume?.values[2]).toEqual(issuedAt);
    expect(consume?.values[3]).toEqual(expiresAt);
    expect(consume?.text).not.toContain(candidate.nonce);
  });

  it("returns false when the database reports a globally consumed nonce", async () => {
    const executor = new FakeExecutor(async (text) => {
      if (/session_user::text/.test(text)) return [identityRow()];
      if (/consume_release_probe_nonce_v1/.test(text)) {
        return [{ consumed: false }];
      }
      return [];
    });

    await expect(
      createReleaseProbeNonceConsumer({ executor }).consume(candidate),
    ).resolves.toBe(false);
  });

  it("rejects the wrong session identity before calling the consume function", async () => {
    const executor = new FakeExecutor(async (text) =>
      /session_user::text/.test(text)
        ? [
            {
              session_user: "programmable_api_reader_login",
              active_role: "programmable_release_probe_nonce",
            },
          ]
        : [],
    );

    await expect(
      createReleaseProbeNonceConsumer({ executor }).consume(candidate),
    ).rejects.toBeInstanceOf(DataPipelineError);
    expect(
      executor.queries.some((query) =>
        query.text.includes("consume_release_probe_nonce_v1"),
      ),
    ).toBe(false);
  });

  it("rejects unsupported routes without opening a database transaction", async () => {
    const executor = new FakeExecutor(async () => []);
    await expect(
      createReleaseProbeNonceConsumer({ executor }).consume({
        ...candidate,
        route: "arbitrary-route",
      }),
    ).rejects.toBeInstanceOf(DataPipelineError);
    expect(executor.queries).toEqual([]);
  });

  it("sanitizes database failures without serializing credentials or nonces", async () => {
    const executor = new FakeExecutor(async () => {
      throw new Error(
        `postgres://probe:secret@example.invalid/db ${candidate.nonce}`,
      );
    });

    let failure: unknown;
    try {
      await createReleaseProbeNonceConsumer({ executor }).consume(candidate);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DataPipelineError);
    expect(JSON.stringify(failure)).not.toContain("secret");
    expect(JSON.stringify(failure)).not.toContain(candidate.nonce);
  });
});
