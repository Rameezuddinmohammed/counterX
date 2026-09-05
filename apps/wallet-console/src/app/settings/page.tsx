"use client";

import { Settings } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function SettingsPage() {
  return (
    <ComingSoonPage
      title="Settings"
      description="Manage your wallet preferences and configuration."
      icon={Settings}
    />
  );
}
