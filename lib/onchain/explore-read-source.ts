import type { DurableExploreRead } from "./durable-model";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "./types";

type ReadyExploreModel = Extract<ExploreReadModel, { status: "ready" }>;

export type ExploreReadSourceDependencies = {
  readDurable: (
    config: ReadyOnchainDeployment,
  ) => Promise<DurableExploreRead>;
  selectFreshDurable: (
    read: DurableExploreRead,
  ) => ReadyExploreModel | null;
  readLive: (
    config: ReadyOnchainDeployment,
  ) => Promise<ExploreReadModel>;
  enrichWithUsd: (
    model: ExploreReadModel,
    config: ReadyOnchainDeployment,
  ) => Promise<ExploreReadModel>;
  warn: (message: string, detail: unknown) => void;
  error: (message: string, cause: unknown) => void;
};

async function enrichOrReturn(
  model: ExploreReadModel,
  config: ReadyOnchainDeployment,
  dependencies: ExploreReadSourceDependencies,
): Promise<ExploreReadModel> {
  try {
    return await dependencies.enrichWithUsd(model, config);
  } catch (cause) {
    dependencies.error("ETH/USD enrichment failed", {
      name: cause instanceof Error ? cause.name : "UnknownError",
    });
    return model;
  }
}

export async function resolveExploreReadSource(
  config: ReadyOnchainDeployment,
  dependencies: ExploreReadSourceDependencies,
): Promise<ExploreReadModel> {
  if (config.environment === "production") {
    const durable = await dependencies.readDurable(config);
    const durableModel = dependencies.selectFreshDurable(durable);
    if (durableModel) {
      return enrichOrReturn(durableModel, config, dependencies);
    }
    if (durable.status === "unavailable") {
      if (durable.reason === "stale") {
        dependencies.warn(
          "Durable Explore index is stale; serving the last verified snapshot",
          {
            reason: durable.reason,
            ageSeconds: Math.floor(durable.ageMs / 1_000),
          },
        );
        return durable.envelope.payload.model;
      }
      dependencies.warn(
        "Durable Explore index unavailable; using live RPCs",
        { reason: durable.reason, detail: durable.detail },
      );
    }
  }

  const liveModel = await dependencies.readLive(config);
  return enrichOrReturn(liveModel, config, dependencies);
}
