"use client";

import { Card, CardContent, CardHeader, CardTitle, Avatar, AvatarFallback, Badge, Separator } from "@counter/ui";
import { User, Mail, Shield, Clock, Globe, Wallet } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

export default function ProfilePage() {
  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Profile</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Your account information and wallet details.
          </p>
        </div>

        {/* Profile Card */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-6">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="bg-[var(--brand-orange)]/20 text-[var(--brand-orange)] text-2xl font-bold">
                  WU
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-xl font-bold text-[var(--foreground)]">Wallet User</h2>
                <p className="text-[var(--foreground-secondary)]">wallet-user@pilot.counter.network</p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="default">Owner</Badge>
                  <Badge variant="success">Active</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Details */}
        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Name</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Wallet User</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Email</p>
                <p className="text-sm font-medium text-[var(--foreground)]">wallet-user@pilot.counter.network</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Wallet className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Wallet ID</p>
                <p className="text-sm font-mono font-medium text-[var(--foreground)]">wlt-pilot-001</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Role</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Wallet Owner</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Last Login</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Recently</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Environment</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Pilot (Test Mode)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Linked Services */}
        <Card>
          <CardHeader>
            <CardTitle>Linked Services</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-[var(--brand-orange)]/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-[var(--brand-orange)]">C</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">Counter Network</p>
                  <p className="text-xs text-[var(--foreground-muted)]">Trusted payment protocol</p>
                </div>
              </div>
              <Badge variant="success">Connected</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-blue-500">B</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">Bank Account</p>
                  <p className="text-xs text-[var(--foreground-muted)]">Primary funding source</p>
                </div>
              </div>
              <Badge variant="success">Connected</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
