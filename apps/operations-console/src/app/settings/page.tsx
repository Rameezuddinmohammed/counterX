"use client";

import { Card, CardContent, CardHeader, CardTitle, Input, Button, Switch, Separator } from "@counter/ui";
import { Bell, Clock, AlertTriangle } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

export default function SettingsPage() {
  const handleSave = () => {
    toast.success("Settings saved successfully");
  };

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Settings</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Configure operator preferences, alert policies, and dashboard behavior.
          </p>
        </div>

        {/* Alert Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Alert Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Critical Incident Alerts</p>
                <p className="text-xs text-[var(--foreground-muted)]">Receive immediate alerts for critical severity incidents</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Fleet Health Degradation</p>
                <p className="text-xs text-[var(--foreground-muted)]">Alert when dependencies show degraded status</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Queue Backlog Warnings</p>
                <p className="text-xs text-[var(--foreground-muted)]">Alert when queue depth exceeds threshold</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Kill Switch Activations</p>
                <p className="text-xs text-[var(--foreground-muted)]">Notify all operators when kill switches are toggled</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        {/* Escalation Policy */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Escalation Policy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">Primary Escalation Contact</label>
              <Input placeholder="ops-team@counter.dev" className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">Escalation Timeout (minutes)</label>
              <Input placeholder="15" type="number" className="mt-1" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Auto-escalate Critical</p>
                <p className="text-xs text-[var(--foreground-muted)]">Automatically escalate unacknowledged critical incidents</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        {/* Dashboard Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Dashboard
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-[var(--foreground-secondary)]">Auto-refresh Interval</label>
              <Input placeholder="30" type="number" className="mt-1" />
              <p className="mt-1 text-xs text-[var(--foreground-muted)]">Seconds between automatic data refreshes</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Sound Alerts</p>
                <p className="text-xs text-[var(--foreground-muted)]">Play audio for critical alerts</p>
              </div>
              <Switch />
            </div>
            <Button onClick={handleSave}>Save Changes</Button>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
