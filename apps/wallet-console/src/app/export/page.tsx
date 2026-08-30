"use client";

import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from "@counter/ui";
import { Download, FileText, Calendar, Archive } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

interface ExportOption {
  id: string;
  label: string;
  description: string;
  format: string;
  icon: typeof FileText;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    id: "transactions",
    label: "Transactions",
    description: "Full transaction history with all fields",
    format: "CSV",
    icon: FileText,
  },
  {
    id: "mandates",
    label: "Mandates",
    description: "Active and historical mandate records",
    format: "CSV",
    icon: FileText,
  },
  {
    id: "activity-log",
    label: "Activity Log",
    description: "Security and authorization event log",
    format: "JSON",
    icon: Archive,
  },
  {
    id: "full-export",
    label: "Full Data Export",
    description: "Complete wallet data package (GDPR compliant)",
    format: "ZIP",
    icon: Archive,
  },
];

export default function ExportPage() {
  const handleExport = (label: string) => {
    toast.success(label + " export started. You will be notified when ready.");
  };

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Export</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Download your wallet data in various formats.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Date Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-[var(--foreground-secondary)]">
                  From
                </label>
                <Input type="date" defaultValue="2025-01-01" className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium text-[var(--foreground-secondary)]">To</label>
                <Input type="date" defaultValue="2025-01-31" className="mt-1" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {EXPORT_OPTIONS.map((option) => (
            <Card key={option.id} className="transition-all hover:border-[var(--brand-orange)]/20">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-[var(--brand-orange)]/10 p-2.5">
                      <option.icon className="h-5 w-5 text-[var(--brand-orange)]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[var(--foreground)]">{option.label}</p>
                        <Badge variant="secondary">{option.format}</Badge>
                      </div>
                      <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
                        {option.description}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleExport(option.label)}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
