import {
  BookOpen,
  MessageCircle,
} from "lucide-react";

import {
  DiscordBrandIcon,
  DuneBrandIcon,
  GitHubBrandIcon,
  XBrandIcon,
} from "@/components/brand-icons";
import { WebsiteLinkIcon } from "@/components/website-link-icon";

export type CreatorArticleLinkProviderV1 =
  | "discord"
  | "docs"
  | "dune"
  | "farcaster"
  | "github"
  | "gitbook"
  | "instagram"
  | "linkedin"
  | "telegram"
  | "website"
  | "x"
  | "youtube";

const providers = [
  ["github", ["github.com"]],
  ["discord", ["discord.com", "discord.gg"]],
  ["x", ["x.com", "twitter.com"]],
  ["telegram", ["t.me", "telegram.me"]],
  ["gitbook", ["gitbook.com", "gitbook.io"]],
  ["dune", ["dune.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["instagram", ["instagram.com"]],
  ["linkedin", ["linkedin.com"]],
  ["farcaster", ["farcaster.xyz", "warpcast.com"]],
] as const satisfies readonly (readonly [
  Exclude<CreatorArticleLinkProviderV1, "website">,
  readonly string[],
])[];

export function creatorArticleLinkProviderV1(
  href: string,
): CreatorArticleLinkProviderV1 {
  try {
    const url = new URL(href);
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (
      (hostname === "programmable.market" || hostname.endsWith(".programmable.market"))
      && (url.pathname === "/docs" || url.pathname.startsWith("/docs/"))
    ) return "docs";
    for (const [provider, domains] of providers) {
      if (domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
        return provider;
      }
    }
  } catch {
    // Invalid or incomplete editor input uses the neutral website icon.
  }
  return "website";
}

export function creatorArticleLinkLabelV1(href: string) {
  const provider = creatorArticleLinkProviderV1(href);
  return provider === "x" ? "X"
    : provider === "github" ? "GitHub"
      : provider === "discord" ? "Discord"
        : provider === "telegram" ? "Telegram"
          : provider === "gitbook" || provider === "docs" ? "Docs"
            : provider === "dune" ? "Dune analytics"
              : provider === "youtube" ? "YouTube"
                : provider === "instagram" ? "Instagram"
                  : provider === "linkedin" ? "LinkedIn"
                    : provider === "farcaster" ? "Farcaster"
                      : "Website";
}

export function CreatorArticleLinkIcon({
  href,
  className,
}: Readonly<{ href: string; className?: string }>) {
  const provider = creatorArticleLinkProviderV1(href);
  return (
    <span
      aria-hidden="true"
      className={className}
      data-creator-link-provider={provider}
    >
      {provider === "github" ? <GitHubBrandIcon />
        : provider === "discord" ? <DiscordBrandIcon />
          : provider === "x" ? <XBrandIcon />
              : provider === "telegram" ? <TelegramBrandIcon />
              : provider === "gitbook" || provider === "docs" ? <BookOpen />
                : provider === "dune" ? <DuneBrandIcon />
                  : provider === "youtube" ? <YouTubeBrandIcon />
                    : provider === "instagram" ? <InstagramBrandIcon />
                      : provider === "linkedin" ? <LinkedInBrandIcon />
                        : provider === "farcaster" ? <MessageCircle />
                          : <WebsiteLinkIcon />}
    </span>
  );
}

function TelegramBrandIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.8 3.2 19.5 20.1c-.25 1.2-.91 1.5-1.85.94l-5.03-3.71-2.43 2.34c-.27.27-.5.5-1.02.5l.36-5.13 9.34-8.44c.41-.36-.09-.56-.63-.2L6.7 13.67l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L21.36 3c.9-.33 1.69.2 1.44 1.2Z"
      />
    </svg>
  );
}

function YouTubeBrandIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.81ZM9.55 15.57V8.43L15.82 12l-6.27 3.57Z"
      />
    </svg>
  );
}

function InstagramBrandIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.22-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.15-3.23 1.67-4.77 4.92-4.92C8.42 2.17 8.8 2.16 12 2.16ZM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.7 21.31.27 16.95.07 15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"
      />
    </svg>
  );
}

function LinkedInBrandIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V8.99h3.42v1.57h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12Zm1.78 13.02H3.56V8.99h3.56v11.46ZM22.23 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.73V1.73C24 .77 23.21 0 22.23 0Z"
      />
    </svg>
  );
}
