// Are we running inside an <iframe>? The app embeds ITSELF all over the admin:
// the Settings menu preview, the item editor's live preview, the platform
// Design gallery (one frame per venue), LandingStudio, and StaffPreview
// (/preview/pos, /kds, /preview/pinlock) — every one boots the full main.jsx
// in its own JS realm. Detection is by EMBEDDING, not by route, so it also
// covers frames that load "/" or a venue URL, while /preview/:slug opened as a
// real top-level tab correctly counts as NOT embedded.
// A cross-origin parent makes reading window.top throw — that still means
// "embedded", hence the catch returns true.
export const isEmbedded = (() => {
  try { return window.self !== window.top } catch (_) { return true }
})()
