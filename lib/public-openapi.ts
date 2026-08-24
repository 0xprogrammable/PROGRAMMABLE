import { V4_TOKEN_ADDRESS } from "@/components/docs-public-policy";

const SITE_ORIGIN = "https://programmable.market";
const CUSTOM_LAUNCH_API_ORIGIN = "https://api.programmable.market";
const API_KEYS_URL = `${SITE_ORIGIN}/developers/api-keys`;

const jsonResponse = (schema: Record<string, unknown>, description: string) => ({
  description,
  content: {
    "application/json": {
      schema,
    },
  },
});

const component = (name: string) => ({
  $ref: `#/components/schemas/${name}`,
});

export const programmablePublicOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Programmable developer APIs",
    version: "1.1.0",
    summary:
      "Verified launch discovery plus wallet-bound Custom launch preparation on Ethereum.",
    description:
      "The programmable.market read endpoints remain unauthenticated and read-only. The separately hosted Custom Launch API accepts wallet-bound pm_live_ API keys and prepares exact Router launch actions. An API key never signs or broadcasts a controller-wallet transaction.",
    contact: {
      name: "Programmable",
      url: `${SITE_ORIGIN}/docs/developers`,
    },
  },
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  servers: [{ url: SITE_ORIGIN, description: "Programmable production" }],
  externalDocs: {
    description: "Programmable developer documentation",
    url: `${SITE_ORIGIN}/docs/developers`,
  },
  tags: [
    {
      name: "Discovery",
      description: "Verified launch catalog and token identity reads.",
    },
    {
      name: "Registry",
      description: "Custom Registry public-read readiness and release binding.",
    },
    {
      name: "Metadata",
      description: "Machine-readable API discovery.",
    },
    {
      name: "Custom launch",
      description:
        "Wallet-bound, provenance-only Custom launch intake and status. Create API keys at programmable.market/developers/api-keys.",
    },
  ],
  paths: {
    "/api": {
      get: {
        operationId: "getPublicApiIndex",
        summary: "Read the public API index",
        description:
          "Returns canonical links and the safety boundary for the documented read-only surface.",
        tags: ["Metadata"],
        security: [],
        responses: {
          "200": jsonResponse(component("ApiIndex"), "Public API index."),
        },
      },
    },
    "/api/explore": {
      get: {
        operationId: "listVerifiedLaunches",
        summary: "List verified public launches",
        description:
          "Returns verified public identities. Optional market enrichment may be unavailable without removing a verified identity.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "page",
            in: "query",
            description: "One-based result page.",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            description: "Results per page.",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 9 },
          },
          {
            name: "q",
            in: "query",
            description: "Case-insensitive name, symbol, address, or Custom model search.",
            schema: { type: "string" },
          },
          {
            name: "socials",
            in: "query",
            description: "Require or exclude X or Telegram links.",
            schema: { type: "string", enum: ["yes", "no"] },
          },
          {
            name: "sort",
            in: "query",
            description: "Canonical launch-order or available FDV ordering.",
            schema: {
              type: "string",
              enum: [
                "newest",
                "oldest",
                "market-cap",
                "market-cap-asc",
                "highest-market-cap",
                "lowest-market-cap",
              ],
              default: "newest",
            },
          },
        ],
        responses: {
          "200": jsonResponse(
            component("ExploreListResponse"),
            "Verified launch page.",
          ),
          "400": jsonResponse(component("ApiError"), "Invalid query shape."),
          "503": jsonResponse(
            component("ApiError"),
            "The verified identity source is temporarily unavailable.",
          ),
        },
      },
    },
    "/api/explore/token": {
      get: {
        operationId: "getVerifiedToken",
        summary: "Look up one verified token",
        description:
          "Looks up an exact Ethereum token address. A 404 response is a completed verified lookup with no public identity, not a provider timeout.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "address",
            in: "query",
            required: true,
            description: "Ethereum token contract address.",
            schema: component("EthereumAddress"),
            example: V4_TOKEN_ADDRESS,
          },
        ],
        responses: {
          "200": jsonResponse(
            component("TokenDetailResponse"),
            "Verified token or Registry-verified Custom project.",
          ),
          "400": jsonResponse(component("ApiError"), "Invalid address or query shape."),
          "404": jsonResponse(
            component("TokenDetailResponse"),
            "Verified lookup completed but no public token identity matched.",
          ),
          "503": jsonResponse(
            component("ApiError"),
            "The identity boundary could not be verified at this time.",
          ),
        },
      },
    },
    "/api/custom-launch/registry/v2/readiness": {
      get: {
        operationId: "getCustomRegistryReadiness",
        summary: "Read Custom Registry readiness",
        description:
          "Reports whether the exact production Registry binding and provider quorum are verified for public reads.",
        tags: ["Registry"],
        security: [],
        responses: {
          "200": jsonResponse(
            component("RegistryReadiness"),
            "Registry public-read boundary is ready.",
          ),
          "503": jsonResponse(
            component("ApiError"),
            "Registry public reads remain fail-closed.",
          ),
        },
      },
    },
    "/api/custom-launch/registry/v2/manifest": {
      get: {
        operationId: "getCustomRegistryManifest",
        summary: "Read the Custom Registry release manifest",
        description:
          "Returns the exact chain, deployment, runtime, source, artifact, and finality commitments for the live Registry public-read surface.",
        tags: ["Registry"],
        security: [],
        responses: {
          "200": jsonResponse(
            component("RegistryManifest"),
            "Exact live Registry release manifest.",
          ),
          "503": jsonResponse(
            component("ApiError"),
            "No verified live Registry manifest is available.",
          ),
        },
      },
    },
    "/v1/custom-launches": {
      post: {
        operationId: "createCustomLaunch",
        summary: "Prepare a Custom launch",
        description:
          "Validates the submitted manifest digest, executable graph, required agent attestation and evidence digests, and exact permit binding; reserves the request idempotently; and prepares the Mainnet Router action for the API key's bound wallet. The platform does not compile source, simulate the transaction, audit the project, attest safety, sign the wallet transaction, or broadcast it.",
        tags: ["Custom launch"],
        servers: [
          {
            url: CUSTOM_LAUNCH_API_ORIGIN,
            description: "Programmable Custom Launch API",
          },
        ],
        security: [{ CustomLaunchApiKey: [] }],
        externalDocs: {
          description: "Create or revoke a wallet-bound API key",
          url: API_KEYS_URL,
        },
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            description:
              "Caller-generated operation key. Retry an ambiguous request with the same key and identical body.",
            schema: {
              type: "string",
              minLength: 16,
              maxLength: 128,
              pattern: "^[A-Za-z0-9._:-]{16,128}$",
            },
          },
        ],
        requestBody: {
          required: true,
          description:
            "Closed JSON request, limited to 2 MiB. Unknown top-level fields fail before launch preparation.",
          content: {
            "application/json": {
              schema: component("CustomLaunchCreateRequest"),
            },
          },
        },
        responses: {
          "200": jsonResponse(
            component("CustomLaunchResource"),
            "Idempotent replay of the original launch request.",
          ),
          "202": jsonResponse(
            component("CustomLaunchResource"),
            "Launch request accepted for validation and preparation.",
          ),
          "400": jsonResponse(
            component("CustomLaunchApiError"),
            "Invalid request or Idempotency-Key.",
          ),
          "401": jsonResponse(
            component("CustomLaunchApiError"),
            "API key is missing, malformed, expired, revoked, or unknown.",
          ),
          "403": jsonResponse(
            component("CustomLaunchApiError"),
            "Missing custom-launch:create scope or wallet binding mismatch.",
          ),
          "409": jsonResponse(
            component("CustomLaunchApiError"),
            "The Idempotency-Key is bound to a different request, or the wallet nonce conflicts with another launch.",
          ),
          "413": jsonResponse(
            component("CustomLaunchApiError"),
            "Request body exceeds 2 MiB.",
          ),
          "415": jsonResponse(
            component("CustomLaunchApiError"),
            "Content-Type must be application/json.",
          ),
          "422": jsonResponse(
            component("CustomLaunchApiError"),
            "The manifest digest, graph, attestation subject/evidence digest, or permit binding is invalid.",
          ),
          "503": jsonResponse(
            component("CustomLaunchApiError"),
            "Launch preparation is temporarily unavailable.",
          ),
        },
      },
    },
    "/v1/custom-launches/{launchId}": {
      get: {
        operationId: "getCustomLaunch",
        summary: "Read a Custom launch",
        description:
          "Returns one launch owned by the API key's wallet principal. A missing launch and another principal's launch both return 404.",
        tags: ["Custom launch"],
        servers: [
          {
            url: CUSTOM_LAUNCH_API_ORIGIN,
            description: "Programmable Custom Launch API",
          },
        ],
        security: [{ CustomLaunchApiKey: [] }],
        parameters: [
          {
            name: "launchId",
            in: "path",
            required: true,
            description: "Launch identifier returned by the create route.",
            schema: {
              type: "string",
              minLength: 16,
              maxLength: 128,
              pattern: "^[A-Za-z0-9_-]{16,128}$",
            },
          },
        ],
        responses: {
          "200": jsonResponse(
            component("CustomLaunchResource"),
            "Current durable launch state.",
          ),
          "401": jsonResponse(
            component("CustomLaunchApiError"),
            "API key is missing, malformed, expired, revoked, or unknown.",
          ),
          "403": jsonResponse(
            component("CustomLaunchApiError"),
            "API key lacks custom-launch:read.",
          ),
          "404": jsonResponse(
            component("CustomLaunchApiError"),
            "Launch not found for this wallet principal.",
          ),
        },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        summary: "Read this OpenAPI document",
        tags: ["Metadata"],
        security: [],
        responses: {
          "200": jsonResponse(
            { type: "object" },
            "OpenAPI 3.1 description of the public read and Custom launch APIs.",
          ),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      CustomLaunchApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "pm_live_<22-char-key-id>_<43-char-secret>",
        description:
          "Wallet-bound API key created at https://programmable.market/developers/api-keys. V1 keys receive only custom-launch:create and custom-launch:read. They are not wallet keys and cannot sign or broadcast transactions.",
      },
    },
    schemas: {
      EthereumAddress: {
        type: "string",
        pattern: "^0x[0-9a-fA-F]{40}$",
        examples: [V4_TOKEN_ADDRESS],
      },
      Hex32: {
        type: "string",
        pattern: "^0x[0-9a-fA-F]{64}$",
      },
      LowerHex32: {
        type: "string",
        pattern: "^0x[0-9a-f]{64}$",
      },
      NonzeroLowerHex32: {
        type: "string",
        pattern: "^0x(?!0{64}$)[0-9a-f]{64}$",
      },
      Sha256Digest: {
        type: "string",
        pattern: "^sha256:[0-9a-f]{64}$",
      },
      CanonicalUint256: {
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)$",
        maxLength: 78,
        description: "Base-10 uint256 with no sign or leading zeroes.",
      },
      CanonicalIdentifier: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/+\\-]{0,255}$",
      },
      HexData: {
        type: "string",
        pattern: "^0x(?:[0-9a-fA-F]{2})*$",
      },
      HookPermission: {
        type: "string",
        enum: [
          "beforeInitialize",
          "afterInitialize",
          "beforeAddLiquidity",
          "afterAddLiquidity",
          "beforeRemoveLiquidity",
          "afterRemoveLiquidity",
          "beforeSwap",
          "afterSwap",
          "beforeDonate",
          "afterDonate",
          "beforeSwapReturnDelta",
          "afterSwapReturnDelta",
          "afterAddLiquidityReturnDelta",
          "afterRemoveLiquidityReturnDelta",
        ],
      },
      SourceBundleEntryV2: {
        type: "object",
        required: [
          "path",
          "kind",
          "mode",
          "byteLength",
          "contentSha256",
          "symlinkTarget",
        ],
        properties: {
          path: {
            type: "string",
            minLength: 1,
            description:
              "NFC-normalized relative path. Empty segments, dot segments, backslashes, controls, and encoded slash or backslash are rejected.",
          },
          kind: { type: "string", enum: ["file", "symlink"] },
          mode: { type: "string", enum: ["100644", "100755", "120000"] },
          byteLength: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)$",
            maxLength: 20,
            description: "Base-10 uint64 byte length.",
          },
          contentSha256: component("Sha256Digest"),
          symlinkTarget: { type: ["string", "null"] },
        },
        allOf: [
          {
            if: { properties: { kind: { const: "file" } } },
            then: {
              properties: {
                mode: { type: "string", enum: ["100644", "100755"] },
                symlinkTarget: { type: "null" },
              },
            },
            else: {
              properties: {
                mode: { const: "120000" },
                symlinkTarget: { type: "string" },
              },
            },
          },
        ],
        additionalProperties: false,
      },
      SourceBundleManifestV2: {
        type: "object",
        required: ["schemaVersion", "entries"],
        properties: {
          schemaVersion: { const: "2.0.0" },
          entries: {
            type: "array",
            minItems: 1,
            description:
              "Complete, non-empty entries in strictly increasing, unique UTF-8 path-byte order. The platform recomputes the frozen manifest digest and requires it to match sourceDescriptor.sourceBundleDigest; it does not fetch or compile source files.",
            items: component("SourceBundleEntryV2"),
          },
        },
        additionalProperties: false,
      },
      DeterministicSourceBundleV2: {
        type: "object",
        required: [
          "schemaVersion",
          "kind",
          "controllerWallet",
          "sourceLineageNonce",
          "sourceBundleDigest",
          "bundleContentSha256",
          "publicOriginCommitment",
        ],
        properties: {
          schemaVersion: { const: "2.0.0" },
          kind: { const: "deterministic-source-bundle" },
          controllerWallet: {
            ...component("EthereumAddress"),
            description:
              "Must equal launchWallet after address normalization.",
          },
          sourceLineageNonce: component("CanonicalUint256"),
          sourceBundleDigest: component("LowerHex32"),
          bundleContentSha256: component("Sha256Digest"),
          publicOriginCommitment: component("LowerHex32"),
        },
        additionalProperties: false,
      },
      GraphAddressLocatorV1: {
        type: "object",
        required: ["targetId", "byteOffset", "encoding"],
        properties: {
          targetId: component("CanonicalIdentifier"),
          byteOffset: { type: "integer", minimum: 0 },
          encoding: {
            type: "string",
            enum: ["abi-address-word", "packed-address-20"],
          },
        },
        additionalProperties: false,
      },
      CustomGraphTargetV1: {
        type: "object",
        required: [
          "targetId",
          "applicantSalt",
          "creationBytecode",
          "constructorArguments",
          "initializerCalldata",
          "constructorAddressLocators",
          "initializerAddressLocators",
          "deploymentValueWei",
          "initializerValueWei",
          "expectedRuntimeCodeHash",
          "componentKind",
          "declaredHookPermissions",
        ],
        properties: {
          targetId: component("CanonicalIdentifier"),
          applicantSalt: component("Hex32"),
          creationBytecode: {
            type: "string",
            pattern: "^0x(?:[0-9a-fA-F]{2})+$",
            description:
              "Non-empty EVM creation bytecode. Creation bytecode plus constructor arguments is limited to 49,152 bytes.",
          },
          constructorArguments: component("HexData"),
          initializerCalldata: {
            ...component("HexData"),
            description: "Limited to 131,072 bytes after address patching.",
          },
          constructorAddressLocators: {
            type: "array",
            maxItems: 256,
            items: component("GraphAddressLocatorV1"),
          },
          initializerAddressLocators: {
            type: "array",
            maxItems: 256,
            items: component("GraphAddressLocatorV1"),
          },
          deploymentValueWei: component("CanonicalUint256"),
          initializerValueWei: component("CanonicalUint256"),
          expectedRuntimeCodeHash: {
            type: "string",
            pattern: "^0x(?!0{64}$)[0-9a-fA-F]{64}$",
          },
          componentKind: {
            type: "string",
            enum: ["token", "hook", "other"],
          },
          declaredHookPermissions: {
            oneOf: [
              { type: "array", maxItems: 14, items: component("HookPermission") },
              { type: "null" },
            ],
          },
        },
        allOf: [
          {
            if: { properties: { componentKind: { const: "hook" } } },
            then: {
              properties: {
                declaredHookPermissions: {
                  type: "array",
                  maxItems: 14,
                  uniqueItems: true,
                  items: component("HookPermission"),
                },
              },
            },
            else: {
              properties: { declaredHookPermissions: { type: "null" } },
            },
          },
        ],
        additionalProperties: false,
      },
      CustomGraphBundleV1: {
        type: "object",
        required: ["schemaVersion", "sourceBundleSha256", "targets", "pool"],
        properties: {
          schemaVersion: { const: "programmable.custom-graph-bundle.v1" },
          sourceBundleSha256: {
            ...component("Sha256Digest"),
            description:
              "Must equal sourceDescriptor.bundleContentSha256.",
          },
          targets: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            description:
              "Closed target graph with exactly one token target and one hook target. Constructor dependencies must be acyclic.",
            items: component("CustomGraphTargetV1"),
          },
          pool: {
            type: "object",
            required: ["tokenTargetId", "hookTargetId", "fee", "tickSpacing"],
            properties: {
              tokenTargetId: component("CanonicalIdentifier"),
              hookTargetId: component("CanonicalIdentifier"),
              fee: {
                oneOf: [
                  { type: "integer", minimum: 0, maximum: 1_000_000 },
                  { const: 8_388_608 },
                ],
              },
              tickSpacing: { type: "integer", minimum: 1, maximum: 32_767 },
            },
            additionalProperties: false,
          },
        },
        description:
          "Aggregate init code and initializer calldata are limited to 524,288 bytes. Predicted hook-address permission bits must equal declaredHookPermissions.",
        additionalProperties: false,
      },
      AgentLaunchAttestationCheckV1: {
        type: "object",
        required: ["checkId", "evidenceSha256"],
        properties: {
          checkId: component("CanonicalIdentifier"),
          evidenceSha256: component("Sha256Digest"),
        },
        additionalProperties: false,
      },
      AgentLaunchAttestationV1: {
        type: "object",
        required: [
          "schemaVersion",
          "subjectGraphBundleHash",
          "agentId",
          "checkedAt",
          "checks",
        ],
        properties: {
          schemaVersion: { const: "programmable.agent-launch-attestation.v1" },
          subjectGraphBundleHash: {
            ...component("Sha256Digest"),
            description:
              "SHA-256 of the canonical normalized graph bundle. It must match the submitted graph bundle.",
          },
          agentId: component("CanonicalIdentifier"),
          checkedAt: {
            type: "string",
            format: "date-time",
            pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
          },
          checks: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            uniqueItems: true,
            items: component("AgentLaunchAttestationCheckV1"),
          },
        },
        description:
          "Required agent self-attestation with evidence digests for the submitted graph subject. It is excluded from permit and launch authorization. Programmable does not fetch or assess the evidence, adopt the attestation, or make a safety, audit, approval, compilation, or simulation claim.",
        additionalProperties: false,
      },
      CustomLaunchCreateRequest: {
        type: "object",
        required: [
          "schemaVersion",
          "launchWallet",
          "chainId",
          "nonce",
          "sourceDescriptor",
          "sourceBundleManifest",
          "graphBundle",
          "agentAttestation",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.custom-launch-create-request.v1",
          },
          launchWallet: {
            ...component("EthereumAddress"),
            description: "Must equal the API key's bound wallet.",
          },
          chainId: { const: "1" },
          nonce: component("NonzeroLowerHex32"),
          sourceDescriptor: component("DeterministicSourceBundleV2"),
          sourceBundleManifest: component("SourceBundleManifestV2"),
          graphBundle: component("CustomGraphBundleV1"),
          agentAttestation: component("AgentLaunchAttestationV1"),
        },
        additionalProperties: false,
      },
      CustomLaunchFailure: {
        type: "object",
        required: ["code", "message", "retryable"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          retryable: { type: "boolean" },
        },
        additionalProperties: false,
      },
      CustomLaunchResource: {
        type: "object",
        required: [
          "schemaVersion",
          "launchId",
          "routeId",
          "ownerWallet",
          "status",
          "requestHash",
          "createdAt",
          "updatedAt",
          "output",
          "failure",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-launch.v1" },
          launchId: {
            type: "string",
            minLength: 16,
            maxLength: 128,
            pattern: "^[A-Za-z0-9_-]{16,128}$",
          },
          routeId: { const: "custom-launch:create:v1" },
          ownerWallet: component("EthereumAddress"),
          status: {
            type: "string",
            enum: [
              "received",
              "validating",
              "prepared",
              "authorized",
              "submitted",
              "finalized",
              "failed",
              "cancelled",
            ],
          },
          requestHash: {
            type: "string",
            pattern: "^sha256:[0-9a-f]{64}$",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          output: {
            oneOf: [
              { type: "object", additionalProperties: true },
              { type: "null" },
            ],
          },
          failure: {
            oneOf: [component("CustomLaunchFailure"), { type: "null" }],
          },
        },
        additionalProperties: false,
      },
      CustomLaunchApiError: {
        type: "object",
        required: ["schemaVersion", "error"],
        properties: {
          schemaVersion: { const: "programmable.api-error.v1" },
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string", format: "uuid" },
              details: {},
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      ApiError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                required: ["code", "message", "resolution"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  resolution: { type: "string" },
                },
                additionalProperties: false,
              },
            ],
          },
        },
        additionalProperties: true,
      },
      ApiIndex: {
        type: "object",
        required: ["schemaVersion", "status", "openapi", "documentation", "llms", "scope"],
        properties: {
          schemaVersion: { const: "programmable.public-api-index.v1" },
          status: { const: "ready" },
          openapi: { type: "string", format: "uri" },
          documentation: { type: "string", format: "uri" },
          llms: { type: "string", format: "uri" },
          scope: {
            type: "object",
            required: ["access", "actionsExcluded", "identityPolicy"],
            properties: {
              access: { const: "unauthenticated-read-only" },
              actionsExcluded: {
                type: "array",
                items: { type: "string" },
              },
              identityPolicy: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      ExploreValuation: {
        oneOf: [
          {
            type: "object",
            required: ["status", "metric", "currency", "valueWad", "freshness"],
            properties: {
              status: { const: "available" },
              metric: { type: "string", enum: ["market-cap", "fdv"] },
              supplyBasis: { type: "string", enum: ["circulating", "total"] },
              currency: { type: "string", enum: ["usd", "eth", "quote"] },
              valueWad: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
              freshness: {
                type: "string",
                enum: ["current", "provider-recent", "stale", "unknown"],
              },
              source: {
                type: "string",
                enum: ["bitquery", "dexscreener", "stateview-chainlink"],
              },
              asOfTime: { type: "string", format: "date-time" },
            },
            additionalProperties: true,
          },
          {
            type: "object",
            required: ["status", "reason"],
            properties: {
              status: { const: "unavailable" },
              reason: { type: "string" },
            },
            additionalProperties: false,
          },
        ],
      },
      ExploreEntry: {
        type: "object",
        required: ["exploreKind", "id", "name", "launchedAt", "valuation"],
        properties: {
          exploreKind: { type: "string", enum: ["token", "custom-project"] },
          id: { type: "string" },
          name: { type: "string" },
          symbol: { type: ["string", "null"] },
          tokenAddress: {
            oneOf: [component("EthereumAddress"), { type: "null" }],
          },
          launchedAt: { type: "string", format: "date-time" },
          valuation: component("ExploreValuation"),
          links: {
            type: "array",
            items: {
              type: "object",
              required: ["kind"],
              properties: {
                kind: { type: "string", enum: ["website", "x", "telegram"] },
                url: { type: "string", format: "uri" },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
      CatalogBoundary: {
        type: "object",
        required: ["source", "launchSource", "status", "lastIndexedAt", "identityCount"],
        properties: {
          source: { const: "envio-classic-v3" },
          launchSource: { type: "string" },
          status: { type: "string", enum: ["current", "last-known-good"] },
          lastIndexedAt: { type: "string", format: "date-time" },
          asOfBlock: { type: "string" },
          asOfBlockHash: component("Hex32"),
          identityCount: { type: "integer", minimum: 1 },
          identityCommitment: { type: "string" },
        },
        additionalProperties: true,
      },
      ExploreListResponse: {
        type: "object",
        required: [
          "status",
          "tokens",
          "page",
          "pageSize",
          "total",
          "totalPages",
          "sort",
          "query",
          "catalog",
        ],
        properties: {
          status: { const: "ready" },
          tokens: { type: "array", items: component("ExploreEntry") },
          page: { type: "integer", minimum: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 100 },
          total: { type: "integer", minimum: 0 },
          totalPages: { type: "integer", minimum: 0 },
          sort: {
            type: "string",
            enum: ["newest", "oldest", "market-cap", "market-cap-asc"],
          },
          query: { type: "string" },
          sortMetric: { const: "fdv" },
          catalog: component("CatalogBoundary"),
          dataQuality: { type: "object", additionalProperties: true },
          marketRead: { type: "object", additionalProperties: true },
        },
        additionalProperties: true,
      },
      TokenDetailResponse: {
        type: "object",
        required: ["status", "token", "customProject", "creatorArticle", "catalog"],
        properties: {
          status: { const: "ready" },
          token: {
            oneOf: [component("ExploreEntry"), { type: "null" }],
          },
          customProject: {
            oneOf: [component("ExploreEntry"), { type: "null" }],
          },
          creatorArticle: { type: ["object", "null"], additionalProperties: true },
          snapshot: { type: ["object", "null"], additionalProperties: true },
          catalog: component("CatalogBoundary"),
        },
        additionalProperties: true,
      },
      RegistryReadiness: {
        type: "object",
        required: [
          "schemaVersion",
          "status",
          "registryStatus",
          "generation",
          "chainId",
          "runtimeBindings",
          "providerQuorum",
          "checkedAt",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-registry-readiness.v2" },
          status: { const: "ready" },
          registryStatus: { const: "live" },
          generation: { const: "2" },
          chainId: { const: "1" },
          manifestPath: { const: "/api/custom-launch/registry/v2/manifest" },
          runtimeBindings: { const: "verified" },
          providerQuorum: { const: "verified" },
          checkedAt: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
      },
      RegistryManifest: {
        type: "object",
        required: [
          "schemaVersion",
          "status",
          "generation",
          "chainId",
          "caip2",
          "publicReadEnabled",
          "indexingEnabled",
          "registry",
          "release",
          "finality",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-registry-public-manifest.v2" },
          status: { const: "live" },
          generation: { const: "2" },
          chainId: { const: "1" },
          caip2: { const: "eip155:1" },
          publicReadEnabled: { const: true },
          indexingEnabled: { const: true },
          registry: {
            type: "object",
            required: [
              "address",
              "runtimeCodeKeccak256",
              "deploymentTransactionHash",
              "deploymentBlock",
              "deploymentBlockHash",
            ],
            properties: {
              address: component("EthereumAddress"),
              runtimeCodeKeccak256: component("Hex32"),
              deploymentTransactionHash: component("Hex32"),
              deploymentBlock: { type: "string", pattern: "^[1-9][0-9]*$" },
              deploymentBlockHash: component("Hex32"),
            },
            additionalProperties: false,
          },
          release: { type: "object", additionalProperties: { type: "string" } },
          finality: { type: "object", additionalProperties: { type: "string" } },
        },
        additionalProperties: false,
      },
    },
  },
  "x-programmable-boundary": {
    identity:
      "Verified Classic V3, Registry-verified Custom, and the sole official Classic V2 main-token exception.",
    excluded:
      "All other Classic V1/V2, every Stock family, and non-Registry-verified Custom launches.",
    marketData:
      "Optional enrichment never determines whether a verified identity is present.",
    router:
      "Provenance evidence and identity mapping only; never a public category.",
    actions:
      "The Custom Launch API validates manifest digest, graph, attestation subject, evidence digest, and permit bindings and prepares one exact wallet action. It does not compile source, simulate the transaction, audit, or attest safety. API keys never sign, broadcast, trade, claim fees, manage buybacks, or write profiles.",
  },
  "x-programmable-api-scopes": {
    "custom-launch:create": {
      state: "grantable",
      description: "Create and prepare a provenance-only Custom launch.",
    },
    "custom-launch:read": {
      state: "grantable",
      description: "Read Custom launches owned by the key's wallet principal.",
    },
    "fees:claim": {
      state: "reserved-disabled",
      description: "Not grantable or callable in V1.",
    },
    "buybacks:manage": {
      state: "reserved-disabled",
      description: "Not grantable or callable in V1.",
    },
    evolution:
      "New scopes and endpoints are additive. Existing keys never inherit a scope activated later.",
  },
} as const;
