import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "轨道飞行 · Orbital Flight",
  description: "二维航天模拟器 · 2D spaceflight simulator — Three.js",
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="overflow-hidden bg-[#07090d] text-slate-200 antialiased">{children}</body>
    </html>
  );
}
