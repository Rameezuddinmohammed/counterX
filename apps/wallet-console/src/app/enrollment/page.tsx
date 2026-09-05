"use client";

import { UserCheck } from "lucide-react";
import { ComingSoonPage } from "@/components/coming-soon-page";

export default function EnrollmentPage() {
  return (
    <ComingSoonPage
      title="Enrollment"
      description="Complete all steps to fully activate your wallet."
      icon={UserCheck}
    />
  );
}
