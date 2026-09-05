import { encodeAbiParameters, sha256, stringToHex } from "viem";

import {
  compileOpenConfig,
  type OpenConfigContext,
  type OpenConfigSchema,
  type OpenConfigValue,
} from "@/packages/classic-modules/src/open-config.mjs";
import {
  evaluateOpenConstraints,
  type OpenConstraint,
} from "@/packages/classic-modules/src/open-constraints.mjs";

export type { OpenConfigContext, OpenConfigSchema, OpenConfigValue };
export type FormValue = string | boolean | FormValue[] | { [key: string]: FormValue };
export type FieldDisplay = { suffix?: string; decimals?: number; multiplier?: string; placeholder?: string };

/** Inert catalog data. A preview entry is not an admitted or deployed module. */
export interface ModuleModeCatalogEntry {
  id: string;
  title: string;
  summary: string;
  detail: string;
  version: string;
  status: "preview" | "available";
  source: { path: string; sha256: string };
  schema: OpenConfigSchema;
  defaults: FormValue;
  fields?: Record<string, FieldDisplay>;
  constraints?: OpenConstraint[];
  /** Explicit legacy ABI order; the open schema codec uses its own canonical field order. */
  legacyUint256Order?: string[];
  initialBuyLimitField?: string;
}

export interface ModuleModeState {
  name: string;
  symbol: string;
  description: string;
  initialBuyEth: string;
  buyFeePercent: string;
  sellFeePercent: string;
  selectedModules: string[];
  moduleValues: Record<string, FormValue>;
}
export interface BuilderIssue { path: string; message: string }
export interface ModuleModeDraft {
  format: "programmable.module-mode.draft.v0.1";
  status: "preview";
  launchable: false;
  onchainApproved: false;
  walletAuthorizationVerified: false;
  chainId: 4663;
  quoteAsset: "native-ETH";
  token: { name: string; symbol: string; description: string };
  initialBuyWei: string;
  fees: { creatorBuyBps: number; creatorSellBps: number; programmableBps: 20; asset: "native-ETH" };
  modules: Array<{
    id: string;
    version: string;
    catalogDigest: `0x${string}`;
    source: ModuleModeCatalogEntry["source"];
    configuration: OpenConfigValue;
    configurationBytes: `0x${string}`;
    bindings: ReturnType<typeof compileOpenConfig>["bindings"];
    legacyConfigurationBytes?: `0x${string}`;
  }>;
  draftId: `0x${string}`;
}
export type DraftResult = { ok: true; draft: ModuleModeDraft } | { ok: false; issues: BuilderIssue[] };

const uint = (label: string, max: string, unit: string, min = "0"): OpenConfigSchema => ({ type: "uint", label, max, min, unit });
const ref = (instance: string, key: string) => ({ ref: { instance, path: [key] } });
const baseSchema: OpenConfigSchema = {
  type: "record", required: ["buyCreatorFeeBps", "sellCreatorFeeBps"],
  fields: {
    buyCreatorFeeBps: uint("Buy creator fee", "1000", "bps"),
    sellCreatorFeeBps: uint("Sell creator fee", "1000", "bps"),
  },
};

export const PREVIEW_MODULE_CATALOG: readonly ModuleModeCatalogEntry[] = [
  {
    id: "falling-creator-fee-v1", title: "Falling fees", version: "1",
    summary: "Let your creator fees decrease over time.",
    detail: "Fees decrease linearly from your starting rates to the targets below. The 0.20% Programmable fee stays the same.",
    status: "preview",
    source: { path: "contracts/src/classic-modules/modules/FallingCreatorFeeV1.sol", sha256: "6a2702f1fe77386280a5964b0c711e4cbe86c775a1eded31d014a4eb9be7d26f" },
    schema: {
      type: "record", required: ["buyEnd", "sellEnd", "duration"],
      fields: {
        buyEnd: uint("Final buy fee", "1000", "bps"),
        sellEnd: uint("Final sell fee", "1000", "bps"),
        duration: { ...uint("Reach the final fees after", "2592000", "seconds", "60"), help: "From 1 minute to 43,200 minutes (30 days)." },
      },
    },
    defaults: { buyEnd: "0", sellEnd: "0", duration: "60" },
    fields: {
      "/buyEnd": { suffix: "%", decimals: 2 },
      "/sellEnd": { suffix: "%", decimals: 2 },
      "/duration": { suffix: "minutes", multiplier: "60" },
    },
    constraints: [
      { id: "buy-target", message: "The final buy fee must be at or below your starting buy fee.", left: ref("$self", "buyEnd"), operator: "lte", right: ref("base", "buyCreatorFeeBps") },
      { id: "sell-target", message: "The final sell fee must be at or below your starting sell fee.", left: ref("$self", "sellEnd"), operator: "lte", right: ref("base", "sellCreatorFeeBps") },
      { id: "must-decrease", message: "Set at least one starting creator fee above its final fee.", left: { add: [ref("$self", "buyEnd"), ref("$self", "sellEnd")] }, operator: "lt", right: { add: [ref("base", "buyCreatorFeeBps"), ref("base", "sellCreatorFeeBps")] } },
    ],
    legacyUint256Order: ["buyEnd", "sellEnd", "duration"],
  },
  {
    id: "quote-trade-limit-v1", title: "Trade limits", version: "1",
    summary: "Set the maximum ETH amount per trade.",
    detail: "Limits include fees. Set 0 for no limit on that side. Traders can split orders; this does not guarantee protection from snipers.",
    status: "preview",
    source: { path: "contracts/src/classic-modules/modules/QuoteTradeLimitV1.sol", sha256: "6c02de7047a0965540eb03e27cdf767e3913befd9c35b5c8c4690efcbfd2eb38" },
    schema: {
      type: "record", required: ["buyLimit", "sellLimit"],
      fields: {
        buyLimit: uint("Maximum buy", "170141183460469231731687303715884105727", "ETH.wei"),
        sellLimit: uint("Maximum sell", "170141183460469231731687303715884105727", "ETH.wei"),
      },
    },
    defaults: { buyLimit: "1", sellLimit: "0" },
    fields: { "/buyLimit": { suffix: "ETH", decimals: 18 }, "/sellLimit": { suffix: "ETH", decimals: 18 } },
    constraints: [{ id: "one-limit", message: "Set a buy or sell limit above 0 ETH, or remove this module.", left: { add: [ref("$self", "buyLimit"), ref("$self", "sellLimit")] }, operator: "gt", right: { literal: "0", unit: "ETH.wei" } }],
    legacyUint256Order: ["buyLimit", "sellLimit"],
    initialBuyLimitField: "buyLimit",
  },
];

export function createModuleModeState(): ModuleModeState {
  return { name: "", symbol: "", description: "", initialBuyEth: "", buyFeePercent: "0", sellFeePercent: "0", selectedModules: [], moduleValues: {} };
}

export function cloneFormValue<T extends FormValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultSchemaValue(schema: OpenConfigSchema): FormValue {
  switch (schema.type) {
    case "record": return Object.fromEntries(schema.required.map((key) => [key, defaultSchemaValue(schema.fields[key])]));
    case "array": return Array.from({ length: schema.minItems ?? 0 }, () => defaultSchemaValue(schema.items));
    case "variant": { const branch = Object.keys(schema.variants)[0]; return { [schema.tag]: branch, ...asFormRecord(defaultSchemaValue(schema.variants[branch])) }; }
    case "bool": return false;
    case "account": return { address: "" };
    case "asset": return { asset: "" };
    case "component": return { component: "" };
    case "uint": return String(schema.min ?? "0");
    case "bytes": return "0x";
    default: return "";
  }
}
export function asFormRecord(value: FormValue | undefined): Record<string, FormValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function setModuleSelected(state: ModuleModeState, entry: ModuleModeCatalogEntry, selected: boolean): ModuleModeState {
  return {
    ...state,
    selectedModules: selected ? [...new Set([...state.selectedModules, entry.id])] : state.selectedModules.filter((id) => id !== entry.id),
    moduleValues: Object.hasOwn(state.moduleValues, entry.id) ? state.moduleValues : { ...state.moduleValues, [entry.id]: cloneFormValue(entry.defaults) },
  };
}

export function parseExactUnits(input: string, decimals = 0, multiplier = "1"): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77 || !/^[1-9]\d{0,77}$/.test(multiplier)) throw new Error("Invalid field display settings.");
  const value = input.trim();
  if (value.length > 160 || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Enter a positive number or 0. Use a dot for decimals.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(decimals === 0 ? "Enter a whole number." : `Use no more than ${decimals} decimal places.`);
  return (BigInt(`${whole}${fraction.padEnd(decimals, "0")}`) * BigInt(multiplier)).toString();
}

function pathKey(path: string, key: string | number) { return `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`; }

/** Converts display units without floating-point math, retaining invalid text in the form. */
export function configurationFromForm(schema: OpenConfigSchema, value: FormValue, fields: Record<string, FieldDisplay> = {}, path = "", schemaPath = ""): FormValue {
  if (schema.type === "uint") {
    try {
      if (typeof value !== "string") throw new Error("Enter a number.");
      const display = fields[schemaPath];
      return parseExactUnits(value, display?.decimals, display?.multiplier);
    } catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Check this number."), { path }); }
  }
  if (schema.type === "record") {
    const record = asFormRecord(value);
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, schema.fields[key] ? configurationFromForm(schema.fields[key], child, fields, pathKey(path, key), pathKey(schemaPath, key)) : child]));
  }
  if (schema.type === "array" && Array.isArray(value)) return value.map((child, index) => configurationFromForm(schema.items, child, fields, pathKey(path, index), `${schemaPath}/*`));
  if (schema.type === "variant") {
    const record = asFormRecord(value);
    const branch = record[schema.tag];
    if (typeof branch !== "string" || !schema.variants[branch]) return value;
    const children = { ...record }; delete children[schema.tag];
    return { [schema.tag]: branch, ...asFormRecord(configurationFromForm(schema.variants[branch], children, fields, path, `${schemaPath}/${branch}`)) };
  }
  return value;
}

export function feeBreakdown(buyPercent: string, sellPercent: string) {
  function total(value: string) { return /^(?:[0-9]|10)$/.test(value) ? `${Number(value)}.20%` : "—"; }
  return { buy: total(buyPercent), sell: total(sellPercent), programmable: "0.20%" };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** A local configuration check, never release, admission, price or wallet authorization evidence. */
export function validateModuleModeDraft(state: ModuleModeState, catalog: readonly ModuleModeCatalogEntry[] = PREVIEW_MODULE_CATALOG, context: OpenConfigContext = {}): DraftResult {
  const issues: BuilderIssue[] = [];
  const name = state.name.trim(); const symbol = state.symbol.trim(); const description = state.description.trim();
  if (!name || new TextEncoder().encode(name).length > 64) issues.push({ path: "/name", message: "Enter a token name of up to 64 UTF-8 bytes." });
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) issues.push({ path: "/symbol", message: "Use 1–12 letters or numbers for the symbol." });
  if (new TextEncoder().encode(description).length > 2000) issues.push({ path: "/description", message: "Keep the description within 2,000 UTF-8 bytes." });
  let initialBuyWei = "0";
  try { initialBuyWei = parseExactUnits(state.initialBuyEth, 18); if (BigInt(initialBuyWei) <= 0n || BigInt(initialBuyWei) > (1n << 127n) - 1n) throw new Error(); }
  catch { issues.push({ path: "/initialBuyEth", message: "Enter an ETH amount above 0, with up to 18 decimal places." }); }
  for (const [key, value] of [["buyFeePercent", state.buyFeePercent], ["sellFeePercent", state.sellFeePercent]]) {
    if (!/^(?:[0-9]|10)$/.test(value)) issues.push({ path: `/${key}`, message: "Choose a whole percentage from 0% to 10%." });
  }
  const creatorBuyBps = Number(state.buyFeePercent) * 100;
  const creatorSellBps = Number(state.sellFeePercent) * 100;
  const modules: ModuleModeDraft["modules"] = [];
  if (new Set(state.selectedModules).size !== state.selectedModules.length) issues.push({ path: "/modules", message: "A module appears more than once. Remove its duplicate." });
  const seenCatalogIds = new Set<string>();
  for (const entry of catalog) {
    if (seenCatalogIds.has(entry.id)) issues.push({ path: "/modules", message: "The module catalog contains duplicate entries. Refresh before reviewing." });
    seenCatalogIds.add(entry.id);
  }
  for (const id of state.selectedModules) {
    const entry = catalog.find((candidate) => candidate.id === id);
    if (!entry) { issues.push({ path: `/modules/${id}`, message: "This module is missing from the current catalog. Your settings are kept." }); continue; }
    try {
      const value = state.moduleValues[id];
      if (value === undefined) throw new Error("Add the module settings.");
      const config = compileOpenConfig(entry.schema, configurationFromForm(entry.schema, value, entry.fields), context);
      if (!issues.some((issue) => issue.path.endsWith("FeePercent"))) {
        const constraints = evaluateOpenConstraints(entry.constraints ?? [], {
          $self: { schema: entry.schema, value: config.value },
          base: { schema: baseSchema, value: { buyCreatorFeeBps: String(creatorBuyBps), sellCreatorFeeBps: String(creatorSellBps) } },
        });
        issues.push(...constraints.violations.map((violation) => ({ path: `/modules/${id}`, message: violation.message })));
      }
      const record = config.value as Record<string, OpenConfigValue>;
      if (entry.initialBuyLimitField) {
        const limit = BigInt(String(record[entry.initialBuyLimitField]));
        if (limit > 0n && BigInt(initialBuyWei) > limit) issues.push({ path: "/initialBuyEth", message: `The initial buy exceeds the ${entry.title.toLowerCase()} maximum. Reduce the buy or increase the limit.` });
      }
      const legacyConfigurationBytes = entry.legacyUint256Order ? encodeAbiParameters(entry.legacyUint256Order.map(() => ({ type: "uint256" })), entry.legacyUint256Order.map((key) => BigInt(String(record[key])))) : undefined;
      modules.push({ id, version: entry.version, catalogDigest: sha256(stringToHex(stableJson(entry))), source: entry.source, configuration: config.value, configurationBytes: config.encoded, bindings: config.bindings, ...(legacyConfigurationBytes ? { legacyConfigurationBytes } : {}) });
    } catch (error) {
      const detail = error as { path?: string; message?: string };
      issues.push({ path: `/modules/${id}${detail.path ?? ""}`, message: detail.message ?? "Check the module settings." });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  const draft = {
    format: "programmable.module-mode.draft.v0.1" as const, status: "preview" as const,
    launchable: false as const, onchainApproved: false as const, walletAuthorizationVerified: false as const,
    chainId: 4663 as const, quoteAsset: "native-ETH" as const,
    token: { name, symbol, description }, initialBuyWei,
    fees: { creatorBuyBps, creatorSellBps, programmableBps: 20 as const, asset: "native-ETH" as const },
    modules,
  };
  return { ok: true, draft: { ...draft, draftId: sha256(stringToHex(stableJson(draft))) } };
}

export function configurationSummary(schema: OpenConfigSchema, value: FormValue, fields: Record<string, FieldDisplay> = {}, title = "Configuration", path = ""): { label: string; value: string }[] {
  const label = schema.label ?? title;
  if (schema.type === "record") {
    const record = asFormRecord(value);
    return Object.entries(schema.fields).flatMap(([key, child]) => Object.hasOwn(record, key) ? configurationSummary(child, record[key], fields, key, `${path}/${key}`) : []);
  }
  if (schema.type === "array" && Array.isArray(value)) return value.flatMap((child, index) => configurationSummary(schema.items, child, fields, `${label} ${index + 1}`, `${path}/*`).map((item) => ({ ...item, label: `${label} ${index + 1} · ${item.label}` })));
  if (schema.type === "variant") {
    const record = asFormRecord(value); const branch = String(record[schema.tag]); const branchSchema = schema.variants[branch];
    return [{ label, value: branchSchema?.label ?? branch }, ...(branchSchema ? configurationSummary(branchSchema, record, fields, label, `${path}/${branch}`) : [])];
  }
  if (schema.type === "account") { const record = asFormRecord(value); return [{ label, value: typeof record.role === "string" ? `Role: ${record.role}` : String(record.address ?? "") }]; }
  if (schema.type === "asset" || schema.type === "component") return [{ label, value: String(asFormRecord(value)[schema.type] ?? "") }];
  return [{ label, value: schema.type === "bool" ? value ? "On" : "Off" : `${String(value)}${fields[path]?.suffix ? ` ${fields[path].suffix}` : ""}` }];
}
