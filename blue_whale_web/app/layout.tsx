import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "blue_Whale",
  description: "任意视频，告诉你的 Agent 即可创建",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#0a0a0a]">{children}</body>
    </html>
  );
}
