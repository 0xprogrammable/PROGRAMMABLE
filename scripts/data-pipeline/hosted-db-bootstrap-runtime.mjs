/** Historical candidate bootstrap is not an executable production path. */
export async function createBootstrapPlan() {
  throw new Error(
    "historical candidate bootstrap is retired; use the canonical read-model release procedure",
  );
}
