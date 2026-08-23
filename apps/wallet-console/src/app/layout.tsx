import type { ReactNode } from "react";

export const metadata = {
  title: "Counter Wallet Console",
  description: "Counter Wallet console (scaffold).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
