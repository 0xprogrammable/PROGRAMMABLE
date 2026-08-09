export const MANUAL_ROUTER_ALCHEMY_RPC_ENV_V1:
  "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL";
export const MANUAL_ROUTER_QUICKNODE_RPC_ENV_V1:
  "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL";
export const HOOKBUILDER_APPLICANT_1_1_PUBLIC_MAIN_BINDING_V1: Readonly<{
  schemaVersion: string;
  repository: string;
  commitSha: string;
  treeSha: string;
  schemaPath: string;
  schemaSha256: `sha256:${string}`;
  semanticCorePath: string;
  semanticCoreSha256: `sha256:${string}`;
  examplePath: string;
  exampleRawByteLength: number;
  exampleRawSha256: `sha256:${string}`;
  canonicalExampleByteLength: number;
  canonicalExampleSha256: `sha256:${string}`;
  requestPathTemplate: string;
  requestedRoute: Readonly<{
    routeId: string;
    routeVersion: string;
    chainId: string;
  }>;
}>;

export interface PortableManualRouterRpcV1 {
  collectCommonFinalizedAnchor(): Promise<Readonly<{
    blockNumber: `0x${string}`;
    blockHash: `0x${string}`;
    timestamp: string;
  }>>;
  observeChainClock(): Promise<Readonly<{
    minimumTimestamp: string;
    maximumTimestamp: string;
    providerTimestamps: readonly [string, string];
  }>>;
  readConsensus(method: string, params: readonly unknown[]): Promise<unknown>;
  ethCallConsensus(
    transaction: Readonly<Record<string, `0x${string}`>>,
    blockTag: string,
  ): Promise<`0x${string}`>;
}

export interface PortableManualRouterCompositionV1 {
  readonly github: Readonly<{
    verifyCurrentApproval(...args: readonly unknown[]): Promise<unknown>;
  }>;
  readonly rpc: PortableManualRouterRpcV1 & Readonly<Record<string, unknown>>;
}

export function createPortableManualRouterPublishAuthorityFromEnvV1(
  input: Readonly<{
    env: Readonly<Record<string, string | undefined>>;
    fetch: typeof fetch;
    githubReadToken?: string | null;
    nowEpochSeconds?: () => number;
  }>,
): Readonly<PortableManualRouterCompositionV1>;

export function assertPortableManualRouterCompleteSignedArtifactV1(
  raw: unknown,
): Readonly<Record<string, unknown>>;

export function assertPortableManualRouterSignedPublishRequestV1(
  raw: unknown,
): Readonly<Record<string, unknown>>;

export function verifyPortableManualRouterSignedPublishV1(input: Readonly<{
  composition: PortableManualRouterCompositionV1;
  request: unknown;
  currentApplicantIndex: unknown | null;
  currentApplicantPointers: readonly unknown[];
}>): Promise<Readonly<{
  request: Readonly<Record<string, unknown>>;
  nextPointer: unknown;
  nextApplicantIndex: unknown;
  idempotent: boolean;
}>>;

export function resolvePortableManualRouterReissueStateV1(input: Readonly<{
  composition: PortableManualRouterCompositionV1;
  request: unknown;
  currentApplicantIndex: unknown | null;
  currentApplicantPointers: readonly unknown[];
  currentStatus: string;
}>): Promise<Readonly<Record<string, unknown>>>;

export function assertPortableManualRouterOperatorPreparationV1(
  raw: unknown,
): Readonly<Record<string, unknown>>;

export class RouterLaunchTransactionRevertedError extends TypeError {
  readonly evidence: Readonly<Record<string, unknown>>;
}

export class RouterLaunchFinalityVerifierV1 {
  constructor(input: Readonly<{ rpc: PortableManualRouterRpcV1 }>);
  finalize(input: Readonly<{
    prepared: Readonly<Record<string, unknown>>;
    transactionHash: `0x${string}`;
  }>): Promise<Readonly<Record<string, unknown>>>;
}

export function assertFailedRouterLaunchTransactionEvidenceV1(
  raw: unknown,
  prepared: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>;
