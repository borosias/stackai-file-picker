// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { FileList } from "@/features/file-picker/components/file-list"
import type { StatusAwareDriveItem } from "@/lib/drive-types"

function createItem(overrides: Partial<StatusAwareDriveItem> = {}): StatusAwareDriveItem {
  return {
    id: "item-1",
    name: "notes.txt",
    type: "file",
    parentId: "root",
    resourcePath: "/notes.txt",
    modifiedAt: "2026-01-01T10:00:00.000Z",
    indexState: "not_indexed",
    indexOrigin: "none",
    isHidden: false,
    displayStatus: {
      code: "not_in_kb",
      label: "Not in KB",
      tone: "neutral",
      kind: "source-membership",
    },
    capabilities: {
      index: { allowed: true },
      deindex: {
        allowed: false,
        reasonCode: "not_indexed",
        reasonMessage: "This item is not indexed directly.",
      },
      unlist: { allowed: true },
      restore: {
        allowed: false,
        reasonCode: "not_hidden",
        reasonMessage: "This item is not hidden.",
      },
    },
    ...overrides,
  }
}

describe("FileList", () => {
  it("renders error state", () => {
    render(
      <FileList
        items={[]}
        folderName="Docs"
        isPending={false}
        isError
        errorMessage="Boom"
        onOpenFolder={vi.fn()}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getByText("Boom")).toBeInTheDocument()
  })

  it("renders empty state", () => {
    render(
      <FileList
        items={[]}
        folderName="Docs"
        isPending={false}
        isError={false}
        onOpenFolder={vi.fn()}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getByText("No items found")).toBeInTheDocument()
  })

  it("opens folder and prefetches folder data on pointer intent", async () => {
    const user = userEvent.setup()
    const onOpenFolder = vi.fn()
    const onPrefetchFolder = vi.fn()
    const folder = createItem({
      id: "folder-1",
      name: "Docs",
      type: "folder",
      resourcePath: "/docs",
      capabilities: {
        index: { allowed: true },
        deindex: {
          allowed: false,
          reasonCode: "not_indexed",
          reasonMessage: "This item is not indexed directly.",
        },
        unlist: {
          allowed: false,
          reasonCode: "unsupported_item_type",
          reasonMessage: "Only files can be removed from listing.",
        },
        restore: {
          allowed: false,
          reasonCode: "not_hidden",
          reasonMessage: "This item is not hidden.",
        },
      },
    })

    render(
      <FileList
        items={[folder]}
        folderName="Docs"
        isPending={false}
        isError={false}
        onOpenFolder={onOpenFolder}
        onPrefetchFolder={onPrefetchFolder}
        onAction={vi.fn()}
      />,
    )

    const openButton = screen.getAllByRole("button", { name: /docs/i })[0]
    await user.hover(openButton)
    await user.click(openButton)

    expect(onPrefetchFolder).toHaveBeenCalledWith("folder-1", "/docs")
    expect(onOpenFolder).toHaveBeenCalledWith(folder)
  })

  it("disables impossible actions with server-provided hints", async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const item = createItem({
      indexOrigin: "inherited",
      capabilities: {
        index: {
          allowed: false,
          reasonCode: "already_covered_by_ancestor",
          reasonMessage: "This item is already covered by an indexed parent folder.",
        },
        deindex: {
          allowed: false,
          reasonCode: "inherited_item",
          reasonMessage: "This item is indexed via a parent folder source.",
        },
        unlist: {
          allowed: false,
          reasonCode: "inherited_item",
          reasonMessage: "This item is indexed via a parent folder source.",
        },
        restore: {
          allowed: false,
          reasonCode: "not_hidden",
          reasonMessage: "This item is not hidden.",
        },
      },
    })

    render(
      <FileList
        items={[item]}
        folderName="Docs"
        isPending={false}
        isError={false}
        onOpenFolder={vi.fn()}
        onAction={onAction}
      />,
    )

    await user.click(screen.getAllByRole("button", { name: /more actions for notes.txt/i })[0])

    expect(
      screen.getAllByText("This item is indexed via a parent folder source."),
    ).toHaveLength(2)
    expect(onAction).not.toHaveBeenCalled()
  })

  it("uses server-driven index/deindex as the primary action", async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    const deindexItem = createItem({
      id: "direct-folder",
      name: "Projects",
      type: "folder",
      resourcePath: "/projects",
      indexState: "indexed",
      indexOrigin: "direct",
      displayStatus: {
        code: "added_to_kb",
        label: "Added to KB",
        tone: "success",
        kind: "source-membership",
      },
      capabilities: {
        index: {
          allowed: false,
          reasonCode: "already_indexed_direct",
          reasonMessage: "This item is already indexed directly.",
        },
        deindex: { allowed: true },
        unlist: {
          allowed: false,
          reasonCode: "unsupported_item_type",
          reasonMessage: "Only files can be removed from listing.",
        },
        restore: {
          allowed: false,
          reasonCode: "not_hidden",
          reasonMessage: "This item is not hidden.",
        },
      },
    })

    render(
      <FileList
        items={[deindexItem]}
        folderName="Projects"
        isPending={false}
        isError={false}
        onOpenFolder={vi.fn()}
        onAction={onAction}
      />,
    )

    expect(screen.getAllByText("Added to KB")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: /de-index projects/i }))
    expect(onAction).toHaveBeenCalledWith(deindexItem, "deindex")
  })

  it("renders membership-first folder badges instead of Unknown", () => {
    const directFolder = createItem({
      id: "folder-1",
      name: "Clients",
      type: "folder",
      resourcePath: "/clients",
      indexState: "unknown",
      indexOrigin: "direct",
      displayStatus: {
        code: "added_to_kb",
        label: "Added to KB",
        tone: "success",
        kind: "source-membership",
      },
      capabilities: {
        index: {
          allowed: false,
          reasonCode: "already_indexed_direct",
          reasonMessage: "This item is already indexed directly.",
        },
        deindex: { allowed: true },
        unlist: {
          allowed: false,
          reasonCode: "unsupported_item_type",
          reasonMessage: "Only files can be removed from listing.",
        },
        restore: {
          allowed: false,
          reasonCode: "not_hidden",
          reasonMessage: "This item is not hidden.",
        },
      },
    })
    const inheritedFolder = createItem({
      id: "folder-2",
      name: "Accounts",
      type: "folder",
      resourcePath: "/clients/accounts",
      indexState: "unknown",
      indexOrigin: "inherited",
      displayStatus: {
        code: "covered_by_parent",
        label: "Covered by parent",
        tone: "info",
        kind: "source-membership",
      },
      capabilities: {
        index: {
          allowed: false,
          reasonCode: "already_covered_by_ancestor",
          reasonMessage: "This item is already covered by an indexed parent folder.",
        },
        deindex: {
          allowed: false,
          reasonCode: "inherited_item",
          reasonMessage: "This item is indexed via a parent folder source.",
        },
        unlist: {
          allowed: false,
          reasonCode: "unsupported_item_type",
          reasonMessage: "Only files can be removed from listing.",
        },
        restore: {
          allowed: false,
          reasonCode: "not_hidden",
          reasonMessage: "This item is not hidden.",
        },
      },
    })

    render(
      <FileList
        items={[directFolder, inheritedFolder]}
        folderName="Clients"
        isPending={false}
        isError={false}
        onOpenFolder={vi.fn()}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getAllByText("Added to KB")).toHaveLength(2)
    expect(screen.getAllByText("Covered by parent")).toHaveLength(2)
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument()
  })

  it("forwards load more and shows paths in search mode", async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    const item = createItem({
      name: "invoice.pdf",
      resourcePath: "/finance/invoice.pdf",
    })

    render(
      <FileList
        items={[item]}
        folderName="Search results"
        hasMore
        isPending={false}
        isError={false}
        isSearchMode
        showPath
        onLoadMore={onLoadMore}
        onOpenFolder={vi.fn()}
        onAction={vi.fn()}
      />,
    )

    expect(screen.getAllByText("/finance/invoice.pdf")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: /load more results/i }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})
