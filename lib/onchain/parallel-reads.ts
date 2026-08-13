type ParallelRead = () => Promise<unknown>;

type ParallelReadValues<Reads extends readonly ParallelRead[]> = {
  -readonly [Index in keyof Reads]: Awaited<ReturnType<Reads[Index]>>;
};

export async function settleParallelReadsInOrder<
  const Reads extends readonly ParallelRead[],
>(reads: Reads): Promise<ParallelReadValues<Reads>> {
  const results = await Promise.allSettled(reads.map((read) => read()));
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
  return results.map((result) =>
    result.status === "fulfilled" ? result.value : undefined,
  ) as ParallelReadValues<Reads>;
}
