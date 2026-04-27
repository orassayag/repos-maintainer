/**
 * Normalizes a repo name to a title (e.g., "pizza-restaurant" -> "Pizza Restaurant")
 */
export function normalizeToTitle(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
