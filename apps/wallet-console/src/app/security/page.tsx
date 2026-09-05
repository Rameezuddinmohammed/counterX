"use client";

import { Lock } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function SecurityPage() {
  return (
    <ComingSoonPage
      title="Security"
      description="Manage authentication, sessions, and security preferences."
      icon={Lock}
    />
  );
}
