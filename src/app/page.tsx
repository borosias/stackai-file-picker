import type { InfiniteData } from "@tanstack/react-query"
import { HydrationBoundary, dehydrate } from "@tanstack/react-query"

import { FilePickerShell } from "@/features/file-picker/components/file-picker-shell"
import { folderChildrenKey } from "@/features/file-picker/query-keys"
import { ROOT_FOLDER_ID, type FolderItemsResponse } from "@/lib/drive-types"
import { makeQueryClient } from "@/lib/query-client"
import { listFolderItems } from "@/server/file-picker/service"

export const dynamic = "force-dynamic"

export default async function Home(): Promise<React.JSX.Element> {
  const queryClient = makeQueryClient()
  const rootItems = await listFolderItems(ROOT_FOLDER_ID, {
    parentPath: "/",
  })

  queryClient.setQueryData<InfiniteData<FolderItemsResponse, string | null>>(
    folderChildrenKey({
      parentId: ROOT_FOLDER_ID,
      parentPath: "/",
      pageSize: 100,
    }),
    {
      pages: [rootItems],
      pageParams: [null],
    },
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <FilePickerShell />
    </HydrationBoundary>
  )
}
