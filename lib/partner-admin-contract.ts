export const PARTNER_ADMIN_SCHEMA_V1 =
  "programmable.partner-admin.v1" as const;

export const PARTNER_ROOT_KEY_SCOPES_V1 = Object.freeze([
  "custom-launch:create",
  "custom-launch:read",
  "partner-subkeys:manage",
] as const);

export type PartnerRootKeyScopeV1 =
  (typeof PARTNER_ROOT_KEY_SCOPES_V1)[number];

export type PartnerBudgetsV1 = Readonly<{
  prepareRequestsPerHour: number;
  readRequestsPerMinute: number;
  subkeyAdminRequestsPerHour: number;
}>;

export const PARTNER_BUDGET_LIMITS_V1 = Object.freeze({
  prepareRequestsPerHour: 10_000,
  readRequestsPerMinute: 10_000,
  subkeyAdminRequestsPerHour: 1_000,
} as const);

export const PARTNER_ADMIN_LIST_LIMITS_V1 = Object.freeze({
  maximumPartners: 500,
  maximumRootKeysPerPartner: 500,
  defaultPageSize: 12,
  maximumPageSize: 24,
} as const);

export type PartnerRootKeySummaryV1 = Readonly<{
  id: string;
  partnerId: string;
  keyId: string;
  label: string;
  keyPrefix: string;
  scopes: readonly PartnerRootKeyScopeV1[];
  budgets: PartnerBudgetsV1;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  rotatedFromRootKeyId: string | null;
}>;

export type PartnerSummaryV1 = Readonly<{
  id: string;
  slug: string;
  displayName: string;
  publicUrl: string | null;
  status: "active" | "suspended" | "revoked";
  createdAt: string;
  updatedAt: string;
  suspendedAt: string | null;
  revokedAt: string | null;
  rootKeys: readonly PartnerRootKeySummaryV1[];
}>;

export type PartnerRootKeyMutationV1 = Readonly<{
  partner?: PartnerSummaryV1;
  rootKey: PartnerRootKeySummaryV1;
  secretState: "delivered-once" | "already-delivered";
  rootKeySecret?: string;
  rotatedRootKeyId?: string;
}>;

export type PartnerListPaginationV1 = Readonly<{
  page: number;
  pageSize: number;
  totalPartners: number;
  totalPages: number;
}>;

export type PartnerListPageV1 = Readonly<{
  partners: readonly PartnerSummaryV1[];
  pagination: PartnerListPaginationV1;
}>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const keyIdPattern = /^[A-Za-z0-9_-]{22}$/u;
const rootPrefixPattern = /^pm_partner_root_[A-Za-z0-9_-]{22}$/u;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const unsafeText =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableTimestamp(value: unknown) {
  if (value === null) return null;
  if (
    typeof value !== "string"
    || value.length < 20
    || value.length > 40
    || Number.isNaN(Date.parse(value))
  ) return undefined;
  return value;
}

function canonicalHttpsUrl(value: unknown) {
  if (value === null) return null;
  if (
    typeof value !== "string"
    || value.length > 2_048
    || value.trim() !== value
    || unsafeText.test(value)
  ) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !url.hostname
      || url.hash
      || url.href !== value
    ) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function parseScopes(value: unknown): readonly PartnerRootKeyScopeV1[] | null {
  if (
    !Array.isArray(value)
    || value.length !== PARTNER_ROOT_KEY_SCOPES_V1.length
    || !value.every((scope) => typeof scope === "string")
    || new Set(value).size !== value.length
    || !PARTNER_ROOT_KEY_SCOPES_V1.every((scope) => value.includes(scope))
  ) return null;
  return Object.freeze([...value] as PartnerRootKeyScopeV1[]);
}

function parseBudgets(value: unknown): PartnerBudgetsV1 | null {
  if (!isRecord(value)) return null;
  if (
    !Number.isSafeInteger(value.prepareRequestsPerHour)
    || Number(value.prepareRequestsPerHour) < 1
    || Number(value.prepareRequestsPerHour)
      > PARTNER_BUDGET_LIMITS_V1.prepareRequestsPerHour
    || !Number.isSafeInteger(value.readRequestsPerMinute)
    || Number(value.readRequestsPerMinute) < 1
    || Number(value.readRequestsPerMinute)
      > PARTNER_BUDGET_LIMITS_V1.readRequestsPerMinute
    || !Number.isSafeInteger(value.subkeyAdminRequestsPerHour)
    || Number(value.subkeyAdminRequestsPerHour) < 1
    || Number(value.subkeyAdminRequestsPerHour)
      > PARTNER_BUDGET_LIMITS_V1.subkeyAdminRequestsPerHour
  ) return null;
  return Object.freeze({
    prepareRequestsPerHour: Number(value.prepareRequestsPerHour),
    readRequestsPerMinute: Number(value.readRequestsPerMinute),
    subkeyAdminRequestsPerHour: Number(value.subkeyAdminRequestsPerHour),
  });
}

function nullableIdentifier(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) return undefined;
  return value.toLowerCase();
}

export function parsePartnerRootKeySummaryV1(
  value: unknown,
): PartnerRootKeySummaryV1 | null {
  if (!isRecord(value)) return null;
  const createdAt = nullableTimestamp(value.createdAt);
  const expiresAt = nullableTimestamp(value.expiresAt);
  const lastUsedAt = nullableTimestamp(value.lastUsedAt);
  const revokedAt = nullableTimestamp(value.revokedAt);
  const rotatedFromRootKeyId = nullableIdentifier(value.rotatedFromRootKeyId);
  const scopes = parseScopes(value.scopes);
  const budgets = parseBudgets(value.budgets);
  if (
    typeof value.id !== "string"
    || !uuidPattern.test(value.id)
    || typeof value.partnerId !== "string"
    || !uuidPattern.test(value.partnerId)
    || typeof value.keyId !== "string"
    || !keyIdPattern.test(value.keyId)
    || typeof value.label !== "string"
    || value.label.length < 1
    || value.label.length > 96
    || value.label.trim() !== value.label
    || unsafeText.test(value.label)
    || typeof value.keyPrefix !== "string"
    || !rootPrefixPattern.test(value.keyPrefix)
    || value.keyPrefix !== `pm_partner_root_${value.keyId}`
    || !scopes
    || !budgets
    || createdAt === undefined
    || createdAt === null
    || expiresAt === undefined
    || expiresAt === null
    || lastUsedAt === undefined
    || revokedAt === undefined
    || rotatedFromRootKeyId === undefined
  ) return null;
  return Object.freeze({
    id: value.id.toLowerCase(),
    partnerId: value.partnerId.toLowerCase(),
    keyId: value.keyId,
    label: value.label,
    keyPrefix: value.keyPrefix,
    scopes,
    budgets,
    createdAt,
    expiresAt,
    lastUsedAt,
    revokedAt,
    rotatedFromRootKeyId,
  });
}

export function parsePartnerSummaryV1(value: unknown): PartnerSummaryV1 | null {
  if (!isRecord(value)) return null;
  const createdAt = nullableTimestamp(value.createdAt);
  const updatedAt = nullableTimestamp(value.updatedAt);
  const suspendedAt = nullableTimestamp(value.suspendedAt);
  const revokedAt = nullableTimestamp(value.revokedAt);
  const publicUrl = canonicalHttpsUrl(value.publicUrl);
  if (
    typeof value.id !== "string"
    || !uuidPattern.test(value.id)
    || typeof value.slug !== "string"
    || !slugPattern.test(value.slug)
    || typeof value.displayName !== "string"
    || value.displayName.length < 1
    || value.displayName.length > 96
    || value.displayName.trim() !== value.displayName
    || unsafeText.test(value.displayName)
    || publicUrl === undefined
    || (value.status !== "active"
      && value.status !== "suspended"
      && value.status !== "revoked")
    || createdAt === undefined
    || createdAt === null
    || updatedAt === undefined
    || updatedAt === null
    || suspendedAt === undefined
    || revokedAt === undefined
    || (value.status === "active" && (suspendedAt !== null || revokedAt !== null))
    || (value.status === "suspended" && (suspendedAt === null || revokedAt !== null))
    || (value.status === "revoked" && revokedAt === null)
    || !Array.isArray(value.rootKeys)
    || value.rootKeys.length
      > PARTNER_ADMIN_LIST_LIMITS_V1.maximumRootKeysPerPartner
  ) return null;
  const partnerId = value.id.toLowerCase();
  const rootKeys = value.rootKeys.map(parsePartnerRootKeySummaryV1);
  if (
    rootKeys.some((rootKey) => rootKey === null)
    || rootKeys.some((rootKey) => rootKey?.partnerId !== partnerId)
  ) return null;
  return Object.freeze({
    id: partnerId,
    slug: value.slug,
    displayName: value.displayName,
    publicUrl,
    status: value.status,
    createdAt,
    updatedAt,
    suspendedAt,
    revokedAt,
    rootKeys: Object.freeze(rootKeys as PartnerRootKeySummaryV1[]),
  });
}

export function parsePartnerListV1(value: unknown): PartnerSummaryV1[] | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== PARTNER_ADMIN_SCHEMA_V1
    || !Array.isArray(value.partners)
    || value.partners.length > PARTNER_ADMIN_LIST_LIMITS_V1.maximumPartners
  ) return null;
  const partners = value.partners.map(parsePartnerSummaryV1);
  return partners.some((partner) => partner === null)
    ? null
    : partners as PartnerSummaryV1[];
}

export function parsePartnerListPageV1(
  value: unknown,
): PartnerListPageV1 | null {
  if (!isRecord(value) || !isRecord(value.pagination)) return null;
  const partners = parsePartnerListV1(value);
  if (!partners) return null;
  const { page, pageSize, totalPartners, totalPages } = value.pagination;
  if (
    !Number.isSafeInteger(page)
    || Number(page) < 1
    || !Number.isSafeInteger(pageSize)
    || Number(pageSize) < 1
    || Number(pageSize) > PARTNER_ADMIN_LIST_LIMITS_V1.maximumPageSize
    || !Number.isSafeInteger(totalPartners)
    || Number(totalPartners) < 0
    || Number(totalPartners) > PARTNER_ADMIN_LIST_LIMITS_V1.maximumPartners
    || !Number.isSafeInteger(totalPages)
    || Number(totalPages) < 0
    || Number(totalPages) !== Math.ceil(Number(totalPartners) / Number(pageSize))
    || (Number(totalPages) === 0
      ? Number(page) !== 1
      : Number(page) > Number(totalPages))
    || partners.length > Number(pageSize)
  ) return null;
  const expectedLength = Number(totalPartners) === 0
    ? 0
    : Math.min(
        Number(pageSize),
        Number(totalPartners) - ((Number(page) - 1) * Number(pageSize)),
      );
  if (partners.length !== expectedLength) return null;
  return Object.freeze({
    partners: Object.freeze(partners),
    pagination: Object.freeze({
      page: Number(page),
      pageSize: Number(pageSize),
      totalPartners: Number(totalPartners),
      totalPages: Number(totalPages),
    }),
  });
}

export function parsePartnerMutationV1(
  value: unknown,
): PartnerSummaryV1 | null {
  if (!isRecord(value) || value.schemaVersion !== PARTNER_ADMIN_SCHEMA_V1) {
    return null;
  }
  return parsePartnerSummaryV1(value.partner);
}

export function parsePartnerRootKeyMutationV1(
  value: unknown,
): PartnerRootKeyMutationV1 | null {
  if (!isRecord(value) || value.schemaVersion !== PARTNER_ADMIN_SCHEMA_V1) {
    return null;
  }
  const partner = value.partner === undefined
    ? undefined
    : parsePartnerSummaryV1(value.partner);
  const rootKey = parsePartnerRootKeySummaryV1(value.rootKey);
  const secretState = value.secretState;
  const hasSecret = Object.hasOwn(value, "rootKeySecret");
  const rotatedRootKeyId = value.rotatedRootKeyId;
  if (
    (value.partner !== undefined && !partner)
    || !rootKey
    || (secretState !== "delivered-once" && secretState !== "already-delivered")
    || hasSecret !== (secretState === "delivered-once")
    || (rotatedRootKeyId !== undefined
      && (typeof rotatedRootKeyId !== "string"
        || !uuidPattern.test(rotatedRootKeyId)
        || rotatedRootKeyId.toLowerCase() === rootKey.id))
  ) return null;
  if (
    secretState === "delivered-once"
    && (
      typeof value.rootKeySecret !== "string"
      || !/^pm_partner_root_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u.test(
        value.rootKeySecret,
      )
      || !value.rootKeySecret.startsWith(`${rootKey.keyPrefix}_`)
    )
  ) return null;
  return Object.freeze({
    ...(partner ? { partner } : {}),
    rootKey,
    secretState,
    ...(secretState === "delivered-once"
      ? { rootKeySecret: value.rootKeySecret as string }
      : {}),
    ...(rotatedRootKeyId === undefined
      ? {}
      : { rotatedRootKeyId: rotatedRootKeyId.toLowerCase() }),
  });
}

export function displayPartnerKeyPrefix(prefix: string) {
  return `${prefix}…`;
}
