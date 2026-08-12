const confusableCharacters = new Map(Object.entries({
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0397": "H", "\u0399": "I", "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u039f": "O", "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X",
  "\u03b1": "a", "\u03b2": "b", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k", "\u03bd": "v", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "y", "\u03c7": "x",
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u0406": "I", "\u041a": "K", "\u041c": "M", "\u041d": "H", "\u041e": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0405": "S", "\u042c": "b",
  "\u0430": "a", "\u0435": "e", "\u0456": "i", "\u0458": "j", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0443": "y", "\u044c": "b"
}));

const invisibleOrBidiPattern = /[\p{Control}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}\p{Private_Use}\p{Surrogate}\p{Noncharacter_Code_Point}\u2028\u2029]/u;
const invisibleOrBidiGlobalPattern = /[\p{Control}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}\p{Private_Use}\p{Surrogate}\p{Noncharacter_Code_Point}\u2028\u2029]/gu;
const mappedConfusablePattern = /[\u0391-\u03c7\u0405\u0406\u0410-\u0458]/u;
const latinPattern = /\p{Script=Latin}/u;
const greekPattern = /\p{Script=Greek}/u;
const cyrillicPattern = /\p{Script=Cyrillic}/u;

export function normalizeConfusableText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0391-\u03c7\u0405\u0406\u0410-\u0458]/gu, (character) => confusableCharacters.get(character) ?? character)
    .replace(invisibleOrBidiGlobalPattern, "")
    .replace(/[’‘]/gu, "'")
    .replace(/[‐‑‒–—]/gu, "-");
}

export function hasForbiddenInvisibleOrBidi(value) {
  return typeof value === "string" && invisibleOrBidiPattern.test(value);
}

export function publicIdentityKey(value) {
  return normalizeConfusableText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^a-z0-9]+/gu, "");
}

export const PROTECTED_PROVIDER_IDENTITIES = Object.freeze([
  { id: "dexscreener", aliases: ["Dexscreener", "Dex Screener", "Dex-Screener"] },
  { id: "fomo", aliases: ["Fomo", "Fomo app", "Fomo-app"] },
  { id: "gmgn", aliases: ["GMGN", "GMGN.AI", "GMGN AI"] },
  { id: "openzeppelin", aliases: ["OpenZeppelin", "Open Zeppelin"] },
  { id: "programmable", aliases: ["Programmable"] },
  { id: "uniswap", aliases: ["Uniswap"] }
].map((identity) => Object.freeze({
  id: identity.id,
  aliases: Object.freeze([...identity.aliases])
})));

export const PROTECTED_PROVIDER_KEYS = Object.freeze(new Set(
  PROTECTED_PROVIDER_IDENTITIES.flatMap(({ aliases }) => aliases.map(publicIdentityKey))
));

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
    hasInvisibleOrBidi: hasForbiddenInvisibleOrBidi(value),
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
