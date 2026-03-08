import type { Metadata } from "next"

import { AppProviders } from "@/components/providers/app-providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Stack AI Drive Picker",
  description:
    "Custom file picker with lazy folder loading, indexing controls, de-indexing, and listing management.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
