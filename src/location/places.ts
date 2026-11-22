import type { PlaceSummary } from './dailyLocation'
import { messages } from '../i18n'

import { placeTypeLabel } from './location'

/** A place's name: the user's own, else "Home" or its Google type. */
export function placeLabel(place: PlaceSummary, names: Readonly<Record<string, string>>): string {
  return names[place.key] ?? (place.isHome ? messages().labels.home : placeTypeLabel(place.semanticType))
}

/** OpenStreetMap at a position (opened only when the user clicks). */
export function mapUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
}
