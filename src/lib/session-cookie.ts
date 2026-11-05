/**
 * The __Host- prefix makes browsers refuse the cookie unless it is Secure and
 * host-only, but plain-http local development can't use it.
 */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-session" : "session";
