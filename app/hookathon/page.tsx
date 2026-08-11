import type { Metadata } from "next";

import { HookathonPage } from "@/components/hookathon-page";
import { readHookathonServerNowMs } from "@/lib/hookathon/server-clock";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const isExactProduction = process.env.VERCEL_ENV === "production";

  return {
    title: "Hookathon · Programmable",
    description: "Build, submit and launch a Programmable v4 hook project.",
    alternates: {
      canonical: "/hookathon",
    },
    robots: isExactProduction
      ? { index: true, follow: true }
      : {
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
}

export default async function HookathonRoute() {
  const initialNowMs = await readHookathonServerNowMs();

  return <HookathonPage initialNowMs={initialNowMs} />;
}
