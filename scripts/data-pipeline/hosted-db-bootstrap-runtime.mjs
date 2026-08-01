import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

import { buildBootstrapPlan, sha256 } from "./hosted-db-operator-core.mjs";

const workspace = fileURLToPath(new URL("../../", import.meta.url));

export async function createBootstrapPlan({ repositoryCommit, environment }) {
  const bindingBytes = await readFile(
    new URL("../../config/data-pipeline-release.v1.json", import.meta.url),
  );
  const vite = await createServer({
    root: workspace,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    ssr: { noExternal: ["server-only"] },
    plugins: [
      {
        name: "hosted-db-operator-server-only-boundary",
        enforce: "pre",
        resolveId(id) {
          return id === "server-only" ? "\0operator-server-only" : null;
        },
        load(id) {
          return id === "\0operator-server-only" ? "export {};" : null;
        },
      },
    ],
  });
  try {
    const [releaseModule, commitmentModule, rpcModule, marketModule] =
      await Promise.all([
        vite.ssrLoadModule("/lib/data-pipeline/release-binding.server.ts"),
        vite.ssrLoadModule(
          "/lib/data-pipeline/projector-provider-commitments.ts",
        ),
        vite.ssrLoadModule("/lib/data-pipeline/rpc-providers.server.ts"),
        vite.ssrLoadModule(
          "/lib/data-pipeline/market-projector-runtime.server.ts",
        ),
      ]);
    const binding = releaseModule.getDataPipelineReleaseBinding();
    const expectedEnvioIdentity = `envio:${binding.envio.deploymentLabel}`;
    const configuredEnvioIdentity =
      environment.PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY ??
      expectedEnvioIdentity;
    if (configuredEnvioIdentity !== expectedEnvioIdentity) {
      throw new Error("Envio identity does not match the release binding");
    }
    const envioEndpoint = commitmentModule.canonicalProjectorEnvioEndpoint(
      environment.PROGRAMMABLE_ENVIO_GRAPHQL_URL ??
        binding.envio.graphqlEndpoint,
      binding.envio.graphqlEndpoint,
    );
    const rpcProviders = rpcModule.createProductionDualRpcProviders(environment);
    const rpcCommitments = rpcModule.productionRpcProjectorCommitments(environment);
    const graphIdentity =
      `uniswap-v4:ethereum:${binding.uniswapV4Subgraph.deployment}`;
    const providers = [
      {
        providerType: "envio_deployment",
        redactedIdentity: expectedEnvioIdentity,
        deploymentCommitment:
          commitmentModule.projectorEnvioDeploymentCommitment({
            endpoint: envioEndpoint,
            redactedIdentity: expectedEnvioIdentity,
            binding,
          }),
        schemaCommitment:
          commitmentModule.projectorEnvioSchemaCommitment(binding),
      },
      ...rpcProviders.map((provider) => ({
        providerType: "rpc_provider",
        redactedIdentity: provider.identity,
        vendor: provider.vendorGroup,
        chainId: 1,
        constructorVersion: "rpc-provider-v1",
        endpointUrlCommitment: provider.endpointCommitment,
        endpointOriginCommitment: provider.endpointOriginCommitment,
        endpointEvidenceDomain: "rpc-endpoint-commitments-v1",
        deploymentCommitment:
          rpcCommitments[provider.vendorGroup].deploymentCommitment,
        schemaCommitment:
          rpcCommitments[provider.vendorGroup].schemaCommitment,
      })),
      {
        providerType: "uniswap_subgraph",
        redactedIdentity: graphIdentity,
        deploymentCommitment:
          marketModule.MARKET_GRAPH_DEPLOYMENT_COMMITMENT,
        schemaCommitment: marketModule.MARKET_GRAPH_SCHEMA_COMMITMENT,
        subgraphId: binding.uniswapV4Subgraph.subgraphId,
        deployment: binding.uniswapV4Subgraph.deployment,
      },
    ];
    return buildBootstrapPlan({
      binding,
      bindingSha256: sha256(bindingBytes),
      repositoryCommit,
      providers,
    });
  } finally {
    await vite.close();
  }
}
