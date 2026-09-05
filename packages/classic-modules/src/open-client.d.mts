import type { OpenHex } from './open-packages.mjs';
import type { MODULE_SUBMISSION_FORMAT, ModuleSubmissionRequest } from './open-transport.mjs';

export const MODULE_API_SCHEMA: 'programmable.modules.api.v0.1';
export const MODULE_API_CLIENT_LIMITS: Readonly<{ responseBytes: number; timeoutMs: 20000; pageSize: 20 }>;
export interface ModuleApiErrorDetails { httpStatus?: number; path?: string; retryAfterSeconds?: number; submissionMayExist?: boolean }
export class ModuleApiError extends Error implements ModuleApiErrorDetails {
  code: string; httpStatus?: number; path?: string; retryAfterSeconds?: number; submissionMayExist?: boolean;
  constructor(code: string, message: string, details?: ModuleApiErrorDetails);
}
export interface ModuleApiCapabilities {
  schemaVersion: typeof MODULE_API_SCHEMA;
  moduleContributions: { apiKeyIssuance: boolean; submissions: boolean };
  submissionFormat: typeof MODULE_SUBMISSION_FORMAT;
  limits: { httpBytes: number; sourceBytes: number; sourceFileBytes: number; sourceFiles: number; pageSize: number; requestSeconds: number; concurrentUploads: number };
  reviewAvailable: false; approved: false; available: false;
}
export interface ModuleSubmissionReceipt {
  submissionId: string; packageId: OpenHex; familyId: OpenHex; requestDigest: OpenHex;
  author: OpenHex; rewardWallet: OpenHex; totalSourceBytes: number; name: string; version: string; createdAt: string;
  supersedesSubmissionId: string | null;
  status: 'draft_received'; reviewStatus: 'unreviewed'; sourceBytesVerified: true; sourceRevisionVerified: false;
  buildVerified: false; runtimeVerified: false; approved: false; available: false;
}
export interface ModuleSubmissionResponse { schemaVersion: typeof MODULE_API_SCHEMA; submission: ModuleSubmissionReceipt }
export interface ModuleSubmissionPage { schemaVersion: typeof MODULE_API_SCHEMA; submissions: ModuleSubmissionReceipt[]; nextCursor: string | null }
export interface ModuleApiClient {
  capabilities(): Promise<ModuleApiCapabilities>;
  submit(request: ModuleSubmissionRequest, options: { idempotencyKey: string }): Promise<ModuleSubmissionResponse & { idempotent: boolean }>;
  status(submissionId: string): Promise<ModuleSubmissionResponse>;
  list(options?: { cursor?: string }): Promise<ModuleSubmissionPage>;
}
/** Node-only. Authentication is never sent to capabilities or to redirected origins. No automatic retries. */
export function createModuleApiClient(options: { apiOrigin: string; apiKey?: string; timeoutMs?: number }): ModuleApiClient;
export function validateModuleApiOrigin(input: string): string;
