import assert from "node:assert/strict";
import test from "node:test";
import { validateFoundryBuildInfo } from "../build-info-core.mjs";

const HOOK_SOURCE =
  "pragma solidity 0.8.26;\n" +
  'import {Helper} from "./Helper.sol";\n' +
  'import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";\n' +
  "contract Hook is Helper { IPoolManager internal manager; }\n";
const HELPER_SOURCE = "pragma solidity 0.8.26;\ncontract Helper {}\n";
const POOL_MANAGER_SOURCE = "pragma solidity 0.8.26;\ninterface IPoolManager {}\n";

test("accepts a complete Foundry build info bound to the reviewed Solidity source closure", () => {
  const input = validInput();

  assert.deepEqual(validateFoundryBuildInfo(input), []);
  assert.deepEqual(validateFoundryBuildInfo(input), []);
});

test("treats omitted appendCBOR as the Solidity default true", () => {
  const input = validInput();
  input.declaredCompiler.cborMetadata = true;
  delete input.buildInfo.input.settings.metadata.appendCBOR;

  assert.deepEqual(validateFoundryBuildInfo(input), []);
});

test("rejects a remapping-resolved source whose content differs from the review target", () => {
  const input = validInput();
  input.buildInfo.input.sources["lib/v4-core/src/interfaces/IPoolManager.sol"].content =
    "pragma solidity 0.8.26;\ninterface IPoolManager { function backdoor() external; }\n";

  const errors = validateFoundryBuildInfo(input);

  assert.ok(
    errors.includes(
      "build info source hash differs from review target: lib/v4-core/src/interfaces/IPoolManager.sol"
    ),
    errors.join("\n")
  );
});

test("rejects remappings that differ from trusted repository path metadata", () => {
  const input = validInput();
  input.buildInfo.input.settings.remappings = [
    "@uniswap/v4-core/=vendor/unreviewed-v4-core/"
  ];

  const errors = validateFoundryBuildInfo(input);

  assert.ok(
    errors.includes("build info remappings differ from repository path metadata"),
    errors.join("\n")
  );
});

test("rejects a missing first-party compiler source", () => {
  const input = validInput();
  delete input.buildInfo.input.sources["src/Helper.sol"];
  delete input.buildInfo.output.sources["src/Helper.sol"];
  delete input.buildInfo.source_id_to_path["1"];

  const errors = validateFoundryBuildInfo(input);

  assert.ok(
    errors.includes("build info input is missing first-party source: src/Helper.sol"),
    errors.join("\n")
  );
});

test("rejects an undeclared first-party compiler source", () => {
  const input = validInput();
  input.buildInfo.input.sources["src/Backdoor.sol"] = {
    content: "pragma solidity 0.8.26;\ncontract Backdoor {}\n"
  };
  input.buildInfo.output.sources["src/Backdoor.sol"] = { id: 3 };
  input.buildInfo.source_id_to_path["3"] = "src/Backdoor.sol";

  const errors = validateFoundryBuildInfo(input);

  assert.ok(
    errors.includes("build info input contains undeclared first-party source: src/Backdoor.sol"),
    errors.join("\n")
  );
});

test("requires exact compiler version, optimizer, EVM, via-IR and metadata settings", async (t) => {
  const cases = [
    {
      name: "short Solidity version",
      mutate: ({ buildInfo }) => {
        buildInfo.solcVersion = "0.8.25";
      },
      error: "build info solcVersion must equal declared compiler solidity 0.8.26"
    },
    {
      name: "long Solidity version",
      mutate: ({ buildInfo }) => {
        buildInfo.solcLongVersion = "0.8.25+commit.b61c2a91";
      },
      error: "build info solcLongVersion must identify declared compiler solidity 0.8.26"
    },
    {
      name: "compiler source revision",
      mutate: ({ declaredCompiler }) => {
        declaredCompiler.sourceRevision = "8a97fa7a";
      },
      error:
        "declared compiler sourceRevision must be an exact lowercase 40-character Git commit"
    },
    {
      name: "optimizer enabled",
      mutate: ({ buildInfo }) => {
        buildInfo.input.settings.optimizer.enabled = false;
      },
      error: "build info optimizer.enabled must equal declared compiler optimizer true"
    },
    {
      name: "optimizer runs",
      mutate: ({ buildInfo }) => {
        buildInfo.input.settings.optimizer.runs = 200;
      },
      error: "build info optimizer.runs must equal declared compiler optimizerRuns 1000"
    },
    {
      name: "EVM version",
      mutate: ({ buildInfo }) => {
        buildInfo.input.settings.evmVersion = "prague";
      },
      error: 'build info evmVersion must equal declared compiler evmVersion "cancun"'
    },
    {
      name: "via IR",
      mutate: ({ buildInfo }) => {
        buildInfo.input.settings.viaIR = true;
      },
      error: "build info viaIR must equal declared compiler viaIR false"
    },
    {
      name: "metadata bytecode hash",
      mutate: ({ buildInfo }) => {
        buildInfo.input.settings.metadata.bytecodeHash = "ipfs";
      },
      error:
        'build info metadata.bytecodeHash must equal declared compiler metadataBytecodeHash "none"'
    },
    {
      name: "CBOR metadata",
      mutate: ({ buildInfo }) => {
        buildInfo.input.settings.metadata.appendCBOR = true;
      },
      error: "build info metadata.appendCBOR must equal declared compiler cborMetadata false"
    }
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, () => {
      const input = validInput();
      fixtureCase.mutate(input);

      const errors = validateFoundryBuildInfo(input);

      assert.ok(errors.includes(fixtureCase.error), errors.join("\n"));
    });
  }
});

test("rejects a noncanonical long compiler version even when its release prefix matches", () => {
  const input = validInput();
  input.buildInfo.solcLongVersion = "0.8.26+evil";

  const errors = validateFoundryBuildInfo(input);

  assert.ok(
    errors.includes(
      "build info solcLongVersion must equal canonical compiler identity 0.8.26+commit.8a97fa7a"
    ),
    errors.join("\n")
  );
});

test("requires the full Foundry Solidity format and language markers", async (t) => {
  const cases = [
    {
      name: "format",
      mutate: ({ buildInfo }) => {
        buildInfo._format = "hh-sol-build-info-1";
      },
      error: 'build info _format must be "ethers-rs-sol-build-info-1"'
    },
    {
      name: "build context language",
      mutate: ({ buildInfo }) => {
        buildInfo.language = "Vyper";
      },
      error: 'build info language must be "Solidity"'
    },
    {
      name: "compiler input language",
      mutate: ({ buildInfo }) => {
        buildInfo.input.language = "Yul";
      },
      error: 'build info input.language must be "Solidity"'
    }
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, () => {
      const input = validInput();
      fixtureCase.mutate(input);

      const errors = validateFoundryBuildInfo(input);

      assert.ok(errors.includes(fixtureCase.error), errors.join("\n"));
    });
  }
});

test("rejects Solidity compile errors while accepting Foundry's null diagnostics field", () => {
  const input = validInput();
  input.buildInfo.output.errors = null;
  assert.deepEqual(validateFoundryBuildInfo(input), []);

  input.buildInfo.output.errors = [
    {
      severity: "warning",
      formattedMessage: "Warning: fixture warning"
    },
    {
      severity: "error",
      formattedMessage: "TypeError: fixture compile error"
    }
  ];

  const errors = validateFoundryBuildInfo(input);

  assert.ok(
    errors.includes("build info output contains 1 Solidity compile error"),
    errors.join("\n")
  );
});

test("requires AST, contract and creation-bytecode outputs for the reviewed source closure", async (t) => {
  const cases = [
    {
      name: "missing output selection",
      mutate: ({ buildInfo }) => {
        delete buildInfo.input.settings.outputSelection;
      },
      error:
        "build info outputSelection must request AST, ABI and creation bytecode for every Solidity source"
    },
    {
      name: "missing AST",
      mutate: ({ buildInfo }) => {
        delete buildInfo.output.sources["src/Hook.sol"].ast;
      },
      error: "build info output source is missing a Solidity SourceUnit AST: src/Hook.sol"
    },
    {
      name: "missing contracts object",
      mutate: ({ buildInfo }) => {
        delete buildInfo.output.contracts;
      },
      error: "build info output.contracts must be an object"
    },
    {
      name: "missing compiled contract",
      mutate: ({ buildInfo }) => {
        delete buildInfo.output.contracts["src/Hook.sol"].Hook;
      },
      error: "build info output is missing contract Hook from src/Hook.sol"
    },
    {
      name: "empty concrete bytecode",
      mutate: ({ buildInfo }) => {
        buildInfo.output.contracts["src/Hook.sol"].Hook.evm.bytecode.object = "";
      },
      error:
        "build info output contract has no creation bytecode: src/Hook.sol:Hook"
    },
    {
      name: "malformed concrete bytecode",
      mutate: ({ buildInfo }) => {
        buildInfo.output.contracts["src/Hook.sol"].Hook.evm.bytecode.object =
          "not-bytecode";
      },
      error:
        "build info output contract has malformed creation bytecode: src/Hook.sol:Hook"
    }
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, () => {
      const input = validInput();
      fixtureCase.mutate(input);

      const errors = validateFoundryBuildInfo(input);

      assert.ok(errors.includes(fixtureCase.error), errors.join("\n"));
    });
  }
});

test("requires output source ids and source_id_to_path to describe the same source set", () => {
  const input = validInput();
  input.buildInfo.source_id_to_path["2"] = "src/Helper.sol";

  const errors = validateFoundryBuildInfo(input);

  assert.ok(
    errors.includes(
      "build info source_id_to_path[2] must equal output source path src/Hook.sol"
    ),
    errors.join("\n")
  );
  assert.ok(
    errors.includes("build info source_id_to_path contains duplicate path: src/Helper.sol"),
    errors.join("\n")
  );
});

test("rejects unsafe repository-relative source and build-info paths", async (t) => {
  await t.test("source path", () => {
    const input = validInput();
    renameSource(input, "src/Helper.sol", "../Helper.sol", 1);

    const errors = validateFoundryBuildInfo(input);

    assert.ok(
      errors.includes("review target contains unsafe path: ../Helper.sol"),
      errors.join("\n")
    );
    assert.ok(
      errors.includes("build info input contains unsafe source path: ../Helper.sol"),
      errors.join("\n")
    );
  });

  await t.test("Windows absolute source path", () => {
    const input = validInput();
    renameSource(input, "src/Helper.sol", "C:/Helper.sol", 1);

    const errors = validateFoundryBuildInfo(input);

    assert.ok(
      errors.includes("review target contains unsafe path: C:/Helper.sol"),
      errors.join("\n")
    );
    assert.ok(
      errors.includes("build info input contains unsafe source path: C:/Helper.sol"),
      errors.join("\n")
    );
  });

  await t.test("build-info path", () => {
    const input = validInput();
    input.pathMetadata.buildInfoPath = "../outside/build-info.json";

    const errors = validateFoundryBuildInfo(input);

    assert.ok(
      errors.includes("repository path metadata buildInfoPath must be a safe relative JSON path"),
      errors.join("\n")
    );
  });

  await t.test("repository root", () => {
    const input = validInput();
    input.pathMetadata.repositoryRoot = "relative/repository";

    const errors = validateFoundryBuildInfo(input);

    assert.ok(
      errors.includes("repository path metadata repositoryRoot must be an absolute normalized path"),
      errors.join("\n")
    );
  });
});

test("rejects source and structure bounds before accepting compiler evidence", async (t) => {
  await t.test("reviewed source size", () => {
    const input = validInput();
    const record = input.reviewTarget.files.find(({ path }) => path === "src/Hook.sol");
    record.bytes = 2_000_001;

    const errors = validateFoundryBuildInfo(input);

    assert.ok(
      errors.includes("review target source exceeds 2000000 bytes: src/Hook.sol"),
      errors.join("\n")
    );
  });

  await t.test("nested JSON structure", () => {
    const input = validInput();
    let cursor = input.buildInfo.output;
    for (let index = 0; index < 66; index += 1) {
      cursor.nested = {};
      cursor = cursor.nested;
    }

    const errors = validateFoundryBuildInfo(input);

    assert.ok(
      errors.includes("build info JSON exceeds maximum depth 64"),
      errors.join("\n")
    );
  });
});

test("returns unique errors in deterministic lexical order", () => {
  const input = validInput();
  input.buildInfo._format = "wrong";
  input.buildInfo.language = "Yul";
  input.buildInfo.input.language = "Yul";
  input.buildInfo.solcVersion = "0.8.25";

  const first = validateFoundryBuildInfo(input);
  const second = validateFoundryBuildInfo(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first, [...new Set(first)].sort());
});

function validInput() {
  return {
    buildInfo: {
      id: "0123456789abcdef",
      _format: "ethers-rs-sol-build-info-1",
      solcVersion: "0.8.26",
      solcLongVersion: "0.8.26+commit.8a97fa7a",
      language: "Solidity",
      source_id_to_path: {
        "0": "lib/v4-core/src/interfaces/IPoolManager.sol",
        "1": "src/Helper.sol",
        "2": "src/Hook.sol"
      },
      input: {
        language: "Solidity",
        sources: {
          "lib/v4-core/src/interfaces/IPoolManager.sol": {
            content: POOL_MANAGER_SOURCE
          },
          "src/Helper.sol": {
            content: HELPER_SOURCE
          },
          "src/Hook.sol": {
            content: HOOK_SOURCE
          }
        },
        settings: {
          remappings: ["@uniswap/v4-core/=lib/v4-core/"],
          optimizer: {
            enabled: true,
            runs: 1000
          },
          metadata: {
            useLiteralContent: true,
            bytecodeHash: "none",
            appendCBOR: false
          },
          outputSelection: {
            "*": {
              "": ["ast"],
              "*": ["abi", "evm.bytecode.object"]
            }
          },
          evmVersion: "cancun",
          viaIR: false,
          libraries: {}
        }
      },
      output: {
        errors: [],
        sources: {
          "lib/v4-core/src/interfaces/IPoolManager.sol": {
            id: 0,
            ast: sourceUnit(
              "lib/v4-core/src/interfaces/IPoolManager.sol",
              contractDefinition("IPoolManager", "interface", false)
            )
          },
          "src/Helper.sol": {
            id: 1,
            ast: sourceUnit(
              "src/Helper.sol",
              contractDefinition("Helper", "contract", false)
            )
          },
          "src/Hook.sol": {
            id: 2,
            ast: sourceUnit(
              "src/Hook.sol",
              contractDefinition("Hook", "contract", false)
            )
          }
        },
        contracts: {
          "lib/v4-core/src/interfaces/IPoolManager.sol": {
            IPoolManager: compiledContract("")
          },
          "src/Helper.sol": {
            Helper: compiledContract("60006000")
          },
          "src/Hook.sol": {
            Hook: compiledContract("60016000")
          }
        }
      }
    },
    reviewTarget: {
      schemaVersion: 1,
      closureMethod: "compiler-resolved-solidity-sources-v1",
      files: [
        {
          path: "lib/v4-core/src/interfaces/IPoolManager.sol",
          kind: "compiler-resolved-source",
          bytes: 50,
          sha256: "420d8c4882dc56f7e987e2a7122b976e38d73def0adc9757fb6e69b1c83a60c2"
        },
        {
          path: "src/Helper.sol",
          kind: "compiler-resolved-source",
          bytes: 43,
          sha256: "3ac98a2a4a5b301a3f8b588ae1b3c600908cf1ee66091a18dcd3306209db7c4c"
        },
        {
          path: "src/Hook.sol",
          kind: "compiler-resolved-source",
          bytes: 199,
          sha256: "9f2488291ac6ccdfac83cd6ea8da036175a4db5087abdf6856e52a56ff1dab43"
        }
      ]
    },
    declaredCompiler: {
      solidity: "0.8.26",
      sourceRevision: "8a97fa7a1db1ec509221ead6fea6802c684ee887",
      evmVersion: "cancun",
      optimizer: true,
      optimizerRuns: 1000,
      viaIR: false,
      metadataBytecodeHash: "none",
      cborMetadata: false
    },
    pathMetadata: {
      repositoryRoot: "/workspace/programmable",
      buildInfoPath: "out/build-info/0123456789abcdef.json",
      firstPartyRoots: ["src", "test", "script", "contracts", "models", "submissions"],
      remappings: ["@uniswap/v4-core/=lib/v4-core/"]
    }
  };
}

function sourceUnit(sourcePath, ...nodes) {
  return {
    absolutePath: sourcePath,
    id: 100,
    nodeType: "SourceUnit",
    nodes,
    src: "0:0:0"
  };
}

function contractDefinition(name, contractKind, abstract) {
  return {
    abstract,
    contractKind,
    id: 101,
    name,
    nodeType: "ContractDefinition",
    nodes: [],
    src: "0:0:0"
  };
}

function compiledContract(bytecode) {
  return {
    abi: [],
    evm: {
      bytecode: {
        object: bytecode
      }
    }
  };
}

function renameSource(input, from, to, id) {
  const reviewRecord = input.reviewTarget.files.find(({ path }) => path === from);
  reviewRecord.path = to;
  input.buildInfo.input.sources[to] = input.buildInfo.input.sources[from];
  delete input.buildInfo.input.sources[from];
  input.buildInfo.output.sources[to] = input.buildInfo.output.sources[from];
  delete input.buildInfo.output.sources[from];
  input.buildInfo.source_id_to_path[String(id)] = to;
}
