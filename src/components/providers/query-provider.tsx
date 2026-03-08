"use client"

import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"

import { makeQueryClient } from "@/lib/query-client"

export function QueryProvider({
  children,
}: Readonly<{
  children: React.ReactNode
}>): React.JSX.Element {
  const [queryClient] = React.useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  )
}
