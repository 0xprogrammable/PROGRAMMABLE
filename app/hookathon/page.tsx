import type { Metadata } from "next";

import { HookathonPage } from "@/components/hookathon-page";
import { readHookathonServerNowMs } from "@/lib/hookathon/server-clock";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hookathon · Programmable",
  description: "Build, submit and launch a Programmable v4 hook project.",
  alternates: {
    canonical: "/hookathon",
  },
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
  openGraph: null,
  twitter: null,
};

export default async function HookathonRoute() {
  const initialNowMs = await readHookathonServerNowMs();

  return <HookathonPage initialNowMs={initialNowMs} />;
}
