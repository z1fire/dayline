import type { Metadata, Viewport } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const socialImage = new URL(`${basePath}/og.png`, siteUrl).toString();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Dayline — Daily Time Block Planner",
  description:
    "Shape your day with a calm, offline-friendly time blocking planner.",
  applicationName: "Dayline",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Dayline",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "icon-192.png",
    apple: "icon-192.png",
  },
  openGraph: {
    title: "Dayline — Daily Time Block Planner",
    description: "Make room for what matters with calm, visual time blocking.",
    type: "website",
    images: [
      {
        url: socialImage,
        width: 1734,
        height: 907,
        alt: "Dayline — Make room for what matters.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dayline — Daily Time Block Planner",
    description: "Make room for what matters with calm, visual time blocking.",
    images: [socialImage],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f4ee",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="manifest.webmanifest" />
      </head>
      <body>{children}</body>
    </html>
  );
}
