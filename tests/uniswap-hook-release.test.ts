import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { getAddress, keccak256 } from "viem";

import {
  EMPTY_STORAGE_WORD,
  buildUniswapHookRelease,
  decodeHookPermissions,
  inspectLiveHook,
  loadSoliditySourceClosure,
  validateHookPermissionDependencies,
  writeUniswapHookRelease,
} from "../scripts/uniswap-hook-release-core.mjs";
import type {
  HookMetadata,
  HookRuntimeEvidence,
} from "../scripts/uniswap-hook-release-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const classicManifestPath = path.join(
  root,
  "contracts",
  "deployments",
  "mainnet-classic-v2.json",
);
const deepV1ManifestPath = path.join(
  root,
  "contracts",
  "deployments",
  "mainnet-deep-full-range-v1.json",
);
const classicSourcePath = path.join(
  root,
  "contracts",
  "src",
  "EthCreatorFeeHookV1.sol",
);
const deepSourcePath = path.join(
  root,
  "contracts",
  "src",
  "LiquidityGrowthFeeOracleHookV1.sol",
);

function readJson(file: string) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function metadata(sourcePath: string): HookMetadata {
  return {
    name: "Programmable Fee Hook",
    description:
      "A shared Uniswap v4 hook for immutable native asset swap fees.",
    auditUrl: "",
    sourcePath,
    properties: {
      dynamicFee: false,
      requiresCustomSwapData: false,
      vanillaSwap: false,
      swapAccess: "none",
    },
  };
}

function zeroProxySlots() {
  return {
    implementation: EMPTY_STORAGE_WORD,
    admin: EMPTY_STORAGE_WORD,
    beacon: EMPTY_STORAGE_WORD,
  };
}

function runtimeEvidence(manifest: {
  addresses: { feeHook: string };
  runtimeCodeHashes: { feeHook: string };
  deploymentEvidence?: { feeHook?: { blockNumber?: number } };
  transactions?: { feeHook?: { blockNumber?: number } };
}): HookRuntimeEvidence {
  const observedAtBlock =
    manifest.deploymentEvidence?.feeHook?.blockNumber ??
    manifest.transactions?.feeHook?.blockNumber;
  if (!observedAtBlock) throw new Error("Fixture deployment block is missing");
  return {
    chainId: 1,
    hookAddress: manifest.addresses.feeHook,
    runtimeCodeHash:
      manifest.runtimeCodeHashes.feeHook as `0x${string}`,
    observedAtBlock,
    eip1967Slots: zeroProxySlots(),
    minimalProxy: false,
    runtimeDelegatecall: false,
  };
}

function promotedDeepV2Manifest() {
  const manifest = structuredClone(readJson(deepV1ManifestPath));
  manifest.releaseVersion = "deep-full-range-v2";
  manifest.internalContractRelease = "liquidity-growth-full-range-v2";
  manifest.status = "deployment-source-and-lifecycle-verified";
  manifest.releaseEligible = true;
  manifest.activation = {
    appStatus: "ready",
    keeperStatus: "ready",
    requiresExactManifestMatch: true,
  };
  manifest.lifecycleEvidence = {
    ...manifest.lifecycleEvidence,
    status: "verified-current-release",
    releaseEligible: true,
    requiredRelease: "deep-full-range-v2",
    independentRpcCount: 2,
    oracleTransaction: `0x${"11".repeat(32)}`,
    feeProcessCompoundTransaction: `0x${"22".repeat(32)}`,
  };
  manifest.blockers = [];
  return manifest;
}

describe("Uniswap v4 hook permission decoding", () => {
  it("decodes all fourteen address permission bits with official field names", () => {
    expect(
      decodeHookPermissions(
        "0x0000000000000000000000000000000000003fff",
      ),
    ).toEqual({
      beforeInitialize: true,
      afterInitialize: true,
      beforeAddLiquidity: true,
      afterAddLiquidity: true,
      beforeRemoveLiquidity: true,
      afterRemoveLiquidity: true,
      beforeSwap: true,
      afterSwap: true,
      beforeDonate: true,
      afterDonate: true,
      beforeSwapReturnsDelta: true,
      afterSwapReturnsDelta: true,
      afterAddLiquidityReturnsDelta: true,
      afterRemoveLiquidityReturnsDelta: true,
    });
  });

  it("rejects return-delta flags without their parent hook permission", () => {
    expect(() =>
      validateHookPermissionDependencies({
        ...decodeHookPermissions(
          "0x0000000000000000000000000000000000000000",
        ),
        beforeSwapReturnsDelta: true,
      }),
    ).toThrow("beforeSwapReturnsDelta requires beforeSwap");
  });
});

describe("Uniswap hook release gate", () => {
  it("accepts the verified live Classic manifest and matches source permissions", () => {
    const manifest = readJson(classicManifestPath);
    const release = buildUniswapHookRelease({
      manifest,
      manifestPath: classicManifestPath,
      sourceText: readFileSync(classicSourcePath, "utf8"),
      metadata: metadata(classicSourcePath),
      runtimeEvidence: runtimeEvidence(manifest),
    });

    expect(release.hooklist.entry.hook).toMatchObject({
      address: manifest.addresses.feeHook,
      chain: "ethereum",
      chainId: 1,
      verifiedSource: true,
    });
    expect(release.hooklist.entry.flags).toMatchObject({
      beforeInitialize: true,
      afterInitialize: false,
      beforeSwap: true,
      afterSwap: true,
      beforeSwapReturnsDelta: true,
      afterSwapReturnsDelta: true,
    });
    expect(release.hooklist.issueJson.repository).toBe("Uniswap/hooklist");
    expect(release.hooklist.issueMarkdown).toContain("## Hook Address");
  });

  it("preserves Deep V1 as canary history instead of treating it as releasable", () => {
    const manifest = readJson(deepV1ManifestPath);
    expect(() =>
      buildUniswapHookRelease({
        manifest,
        manifestPath: deepV1ManifestPath,
        sourceText: readFileSync(deepSourcePath, "utf8"),
        metadata: metadata(deepSourcePath),
        runtimeEvidence: runtimeEvidence(manifest),
      }),
    ).toThrow("releaseEligible must be true");
  });

  it("supports a future Deep V2 after the same live release gates pass", () => {
    const manifest = promotedDeepV2Manifest();
    const release = buildUniswapHookRelease({
      manifest,
      manifestPath:
        "contracts/deployments/mainnet-deep-full-range-v2.json",
      sourceText: readFileSync(deepSourcePath, "utf8"),
      metadata: metadata(deepSourcePath),
      runtimeEvidence: runtimeEvidence(manifest),
    });

    expect(release.evidence.releaseId).toBe("deep-full-range-v2");
    expect(release.hooklist.entry.flags.afterInitialize).toBe(true);
    expect(release.routingAllowlist.submissionStatus).toBe("not-submitted");
  });

  it("requires exact Etherscan and Sourcify verification independently", () => {
    const noEtherscan = promotedDeepV2Manifest();
    noEtherscan.sourceVerification.contracts.feeHook.etherscan.status =
      "not-submitted";
    expect(() =>
      buildUniswapHookRelease({
        manifest: noEtherscan,
        manifestPath:
          "contracts/deployments/mainnet-deep-full-range-v2.json",
        sourceText: readFileSync(deepSourcePath, "utf8"),
        metadata: metadata(deepSourcePath),
        runtimeEvidence: runtimeEvidence(noEtherscan),
      }),
    ).toThrow("Etherscan source verification is required");

    const noSourcify = promotedDeepV2Manifest();
    noSourcify.sourceVerification.contracts.feeHook.sourcify.status =
      "not-submitted";
    expect(() =>
      buildUniswapHookRelease({
        manifest: noSourcify,
        manifestPath:
          "contracts/deployments/mainnet-deep-full-range-v2.json",
        sourceText: readFileSync(deepSourcePath, "utf8"),
        metadata: metadata(deepSourcePath),
        runtimeEvidence: runtimeEvidence(noSourcify),
      }),
    ).toThrow("Sourcify source verification is required");
  });

  it("binds the reviewed source to the verified FQCN and source commitment", () => {
    const missingCommitment = promotedDeepV2Manifest();
    missingCommitment.sourceCommitment = null;
    expect(() =>
      buildUniswapHookRelease({
        manifest: missingCommitment,
        manifestPath:
          "contracts/deployments/mainnet-deep-full-range-v2.json",
        sourceText: readFileSync(deepSourcePath, "utf8"),
        metadata: metadata(deepSourcePath),
        runtimeEvidence: runtimeEvidence(missingCommitment),
      }),
    ).toThrow("Source commitment is required");

    const manifest = promotedDeepV2Manifest();
    const wrongContract = readFileSync(deepSourcePath, "utf8").replace(
      "contract LiquidityGrowthFeeOracleHookV1 is",
      "contract DifferentHook is",
    );
    expect(() =>
      buildUniswapHookRelease({
        manifest,
        manifestPath:
          "contracts/deployments/mainnet-deep-full-range-v2.json",
        sourceText: wrongContract,
        metadata: metadata(deepSourcePath),
        runtimeEvidence: runtimeEvidence(manifest),
      }),
    ).toThrow(
      "Local source does not declare verified contract LiquidityGrowthFeeOracleHookV1",
    );
  });

  it("rejects proxy, admin and upgrade signals instead of publishing them as safe", () => {
    const manifest = promotedDeepV2Manifest();
    const base = {
      manifest,
      manifestPath:
        "contracts/deployments/mainnet-deep-full-range-v2.json",
      metadata: metadata(deepSourcePath),
      runtimeEvidence: runtimeEvidence(manifest),
    };

    expect(() =>
      buildUniswapHookRelease({
        ...base,
        sourceText:
          "contract LiquidityGrowthFeeOracleHookV1 is UUPSUpgradeable { function upgradeTo(address) external {} }",
      }),
    ).toThrow("upgradeable");
    expect(() =>
      buildUniswapHookRelease({
        ...base,
        sourceText:
          "contract LiquidityGrowthFeeOracleHookV1 { address admin; function getHookPermissions() public pure returns (Hooks.Permissions memory) {} }",
      }),
    ).toThrow("administrative control");
    expect(() =>
      buildUniswapHookRelease({
        ...base,
        sourceText: readFileSync(deepSourcePath, "utf8"),
        runtimeEvidence: {
          ...runtimeEvidence(manifest),
          eip1967Slots: {
            ...zeroProxySlots(),
            implementation: `0x${"00".repeat(31)}01`,
          },
        },
      }),
    ).toThrow("EIP-1967 implementation slot is populated");
  });

  it("rejects administrative control hidden in an imported source file", () => {
    const manifest = promotedDeepV2Manifest();
    const sourceText = readFileSync(deepSourcePath, "utf8");
    expect(() =>
      buildUniswapHookRelease({
        manifest,
        manifestPath:
          "contracts/deployments/mainnet-deep-full-range-v2.json",
        sourceText,
        sourceBundleText: `${sourceText}
          abstract contract HiddenControl {
            address public admin;
          }`,
        metadata: metadata(deepSourcePath),
        runtimeEvidence: runtimeEvidence(manifest),
      }),
    ).toThrow("administrative control");
  });

  it("keeps the public registry packet separate from routing review", () => {
    const manifest = readJson(classicManifestPath);
    const release = buildUniswapHookRelease({
      manifest,
      manifestPath: classicManifestPath,
      sourceText: readFileSync(classicSourcePath, "utf8"),
      metadata: metadata(classicSourcePath),
      runtimeEvidence: runtimeEvidence(manifest),
    });

    expect(release.hooklist.purpose).toBe("public-hook-registry");
    expect(release.hooklist.submissionStatus).toBe("not-submitted");
    expect(release.routingAllowlist.purpose).toBe(
      "uniswap-routing-review",
    );
    expect(release.routingAllowlist.submissionStatus).toBe("not-submitted");
    expect(release.routingAllowlist.intakeMarkdown).toContain(
      "Hooklist inclusion does not grant routing approval",
    );
    expect(release.routingAllowlist.submissionUrl).toBe(
      "https://share.hsforms.com/15fMHwt6NTzuKuQdxw6nHwws8pgg",
    );
  });

  it("writes complete local artifacts without submitting anything", async () => {
    const manifest = readJson(classicManifestPath);
    const release = buildUniswapHookRelease({
      manifest,
      manifestPath: classicManifestPath,
      sourceText: readFileSync(classicSourcePath, "utf8"),
      metadata: metadata(classicSourcePath),
      runtimeEvidence: runtimeEvidence(manifest),
    });
    const parent = mkdtempSync(
      path.join(tmpdir(), "programmable-hook-release-parent-"),
    );
    const output = path.join(parent, "release");

    await writeUniswapHookRelease(output, release);

    expect(
      JSON.parse(readFileSync(path.join(output, "hook-entry.json"), "utf8")),
    ).toEqual(release.hooklist.entry);
    expect(
      JSON.parse(
        readFileSync(path.join(output, "hooklist-issue.json"), "utf8"),
      ),
    ).toEqual(release.hooklist.issueJson);
    expect(
      readFileSync(
        path.join(output, "routing-allowlist-intake.md"),
        "utf8",
      ),
    ).toContain("not submitted");
    expect(readFileSync(path.join(output, "release-evidence.json"), "utf8"))
      .toContain(manifest.addresses.feeHook);
  });

  it("refuses an existing output directory before writing any artifact", async () => {
    const manifest = readJson(classicManifestPath);
    const release = buildUniswapHookRelease({
      manifest,
      manifestPath: classicManifestPath,
      sourceText: readFileSync(classicSourcePath, "utf8"),
      metadata: metadata(classicSourcePath),
      runtimeEvidence: runtimeEvidence(manifest),
    });
    const output = mkdtempSync(
      path.join(tmpdir(), "programmable-existing-release-"),
    );
    writeFileSync(path.join(output, "keep.txt"), "preserve");

    await expect(writeUniswapHookRelease(output, release)).rejects.toThrow(
      "Output directory already exists",
    );
    expect(readdirSync(output)).toEqual(["keep.txt"]);
  });
});

describe("live hook runtime inspection", () => {
  it("binds chain, runtime hash and empty proxy slots through read-only RPC", async () => {
    const runtime = "0x6001600055";
    const runtimeHash = keccak256(runtime);
    const address = "0x11111111111111111111111111111111111120cc";
    const fetchImpl = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body));
      const resultByMethod: Record<string, string> = {
        eth_chainId: "0x1",
        eth_blockNumber: "0x1234",
        eth_getCode: runtime,
        eth_getStorageAt: EMPTY_STORAGE_WORD,
      };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: resultByMethod[body.method],
        }),
        { status: 200 },
      );
    });

    await expect(
      inspectLiveHook({
        rpcUrl: "https://rpc.example",
        expectedChainId: 1,
        hookAddress: address,
        expectedRuntimeCodeHash: runtimeHash,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      chainId: 1,
      hookAddress: getAddress(address),
      runtimeCodeHash: runtimeHash,
      observedAtBlock: 0x1234,
      eip1967Slots: zeroProxySlots(),
      minimalProxy: false,
      runtimeDelegatecall: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it("rejects EIP-1167 and DELEGATECALL runtimes", async () => {
    const address = "0x11111111111111111111111111111111111120cc";
    const makeFetch = (runtime: string) =>
      vi.fn(async (_url: string, request: RequestInit) => {
        const body = JSON.parse(String(request.body));
        const resultByMethod: Record<string, string> = {
          eth_chainId: "0x1",
          eth_blockNumber: "0x1234",
          eth_getCode: runtime,
          eth_getStorageAt: EMPTY_STORAGE_WORD,
        };
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: resultByMethod[body.method],
          }),
          { status: 200 },
        );
      });

    const minimalProxy =
      "0x363d3d373d3d3d363d7311111111111111111111111111111111111111115af43d82803e903d91602b57fd5bf3";
    await expect(
      inspectLiveHook({
        rpcUrl: "https://rpc.example",
        expectedChainId: 1,
        hookAddress: address,
        expectedRuntimeCodeHash: keccak256(minimalProxy),
        fetchImpl: makeFetch(minimalProxy),
      }),
    ).rejects.toThrow("minimal proxy");

    const delegatecallRuntime = "0x60006000f400";
    await expect(
      inspectLiveHook({
        rpcUrl: "https://rpc.example",
        expectedChainId: 1,
        hookAddress: address,
        expectedRuntimeCodeHash: keccak256(delegatecallRuntime),
        fetchImpl: makeFetch(delegatecallRuntime),
      }),
    ).rejects.toThrow("DELEGATECALL");
  });
});

describe("verified Solidity source closure", () => {
  it("loads relative and Foundry-remapped imports without leaving contracts root", async () => {
    const contractsRoot = mkdtempSync(
      path.join(tmpdir(), "programmable-solidity-"),
    );
    mkdirSync(path.join(contractsRoot, "src"), { recursive: true });
    mkdirSync(path.join(contractsRoot, "lib", "vendor"), {
      recursive: true,
    });
    writeFileSync(
      path.join(contractsRoot, "remappings.txt"),
      "@vendor/=lib/vendor/\n",
    );
    writeFileSync(
      path.join(contractsRoot, "src", "Hook.sol"),
      [
        'import { Base } from "./Base.sol";',
        'import { Vendor } from "@vendor/Vendor.sol";',
        "contract Hook is Base, Vendor {}",
      ].join("\n"),
    );
    writeFileSync(
      path.join(contractsRoot, "src", "Base.sol"),
      "abstract contract Base {}",
    );
    writeFileSync(
      path.join(contractsRoot, "lib", "vendor", "Vendor.sol"),
      "abstract contract Vendor {}",
    );

    const closure = await loadSoliditySourceClosure({
      entryPath: path.join(contractsRoot, "src", "Hook.sol"),
      contractsRoot,
    });

    expect(closure.sources.map((source: { path: string }) => source.path))
      .toEqual([
        "lib/vendor/Vendor.sol",
        "src/Base.sol",
        "src/Hook.sol",
      ]);
    expect(closure.bundleText).toContain("abstract contract Vendor");
  });
});

describe("local release CLI", () => {
  const cliPath = path.join(
    root,
    "scripts",
    "prepare-uniswap-hook-release.mjs",
  );

  it("documents the manifest, metadata, RPC and local output boundary", () => {
    const result = spawnSync(process.execPath, [cliPath, "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--manifest");
    expect(result.stdout).toContain("--metadata");
    expect(result.stdout).toContain("--rpc-url");
    expect(result.stdout).toContain("--output");
    expect(result.stdout).toContain("does not submit");
  });

  it("rejects the historical Deep V1 canary before any network operation", () => {
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--manifest",
        deepV1ManifestPath,
        "--metadata",
        path.join(root, "does-not-need-to-exist.json"),
        "--rpc-url",
        "http://127.0.0.1:1",
        "--output",
        path.join(tmpdir(), "must-not-be-written"),
      ],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "releaseEligible must be true",
    );
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("ECONNREFUSED");
  });

  it("is exposed through focused package commands", () => {
    const packageJson = readJson(path.join(root, "package.json"));
    expect(packageJson.scripts["release:uniswap-hook:prepare"]).toBe(
      "node scripts/prepare-uniswap-hook-release.mjs",
    );
    expect(packageJson.scripts["release:uniswap-hook:test"]).toBe(
      "vitest run tests/uniswap-hook-release.test.ts",
    );
  });
});
