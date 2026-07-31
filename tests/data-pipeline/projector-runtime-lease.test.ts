import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import { createProjectorRuntimeLeaseController } from "../../lib/data-pipeline/projector-runtime-lease.server";

const tokenHash = `0x${"a".repeat(64)}` as const;

class LeaseExecutor implements PostgresExecutor {
  readonly queries: Array<{
    text: string;
    values: readonly PostgresParameter[];
  }> = [];
  readonly close = vi.fn(async () => undefined);
  sessionUser = "programmable_projector_runtime_login";
  acquired = true;

  async transaction<T>(
    work: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) => {
        this.queries.push({ text, values });
        if (text === "select session_user::text as session_user") {
          return [{ session_user: this.sessionUser }] as unknown as Row[];
        }
        if (text.includes("current_setting('role')")) {
          return [{
            session_user: this.sessionUser,
            current_role: "programmable_projector_runtime",
            configured_role: "programmable_projector_runtime",
          }] as unknown as Row[];
        }
        if (text.includes("try_acquire_projector_runtime_lease_v1")) {
          const requestedAt = new Date(String(values[2]));
          const acquiredAt = this.acquired
            ? new Date(requestedAt.valueOf() + 1)
            : new Date("2026-07-31T17:59:30.000Z");
          return [{
            acquired: this.acquired,
            lease_generation: "7",
            acquired_at: acquiredAt.toISOString(),
            expires_at: new Date(acquiredAt.valueOf() + 85_000).toISOString(),
          }] as unknown as Row[];
        }
        if (text.includes("release_projector_runtime_lease_v1")) {
          return [{ released: true }] as unknown as Row[];
        }
        return [] as unknown as Row[];
      },
    });
  }
}

describe("projector runtime lease controller", () => {
  it("assumes the narrow runtime role, acquires a fenced lease and releases it", async () => {
    const executor = new LeaseExecutor();
    const times = [
      new Date("2026-07-31T18:00:00.000Z"),
      new Date("2026-07-31T18:00:30.000Z"),
    ];
    const controller = createProjectorRuntimeLeaseController({
      executor,
      now: () => times.shift()!,
      uuid: () => "00000000-0000-4000-8000-000000000001",
      tokenHash: () => tokenHash,
    });

    const acquisition = await controller.tryAcquire();

    expect(acquisition).toMatchObject({
      status: "acquired",
      fence: {
        holderId:
          "projector-runtime-00000000-0000-4000-8000-000000000001",
        generation: "7",
        tokenHash,
      },
    });
    await expect(controller.release(acquisition.fence!)).resolves.toBe(true);
    expect(
      executor.queries.filter(({ text }) =>
        text === "set local role programmable_projector_runtime"
      ),
    ).toHaveLength(2);
  });

  it("returns busy without inventing a fence or releasing another holder", async () => {
    const executor = new LeaseExecutor();
    executor.acquired = false;
    const controller = createProjectorRuntimeLeaseController({
      executor,
      now: () => new Date("2026-07-31T18:00:00.000Z"),
      uuid: () => "00000000-0000-4000-8000-000000000001",
      tokenHash: () => tokenHash,
    });

    await expect(controller.tryAcquire()).resolves.toEqual({
      status: "busy",
      acquiredAt: "2026-07-31T17:59:30.000Z",
      expiresAt: "2026-07-31T18:00:55.000Z",
    });
    expect(
      executor.queries.some(({ text }) =>
        text.includes("release_projector_runtime_lease_v1")
      ),
    ).toBe(false);
  });

  it("fails closed before lease mutation under the wrong database login", async () => {
    const executor = new LeaseExecutor();
    executor.sessionUser = "programmable_projector_login";
    const controller = createProjectorRuntimeLeaseController({
      executor,
      now: () => new Date("2026-07-31T18:00:00.000Z"),
      uuid: () => "00000000-0000-4000-8000-000000000001",
      tokenHash: () => tokenHash,
    });

    await expect(controller.tryAcquire()).rejects.toThrow();
    expect(
      executor.queries.some(({ text }) =>
        text.includes("try_acquire_projector_runtime_lease_v1")
      ),
    ).toBe(false);
  });
});
