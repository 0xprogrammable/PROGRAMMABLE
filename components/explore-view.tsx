import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import {
  sampleTokens,
  type LauncherToken,
} from "@/lib/tokens";

type TokenRow = {
  id: string;
  name: string;
  symbol: string;
  price: string;
  change: string;
  behavior: string;
  tone: string;
};

function getTokenRows(tokens: LauncherToken[]): TokenRow[] {
  if (tokens.length === 0) {
    return [...sampleTokens];
  }

  return tokens.map((token, index) => ({
    id: token.id,
    name: token.name,
    symbol: token.symbol,
    price: "—",
    change: "—",
    behavior: token.behavior,
    tone: ["rose", "violet", "mint", "amber"][index % 4],
  }));
}

export function ExploreView({ tokens }: { tokens: LauncherToken[] }) {
  const rows = getTokenRows(tokens);
  const showingSamples = tokens.length === 0;

  return (
    <div className="explore-page page-width">
      <section className="explore-hero">
        <div className="hero-copy">
          <h1>Launch a token with its own rules</h1>
          <p className="hero-lede">
            Choose how liquidity starts, add Uniswap v4 behavior and bring the
            token live through one clear flow
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/launch">
              Launch a token
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <a className="text-link" href="#tokens">
              Explore tokens
            </a>
          </div>
        </div>
        <div className="hero-token-mark" aria-hidden="true">
          <span>P</span>
          <span>A</span>
          <span>B</span>
          <span>R</span>
        </div>
      </section>

      <section className="token-section" id="tokens">
        <div className="token-section-heading">
          <div>
            <p className="eyebrow">Explore</p>
            <h2>Tokens</h2>
          </div>
          {showingSamples ? (
            <span className="sample-data-label">
              <Sparkles aria-hidden="true" size={13} />
              Sample data
            </span>
          ) : null}
        </div>

        <div className="token-table">
          <div className="token-table-head" aria-hidden="true">
            <span>Token</span>
            <span>Price</span>
            <span>24h</span>
            <span>Behavior</span>
          </div>
          {rows.map((token) => (
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
              <p className="token-price">{token.price}</p>
              <p className="token-change">{token.change}</p>
              <p className="token-behavior">{token.behavior}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
