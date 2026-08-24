import type { ReactNode } from "react";

export const metadata = {
  title: "Counter Operations Console",
  description: "Separately authorized operations console for the Counter platform.",
};

/**
 * Navigation links for the operations console.
 */
const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/fleet", label: "Fleet Health" },
  { href: "/incidents", label: "Incidents" },
  { href: "/queues", label: "Queues" },
  { href: "/kill-switches", label: "Kill Switches" },
  { href: "/support", label: "Support Sessions" },
  { href: "/adapters", label: "Adapters" },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <nav style={{ width: "220px", padding: "1rem", borderRight: "1px solid #e0e0e0" }}>
            <h2 style={{ fontSize: "1rem", marginBottom: "1rem" }}>Operations</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {NAV_ITEMS.map((item) => (
                <li key={item.href} style={{ marginBottom: "0.5rem" }}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div style={{ flex: 1, padding: "1rem" }}>{children}</div>
        </div>
      </body>
    </html>
  );
}
