import { normalizeConfusableText } from "./metadata-core.mjs";

const submittedArtifact = String.raw`(?:application|builder|code|contract|evidence|model|project|release|report|skill|submission|token|hook|platform|launch(?:pad|\s+model)?)`;
const selfReference = String.raw`(?:this|our|my|the\s+(?:submitted|proposed))`;
const stateVerb = String.raw`(?:was|is|has\s+been|became|remains)`;
const endorsementVerb = String.raw`(?:verified|approved|certified|endorsed|reviewed)`;
const endorsementNoun = String.raw`(?:verification|approval|certification|endorsement|official\s+status)`;

function providerEndorsementPatterns(provider) {
  return [
    new RegExp(String.raw`\b${selfReference}\s+(?:${submittedArtifact}\s+)?${stateVerb}\s+(?:officially\s+)?${endorsementVerb}\s+by\s+${provider}\b`, "i"),
    new RegExp(String.raw`\bofficially\s+${endorsementVerb}\s+by\s+${provider}\b`, "i"),
    new RegExp(String.raw`\b${provider}\s+(?:(?:has|have|had)\s+)?(?:officially\s+)?${endorsementVerb}\s+(?:this|the|our|my|an?|the\s+submitted|the\s+proposed)\s+(?:(?:submitted|proposed)\s+)?${submittedArtifact}\b`, "i"),
    new RegExp(String.raw`\b${selfReference}\s+(?:${submittedArtifact}\s+)?${stateVerb}\s+(?:an?\s+)?official\s+${provider}\s+${submittedArtifact}\b`, "i"),
    new RegExp(String.raw`\b${selfReference}\s+(?:${submittedArtifact}\s+)?${stateVerb}\s+(?:an?\s+)?${provider}[- ]${endorsementVerb}(?:\s+${submittedArtifact})?\b`, "i"),
    new RegExp(String.raw`\b${selfReference}\s+${submittedArtifact}\s+(?:has|received|carries|claims)\s+(?:an?\s+)?${provider}\s+${endorsementNoun}\b`, "i"),
    new RegExp(String.raw`\b(?:officially\s+)?${endorsementVerb}\s+by\s+${provider}\b`, "i"),
    new RegExp(String.raw`\b(?:an?\s+)?(?:official\s+${provider}|${provider}[- ]${endorsementVerb})\s+${submittedArtifact}\b`, "i"),
    new RegExp(String.raw`\b${provider}\s+${endorsementNoun}\s+(?:was\s+|has\s+been\s+)?(?:received|granted|obtained)\b`, "i"),
    new RegExp(String.raw`\b${provider}\s+(?:recommends?|validated|recognizes?)\s+(?:this|the|our|my)\s+${submittedArtifact}\b`, "i"),
    new RegExp(String.raw`\b(?:this|the|our|my)\s+${submittedArtifact}\s+${stateVerb}\s+officially\s+recognized\s+by\s+${provider}\b`, "i")
  ];
}

function providerNegations(provider) {
  return [
    new RegExp(String.raw`\b(?:this\s+)?(?:${submittedArtifact})?\s*(?:was|is|has\s+been)?\s*not\s+(?:verified|approved|certified|official|endorsed|reviewed)\s+by\s+${provider}\b`, "gi"),
    new RegExp(String.raw`\b${provider}\s+(?:did|does|has|was|is)\s+not\s+(?:verify|approve|certify|endorse|review)(?:\s+or\s+(?:verify|approve|certify|endorse|review))*\b`, "gi"),
    new RegExp(String.raw`\bno\s+${provider}\s+(?:verification|approval|certification|endorsement|official\s+status)\s+(?:is|was|has\s+been)?\s*(?:claimed|granted|obtained|performed)?\b`, "gi"),
    new RegExp(String.raw`\b(?:does|do)\s+not\s+(?:constitute|imply)\s+${provider}\s+(?:verification|approval|certification|endorsement|official\s+status)\b`, "gi")
  ];
}

const providerRules = [
  {
    label: "OpenZeppelin audit, review or certification",
    forbidden: /\b(?:openzeppelin.{0,80}(?:audit|review|certif)|(?:audit|review|certif).{0,80}openzeppelin)\b/i,
    allowed: [
      /\b(?:this\s+)?(?:model|code|release|project|hook)?\s*(?:was|is|has\s+been)?\s*not\s+(?:audited|reviewed|certified)\s+by\s+openzeppelin\b/gi,
      /\bopenzeppelin\s+(?:did|does|has|was|is)\s+not\s+(?:audit|review|certify)(?:\s+or\s+(?:audit|review|certify))*\b/gi,
      /\bno\s+openzeppelin\s+(?:audit|review|certification)\s+(?:is|was|has\s+been)\s+(?:claimed|performed|completed)\b/gi
    ]
  },
  {
    label: "Uniswap verification, approval, certification or official status",
    forbidden: providerEndorsementPatterns("uniswap"),
    allowed: providerNegations("uniswap")
  },
  {
    label: "Programmable verification, approval, certification or official status",
    forbidden: providerEndorsementPatterns("programmable"),
    allowed: providerNegations("programmable")
  },
  {
    label: "Independent audit or certification",
    forbidden: [
      new RegExp(String.raw`\b${selfReference}\s+(?:${submittedArtifact}\s+)?${stateVerb}\s+(?:fully\s+|independently\s+|professionally\s+)?(?:audited|security[- ]reviewed|certified)\b`, "i"),
      new RegExp(String.raw`\b(?:the\s+)?${submittedArtifact}\s+${stateVerb}\s+(?:fully\s+|independently\s+|professionally\s+)?(?:audited|security[- ]reviewed|certified)\b`, "i"),
      /\b(?:independently|professionally|fully)\s+(?:audited|security[- ]reviewed|certified)\b/i,
      /\b(?:audited|security[- ]reviewed|certified)\s+by\s+[A-Za-z0-9][A-Za-z0-9 .&_-]{1,80}\b/i,
      /\b(?:security\s+)?audit\s+(?:was\s+|is\s+|has\s+been\s+)?(?:passed|complete|completed|finished)\b/i,
      /\bpassed\s+(?:an?\s+)?(?:(?:independent|professional|security)\s+)*(?:security\s+)?audit\b/i,
      /\bpassed\s+(?:an?\s+)?(?:trail\s+of\s+bits\s+|independent\s+|professional\s+)?(?:security\s+)?review\b/i,
      new RegExp(String.raw`\b(?:audited|certified)\s+${submittedArtifact}\b`, "i")
    ],
    allowed: [
      /\b(?:this\s+)?(?:application|builder|code|model|project|release|report|skill|submission|token|hook|platform)?\s*(?:was|is|has\s+been)?\s*not\s+(?:yet\s+)?(?:audited|security[- ]reviewed|certified)\b/gi,
      /\bno\s+(?:independent\s+|professional\s+|security\s+)?(?:audit|certification|security\s+review)\s+(?:is|was|has\s+been)?\s*(?:claimed|performed|completed|available)?\b/gi,
      /\b(?:does|do)\s+not\s+(?:constitute|imply)\s+(?:an?\s+)?(?:audit|certification|security\s+review)\b/gi,
      /\bnot\s+an?\s+(?:audit|certification|security\s+review)\b/gi,
      /\b(?:audit|certification|security\s+review)\s+(?:status\s*:\s*)?(?:blocked|not[- ]run|failed)\b/gi
    ]
  },
  {
    label: "Safety, rug-free or risk-free status",
    forbidden: [
      new RegExp(String.raw`\b${selfReference}\s+(?:${submittedArtifact}\s+)?${stateVerb}\s+(?:guaranteed\s+|provably\s+|fully\s+)?(?:safe|secure|risk[- ]free|rug[- ]free|unruggable)\b`, "i"),
      new RegExp(String.raw`\b(?:the\s+)?${submittedArtifact}\s+${stateVerb}\s+(?:guaranteed\s+|provably\s+|fully\s+)?(?:safe|secure|risk[- ]free|rug[- ]free|rug[- ]?proof|unruggable)\b`, "i"),
      /\b(?:rug[- ]free|unruggable|risk[- ]free)\b/i,
      /\brug[- ]?proof\b/i,
      /\b(?:cannot|can\s+never)\s+be\s+rugged\b/i,
      /\b(?:cannot|can\s+never)\s+rug(?:\s+(?:users?|holders?))?\b/i,
      /\b(?:there\s+is\s+)?no\s+way\s+to\s+rug(?:\s+(?:users?|holders?))?\b/i,
      /\bimmune\s+to\s+rug(?:\s+pulls?)?\b/i,
      /\b(?:impossible|not\s+possible)\s+to\s+rug\b/i,
      /\b(?:zero|no)\s+(?:rug|security|loss)\s+risk\b/i,
      /\b(?:100\s*%|completely|guaranteed|provably)\s+(?:safe|secure)\b/i,
      /\b(?:this|the|our|my)\s+(?:contract|code|hook|project)\s+(?:has|contains)\s+no\s+(?:known\s+)?vulnerabilit(?:y|ies)\b/i
    ],
    allowed: [
      /\b(?:is|are|was|were|remains?)\s+not\s+(?:safe|secure|risk[- ]free|rug[- ]free|rug[- ]?proof|unruggable)\b/gi,
      /\b(?:not|never)\s+(?:claim|claimed|claims|guarantee|guaranteed|described\s+as|called)\s+(?:to\s+be\s+|that\s+(?:it|this)\s+is\s+)?(?:safe|secure|risk[- ]free|rug[- ]free|unruggable)\b/gi,
      /\bno\s+(?:claim|guarantee)\s+(?:of|that)\s+(?:safety|security|[^.;\n]{0,40}(?:safe|secure|risk[- ]free|rug[- ]free|unruggable))\b/gi,
      /\b(?:does|do)\s+not\s+(?:make|mean|imply|prove)\s+(?:it|this|the\s+(?:application|builder|code|model|project|release|skill|submission|token|hook|platform))\s+(?:safe|secure|risk[- ]free|rug[- ]free|unruggable)\b/gi,
      /\b(?:do|does)\s+not\s+(?:call|label|describe|market|present)\s+(?:it|this|(?:this|the|our|my)\s+(?:application|builder|code|contract|model|project|release|skill|submission|token|hook|platform))\s+(?:as\s+)?(?:safe|secure|risk[- ]free|rug[- ]free|rug[- ]?proof|unruggable)\b/gi,
      /\b(?:do|does)\s+not\s+(?:promise|claim|guarantee)\s+(?:an?\s+)?(?:safe|secure|risk[- ]free|rug[- ]free|rug[- ]?proof|unruggable)(?:\s+design)?\b/gi,
      /\b(?:the\s+)?(?:term|word)\s+["']?(?:risk[- ]free|rug[- ]free|rug[- ]?proof|unruggable)["']?\s+(?:is\s+)?(?:forbidden|prohibited|not\s+allowed)\b/gi,
      /\b(?:a|the)\s+malicious\s+[^.;\n]{0,80}\s+(?:could|may|might)\s+(?:falsely\s+)?(?:call|label|describe|market|present)\s+(?:it|this|the\s+(?:application|code|contract|project|token|hook))\s+(?:as\s+)?(?:safe|secure|risk[- ]free|rug[- ]free|rug[- ]?proof|unruggable)\b/gi
    ]
  },
  {
    label: "Deployment, launch or availability",
    forbidden: [
      new RegExp(String.raw`\b${selfReference}\s+(?:${submittedArtifact}\s+)?${stateVerb}\s+(?:already\s+|now\s+|publicly\s+|production[- ]?)?(?:deployed|launched|live|available)\b`, "i"),
      new RegExp(String.raw`\b(?:the\s+)?${submittedArtifact}\s+${stateVerb}\s+(?:already\s+|now\s+|publicly\s+|production[- ]?)?(?:deployed|launched|live|available)\b`, "i"),
      new RegExp(String.raw`\b(?:this|our|my|the\s+(?:submitted|proposed))\s+${submittedArtifact}\s+(?:has\s+)?(?:launched|gone\s+live)\b`, "i"),
      new RegExp(String.raw`\b(?:the\s+)?(?:submitted|proposed)\s+${submittedArtifact}\s+(?:is\s+)?available\s+(?:now|today|for\s+use)\b`, "i"),
      new RegExp(String.raw`\b(?:the\s+)?${submittedArtifact}\s+(?:was\s+|is\s+|has\s+been\s+)?(?:deployed|launched|live|available)\s+(?:on|to|now|today|for\s+use)\b`, "i"),
      /\b(?:already\s+|now\s+)?live\s+on\s+(?:mainnet|production)\b/i,
      /\b(?:now|publicly)\s+available\b/i,
      /\bavailable\s+(?:now|today|for\s+use)\b/i,
      /\bproduction[- ]ready\b/i,
      /\bmainnet[- ]ready\b/i,
      new RegExp(String.raw`\b(?:this|the|our|my)\s+(?:contract|code|hook|project|token)\s+${stateVerb}\s+active\s+on\s+(?:ethereum\s+)?mainnet\b`, "i"),
      /\b(?:you\s+can|users?\s+can)\s+trade\s+(?:it|this|the\s+(?:hook|project|token))\s+now\b/i
    ],
    allowed: [
      new RegExp(String.raw`\b(?:this|our|my|the\s+(?:submitted|proposed))\s+(?:${submittedArtifact}\s+)?(?:was|is|has\s+been|remains)\s+not\s+(?:yet\s+)?(?:deployed|launched|live|available)\b`, "gi"),
      /\bno\s+(?:deployment|launch|availability)\s+(?:is|was|has\s+been)?\s*(?:claimed|performed|completed)?\b/gi,
      /\b(?:does|do)\s+not\s+(?:constitute|imply|prove)\s+(?:a\s+)?(?:deployment|launch|availability)\b/gi,
      /\bnot\s+(?:an?\s+)?(?:deployment|launch|availability)\b/gi,
      /\b(?:deployment|launch|availability)\s+(?:status\s*:\s*)?(?:blocked|not[- ]run|failed)\b/gi,
      /\bnot\s+(?:yet\s+|now\s+)?(?:live\s+on\s+(?:mainnet|production)|publicly\s+available|production[- ]ready)\b/gi
    ]
  }
];

export function findUnsupportedPublicClaims(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const findings = [];
  const normalized = normalizeConfusableText(text)
    .replace(/\[([^\]\n]{0,1000})\]\([^\n)]{0,1000}\)/gu, "$1")
    .replace(/\[([^\]\n]{0,1000})\]\[[^\]\n]{0,1000}\]/gu, "$1")
    .replace(/\\([\\`*_{}\[\]()#+.!~-])/gu, "$1")
    .replace(/[*_~`]/gu, "");
  const segments = normalized.replace(/\s+/gu, " ").split(/[.!?;]+/).map((segment) => segment.trim()).filter(Boolean);

  for (const segment of segments) {
    for (const rule of providerRules) {
      let remainder = segment;
      for (const allowed of rule.allowed) remainder = remainder.replace(allowed, " ");
      const forbiddenPatterns = Array.isArray(rule.forbidden) ? rule.forbidden : [rule.forbidden];
      if (forbiddenPatterns.some((pattern) => pattern.test(remainder)) && !findings.includes(rule.label)) findings.push(rule.label);
    }
  }
  if (findings.some((finding) => finding !== "Independent audit or certification" && /(?:audit|certification)/u.test(finding))) {
    const genericAuditIndex = findings.indexOf("Independent audit or certification");
    if (genericAuditIndex !== -1) findings.splice(genericAuditIndex, 1);
  }
  return findings;
}

export function extractPublicClaimText(source, extension) {
  if (typeof source !== "string" || source.length === 0) return "";
  const normalizedExtension = String(extension ?? "").toLowerCase();
  if (normalizedExtension === ".json") return extractJsonPublicText(source);
  if ([".yaml", ".yml"].includes(normalizedExtension)) return extractYamlPublicText(source);
  if ([".md", ".mdx", ".markdown"].includes(normalizedExtension)) return extractMarkdownPublicText(source);
  if ([".html", ".htm"].includes(normalizedExtension)) return extractHtmlPublicText(source);
  if ([".vue", ".svelte"].includes(normalizedExtension)) {
    const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)]
      .map((match) => extractJavascriptPublicText(match[1]));
    return [extractHtmlPublicText(source), ...scripts].filter(Boolean).join("\n");
  }
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(normalizedExtension)) {
    return extractJavascriptPublicText(source);
  }
  return source;
}

function extractJsonPublicText(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return "";
  }
  const strings = [];
  const pending = [value];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (typeof entry === "string") {
      strings.push(entry);
      continue;
    }
    if (Array.isArray(entry)) {
      for (let index = entry.length - 1; index >= 0; index -= 1) pending.push(entry[index]);
    } else if (entry && typeof entry === "object") {
      const items = Object.values(entry);
      for (let index = items.length - 1; index >= 0; index -= 1) pending.push(items[index]);
    }
  }
  return strings.join("\n");
}

function extractYamlPublicText(source) {
  const lines = source.split(/\r?\n/u);
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || /^(?:---|\.\.\.)$/u.test(trimmed)) continue;

    const separator = yamlMappingSeparator(line);
    let scalar = separator === -1 ? trimmed.replace(/^-\s+/u, "") : line.slice(separator + 1).trim();
    if (/^[>|][+-]?[0-9]?$/u.test(scalar)) {
      const indentation = leadingWhitespace(line);
      const block = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim().length > 0 && leadingWhitespace(next) <= indentation) break;
        index += 1;
        if (next.trim().length > 0) block.push(next.trim());
      }
      if (block.length > 0) values.push(block.join(" "));
      continue;
    }
    scalar = stripYamlComment(scalar).trim();
    if (scalar.length === 0 || scalar === "{}" || scalar === "[]") continue;
    values.push(decodeYamlScalar(scalar));
  }
  return values.join("\n");
}

function extractMarkdownPublicText(source) {
  const frontmatterMatch = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u);
  const frontmatter = frontmatterMatch ? extractYamlPublicText(frontmatterMatch[1]) : "";
  const body = (frontmatterMatch ? source.slice(frontmatterMatch[0].length) : source)
    .replace(/<!--[^]*?-->/gu, " ")
    .replace(/\{\/\*[^]*?\*\/\}/gu, " ")
    .replace(/^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[^]*?^ {0,3}\1\s*$/gmu, " ")
    .replace(/^ {4}.*$/gmu, " ")
    .replace(/^(?:import|export)\s+[^\n]*$/gmu, " ")
    .replace(/`[^`\n]*`/gu, " ");
  return [frontmatter, body].filter(Boolean).join("\n");
}

function yamlMappingSeparator(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && line[index + 1] === "'") index += 1;
        else quote = null;
      } else if (quote === '"' && character === "\\") index += 1;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === ":") return index;
  }
  return -1;
}

function stripYamlComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) {
        if (quote === "'" && value[index + 1] === "'") index += 1;
        else quote = null;
      } else if (quote === '"' && character === "\\") index += 1;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "#" && (index === 0 || /\s/u.test(value[index - 1]))) return value.slice(0, index);
  }
  return value;
}

function decodeYamlScalar(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function leadingWhitespace(value) {
  return value.match(/^\s*/u)?.[0].length ?? 0;
}

function extractHtmlPublicText(source) {
  const withoutCommentsOrCode = source
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, " ");
  const attributes = [...withoutCommentsOrCode.matchAll(/\b(?:alt|aria-label|content|placeholder|title)\s*=\s*(["'])(.*?)\1/giu)]
    .map((match) => decodeCommonEntities(match[2]));
  const visible = decodeCommonEntities(withoutCommentsOrCode.replace(/<[^>]*>/gu, " "));
  return [...attributes, visible].filter(Boolean).join("\n");
}

function extractJavascriptPublicText(source) {
  const literals = [];
  let visibleCode = "";
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (current === "/" && next === "/") {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline;
      visibleCode += " ";
      continue;
    }
    if (current === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? source.length : close + 2;
      visibleCode += " ";
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      const quote = current;
      let literal = "";
      index += 1;
      while (index < source.length) {
        const character = source[index];
        if (character === "\\") {
          const decoded = decodeJavascriptEscape(source, index);
          literal += decoded.value;
          index = decoded.nextIndex;
          continue;
        }
        if (character === quote) {
          index += 1;
          break;
        }
        literal += character;
        index += 1;
      }
      literals.push(literal);
      visibleCode += " ";
      continue;
    }
    visibleCode += current;
    index += 1;
  }
  const jsxText = [...visibleCode.matchAll(/>([^<>{}]{2,})</gu)].map((match) => match[1]);
  return [...literals, ...jsxText].filter(Boolean).join("\n");
}

function decodeJavascriptEscape(source, slashIndex) {
  const escaped = source[slashIndex + 1];
  if (escaped === undefined) return { value: "", nextIndex: source.length };
  const simple = new Map([["n", "\n"], ["r", "\r"], ["t", "\t"], ["b", "\b"], ["f", "\f"], ["v", "\v"]]);
  if (simple.has(escaped)) return { value: simple.get(escaped), nextIndex: slashIndex + 2 };
  if (escaped === "x") {
    const digits = source.slice(slashIndex + 2, slashIndex + 4);
    if (/^[0-9a-f]{2}$/iu.test(digits)) return { value: String.fromCodePoint(Number.parseInt(digits, 16)), nextIndex: slashIndex + 4 };
  }
  if (escaped === "u" && source[slashIndex + 2] === "{") {
    const close = source.indexOf("}", slashIndex + 3);
    const digits = close === -1 ? "" : source.slice(slashIndex + 3, close);
    if (/^[0-9a-f]{1,6}$/iu.test(digits) && Number.parseInt(digits, 16) <= 0x10ffff) {
      return { value: String.fromCodePoint(Number.parseInt(digits, 16)), nextIndex: close + 1 };
    }
  }
  if (escaped === "u") {
    const digits = source.slice(slashIndex + 2, slashIndex + 6);
    if (/^[0-9a-f]{4}$/iu.test(digits)) return { value: String.fromCodePoint(Number.parseInt(digits, 16)), nextIndex: slashIndex + 6 };
  }
  return { value: escaped, nextIndex: slashIndex + 2 };
}

function decodeCommonEntities(value) {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}
