import type { Metadata } from "next";
import "./globals.css";
import "./polish.css";
import "./planning-ui.css";
import "./planner-desk.css";
import "./planning-decision.css";
import "./map-symbols.css";
import "./typography.css";
import "./inventory-workspace.css";

export const metadata: Metadata = {
  title: "Spotlight OOH",
  description:
    "Interactive outdoor media inventory and campaign planning map.",
  icons: {
    icon: [{ url: "/favicon.svg?v=billboard360-20260731", type: "image/svg+xml" }],
    shortcut: [{ url: "/favicon.svg?v=billboard360-20260731", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
