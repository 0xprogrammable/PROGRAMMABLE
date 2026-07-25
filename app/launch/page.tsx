import type { Metadata } from "next";
import { LaunchBuilder } from "@/components/launch-builder";

export const metadata: Metadata = {
  title: "Launch",
  description:
    "Create an asset and define its Uniswap v4 market",
};

export default function LaunchPage() {
  return <LaunchBuilder />;
}
