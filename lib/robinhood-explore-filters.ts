export const LAUNCH_SORT_OPTIONS = [
  { value: "highest", label: "Highest market cap" },
  { value: "lowest", label: "Lowest market cap" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
] as const;

export type RobinhoodExploreFilters = {
  sort: typeof LAUNCH_SORT_OPTIONS[number]["value"];
};

export const DEFAULT_EXPLORE_FILTERS: RobinhoodExploreFilters = { sort: "highest" };

export function activeExploreFilterCount(filters: RobinhoodExploreFilters) {
  return Number(filters.sort !== DEFAULT_EXPLORE_FILTERS.sort);
}

export function parseRobinhoodExploreQuery(query: URLSearchParams) {
  const page = query.get("page") ?? "1";
  const q = query.get("q") ?? "";
  const sort = query.get("sort") ?? DEFAULT_EXPLORE_FILTERS.sort;
  if ([...query.keys()].some((key) => !["page", "q", "sort"].includes(key) || query.getAll(key).length !== 1)
    || !/^[1-9]\d{0,5}$/.test(page) || q.length > 128
    || !LAUNCH_SORT_OPTIONS.some((option) => option.value === sort)) return null;
  return { page: Number(page), q, filters: { sort } as RobinhoodExploreFilters };
}
