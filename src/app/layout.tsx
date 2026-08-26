import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Nightingale Care Note", description: "Trust-first longitudinal care collaboration" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
