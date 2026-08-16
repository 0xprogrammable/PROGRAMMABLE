import {
  MAX_DIAGNOSTICS,
  MAX_FILES,
  MAX_SOURCE_ID,
  byMapKey,
  isPlainObject,
  safeRelativePath
} from "./build-info-shared.mjs";

export function validateCompilerOutput(output, sourceIdToPath, inputSources, errors) {
  if (!isPlainObject(output)) {
    errors.push("build info output must be an object");
    return;
  }
  validateDiagnostics(output.errors, errors);

  if (!isPlainObject(output.sources)) {
    errors.push("build info output.sources must be an object");
    return;
  }

  const outputPaths = Object.keys(output.sources).sort();
  if (outputPaths.length > MAX_FILES) {
    errors.push(`build info output.sources exceeds ${MAX_FILES} files`);
    return;
  }
  for (const sourcePath of [...inputSources.keys()].sort()) {
    if (!Object.hasOwn(output.sources, sourcePath)) {
      errors.push(`build info output is missing source: ${sourcePath}`);
    }
  }
  for (const sourcePath of outputPaths) {
    if (!inputSources.has(sourcePath)) {
      errors.push(`build info output contains undeclared source: ${sourcePath}`);
    }
    if (!safeRelativePath(sourcePath) || !sourcePath.endsWith(".sol")) {
      errors.push(`build info output contains unsafe source path: ${sourcePath}`);
    }
  }

  const contractDefinitions = new Map();
  let concreteContracts = 0;
  const outputIdToPath = new Map();
  for (const sourcePath of outputPaths) {
    const record = output.sources[sourcePath];
    if (
      !isPlainObject(record) ||
      !Number.isInteger(record.id) ||
      record.id < 0 ||
      record.id > MAX_SOURCE_ID
    ) {
      errors.push(`build info output source has invalid id: ${sourcePath}`);
      continue;
    }
    if (outputIdToPath.has(record.id)) {
      errors.push(`build info output sources contain duplicate id: ${record.id}`);
    } else {
      outputIdToPath.set(record.id, sourcePath);
    }

    const definitions = validateSourceUnitAst(record?.ast, sourcePath, errors);
    contractDefinitions.set(sourcePath, definitions);
    concreteContracts += [...definitions.values()].filter(
      ({ requiresBytecode }) => requiresBytecode
    ).length;
  }
  if (concreteContracts === 0) {
    errors.push(
      "build info output must include at least one concrete deployable contract"
    );
  }

  if (!isPlainObject(sourceIdToPath)) {
    errors.push("build info source_id_to_path must be an object");
    return;
  }

  const mappedPaths = new Set();
  const mappingEntries = Object.entries(sourceIdToPath).sort(
    ([left], [right]) => Number(left) - Number(right) || left.localeCompare(right)
  );
  if (mappingEntries.length > MAX_FILES) {
    errors.push(`build info source_id_to_path exceeds ${MAX_FILES} entries`);
    return;
  }
  for (const [sourceId, sourcePath] of mappingEntries) {
    if (
      !/^(?:0|[1-9]\d*)$/.test(sourceId) ||
      Number(sourceId) > MAX_SOURCE_ID
    ) {
      errors.push(`build info source_id_to_path contains invalid id: ${sourceId}`);
      continue;
    }
    if (!safeRelativePath(sourcePath) || !String(sourcePath).endsWith(".sol")) {
      errors.push(
        `build info source_id_to_path contains unsafe source path: ${String(sourcePath)}`
      );
      continue;
    }
    if (mappedPaths.has(sourcePath)) {
      errors.push(`build info source_id_to_path contains duplicate path: ${sourcePath}`);
    } else {
      mappedPaths.add(sourcePath);
    }
  }

  for (const [sourceId, sourcePath] of [...outputIdToPath.entries()].sort(
    ([left], [right]) => left - right
  )) {
    const mappedPath = sourceIdToPath[String(sourceId)];
    if (mappedPath !== sourcePath) {
      errors.push(
        `build info source_id_to_path[${sourceId}] must equal output source path ${sourcePath}`
      );
    }
  }
  for (const [sourceId, sourcePath] of mappingEntries) {
    if (!/^(?:0|[1-9]\d*)$/.test(sourceId)) continue;
    const outputPath = outputIdToPath.get(Number(sourceId));
    if (outputPath === undefined) {
      errors.push(
        `build info source_id_to_path[${sourceId}] has no output source id`
      );
    } else if (sourcePath !== outputPath) {
      errors.push(
        `build info source_id_to_path[${sourceId}] differs from output source path ${outputPath}`
      );
    }
  }

  validateCompiledContracts(output.contracts, contractDefinitions, inputSources, errors);
}

function validateDiagnostics(diagnostics, errors) {
  if (diagnostics === null || diagnostics === undefined) return;
  if (!Array.isArray(diagnostics)) {
    errors.push("build info output.errors must be null or an array");
    return;
  }
  if (diagnostics.length > MAX_DIAGNOSTICS) {
    errors.push(`build info output.errors exceeds ${MAX_DIAGNOSTICS} diagnostics`);
    return;
  }

  let compileErrors = 0;
  for (const [index, diagnostic] of diagnostics.entries()) {
    if (!isPlainObject(diagnostic) || typeof diagnostic.severity !== "string") {
      errors.push(`build info output.errors[${index}] has no severity`);
      continue;
    }
    if (diagnostic.severity === "error") compileErrors += 1;
  }
  if (compileErrors > 0) {
    errors.push(
      `build info output contains ${compileErrors} Solidity compile ${compileErrors === 1 ? "error" : "errors"}`
    );
  }
}

function validateSourceUnitAst(ast, sourcePath, errors) {
  const definitions = new Map();
  if (
    !isPlainObject(ast) ||
    ast.nodeType !== "SourceUnit" ||
    ast.absolutePath !== sourcePath ||
    !Array.isArray(ast.nodes)
  ) {
    errors.push(
      `build info output source is missing a Solidity SourceUnit AST: ${sourcePath}`
    );
    return definitions;
  }

  for (const node of ast.nodes) {
    if (!isPlainObject(node) || node.nodeType !== "ContractDefinition") continue;
    if (
      typeof node.name !== "string" ||
      node.name.length === 0 ||
      !["contract", "interface", "library"].includes(node.contractKind) ||
      typeof node.abstract !== "boolean"
    ) {
      errors.push(
        `build info output source contains an invalid contract definition: ${sourcePath}`
      );
      continue;
    }
    if (definitions.has(node.name)) {
      errors.push(
        `build info output source contains duplicate contract definition ${node.name}: ${sourcePath}`
      );
      continue;
    }
    definitions.set(node.name, {
      requiresBytecode:
        node.contractKind === "library" ||
        (node.contractKind === "contract" && node.abstract === false)
    });
  }
  return definitions;
}

function validateCompiledContracts(
  contracts,
  contractDefinitions,
  inputSources,
  errors
) {
  if (!isPlainObject(contracts)) {
    errors.push("build info output.contracts must be an object");
    return;
  }

  const actualSourcePaths = Object.keys(contracts).sort();
  if (actualSourcePaths.length > MAX_FILES) {
    errors.push(`build info output.contracts exceeds ${MAX_FILES} source entries`);
    return;
  }

  for (const sourcePath of actualSourcePaths) {
    if (!inputSources.has(sourcePath)) {
      errors.push(`build info output.contracts contains undeclared source: ${sourcePath}`);
    }
    const sourceContracts = contracts[sourcePath];
    if (!isPlainObject(sourceContracts)) {
      errors.push(`build info output contracts must be an object: ${sourcePath}`);
      continue;
    }
    const expected = contractDefinitions.get(sourcePath) ?? new Map();
    for (const contractName of Object.keys(sourceContracts).sort()) {
      if (!expected.has(contractName)) {
        errors.push(
          `build info output contains contract absent from its source AST: ${sourcePath}:${contractName}`
        );
      }
    }
  }

  for (const [sourcePath, expected] of [...contractDefinitions.entries()].sort(byMapKey)) {
    const sourceContracts = contracts[sourcePath];
    for (const [contractName, definition] of [...expected.entries()].sort(byMapKey)) {
      if (!isPlainObject(sourceContracts) || !Object.hasOwn(sourceContracts, contractName)) {
        errors.push(`build info output is missing contract ${contractName} from ${sourcePath}`);
        continue;
      }
      validateCompiledContract(
        sourceContracts[contractName],
        sourcePath,
        contractName,
        definition,
        errors
      );
    }
  }
}

function validateCompiledContract(
  contract,
  sourcePath,
  contractName,
  definition,
  errors
) {
  const label = `${sourcePath}:${contractName}`;
  if (!isPlainObject(contract)) {
    errors.push(`build info output contract must be an object: ${label}`);
    return;
  }
  if (!Array.isArray(contract.abi)) {
    errors.push(`build info output contract is missing an ABI: ${label}`);
  }

  const bytecode = contract.evm?.bytecode?.object;
  if (typeof bytecode !== "string") {
    errors.push(`build info output contract is missing creation bytecode: ${label}`);
    return;
  }
  if (definition.requiresBytecode && bytecode.length === 0) {
    errors.push(`build info output contract has no creation bytecode: ${label}`);
    return;
  }
  if (bytecode.length > 0 && !validSolidityBytecodeObject(bytecode)) {
    errors.push(`build info output contract has malformed creation bytecode: ${label}`);
  }
}

function validSolidityBytecodeObject(value) {
  return /^(?:[a-fA-F0-9]{2}|__\$[a-fA-F0-9]{34}\$__)+$/.test(value);
}
