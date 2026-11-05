/**
 * Builds the Content-Security-Policy for a single request.
 *
 * Scripts need the request's nonce, so injected markup cannot execute.
 * Styles allow 'unsafe-inline' because the UI and chart libraries set inline
 * style attributes; injected CSS is far less dangerous than injected script.
 */
export function buildCsp(nonce: string, { isDev }: { isDev: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // React needs eval for its debugging features in development only.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
