// Draws the app's PNG icons from public/icons/icon.svg with a headless Chromium (Playwright's).
// Run `npm run icons` after changing the SVG, then commit the PNGs.
//   icon-192.png, icon-512.png   the manifest's icons (Android, desktop installs)
//   icon-maskable-512.png        for Android's shaped icons: full-bleed background, the picture
//                                shrunk into the middle 70% so no shape cuts it off
//   apple-touch-icon.png         180x180 for the iPhone Home Screen (iOS rounds the corners itself)
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = await readFile(dir + 'icon.svg', 'utf8');
const art = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const page = (size, inner, background, radius) => `<!doctype html>
<html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;background:${background};border-radius:${radius}px;display:grid;place-items:center;overflow:hidden">
<img src="${art}" style="width:${inner}px;height:${inner}px">
</div></body></html>`;

const icons = [
  { name: 'icon-192.png', size: 192, inner: 192, background: 'transparent', radius: 0 },
  { name: 'icon-512.png', size: 512, inner: 512, background: 'transparent', radius: 0 },
  { name: 'icon-maskable-512.png', size: 512, inner: 358, background: '#272727', radius: 0 },
  { name: 'apple-touch-icon.png', size: 180, inner: 180, background: '#272727', radius: 0 },
];

const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const tab = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await tab.setContent(page(icon.size, icon.inner, icon.background, icon.radius));
    await tab.locator('img').evaluate((img) => img.decode());
    await tab.screenshot({ path: dir + icon.name, omitBackground: icon.background === 'transparent' });
    await tab.close();
    console.log(`wrote public/icons/${icon.name}`);
  }
} finally {
  await browser.close();
}
