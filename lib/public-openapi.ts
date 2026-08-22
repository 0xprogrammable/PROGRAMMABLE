import { V4_TOKEN_ADDRESS } from "@/components/docs-public-policy";

const SITE_ORIGIN = "https://programmable.market";

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
    title: "Programmable public read API",
    version: "1.0.0",
    summary: "Verified launch discovery and identity reads on Ethereum.",
    description:
      "A deliberately small, unauthenticated, read-only API for verified Programmable launch identity. Wallet signing, launch creation, trades, claims, profile writes, and other onchain actions are intentionally excluded.",
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
    "/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        summary: "Read this OpenAPI document",
        tags: ["Metadata"],
        security: [],
        responses: {
          "200": jsonResponse(
            { type: "object" },
            "OpenAPI 3.1 description of the public read-only API.",
          ),
        },
      },
    },
  },
  components: {
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
      "No launch, trade, claim, profile-write, signing, or wallet action is described by this document.",
  },
} as const;
