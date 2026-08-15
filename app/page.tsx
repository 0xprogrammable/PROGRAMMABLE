import type { Metadata } from "next";

import { LandingPage } from "@/components/landing-page";

const pageDescription = "Shape what assets can do";

export const metadata: Metadata = {
  title: "Programmable",
  description: pageDescription,
  openGraph: {
    description: pageDescription,
  },
  twitter: {
    description: pageDescription,
  },
};

export default function HomePage() {
  return <LandingPage />;
}
