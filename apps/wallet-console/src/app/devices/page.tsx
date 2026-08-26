"use client";

import { Card, CardContent, Badge, Button } from "@counter/ui";
import { Smartphone, Laptop, Tablet, Plus, Trash2 } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

interface Device {
  id: string;
  name: string;
  type: "phone" | "laptop" | "tablet";
  lastActive: string;
  status: "active" | "inactive";
  model: string;
}

const MOCK_DEVICES: Device[] = [
  { id: "dev-001", name: "iPhone 15 Pro", type: "phone", lastActive: "Just now", status: "active", model: "iOS 18.2" },
  { id: "dev-002", name: "MacBook Pro", type: "laptop", lastActive: "2 hours ago", status: "active", model: "macOS Sequoia" },
  { id: "dev-003", name: "iPad Air", type: "tablet", lastActive: "3 days ago", status: "inactive", model: "iPadOS 18" },
];

const DEVICE_ICONS = { phone: Smartphone, laptop: Laptop, tablet: Tablet };

export default function DevicesPage() {
  const handleUnpair = (name: string) => {
    toast.success(name + " has been unpaired");
  };

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Devices</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              Manage paired devices for wallet access and authorization.
            </p>
          </div>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Pair Device
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MOCK_DEVICES.map((device) => {
            const Icon = DEVICE_ICONS[device.type];
            return (
              <Card key={device.id} className="transition-all hover:border-[var(--brand-orange)]/20">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-[var(--brand-orange)]/10 p-2.5">
                        <Icon className="h-5 w-5 text-[var(--brand-orange)]" />
                      </div>
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{device.name}</p>
                        <p className="text-xs text-[var(--foreground-muted)]">{device.model}</p>
                      </div>
                    </div>
                    <Badge variant={device.status === "active" ? "success" : "secondary"}>
                      {device.status}
                    </Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-[var(--foreground-muted)]">Last active: {device.lastActive}</p>
                    <Button variant="outline" size="sm" onClick={() => handleUnpair(device.name)}>
                      <Trash2 className="mr-1 h-3 w-3" />
                      Unpair
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </PageWrapper>
  );
}
