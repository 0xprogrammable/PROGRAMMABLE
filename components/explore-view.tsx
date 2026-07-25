import Link from "next/link";
import { ArrowRight, Layers3, Search } from "lucide-react";
import type { LauncherMarket } from "@/lib/markets";

export function ExploreView({ markets }: { markets: LauncherMarket[] }) {
  return (
    <>
      <section className="explore-hero page-width">
        <div className="hero-copy">
          <p className="eyebrow">Uniswap v4 launch planning</p>
          <h1>A clearer way to shape an onchain market.</h1>
          <p className="hero-lede">
            Define the asset, liquidity path, and market behavior in one launch
            plan. The interface stays simple; every added behavior stays
            explicit.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/launch">
              Build a launch
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <a className="text-link" href="#markets">
              Explore markets
            </a>
          </div>
        </div>

        <div className="launch-sentence" aria-label="Default launch plan">
          <div className="sentence-heading">
            <span>Default launch plan</span>
            <span className="sentence-index">01</span>
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
              Chosen before deployment
            </p>
          </div>
          <p className="sentence-note">
            A launch plan is not a token deployment. Contracts remain outside
            this build until review is complete.
          </p>
        </div>
      </section>

      <section className="market-section page-width" id="markets">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Explore</p>
            <h2>Markets launched here.</h2>
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
              <h3>No markets have been launched through Launcher yet.</h3>
              <p>
                Markets will appear here after their deployment and launch
                record have been verified.
              </p>
            </div>
            <Link className="secondary-button" href="/launch">
              Build a launch
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
