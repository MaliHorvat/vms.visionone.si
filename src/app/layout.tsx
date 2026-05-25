import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VisionOne VMS",
  description: "Customer VMS portal for VisionOne camera systems.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sl">
      <body>{children}</body>
    </html>
  );
}
