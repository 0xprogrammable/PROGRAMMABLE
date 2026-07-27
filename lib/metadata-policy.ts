export const MAX_TOKEN_NAME_BYTES = 48;
export const MAX_TOKEN_SYMBOL_BYTES = 12;
export const MAX_TOKEN_DESCRIPTION_BYTES = 280;
export const MAX_METADATA_URL_BYTES = 2_048;
export const MAX_SOCIAL_URL_BYTES = 512;
export const MAX_SOCIAL_EXTRA_DATA_BYTES = 1_200;
export const MAX_TOKEN_NAME_CHARACTERS = 32;
export const MAX_TOKEN_SYMBOL_CHARACTERS = 10;

const unsafeDisplayCharacters =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/u;
const tokenSymbolPattern = /^[A-Z0-9]+$/;

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function characterLength(value: string) {
  return Array.from(value).length;
}

export function hasUnsafeDisplayCharacters(value: string) {
  return unsafeDisplayCharacters.test(value);
}

export function isValidTokenSymbol(value: string) {
  return (
    characterLength(value) <= MAX_TOKEN_SYMBOL_CHARACTERS &&
    tokenSymbolPattern.test(value)
  );
}
