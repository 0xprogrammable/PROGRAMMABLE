import "server-only";

import { isAddress } from "viem";

import { parseCreatorArticleDraftV1 } from "../../creator-article/contract-v1";
import {
  CreatorArticleAuthorityErrorV1,
  createProductionCreatorArticleAuthorityReaderV1,
  listCreatorArticleAuthoritiesV1,
  requireCreatorArticleAuthorityV1,
  type CreatorArticleAuthorityReaderV1,
} from "./authority.server";
import {
  CreatorArticleRevisionConflictV1,
  createProductionCreatorArticleStoreV1,
  type CreatorArticleStoreV1,
} from "./storage.server";
import {
  createPrivyWalletPrincipalAuthenticatorV1,
  WalletPrincipalAuthenticationErrorV1,
  type WalletPrincipalAuthenticatorV1,
} from "./wallet-principal.server";

const MAXIMUM_DRAFT_BYTES = 192_000;
const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  Vary: "Authorization, X-Privy-Identity-Token",
};

export interface CreatorArticleApiHandlersV1 {
  listProjects(request: Request): Promise<Response>;
  article(request: Request, tokenAddress: string): Promise<Response>;
}

export function createCreatorArticleApiHandlersV1(input: Readonly<{
  authenticator: WalletPrincipalAuthenticatorV1;
  authorityReader: CreatorArticleAuthorityReaderV1;
  store: CreatorArticleStoreV1;
}>): CreatorArticleApiHandlersV1 {
  return Object.freeze({
    async listProjects(request: Request) {
      if (request.method !== "GET") return errorResponse(405, "method_not_allowed", "GET");
      if (request.headers.get("accept")?.toLowerCase() !== "application/json") {
        return errorResponse(406, "json_response_required");
      }
      try {
        const principal = await input.authenticator.authenticate(request);
        const projects = await listCreatorArticleAuthoritiesV1({
          reader: input.authorityReader,
          principal,
          signal: request.signal,
        });
        const rows = await Promise.all(projects.map(async (project) => {
          let article = null;
          try {
            article = await input.store.readCurrent(project);
          } catch {
            article = null;
          }
          return Object.freeze({
            chainId: project.chainId,
            tokenAddress: project.tokenAddress,
            name: project.name,
            symbol: project.symbol,
            imageUrl: project.imageUrl,
            source: project.source,
            article: article === null
              ? null
              : Object.freeze({
                  revision: article.article.revision,
                  title: article.article.title,
                  updatedAt: article.article.updatedAt,
                }),
          });
        }));
        return jsonResponse(200, {
          schemaVersion: "programmable.creator-project-list.v1",
          projects: rows,
        });
      } catch (error) {
        return mappedError(error);
      }
    },
    async article(request: Request, tokenAddress: string) {
      if (!isAddress(tokenAddress)) return errorResponse(400, "invalid_token");
      if (request.method !== "GET" && request.method !== "PUT") {
        return errorResponse(405, "method_not_allowed", "GET, PUT");
      }
      try {
        const principal = await input.authenticator.authenticate(request);
        const authority = await requireCreatorArticleAuthorityV1({
          reader: input.authorityReader,
          principal,
          tokenAddress,
          signal: request.signal,
        });
        if (request.method === "GET") {
          if (request.headers.get("accept")?.toLowerCase() !== "application/json") {
            return errorResponse(406, "json_response_required");
          }
          const current = await input.store.readCurrent(authority);
          return jsonResponse(200, {
            schemaVersion: "programmable.creator-article-edit.v1",
            article: current?.article ?? null,
          }, undefined, current?.etag);
        }
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
          return errorResponse(415, "json_body_required");
        }
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > MAXIMUM_DRAFT_BYTES) {
          return errorResponse(413, "article_too_large");
        }
        const ifMatch = request.headers.get("if-match");
        const ifNoneMatch = request.headers.get("if-none-match");
        if ((ifMatch === null) === (ifNoneMatch !== "*")) {
          return errorResponse(428, "article_precondition_required");
        }
        const bodyText = await request.text();
        if (!bodyText || Buffer.byteLength(bodyText, "utf8") > MAXIMUM_DRAFT_BYTES) {
          return errorResponse(413, "article_too_large");
        }
        let draft;
        try {
          draft = parseCreatorArticleDraftV1(JSON.parse(bodyText) as unknown);
        } catch {
          return errorResponse(400, "invalid_article");
        }
        if (draft.tokenAddress.toLowerCase() !== authority.tokenAddress.toLowerCase()) {
          return errorResponse(400, "article_identity_mismatch");
        }
        const published = await input.store.publish({
          draft,
          creatorAddress: authority.creatorAddress,
          expectedEtag: ifMatch,
        });
        return jsonResponse(200, {
          schemaVersion: "programmable.creator-article-edit.v1",
          article: published.article,
        }, undefined, published.etag);
      } catch (error) {
        return mappedError(error);
      }
    },
  });
}

let productionHandlers: CreatorArticleApiHandlersV1 | null = null;

export function getProductionCreatorArticleApiHandlersV1() {
  productionHandlers ??= createCreatorArticleApiHandlersV1({
    authenticator: createPrivyWalletPrincipalAuthenticatorV1(),
    authorityReader: createProductionCreatorArticleAuthorityReaderV1(),
    store: createProductionCreatorArticleStoreV1(),
  });
  return productionHandlers;
}

function mappedError(error: unknown): Response {
  if (error instanceof WalletPrincipalAuthenticationErrorV1) {
    return errorResponse(error.status, error.code);
  }
  if (error instanceof CreatorArticleAuthorityErrorV1) {
    return errorResponse(error.status, error.code);
  }
  if (error instanceof CreatorArticleRevisionConflictV1) {
    return errorResponse(412, "article_revision_conflict");
  }
  console.error("Creator article request failed", {
    name: error instanceof Error ? error.name : "CreatorArticleError",
  });
  return errorResponse(503, "creator_article_unavailable");
}

function jsonResponse(
  status: number,
  body: Readonly<Record<string, unknown>>,
  allow?: string,
  etag?: string,
) {
  const responseHeaders = new Headers(headers);
  if (allow) responseHeaders.set("Allow", allow);
  if (etag) responseHeaders.set("ETag", etag);
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function errorResponse(status: number, code: string, allow?: string) {
  return jsonResponse(status, {
    schemaVersion: "programmable.creator-article-error.v1",
    code,
  }, allow);
}
