// The bar at the bottom of the three main pages (docs/design/README.md, "Nav bar"): Tasks (a house),
// Classes (a stack of books) and Settings (a gear). The current page's icon sits on a filled green
// pill. Full-screen screens (a class, the slides, a quiz, Play) don't show it: they have a back link.
// The pill is one element behind the buttons (#143): it slides to a button that's hovered or pressed and
// to the new page, so the bar must stay the same element between the three pages (it does, in App.tsx).
import type { JSX } from 'react';
import { href, type Route } from './route';

export type MainPage = 'tasks' | 'classes' | 'settings';

/** The main page a route is, or null for a full-screen one (no nav bar). */
export function mainPage(route: Route): MainPage | null {
  return route.name === 'tasks' || route.name === 'classes' || route.name === 'settings' ? route.name : null;
}

const PAGES: { page: MainPage; label: string; icon: () => JSX.Element }[] = [
  { page: 'tasks', label: 'Tasks', icon: House },
  { page: 'classes', label: 'Classes', icon: Books },
  { page: 'settings', label: 'Settings', icon: Gear },
];

export function NavBar({ current }: { current: MainPage }) {
  return (
    <nav className="nav-bar" aria-label="Pages" data-at={PAGES.findIndex((p) => p.page === current)}>
      <span className="nav-pill" aria-hidden="true" />
      {PAGES.map(({ page, label, icon: Icon }) => (
        <a key={page} href={href({ name: page })} aria-label={label} aria-current={page === current ? 'page' : undefined}>
          <Icon />
        </a>
      ))}
    </nav>
  );
}

function House() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 3.2 2.6 11a1 1 0 0 0 1.3 1.5l.6-.5V20a1 1 0 0 0 1 1h4v-6h5v6h4a1 1 0 0 0 1-1v-8l.6.5A1 1 0 0 0 21.4 11Z" />
    </svg>
  );
}

function Books() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <rect x="3" y="16" width="18" height="5" rx="1.2" />
        <rect x="4.5" y="10" width="15" height="5" rx="1.2" />
        <rect x="3.5" y="4" width="14" height="5" rx="1.2" transform="rotate(-6 10.5 6.5)" />
      </g>
    </svg>
  );
}

function Gear() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <mask id="nav-gear-hole">
        <rect width="24" height="24" fill="#fff" />
        <circle cx="12" cy="12" r="2.8" fill="#000" />
      </mask>
      <g fill="currentColor" mask="url(#nav-gear-hole)">
        <circle cx="12" cy="12" r="6.6" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <rect key={angle} x="10.4" y="1.8" width="3.2" height="5" rx="1" transform={`rotate(${angle} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}
