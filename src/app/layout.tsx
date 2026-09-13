import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

const sans = Inter({
  variable: "--font-app-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Lead → Launch",
    template: "%s · Lead → Launch",
  },
  description:
    "Prospecting, website auditing, website generation and outreach for a web studio.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    {
      media: "(prefers-color-scheme: dark)",
      color: "#0a0b0d",
    },
    {
      media: "(prefers-color-scheme: light)",
      color: "#fafafb",
    },
  ],
};

/**
 * The root layout owns only the document, fonts, theme and toasts.
 * Application chrome lives in the (app) route group so authentication
 * screens render without the application sidebar.
 */
export default function RootLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <Script id="lead-launch-theme" strategy="beforeInteractive">
          {`
            try {
              var t = localStorage.getItem("ll:theme");

              if (t !== "light" && t !== "dark") {
                t = window.matchMedia("(prefers-color-scheme: light)").matches
                  ? "light"
                  : "dark";
              }

              document.documentElement.dataset.theme = t;
            } catch (e) {
              document.documentElement.dataset.theme = "dark";
            }
          `}
        </Script>
      </head>

      <body className="h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}