import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const diagramDirectory = dirname(fileURLToPath(import.meta.url));
const contractsRoot = resolve(diagramDirectory, "../../..");

const scope = [
  ["src/LiquidityGrowthFullRangeLaunchV1.sol", "LiquidityGrowthFullRangeLaunchV1", "core"],
  ["src/LiquidityGrowthFullRangeAutomationV1.sol", "LiquidityGrowthFullRangeAutomationV1", "core"],
  ["src/LiquidityGrowthFullRangeVaultFactoryV1.sol", "LiquidityGrowthFullRangeVaultFactoryV1", "core"],
  ["src/LiquidityGrowthFullRangeVaultV1.sol", "LiquidityGrowthFullRangeVaultV1", "core"],
  ["src/LiquidityGrowthFullRangePositionPlannerV1.sol", "LiquidityGrowthFullRangePositionPlannerV1", "core"],
  ["src/LiquidityGrowthFullRangePolicyV1.sol", "LiquidityGrowthFullRangePolicyV1", "core"],
  ["src/LiquidityGrowthFeeOracleHookV1.sol", "LiquidityGrowthFeeOracleHookV1", "support"],
  ["src/LiquidityGrowthFeeOracleHookFactoryV1.sol", "LiquidityGrowthFeeOracleHookFactoryV1", "support"],
  ["src/LiquidityGrowthRangeSourceV1.sol", "LiquidityGrowthRangeSourceV1", "support"],
  ["src/LiquidityGrowthRangeSourceFactoryV1.sol", "LiquidityGrowthRangeSourceFactoryV1", "support"],
  ["src/FeeSplitVaultV1.sol", "FeeSplitVaultV1", "support"],
  ["src/FeeSplitVaultFactoryV1.sol", "FeeSplitVaultFactoryV1", "support"],
  ["src/LockedPositionFeeForwarderFactoryV1.sol", "LockedPositionFeeForwarderFactoryV1", "support"],
];

function cleanType(typeString = "") {
  return typeString
    .replace(/\b(contract|struct|enum) /g, "")
    .replace(/ (calldata|memory|storage)( ref| pointer)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parameterTypes(node) {
  return (node.parameters?.parameters ?? []).map((parameter) =>
    cleanType(parameter.typeName?.typeDescriptions?.typeString ?? parameter.typeDescriptions?.typeString ?? ""),
  );
}

function functionName(node) {
  if (node.kind === "constructor") return "constructor";
  if (node.kind === "receive") return "receive";
  if (node.kind === "fallback") return "fallback";
  return node.name;
}

function functionSignature(node) {
  return `${functionName(node)}(${parameterTypes(node).join(",")})`;
}

function modifierName(modifier) {
  return modifier.modifierName?.name ?? modifier.modifierName?.namePath ?? "";
}

const contracts = scope.map(([source, contractName, role]) => {
  const artifactPath = join(contractsRoot, "out", basename(source), `${contractName}.json`);
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const sourceContent = readFileSync(join(contractsRoot, source), "utf8");
  if (!artifact.ast) {
    throw new Error(`Artifact ${artifactPath} has no AST. Run \`forge build --ast --force\` first.`);
  }

  const contract = artifact.ast.nodes.find(
    (node) => node.nodeType === "ContractDefinition" && node.name === contractName,
  );
  if (!contract) throw new Error(`Build info does not contain contract ${contractName}`);

  const functions = contract.nodes
    .filter(
      (node) =>
        node.nodeType === "FunctionDefinition" &&
        (node.kind === "constructor" || node.visibility === "public" || node.visibility === "external"),
    )
    .map((node) => ({
      signature: functionSignature(node),
      kind: node.kind,
      visibility: node.visibility,
      mutability: node.stateMutability,
      modifiers: (node.modifiers ?? []).map(modifierName).filter(Boolean),
      selector: node.functionSelector ?? null,
    }))
    .sort((left, right) => left.signature.localeCompare(right.signature));

  const stateVariables = contract.nodes
    .filter((node) => node.nodeType === "VariableDeclaration" && node.stateVariable)
    .map((node) => ({
      name: node.name,
      type: cleanType(node.typeName?.typeDescriptions?.typeString ?? node.typeDescriptions?.typeString ?? ""),
      visibility: node.visibility,
      mutability: node.mutability,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const sourceSha256 = createHash("sha256").update(sourceContent).digest("hex");
  return {
    source,
    sourceSha256,
    contract: contractName,
    role,
    kind: contract.contractKind,
    bases: (contract.baseContracts ?? []).map(
      (base) => base.baseName?.name ?? base.baseName?.namePath ?? "",
    ),
    functions,
    stateVariables,
  };
});

const artifact = {
  schemaVersion: 1,
  compilerVersion: "0.8.26",
  generationSource: "Solidity compiler AST emitted by `forge build --ast --force`",
  contracts,
};

writeFileSync(join(diagramDirectory, "compiler-surface.json"), `${JSON.stringify(artifact, null, 2)}\n`);

const markdown = [
  "# Deep FullRange V1 public and external functions",
  "",
  "Generated from the Solidity compiler AST. Modifier names are shown exactly as declared. Sender checks implemented",
  "inside function bodies are summarized separately in `state-authorization.md`.",
  "",
];

for (const contract of contracts) {
  markdown.push(`## ${contract.contract}`, "");
  if (contract.functions.length === 0) {
    markdown.push("No declared public or external functions. This contract is an internal library.", "");
    continue;
  }
  markdown.push("| Function | Visibility | Mutability | Declared modifiers | Selector |");
  markdown.push("| --- | --- | --- | --- | --- |");
  for (const fn of contract.functions) {
    markdown.push(
      `| \`${fn.signature}\` | ${fn.visibility} | ${fn.mutability} | ${
        fn.modifiers.length === 0 ? "None" : fn.modifiers.map((name) => `\`${name}\``).join(", ")
      } | ${fn.selector ? `\`0x${fn.selector}\`` : "N/A"} |`,
    );
  }
  markdown.push("");
}

writeFileSync(join(diagramDirectory, "public-external-functions.md"), `${markdown.join("\n")}\n`);
console.log(`Wrote ${join(diagramDirectory, "compiler-surface.json")}`);
console.log(`Wrote ${join(diagramDirectory, "public-external-functions.md")}`);
