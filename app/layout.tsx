import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
  weight: ["400", "500"],
});

const siteUrl = new URL("https://programmable.family");
const siteDescription = "Launch tokens that work the way you imagine";
const socialImageUrl = new URL(
  "/og/programmable-loop-og-1200x630.png",
  siteUrl,
);

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "Programmable",
  description: siteDescription,
  applicationName: "Programmable",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon-pastel-v2.ico", sizes: "any" },
      {
        url: "/favicon-pastel-v2-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/favicon-pastel-v2-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/favicon-pastel-v2-48x48.png",
        sizes: "48x48",
        type: "image/png",
      },
    ],
    shortcut: "/favicon-pastel-v2.ico",
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Programmable",
    title: "Programmable",
    description: siteDescription,
    images: [
      {
        url: socialImageUrl,
        secureUrl: socialImageUrl,
        width: 1200,
        height: 630,
        type: "image/png",
        alt: "Programmable loop mark in a watercolor wildflower meadow",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Programmable",
    description: siteDescription,
    creator: "@0xprogrammable",
    images: [
      {
        url: socialImageUrl,
        alt: "Programmable loop mark in a watercolor wildflower meadow",
      },
    ],
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09111f" },
  ],
};

const themeInitializationScript = `
  (() => {
    try {
      const savedTheme = window.localStorage.getItem("programmable-theme");
      const theme = savedTheme === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
    }
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitializationScript }}
        />
      </head>
      <body
        className={`${instrumentSans.variable} ${plexMono.variable}`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
