"use client";

import { Download } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function ExportPage() {
  return (
    <ComingSoonPage
      title="Export"
      description="Download your wallet data in various formats."
      icon={Download}
    />
  );
}
