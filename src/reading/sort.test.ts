// The pure sorting rules (#157): grey pixels, text masks, template, the sort and fingerprints.
import { describe, expect, it } from 'vitest';
import { boxMask, fingerprint, inkShare, normaliseText, sameFingerprint, SORT, sortPage, templateMask, toGray, type Gray } from './sort';

/** A white page `w` × `h` with these pixels black. */
function page(w: number, h: number, black: [number, number][] = []): Gray {
  const data = new Uint8Array(w * h).fill(255);
  for (const [x, y] of black) data[y * w + x] = 0;
  return { width: w, height: h, data };
}

describe('toGray', () => {
  it('lays pixels over white: transparent is white, opaque black is black, colours by brightness', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255]);
    expect(Array.from(toGray(rgba, 4, 1).data)).toEqual([255, 0, 255, 76]);
  });
});

describe('boxMask and inkShare', () => {
  it('grows boxes by the pad and clips them to the page', () => {
    const mask = boxMask(4, 4, [{ x0: 1, y0: 1, x1: 2, y1: 2 }], 1);
    expect(Array.from(mask)).toEqual([1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0]);
    expect(Array.from(boxMask(2, 2, [{ x0: -5, y0: -5, x1: 50, y1: 50 }]))).toEqual([1, 1, 1, 1]);
  });

  it('counts drawn pixels outside every mask, as a share of the page', () => {
    const g = page(10, 10, [[0, 0], [5, 5], [9, 9]]);
    expect(inkShare(g)).toBeCloseTo(0.03);
    expect(inkShare(g, boxMask(10, 10, [{ x0: 4, y0: 4, x1: 6, y1: 6 }]))).toBeCloseTo(0.02);
    expect(inkShare(g, boxMask(10, 10, [{ x0: 4, y0: 4, x1: 6, y1: 6 }]), boxMask(10, 10, [{ x0: 0, y0: 0, x1: 1, y1: 1 }]))).toBeCloseTo(0.01);
    expect(inkShare(g, null, undefined)).toBeCloseTo(0.03);
  });

  it('ignores light grey (anti-aliasing, paper tints)', () => {
    const g = page(10, 10);
    g.data.fill(SORT.inkLevel);
    expect(inkShare(g)).toBe(0);
  });
});

describe('templateMask', () => {
  const pages = (n: number, extra: (i: number) => [number, number][] = () => []) =>
    Array.from({ length: n }, (_, i) => page(10, 10, [[0, 0], ...extra(i)]));

  it('needs enough pages of one size to tell template from a page’s own drawing', () => {
    expect(templateMask(pages(SORT.templateMinPages - 1))).toBeNull();
    expect(templateMask([])).toBeNull();
    expect(templateMask([...pages(SORT.templateMinPages - 1), page(20, 20)])).toBeNull();
  });

  it('marks what is drawn on most pages, not what only some have', () => {
    const mask = templateMask(pages(5, (i) => (i < 3 ? [[5, 5]] : i === 4 ? [[9, 9]] : [])))!;
    expect(mask[0]).toBe(1); // on every page
    expect(mask[55]).toBe(1); // on 3 of 5 = 60%
    expect(mask[99]).toBe(0); // on one page only
  });
});

describe('sortPage', () => {
  it('pictures above the share, text with text, blank with neither', () => {
    expect(sortPage('Hello', SORT.pictureShare + 0.0001)).toBe('pictures');
    expect(sortPage('', SORT.pictureShare + 0.0001)).toBe('pictures');
    expect(sortPage('Hello', SORT.pictureShare)).toBe('text');
    expect(sortPage('Hello', 0)).toBe('text');
    expect(sortPage('  \n ', 0)).toBe('blank');
  });
});

describe('fingerprints', () => {
  it('match the same text (white space aside) and the same drawing only', async () => {
    const a = await fingerprint('Unit 4:  Fallacies\n', page(10, 10, [[1, 1]]));
    expect(sameFingerprint(a, await fingerprint(' Unit 4: Fallacies', page(10, 10, [[1, 1]])))).toBe(true);
    expect(sameFingerprint(a, await fingerprint('Unit 4: Fallacies', page(10, 10, [[1, 2]])))).toBe(false);
    expect(sameFingerprint(a, await fingerprint('Unit 5: Fallacies', page(10, 10, [[1, 1]])))).toBe(false);
    // the same pixels in another shape are another drawing
    expect(sameFingerprint(await fingerprint('', page(10, 20)), await fingerprint('', page(20, 10)))).toBe(false);
    expect(a.text).toMatch(/^[0-9a-f]{64}$/);
    expect(a.look).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalises white space only', () => {
    expect(normaliseText('  a\n\tb  c ')).toBe('a b c');
    expect(normaliseText('A b')).not.toBe(normaliseText('a b'));
  });
});
