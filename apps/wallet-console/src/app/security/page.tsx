"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Switch,
  Separator,
} from "@counter/ui";
import { Fingerprint, Smartphone, Clock, Key, Globe } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

export default function SecurityPage() {
  const handleToggle2FA = (enabled: boolean) => {
    toast.success("Two-factor authentication " + (enabled ? "enabled" : "disabled"));
  };

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Security</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Manage authentication, sessions, and security preferences.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4" />
              Two-Factor Authentication
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Biometric Authentication
                </p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Use fingerprint or face ID for high-value transactions
                </p>
              </div>
              <Switch defaultChecked onCheckedChange={handleToggle2FA} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">SMS Verification</p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Receive OTP for login from new devices
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">App-based TOTP</p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Use authenticator app as backup method
                </p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Active Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                device: "iPhone 15 Pro",
                location: "Mumbai, IN",
                time: "Current session",
                current: true,
              },
              {
                device: "MacBook Pro",
                location: "Mumbai, IN",
                time: "2 hours ago",
                current: false,
              },
            ].map((session, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3"
              >
                <div className="flex items-center gap-3">
                  <Smartphone className="h-4 w-4 text-[var(--foreground-muted)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">{session.device}</p>
                    <p className="text-xs text-[var(--foreground-muted)]">
                      {session.location} - {session.time}
                    </p>
                  </div>
                </div>
                {session.current ? (
                  <Badge variant="success">Current</Badge>
                ) : (
                  <Button variant="outline" size="sm">
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Security Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--border)]">
              {[
                {
                  event: "Login from new device",
                  detail: "MacBook Pro - Mumbai",
                  time: "2 hours ago",
                },
                {
                  event: "Password changed",
                  detail: "Successful password update",
                  time: "5 days ago",
                },
                {
                  event: "Failed login attempt",
                  detail: "Unknown device - Delhi",
                  time: "1 week ago",
                },
                {
                  event: "2FA method added",
                  detail: "Biometric authentication enabled",
                  time: "2 weeks ago",
                },
              ].map((entry, i) => (
                <div key={i} className="px-5 py-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">{entry.event}</p>
                    <p className="text-xs text-[var(--foreground-muted)]">{entry.detail}</p>
                  </div>
                  <span className="text-xs text-[var(--foreground-muted)]">{entry.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              Trusted Devices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--foreground-muted)] mb-3">
              Trusted devices can authorize transactions without additional verification.
            </p>
            <div className="space-y-2">
              {[
                { name: "iPhone 15 Pro", trusted: "2025-01-01" },
                { name: "MacBook Pro", trusted: "2025-01-10" },
              ].map((device, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-[var(--foreground-muted)]" />
                    <span className="text-sm text-[var(--foreground)]">{device.name}</span>
                  </div>
                  <span className="text-xs text-[var(--foreground-muted)]">
                    Since {device.trusted}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
