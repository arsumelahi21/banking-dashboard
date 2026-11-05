/**
 * The __Host- prefix makes browsers refuse the cookie unless it is Secure and
 * host-only, but plain-http local development can't use it.
 */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-session" : "session";

/** Signed out after this long without a request. The server enforces it; the UI only warns. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
