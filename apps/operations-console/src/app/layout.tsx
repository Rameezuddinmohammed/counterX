import type { ReactNode } from "react";

export const metadata = {
  title: "Counter Operations Console",
  description: "Counter Operations console (scaffold).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
