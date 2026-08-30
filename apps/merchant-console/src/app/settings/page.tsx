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
import { Settings, Key, Bell, AlertTriangle } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

export default function SettingsPage() {
  const handleSave = () => {
    toast.success("Settings saved successfully");
  };

  const handleCopyKey = () => {
    toast.success("API key copied to clipboard");
  };

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Settings</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Manage your account preferences and configuration.
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
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">
                Display Name
              </label>
              <Input placeholder="Merchant Pilot" className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">
                Email
              </label>
              <Input placeholder="admin@merchant-pilot.com" className="mt-1" disabled />
            </div>
            <Button onClick={handleSave}>Save Changes</Button>
          </CardContent>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Email Notifications</p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Receive alerts for critical events
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Webhook Notifications
                </p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Push events to your endpoint
                </p>
              </div>
              <Switch />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Weekly Reports</p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Summary digest every Monday
                </p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        {/* API Keys */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Keys
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">
                Merchant API Key
              </label>
              <div className="mt-1 flex gap-2">
                <Input defaultValue="cx_test_xxxxxxxxxxxx" disabled className="font-mono" />
                <Button variant="outline" onClick={handleCopyKey}>
                  Copy
                </Button>
              </div>
              <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                Use this key for API integrations in test mode
              </p>
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
                <p className="text-sm font-medium text-[var(--foreground)]">Deactivate Account</p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Permanently deactivate your merchant account
                </p>
              </div>
              <Button variant="destructive" size="sm">
                Deactivate
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
