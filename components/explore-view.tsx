"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  previewTokens,
  type LauncherToken,
} from "@/lib/tokens";

type TokenRow = {
  id: string;
  name: string;
  symbol: string;
  launchType: string;
  liquidity: string;
  behavior: string;
  tone: string;
  categories: string[];
};

function getTokenRows(tokens: LauncherToken[]): TokenRow[] {
  if (tokens.length === 0) {
    return [...previewTokens];
  }

  return tokens.map((token, index) => ({
    id: token.id,
    name: token.name,
    symbol: token.symbol,
    launchType: token.liquidityPath === "auction" ? "Auction" : "Direct",
    liquidity:
      token.liquidityPath === "auction"
        ? "Auction funded"
        : "Creator supplied",
    behavior: token.behavior,
    tone: ["rose", "violet", "mint", "amber"][index % 4],
    categories: [token.liquidityPath],
  }));
}

const tokenFilters = [
  { id: "all", label: "All" },
  { id: "auction", label: "Auction" },
  { id: "direct", label: "Direct liquidity" },
  { id: "fees", label: "Fees" },
  { id: "access", label: "Access" },
  { id: "custom", label: "Custom" },
] as const;

export function ExploreView({ tokens }: { tokens: LauncherToken[] }) {
  const rows = getTokenRows(tokens);
  const showingPreview = tokens.length === 0;
  const [activeFilter, setActiveFilter] = useState("all");
  const [query, setQuery] = useState("");
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter((token) => {
      const matchesFilter =
        activeFilter === "all" || token.categories.includes(activeFilter);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        token.name.toLowerCase().includes(normalizedQuery) ||
        token.symbol.toLowerCase().includes(normalizedQuery) ||
        token.behavior.toLowerCase().includes(normalizedQuery);

      return matchesFilter && matchesQuery;
    });
  }, [activeFilter, query, rows]);

  return (
    <div className="explore-page page-width">
      <section className="explore-intro">
        <div>
          <p className="eyebrow">Built on Uniswap v4</p>
          <h1>Tokens with their own rules</h1>
          <p>
            Create the token, choose how liquidity starts and define how its
            pool behaves
          </p>
        </div>
        <Link className="primary-button" href="/launch">
          Launch a token
          <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </section>

      <section className="token-section" id="tokens">
        <div className="token-section-heading">
          <div>
            <h2>Explore tokens</h2>
            <p>Only tokens launched through Launcher appear here</p>
          </div>
          <label className="token-search">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">Search tokens</span>
            <input
              value={query}
              placeholder="Search tokens"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div
          className="token-filters"
          role="tablist"
          aria-label="Filter tokens"
        >
          {tokenFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              className={activeFilter === filter.id ? "active" : undefined}
              aria-selected={activeFilter === filter.id}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="token-table">
          <div className="token-table-head" aria-hidden="true">
            <span>Token</span>
            <span>Launch</span>
            <span>Liquidity</span>
            <span>Pool behavior</span>
          </div>
          {visibleRows.map((token) => (
            <article className="token-row" key={token.id}>
              <div className="token-identity">
                <span
                  className={`token-monogram token-tone-${token.tone}`}
                  aria-hidden="true"
                >
                  {token.symbol.slice(0, 2)}
                </span>
                <div>
                  <h3>{token.name}</h3>
                  <p>{token.symbol}</p>
                </div>
              </div>
              <p className="token-launch">{token.launchType}</p>
              <p className="token-liquidity">{token.liquidity}</p>
              <p className="token-behavior">{token.behavior}</p>
            </article>
          ))}
          {visibleRows.length === 0 ? (
            <div className="token-empty">
              <p>No tokens match this filter</p>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setActiveFilter("all");
                  setQuery("");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>

        {showingPreview ? (
          <p className="preview-disclosure">
            Illustrative configurations are shown until the first verified
            launch is indexed
          </p>
        ) : null}
      </section>
    </div>
  );
}
