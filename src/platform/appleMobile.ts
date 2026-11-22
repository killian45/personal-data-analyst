/** True in Safari (or any browser) on an iPhone or iPad. */
export function isAppleMobile(userAgent = globalThis.navigator?.userAgent ?? '', maxTouchPoints = globalThis.navigator?.maxTouchPoints ?? 0): boolean {
  // iPadOS reports itself as a Mac; touch points tell them apart.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}
