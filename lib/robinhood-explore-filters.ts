export const LAUNCH_AGE_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const;

export const LAUNCH_SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
] as const;

export type RobinhoodExploreFilters = {
  age: typeof LAUNCH_AGE_OPTIONS[number]["value"];
  sort: typeof LAUNCH_SORT_OPTIONS[number]["value"];
};

export const DEFAULT_EXPLORE_FILTERS: RobinhoodExploreFilters = { age: "any", sort: "newest" };

export function activeExploreFilterCount(filters: RobinhoodExploreFilters) {
  return Number(filters.age !== "any") + Number(filters.sort !== "newest");
}

export function parseRobinhoodExploreQuery(query: URLSearchParams) {
  const page = query.get("page") ?? "1";
  const q = query.get("q") ?? "";
  const age = query.get("age") ?? "any";
  const sort = query.get("sort") ?? "newest";
  if ([...query.keys()].some((key) => !["page", "q", "age", "sort"].includes(key) || query.getAll(key).length !== 1)
    || !/^[1-9]\d{0,5}$/.test(page) || q.length > 128
    || !LAUNCH_AGE_OPTIONS.some((option) => option.value === age)
    || !LAUNCH_SORT_OPTIONS.some((option) => option.value === sort)) return null;
  return { page: Number(page), q, filters: { age, sort } as RobinhoodExploreFilters };
}
