export interface OpenConfigMetadata { label?: string; help?: string }
export type OpenConfigUintInput = string | number;
export interface OpenRecordSchema extends OpenConfigMetadata {
  type: 'record'; fields: Record<string, OpenConfigSchema>; required: string[];
}
export type OpenConfigSchema = OpenRecordSchema
  | (OpenConfigMetadata & { type: 'array'; items: OpenConfigSchema; minItems?: number; maxItems: number })
  | (OpenConfigMetadata & { type: 'uint'; bits?: number; min?: OpenConfigUintInput; max?: OpenConfigUintInput; unit?: string })
  | (OpenConfigMetadata & { type: 'bool' | 'address' | 'account' | 'asset' | 'component' })
  | (OpenConfigMetadata & { type: 'string' | 'bytes'; maxLength: number })
  | (OpenConfigMetadata & { type: 'variant'; tag: string; variants: Record<string, OpenRecordSchema> });
export class OpenConfigError extends Error {
  code: string; path: string;
  constructor(code: string, path: string, message: string);
}
export const OPEN_CONFIG_LIMITS: Readonly<{
  schemaDepth: 12; schemaNodes: 512; recordFields: 64; variantBranches: 64; arrayItems: 256;
  stringBytes: 16384; bytesLength: 16384; schemaBytes: 65536; valueBytes: 131072;
  contextBytes: 131072; jsonDepth: 32; jsonNodes: 16384; encodedBytes: 262144;
}>;
/** Throws OpenConfigError with a JSON-pointer path; never executes schema-provided code. */
export function assertOpenConfigSchema(schema: unknown): asserts schema is OpenConfigSchema;
