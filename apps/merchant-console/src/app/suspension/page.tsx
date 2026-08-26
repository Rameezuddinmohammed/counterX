"use client";

import { useState } from "react";
import { Card, CardContent, Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@counter/ui";
import { AlertOctagon, Ban, Trash2 } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

export default function SuspensionPage() {
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [showOffboardDialog, setShowOffboardDialog] = useState(false);

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Suspension & Offboarding</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">Account suspension and offboarding management.</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-emerald-500/10 p-3"><AlertOctagon className="h-6 w-6 text-emerald-500" /></div>
                <div><p className="font-semibold text-[var(--foreground)]">Account Status</p><p className="text-sm text-[var(--foreground-muted)]">Your merchant account is active and operational</p></div>
              </div>
              <Badge variant="success">Active</Badge>
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-lg bg-amber-500/10 p-2"><Ban className="h-5 w-5 text-amber-500" /></div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--foreground)]">Suspend Account</p>
                  <p className="mt-1 text-sm text-[var(--foreground-muted)]">Temporarily halt all operations. Can be reversed.</p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowSuspendDialog(true)}>Suspend</Button>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-lg bg-red-500/10 p-2"><Trash2 className="h-5 w-5 text-red-500" /></div>
                <div className="flex-1">
                  <p className="font-medium text-[var(--foreground)]">Initiate Offboarding</p>
                  <p className="mt-1 text-sm text-[var(--foreground-muted)]">Permanently close the account. This action is irreversible.</p>
                  <Button variant="destructive" size="sm" className="mt-4" onClick={() => setShowOffboardDialog(true)}>Offboard</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        <Dialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Suspend Account</DialogTitle><DialogDescription>This will temporarily halt all operations. You can reactivate later.</DialogDescription></DialogHeader>
            <DialogFooter><Button variant="outline" onClick={() => setShowSuspendDialog(false)}>Cancel</Button><Button variant="destructive" onClick={() => { setShowSuspendDialog(false); toast.success("Account suspended"); }}>Confirm Suspension</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={showOffboardDialog} onOpenChange={setShowOffboardDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Initiate Offboarding</DialogTitle><DialogDescription>This will permanently close your merchant account. This cannot be undone.</DialogDescription></DialogHeader>
            <DialogFooter><Button variant="outline" onClick={() => setShowOffboardDialog(false)}>Cancel</Button><Button variant="destructive" onClick={() => { setShowOffboardDialog(false); toast.success("Offboarding initiated"); }}>Confirm Offboarding</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageWrapper>
  );
}
