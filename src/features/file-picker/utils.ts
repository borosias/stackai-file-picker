import type {DriveItem, SortBy, SortDirection, TypeFilter,} from "@/lib/drive-types"

export interface ListControls {
  query: string
  typeFilter: TypeFilter
  sortBy: SortBy
  sortDirection: SortDirection
}

const DISPLAY_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

const collator = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
})

export function filterAndSortItems<T extends DriveItem>(
  items: readonly T[],
  controls: ListControls,
): T[] {
  const normalizedQuery = controls.query.trim().toLowerCase()

  const filtered = items.filter((item) => {
    if (controls.typeFilter !== "all" && item.type !== controls.typeFilter) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    return item.name.toLowerCase().includes(normalizedQuery)
  })

  return [...filtered].sort((left, right) => {
    let comparator = 0

    if (controls.sortBy === "name") {
      comparator = collator.compare(left.name, right.name)
    } else {
      const leftTime = new Date(left.modifiedAt).valueOf()
      const rightTime = new Date(right.modifiedAt).valueOf()
      comparator = leftTime - rightTime
    }

    return controls.sortDirection === "asc" ? comparator : comparator * -1
  })
}

export function normalizeResourcePath(path: string | undefined): string | undefined {
  if (!path?.trim()) {
    return undefined
  }

  let normalized = path.trim().replace(/\\/g, "/")
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`
  }

  normalized = normalized.replace(/\/{2,}/g, "/")

  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1)
  }

  return normalized || "/"
}

export function isSameOrDescendantPath(
  targetPath: string,
  candidatePath: string,
): boolean {
  const normalizedTarget = normalizeResourcePath(targetPath)
  const normalizedCandidate = normalizeResourcePath(candidatePath)

  if (!normalizedTarget || !normalizedCandidate) {
    return false
  }

  if (normalizedTarget === "/") {
    return true
  }

  return (
    normalizedCandidate === normalizedTarget ||
    normalizedCandidate.startsWith(`${normalizedTarget}/`)
  )
}

export function formatDateLabel(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.valueOf())) {
    return "Unknown date"
  }

  const month = DISPLAY_MONTH_LABELS[parsed.getUTCMonth()]
  const day = String(parsed.getUTCDate()).padStart(2, "0")
  const year = parsed.getUTCFullYear()
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0")
  const hours24 = parsed.getUTCHours()
  const meridiem = hours24 >= 12 ? "PM" : "AM"
  const hours12 = hours24 % 12 || 12

  return `${month} ${day}, ${year} at ${hours12}:${minutes} ${meridiem}`
}

export function formatSizeLabel(sizeBytes?: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) {
    return "-"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  let amount = sizeBytes
  let index = 0

  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024
    index += 1
  }

  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
