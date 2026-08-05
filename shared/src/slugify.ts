// Lowercases a name into a URL/route-safe slug. "new" is reserved as a route
// segment in the flow UI, so no name may slugify to it.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
