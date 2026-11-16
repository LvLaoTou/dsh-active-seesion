/**
 * Host half of dsh-active-sessions.
 *
 * The feature is entirely browser-side: the `sidebar.panellist` entry and the
 * `main` panel are registered by `lib/client.js`. This entry exists so the
 * package is an ordinary Loader row that the client module graph can serve a
 * browser half for.
 * @module dsh-active-sessions
 */

/** Loader-visible no-op body. */
export function apply() {}
