export const MAX_TOKEN_NAME_BYTES = 48;
export const MAX_TOKEN_SYMBOL_BYTES = 12;
export const MAX_TOKEN_DESCRIPTION_BYTES = 280;
export const MAX_METADATA_URL_BYTES = 2_048;
export const MAX_SOCIAL_URL_BYTES = 512;
export const MAX_SOCIAL_EXTRA_DATA_BYTES = 1_200;

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
