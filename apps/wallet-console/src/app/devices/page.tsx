"use client";

import { Smartphone } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function DevicesPage() {
  return (
    <ComingSoonPage
      title="Devices"
      description="Manage paired devices for wallet access and authorization."
      icon={Smartphone}
    />
  );
}
