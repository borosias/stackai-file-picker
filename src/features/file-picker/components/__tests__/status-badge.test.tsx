// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatusBadge } from "@/features/file-picker/components/status-badge"
import type { DisplayStatus } from "@/lib/drive-types"

function createDisplayStatus(
  overrides: Partial<DisplayStatus> = {},
): DisplayStatus {
  return {
    code: "not_in_kb",
    label: "Not in KB",
    tone: "neutral",
    kind: "materialization",
    ...overrides,
  }
}

describe("StatusBadge", () => {
  it("renders server-provided labels and tooltips", () => {
    render(
      <>
        <StatusBadge
          displayStatus={createDisplayStatus({
            code: "in_kb",
            label: "In KB",
            tone: "success",
            tooltip: "This item is currently present in the knowledge base.",
          })}
        />
        <StatusBadge
          displayStatus={createDisplayStatus({
            code: "error",
            label: "Error",
            tone: "danger",
          })}
        />
        <StatusBadge
          displayStatus={createDisplayStatus({
            code: "status_unavailable",
            label: "Status unavailable",
            kind: "binding",
            tooltip: "Set STACKAI_KNOWLEDGE_BASE_ID to enable statuses.",
          })}
        />
      </>,
    )

    expect(screen.getByText("In KB")).toBeInTheDocument()
    expect(screen.getByText("Error")).toBeInTheDocument()
    expect(screen.getByText("Status unavailable")).toBeInTheDocument()
    expect(screen.getByTitle("This item is currently present in the knowledge base.")).toBeInTheDocument()
    expect(screen.getByTitle("Set STACKAI_KNOWLEDGE_BASE_ID to enable statuses.")).toBeInTheDocument()
  })

  it("shows spinner for syncing and removing only", () => {
    const { container, rerender } = render(
      <StatusBadge
        displayStatus={createDisplayStatus({
          code: "syncing",
          label: "Syncing",
          tone: "warning",
          kind: "materialization",
        })}
      />,
    )
    expect(container.querySelector(".animate-spin")).toBeInTheDocument()

    rerender(
      <StatusBadge
        displayStatus={createDisplayStatus({
          code: "removing",
          label: "Removing from KB",
          tone: "warning",
          kind: "materialization",
        })}
      />,
    )
    expect(container.querySelector(".animate-spin")).toBeInTheDocument()

    rerender(
      <StatusBadge
        displayStatus={createDisplayStatus({
          code: "syncing",
          label: "Syncing",
          tone: "warning",
          kind: "materialization",
        })}
      />,
    )
    expect(container.querySelector(".animate-spin")).toBeInTheDocument()

    rerender(
      <StatusBadge
        displayStatus={createDisplayStatus({
          code: "in_kb",
          label: "In KB",
          tone: "success",
          kind: "materialization",
        })}
      />,
    )
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument()
  })

  it("renders a fixed-size placeholder before overlay data arrives", () => {
    render(<StatusBadge />)

    const placeholder = screen.getByTestId("status-badge-placeholder")
    expect(placeholder.className).toContain("w-[118px]")
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument()
    expect(screen.queryByText("Loading status")).not.toBeInTheDocument()
  })
})
