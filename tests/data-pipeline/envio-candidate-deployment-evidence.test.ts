import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const evidencePath = resolve(
  "docs/data-pipeline/envio-candidate-7f24e63-deployment-7ffd15c.json",
);

async function readJson(path: string) {
  return JSON.parse(await readFile(resolve(path), "utf8")) as Record<
    string,
    unknown
  >;
}

async function fileSha256(path: string) {
  const bytes = await readFile(resolve(path));
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("Envio candidate deployment evidence", () => {
  it("contains public chain evidence without service credentials", async () => {
    const baseline = await readJson(
      "docs/data-pipeline/envio-candidate-7f24e63-baseline-20260801T042058Z.json",
    );
    const audit = await readJson(
      "docs/data-pipeline/envio-candidate-7f24e63-audit-20260801T042059Z.json",
    );
    const serialized = JSON.stringify({ baseline, audit }).toLowerCase();

    for (const forbidden of [
      "alchemy.com",
      "quiknode.pro",
      "supabase.co",
      "api_key",
      "apikey",
      "authorization",
      "bearer ",
      "privatekey",
      "mnemonic",
      "password",
      "secret",
      "token=",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(baseline.endpoint).toBe(
      "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
    );
    expect(audit.endpoint).toBe(
      "https://indexer.hyperindex.xyz/d7a39a2/v1/graphql",
    );
  });

  it("binds the paired baseline and audit to one exact checkpoint", async () => {
    const evidence = await readJson(evidencePath);
    const artifacts = evidence.artifacts as Record<
      string,
      Record<string, string | number>
    >;
    const baseline = await readJson(String(artifacts.baseline.path));
    const audit = await readJson(String(artifacts.candidateAudit.path));
    const identity = await readJson(String(artifacts.identity.path));

    await expect(fileSha256(String(artifacts.baseline.path))).resolves.toBe(
      artifacts.baseline.fileSha256,
    );
    await expect(
      fileSha256(String(artifacts.candidateAudit.path)),
    ).resolves.toBe(artifacts.candidateAudit.fileSha256);
    await expect(fileSha256(String(artifacts.identity.path))).resolves.toBe(
      artifacts.identity.fileSha256,
    );

    expect(baseline.digest).toBe(artifacts.baseline.internalDigest);
    expect(audit.digest).toBe(artifacts.candidateAudit.internalDigest);
    expect(baseline.anchor).toEqual(audit.anchor);
    expect(audit.anchor).toEqual(evidence.checkpoint);
    expect(audit.identity).toEqual(identity);
    expect(
      (audit.authenticatedCoordinatorCreatorRepairs as unknown[]).length,
    ).toBe(artifacts.candidateAudit.authenticatedCoordinatorCreatorRepairs);
  });

  it("preserves historical pre-promotion evidence after the canonical release advances", async () => {
    const evidence = await readJson(evidencePath);
    const prepared = evidence.historicalPreparation as Record<string, unknown>;
    const candidate = evidence.candidate as Record<string, unknown>;
    const active = evidence.activeProduction as Record<string, unknown>;
    const rollback = evidence.rollback as Record<string, unknown>;
    const promotion = evidence.promotion as Record<string, unknown>;
    const binding = await readJson("config/data-pipeline-release.v1.json");
    const envio = binding.envio as Record<string, unknown>;

    await expect(fileSha256(String(prepared.path))).resolves.toBe(
      prepared.fileSha256,
    );
    expect(prepared.preservedUnchanged).toBe(true);
    expect(candidate.promoted).toBe(false);
    expect(candidate.controlPlaneStatus).toBe("none");
    expect(promotion.state).toBe("not-promoted");
    expect(promotion.productionBindingMayChange).toBe(false);
    expect(active.deploymentLabel).toBe(rollback.deployment);
    expect(active.endpoint).toBe(rollback.graphqlEndpoint);
    expect(active.sourceCommit).toBe(rollback.sourceCommit);
    expect(envio).toMatchObject({
      deploymentLabel: "production-92f6373",
      graphqlEndpoint: "https://indexer.hyperindex.xyz/f6714ef/v1/graphql",
      sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
      eventCount: 66,
    });
    expect(envio.deploymentLabel).not.toBe(candidate.deploymentLabel);
    expect(envio.sourceCommit).not.toBe(
      (candidate.identity as Record<string, unknown>).sourceCommit,
    );
  });

  it("records inventory, repairs and the rejected deployment explicitly", async () => {
    const evidence = await readJson(evidencePath);
    const inventory = evidence.inventory as Record<string, unknown>;
    const rejected = evidence.nonPromotableDeployments as Array<
      Record<string, unknown>
    >;

    expect(inventory).toEqual({
      count: 265,
      perRelease: {
        "classic-v2": 27,
        "classic-v3": 186,
        "stock-paired-v1": 1,
        "stock-paired-v2": 8,
        "stock-paired-v3": 43,
      },
    });
    expect(rejected).toEqual([
      expect.objectContaining({
        mirrorCommit: "6f2f408e137ce3c01450a13ed11f477ae4ac7240",
        promotable: false,
        rejection: "candidate IndexerState.sourceCommit is invalid",
      }),
    ]);
  });
});
