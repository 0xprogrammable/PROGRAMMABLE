import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import { armRealBlockSlaProviderRetryOnce } from "../../lib/data-pipeline/read-model-real-block-sla-capture.server";

const DEPLOYMENT = Object.freeze({
  repositoryCommit: "a".repeat(40),
  deploymentId: "dpl_0123456789abcdefghij",
  deploymentOrigin: "https://programmable-stage.vercel.app",
  projectId: "prj_programmable",
});

class ArmExecutor implements PostgresExecutor {
  readonly close = vi.fn(async () => undefined);
  readonly queries: Array<{
    text: string;
    values: readonly PostgresParameter[];
  }> = [];

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
          return [{
            session_user: "programmable_projector_runtime_login",
          }] as unknown as Row[];
        }
        if (text.includes("current_role::text as current_role")) {
          return [{
            session_user: "programmable_projector_runtime_login",
            current_role: "programmable_projector_runtime",
          }] as unknown as Row[];
        }
        if (text.includes("arm_real_block_sla_provider_retry_once_v1")) {
          return [{
            arm_id: "00000000-0000-4000-8000-000000000019",
          }] as unknown as Row[];
        }
        return [] as unknown as Row[];
      },
    });
  }
}

describe("real-block SLA provider retry arm adapter", () => {
  it("binds the one-shot arm to the exact staged deployment and stream", async () => {
    const executor = new ArmExecutor();

    await expect(armRealBlockSlaProviderRetryOnce({
      executor,
      deployment: DEPLOYMENT,
      streamId: "programmable-mainnet-head",
    })).resolves.toBe("00000000-0000-4000-8000-000000000019");

    const arm = executor.queries.find(({ text }) =>
      text.includes("arm_real_block_sla_provider_retry_once_v1")
    );
    expect(arm?.values).toEqual([
      DEPLOYMENT.repositoryCommit,
      DEPLOYMENT.deploymentId,
      DEPLOYMENT.deploymentOrigin,
      DEPLOYMENT.projectId,
      "programmable-mainnet-head",
    ]);
  });

  it("rejects an invalid stream before opening the arm transaction", async () => {
    const executor = new ArmExecutor();
    await expect(armRealBlockSlaProviderRetryOnce({
      executor,
      deployment: DEPLOYMENT,
      streamId: "not a stream",
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(executor.queries).toHaveLength(0);
  });
});
