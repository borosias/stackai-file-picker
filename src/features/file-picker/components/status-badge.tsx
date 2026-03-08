"use client"

import { Loader2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { DisplayStatus } from "@/lib/drive-types"
import { cn } from "@/lib/utils"

const TONE_CLASS_NAME: Record<DisplayStatus["tone"], string> = {
  neutral: "bg-slate-100 text-slate-600 hover:bg-slate-100",
  success: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
  warning: "bg-amber-100 text-amber-700 hover:bg-amber-100",
  danger: "bg-rose-100 text-rose-700 hover:bg-rose-100",
  info: "bg-sky-100 text-sky-700 hover:bg-sky-100",
}

function showsSpinner(code: DisplayStatus["code"]): boolean {
  return code === "syncing" || code === "removing"
}

export function StatusBadge({
  displayStatus,
}: Readonly<{
  displayStatus?: DisplayStatus
}>): React.JSX.Element {
  if (!displayStatus) {
    return (
      <span
        data-testid="status-badge-placeholder"
        aria-hidden="true"
        className="inline-flex h-6 w-[118px] shrink-0"
      />
    )
  }

  return (
    <Badge
      title={displayStatus.tooltip}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border border-transparent px-2.5 text-[11px] font-semibold",
        TONE_CLASS_NAME[displayStatus.tone],
      )}
    >
      {showsSpinner(displayStatus.code) ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : null}
      {displayStatus.label}
    </Badge>
  )
}
