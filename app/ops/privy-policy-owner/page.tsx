import type { Metadata } from "next";
import { PrivyPolicyOwner } from "@/components/privy-policy-owner";

export const metadata: Metadata = {
  title: "Policy owner authorization · Programmable",
  description: "Review and sign the exact prepared Custom Launch policy request.",
  robots: { index: false, follow: false },
};

export default function PrivyPolicyOwnerPage() {
  return <PrivyPolicyOwner />;
}
