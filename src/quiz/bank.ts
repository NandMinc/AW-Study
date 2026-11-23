// Making a section's question bank with AI (DESIGN, "Questions"). How many: by the amount of text, about
// one question per 100 words, at least 3 and at most 10 a page, and at least 10 for the section, so a
// slide of a few lines gets 3 and a dense page of a document saved as PDF gets more (Nathan, Nov 18).
// A page of under 20 words (title, divider, thank-you) counts as 1, and the AI skips such slides.
// They're asked for a few pages at a time, within the helper's 30 questions a request. What comes back
// is checked twice (src/ai/check.ts, then the store), repeats are dropped, and each request's
// questions are saved as they arrive, so stopping half-way keeps them.
import { AiError, type AiBackend, type QuestionMix, type SlideText } from '../ai/backend';
import { questionKey } from '../db/quiz';
import type { Section } from '../types/lecture';
import type { Level, QuizStore } from '../types/quiz';
import type { StyleGuideContent } from '../types/style';
import { refreshGuide, type GuideStore } from './guide';
import { bankMix, bankNeeds, share } from './levels';

export const WORDS_PER_QUESTION = 100;
/** Below this, a page is probably a title, divider or thank-you slide. */
export const SHORT_PAGE_WORDS = 20;
export const MIN_PER_PAGE = 3;
export const MAX_PER_PAGE = 10;
export const MIN_BANK = 10;
export const SLIDES_PER_REQUEST = 5;
/** The helper's limits (helper/jobs.mjs LIMITS): questions a request, characters a slide, questions to avoid. */
export const QUESTIONS_PER_REQUEST = 30;
const PAGE_TEXT_MAX = 8_000;
const AVOID_MAX = 200;

/** The slides of a section that have text to ask about, as the AI gets them. */
export function sectionSlides(section: Pick<Section, 'firstPage' | 'lastPage'>, pageTexts: string[]): SlideText[] {
  const slides: SlideText[] = [];
  for (let page = section.firstPage; page <= section.lastPage; page++) {
    const text = (pageTexts[page - 1] ?? '').trim().slice(0, PAGE_TEXT_MAX);
    if (text) slides.push({ page, text });
  }
  return slides;
}

/**
 * Questions a page is worth: one per WORDS_PER_QUESTION words, between MIN_PER_PAGE and MAX_PER_PAGE.
 * A page of under SHORT_PAGE_WORDS words (a title, section divider, "Thank you" or "Questions?" slide)
 * is worth just 1: it's still sent, and the AI is told to skip such slides and ask about the rest.
 */
export function questionsForPage(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < SHORT_PAGE_WORDS) return 1;
  return Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, Math.round(words / WORDS_PER_QUESTION)));
}

/** How many questions a section's bank should hold: its pages' worth, at least MIN_BANK (0 with no text). */
export function bankTarget(slides: SlideText[]): number {
  if (slides.length === 0) return 0;
  return Math.max(MIN_BANK, slides.reduce((n, s) => n + questionsForPage(s.text), 0));
}

export interface BankRequest {
  pages: SlideText[];
  count: number;
  /** How many of each level and form (#123): adds up to `count`. */
  mix: QuestionMix;
}

/** A question as far as the bank's mix goes. */
type Banked = { form: 'choice' | 'short'; level: Level };

/**
 * The requests that fill a bank up to its target, level by level (#123): the bank should hold its target in
 * RULES.levels.bankShares (`shortShare` of level 3 as short answers), and only what each level is missing is asked
 * for, so an older bank of level-2 questions gets level 1 and 3 added. Pages go in groups of at most
 * SLIDES_PER_REQUEST pages and QUESTIONS_PER_REQUEST questions' worth; the questions still needed are shared
 * between the groups by what their pages are worth (whole numbers that add up exactly), each group's levels in
 * turn. Empty when every level is full or there's no text.
 */
export function planBank(slides: SlideText[], have: readonly Banked[], shortShare = 0): BankRequest[] {
  const target = bankTarget(slides);
  if (target === 0) return [];
  const needs = bankNeeds(bankMix(target, shortShare), have);
  const buckets = [...needs.choice, needs.short]; // choice levels 1-3, then short answers
  const need = buckets.reduce((a, b) => a + b, 0);
  if (need <= 0) return [];
  const groups: { pages: SlideText[]; worth: number }[] = [];
  for (const slide of slides) {
    const worth = questionsForPage(slide.text);
    const last = groups.at(-1);
    if (last && last.pages.length < SLIDES_PER_REQUEST && last.worth + worth <= QUESTIONS_PER_REQUEST) {
      last.pages.push(slide);
      last.worth += worth;
    } else groups.push({ pages: [slide], worth });
  }
  // A section under MIN_BANK is topped up in proportion too (its target is more than its pages' worth)
  const counts = share(need, groups.map((g) => g.worth)).map((c) => Math.min(c, QUESTIONS_PER_REQUEST));
  // The levels dealt out in turn (each next one the bucket furthest behind its share), so every group gets a mix
  const order: number[] = [];
  const given = buckets.map(() => 0);
  for (let i = 1; i <= need; i++) {
    let pick = 0;
    let behind = -Infinity;
    buckets.forEach((b, k) => {
      const d = (b * i) / need - given[k]!;
      if (b > given[k]! && d > behind) [pick, behind] = [k, d];
    });
    given[pick]!++;
    order.push(pick);
  }
  let at = 0;
  return groups
    .map((g, i) => {
      const mine = order.slice(at, (at += counts[i]!));
      const n = (k: number) => mine.filter((x) => x === k).length;
      return { pages: g.pages, count: mine.length, mix: { choice: [n(0), n(1), n(2)] as [number, number, number], short: n(3) } };
    })
    .filter((r) => r.count > 0);
}

/**
 * The class's guide for making questions (#123): brought up to date first (refreshGuide: the first guide, or a
 * remake after 2+ new lectures; nothing sent when it's current). If that fails for any reason but signing in, being
 * offline or a cancel (which making questions would meet too), the questions are made with the guide as it stands,
 * or none: a missing guide must never stop questions (e.g. a helper not yet updated to the style job).
 */
export async function guideForQuestions(store: GuideStore, ai: AiBackend, courseId: string, signal?: AbortSignal): Promise<StyleGuideContent | null> {
  try {
    return (await refreshGuide(store, ai, courseId, signal)).guide;
  } catch (err) {
    if (err instanceof AiError && (err.code === 'cancelled' || err.code === 'signed-out' || err.code === 'offline')) throw err;
    return (await store.getExamStyle(courseId)).guide;
  }
}

export interface BankProgress {
  done: number; // requests finished
  total: number;
  added: number; // questions saved so far
}

/**
 * Fills a section's bank: one AI request per planned group, each answer saved before the next is
 * asked. Throws the AI's error (AiError) or the store's; what was saved before that stays.
 */
export async function fillBank(options: {
  ai: AiBackend;
  store: Pick<QuizStore, 'listQuestions' | 'addQuestions'>;
  section: Pick<Section, 'id' | 'firstPage' | 'lastPage'>;
  pageTexts: string[];
  /** The class's exam style guide (#123): the questions follow it, and its short-answer share sets the bank's. */
  guide?: StyleGuideContent | null;
  onProgress?: (progress: BankProgress) => void;
  signal?: AbortSignal;
}): Promise<number> {
  const { ai, store, section, signal } = options;
  const existing = await store.listQuestions(section.id);
  const guide = options.guide ?? undefined;
  const requests = planBank(sectionSlides(section, options.pageTexts), existing, guide?.shortShare ?? 0);
  const seen = new Set(existing.map((q) => questionKey(q.question)));
  const asked = existing.map((q) => q.question);
  let added = 0;
  options.onProgress?.({ done: 0, total: requests.length, added });
  for (const [i, request] of requests.entries()) {
    const made = await ai.makeQuestions({ ...request, avoid: asked.slice(-AVOID_MAX), ...(guide && { guide }) }, signal);
    // Drop repeats (of the bank, or within this answer) rather than refusing the whole answer
    const fresh = made.filter((q) => {
      const key = questionKey(q.question);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length > 0) {
      await store.addQuestions(section.id, fresh);
      asked.push(...fresh.map((q) => q.question));
      added += fresh.length;
    }
    options.onProgress?.({ done: i + 1, total: requests.length, added });
  }
  return added;
}
