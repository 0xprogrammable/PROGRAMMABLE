"use client";

import { usePathname } from "next/navigation";

const appSky = {
  desktop: "/brand/atmosphere/night-sky-desktop-v1.avif",
  desktopSrcSet: undefined,
  mobile: "/brand/atmosphere/night-sky-mobile-v1.avif",
  mobileSrcSet: undefined,
  width: 3200,
  height: 1800,
};

const landingArt = {
  desktop:
    "/brand/atmosphere/night-sky-botanical-desktop-v2-1920.avif",
  desktopSrcSet:
    "/brand/atmosphere/night-sky-botanical-desktop-v2-1920.avif 1920w, /brand/atmosphere/night-sky-botanical-desktop-v2.avif 3840w",
  mobile: "/brand/atmosphere/night-sky-botanical-mobile-v2-720.avif",
  mobileSrcSet:
    "/brand/atmosphere/night-sky-botanical-mobile-v2-720.avif 720w, /brand/atmosphere/night-sky-botanical-mobile-v2-900.avif 900w, /brand/atmosphere/night-sky-botanical-mobile-v2.avif 1440w",
  width: 3840,
  height: 2160,
};

export function AtmosphereBackdrop() {
  const pathname = usePathname();
  const isLandingPage = pathname === "/";
  const art = isLandingPage ? landingArt : appSky;
  const mobileSrcSet = art.mobileSrcSet ?? art.mobile;

  return (
    <div className="atmosphere-backdrop" aria-hidden="true">
      <picture className="atmosphere-layer atmosphere-art">
        <source
          media="(orientation: portrait) and (max-width: 1024px)"
          srcSet={mobileSrcSet}
          sizes="100vw"
          type="image/avif"
        />
        <img
          src={art.desktop}
          srcSet={art.desktopSrcSet}
          sizes="100vw"
          width={art.width}
          height={art.height}
          fetchPriority="high"
          decoding="async"
          alt=""
        />
      </picture>
      <span className="atmosphere-stars atmosphere-stars-primary" />
      <span className="atmosphere-stars atmosphere-stars-secondary" />
      <span className="atmosphere-sparkles">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} />
        ))}
      </span>
      <span className="atmosphere-veil" />
    </div>
  );
}
