import type { ReactNode } from "react";

export const metadata = {
  title: "Counter Merchant Console",
  description: "Counter Merchant configuration console (scaffold).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
