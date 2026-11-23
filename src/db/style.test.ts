// Each class's exam style (#120): its other documents (materials) and its exam style (notes and the AI's guide).
// Every store test runs twice, before setup (plain records) and encrypted, like quiz.test.ts.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClassMaterialInput, StyleGuideContent, StyleGuideSource } from '../types/style';
import { examStyleId, openHonedDb } from './schema';
import { openStudyStore, type StudyStore } from './store';
import { fakePdf, newDataKey, testKeyring } from './test-helpers';

let counter = 0;
let store: StudyStore;
let now = new Date('2026-11-22T18:00:00.000Z');
const tick = () => (now = new Date(now.getTime() + 60_000));

const GUIDE: StyleGuideContent = {
  tests: 'Derivatives by rule; two worked problems per exam; no proofs.',
  levels: ['Which rule applies to x^5?', 'Differentiate 3x^2.', 'Differentiate (x^2+1)^3 and simplify.'],
  shortShare: 0.2,
};
const FROM: StyleGuideSource = { lectureIds: ['l1'], materialIds: [], notesAt: null };

const course = () => store.createCourse({ name: 'MATH 100', meetings: [], termStart: null, termEnd: null });
const pdf = (courseId: string, extra: Partial<ClassMaterialInput> = {}): ClassMaterialInput => ({
  courseId,
  title: '',
  fileName: 'Outline 2026.pdf',
  kind: 'outline',
  type: 'application/pdf',
  data: fakePdf('outline'),
  pageTexts: ['Week 1: limits', 'Week 2: derivatives'],
  ...extra,
});
const txt = (courseId: string, body: string, extra: Partial<ClassMaterialInput> = {}): ClassMaterialInput => ({
  courseId,
  title: '',
  fileName: 'midterm-2025.txt',
  kind: 'past-exam',
  type: 'text/plain',
  data: new TextEncoder().encode(body),
  pageTexts: ['ignored: a text file’s text is read from the file'],
  ...extra,
});

describe.each(['before setup (plain)', 'encrypted'] as const)('exam style store, %s', (mode) => {
  beforeEach(async () => {
    now = new Date('2026-11-22T18:00:00.000Z');
    store = await openStudyStore({ name: `style-${++counter}`, deps: { clock: () => now } });
    if (mode === 'encrypted') {
      const key = await newDataKey();
      await store.setUp(await testKeyring(key), key);
    }
  });

  describe('materials', () => {
    it('stores a PDF with its text, titled after the file, and lists by title', async () => {
      const c = await course();
      const input = pdf(c.id);
      const outline = await store.addMaterial(input);
      const exam = await store.addMaterial(txt(c.id, 'Q1. Differentiate x^3.', { title: 'A past midterm' }));
      expect(outline).toMatchObject({ courseId: c.id, title: 'Outline 2026', fileName: 'Outline 2026.pdf', kind: 'outline', type: 'application/pdf', pageCount: 2 });
      expect(await store.getMaterialFile(outline.id)).toEqual(input.data);
      expect(await store.getMaterialText(outline.id)).toEqual(['Week 1: limits', 'Week 2: derivatives']);
      expect((await store.listMaterials(c.id)).map((m) => m.title)).toEqual(['A past midterm', 'Outline 2026']);
      // A text file's text is its own content, one page, never what the caller passed
      expect(exam).toMatchObject({ type: 'text/plain', pageCount: 1, kind: 'past-exam', byteSize: 22 });
      expect(await store.getMaterialText(exam.id)).toEqual(['Q1. Differentiate x^3.']);
    });

    for (const [name, input] of [
      ['another file type', (id: string) => pdf(id, { type: 'application/msword' as never })],
      ['a “PDF” that isn’t one', (id: string) => pdf(id, { data: new TextEncoder().encode('hello') })],
      ['an empty file', (id: string) => pdf(id, { data: new Uint8Array() })],
      ['a PDF with no page text', (id: string) => pdf(id, { pageTexts: [] })],
      ['a text file that isn’t text', (id: string) => txt(id, '', { data: new Uint8Array([0xff, 0xfe, 0xfd]) })],
      ['a text file over 5 MB', (id: string) => txt(id, '', { data: new Uint8Array(5 * 1024 * 1024 + 1).fill(97) })],
      ['an unknown kind', (id: string) => pdf(id, { kind: 'essay' as never })],
    ] as const) {
      it(`refuses ${name}, storing nothing`, async () => {
        const c = await course();
        await expect(store.addMaterial(input(c.id))).rejects.toMatchObject({ code: 'invalid' });
        expect(await store.listMaterials(c.id)).toEqual([]);
      });
    }

    it('refuses a class that doesn’t exist', async () => {
      await expect(store.addMaterial(pdf('nope'))).rejects.toMatchObject({ code: 'not-found' });
    });

    it('renames and re-kinds a material; deleting takes its file and text', async () => {
      const c = await course();
      const m = await store.addMaterial(pdf(c.id));
      tick();
      const edited = await store.updateMaterial(m.id, { title: '  Syllabus  ', kind: 'other' });
      expect(edited).toMatchObject({ title: 'Syllabus', kind: 'other', createdAt: m.createdAt, updatedAt: now.toISOString() });
      await expect(store.updateMaterial(m.id, { title: ' ', kind: 'other' })).rejects.toMatchObject({ code: 'invalid' });
      await store.deleteMaterial(m.id);
      expect(await store.listMaterials(c.id)).toEqual([]);
      await expect(store.getMaterialFile(m.id)).rejects.toMatchObject({ code: 'not-found' });
      await expect(store.getMaterialText(m.id)).rejects.toMatchObject({ code: 'not-found' });
      await expect(store.deleteMaterial(m.id)).rejects.toMatchObject({ code: 'not-found' });
    });
  });

  describe('notes and the guide', () => {
    it('a class with nothing saved has an empty exam style', async () => {
      const c = await course();
      expect(await store.getExamStyle(c.id)).toEqual({ courseId: c.id, notes: '', notesAt: null, guide: null, updatedAt: null });
      await expect(store.getExamStyle('nope')).rejects.toMatchObject({ code: 'not-found' });
    });

    it('keeps the notes, trimmed, with when they changed; empty notes are allowed', async () => {
      const c = await course();
      const saved = await store.setStyleNotes(c.id, '  No proofs; formula sheet given.  ');
      expect(saved).toMatchObject({ notes: 'No proofs; formula sheet given.', notesAt: now.toISOString(), guide: null });
      expect(await store.getExamStyle(c.id)).toEqual(saved);
      tick();
      expect((await store.setStyleNotes(c.id, '')).notes).toBe('');
      await expect(store.setStyleNotes(c.id, 'x'.repeat(4_001))).rejects.toMatchObject({ code: 'invalid' });
    });

    it('saves a made guide with what it was made from; the notes stay', async () => {
      const c = await course();
      await store.setStyleNotes(c.id, 'Two essays.');
      tick();
      const saved = await store.saveMadeGuide(c.id, GUIDE, { lectureIds: ['l1', 'l1', 'l2'], materialIds: ['m1'], notesAt: '2026-11-22T18:00:00.000Z' });
      expect(saved.notes).toBe('Two essays.');
      expect(saved.guide).toEqual({ ...GUIDE, madeAt: now.toISOString(), from: { lectureIds: ['l1', 'l2'], materialIds: ['m1'], notesAt: '2026-11-22T18:00:00.000Z' }, editedAt: null });
      expect(await store.getExamStyle(c.id)).toEqual(saved);
    });

    it('a hand edit sets editedAt, and a later remake keeps it (so remakes keep the student’s changes)', async () => {
      const c = await course();
      await expect(store.editStyleGuide(c.id, GUIDE)).rejects.toMatchObject({ code: 'invalid' }); // nothing to edit yet
      await store.saveMadeGuide(c.id, GUIDE, FROM);
      tick();
      const edited = await store.editStyleGuide(c.id, { ...GUIDE, tests: 'My version.' });
      const editedAt = now.toISOString();
      expect(edited.guide).toMatchObject({ tests: 'My version.', editedAt, from: FROM });
      tick();
      const remade = await store.saveMadeGuide(c.id, { ...GUIDE, tests: 'Remade, with my version kept.' }, { ...FROM, lectureIds: ['l1', 'l2'] });
      expect(remade.guide).toMatchObject({ tests: 'Remade, with my version kept.', editedAt, madeAt: now.toISOString() });
    });

    for (const [name, guide] of [
      ['no tests text', { ...GUIDE, tests: ' ' }],
      ['tests over 3,000 characters', { ...GUIDE, tests: 'x'.repeat(3_001) }],
      ['two levels', { ...GUIDE, levels: ['a', 'b'] }],
      ['an empty level', { ...GUIDE, levels: ['a', '', 'c'] }],
      ['a level over 600 characters', { ...GUIDE, levels: ['a', 'b', 'x'.repeat(601)] }],
      ['a short share above 1', { ...GUIDE, shortShare: 1.5 }],
      ['a short share that isn’t a number', { ...GUIDE, shortShare: '0.5' }],
    ] as const) {
      it(`refuses a guide with ${name}`, async () => {
        const c = await course();
        await expect(store.saveMadeGuide(c.id, guide as never, FROM)).rejects.toMatchObject({ code: 'invalid' });
        expect((await store.getExamStyle(c.id)).guide).toBeNull();
      });
    }

    it('refuses a made-from that isn’t valid', async () => {
      const c = await course();
      await expect(store.saveMadeGuide(c.id, GUIDE, { lectureIds: 'l1', materialIds: [], notesAt: null } as never)).rejects.toMatchObject({ code: 'invalid' });
      await expect(store.saveMadeGuide(c.id, GUIDE, { ...FROM, notesAt: 'yesterday' })).rejects.toMatchObject({ code: 'invalid' });
    });
  });

  it('deleting a class deletes its materials (with their files) and its exam style, and only its own', async () => {
    const c = await course();
    const other = await store.createCourse({ name: 'HIST 200', meetings: [], termStart: null, termEnd: null });
    const m = await store.addMaterial(pdf(c.id));
    const kept = await store.addMaterial(pdf(other.id));
    await store.setStyleNotes(c.id, 'gone');
    await store.setStyleNotes(other.id, 'kept');
    const before = await store.latestSeq();
    await store.deleteCourse(c.id);
    expect(await store.listMaterials(c.id)).toEqual([]);
    await expect(store.getMaterialFile(m.id)).rejects.toMatchObject({ code: 'not-found' });
    await expect(store.getExamStyle(c.id)).rejects.toMatchObject({ code: 'not-found' });
    expect((await store.listMaterials(other.id)).map((x) => x.id)).toEqual([kept.id]);
    expect((await store.getExamStyle(other.id)).notes).toBe('kept');
    // the rows themselves are gone, not just unreachable without their class
    const db = await openHonedDb(`style-${counter}`);
    expect(await db.get('examStyles', examStyleId(c.id))).toBeUndefined();
    expect(await db.get('materialPages', m.id)).toBeUndefined();
    expect(await db.get('examStyles', examStyleId(other.id))).toBeDefined();
    db.close();
    // and the deletes are in the change log, so other devices delete them too
    const logged = (await store.changesSince(before)).map((ch) => `${ch.entity} ${ch.op} ${ch.entityId}`);
    expect(logged).toEqual(expect.arrayContaining([`material delete ${m.id}`, `examStyle delete ${examStyleId(c.id)}`]));
  });
});
