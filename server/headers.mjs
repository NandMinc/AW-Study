// The headers every response carries. The tests run against this same server, so they check
// exactly what visitors get.
//
// Content-Security-Policy: only files from this site may run, load or be fetched. Nothing from
//   other sites, no inline scripts. 'wasm-unsafe-eval' lets WebAssembly (SQLite, later) compile.
//   When AI arrives, connect-src gains the AI provider's API and http://localhost:11434 (Ollama),
//   and nothing else.
// Cross-Origin-Opener-Policy: no other site's window can reach into this one.
export const HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // bugs.pacificfish.ca: only the opt-in bug button (#141, public/bugreport.js) sends there
    "connect-src 'self' https://bugs.pacificfish.ca",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// How long browsers may keep a file. no-transform on everything: Cloudflare passes files on
// unchanged (it would otherwise add its analytics script, which the policy above blocks).
//   /assets/: Vite puts a fingerprint of the contents in these names (index-3f9a1c.js), so a
//     changed file gets a new name and the old one can be kept for a year.
//   Everything else (the page, the service worker, the manifest): checked every time, so an
//     update reaches everyone at once. Unchanged files answer a quick 304.
export function cacheControl(path) {
  return path.startsWith('/assets/') ? 'public, max-age=31536000, immutable, no-transform' : 'no-cache, no-transform';
}
