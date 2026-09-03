import type { Metadata } from "next";
import { Suspense } from "react";

import {
  ProfileEntry,
  ProfileEntryLoadingState,
} from "@/components/profile-entry";

export const metadata: Metadata = {
  title: "Profile · Programmable",
  description: "Manage your Programmable profile, launches and rewards.",
  alternates: {
    canonical: "/profile",
  },
};

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileEntryLoadingState />}>
      <ProfileEntry />
    </Suspense>
  );
}
