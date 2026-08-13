/** Historical candidate ingestion is not an executable production path. */
export async function runConfiguredCandidateRawBackfill() {
  throw new Error(
    "historical candidate cutover is retired; use the canonical read-model release procedure",
  );
}
