"use client";

import { Zap } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function TriggersPage() {
  return (
    <ComingSoonPage
      title="Triggers"
      description="Define automation rules to handle transactions based on conditions."
      icon={Zap}
    />
  );
}
