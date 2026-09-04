import { V4_TOKEN_ADDRESS } from "@/components/docs-public-policy";

const SITE_ORIGIN = "https://programmable.market";
const CUSTOM_LAUNCH_API_ORIGIN = "https://api.programmable.market";

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

const exploreIdentityResponseHeaders = {
  "X-Programmable-Chain-Id": {
    description: "Chain namespace used for the verified identity lookup.",
    schema: { type: "string", enum: ["1", "4663"] },
  },
  "X-Programmable-Launch-Source": {
    description:
      "Verified launch identity authorities included in the completed lookup.",
    schema: { type: "string" },
  },
  "X-Programmable-Read-Source": {
    description:
      "Sources actually read for this response. A verified 404 contains identity sources only because no market lookup occurs.",
    schema: { type: "string" },
  },
  "X-Programmable-Canonical-Read-Status": {
    description: "Freshness state of the canonical Classic identity catalog.",
    schema: {
      type: "string",
      enum: ["current", "last-known-good", "unavailable"],
    },
  },
  "X-Programmable-Router-Read-Status": {
    description: "Freshness state of the finalized Router Custom identity read.",
    schema: {
      type: "string",
      enum: ["current", "last-known-good", "unavailable"],
    },
  },
  "X-Programmable-Identity-Last-Indexed-At": {
    description: "Generation time of the identity boundary used by the response.",
    schema: { type: "string", format: "date-time" },
  },
} as const;

const exploreMarketResponseHeaders = {
  "X-Programmable-Market-Provider": {
    description:
      "Market enrichment provider selected for this Ethereum response. gmgn+dexscreener means GMGN was primary and Dexscreener was used for at least one fallback request.",
    schema: {
      type: "string",
      enum: ["dexscreener", "gmgn", "gmgn+dexscreener"],
    },
  },
  "X-Programmable-Market-Read-Status": {
    description:
      "Aggregate completeness of the bounded market read. Identity results remain authoritative independently of this status.",
    schema: {
      type: "string",
      enum: ["complete", "partial", "unavailable"],
    },
  },
  "X-Programmable-Market-Source": {
    description:
      "Providers that returned an exact-identity market observation. Omitted when no provider observation was accepted.",
    schema: {
      type: "string",
      enum: ["dexscreener", "gmgn", "gmgn+dexscreener"],
    },
  },
  "X-Programmable-Price-Source": {
    description:
      "Providers whose exact-identity observations qualified the displayed valuation. Omitted when no valuation qualified.",
    schema: {
      type: "string",
      enum: ["dexscreener", "gmgn", "gmgn+dexscreener"],
    },
  },
  "X-Programmable-Market-As-Of": {
    description:
      "Provider observation time for the response valuation. Omitted when no market valuation is available.",
    schema: { type: "string", format: "date-time" },
  },
} as const;

const exploreDiscoveryResponseHeaders = {
  "X-Programmable-Discovery-Provider": {
    description:
      "Discovery provider consulted for the optional Ethereum Trending order. Emitted only for sort=trending.",
    schema: { const: "gmgn" },
  },
  "X-Programmable-Discovery-Read-Status": {
    description:
      "Coverage of the filtered canonical launch set. Unavailable means canonical Newest order was used without hiding any launch.",
    schema: {
      type: "string",
      enum: ["complete", "partial", "unavailable"],
    },
  },
  "X-Programmable-Discovery-Matched-Count": {
    description:
      "Number of filtered canonical launches matched by accepted GMGN discovery observations.",
    schema: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
  },
  "X-Programmable-Discovery-Matched-Unique-Count": {
    description:
      "Number of unique lowercase canonical token addresses represented by the matched entry prefix.",
    schema: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
  },
  "X-Programmable-Discovery-Ranking-Commitment": {
    description:
      "Deterministic commitment to the ordered canonical matches (token address, canonical index, GMGN snapshot kind, interval and fetchedAt). Raw GMGN ranks remain private.",
    schema: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  },
} as const;

const exploreRankingResponseHeaders = {
  "X-Programmable-Ranking-Primary-Provider": {
    description:
      "Provider attempted first for market-cap ranking. This does not mean GMGN covered every canonical launch.",
    schema: { const: "gmgn" },
  },
  "X-Programmable-Ranking-Source": {
    description:
      "Accepted ranking signals. canonical-launch-order means neither provider supplied an accepted ranking signal.",
    schema: {
      type: "string",
      enum: [
        "gmgn",
        "gmgn+dexscreener",
        "dexscreener",
        "canonical-launch-order",
      ],
    },
  },
  "X-Programmable-Ranking-Read-Status": {
    description:
      "Aggregate coverage by accepted GMGN global market-cap ranks, GMGN token_info FDV and exact-identity Dexscreener FDV fallback. See the separate GMGN status for primary-provider coverage.",
    schema: {
      type: "string",
      enum: ["complete", "partial", "unavailable"],
    },
  },
  "X-Programmable-Ranking-GMGN-Status": {
    description:
      "GMGN-only canonical coverage across global market-cap rank and bounded token_info FDV hydration. partial never means a globally complete GMGN market-cap ranking.",
    schema: {
      type: "string",
      enum: ["complete", "partial", "unavailable"],
    },
  },
  "X-Programmable-Ranking-Commitment": {
    description:
      "Deterministic commitment to direction, accepted snapshot intent and the complete ordered canonical identity set.",
    schema: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  },
} as const;

const exploreSearchResponseHeaders = {
  "X-Programmable-Search-Provider": {
    description:
      "Search relevance provider consulted for a nonempty Ethereum q query.",
    schema: { const: "gmgn" },
  },
  "X-Programmable-Search-Read-Status": {
    description:
      "Coverage of the canonical search result. unavailable means the bounded GMGN read failed and local exact/substring launch order was retained.",
    schema: {
      type: "string",
      enum: ["complete", "partial", "unavailable"],
    },
  },
  "X-Programmable-Search-Matched-Count": {
    description:
      "Number of canonical Programmable entries matched by accepted GMGN coin rows.",
    schema: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
  },
  "X-Programmable-Search-Matched-Unique-Count": {
    description:
      "Number of unique canonical Ethereum token addresses matched by GMGN.",
    schema: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
  },
  "X-Programmable-Search-Ranking-Commitment": {
    description:
      "Deterministic commitment to the normalized query, accepted GMGN snapshot metadata and complete ordered canonical result.",
    schema: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  },
} as const;

export const programmablePublicOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Programmable developer APIs",
    version: "1.9.0",
    summary:
      "Verified launch discovery, live Ethereum V3 creation and the public self-serve Robinhood V4 release candidate.",
    description:
      "The programmable.market discovery endpoints remain unauthenticated and read-only. At the separately hosted Custom Launch API, fresh writes use the public Ethereum V3.3 contract. Robinhood Chain V4 Router and backend are deployed and ready, and target a public self-serve launch path; this static release candidate awaits public discovery promotion, so clients must require live publicWrites, publicAuthorization and releaseReady fields before creating. The required default policy for new Robinhood V4 API Custom launches is 20 bps to the published recipient. It is policy configuration, not proof of canonical onchain fee enforcement, a charged fee or platform revenue, and missing onchain fee enforcement is not itself a write blocker. V2 and V1 history remain readable, while both legacy creation routes are write-fenced with non-retryable 409 CUSTOM_LAUNCH_V2_READ_ONLY and CUSTOM_LAUNCH_V1_READ_ONLY responses. CLI and model checks prepare a request; only the API server decides whether verified evidence permits a wallet handoff. Legacy Registry and GitHub submission intake is closed. An API key and the CLI never sign or broadcast a controller-wallet transaction.",
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
      name: "Operations",
      description: "Public, secret-free provider readiness observations.",
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
        "Fresh wallet-key, partner-root and bounded-partner-subkey writes use Ethereum V3.3. Robinhood V4 Router and backend are deployed and ready; the public self-serve release candidate awaits public discovery promotion. Resolve activation from the live discovery authority. Its required 20 bps default policy is not a canonical onchain-enforcement or revenue claim. V2 and V1 remain available for existing history only. Manage wallet keys at programmable.market/developers/api-keys.",
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
    "/api/ops/health": {
      get: {
        operationId: "getOperationsHealth",
        summary: "Read public provider health",
        description:
          "Returns informational provider-stack readiness, the effective parsed GMGN request rate used by every server-side GMGN adapter, and a secret-free account-gate mode attestation. RPS 20 is ready only with multiflight-v1. The response never contains provider credentials, environment metadata, or endpoint configuration.",
        tags: ["Operations"],
        security: [],
        responses: {
          "200": jsonResponse(
            component("OperationsHealth"),
            "Secret-free provider-stack health observation.",
          ),
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
            name: "chain",
            in: "query",
            description:
              "Chain-scoped Explore discovery. Ethereum Mainnet retains its existing market-enriched response. Robinhood returns a newest-only ready projection only when the finalized Programmable backend feed and direct chain verification succeed; otherwise it returns the honest planned-not-deployed response.",
            schema: { type: "integer", enum: [1, 4663], default: 1 },
          },
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
            description:
              "One to 100 Unicode code points after normalization. GMGN coin relevance is intersected with the canonical Programmable catalog; foreign coins and wallet rows can never enter the result. Local exact and substring matches remain the stable fallback.",
            schema: { type: "string", minLength: 1, maxLength: 100 },
          },
          {
            name: "model",
            in: "query",
            description: "Limit results to one public launch category.",
            schema: { type: "string", enum: ["classic", "custom"] },
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
            description:
              "Canonical launch order, GMGN Trending, or GMGN-primary market-cap ordering. chain=4663 accepts only newest. trending and every market-cap sort are accepted only with chain=1. Market-cap sorts place qualified canonical GMGN rank matches first in the requested direction, then sort only the unobserved canonical remainder by exact-identity Dexscreener FDV; this is deliberately not a cross-provider numeric merge. Every mode retains the complete filtered canonical catalog.",
            schema: {
              type: "string",
              enum: [
                "newest",
                "oldest",
                "trending",
                "market-cap",
                "market-cap-asc",
                "highest-market-cap",
                "lowest-market-cap",
              ],
              default: "newest",
            },
          },
          {
            name: "rankingCommitment",
            in: "query",
            description:
              "Required for page > 1 with sort=market-cap or sort=market-cap-asc. Pass the exact ranking.rankingCommitment returned by page 1 to keep every page on the same retained ranking generation. If that generation is no longer retained, restart from page 1.",
            schema: {
              type: "string",
              pattern: "^sha256:[0-9a-f]{64}$",
            },
          },
        ],
        responses: {
          "200": {
            ...jsonResponse(
              component("ExploreListResponse"),
              "Verified chain-scoped launch page or an honest planned-not-deployed Robinhood response.",
            ),
            headers: {
              ...exploreIdentityResponseHeaders,
              ...exploreMarketResponseHeaders,
              ...exploreDiscoveryResponseHeaders,
              ...exploreRankingResponseHeaders,
              ...exploreSearchResponseHeaders,
            },
          },
          "400": jsonResponse(component("ApiError"), "Invalid query shape."),
          "409": jsonResponse(
            component("ApiError"),
            "The requested market-cap ranking generation is no longer retained; restart pagination from page 1.",
          ),
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
          "Looks up an exact token identity on the selected chain. Ethereum Mainnet retains its existing market-enriched response. Robinhood returns a ready identity only when the finalized Programmable backend feed and direct chain verification succeed; otherwise it returns the honest planned-not-deployed response. A 404 response is a completed verified lookup with no public identity, not a provider timeout.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "chain",
            in: "query",
            description:
              "Identity namespace. Omit for the backward-compatible Ethereum Mainnet default.",
            schema: { type: "integer", enum: [1, 4663], default: 1 },
          },
          {
            name: "address",
            in: "query",
            required: true,
            description: "EVM token contract address on the selected chain.",
            schema: component("EthereumAddress"),
            example: V4_TOKEN_ADDRESS,
          },
        ],
        responses: {
          "200": {
            ...jsonResponse(
              component("TokenDetailResponse"),
              "Verified chain-scoped token, Registry-verified Custom project, or honest planned-not-deployed Robinhood response.",
            ),
            headers: {
              ...exploreIdentityResponseHeaders,
              ...exploreMarketResponseHeaders,
            },
          },
          "400": jsonResponse(component("ApiError"), "Invalid address or query shape."),
          "404": {
            ...jsonResponse(
              component("TokenDetailLookupReadyResponse"),
              "Verified lookup completed but no public token identity matched. No market provider is read for this response.",
            ),
            headers: exploreIdentityResponseHeaders,
          },
          "503": jsonResponse(
            component("ApiError"),
            "The identity boundary could not be verified at this time.",
          ),
        },
      },
    },
    "/api/explore/token/analytics": {
      get: {
        operationId: "getVerifiedTokenAnalytics",
        summary: "Read normalized GMGN analytics for one verified token",
        description:
          "Resolves the token through Programmable's canonical Ethereum launch authorities and requires a strict GMGN token_info admission proof before returning analytics. summary returns token-level security heuristics and token-level Uniswap v4 pool_info observations with unavailable pool attribution. holders and traders are token-address rankings admitted by that proof; they use a fixed 20-row request and return only seven normalized wallet metrics per row and are always private and no-store. Provider output remains normalized: raw GMGN envelopes, ranking query metadata, wallet profile metadata, and credentials are never returned.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "chain",
            in: "query",
            description: "Ethereum only. Omit for chain 1.",
            schema: { type: "integer", enum: [1], default: 1 },
          },
          {
            name: "address",
            in: "query",
            required: true,
            description: "Canonical Programmable token contract address.",
            schema: component("EthereumAddress"),
            example: V4_TOKEN_ADDRESS,
          },
          {
            name: "section",
            in: "query",
            description:
              "summary is edge-cacheable only when data is accepted. holders and traders are private no-store reads.",
            schema: {
              type: "string",
              enum: ["summary", "holders", "traders"],
              default: "summary",
            },
          },
          {
            name: "limit",
            in: "query",
            description:
              "Optional fixed ranking limit. When present, the exact decimal value 20 is required for every section; every other value is rejected.",
            schema: { type: "integer", const: 20, default: 20 },
          },
        ],
        responses: {
          "200": {
            ...jsonResponse(
              component("TokenAnalyticsResponse"),
              "Canonical-bound, normalized GMGN analytics. An unavailable status remains a successful canonical lookup with null analytics.",
            ),
            headers: {
              ...exploreIdentityResponseHeaders,
              ...exploreMarketResponseHeaders,
              "X-Programmable-Analytics-Provider": {
                description: "Normalized analytics provider.",
                schema: { const: "gmgn" },
              },
              "X-Programmable-Analytics-Scope": {
                description: "Scope of every accepted analytics section.",
                schema: { const: "token" },
              },
              "X-Programmable-Analytics-Pool-Attribution": {
                description:
                  "GMGN pool_info does not expose the canonical bytes32 v4 PoolId, so analytics pool attribution is unavailable.",
                schema: { const: "unavailable" },
              },
              "X-Programmable-Analytics-Read-Status": {
                description:
                  "Accepted normalized analytics coverage for the requested section.",
                schema: {
                  type: "string",
                  enum: ["ready", "partial", "unavailable"],
                },
              },
              "X-Programmable-Data-Quality": {
                description: "Current, partial, or unavailable analytics quality.",
                schema: {
                  type: "string",
                  enum: ["current", "partial", "unavailable"],
                },
              },
              "Cache-Control": {
                description:
                  "summary may use a 15-second shared cache only when data is accepted. holders, traders, and unavailable responses are private no-store.",
                schema: { type: "string" },
              },
            },
          },
          "400": jsonResponse(component("ApiError"), "Invalid analytics query."),
          "404": {
            ...jsonResponse(component("ApiError"), "No canonical token matched."),
            headers: exploreIdentityResponseHeaders,
          },
          "503": {
            ...jsonResponse(
              component("ApiError"),
              "The canonical identity boundary could not be verified.",
            ),
            headers: exploreIdentityResponseHeaders,
          },
        },
      },
    },
    "/api/explore/token/chart": {
      get: {
        operationId: "getVerifiedTokenChart",
        summary: "Read token price history with explicit series scope",
        description:
          "Resolves one canonical Ethereum launch, then prefers current GMGN token_kline period-close OHLCV scoped to the token address. GMGN token_info must first prove the exact token, quote asset, v4 exchange and canonical supply; every explicit base or token-pair field must match that token and quote. Coherent bytes32 locators must equal the canonical PoolId and yield exact current admission attribution; coherent 20-byte provider contract locators yield unavailable attribution. Neither state is per-candle provenance. Bitquery period-median history remains the exact-pool fallback. Provider errors never add or remove canonical launch identity.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "address",
            in: "query",
            required: true,
            description: "Canonical Programmable Ethereum token address.",
            schema: component("EthereumAddress"),
            example: V4_TOKEN_ADDRESS,
          },
          {
            name: "range",
            in: "query",
            description: "Requested bounded chart range.",
            schema: {
              type: "string",
              enum: ["1h", "1d", "1w", "all"],
              default: "all",
            },
          },
        ],
        responses: {
          "200": {
            ...jsonResponse(
              component("TokenChartResponse"),
              "Token-address GMGN period-close OHLCV, exact-pool Bitquery period-median history, or an honest unavailable chart response.",
            ),
            headers: {
              "X-Programmable-Data-Quality": {
                description: "Current, partial, or unavailable chart quality.",
                schema: {
                  type: "string",
                  enum: ["current", "partial", "unavailable"],
                },
              },
              "X-Programmable-Launch-Source":
                exploreIdentityResponseHeaders["X-Programmable-Launch-Source"],
              "X-Programmable-Read-Source":
                exploreIdentityResponseHeaders["X-Programmable-Read-Source"],
              "X-Programmable-Router-Read-Status":
                exploreIdentityResponseHeaders["X-Programmable-Router-Read-Status"],
              "X-Programmable-Market-Provider": {
                description: "Chart provider selected for this response.",
                schema: { type: "string", enum: ["gmgn", "bitquery"] },
              },
              "X-Programmable-Market-Read-Status": {
                description: "Live or bounded cache-fallback chart read.",
                schema: {
                  type: "string",
                  enum: ["live", "cache-fallback"],
                },
              },
              "X-Programmable-Chart-Scope": {
                description:
                  "Series scope selected for this response. GMGN is token-address history; Bitquery is exact-pool history.",
                schema: { type: "string", enum: ["token", "pool"] },
              },
              "X-Programmable-Chart-Pool-Attribution": {
                description:
                  "For GMGN, the current token_info locator attribution; it is not per-candle provenance. Bitquery exact means its chart is queried by canonical pool identity.",
                schema: {
                  type: "string",
                  enum: ["unavailable", "exact"],
                },
              },
              "X-Programmable-Market-Source": {
                description:
                  "Accepted chart source. Interpret it with the chart scope and pool-attribution headers.",
                schema: { type: "string", enum: ["gmgn", "bitquery"] },
              },
              "X-Programmable-Price-Source": {
                description:
                  "Accepted chart price source. Omitted when no chart point was accepted.",
                schema: { type: "string", enum: ["gmgn", "bitquery"] },
              },
              "X-Programmable-Market-As-Of": {
                description: "End time of the latest accepted chart period.",
                schema: { type: "string", format: "date-time" },
              },
            },
          },
          "400": jsonResponse(component("ApiError"), "Invalid chart query."),
          "404": jsonResponse(component("ApiError"), "No canonical token matched."),
          "503": jsonResponse(
            component("MarketChartError"),
            "The identity or selected chart history boundary is unavailable.",
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
      get: {
        operationId: "listCustomLaunches",
        summary: "List your Custom launch requests",
        description:
          "Returns newest-first bounded summaries for the exact wallet bound to the API key. Pagination is keyset-based, output is always null, and pending rows receive bounded best-effort chain reconciliation without hiding durable history on RPC failure. Read the single-resource route for the full prepared artifact and exact output.",
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
            name: "limit",
            in: "query",
            required: false,
            description: "Page size. Defaults to 10 and never exceeds 25.",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 25,
              default: 10,
            },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Opaque nextCursor returned by the previous page.",
            schema: {
              type: "string",
              minLength: 16,
              maxLength: 512,
              pattern: "^[A-Za-z0-9_-]+$",
            },
          },
        ],
        responses: {
          "200": jsonResponse(
            component("CustomLaunchListPage"),
            "Wallet-owned launch request page.",
          ),
          "400": jsonResponse(
            component("CustomLaunchApiError"),
            "Invalid pagination query.",
          ),
          "401": jsonResponse(
            component("CustomLaunchApiError"),
            "API key is missing, malformed, expired, revoked, or unknown.",
          ),
          "403": jsonResponse(
            component("CustomLaunchApiError"),
            "API key lacks custom-launch:read.",
          ),
          "503": jsonResponse(
            component("CustomLaunchApiError"),
            "Launch history is temporarily unavailable.",
          ),
        },
      },
      post: {
        operationId: "createCustomLaunch",
        deprecated: true,
        summary: "V1 launch creation is read-only",
        description:
          "The V1 creation route is retained only as an explicit write fence. After successful API-key authentication and scope checks it returns 409 CUSTOM_LAUNCH_V1_READ_ONLY before reading an idempotency key or request body. This response is non-retryable. Use the live V1 GET operations for existing history and the standalone public V3.3 contract for fresh writes.",
        tags: ["Custom launch"],
        servers: [
          {
            url: CUSTOM_LAUNCH_API_ORIGIN,
            description: "Programmable Custom Launch API",
          },
        ],
        security: [{ CustomLaunchApiKey: [] }],
        responses: {
          "401": jsonResponse(
            component("CustomLaunchApiError"),
            "API key is missing, malformed, expired, revoked, or unknown.",
          ),
          "403": jsonResponse(
            component("CustomLaunchApiError"),
            "API key lacks the legacy custom-launch:create scope.",
          ),
          "409": {
            description: "V1 launch creation is read-only. Do not retry this request.",
            content: {
              "application/json": {
                schema: component("CustomLaunchApiError"),
                example: {
                  schemaVersion: "programmable.api-error.v1",
                  error: {
                    code: "CUSTOM_LAUNCH_V1_READ_ONLY",
                    message: "V1 launch creation is read-only; use the public V3.3 launch contract",
                    requestId: "018f1f8e-7d93-7c2f-8d7f-e114942e7f25",
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/custom-launches/{launchId}": {
      get: {
        operationId: "getCustomLaunch",
        summary: "Read a Custom launch",
        description:
          "Returns one existing launch owned by the API key's wallet principal. After the controller wallet broadcasts a previously authorized transaction, polling this single-resource route performs request-driven Router reconciliation for authorized and submitted launches. There is no background reconciliation timer. A missing launch and another principal's launch both return 404.",
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
            description:
              "Legacy path name for the API request UUID returned as both launchId and requestId. It is not the bytes32 onchainLaunchId.",
            schema: component("CustomLaunchRequestId"),
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
          "429": {
            description:
              "The read rate limit was reached. Retry the same single-resource read after the indicated delay.",
            headers: {
              "Retry-After": {
                description:
                  "Delay in seconds or an HTTP date after which the request may be retried.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: component("CustomLaunchApiError"),
              },
            },
          },
          "503": {
            description: "The Custom Launch API is temporarily unavailable.",
            headers: {
              "Retry-After": {
                description:
                  "Optional delay in seconds or an HTTP date after which the same request may be retried.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: component("CustomLaunchApiError"),
              },
            },
          },
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
          "Wallet-bound API key managed at https://programmable.market/developers/api-keys. Keys can create through V3.3 and read wallet-owned V2 and V1 history. A create scope does not override either legacy write fence. Keys are not wallets and cannot sign or broadcast transactions.",
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
      CustomLaunchRequestId: {
        type: "string",
        format: "uuid",
        description:
          "Durable API request identifier. This is distinct from the bytes32 onchain launch identifier.",
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
      ExactSourceCompilationUnitV1: {
        type: "object",
        description:
          "One exact Solidity Standard JSON compilation input. The decoded UTF-8 bytes, not a reconstructed object, are the hash preimage. The input is closed to language, sources and settings; every source entry contains only inline content and no URL.",
        required: [
          "compilationUnitId",
          "compilerVersion",
          "standardJsonInputBase64",
          "standardJsonInputSha256",
        ],
        properties: {
          compilationUnitId: component("CanonicalIdentifier"),
          compilerVersion: {
            type: "string",
            pattern: "^0\\.[0-9]+\\.[0-9]+\\+commit\\.[0-9a-f]{8}$",
            description:
              "Exact solc build identifier, including the eight-character commit suffix.",
          },
          standardJsonInputBase64: {
            type: "string",
            minLength: 4,
            maxLength: 6_990_508,
            pattern:
              "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
            description:
              "Canonical base64 of the exact UTF-8 Solidity Standard JSON input bytes. Decoded input is limited to 5,242,880 bytes per compilation unit and across all units in the request.",
          },
          standardJsonInputSha256: component("Sha256Digest"),
        },
        additionalProperties: false,
      },
      ExactSourceComponentV1: {
        type: "object",
        description:
          "Exact compiler target identity and resolved constructor arguments for one graph target.",
        required: [
          "targetId",
          "compilationUnitId",
          "sourcePath",
          "contractName",
          "constructorArguments",
        ],
        properties: {
          targetId: component("CanonicalIdentifier"),
          compilationUnitId: component("CanonicalIdentifier"),
          sourcePath: { type: "string", minLength: 1 },
          contractName: component("CanonicalIdentifier"),
          constructorArguments: {
            type: "string",
            pattern: "^0x(?:[0-9a-f]{2})*$",
            description:
              "Lowercase ABI-encoded constructor arguments after graph address locators are resolved.",
          },
        },
        additionalProperties: false,
      },
      ExactSourceVerificationBundleV1: {
        type: "object",
        description:
          "Optional exact-source material bound to the prepared artifact. Compilation units are uniquely sorted by UTF-8 compilationUnitId; components are uniquely sorted by UTF-8 targetId and exactly cover every graph target. Decoded Standard JSON is limited to 5,242,880 bytes per compilation unit and in aggregate.",
        required: ["schemaVersion", "compilationUnits", "components"],
        properties: {
          schemaVersion: {
            const: "programmable.exact-source-verification-bundle.v1",
          },
          compilationUnits: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: component("ExactSourceCompilationUnitV1"),
          },
          components: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: component("ExactSourceComponentV1"),
          },
        },
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
          verificationBundle: {
            ...component("ExactSourceVerificationBundleV1"),
            description:
              "Optional for V1 compatibility. When present, the exact bundle is cryptographically bound to the prepared artifact and enables post-finality exact-match verification.",
          },
        },
        additionalProperties: false,
      },
      CustomLaunchFailure: {
        type: "object",
        required: ["code", "message", "retryable"],
        properties: {
          code: {
            type: "string",
            description:
              "Stable failure code. PERMIT_EXPIRED is terminal and requires a new nonce and Idempotency-Key.",
          },
          message: { type: "string" },
          retryable: { type: "boolean" },
        },
        additionalProperties: false,
      },
      PreparedLaunchStampRequest: {
        type: "object",
        required: [
          "launchId",
          "token",
          "tokenRuntimeCodeHash",
          "poolKey",
          "hookRuntimeCodeHash",
          "components",
        ],
        properties: {
          launchId: {
            ...component("LowerHex32"),
            description: "The bytes32 onchain launch identifier.",
          },
          token: component("EthereumAddress"),
          tokenRuntimeCodeHash: component("LowerHex32"),
          poolKey: {
            type: "object",
            required: ["currency0", "currency1", "fee", "tickSpacing", "hooks"],
            properties: {
              currency0: component("EthereumAddress"),
              currency1: component("EthereumAddress"),
              fee: { type: "integer", minimum: 0, maximum: 8_388_608 },
              tickSpacing: { type: "integer" },
              hooks: component("EthereumAddress"),
            },
            additionalProperties: false,
          },
          hookRuntimeCodeHash: component("LowerHex32"),
          components: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["resultIndex", "account", "runtimeCodeHash", "kind", "scope"],
              properties: {
                resultIndex: { type: "integer", minimum: 0, maximum: 255 },
                account: component("EthereumAddress"),
                runtimeCodeHash: component("LowerHex32"),
                kind: { type: "integer", enum: [0, 1, 2] },
                scope: { const: 1 },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      PreparedLaunchPermit: {
        type: "object",
        required: [
          "chainId",
          "router",
          "launchWallet",
          "kind",
          "routePayloadHash",
          "expectedResultHash",
          "stampRequestHash",
          "nonce",
          "validAfter",
          "deadline",
          "valueWei",
        ],
        properties: {
          chainId: { const: "1" },
          router: component("EthereumAddress"),
          launchWallet: component("EthereumAddress"),
          kind: { const: 1 },
          routePayloadHash: component("LowerHex32"),
          expectedResultHash: component("LowerHex32"),
          stampRequestHash: component("LowerHex32"),
          nonce: component("NonzeroLowerHex32"),
          validAfter: component("CanonicalUint256"),
          deadline: component("CanonicalUint256"),
          valueWei: component("CanonicalUint256"),
        },
        additionalProperties: false,
      },
      PreparedLaunchArtifact: {
        type: "object",
        description:
          "Hash-bound prepared launch artifact. Stable signing and provenance fields are typed here; route construction details remain part of the returned artifact and are covered by artifactHash.",
        required: [
          "schemaVersion",
          "graphBundleHash",
          "sourceBundleSha256",
          "chainBindings",
          "callerConstraints",
          "timing",
          "route",
          "predictedComponents",
          "market",
          "stampRequest",
          "stampRequestHash",
          "permit",
          "permitDigest",
          "unsignedRouterTransaction",
          "claims",
          "artifactHash",
        ],
        properties: {
          schemaVersion: { const: "programmable.prepared-custom-graph-launch.v1" },
          graphBundleHash: component("Sha256Digest"),
          sourceBundleSha256: component("Sha256Digest"),
          chainBindings: { type: "object", additionalProperties: true },
          callerConstraints: { type: "object", additionalProperties: true },
          timing: { type: "object", additionalProperties: true },
          route: { type: "object", additionalProperties: true },
          predictedComponents: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          market: { type: "object", additionalProperties: true },
          stampRequest: component("PreparedLaunchStampRequest"),
          stampRequestHash: component("LowerHex32"),
          permit: component("PreparedLaunchPermit"),
          permitDigest: component("LowerHex32"),
          unsignedRouterTransaction: {
            type: "object",
            required: [
              "chainId",
              "from",
              "to",
              "valueWei",
              "functionName",
              "selector",
              "calldataWithEmptySignature",
              "signatureState",
              "preimageHash",
            ],
            properties: {
              chainId: { const: "1" },
              from: component("EthereumAddress"),
              to: component("EthereumAddress"),
              valueWei: component("CanonicalUint256"),
              functionName: { const: "launchAndStampV1" },
              selector: { const: "0xe5f6b8cd" },
              calldataWithEmptySignature: component("HexData"),
              signatureState: { const: "permit-authority-signature-required" },
              preimageHash: component("Sha256Digest"),
            },
            additionalProperties: false,
          },
          claims: {
            type: "object",
            required: ["provenance", "safety", "approval"],
            properties: {
              provenance: { const: "prepared-for-atomic-router-stamp" },
              safety: { const: "not-asserted" },
              approval: { const: "not-asserted" },
            },
            additionalProperties: false,
          },
          artifactHash: component("Sha256Digest"),
        },
        additionalProperties: false,
      },
      AgentLaunchAttestationResult: {
        type: "object",
        description:
          "Normalized caller-supplied agent self-attestation. Programmable validates its shape and subject binding but does not assess the evidence or adopt the claims.",
        required: [
          "schemaVersion",
          "subjectGraphBundleHash",
          "agentId",
          "checkedAt",
          "checks",
          "attribution",
          "platformVerification",
          "safetyClaim",
          "approvalClaim",
        ],
        properties: {
          schemaVersion: { const: "programmable.agent-launch-attestation.v1" },
          subjectGraphBundleHash: component("Sha256Digest"),
          agentId: component("CanonicalIdentifier"),
          checkedAt: { type: "string", format: "date-time" },
          checks: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            items: component("AgentLaunchAttestationCheckV1"),
          },
          attribution: { const: "agent-self-attested" },
          platformVerification: { const: "not-performed-by-this-attestation" },
          safetyClaim: { const: "not-made" },
          approvalClaim: { const: "not-made" },
        },
        additionalProperties: false,
      },
      SignedPreparedLaunchPermit: {
        type: "object",
        description:
          "Platform permit-authority signature. This is not a controller-wallet transaction signature.",
        required: [
          "schemaVersion",
          "artifactHash",
          "chainId",
          "router",
          "authoritySafe",
          "signerAddress",
          "permitDigest",
          "safeMessageDigest",
          "signature",
          "validAfter",
          "deadline",
        ],
        properties: {
          schemaVersion: { const: "programmable.signed-prepared-launch-permit.v1" },
          artifactHash: component("Sha256Digest"),
          chainId: { const: "1" },
          router: component("EthereumAddress"),
          authoritySafe: component("EthereumAddress"),
          signerAddress: component("EthereumAddress"),
          permitDigest: component("LowerHex32"),
          safeMessageDigest: component("LowerHex32"),
          signature: component("HexData"),
          validAfter: component("CanonicalUint256"),
          deadline: component("CanonicalUint256"),
        },
        additionalProperties: false,
      },
      CustomLaunchWalletTransaction: {
        type: "object",
        description:
          "Exact permit-attached Router transaction for the separate controller-wallet signer to review, sign and broadcast.",
        required: [
          "schemaVersion",
          "chainId",
          "from",
          "to",
          "valueWei",
          "functionName",
          "selector",
          "calldata",
          "signatureState",
          "requiresControllerWalletSignature",
          "broadcastByService",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-launch-wallet-transaction.v1" },
          chainId: { const: "1" },
          from: component("EthereumAddress"),
          to: component("EthereumAddress"),
          valueWei: component("CanonicalUint256"),
          functionName: { const: "launchAndStampV1" },
          selector: { const: "0xe5f6b8cd" },
          calldata: component("HexData"),
          signatureState: { const: "permit-authority-signature-attached" },
          requiresControllerWalletSignature: { const: true },
          broadcastByService: { const: false },
        },
        additionalProperties: false,
      },
      CustomLaunchObservationWindow: {
        type: "object",
        description:
          "Bounded Mainnet Router log window captured during preparation. Single-resource GET polling reconciles only inside this window.",
        required: ["schemaVersion", "chainId", "router", "fromBlock", "toBlock"],
        properties: {
          schemaVersion: { const: "programmable.custom-launch-observation-window.v1" },
          chainId: { const: "1" },
          router: component("EthereumAddress"),
          fromBlock: component("CanonicalUint256"),
          toBlock: component("CanonicalUint256"),
        },
        additionalProperties: false,
      },
      CustomLaunchOnchainEvidence: {
        type: "object",
        description:
          "Canonical Router event and same-block launchStamp getter evidence matched to the prepared artifact. Finalized means confirmationDepth is at least 64.",
        required: [
          "schemaVersion",
          "finalityState",
          "chainId",
          "router",
          "onchainLaunchId",
          "transactionHash",
          "blockNumber",
          "blockHash",
          "logIndex",
          "token",
          "hook",
          "poolManager",
          "poolId",
          "stampHash",
          "confirmationDepth",
          "requiredConfirmationDepth",
          "observedAtBlockNumber",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-launch-onchain-evidence.v1" },
          finalityState: { type: "string", enum: ["submitted", "finalized"] },
          chainId: { const: "1" },
          router: component("EthereumAddress"),
          onchainLaunchId: component("LowerHex32"),
          transactionHash: component("LowerHex32"),
          blockNumber: component("CanonicalUint256"),
          blockHash: component("LowerHex32"),
          logIndex: { type: "integer", minimum: 0 },
          token: component("EthereumAddress"),
          hook: component("EthereumAddress"),
          poolManager: component("EthereumAddress"),
          poolId: component("LowerHex32"),
          stampHash: component("LowerHex32"),
          confirmationDepth: component("CanonicalUint256"),
          requiredConfirmationDepth: { const: "64" },
          observedAtBlockNumber: component("CanonicalUint256"),
        },
        additionalProperties: false,
      },
      CustomLaunchPreparedOutput: {
        type: "object",
        description:
          "Prepared artifact before the platform permit is signed. No wallet transaction or observation window is available yet.",
        required: [
          "schemaVersion",
          "artifact",
          "agentAttestation",
          "signedPermit",
          "walletTransaction",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-launch-authorization-result.v1" },
          artifact: component("PreparedLaunchArtifact"),
          agentAttestation: component("AgentLaunchAttestationResult"),
          signedPermit: { type: "null" },
          walletTransaction: { type: "null" },
        },
        additionalProperties: false,
      },
      CustomLaunchAuthorizedOutput: {
        type: "object",
        description:
          "Permit-attached wallet handoff plus bounded reconciliation state. onchain is null until single-resource polling observes a canonical Router stamp.",
        required: [
          "schemaVersion",
          "artifact",
          "agentAttestation",
          "signedPermit",
          "walletTransaction",
          "observationWindow",
          "onchain",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-launch-authorization-result.v1" },
          artifact: component("PreparedLaunchArtifact"),
          agentAttestation: component("AgentLaunchAttestationResult"),
          signedPermit: component("SignedPreparedLaunchPermit"),
          walletTransaction: component("CustomLaunchWalletTransaction"),
          observationWindow: component("CustomLaunchObservationWindow"),
          onchain: {
            oneOf: [component("CustomLaunchOnchainEvidence"), { type: "null" }],
          },
        },
        additionalProperties: false,
      },
      CustomLaunchOutput: {
        description:
          "Typed durable output for prepared, authorized, submitted and finalized launch states.",
        oneOf: [
          component("CustomLaunchPreparedOutput"),
          component("CustomLaunchAuthorizedOutput"),
        ],
      },
      SourceVerificationComponentV1: {
        type: "object",
        required: ["targetId", "address", "status", "provider"],
        properties: {
          targetId: component("CanonicalIdentifier"),
          address: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
          status: {
            type: "string",
            enum: ["queued", "retrying", "exact_match", "needs_attention"],
          },
          provider: {
            type: ["string", "null"],
            enum: ["sourcify", "etherscan", "blockscout", null],
          },
        },
        additionalProperties: false,
      },
      SourceVerificationStatusV1: {
        type: "object",
        description:
          "Server-authored exact-source verification state. Only literal exact_match for every exclusive component means Source verified; clients must not infer or submit this object.",
        required: ["schemaVersion", "status", "components", "updatedAt"],
        properties: {
          schemaVersion: {
            const: "programmable.source-verification-status.v1",
          },
          status: {
            type: "string",
            enum: ["queued", "retrying", "exact_match", "needs_attention"],
          },
          components: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: component("SourceVerificationComponentV1"),
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
          },
        },
        additionalProperties: false,
      },
      CustomLaunchResource: {
        type: "object",
        description:
          "Durable API request state. launchId is the legacy alias of requestId; onchainLaunchId is the distinct Router bytes32 identifier and is present whenever durable output retains a prepared artifact. Poll this resource after wallet broadcast to drive request-scoped reconciliation.",
        required: [
          "schemaVersion",
          "launchId",
          "requestId",
          "onchainLaunchId",
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
            ...component("CustomLaunchRequestId"),
            description:
              "Deprecated-compatible alias of requestId. It is not an onchain identifier.",
            deprecated: true,
          },
          requestId: component("CustomLaunchRequestId"),
          onchainLaunchId: {
            description:
              "Router bytes32 launch identifier. It is null before preparation and when a terminal failure clears the durable output.",
            oneOf: [component("LowerHex32"), { type: "null" }],
          },
          routeId: { const: "custom-launch:create:v1" },
          ownerWallet: component("EthereumAddress"),
          status: {
            type: "string",
            description:
              "authorized means the permit-attached transaction awaits a separate wallet signature and broadcast. submitted means exact canonical Router event/getter evidence was observed below 64 confirmations. finalized means the same evidence reached at least 64 confirmations.",
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
            description:
              "Server-side canonical idempotency request digest. It is distinct from a caller's local SHA-256 of the exact HTTP request bytes.",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          output: {
            description:
              "Null before preparation and after a terminal failure. prepared returns CustomLaunchPreparedOutput; authorized, submitted and finalized return CustomLaunchAuthorizedOutput.",
            oneOf: [component("CustomLaunchOutput"), { type: "null" }],
          },
          failure: {
            oneOf: [component("CustomLaunchFailure"), { type: "null" }],
          },
          sourceVerification: {
            description:
              "Optional server-authored post-finality verification state. It is absent or null for legacy requests, requests without an exact-source bundle, and requests that have not created verification jobs.",
            oneOf: [
              component("SourceVerificationStatusV1"),
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      CustomLaunchListPage: {
        type: "object",
        description:
          "Newest-first wallet-owned summary page. Each item uses the CustomLaunchResource shape but always has output=null; use the single-resource route for the prepared artifact. launchId remains the legacy alias of requestId; neither should be confused with onchainLaunchId.",
        required: ["schemaVersion", "launches", "nextCursor"],
        properties: {
          schemaVersion: { const: "programmable.custom-launch-list.v1" },
          launches: {
            type: "array",
            maxItems: 25,
            items: component("CustomLaunchResource"),
          },
          nextCursor: {
            oneOf: [
              {
                type: "string",
                minLength: 16,
                maxLength: 512,
                pattern: "^[A-Za-z0-9_-]+$",
              },
              { type: "null" },
            ],
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
              code: {
                type: "string",
                description:
                  "Stable API error code, including IDEMPOTENCY_CONFLICT, NONCE_CONFLICT and PERMIT_EXPIRED.",
              },
              message: { type: "string" },
              requestId: {
                type: "string",
                format: "uuid",
                description:
                  "HTTP correlation identifier for this error response, not a Custom launch resource requestId.",
              },
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
      OperationsHealth: {
        type: "object",
        required: ["status", "provider", "providers", "checkedAt"],
        properties: {
          status: { type: "string", enum: ["ready", "degraded"] },
          provider: component("OperationsPrimaryProvider"),
          providers: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            prefixItems: [
              component("OperationsGmgnProvider"),
              component("OperationsBitqueryProvider"),
              component("OperationsDexscreenerProvider"),
            ],
            items: false,
          },
          checkedAt: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
      },
      OperationsPrimaryProvider: {
        type: "object",
        required: ["name", "configured"],
        properties: {
          name: { const: "gmgn" },
          configured: { type: "boolean" },
        },
        additionalProperties: false,
      },
      OperationsGmgnProvider: {
        type: "object",
        description:
          "GMGN primary runtime state. requestsPerSecond is the effective shared server-side limiter setting after fail-closed parsing; accountGateMode is a secret-free concurrency readiness attestation. Neither field is a credential.",
        required: [
          "name",
          "role",
          "configured",
          "requestsPerSecond",
          "accountGateMode",
        ],
        properties: {
          name: { const: "gmgn" },
          role: { const: "primary-token-market" },
          configured: { type: "boolean" },
          requestsPerSecond: {
            type: "integer",
            minimum: 1,
            maximum: 20,
          },
          accountGateMode: {
            type: "string",
            enum: [
              "multiflight-v1",
              "legacy-singleflight-v1",
              "unavailable",
            ],
          },
        },
        additionalProperties: false,
      },
      OperationsBitqueryProvider: {
        type: "object",
        required: ["name", "role", "configured"],
        properties: {
          name: { const: "bitquery" },
          role: { const: "exact-pool-chart-fallback" },
          configured: { type: "boolean" },
        },
        additionalProperties: false,
      },
      OperationsDexscreenerProvider: {
        type: "object",
        required: ["name", "role", "configured"],
        properties: {
          name: { const: "dexscreener" },
          role: { const: "batch-fail-soft-fallback" },
          configured: { const: true },
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
                enum: ["bitquery", "dexscreener", "gmgn", "stateview-chainlink"],
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
      DexscreenerExploreMarketRead: {
        type: "object",
        description:
          "Bounded Dexscreener batch result for the exact market identities requested by Explore.",
        required: [
          "provider",
          "status",
          "currency",
          "requestedCount",
          "observedCount",
          "qualifiedCount",
          "unavailableCount",
          "oldestFetchedAt",
          "newestFetchedAt",
        ],
        properties: {
          provider: { const: "dexscreener" },
          status: {
            type: "string",
            enum: ["complete", "partial", "unavailable"],
          },
          currency: { const: "USD" },
          requestedCount: { type: "integer", minimum: 0 },
          observedCount: { type: "integer", minimum: 0 },
          qualifiedCount: { type: "integer", minimum: 0 },
          unavailableCount: { type: "integer", minimum: 0 },
          oldestFetchedAt: {
            oneOf: [
              { type: "string", format: "date-time" },
              { type: "null" },
            ],
          },
          newestFetchedAt: {
            oneOf: [
              { type: "string", format: "date-time" },
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      GmgnExploreMarketRead: {
        type: "object",
        description:
          "Bounded GMGN primary result with exact-identity Dexscreener fallback accounting for the same Explore response.",
        required: [
          "provider",
          "fallbackProvider",
          "status",
          "currency",
          "requestedCount",
          "observedCount",
          "qualifiedCount",
          "unavailableCount",
          "gmgnObservedCount",
          "gmgnQualifiedCount",
          "fallbackRequestedCount",
          "fallbackObservedCount",
          "fallbackQualifiedCount",
          "oldestFetchedAt",
          "newestFetchedAt",
        ],
        properties: {
          provider: { const: "gmgn" },
          fallbackProvider: { const: "dexscreener" },
          status: {
            type: "string",
            enum: ["complete", "partial", "unavailable"],
          },
          currency: { const: "USD" },
          requestedCount: { type: "integer", minimum: 0 },
          observedCount: { type: "integer", minimum: 0 },
          qualifiedCount: { type: "integer", minimum: 0 },
          unavailableCount: { type: "integer", minimum: 0 },
          gmgnObservedCount: { type: "integer", minimum: 0 },
          gmgnQualifiedCount: { type: "integer", minimum: 0 },
          fallbackRequestedCount: { type: "integer", minimum: 0 },
          fallbackObservedCount: { type: "integer", minimum: 0 },
          fallbackQualifiedCount: { type: "integer", minimum: 0 },
          oldestFetchedAt: {
            oneOf: [
              { type: "string", format: "date-time" },
              { type: "null" },
            ],
          },
          newestFetchedAt: {
            oneOf: [
              { type: "string", format: "date-time" },
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      ExploreMarketRead: {
        oneOf: [
          component("DexscreenerExploreMarketRead"),
          component("GmgnExploreMarketRead"),
        ],
      },
      GmgnMarketIdentity: {
        type: "object",
        description:
          "Canonical Programmable admission context for a GMGN token-level observation. poolId identifies the admitted launch context. A token_info response may attest it only when both provider locators carry this exact bytes32 value; a coherent 20-byte provider contract locator leaves pool attribution unavailable.",
        required: [
          "chainId",
          "protocol",
          "tokenAddress",
          "poolId",
          "quoteAddress",
        ],
        properties: {
          chainId: { const: "1" },
          protocol: { const: "uniswap_v4" },
          tokenAddress: component("EthereumAddress"),
          poolId: {
            ...component("Hex32"),
            description:
              "Canonical Programmable Uniswap v4 PoolId carried as admission context. See poolAttribution on the enclosing observation.",
          },
          quoteAddress: component("EthereumAddress"),
        },
        additionalProperties: false,
      },
      GmgnMarketSnapshot: {
        type: "object",
        description:
          "Short-lived GMGN token-level market observation attached only after exact Programmable Ethereum token, quote asset, Uniswap v4 exchange and canonical supply matching. Coherent nonzero 20-byte pool locators yield unavailable attribution. Coherent bytes32 locators yield exact attribution only when both equal the canonical request PoolId.",
        required: [
          "schemaVersion",
          "source",
          "marketScope",
          "poolAttribution",
          "currency",
          "fetchedAt",
          "identity",
          "priceUsdWad",
          "fdvUsdWad",
          "liquidityUsdWad",
          "volume24hUsdWad",
          "swapCount24h",
        ],
        properties: {
          schemaVersion: { const: "programmable.gmgn-market-snapshot.v1" },
          source: { const: "gmgn" },
          marketScope: { const: "token" },
          poolAttribution: {
            type: "string",
            enum: ["exact", "unavailable"],
          },
          currency: { const: "USD" },
          fetchedAt: { type: "string", format: "date-time" },
          identity: component("GmgnMarketIdentity"),
          priceUsdWad: { type: "string", pattern: "^[1-9][0-9]*$" },
          fdvUsdWad: { type: "string", pattern: "^[1-9][0-9]*$" },
          liquidityUsdWad: { type: "string", pattern: "^[1-9][0-9]*$" },
          volume24hUsdWad: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
          swapCount24h: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      ExploreMarketCapRanking: {
        type: "object",
        description:
          "GMGN-primary market-cap ordering over the canonical Ethereum catalog. Fresh, positive-market-cap global GMGN ranks form the first tier. Rank-unobserved entries first use bounded, canonical-supply-bound GMGN token_info FDV; only the still-unqualified or deferred remainder can use exact-identity Dexscreener FDV, followed by stable canonical launch order. Values are sorted only within their metric/provider tier and are never compared across tiers.",
        required: [
          "schemaVersion",
          "requested",
          "direction",
          "primaryProvider",
          "source",
          "fallbackProvider",
          "rankingCommitment",
          "status",
          "gmgnStatus",
          "applied",
          "metricOrder",
          "rankInterval",
          "rankLimit",
          "observedTokenCount",
          "matchedTokenCount",
          "matchedUniqueTokenCount",
          "canonicalEntryCount",
          "canonicalTokenCount",
          "unobservedCanonicalEntryCount",
          "canonicalAddressCoverageBps",
          "foreignTokenCount",
          "discardedProviderItemCount",
          "gmgnHydrationLimit",
          "gmgnHydrationEligibleCount",
          "gmgnHydrationRequestedCount",
          "gmgnHydrationObservedCount",
          "gmgnHydrationQualifiedCount",
          "gmgnHydrationDeferredCount",
          "fallbackRequestedCount",
          "fallbackQualifiedCount",
          "canonicalTailCount",
          "qualifiedCount",
          "totalCount",
          "asOfTime",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.explore-market-cap-ranking.v1",
          },
          requested: { const: "market-cap" },
          direction: { type: "string", enum: ["asc", "desc"] },
          primaryProvider: { const: "gmgn" },
          source: {
            type: "string",
            enum: [
              "gmgn",
              "gmgn+dexscreener",
              "dexscreener",
              "canonical-launch-order",
            ],
          },
          fallbackProvider: { const: "dexscreener" },
          rankingCommitment: {
            type: "string",
            pattern: "^sha256:[0-9a-f]{64}$",
          },
          status: {
            type: "string",
            enum: ["complete", "partial", "unavailable"],
            description:
              "Aggregate accepted ranking-signal coverage across GMGN and fallback.",
          },
          gmgnStatus: {
            type: "string",
            enum: ["complete", "partial", "unavailable"],
            description: "Coverage from GMGN alone.",
          },
          applied: {
            type: "string",
            enum: [
              "gmgn-market-cap",
              "gmgn-market-cap-then-gmgn-token-info-fdv",
              "gmgn-market-cap-then-gmgn-token-info-fdv-then-launch-order",
              "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv",
              "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order",
              "gmgn-market-cap-then-dexscreener-fdv",
              "gmgn-market-cap-then-dexscreener-fdv-then-launch-order",
              "gmgn-market-cap-then-launch-order",
              "gmgn-token-info-fdv",
              "gmgn-token-info-fdv-then-launch-order",
              "gmgn-token-info-fdv-then-dexscreener-fdv",
              "gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order",
              "fdv",
              "qualified-fdv-then-launch-order",
              "launch-order",
            ],
          },
          metricOrder: {
            const:
              "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order",
          },
          rankInterval: { const: "1h" },
          rankLimit: { const: 100 },
          observedTokenCount: { type: "integer", minimum: 0, maximum: 100 },
          matchedTokenCount: { type: "integer", minimum: 0 },
          matchedUniqueTokenCount: { type: "integer", minimum: 0 },
          canonicalEntryCount: { type: "integer", minimum: 0 },
          canonicalTokenCount: { type: "integer", minimum: 0 },
          unobservedCanonicalEntryCount: { type: "integer", minimum: 0 },
          canonicalAddressCoverageBps: {
            type: "integer",
            minimum: 0,
            maximum: 10_000,
          },
          foreignTokenCount: { type: "integer", minimum: 0, maximum: 100 },
          discardedProviderItemCount: {
            type: "integer",
            minimum: 0,
            maximum: 1_000,
          },
          gmgnHydrationLimit: { type: "integer", minimum: 0, maximum: 100 },
          gmgnHydrationEligibleCount: { type: "integer", minimum: 0 },
          gmgnHydrationRequestedCount: {
            type: "integer",
            minimum: 0,
            maximum: 100,
          },
          gmgnHydrationObservedCount: {
            type: "integer",
            minimum: 0,
            maximum: 100,
          },
          gmgnHydrationQualifiedCount: {
            type: "integer",
            minimum: 0,
            maximum: 100,
          },
          gmgnHydrationDeferredCount: { type: "integer", minimum: 0 },
          fallbackRequestedCount: { type: "integer", minimum: 0 },
          fallbackQualifiedCount: { type: "integer", minimum: 0 },
          canonicalTailCount: { type: "integer", minimum: 0 },
          qualifiedCount: { type: "integer", minimum: 0 },
          totalCount: { type: "integer", minimum: 0 },
          asOfTime: {
            description:
              "When the accepted GMGN global rank observed any qualified Ethereum token, this is exactly that rank snapshot time even if no token intersects the canonical catalog. Otherwise it is the latest accepted GMGN token_info or Dexscreener ordering time, or null when no provider ordering signal was accepted.",
            oneOf: [
              { type: "string", format: "date-time" },
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      ExploreSearchRanking: {
        type: "object",
        description:
          "Bounded GMGN coin-search relevance intersected with the canonical Ethereum Programmable catalog. Provider-matched canonical aliases may join local name, symbol, address or model matches. Foreign coins and wallet rows never enter the result, and omitted local matches remain in stable fallback order.",
        required: [
          "schemaVersion",
          "provider",
          "requested",
          "orderBy",
          "rankingCommitment",
          "status",
          "applied",
          "observedTokenCount",
          "matchedTokenCount",
          "matchedUniqueTokenCount",
          "canonicalMatchCount",
          "canonicalMatchTokenCount",
          "unobservedCanonicalMatchCount",
          "providerOnlyCanonicalTokenCount",
          "foreignTokenCount",
          "discardedProviderItemCount",
          "duplicateProviderItemCount",
          "canonicalAddressCoverageBps",
          "asOfTime",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.explore-search-ranking.v1",
          },
          provider: { const: "gmgn" },
          requested: { const: "search" },
          orderBy: { const: "weight" },
          rankingCommitment: {
            type: "string",
            pattern: "^sha256:[0-9a-f]{64}$",
          },
          status: {
            type: "string",
            enum: ["complete", "partial", "unavailable"],
          },
          applied: {
            type: "string",
            enum: [
              "gmgn-canonical-search-with-local-match-fallback",
              "local-match-order",
            ],
          },
          observedTokenCount: {
            type: "integer",
            minimum: 0,
            maximum: 1_000,
          },
          matchedTokenCount: { type: "integer", minimum: 0 },
          matchedUniqueTokenCount: { type: "integer", minimum: 0 },
          canonicalMatchCount: { type: "integer", minimum: 0 },
          canonicalMatchTokenCount: { type: "integer", minimum: 0 },
          unobservedCanonicalMatchCount: { type: "integer", minimum: 0 },
          providerOnlyCanonicalTokenCount: { type: "integer", minimum: 0 },
          foreignTokenCount: {
            type: "integer",
            minimum: 0,
            maximum: 1_000,
          },
          discardedProviderItemCount: {
            type: "integer",
            minimum: 0,
            maximum: 1_000,
          },
          duplicateProviderItemCount: {
            type: "integer",
            minimum: 0,
            maximum: 1_000,
          },
          canonicalAddressCoverageBps: {
            type: "integer",
            minimum: 0,
            maximum: 10_000,
          },
          asOfTime: {
            oneOf: [
              { type: "string", format: "date-time" },
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      ExploreDiscoveryRanking: {
        type: "object",
        description:
          "Bounded metadata for an optional GMGN ranking intersected with the already filtered canonical Programmable catalog. No raw GMGN ranking payload is exposed.",
        required: [
          "schemaVersion",
          "provider",
          "requested",
          "rankingCommitment",
          "status",
          "applied",
          "rankInterval",
          "hotSearchInterval",
          "snapshotCount",
          "observedTokenCount",
          "matchedTokenCount",
          "matchedUniqueTokenCount",
          "canonicalEntryCount",
          "canonicalTokenCount",
          "unobservedCanonicalEntryCount",
          "canonicalAddressCoverageBps",
          "foreignTokenCount",
          "discardedProviderItemCount",
          "asOfTime",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.explore-discovery-ranking.v1",
          },
          provider: { const: "gmgn" },
          requested: { const: "trending" },
          rankingCommitment: {
            type: "string",
            pattern: "^sha256:[0-9a-f]{64}$",
            description:
              "Commits to the ordered matched canonical ranking identity without exposing raw provider ranks. Observed freshness is reported separately by asOfTime and is not part of this commitment.",
          },
          status: {
            type: "string",
            enum: ["complete", "partial", "unavailable"],
          },
          applied: {
            type: "string",
            enum: [
              "gmgn-ranked-with-launch-order-fallback",
              "launch-order",
            ],
          },
          rankInterval: { const: "1h" },
          hotSearchInterval: { const: "24h" },
          snapshotCount: { type: "integer", minimum: 0, maximum: 2 },
          observedTokenCount: { type: "integer", minimum: 0, maximum: 200 },
          matchedTokenCount: { type: "integer", minimum: 0 },
          matchedUniqueTokenCount: { type: "integer", minimum: 0 },
          canonicalEntryCount: { type: "integer", minimum: 0 },
          canonicalTokenCount: { type: "integer", minimum: 0 },
          unobservedCanonicalEntryCount: { type: "integer", minimum: 0 },
          canonicalAddressCoverageBps: {
            type: "integer",
            minimum: 0,
            maximum: 10_000,
          },
          foreignTokenCount: { type: "integer", minimum: 0, maximum: 200 },
          discardedProviderItemCount: {
            type: "integer",
            minimum: 0,
            maximum: 2_000,
          },
          asOfTime: {
            oneOf: [
              { type: "string", format: "date-time" },
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      GmgnTokenSecurity: {
        type: "object",
        description:
          "Normalized token-level GMGN heuristics admitted for the exact canonical token. These fields are observations, not a safety guarantee or pool-level evidence.",
        required: [
          "schemaVersion",
          "source",
          "fetchedAt",
          "identity",
          "tokenAddress",
          "isShowAlert",
          "isOpenSource",
          "isBlacklisted",
          "isHoneypot",
          "isOwnerRenounced",
          "isMintRenounced",
          "isFreezeAccountRenounced",
          "isWashTrading",
          "top10HolderRatio",
          "developerTeamHoldRatio",
          "creatorBalanceRatio",
          "suspectedInsiderHoldRatio",
          "rugRatio",
          "ratTraderAmountRatio",
          "bundlerTraderAmountRatio",
          "buyTaxRatio",
          "sellTaxRatio",
          "averageTaxRatio",
          "highTaxRatio",
          "burnRatio",
          "developerTokenBurnAmount",
          "developerTokenBurnRatio",
          "burnStatus",
          "creatorTokenStatus",
          "sniperCount",
          "canSellCount",
          "cannotSellCount",
          "hideRisk",
          "flags",
          "lockSummary",
        ],
        properties: {
          schemaVersion: { const: "programmable.gmgn-token-security.v1" },
          source: { const: "gmgn" },
          fetchedAt: { type: "string", format: "date-time" },
          identity: component("GmgnMarketIdentity"),
          tokenAddress: component("EthereumAddress"),
          isShowAlert: { type: ["boolean", "null"] },
          isOpenSource: { type: ["boolean", "null"] },
          isBlacklisted: { type: ["boolean", "null"] },
          isHoneypot: { type: ["boolean", "null"] },
          isOwnerRenounced: { type: ["boolean", "null"] },
          isMintRenounced: { type: ["boolean", "null"] },
          isFreezeAccountRenounced: { type: ["boolean", "null"] },
          isWashTrading: { type: ["boolean", "null"] },
          top10HolderRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          developerTeamHoldRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          creatorBalanceRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          suspectedInsiderHoldRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          rugRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          ratTraderAmountRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          bundlerTraderAmountRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          buyTaxRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          sellTaxRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          averageTaxRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          highTaxRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          burnRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          developerTokenBurnAmount: {
            type: ["string", "null"],
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          developerTokenBurnRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          burnStatus: { type: ["string", "null"], maxLength: 128 },
          creatorTokenStatus: { type: ["string", "null"], maxLength: 128 },
          sniperCount: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          canSellCount: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          cannotSellCount: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          hideRisk: { type: ["boolean", "null"] },
          flags: {
            type: "array",
            items: { type: "string", maxLength: 128 },
            maxItems: 64,
          },
          lockSummary: {
            oneOf: [
              {
                type: "object",
                required: [
                  "isLocked",
                  "lockRatio",
                  "remainingLockRatio",
                  "details",
                ],
                properties: {
                  isLocked: { type: "boolean" },
                  lockRatio: {
                    type: "string",
                    pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
                    maxLength: 160,
                  },
                  remainingLockRatio: {
                    type: "string",
                    pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
                    maxLength: 160,
                  },
                  details: {
                    type: "array",
                    maxItems: 256,
                    items: {
                      type: "object",
                      required: ["ratio", "poolAddress", "isBlackhole"],
                      properties: {
                        ratio: {
                          type: "string",
                          pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
                          maxLength: 160,
                        },
                        poolAddress: component("EthereumAddress"),
                        isBlackhole: { type: "boolean" },
                      },
                      additionalProperties: false,
                    },
                  },
                },
                additionalProperties: false,
              },
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      GmgnTokenPoolInfo: {
        type: "object",
        description:
          "Normalized token-level Uniswap v4 pool_info observation from GMGN. Live v4 responses identify the queried token in address and base_address and do not expose the canonical bytes32 PoolId, so pool attribution remains unavailable.",
        required: [
          "schemaVersion",
          "source",
          "marketScope",
          "poolAttribution",
          "currency",
          "fetchedAt",
          "identity",
          "tokenAddress",
          "providerAddress",
          "baseAddress",
          "quoteAddress",
          "token0Address",
          "token1Address",
          "quoteSymbol",
          "exchange",
          "liquidityUsd",
          "baseReserve",
          "quoteReserve",
          "baseReserveValueUsd",
          "quoteReserveValueUsd",
          "initialLiquidityUsd",
          "initialBaseReserve",
          "initialQuoteReserve",
          "priceUsd",
          "feeRatio",
          "creationTimestamp",
        ],
        properties: {
          schemaVersion: { const: "programmable.gmgn-token-pool-info.v1" },
          source: { const: "gmgn" },
          marketScope: { const: "token" },
          poolAttribution: { const: "unavailable" },
          currency: { const: "USD" },
          fetchedAt: { type: "string", format: "date-time" },
          identity: component("GmgnMarketIdentity"),
          tokenAddress: component("EthereumAddress"),
          providerAddress: {
            ...component("EthereumAddress"),
            description:
              "Normalized GMGN pool_info address field; for accepted v4 responses it equals tokenAddress and baseAddress.",
          },
          baseAddress: component("EthereumAddress"),
          quoteAddress: component("EthereumAddress"),
          token0Address: {
            ...component("EthereumAddress"),
            description:
              "Address-sorted Uniswap v4 currency0, derived from the exact base and quote binding.",
          },
          token1Address: {
            ...component("EthereumAddress"),
            description:
              "Address-sorted Uniswap v4 currency1, derived from the exact base and quote binding.",
          },
          quoteSymbol: { type: ["string", "null"], maxLength: 64 },
          exchange: { const: "uniswap_v4" },
          liquidityUsd: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          baseReserve: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          quoteReserve: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          baseReserveValueUsd: {
            type: ["string", "null"],
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          quoteReserveValueUsd: {
            type: ["string", "null"],
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          initialLiquidityUsd: {
            type: ["string", "null"],
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          initialBaseReserve: {
            type: ["string", "null"],
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          initialQuoteReserve: {
            type: ["string", "null"],
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          priceUsd: {
            type: ["string", "null"],
            pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
            maxLength: 160,
          },
          feeRatio: {
            type: ["string", "null"],
            pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
            maxLength: 160,
          },
          creationTimestamp: {
            type: "integer",
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        },
        additionalProperties: false,
      },
      GmgnTokenWalletRanking: {
        type: "object",
        description:
          "Privacy-reduced token-address holder or trader ranking with at most 20 rows, admitted by the exact GMGN token_info proof. It is not a pool ranking. The public object excludes provider schema, source, query, token identity, names, avatars, social accounts, tags, transfers and transaction hashes. Wallet analytics are informational and never used for signing or settlement.",
        required: ["fetchedAt", "wallets"],
        properties: {
          fetchedAt: { type: "string", format: "date-time" },
          wallets: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              required: [
                "address",
                "usdValue",
                "amountRatio",
                "buyVolumeUsd",
                "sellVolumeUsd",
                "profitUsd",
                "profitRatio",
              ],
              properties: {
                address: component("EthereumAddress"),
                usdValue: { type: ["number", "null"] },
                amountRatio: { type: ["number", "null"] },
                buyVolumeUsd: { type: ["number", "null"] },
                sellVolumeUsd: { type: ["number", "null"] },
                profitUsd: { type: ["number", "null"] },
                profitRatio: { type: ["number", "null"] },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      TokenAnalyticsSummaryResponse: {
        type: "object",
        required: [
          "schemaVersion",
          "status",
          "provider",
          "analyticsScope",
          "poolAttribution",
          "section",
          "identity",
          "analytics",
        ],
        properties: {
          schemaVersion: { const: "programmable.token-analytics.v1" },
          status: {
            type: "string",
            enum: ["ready", "partial", "unavailable"],
          },
          provider: { const: "gmgn" },
          analyticsScope: { const: "token" },
          poolAttribution: { const: "unavailable" },
          section: { const: "summary" },
          identity: {
            oneOf: [component("GmgnMarketIdentity"), { type: "null" }],
          },
          analytics: {
            type: "object",
            required: ["security", "pool"],
            properties: {
              security: {
                oneOf: [component("GmgnTokenSecurity"), { type: "null" }],
              },
              pool: {
                oneOf: [component("GmgnTokenPoolInfo"), { type: "null" }],
              },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      TokenAnalyticsRankingResponse: {
        type: "object",
        required: [
          "schemaVersion",
          "status",
          "provider",
          "analyticsScope",
          "poolAttribution",
          "section",
          "identity",
          "analytics",
        ],
        properties: {
          schemaVersion: { const: "programmable.token-analytics.v1" },
          status: { type: "string", enum: ["ready", "unavailable"] },
          provider: { const: "gmgn" },
          analyticsScope: { const: "token" },
          poolAttribution: { const: "unavailable" },
          section: { type: "string", enum: ["holders", "traders"] },
          identity: {
            oneOf: [component("GmgnMarketIdentity"), { type: "null" }],
          },
          analytics: {
            type: "object",
            required: ["ranking"],
            properties: {
              ranking: {
                oneOf: [
                  component("GmgnTokenWalletRanking"),
                  { type: "null" },
                ],
              },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      TokenAnalyticsResponse: {
        oneOf: [
          component("TokenAnalyticsSummaryResponse"),
          component("TokenAnalyticsRankingResponse"),
        ],
      },
      MarketOhlc: {
        type: "object",
        required: ["open", "high", "low", "close"],
        properties: {
          open: { type: "string" },
          high: { type: "string" },
          low: { type: "string" },
          close: { type: "string" },
        },
        additionalProperties: false,
      },
      BitqueryMarketChartPoint: {
        type: "object",
        required: [
          "blockNumber",
          "time",
          "bucketStart",
          "bucketEnd",
          "observedAt",
          "valueSemantics",
          "tradeCount",
        ],
        properties: {
          blockNumber: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
          time: { type: "string", format: "date-time" },
          bucketStart: { type: "string", format: "date-time" },
          bucketEnd: { type: "string", format: "date-time" },
          observedAt: { type: "string", format: "date-time" },
          valueSemantics: { const: "period-median" },
          priceUsd: { type: "string" },
          priceQuote: { type: "string" },
          quoteSymbol: { type: "string" },
          ohlcUsd: component("MarketOhlc"),
          ohlcQuote: component("MarketOhlc"),
          volumeUsdWad: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)$",
          },
          tradeCount: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      BitqueryMarketChart: {
        type: "object",
        description:
          "Exact canonical Uniswap v4 pool history. The response headers report pool scope and exact pool attribution.",
        required: [
          "schemaVersion",
          "source",
          "readStatus",
          "status",
          "generatedAt",
          "identity",
          "range",
          "points",
          "swapCount",
          "valuation",
          "truncated",
        ],
        properties: {
          schemaVersion: { const: "programmable.market-chart.v1" },
          source: { const: "bitquery" },
          readStatus: { type: "string", enum: ["live", "cache-fallback"] },
          status: {
            type: "string",
            enum: [
              "ready",
              "insufficient-history",
              "partial",
              "waiting-for-first-trade",
              "unavailable",
            ],
          },
          generatedAt: { type: "string", format: "date-time" },
          identity: component("GmgnMarketIdentity"),
          range: { type: "string", enum: ["1h", "1d", "1w", "all"] },
          points: {
            type: "array",
            maxItems: 512,
            items: component("BitqueryMarketChartPoint"),
          },
          swapCount: { type: "integer", minimum: 0 },
          volumeUsdWad: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)$",
          },
          valuation: {
            type: "object",
            required: ["status", "reason"],
            properties: {
              status: { const: "unavailable" },
              reason: { type: "string" },
            },
            additionalProperties: false,
          },
          asOfTime: { type: "string", format: "date-time" },
          truncated: { type: "boolean" },
        },
        additionalProperties: false,
      },
      GmgnMarketChartPoint: {
        type: "object",
        required: [
          "time",
          "bucketStart",
          "bucketEnd",
          "valueSemantics",
          "priceUsd",
          "ohlcUsd",
          "volumeUsdWad",
        ],
        properties: {
          time: { type: "string", format: "date-time" },
          bucketStart: { type: "string", format: "date-time" },
          bucketEnd: { type: "string", format: "date-time" },
          valueSemantics: { const: "period-close" },
          priceUsd: { type: "string" },
          ohlcUsd: component("MarketOhlc"),
          volumeUsdWad: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)$",
          },
        },
        additionalProperties: false,
      },
      GmgnChartIdentityProof: {
        type: "object",
        description:
          "Current token_info admission proof for the token, quote, v4 exchange and supply. Every provider base or token-pair field that is present must match the canonical token and quote. poolAttribution is exact only when both provider locators equal the canonical bytes32 PoolId; coherent 20-byte provider contract locators leave it unavailable. This is current admission context, not per-candle provenance.",
        required: [
          "schemaVersion",
          "source",
          "verifiedAt",
          "identity",
          "poolAttribution",
          "canonicalSupply",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.gmgn-chart-identity-proof.v1",
          },
          source: { const: "gmgn-token-info" },
          verifiedAt: { type: "string", format: "date-time" },
          identity: component("GmgnMarketIdentity"),
          poolAttribution: {
            type: "string",
            enum: ["exact", "unavailable"],
          },
          canonicalSupply: {
            type: "object",
            required: ["totalSupplyRaw", "tokenDecimals"],
            properties: {
              totalSupplyRaw: component("CanonicalUint256"),
              tokenDecimals: { type: "integer", minimum: 0, maximum: 255 },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      GmgnMarketChart: {
        type: "object",
        description:
          "GMGN token_kline period-close OHLCV scoped to the token address. poolAttribution reports the current token_info admission locator: exact for a canonical bytes32 PoolId match, unavailable for a coherent 20-byte provider contract locator. It is not per-candle historical provenance.",
        required: [
          "schemaVersion",
          "source",
          "seriesScope",
          "poolAttribution",
          "readStatus",
          "status",
          "generatedAt",
          "identity",
          "identityProof",
          "range",
          "resolution",
          "requestedFrom",
          "requestedTo",
          "points",
          "candleCount",
          "volumeUsdWad",
          "asOfTime",
          "truncated",
        ],
        properties: {
          schemaVersion: { const: "programmable.gmgn-market-chart.v1" },
          source: { const: "gmgn" },
          seriesScope: { const: "token" },
          poolAttribution: {
            type: "string",
            enum: ["exact", "unavailable"],
          },
          readStatus: { const: "live" },
          status: {
            type: "string",
            enum: ["ready", "insufficient-history", "partial"],
          },
          generatedAt: { type: "string", format: "date-time" },
          identity: component("GmgnMarketIdentity"),
          identityProof: component("GmgnChartIdentityProof"),
          range: { type: "string", enum: ["1h", "1d", "1w", "all"] },
          resolution: {
            type: "string",
            enum: ["30s", "1m", "5m", "15m", "1h", "4h", "1d"],
          },
          requestedFrom: { type: "string", format: "date-time" },
          requestedTo: { type: "string", format: "date-time" },
          points: {
            type: "array",
            minItems: 1,
            maxItems: 512,
            items: component("GmgnMarketChartPoint"),
          },
          candleCount: { type: "integer", minimum: 1, maximum: 512 },
          volumeUsdWad: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)$",
          },
          asOfTime: { type: "string", format: "date-time" },
          truncated: { type: "boolean" },
        },
        additionalProperties: false,
      },
      MarketChartError: {
        type: "object",
        description:
          "Provider-neutral chart error emitted before a chart provider can be selected. The current API emits v2; application parsers may continue accepting legacy programmable.market-chart-error.v1 payloads captured from earlier releases.",
        required: [
          "schemaVersion",
          "source",
          "status",
          "generatedAt",
          "address",
          "range",
          "reason",
          "error",
        ],
        properties: {
          schemaVersion: { const: "programmable.market-chart-error.v2" },
          source: { const: "programmable" },
          status: { const: "unavailable" },
          generatedAt: { type: "string", format: "date-time" },
          address: component("EthereumAddress"),
          range: { type: "string", enum: ["1h", "1d", "1w", "all"] },
          reason: {
            type: "string",
            enum: ["identity-unavailable", "market-data-unavailable"],
          },
          error: { type: "string" },
        },
        additionalProperties: false,
      },
      TokenChartResponse: {
        oneOf: [
          component("GmgnMarketChart"),
          component("BitqueryMarketChart"),
          component("MarketChartError"),
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
          gmgnMarketData: component("GmgnMarketSnapshot"),
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
      RobinhoodFinalizedCatalogBoundary: {
        type: "object",
        description:
          "Finalized Robinhood Custom launch identities admitted from the Programmable V4 backend and reverified against the canonical launch-stamp Router before publication.",
        required: [
          "source",
          "launchSource",
          "status",
          "lastIndexedAt",
          "identityCount",
        ],
        properties: {
          source: { const: "robinhood-finalized-custom-launch-feed-v4" },
          launchSource: {
            const:
              "robinhood-finalized-custom-launch-feed-v4+canonical-launch-stamp-router",
          },
          status: { const: "current" },
          lastIndexedAt: { type: "string", format: "date-time" },
          asOfBlock: { type: "string", pattern: "^[1-9][0-9]*$" },
          asOfBlockHash: component("Hex32"),
          identityCount: { type: "integer", minimum: 1 },
          identityCommitment: component("Sha256Digest"),
        },
        additionalProperties: true,
      },
      ExploreListResponse: {
        oneOf: [
          component("ExploreReadyListResponse"),
          component("RobinhoodExploreReadyListResponse"),
          component("ExplorePlannedListResponse"),
        ],
      },
      ExploreReadyListResponse: {
        type: "object",
        required: [
          "status",
          "chainId",
          "tokens",
          "page",
          "pageSize",
          "total",
          "totalPages",
          "sort",
          "query",
          "catalog",
          "marketRead",
        ],
        properties: {
          status: { const: "ready" },
          chainId: { const: 1 },
          tokens: { type: "array", items: component("ExploreEntry") },
          page: { type: "integer", minimum: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 100 },
          total: { type: "integer", minimum: 0 },
          totalPages: { type: "integer", minimum: 0 },
          sort: {
            type: "string",
            enum: [
              "newest",
              "oldest",
              "trending",
              "market-cap",
              "market-cap-asc",
            ],
          },
          query: { type: "string" },
          sortMetric: {
            type: "string",
            enum: [
              "fdv",
              "gmgn-trending",
              "gmgn-market-cap+gmgn-token-info-fdv+dexscreener-fdv-fallback",
            ],
          },
          catalog: component("CatalogBoundary"),
          dataQuality: { type: "object", additionalProperties: true },
          marketRead: component("ExploreMarketRead"),
          ranking: component("ExploreMarketCapRanking"),
          discovery: component("ExploreDiscoveryRanking"),
          search: component("ExploreSearchRanking"),
        },
        additionalProperties: true,
      },
      RobinhoodExploreReadyListResponse: {
        type: "object",
        description:
          "Newest-first Robinhood Custom launches from the finalized Programmable backend feed after direct Router, L2 inclusion and Ethereum-finality verification. Market enrichment is unavailable and marketRead is omitted (or null).",
        required: [
          "status",
          "chainId",
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
          chainId: { const: 4663 },
          tokens: { type: "array", items: component("ExploreEntry") },
          page: { type: "integer", minimum: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 100 },
          total: { type: "integer", minimum: 0 },
          totalPages: { type: "integer", minimum: 0 },
          sort: { const: "newest" },
          query: { type: "string" },
          catalog: component("RobinhoodFinalizedCatalogBoundary"),
          marketRead: {
            type: "null",
            description:
              "Robinhood Explore currently performs no market-data provider read.",
          },
        },
        additionalProperties: false,
      },
      ExplorePlannedListResponse: {
        type: "object",
        required: [
          "status",
          "activationStage",
          "chainId",
          "tokens",
          "page",
          "pageSize",
          "total",
          "totalPages",
          "sort",
          "query",
        ],
        properties: {
          status: { const: "not-deployed" },
          activationStage: { const: "planned-not-deployed" },
          chainId: { const: 4663 },
          tokens: {
            type: "array",
            items: component("ExploreEntry"),
            maxItems: 0,
          },
          page: { const: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 100 },
          total: { const: 0 },
          totalPages: { const: 0 },
          sort: { const: "newest" },
          query: { type: "string" },
        },
        additionalProperties: false,
      },
      TokenDetailResponse: {
        oneOf: [
          component("TokenDetailReadyResponse"),
          component("RobinhoodTokenDetailReadyResponse"),
          component("TokenDetailPlannedResponse"),
        ],
      },
      TokenDetailLookupReadyResponse: {
        oneOf: [
          component("TokenDetailReadyResponse"),
          component("RobinhoodTokenDetailReadyResponse"),
        ],
      },
      TokenDetailReadyResponse: {
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
      RobinhoodTokenDetailReadyResponse: {
        type: "object",
        description:
          "A Robinhood token lookup completed against the finalized Programmable feed and direct chain verification boundary. token is null only for a verified 404.",
        required: ["status", "token", "customProject", "creatorArticle", "catalog"],
        properties: {
          status: { const: "ready" },
          token: {
            oneOf: [component("ExploreEntry"), { type: "null" }],
          },
          customProject: { type: "null" },
          routerTradeProject: { type: "null" },
          platformFeeCertification: { type: "null" },
          sourceVerification: {
            type: ["object", "null"],
            additionalProperties: true,
          },
          creatorArticle: { type: "null" },
          snapshot: { type: ["object", "null"], additionalProperties: true },
          catalog: component("RobinhoodFinalizedCatalogBoundary"),
        },
        additionalProperties: true,
      },
      TokenDetailPlannedResponse: {
        type: "object",
        required: [
          "status",
          "activationStage",
          "chainId",
          "token",
          "customProject",
          "routerTradeProject",
          "platformFeeCertification",
          "sourceVerification",
          "creatorArticle",
          "snapshot",
        ],
        properties: {
          status: { const: "not-deployed" },
          activationStage: { const: "planned-not-deployed" },
          chainId: { const: 4663 },
          token: { type: "null" },
          customProject: { type: "null" },
          routerTradeProject: { type: "null" },
          platformFeeCertification: { type: "null" },
          sourceVerification: { type: "null" },
          creatorArticle: { type: "null" },
          snapshot: { type: "null" },
        },
        additionalProperties: false,
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
  "x-programmable-availability": {
    v1Reads: "live",
    v1Create: {
      status: "read-only",
      httpStatus: 409,
      errorCode: "CUSTOM_LAUNCH_V1_READ_ONLY",
      retryable: false,
    },
    v2ReleaseCandidate: {
      status: "retired-to-read-compatibility",
      release: "2.0.0",
      publicAuthorization: false,
      openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v2.json`,
    },
    v2: {
      reads: "live",
      create: "read-only",
      createHttpStatus: 409,
      createErrorCode: "CUSTOM_LAUNCH_V2_READ_ONLY",
      retryable: false,
      preparedAndSimulatingReads: "observation-only",
      readMayAuthorize: false,
      authorizedAndSubmittedReconciliation: "bounded",
      openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v2.json`,
    },
    v3: {
      status: "live",
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 3,
      profileVersion: "3.3.0",
      freshWritesOnly: true,
      compatibleProfileVersions: ["3.2.0", "3.1.0", "3.0.0", "2.0.0"],
      productionLaunchAuthorized: true,
      createHttpStatus: 202,
      replayHttpStatus: 200,
      retryAfter: "honor-on-429-or-503",
      openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v3.json`,
      openApiDocumentStatus: "preparatory-not-live",
      activationAuthority: `${SITE_ORIGIN}/.well-known/programmable.json`,
      pendingProfile: {
        profileVersion: "3.4.0",
        cliVersion: "3.3.9",
        released: false,
        installable: false,
        acceptedForFreshWrites: false,
        activationRequires: "backend-and-well-known",
      },
    },
    v4: {
      status: "release-candidate",
      runtimeStatus: "routes-deployed",
      activationStage: "pending-public-discovery-promotion",
      targetLaunchPath: "public-self-serve",
      apiVersion: "4",
      profileVersion: "4.0.0",
      cliVersion: "4.0.0",
      sourceCandidate: true,
      released: false,
      installable: false,
      releaseReady: false,
      publicAuthorization: false,
      publicWrites: false,
      chainId: 4663,
      caip2: "eip155:4663",
      openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v4.json`,
      packConfigSchemaUrl:
        `${SITE_ORIGIN}/schemas/custom-launch/v4/pack-config.json`,
      sourceVerificationSchemaUrl:
        `${SITE_ORIGIN}/schemas/custom-launch/v4/source-verification-status.json`,
      capabilitiesPath: "/v4/chains/4663/capabilities",
      readinessPath: "/v4/chains/4663/readiness",
      finalizedMetadataPath: "/v4/chains/4663/finalized-custom-launches",
      statusPath: "/v4/chains/4663/custom-launches/{launchId}",
      terminalIndexerGuideUrl:
        `${SITE_ORIGIN}/developer-reference/robinhood-terminal-indexer`,
      terminalIndexerFixtureUrl:
        `${SITE_ORIGIN}/fixtures/robinhood-terminal-indexer-v1.json`,
      launchStampRouterAbiUrl:
        `${SITE_ORIGIN}/contracts/robinhood/ProgrammableLaunchStampRouterV1.abi.json`,
      launchStampRouterAbiSha256:
        "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
      launchStampRouterProfileNormalizedAbiSha256:
        "sha256:ab25262ce1cb907eba1cb820492754c0cd5d7278eb5fd6a024ba24c767323ac0",
      launchStampRouterProfileNormalizedAbiHashing: "jq -cS plus trailing LF",
      statusCommand:
        "programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until finalized",
      statuses: [
        "received",
        "validating",
        "action_required",
        "authorized",
        "awaiting_wallet_signature",
        "wallet_action_required",
        "submitted",
        "sequencer_soft_confirmed",
        "ethereum_posted",
        "finalized",
        "failed",
      ],
      actionRequiredMeaning: "server-authored-remediation-not-wallet-action",
      cliWalletAuthority: false,
      platformFeePolicyStatus: "required-default-configuration",
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
      platformFeePolicy: {
        required: true,
        status: "required-default-configuration",
        appliesTo: "new-robinhood-v4-api-custom-launches-only",
        changesExistingLaunches: false,
        changesEthereumLaunches: false,
        rateBps: 20,
        ratePpm: 2_000,
        ratePercent: "0.20%",
        recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
        basis: null,
        feeCurrency: null,
        accountingMode: null,
        rounding: null,
        accrual: null,
        claimMechanism: null,
        enforcement: "not-guaranteed-onchain",
        canonicalOnchainEnforcementProven: false,
        guaranteedRevenue: false,
        feeBehaviorClaim: false,
        universalFeeBehaviorClaim: false,
      },
      genericFeeClaiming: "not-live",
      externalIndexingGuaranteed: false,
      releaseBlockers: [
        "public-cli-release",
        "generated-release-evidence",
        "clean-room-end-to-end-proof",
        "public-indexing-canary",
      ],
      sourceVerificationStartsAfter: "finalized",
      sourceVerificationIndependentFromFinality: true,
      indexingTradingAndPublicationIndependent: true,
    },
    legacyIntake: { registry: "closed", github: "closed" },
  },
  "x-programmable-boundary": {
    identity:
      "Verified Classic V3, Registry-verified Custom, finalized Router-stamped Custom provenance, and the sole official Classic V2 main-token exception.",
    excluded:
      "All other Classic V1/V2, every Stock family, and Custom launches without a verified Registry record or finalized Router stamp.",
    marketData:
      "Optional enrichment never determines whether a verified identity is present.",
    router:
      "Finalized Router evidence becomes provenance-only Custom discovery after 64 confirmations. It is not approval, an audit, or a safety claim, and third-party listing remains consumer-controlled.",
    market:
      "Router verification requires pool initialization and fixed runtime and pool bindings, not active liquidity or tradability; the Custom graph owns liquidity behavior.",
    actions:
      "Fresh Ethereum V3.3 creation and lifecycle reads preserve exact idempotent request bytes, bounded best-effort reconciliation of pending history rows and precise single-resource polling. Robinhood V4 Router and backend are deployed and ready and target public self-serve, while this static release candidate awaits public discovery promotion; live discovery is the activation authority. The required 20 bps default configuration is not a canonical onchain fee-enforcement, charged-fee or revenue claim, and missing onchain fee enforcement is not itself a write blocker. V2 and V1 history remain readable and both legacy creation routes remain write-fenced. CLI, client and model output is preparation only; the API server independently enforces objective static hard blocks and exact Router simulation. Missing behavior execution leaves routability, liquidity and fee claims unverified, while an authenticated executed hard-invariant failure blocks wallet handoff. Exact-source provider verification starts after finality, runs independently and never revises launch finality. API keys never sign, broadcast, trade, claim fees, manage buybacks, or write profiles. The CLI also never signs or broadcasts.",
  },
  "x-programmable-wallet-authorization-gate": {
    decisionAuthority: "api-server",
    clientChecks: "preparation-only",
    localOrModelApprovalAccepted: false,
    requiredForProfileVersion: "3.4.0",
    walletHandoffRequiresVerifiedEvidence: false,
    mandatoryServerGates: ["static-hard-block-policy", "exact-router-simulation"],
    configurationIsExecutionEvidence: false,
    requiredPlatformFeeConformanceStatus: "verified",
    nonFeeVectorsMayRemainUnverified: true,
    evidenceAuthority: "platform-runtime-executor",
    signedExecutionReceiptRequired: true,
    notConfiguredDisposition: "claims_remain_unverified",
    unavailableDisposition: "claims_remain_unverified",
    executedFeeFailureDisposition: "blocks_wallet_handoff",
    executedHardInvariantFailureDisposition: "blocks_wallet_handoff",
    feeBehaviorClaim: false,
    tenBpsClaimRequiresExactPerLaunchVerifiedFeePathEvidence: true,
    claimScope: "exact-launch-and-stamped-poolkey-only",
  },
  "x-programmable-api-scopes": {
    "custom-launch:create": {
      state:
        "v1-v2-write-fenced-v3.3-live-v4-pending-public-discovery-promotion",
      description:
        "Fresh public writes use Ethereum V3.3. Robinhood V4 targets public self-serve after its non-fee release predicates are deployed; require live discovery fields before create. Its 20 bps recipient configuration is required policy but not guaranteed canonical onchain enforcement. V2 and V1 POST remain non-retryable write fences with CUSTOM_LAUNCH_V2_READ_ONLY and CUSTOM_LAUNCH_V1_READ_ONLY.",
    },
    "custom-launch:read": {
      state: "grantable",
      description: "Read Custom launches owned by the key's wallet principal.",
    },
    "fees:claim": {
      state: "reserved-disabled",
      description:
        "Not grantable or callable for arbitrary Custom hooks. FADE uses a separately bound adapter.",
    },
    "buybacks:manage": {
      state: "reserved-disabled",
      description:
        "Not grantable or callable for arbitrary Custom hooks. FADE uses a separately bound adapter.",
    },
    evolution:
      "New scopes and endpoints are additive. Existing keys never inherit a scope activated later.",
  },
} as const;
