/**
 * Shared utilities for integration providers.
 */

// Generic DFS to sort parents before children
export function sortParentsFirst<T>(
  items: T[],
  getId: (item: T) => string,
  getParentId: (item: T) => string | null | undefined,
): T[] {
  const byId = new Map(items.map((item) => [getId(item), item]));
  const visited = new Set<string>();
  const result: T[] = [];

  function visit(item: T): void {
    if (visited.has(getId(item))) return;
    visited.add(getId(item));

    const parentId = getParentId(item);
    if (parentId) {
      const parent = byId.get(parentId);
      if (parent) visit(parent);
    }

    result.push(item);
  }

  for (const item of items) {
    visit(item);
  }

  return result;
}
