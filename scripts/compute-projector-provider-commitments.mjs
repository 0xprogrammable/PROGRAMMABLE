import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const binding = JSON.parse(
  await readFile(
    new URL("../config/data-pipeline-release.v1.json", import.meta.url),
    "utf8",
  ),
);
const vite = await createServer({
  root: workspace,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
  ssr: { noExternal: ["server-only"] },
  plugins: [{
    name: "projector-commitment-server-only-boundary",
    enforce: "pre",
    resolveId(id) {
      return id === "server-only" ? "\0projector-server-only" : null;
    },
    load(id) {
      return id === "\0projector-server-only" ? "export {};" : null;
    },
  }],
});

try {
  const commitments = await vite.ssrLoadModule(
    "/lib/data-pipeline/projector-provider-commitments.ts",
  );
  const drpc = commitments.canonicalProjectorRpcEndpoint(
    process.env.PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL,
    "drpc",
  );
  const quicknode = commitments.canonicalProjectorRpcEndpoint(
    process.env.PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL,
    "quicknode",
  );
  const envioEndpoint = commitments.canonicalProjectorEnvioEndpoint(
    process.env.PROGRAMMABLE_ENVIO_GRAPHQL_URL,
    binding.envio.graphqlEndpoint,
  );
  const expectedEnvioIdentity = `envio:${binding.envio.deploymentLabel}`;
  const envioIdentity =
    process.env.PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY ??
    expectedEnvioIdentity;
  if (envioIdentity !== expectedEnvioIdentity) {
    throw new Error("Envio identity does not match the reviewed release binding");
  }
  const rpcSchema = commitments.projectorRpcSchemaCommitment();
  const output = {
    envioDeploymentCommitment:
      commitments.projectorEnvioDeploymentCommitment({
        endpoint: envioEndpoint,
        redactedIdentity: envioIdentity,
        binding,
      }),
    envioSchemaCommitment:
      commitments.projectorEnvioSchemaCommitment(binding),
    drpcDeploymentCommitment:
      commitments.projectorRpcDeploymentCommitment(drpc),
    drpcSchemaCommitment: rpcSchema,
    quicknodeDeploymentCommitment:
      commitments.projectorRpcDeploymentCommitment(quicknode),
    quicknodeSchemaCommitment: rpcSchema,
  };
  for (const [name, value] of Object.entries(output)) {
    process.stdout.write(`${name}=${value}\n`);
  }
} finally {
  await vite.close();
}
