"use client";

import { BookOpen } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function ReferencesPage() {
  return (
    <ComingSoonPage
      title="References"
      description="Configuration reference data used by wallet policies and triggers."
      icon={BookOpen}
    />
  );
}
