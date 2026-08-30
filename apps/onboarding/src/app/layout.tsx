import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Counter — Connect your AI",
  description: "Sign in and connect any AI to Counter's test-mode agent-commerce network.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
