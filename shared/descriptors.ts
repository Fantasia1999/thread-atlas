import type { SessionDescriptor } from "./types.js";

export function compareDescriptors(left: SessionDescriptor, right: SessionDescriptor): number {
  const timeDelta = right.mtimeMs - left.mtimeMs;
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.title.localeCompare(right.title);
}
