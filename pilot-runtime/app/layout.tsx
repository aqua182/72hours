import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nightingale Pilot",
  description: "Authenticated care collaboration pilot",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f7f8f6", color: "#15242b", fontFamily: "Arial, sans-serif" }}>{children}</body>
    </html>
  );
}
