import fs from "node:fs";

export function scanSolidity(file, scanErrors, scanWarnings, { submission, relative }) {
  // Intake binds the declared compiler artifact to the reviewed source bytes,
  // but AST output is optional. Keep this policy gate independent of optional
  // compiler output: erase comments and literals, then reject every assembly
  // form.
  const source = maskSolidityTrivia(fs.readFileSync(file, "utf8"));
  const name = relative(file);
  if (submission.hook?.used === false) {
    const hookInterface = /\b(?:BaseHook|IHooks|getHookPermissions)\b|\bHooks\s*\./u;
    const hookCallback = /\bfunction\s+(?:beforeInitialize|afterInitialize|beforeAddLiquidity|afterAddLiquidity|beforeRemoveLiquidity|afterRemoveLiquidity|beforeSwap|afterSwap|beforeDonate|afterDonate)\s*\(/u;
    if (hookInterface.test(source)) {
      scanErrors.push(`${name}: hook.used=false conflicts with a Solidity v4 hook interface or permission declaration`);
    }
    if (hookCallback.test(source)) {
      scanErrors.push(`${name}: hook.used=false conflicts with a Solidity v4 hook callback declaration`);
    }
  }
  const assemblyPolicy = inspectInlineAssembly(source);
  if (assemblyPolicy.present) {
    scanErrors.push(`${name}: contains local inline assembly that requires an isolated maintainer review before intake`);
  }
  if (assemblyPolicy.usesOrigin) {
    scanErrors.push(`${name}: uses Yul origin()`);
  }
  const prohibited = [
    [/\btx\s*\.\s*origin\b/, "uses tx.origin"],
    [/\bdelegatecall\b\s*(?:\{[^}]*\}\s*)?\(/s, "uses delegatecall"],
    [/\bselfdestruct\b\s*\(/, "uses selfdestruct"],
    [/pragma\s+solidity\s+(?:\^|~|>=|<=|>|<)/, "uses a floating Solidity pragma"]
  ];
  const review = [
    [/\.call\s*(?:\{|\()/, "contains a low-level call"],
    [/\b(?:TODO|FIXME|XXX)\b/, "contains an unresolved implementation marker"]
  ];
  for (const [pattern, message] of prohibited) if (pattern.test(source)) scanErrors.push(`${name}: ${message}`);
  for (const [pattern, message] of review) if (pattern.test(source)) scanWarnings.push(`${name}: ${message}; include an explicit review disposition`);

  const authorityText = (submission.authorities ?? []).flatMap((authority) => authority.capabilities ?? []).join(" ").toLowerCase();
  if (/\b(?:onlyOwner|onlyRole|AccessControl|Ownable)\b/.test(source) && (submission.authorities?.length ?? 0) === 0) {
    scanErrors.push(`${name}: source declares privileged access control but submission.authorities is empty`);
  }
  const capabilityNames = {
    mint: ["mint", "issue"],
    blacklist: ["blacklist", "blockAccount", "denylist"],
    pause: ["pause", "freeze", "halt"],
    upgrade: ["upgrade", "setImplementation", "changeImplementation"],
    feeRecipient: ["setFeeRecipient", "changeFeeRecipient"],
    payout: ["payout", "setReceiver", "setRecipient", "redirect"],
    rescue: ["rescue", "sweep", "recover"]
  };
  for (const [capability, functionNames] of Object.entries(capabilityNames)) {
    const alternatives = functionNames.join("|");
    const callable = new RegExp(`\\bfunction\\s+(?:${alternatives})\\w*\\s*\\([^)]*\\)[\\s\\S]{0,400}\\b(?:public|external)\\b`, "i");
    if (callable.test(source) && !authorityText.includes(capability.toLowerCase()) && !functionNames.some((entry) => authorityText.includes(entry.toLowerCase()))) {
      scanErrors.push(`${name}: public or external ${capability} capability is not declared in submission.authorities`);
    }
  }
}

export function maskSolidityTrivia(source) {
  let output = "";
  let mode = "code";
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (mode === "line-comment") {
      if (current === "\n") {
        output += "\n";
        mode = "code";
      } else {
        output += " ";
      }
      continue;
    }

    if (mode === "block-comment") {
      if (current === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else {
        output += current === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (mode === "string") {
      output += current === "\n" ? "\n" : " ";
      if (current === "\\") {
        if (next !== undefined) {
          output += next === "\n" ? "\n" : " ";
          index += 1;
        }
      } else if (current === quote) {
        mode = "code";
        quote = null;
      }
      continue;
    }

    if (current === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (current === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
    } else if (current === '"' || current === "'") {
      output += " ";
      mode = "string";
      quote = current;
    } else {
      output += current;
    }
  }

  return output;
}

function inspectInlineAssembly(source) {
  let present = false;
  let usesOrigin = false;
  const assemblyPattern = /\bassembly\b/g;
  let match;

  while ((match = assemblyPattern.exec(source)) !== null) {
    present = true;
    let cursor = match.index + match[0].length;
    cursor = skipWhitespace(source, cursor);

    if (source[cursor] === "(") {
      cursor = closingDelimiter(source, cursor, "(", ")");
      if (cursor === -1) break;
      cursor = skipWhitespace(source, cursor + 1);
      assemblyPattern.lastIndex = cursor;
    }

    if (source[cursor] !== "{") continue;
    const close = closingDelimiter(source, cursor, "{", "}");
    if (close === -1) {
      usesOrigin ||= /\borigin\s*\(\s*\)/.test(source.slice(cursor + 1));
      break;
    } else {
      usesOrigin ||= /\borigin\s*\(\s*\)/.test(source.slice(cursor + 1, close));
      assemblyPattern.lastIndex = close + 1;
    }
  }

  return { present, usesOrigin };
}

function skipWhitespace(source, start) {
  let cursor = start;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
}

function closingDelimiter(source, start, open, close) {
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    if (source[cursor] === open) depth += 1;
    else if (source[cursor] === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}
