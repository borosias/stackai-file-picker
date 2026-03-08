import { create } from "zustand"

import { ROOT_FOLDER_ID } from "@/lib/drive-types"

interface FilePickerStore {
  selectedFolderId: string
  selectedFolderName: string
  selectedFolderPath: string
  expandedFolderIds: string[]
  setSelectedFolder: (folderId: string, folderName: string, folderPath?: string) => void
  toggleExpandedFolder: (folderId: string) => void
  ensureExpandedFolder: (folderId: string) => void
}

export const useFilePickerStore = create<FilePickerStore>((set) => ({
  selectedFolderId: ROOT_FOLDER_ID,
  selectedFolderName: "My Drive",
  selectedFolderPath: "/",
  expandedFolderIds: [ROOT_FOLDER_ID],
  setSelectedFolder: (folderId, folderName, folderPath = "/") => {
    set((state) => {
      const expanded = new Set(state.expandedFolderIds)
      expanded.add(folderId)

      return {
        selectedFolderId: folderId,
        selectedFolderName: folderName,
        selectedFolderPath: folderPath,
        expandedFolderIds: [...expanded],
      }
    })
  },
  toggleExpandedFolder: (folderId) => {
    set((state) => {
      const expanded = new Set(state.expandedFolderIds)
      if (expanded.has(folderId)) {
        expanded.delete(folderId)
      } else {
        expanded.add(folderId)
      }

      if (folderId === ROOT_FOLDER_ID) {
        expanded.add(ROOT_FOLDER_ID)
      }

      return {
        expandedFolderIds: [...expanded],
      }
    })
  },
  ensureExpandedFolder: (folderId) => {
    set((state) => {
      if (state.expandedFolderIds.includes(folderId)) {
        return state
      }

      return {
        expandedFolderIds: [...state.expandedFolderIds, folderId],
      }
    })
  },
}))
