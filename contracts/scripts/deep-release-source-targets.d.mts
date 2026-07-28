export type DeepReleaseSourceTarget = {
  field: string;
  address: unknown;
};

export function deepReleaseSourceTargets(
  release: {
    addresses: Record<string, unknown>;
    lifecycleEvidence?: {
      status?: unknown;
      keeperExecutor?: unknown;
    };
  },
  deployedFields: string[],
): DeepReleaseSourceTarget[];
