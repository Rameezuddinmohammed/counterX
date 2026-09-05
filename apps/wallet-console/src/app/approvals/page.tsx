"use client";

import { CheckCircle2 } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function ApprovalsPage() {
  return (
    <ComingSoonPage
      title="Approvals"
      description="Review and authorize pending transaction requests."
      icon={CheckCircle2}
    />
  );
}
