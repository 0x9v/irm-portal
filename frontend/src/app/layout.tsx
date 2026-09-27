import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IRM Platform",
  description: "Academic community platform for IRM at FST Mohammedia.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
