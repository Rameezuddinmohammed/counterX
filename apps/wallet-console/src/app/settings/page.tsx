"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Button,
  Switch,
  Separator,
} from "@counter/ui";
import { Settings, Bell, Key, AlertTriangle } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

export default function SettingsPage() {
  const handleSave = () => {
    toast.success("Settings saved successfully");
  };

  const handleCopyKey = () => {
    toast.success("Wallet ID copied to clipboard");
  };

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Settings</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Manage your wallet preferences and configuration.
          </p>
        </div>

        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">Display Name</label>
              <Input placeholder="Wallet User" className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">Email</label>
              <Input placeholder="user@example.com" className="mt-1" disabled />
            </div>
            <Button onClick={handleSave}>Save Changes</Button>
          </CardContent>
        </Card>

        {/* Notification Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Transaction Alerts</p>
                <p className="text-xs text-[var(--foreground-muted)]">Get notified for every transaction</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Approval Requests</p>
                <p className="text-xs text-[var(--foreground-muted)]">Push notification for pending approvals</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Security Alerts</p>
                <p className="text-xs text-[var(--foreground-muted)]">Notify on suspicious activity</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Mandate Reminders</p>
                <p className="text-xs text-[var(--foreground-muted)]">Reminder before scheduled debits</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Weekly Summary</p>
                <p className="text-xs text-[var(--foreground-muted)]">Weekly spending digest via email</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        {/* Wallet ID */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              Wallet Identifier
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">Wallet ID</label>
              <div className="mt-1 flex gap-2">
                <Input value="wlt-pilot-001" disabled className="font-mono" />
                <Button variant="outline" onClick={handleCopyKey}>Copy</Button>
              </div>
              <p className="mt-1 text-xs text-[var(--foreground-muted)]">Use this identifier when referencing your wallet in API calls</p>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-red-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="h-4 w-4" />
              Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Close Wallet</p>
                <p className="text-xs text-[var(--foreground-muted)]">Permanently close your wallet and export all data</p>
              </div>
              <Button variant="destructive" size="sm">Close Wallet</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
