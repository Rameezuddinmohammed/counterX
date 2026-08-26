import type { ReactNode } from "react";

export const metadata = {
  title: "Counter Wallet Console",
  description: "Counter Wallet management console for pilot operations.",
};

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a href={href}>{label}</a>
    </li>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <nav style={{ width: "240px", padding: "16px", borderRight: "1px solid #eee" }}>
            <h2>Wallet Console</h2>
            <ul style={{ listStyle: "none", padding: 0 }}>
              <NavLink href="/" label="Dashboard" />
              <NavLink href="/enrollment" label="Enrollment" />
              <NavLink href="/devices" label="Devices" />
              <NavLink href="/policy" label="Policy Editor" />
              <NavLink href="/references" label="References" />
              <NavLink href="/mandates" label="Mandates" />
              <NavLink href="/approvals" label="Approvals" />
              <NavLink href="/transactions" label="Transactions" />
              <NavLink href="/triggers" label="Triggers" />
              <NavLink href="/security" label="Security" />
              <NavLink href="/export" label="Export &amp; Closure" />
            </ul>
          </nav>
          <div style={{ flex: 1, padding: "24px" }}>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
