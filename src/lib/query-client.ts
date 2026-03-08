import { QueryClient, type QueryClientConfig } from "@tanstack/react-query"

export const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
}

export function makeQueryClient(): QueryClient {
  return new QueryClient(queryClientConfig)
}
