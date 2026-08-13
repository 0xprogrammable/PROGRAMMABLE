import "server-only";

import { invalidInput } from "./errors";
import type { PostgresExecutor } from "./postgres";
import type { DataPipelineReleaseBinding } from "./release-binding.server";

type Environment = Readonly<Record<string, string | undefined>>;

const CURRENT_PRODUCTION = Object.freeze({
  deploymentLabel: "production-92f6373",
  endpoint: "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
  redactedIdentity: "envio:production-92f6373",
  sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
  mirrorCommit: "0a064ec0a32a0e48bf6751fa18f025504267c6b7",
  configSha256:
    "0x133099a107e8d9c91aea1f0e811dbcc179fae8cf35919e612df7139deab3ee6a",
  schemaSha256:
    "0xdf3d65e033e96d7ebbe62b6f114b6a30f10c8944e5c6fca6b020c3130bb738c0",
  handlerSha256:
    "0xa14f0d3bd93d8be1b329467786b40dd465ce71751298fb04a6b97886a1a781fe",
  sourceRegistrySha256:
    "0x7bad14df06e48c8fb0a439bd17b26c2949c475a7c5b58507e5f8514bf92d605a",
  eventSetSha256:
    "0xe5a88608068d4c84582cc63de55cbf386fa7f36b201722a39164eb4af61de95f",
  eventCount: 66,
} as const);

function invalidRuntimeBinding(): never {
  throw invalidInput("config", "projector-runtime-binding");
}

export type CandidateProjectorRuntimeBinding = never;

export type CandidateDatabasePromotionBinding = Readonly<{
  providerDeploymentId: string;
  deploymentCommitment: `0x${string}`;
  schemaCommitment: `0x${string}`;
  initializationInputCommitment: `0x${string}`;
  initializedAt: string;
  productCommit: string;
  stagedDeploymentId: string;
}>;

export type DatabasePhysicalIdentity = Readonly<{
  databaseName: string;
  systemIdentifier: string;
}>;

export type ProjectorRuntimeBindingSelection = Readonly<{
  mode: "release";
  releaseBinding: DataPipelineReleaseBinding;
  candidate: null;
  promotedDatabase: null;
}>;

function isExactCurrentProductionReleaseBinding(
  binding: DataPipelineReleaseBinding,
): boolean {
  const envio = binding.envio;
  return (
    envio.deploymentLabel === CURRENT_PRODUCTION.deploymentLabel &&
    envio.graphqlEndpoint === CURRENT_PRODUCTION.endpoint &&
    envio.schemaVersion === "1" &&
    envio.sourceCommit === CURRENT_PRODUCTION.sourceCommit &&
    envio.configSha256 === CURRENT_PRODUCTION.configSha256 &&
    envio.schemaSha256 === CURRENT_PRODUCTION.schemaSha256 &&
    envio.handlerSha256 === CURRENT_PRODUCTION.handlerSha256 &&
    envio.sourceRegistrySha256 === CURRENT_PRODUCTION.sourceRegistrySha256 &&
    envio.eventSetSha256 === CURRENT_PRODUCTION.eventSetSha256 &&
    envio.eventCount === CURRENT_PRODUCTION.eventCount
  );
}

/** The former candidate binding is historical evidence and cannot execute. */
export function loadCandidateProjectorRuntimeBinding(): never {
  throw invalidInput("config", "retired-candidate-projector-runtime-binding");
}

export function selectProjectorRuntimeBinding(input: Readonly<{
  env: Environment;
  canonicalBinding: DataPipelineReleaseBinding;
}>): ProjectorRuntimeBindingSelection {
  const mode = input.env.PROGRAMMABLE_PROJECTOR_BINDING_MODE;
  if (
    (mode !== undefined && mode !== "" && mode !== "release") ||
    !isExactCurrentProductionReleaseBinding(input.canonicalBinding) ||
    input.env.PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT !==
      CURRENT_PRODUCTION.mirrorCommit ||
    input.env.PROGRAMMABLE_ENVIO_GRAPHQL_URL !== CURRENT_PRODUCTION.endpoint ||
    input.env.PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY !==
      CURRENT_PRODUCTION.redactedIdentity
  ) {
    return invalidRuntimeBinding();
  }
  return Object.freeze({
    mode: "release" as const,
    releaseBinding: input.canonicalBinding,
    candidate: null,
    promotedDatabase: null,
  });
}

/** No historical candidate database assertion remains executable. */
export async function assertCandidateDatabaseBootstrapState(_input?: Readonly<{
  executor: PostgresExecutor;
  binding: CandidateProjectorRuntimeBinding;
}>): Promise<never> {
  void _input;
  return invalidRuntimeBinding();
}

/** A fresh current-release database authority is required before activation. */
export async function assertCandidateDatabasePromotedState(_input: Readonly<{
  executor: PostgresExecutor;
  binding: CandidateDatabasePromotionBinding;
}>): Promise<DatabasePhysicalIdentity> {
  void _input;
  return invalidRuntimeBinding();
}
