import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import "./configdiff.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ConfigSift",
  description: "Diff, validate, and review config files safely with risk flagging.",
  metadataBase: new URL("https://configsift.com"),
  openGraph: {
    title: "ConfigSift",
    description: "Diff, validate, and review config files safely with risk flagging.",
    url: "https://configsift.com",
    siteName: "ConfigSift",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ConfigSift" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ConfigSift",
    description: "Diff, validate, and review config files safely with risk flagging.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
