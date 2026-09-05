export function developerApiKeysInitialSection(
  searchParams: Record<string, string | string[] | undefined>,
) {
  return searchParams.start === "custom"
    && searchParams.chainId === "4663"
    ? "launch" as const
    : "keys" as const;
}
