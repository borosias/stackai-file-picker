import { beforeEach, describe, expect, it } from "vitest"

import { ROOT_FOLDER_ID } from "@/lib/drive-types"
import { useFilePickerStore } from "@/features/file-picker/store"

describe("file picker store", () => {
  beforeEach(() => {
    useFilePickerStore.setState({
      selectedFolderId: ROOT_FOLDER_ID,
      selectedFolderName: "My Drive",
      selectedFolderPath: "/",
      expandedFolderIds: [ROOT_FOLDER_ID],
    })
  })

  it("sets selected folder and ensures it is expanded", () => {
    useFilePickerStore.getState().setSelectedFolder("folder-a", "Folder A", "/Folder A")
    const state = useFilePickerStore.getState()

    expect(state.selectedFolderId).toBe("folder-a")
    expect(state.selectedFolderName).toBe("Folder A")
    expect(state.selectedFolderPath).toBe("/Folder A")
    expect(state.expandedFolderIds).toContain("folder-a")
  })

  it("does not collapse root folder when toggling root", () => {
    useFilePickerStore.getState().toggleExpandedFolder(ROOT_FOLDER_ID)

    expect(useFilePickerStore.getState().expandedFolderIds).toContain(ROOT_FOLDER_ID)
  })

  it("adds folder only once when ensureExpandedFolder is called repeatedly", () => {
    useFilePickerStore.getState().ensureExpandedFolder("folder-b")
    useFilePickerStore.getState().ensureExpandedFolder("folder-b")

    const occurrences = useFilePickerStore
      .getState()
      .expandedFolderIds.filter((id) => id === "folder-b").length

    expect(occurrences).toBe(1)
  })
})
