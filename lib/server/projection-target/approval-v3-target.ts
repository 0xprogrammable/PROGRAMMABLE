import "server-only";

import { canonicalizeJson } from "./canonical-json";
import {
  PostgresProjectionTargetAtomicStoreV1,
} from "./postgres-store";
import {
  createProjectionTargetReferenceHandlerV1,
  type ProjectionTargetReferenceHandlerV1,
} from "./protocol";
import {
  createEd25519ProjectionWorkloadCredentialVerifierV1,
} from "./workload-credential";
import {
  createProductionProjectionTargetPostgresPoolV1,
} from "./website-target";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

let productionTarget: ProjectionTargetReferenceHandlerV1 | null = null;
let productionPool:
ReturnType<typeof createProductionProjectionTargetPostgresPoolV1> | null = null;

export function getProductionApprovalV3ProjectionPoolV1():
ReturnType<typeof createProductionProjectionTargetPostgresPoolV1> {
  if (productionPool !== null) return productionPool;
  productionPool = createProductionProjectionTargetPostgresPoolV1(
    environmentValue("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    environmentPem(
      "PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM",
      "CERTIFICATE",
    ),
    environmentId("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE"),
  );
  return productionPool;
}

export function getProductionApprovalV3ProjectionTargetV1():
ProjectionTargetReferenceHandlerV1 {
  if (productionTarget !== null) return productionTarget;
  const audience = environmentId("PROGRAMMABLE_WEBSITE_APPROVAL_V3_AUDIENCE");
  const targetBindingHash = environmentDigest(
    "PROGRAMMABLE_WEBSITE_APPROVAL_V3_TARGET_BINDING_HASH",
  );
  const pool = getProductionApprovalV3ProjectionPoolV1();
  const credentialVerifier =
    createEd25519ProjectionWorkloadCredentialVerifierV1({
      issuer: environmentId("PROGRAMMABLE_APPROVAL_V3_WORKLOAD_ISSUER"),
      subject: environmentId("PROGRAMMABLE_APPROVAL_V3_WORKLOAD_SUBJECT"),
      audience,
      keyId: environmentId("PROGRAMMABLE_APPROVAL_V3_WORKLOAD_KEY_ID"),
      publicKeyPem: environmentPem(
        "PROGRAMMABLE_APPROVAL_V3_WORKLOAD_PUBLIC_KEY_PEM",
        "PUBLIC KEY",
      ),
      targetBindings: Object.freeze({ "website.approval-v3": targetBindingHash }),
    });
  const handler = createProjectionTargetReferenceHandlerV1({
    lanes: Object.freeze([Object.freeze({
      lane: "website.approval-v3" as const,
      audience,
      targetBindingHash,
    })]),
    credentialVerifier,
    store: new PostgresProjectionTargetAtomicStoreV1(pool),
  });
  productionTarget = Object.freeze({
    contract: handler.contract,
    async handle(request: Request) {
      await pool.assertProductionReadiness();
      return await handler.handle(request);
    },
  });
  return productionTarget;
}

export async function handleProductionApprovalV3ProjectionTargetV1(
  request: Request,
): Promise<Response> {
  try {
    return await getProductionApprovalV3ProjectionTargetV1().handle(request);
  } catch {
    return new Response(canonicalizeJson({
      schemaVersion: "programmable.projection-target-error.v1",
      code: "target_unavailable",
    }), {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }
}

function environmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}

function environmentId(name: string): string {
  const value = environmentValue(name);
  if (!SAFE_ID.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function environmentDigest(name: string): `sha256:${string}` {
  const value = environmentValue(name);
  if (!DIGEST.test(value)) throw new TypeError(`${name} is invalid`);
  return value as `sha256:${string}`;
}

function environmentPem(name: string, kind: "CERTIFICATE" | "PUBLIC KEY"): string {
  const value = environmentValue(name).replaceAll("\\n", "\n");
  if (!value.includes(`-----BEGIN ${kind}-----`)
    || !value.includes(`-----END ${kind}-----`)) {
    throw new TypeError(`${name} is invalid`);
  }
  return value;
}
