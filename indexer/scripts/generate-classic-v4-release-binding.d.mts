export type ClassicV4ReleaseBinding = Readonly<Record<string, unknown>>;

export function buildClassicV4ExpandedReleaseBinding(
  plan: unknown,
  baseBinding: unknown,
  candidateIdentity: unknown,
  graphqlEndpoint: string,
): ClassicV4ReleaseBinding;

export function assertClassicV4IndexerSourceBindings(
  plan: unknown,
  current: Readonly<{
    releaseMap: string;
    envioConfig: string;
  }>,
): void;

export function writeClassicV4ReleaseBinding(
  filename: string,
  releaseBinding: unknown,
): Promise<void>;

export function main(argv?: readonly string[]): Promise<void>;
