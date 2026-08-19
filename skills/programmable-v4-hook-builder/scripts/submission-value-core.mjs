export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
