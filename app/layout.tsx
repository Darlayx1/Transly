import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transly — Latihan Terjemahan Inggris–Indonesia",
  description: "Latihan menerjemahkan dengan teks sesuai levelmu, evaluasi AI yang mendalam, dan feedback kontekstual.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
