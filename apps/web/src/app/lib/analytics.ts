import { track } from "@vercel/analytics";

/**
 * Track a product event without ever risking app failure.
 * Keep props small and NEVER send config content.
 */
export function trackEvent(
  name: string,
  props?: Record<string, string | number | boolean | null | undefined>
) {
  try {
    track(name, props ?? {});
  } catch {
    // no-op
  }
}
