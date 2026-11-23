// The server, against a small throwaway site folder (not dist/, so these run without a build).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../server/server.mjs';

let server;
let base;
let temp; // temp/site is what's served; temp/outside.txt must never be reachable

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'aw-study-'));
  const root = join(temp, 'site');
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>test</title>');
  await writeFile(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  await writeFile(join(root, 'manifest.webmanifest'), '{}');
  await writeFile(join(temp, 'outside.txt'), 'secret');
  server = await start({ port: 0, host: '127.0.0.1', root });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  await rm(temp, { recursive: true, force: true });
});

describe('server', () => {
  it('answers the health check, never cached', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('serves the page with the security headers, checked on every visit', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("connect-src 'self' https://admin.pacificfish.ca;"); // only the bug button's reports (#141) go elsewhere
    expect(csp).not.toContain('unsafe-inline');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('lets browsers keep fingerprinted assets for a year', async () => {
    const res = await fetch(`${base}/assets/index-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable, no-transform');
  });

  it('gives the manifest its own type', async () => {
    const res = await fetch(`${base}/manifest.webmanifest`);
    expect(res.headers.get('content-type')).toBe('application/manifest+json');
  });

  it('answers 304 when the browser already has the file', async () => {
    const first = await fetch(`${base}/`);
    const again = await fetch(`${base}/`, { headers: { 'If-None-Match': first.headers.get('etag') } });
    expect(again.status).toBe(304);
  });

  it('never serves files outside the site folder', async () => {
    for (const path of ['/../outside.txt', '/%2e%2e/outside.txt', '/..%2Foutside.txt']) {
      const res = await fetch(`${base}${path}`);
      expect([403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain('secret');
    }
  });

  it('answers 404 for a missing file and 405 for other methods', async () => {
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});
