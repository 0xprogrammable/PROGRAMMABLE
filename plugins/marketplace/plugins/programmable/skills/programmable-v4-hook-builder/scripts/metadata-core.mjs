const confusableCharacters = new Map(Object.entries({
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0397": "H", "\u0399": "I", "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u039f": "O", "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X",
  "\u03b1": "a", "\u03b2": "b", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k", "\u03bd": "v", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "y", "\u03c7": "x",
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u0406": "I", "\u041a": "K", "\u041c": "M", "\u041d": "H", "\u041e": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0405": "S", "\u042c": "b",
  "\u0430": "a", "\u0435": "e", "\u0456": "i", "\u0458": "j", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0443": "y", "\u044c": "b"
}));

const invisibleOrBidiPattern = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;
const mappedConfusablePattern = /[\u0391-\u03c7\u0405\u0406\u0410-\u0458]/u;
const latinPattern = /\p{Script=Latin}/u;
const greekPattern = /\p{Script=Greek}/u;
const cyrillicPattern = /\p{Script=Cyrillic}/u;

export const PROTECTED_PROVIDER_KEYS = Object.freeze(new Set([
  "openzeppelin",
  "programmable",
  "uniswap"
]));

export function normalizeConfusableText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0391-\u03c7\u0405\u0406\u0410-\u0458]/gu, (character) => confusableCharacters.get(character) ?? character)
    .replace(/[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "")
    .replace(/[’‘]/gu, "'")
    .replace(/[‐‑‒–—]/gu, "-");
}

export function publicIdentityKey(value) {
  return normalizeConfusableText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^a-z0-9]+/gu, "");
}

export function inspectPublicMetadataText(value) {
  if (typeof value !== "string") {
    return Object.freeze({
      hasCompatibilityCharacters: false,
      hasConfusableCharacters: false,
      hasInvisibleOrBidi: false,
      identityKey: "",
      mixedConfusableScripts: false
    });
  }
  const scripts = [latinPattern, greekPattern, cyrillicPattern].filter((pattern) => pattern.test(value)).length;
  const mixedConfusableScripts = scripts > 1 && latinPattern.test(value) && (greekPattern.test(value) || cyrillicPattern.test(value));
  const identityKey = publicIdentityKey(value);
  return Object.freeze({
    hasCompatibilityCharacters: value.normalize("NFKC") !== value,
    hasConfusableCharacters: mixedConfusableScripts || (mappedConfusablePattern.test(value) && PROTECTED_PROVIDER_KEYS.has(identityKey)),
    hasInvisibleOrBidi: invisibleOrBidiPattern.test(value),
    identityKey,
    mixedConfusableScripts
  });
}

export function publicResourceUriKind(value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("ipfs://") || value.startsWith("ar://")) return "content-addressed";
  if (value.startsWith("https://")) return "https";
  return "unsupported";
}
