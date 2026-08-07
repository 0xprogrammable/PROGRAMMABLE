import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const verifier = join(repositoryRoot, "scripts", "verify-custom-registry-artifacts.mjs");
const contractNames = [
  "ProgrammableCustomRegistryV1",
  "ProgrammableCustomPartnerFactoryRegistryV1",
  "ProgrammableCustomFeePolicyVerifierV1",
  "ProgrammableCustomAtomicRegistrarV1",
  "ProgrammableCustomRegistryV2",
  "ProgrammableCustomPartnerFactoryRegistryV2",
  "ProgrammableCustomFeePolicyVerifierV2",
  "ProgrammableCustomExecutionPolicyRegistryV2",
  "ProgrammableCustomExecutionPolicyRevisionRegistryV2",
  "ProgrammableCustomAtomicRegistrarV2",
];

function fixture() {
  const target = mkdtempSync(join(tmpdir(), "programmable-custom-registry-artifacts-"));
  mkdirSync(join(target, "contracts", "out"), { recursive: true });
  mkdirSync(join(target, "contracts", "spec"), { recursive: true });
  cpSync(
    join(repositoryRoot, "contracts", "deployments"),
    join(target, "contracts", "deployments"),
    { recursive: true },
  );
  cpSync(join(repositoryRoot, "docs", "security"), join(target, "docs", "security"), {
    recursive: true,
  });
  cpSync(join(repositoryRoot, "contracts", "src"), join(target, "contracts", "src"), {
    recursive: true,
  });
  symlinkSync(join(repositoryRoot, "contracts", "lib"), join(target, "contracts", "lib"), "dir");
  for (const name of contractNames) {
    cpSync(
      join(repositoryRoot, "contracts", "out", `${name}.sol`),
      join(target, "contracts", "out", `${name}.sol`),
      { recursive: true },
    );
  }
  cpSync(
    join(repositoryRoot, "contracts", "spec", "custom-registry-generation-2-release-candidate.json"),
    join(target, "contracts", "spec", "custom-registry-generation-2-release-candidate.json"),
  );
  return target;
}

function verify(root) {
  return spawnSync(process.execPath, [verifier], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PROGRAMMABLE_CUSTOM_REGISTRY_ARTIFACT_ROOT: root,
    },
  });
}

function withFixture(run) {
  const root = fixture();
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertRejected(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, pattern);
}

test("accepts the exact frozen Generation 1 and Generation 2 artifact sets", () => {
  withFixture((root) => {
    const result = verify(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /6 Generation 2 Source\/Forge\/ABI bindings/u);
    assert.match(result.stdout, /29 Generation 2 event declarations/u);
  });
});

test("rejects a direct Generation 2 source mutation", () => {
  withFixture((root) => {
    const source = join(root, "contracts", "src", "ProgrammableCustomRegistryV2.sol");
    writeFileSync(source, `${readFileSync(source, "utf8")}\n// mutation\n`);
    assertRejected(verify(root), /stale for source|Source\/Forge artifact binding drift/u);
  });
});

test("rejects a stale Forge artifact after an inherited source mutation", () => {
  withFixture((root) => {
    const source = join(root, "contracts", "src", "ProgrammableCustomRegistryV1.sol");
    writeFileSync(source, `${readFileSync(source, "utf8")}\n// inherited mutation\n`);
    assertRejected(verify(root), /Forge artifact is stale for source/u);
  });
});

test("rejects a published Generation 2 ABI byte mutation", () => {
  withFixture((root) => {
    const abi = join(root, "docs", "security", "abi", "ProgrammableCustomRegistryV2.json");
    writeFileSync(abi, `${readFileSync(abi, "utf8")}\n`);
    assertRejected(verify(root), /published artifact file hash drift/u);
  });
});

test("rejects a Forge creation-code mutation even when its ABI is unchanged", () => {
  withFixture((root) => {
    const artifactPath = join(
      root,
      "contracts",
      "out",
      "ProgrammableCustomAtomicRegistrarV2.sol",
      "ProgrammableCustomAtomicRegistrarV2.json",
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const tail = artifact.bytecode.object.at(-1);
    artifact.bytecode.object = `${artifact.bytecode.object.slice(0, -1)}${tail === "0" ? "1" : "0"}`;
    writeFileSync(artifactPath, JSON.stringify(artifact));
    assertRejected(verify(root), /Source\/Forge artifact binding drift/u);
  });
});

test("accepts compiler-local immutable AST id renumbering", () => {
  withFixture((root) => {
    const artifactPath = join(
      root,
      "contracts",
      "out",
      "ProgrammableCustomRegistryV2.sol",
      "ProgrammableCustomRegistryV2.json",
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const renumbered = {};
    for (const [key, entries] of Object.entries(artifact.deployedBytecode.immutableReferences)) {
      renumbered[String(Number(key) + 1_000_000)] = entries;
    }
    artifact.deployedBytecode.immutableReferences = renumbered;
    writeFileSync(artifactPath, JSON.stringify(artifact));
    const result = verify(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("rejects an immutable runtime offset mutation", () => {
  withFixture((root) => {
    const artifactPath = join(
      root,
      "contracts",
      "out",
      "ProgrammableCustomRegistryV2.sol",
      "ProgrammableCustomRegistryV2.json",
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const firstGroup = Object.values(artifact.deployedBytecode.immutableReferences)[0];
    firstGroup[0].start += 1;
    writeFileSync(artifactPath, JSON.stringify(artifact));
    assertRejected(verify(root), /Source\/Forge artifact binding drift/u);
  });
});

test("rejects any Generation 2 event-set byte or semantic declaration mutation", () => {
  withFixture((root) => {
    const eventSetPath = join(root, "docs", "security", "CUSTOM_REGISTRY_EVENT_SET_V2.json");
    const eventSet = JSON.parse(readFileSync(eventSetPath, "utf8"));
    eventSet.events[0].topic0 = eventSet.events[1].topic0;
    writeFileSync(eventSetPath, `${JSON.stringify(eventSet, null, 2)}\n`);
    assertRejected(verify(root), /published artifact file hash drift/u);
  });
});

test("rejects a missing Generation 2 revision artifact", () => {
  withFixture((root) => {
    rmSync(
      join(root, "contracts", "out", "ProgrammableCustomExecutionPolicyRevisionRegistryV2.sol"),
      { recursive: true, force: true },
    );
    assertRejected(verify(root), /ENOENT|RevisionRegistryV2/u);
  });
});

test("rejects a revision event mapped to the atomic registrar", () => {
  withFixture((root) => {
    const eventSetPath = join(root, "docs", "security", "CUSTOM_REGISTRY_EVENT_SET_V2.json");
    const eventSet = JSON.parse(readFileSync(eventSetPath, "utf8"));
    const revisionEvent = eventSet.events.find(
      (event) => event.emitter === "executionPolicyRevisionRegistry",
    );
    revisionEvent.emitter = "atomicRegistrar";
    writeFileSync(eventSetPath, `${JSON.stringify(eventSet, null, 2)}\n`);
    assertRejected(verify(root), /published artifact file hash drift|event/u);
  });
});

test("rejects duplicate emitter-topic rows", () => {
  withFixture((root) => {
    const eventSetPath = join(root, "docs", "security", "CUSTOM_REGISTRY_EVENT_SET_V2.json");
    const eventSet = JSON.parse(readFileSync(eventSetPath, "utf8"));
    eventSet.events.push({ ...eventSet.events[0], id: "duplicate" });
    writeFileSync(eventSetPath, `${JSON.stringify(eventSet, null, 2)}\n`);
    assertRejected(verify(root), /published artifact file hash drift|duplicate/u);
  });
});

test("rejects inherited revision ABI declarations as Revision Registry emitters", () => {
  withFixture((root) => {
    const eventSetPath = join(root, "docs", "security", "CUSTOM_REGISTRY_EVENT_SET_V2.json");
    const eventSet = JSON.parse(readFileSync(eventSetPath, "utf8"));
    const initialPolicyEvent = eventSet.events.find(
      (event) => event.emitter === "executionPolicyRegistry"
        && event.signature.startsWith("CustomLaunchExecutionPolicyBoundV2("),
    );
    eventSet.events.push({
      ...initialPolicyEvent,
      emitter: "executionPolicyRevisionRegistry",
      id: "interface-only-non-emitter",
    });
    writeFileSync(eventSetPath, `${JSON.stringify(eventSet, null, 2)}\n`);
    assertRejected(verify(root), /published artifact file hash drift|absent from the built ABIs/u);
  });
});

test("rejects a Generation 2 trade-capability golden-vector semantic mutation", () => {
  withFixture((root) => {
    const vectorsPath = join(
      root,
      "docs",
      "security",
      "CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json",
    );
    const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));
    vectors.hashes.capabilityHash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    writeFileSync(vectorsPath, `${JSON.stringify(vectors, null, 2)}\n`);
    assertRejected(verify(root), /published artifact file hash drift|golden-vector semantic drift/u);
  });
});

test("rejects decimal-as-hex drift inside the nested proxy source preimage", () => {
  withFixture((root) => {
    const vectorsPath = join(
      root,
      "docs",
      "security",
      "CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json",
    );
    const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));
    vectors.preimages.proxySource.proxyBindingEvidenceHash =
      "0x0000000000000000000000000000000000000000000000000000000000000209";
    vectors.preimages.proxySource.proxyPolicyHash =
      "0x0000000000000000000000000000000000000000000000000000000000000210";
    writeFileSync(vectorsPath, `${JSON.stringify(vectors, null, 2)}\n`);
    assertRejected(
      verify(root),
      /published artifact file hash drift|golden roundtrip drift at proxySourceHash/u,
    );
  });
});

test("rejects a nested child mutation even when its supplied parent hashes remain frozen", () => {
  withFixture((root) => {
    const vectorsPath = join(
      root,
      "docs",
      "security",
      "CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json",
    );
    const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));
    vectors.preimages.capability.marketDataSources[1].proxyPolicyHash =
      "0x0000000000000000000000000000000000000000000000000000000000000210";
    writeFileSync(vectorsPath, `${JSON.stringify(vectors, null, 2)}\n`);
    assertRejected(
      verify(root),
      /published artifact file hash drift|golden roundtrip drift at capability.marketDataSources/u,
    );
  });
});

test("rejects event launchId topics that are not derived from the capability launchId", () => {
  withFixture((root) => {
    const vectorsPath = join(
      root,
      "docs",
      "security",
      "CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json",
    );
    const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));
    for (const event of Object.values(vectors.events)) {
      event.topics[1] =
        "0x0000000000000000000000000000000000000000000000000000000000000300";
    }
    writeFileSync(vectorsPath, `${JSON.stringify(vectors, null, 2)}\n`);
    assertRejected(
      verify(root),
      /published artifact file hash drift|golden roundtrip drift at events\.summary\.topics/u,
    );
  });
});

test("rejects a market-event preimage mutation", () => {
  withFixture((root) => {
    const vectorsPath = join(
      root,
      "docs",
      "security",
      "CUSTOM_REGISTRY_TRADE_CAPABILITY_V1_GOLDEN_VECTORS.json",
    );
    const vectors = JSON.parse(readFileSync(vectorsPath, "utf8"));
    vectors.preimages.marketEventAbi.eventSignature = "Fake(bytes32)";
    writeFileSync(vectorsPath, `${JSON.stringify(vectors, null, 2)}\n`);
    assertRejected(verify(root), /published artifact file hash drift|golden-vector semantic drift/u);
  });
});

test("rejects an unreviewed Generation 2 release artifact-set commitment", () => {
  withFixture((root) => {
    const manifestPath = join(
      root,
      "contracts",
      "spec",
      "custom-registry-generation-2-release-candidate.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.release.artifactSetHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assertRejected(verify(root), /release-candidate manifest(?: file hash)? drift/u);
  });
});
