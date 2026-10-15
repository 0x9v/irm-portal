import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import ApplicationShell from "@/components/layout/ApplicationShell";
import { ThemeProvider } from "@/context/ThemeContext";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "EtudSup",
  description: "Study resources and the IRM student community at FST Mohammedia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Only root theme attributes/style differ after the pre-hydration script.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script id="irm-theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-page text-text font-sans antialiased">
        <ThemeProvider>
          <AuthProvider>
            <ApplicationShell copyrightYear={new Date().getFullYear()}>{children}</ApplicationShell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
