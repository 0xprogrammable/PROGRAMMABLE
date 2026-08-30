import type { Metadata } from "next";
import { Suspense } from "react";

import {
  ProfileSessionLoadingState,
  ProfileView,
} from "@/components/profile-view";

export const metadata: Metadata = {
  title: "Profile · Programmable",
  description: "Manage your Programmable profile, launches and rewards.",
  alternates: {
    canonical: "/profile",
  },
};

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSessionLoadingState />}>
      <ProfileView />
    </Suspense>
  );
}
