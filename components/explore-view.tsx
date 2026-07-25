import Link from "next/link";
import { ArrowRight, Layers3, Search } from "lucide-react";
import type { LauncherMarket } from "@/lib/markets";

export function ExploreView({ markets }: { markets: LauncherMarket[] }) {
  return (
    <>
      <section className="explore-hero page-width">
        <div className="hero-copy">
          <p className="eyebrow">Markets on Uniswap v4</p>
          <h1>Build the token and the market together</h1>
          <p className="hero-lede">
            Choose the asset, how liquidity starts, and what the market can do
            in one clear flow
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/launch">
              Create a market
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <a className="text-link" href="#markets">
              Browse markets
            </a>
          </div>
        </div>

        <div className="launch-sentence" aria-label="Launch configuration">
          <div className="sentence-heading">
            <span>Launch configuration</span>
          </div>
          <div className="sentence-lines">
            <p>
              <span>Asset</span>
              Fixed-supply ERC-20
            </p>
            <p>
              <span>Opening</span>
              Bids establish the first price
            </p>
            <p>
              <span>Liquidity</span>
              Auction proceeds seed a v4 pool
            </p>
            <p>
              <span>Behavior</span>
              Defined for each market
            </p>
          </div>
          <p className="sentence-note">
            Every verified market appears in Explore with its launch record
          </p>
        </div>
      </section>

      <section className="market-section page-width" id="markets">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Explore</p>
            <h2>Markets launched on Launcher</h2>
          </div>
          {markets.length > 0 ? (
            <label className="market-search">
              <Search aria-hidden="true" size={17} />
              <span className="sr-only">Search markets</span>
              <input type="search" placeholder="Search by name or address" />
            </label>
          ) : null}
        </div>

        {markets.length === 0 ? (
          <div className="empty-market-state">
            <div className="empty-market-icon" aria-hidden="true">
              <Layers3 size={24} strokeWidth={1.6} />
            </div>
            <div>
              <h3>The first market starts here</h3>
              <p>
                Verified markets appear in Explore as soon as their launch
                record is complete
              </p>
            </div>
            <Link className="secondary-button" href="/launch">
              Create a market
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        ) : (
          <div className="market-list">
            {markets.map((market) => (
              <article className="market-row" key={market.id}>
                <div className="market-identity">
                  <span className="token-monogram" aria-hidden="true">
                    {market.symbol.slice(0, 2)}
                  </span>
                  <div>
                    <h3>{market.name}</h3>
                    <p>{market.symbol}</p>
                  </div>
                </div>
                <p>{market.behavior}</p>
                <p>
                  {market.liquidityPath === "auction"
                    ? "Auction-funded liquidity"
                    : "Direct liquidity"}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
