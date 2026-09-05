import { describe, expect, it } from "vitest";
import { decodeAbiParameters } from "viem";

import {
  configurationFromForm,
  configurationSummary,
  createModuleModeState,
  defaultSchemaValue,
  feeBreakdown,
  parseExactUnits,
  PREVIEW_MODULE_CATALOG,
  setModuleSelected,
  validateModuleModeDraft,
  type ModuleModeCatalogEntry,
  type ModuleModeState,
  type OpenConfigSchema,
} from "@/lib/module-mode/builder";

function validState(): ModuleModeState {
  return { ...createModuleModeState(), name: "Garden", symbol: "GARDEN", initialBuyEth: "0.001" };
}

describe("Module Mode draft", () => {
  it("starts with a normal coin, no modules and the immutable extra 20 bps", () => {
    const result = validateModuleModeDraft(validState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.modules).toEqual([]);
    expect(result.draft.initialBuyWei).toBe("1000000000000000");
    expect(result.draft.fees).toEqual({ creatorBuyBps: 0, creatorSellBps: 0, programmableBps: 20, asset: "native-ETH" });
    expect(result.draft).toMatchObject({ chainId: 4663, status: "preview", launchable: false, onchainApproved: false, walletAuthorizationVerified: false });
    expect(JSON.stringify(result.draft)).not.toContain("implementation");
    expect(feeBreakdown("0", "10")).toEqual({ buy: "0.20%", sell: "10.20%", programmable: "0.20%" });
  });

  it("rejects invalid money and fee inputs without accepting rounded decimals", () => {
    for (const input of ["", "0", "-1", "1e-3", "Infinity", "0.0000000000000000001"]) {
      const result = validateModuleModeDraft({ ...validState(), initialBuyEth: input });
      expect(result.ok).toBe(false);
    }
    for (const fee of ["-1", "11", "0.5", "1e1"]) {
      const result = validateModuleModeDraft({ ...validState(), buyFeePercent: fee });
      expect(result.ok).toBe(false);
    }
    expect(parseExactUnits("0.000000000000000001", 18)).toBe("1");
    expect(parseExactUnits("9.99", 2)).toBe("999");
    expect(parseExactUnits("60", 0, "60")).toBe("3600");
    expect(() => parseExactUnits("9.999", 2)).toThrow("2 decimal places");
  });

  it("binds settings and preserves a removed module's complete configuration for undo", () => {
    const entry = PREVIEW_MODULE_CATALOG[0];
    const state = setModuleSelected(validState(), entry, true);
    state.moduleValues[entry.id] = { buyEnd: "0.5", sellEnd: "0", duration: "120" };
    const removed = setModuleSelected(state, entry, false);
    const restored = setModuleSelected(removed, entry, true);
    expect(restored.moduleValues).toEqual(state.moduleValues);
    expect(restored.selectedModules).toEqual([entry.id]);
    expect(setModuleSelected(restored, entry, true).selectedModules).toEqual([entry.id]);
    expect(entry.defaults).toEqual({ buyEnd: "0", sellEnd: "0", duration: "60" });
  });

  it("checks falling fees against the starting rates and encodes the exact legacy ABI order", () => {
    const entry = PREVIEW_MODULE_CATALOG[0];
    const zeroFee = setModuleSelected(validState(), entry, true);
    const failed = validateModuleModeDraft(zeroFee);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.issues.some((issue) => issue.message.includes("starting creator fee"))).toBe(true);
    const state = { ...zeroFee, buyFeePercent: "3", sellFeePercent: "5", moduleValues: { [entry.id]: { buyEnd: "1", sellEnd: "2", duration: "120" } } };
    const result = validateModuleModeDraft(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const selectedModule = result.draft.modules[0];
    expect(selectedModule.configuration).toEqual({ buyEnd: "100", sellEnd: "200", duration: "7200" });
    expect(decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], selectedModule.legacyConfigurationBytes!)).toEqual([100n, 200n, 7200n]);
    expect(selectedModule.configurationBytes).not.toEqual(selectedModule.legacyConfigurationBytes);
    expect(validateModuleModeDraft({ ...state, buyFeePercent: "0" }).ok).toBe(false);
    expect(state.moduleValues[entry.id]).toEqual({ buyEnd: "1", sellEnd: "2", duration: "120" });
  });

  it("enforces the timer bounds, at least one trade limit and the initial buy limit", () => {
    const falling = PREVIEW_MODULE_CATALOG[0]; const limits = PREVIEW_MODULE_CATALOG[1];
    const lowDuration = setModuleSelected({ ...validState(), buyFeePercent: "1" }, falling, true);
    lowDuration.moduleValues[falling.id] = { buyEnd: "0", sellEnd: "0", duration: "0" };
    expect(validateModuleModeDraft(lowDuration).ok).toBe(false);
    lowDuration.moduleValues[falling.id] = { buyEnd: "0", sellEnd: "0", duration: "43201" };
    expect(validateModuleModeDraft(lowDuration).ok).toBe(false);
    const state = setModuleSelected(validState(), limits, true);
    state.moduleValues[limits.id] = { buyLimit: "0", sellLimit: "0" };
    expect(validateModuleModeDraft(state).ok).toBe(false);
    state.moduleValues[limits.id] = { buyLimit: "0.0001", sellLimit: "0" };
    const result = validateModuleModeDraft(state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual({ path: "/initialBuyEth", message: "The initial buy exceeds the trade limits maximum. Reduce the buy or increase the limit." });
    state.moduleValues[limits.id] = { buyLimit: "0", sellLimit: "0.1" };
    expect(validateModuleModeDraft(state).ok).toBe(true);
  });

  it("combines both modules and binds changes to source metadata, fees and parameters", () => {
    let state = { ...validState(), buyFeePercent: "1", sellFeePercent: "2" };
    for (const entry of PREVIEW_MODULE_CATALOG) state = setModuleSelected(state, entry, true);
    const result = validateModuleModeDraft(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.modules).toHaveLength(2);
    const same = validateModuleModeDraft(JSON.parse(JSON.stringify(state)));
    expect(same).toEqual(result);
    const changed = validateModuleModeDraft({ ...state, buyFeePercent: "2" });
    if (!changed.ok) throw new Error("Expected valid changed draft");
    expect(changed.draft.draftId).not.toBe(result.draft.draftId);
    const changedCatalog = PREVIEW_MODULE_CATALOG.map((entry) => ({ ...entry, version: "2" }));
    const newVersion = validateModuleModeDraft(state, changedCatalog);
    if (!newVersion.ok) throw new Error("Expected valid changed version");
    expect(newVersion.draft.draftId).not.toBe(result.draft.draftId);
  });

  it("keeps stale module selections visible as errors and rejects duplicate catalog ids", () => {
    const state = { ...validState(), selectedModules: ["missing"] };
    const result = validateModuleModeDraft(state);
    expect(result.ok).toBe(false);
    expect(state.selectedModules).toEqual(["missing"]);
    expect(validateModuleModeDraft(validState(), [PREVIEW_MODULE_CATALOG[0], PREVIEW_MODULE_CATALOG[0]]).ok).toBe(false);
  });

  it("accepts a new nested schema with lists, optional values, variants and bound wallet roles", () => {
    const schema: OpenConfigSchema = {
      type: "record", required: ["recipients", "mode"], fields: {
        note: { type: "string", maxLength: 128 },
        recipients: { type: "array", minItems: 1, maxItems: 4, items: { type: "record", required: ["wallet", "share"], fields: { wallet: { type: "account" }, share: { type: "uint", max: "10000", unit: "bps" } } } },
        mode: { type: "variant", tag: "kind", variants: { immediate: { type: "record", fields: {}, required: [] }, timed: { type: "record", fields: { delay: { type: "uint", max: "100000", unit: "seconds" } }, required: ["delay"] } } },
      },
    };
    const entry: ModuleModeCatalogEntry = { id: "nested-example", title: "Nested example", summary: "Test fixture", detail: "Test fixture", status: "preview", version: "1", source: { path: "test/example", sha256: "0".repeat(64) }, schema, defaults: { recipients: [{ wallet: { role: "creator" }, share: "100" }], mode: { kind: "timed", delay: "5" } }, fields: { "/recipients/*/share": { decimals: 2, suffix: "%" }, "/mode/timed/delay": { multiplier: "60", suffix: "minutes" } } };
    const state = setModuleSelected(validState(), entry, true);
    const noRole = validateModuleModeDraft(state, [entry]);
    expect(noRole.ok).toBe(false);
    const result = validateModuleModeDraft(state, [entry], { roles: { creator: "0x1111111111111111111111111111111111111111" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.modules[0].configuration).toEqual({ recipients: [{ wallet: { role: "creator" }, share: "10000" }], mode: { kind: "timed", delay: "300" } });
    expect(result.draft.modules[0].bindings).toHaveLength(1);
    expect(result.draft.walletAuthorizationVerified).toBe(false);
    const rebound = validateModuleModeDraft(state, [entry], { roles: { creator: "0x2222222222222222222222222222222222222222" } });
    if (!rebound.ok) throw new Error("Expected valid rebound preview");
    expect(rebound.draft.draftId).not.toBe(result.draft.draftId);
    const summary = configurationSummary(schema, entry.defaults, entry.fields);
    expect(summary.some((row) => row.value === "100 %")).toBe(true);
    expect(summary.some((row) => row.value === "5 minutes")).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("[object Object]");
  });

  it("keeps incomplete form text while reporting its exact nested path", () => {
    const schema: OpenConfigSchema = { type: "record", required: ["amount"], fields: { amount: { type: "uint", max: "100" } } };
    const input = { amount: "." };
    try { configurationFromForm(schema, input); throw new Error("Expected conversion to fail"); }
    catch (error) { expect(error).toMatchObject({ path: "/amount" }); }
    expect(input.amount).toBe(".");
    expect(defaultSchemaValue({ type: "record", fields: { optional: { type: "string", maxLength: 10 } }, required: [] })).toEqual({});
  });
});
