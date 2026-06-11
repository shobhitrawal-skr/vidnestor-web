import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport = {
  themeColor: "#f7f7f7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata = {
  title: "VidNestor Web | Social Media Downloader",
  description: "Fast, free, and premium social media downloader for YouTube, Instagram, TikTok, and Twitter. No login, no signup.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "VidNestor",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/logo.png",
  },
  openGraph: {
    title: "VidNestor Web | Social Media Downloader",
    description: "Fast, free, and premium social media downloader for YouTube, Instagram, TikTok, and Twitter. No login, no signup.",
    siteName: "VidNestor",
    images: [
      {
        url: "/logo.png",
        width: 512,
        height: 512,
        alt: "VidNestor Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "VidNestor Web | Social Media Downloader",
    description: "Fast, free, and premium social media downloader for YouTube, Instagram, TikTok, and Twitter. No login, no signup.",
    images: ["/logo.png"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
