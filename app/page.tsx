import type { Metadata } from "next";

import { LandingPage } from "@/components/landing-page";

const pageDescription = "Shape what assets can do";
const pageSocialImage =
  "https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg";

export const metadata: Metadata = {
  title: "Programmable",
  description: pageDescription,
  openGraph: {
    type: "website",
    url: "https://programmable.market",
    siteName: "Programmable",
    title: "Programmable",
    description: pageDescription,
    images: [
      {
        url: pageSocialImage,
        secureUrl: pageSocialImage,
        width: 1200,
        height: 630,
        type: "image/jpeg",
        alt: "The white Programmable mark in a vivid floral night garden",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Programmable",
    description: pageDescription,
    creator: "@0xprogrammable",
    images: [
      {
        url: pageSocialImage,
        alt: "The white Programmable mark in a vivid floral night garden",
      },
    ],
  },
};

export default function HomePage() {
  return <LandingPage />;
}
