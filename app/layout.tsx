import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ring Orden — Every call, perfectly ordered.",
  description:
    "Your voice commerce workspace. Turn conversations into orders, learn from corrections, and keep your restaurant in sync.",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
