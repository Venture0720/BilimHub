/**
 * API base URL — always empty string for web.
 * Relative URLs work fine with the same-origin Express server.
 */
export const API_BASE = '';

/** True on mobile browser (for responsive layout hints only). */
export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
