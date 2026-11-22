/**
 * JSON with object keys sorted, so records with equal content compare
 * equal regardless of key order. Shared by backup restore and sync.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  )
}
