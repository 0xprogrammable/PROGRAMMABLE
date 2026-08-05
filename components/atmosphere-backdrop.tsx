"use client";

import { usePathname } from "next/navigation";

const desktopSky = "/brand/atmosphere/night-sky-desktop-v1.avif";
const mobileSky = "/brand/atmosphere/night-sky-mobile-v1.avif";
const desktopBotanical =
  "/brand/atmosphere/night-sky-botanical-desktop-v1.avif";
const mobileBotanical =
  "/brand/atmosphere/night-sky-botanical-mobile-v1.avif";

function AtmospherePicture({
  className,
  desktop,
  mobile,
}: {
  className: string;
  desktop: string;
  mobile: string;
}) {
  return (
    <picture className={className}>
      <source media="(max-width: 640px)" srcSet={mobile} />
      <img
        src={desktop}
        width={3200}
        height={1800}
        fetchPriority="high"
        decoding="async"
        alt=""
      />
    </picture>
  );
}

export function AtmosphereBackdrop() {
  const pathname = usePathname();
  const isLandingPage = pathname === "/";

  return (
    <div
      className="atmosphere-backdrop"
      data-landing={isLandingPage ? "true" : "false"}
      aria-hidden="true"
    >
      <AtmospherePicture
        className="atmosphere-layer atmosphere-sky"
        desktop={desktopSky}
        mobile={mobileSky}
      />
      <AtmospherePicture
        className="atmosphere-layer atmosphere-botanical"
        desktop={desktopBotanical}
        mobile={mobileBotanical}
      />
      <span className="atmosphere-stars atmosphere-stars-primary" />
      <span className="atmosphere-stars atmosphere-stars-secondary" />
      <span className="atmosphere-veil" />
    </div>
  );
}
