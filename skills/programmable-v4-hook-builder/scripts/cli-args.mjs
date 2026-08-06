import process from "node:process";

export function parseCliOrExit(spec, argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${renderHelp(spec)}\n`);
    process.exit(0);
  }

  try {
    return parseCli(spec, argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${spec.command}: ${message}\n`);
    process.stderr.write(`Try '${spec.command} --help' for usage.\n`);
    process.exit(2);
  }
}

export function parseCli(spec, argv) {
  const definitions = new Map();
  for (const option of spec.options ?? []) {
    if (!/^--[a-z0-9]+(?:-[a-z0-9]+)*$/.test(option.name)) {
      throw new Error(`invalid option definition ${option.name}`);
    }
    if (!["boolean", "value"].includes(option.type)) {
      throw new Error(`invalid type for option ${option.name}`);
    }
    if (option.repeatable === true && option.type !== "value") {
      throw new Error(`repeatable option ${option.name} must take a value`);
    }
    definitions.set(option.name, option);
  }

  const options = Object.fromEntries(
    [...definitions.values()].map((option) => [
      option.key,
      option.repeatable === true ? [] : option.type === "boolean" ? false : null
    ])
  );
  const seen = new Set();
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    const separator = token.indexOf("=");
    const name = separator === -1 ? token : token.slice(0, separator);
    const inlineValue = separator === -1 ? null : token.slice(separator + 1);
    const definition = definitions.get(name);
    if (!definition) throw new Error(`unknown option ${name}`);
    if (seen.has(name) && definition.repeatable !== true) {
      throw new Error(`option ${name} may only be provided once`);
    }
    seen.add(name);

    if (definition.type === "boolean") {
      if (inlineValue !== null) throw new Error(`option ${name} does not take a value`);
      options[definition.key] = true;
      continue;
    }

    let value = inlineValue;
    if (value === null) {
      const candidate = argv[index + 1];
      if (candidate === undefined || candidate === "--" || candidate.startsWith("-")) {
        throw new Error(`option ${name} requires a value`);
      }
      value = candidate;
      index += 1;
    }
    if (value.length === 0) throw new Error(`option ${name} requires a non-empty value`);
    if (definition.repeatable === true) options[definition.key].push(value);
    else options[definition.key] = value;
  }

  const positional = spec.positionals ?? {};
  const minimum = positional.min ?? 0;
  const maximum = positional.max ?? minimum;
  if (positionals.length < minimum) {
    const label = positional.names?.[positionals.length] ?? "argument";
    throw new Error(`missing required argument <${label}>`);
  }
  if (positionals.length > maximum) {
    throw new Error(`unexpected argument ${positionals[maximum]}`);
  }

  return { options, positionals };
}

export function renderHelp(spec) {
  const lines = [`Usage: ${spec.usage}`];
  if (spec.summary) lines.push("", spec.summary);

  const options = [
    ...(spec.options ?? []),
    { name: "-h, --help", valueName: null, description: "Show this help message and exit." }
  ];
  if (options.length > 0) {
    const labels = options.map((option) => {
      const value = option.type === "value" ? ` <${option.valueName ?? "value"}>` : "";
      return `${option.name}${value}`;
    });
    const width = Math.max(...labels.map((label) => label.length));
    lines.push("", "Options:");
    for (let index = 0; index < options.length; index += 1) {
      lines.push(`  ${labels[index].padEnd(width)}  ${options[index].description}`);
    }
  }
  return lines.join("\n");
}
