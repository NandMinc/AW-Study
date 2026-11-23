// The app's AI client (#34): requests to /ai/ on our own site only, replies checked on the device,
// every failure turned into an error the screens can explain. A fake fetch: nothing is sent.
import { describe, expect, it } from 'vitest';
import { AiError, type McQuestion } from './backend';
import { checkGradeMany, checkQuestions, checkStyle } from './check';
import { FakeAiBackend } from './fake';
import { HttpAiBackend, signInUrl } from './http';

const SLIDES = [
  { page: 21, text: 'Covalent bonds: atoms share a pair of electrons.' },
  { page: 22, text: 'Ionic bonds: one atom gives an electron to another.' },
];
const good = (page = 21, question = 'What do atoms share in a covalent bond?'): McQuestion => ({
  form: 'choice',
  level: 2,
  question,
  options: ['A pair of electrons', 'Protons', 'Neutrons', 'Nothing'],
  answer: 0,
  page,
  explanation: 'Slide 21.',
});

type Seen = { url: string; init: RequestInit };

/** A fetch that records requests and answers with `reply`. */
function fakeFetch(reply: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const s = { url, init };
    seen.push(s);
    return reply(s);
  }) as unknown as typeof fetch;
  return { seen, fetcher };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    expect(err).toBeInstanceOf(AiError);
    return (err as AiError).code;
  }
}

describe('HttpAiBackend: requests', () => {
  it('posts each job as JSON to /ai/ on this site, with the Access cookie only for this site, never following redirects', async () => {
    const { seen, fetcher } = fakeFetch(({ url }) =>
      url.endsWith('questions') ? json(200, { questions: [good()] }) : url.endsWith('grade') ? json(200, { mark: 1, outOf: 2, feedback: 'Good.' }) : json(200, { text: 'Text.' }),
    );
    const ai = new HttpAiBackend('/ai/', fetcher);
    await ai.makeQuestions({ pages: SLIDES, count: 1 });
    await ai.gradeAnswer({ question: 'q', points: ['a', 'b'], answer: 'a', slides: SLIDES });
    await ai.explain({ selection: 'covalent', slides: SLIDES });
    await ai.ask({ question: 'Why?', slides: SLIDES });
    expect(seen.map((s) => s.url)).toEqual(['/ai/questions', '/ai/grade', '/ai/explain', '/ai/ask']);
    for (const { init } of seen) {
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(init.credentials).toBe('same-origin');
      expect(init.redirect).toBe('manual');
    }
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ pages: SLIDES, count: 1 });
  });

  it('only talks to a path on this same site', () => {
    expect(() => new HttpAiBackend('https://elsewhere.example/ai/')).toThrow(/same site/);
    expect(() => new HttpAiBackend('//elsewhere.example/ai/')).toThrow(/same site/);
    expect(signInUrl('/ai/', '/#/class/abc')).toBe('/ai/signin?then=%2F%23%2Fclass%2Fabc');
  });
});

describe('HttpAiBackend: written questions (#87)', () => {
  const asked = { pages: SLIDES, count: 2 };
  const page = SLIDES[0]!.page;
  const q = (over: Record<string, unknown> = {}) => ({ question: 'Why?', points: ['one', 'two'], page, ...over });

  it('posts to /ai/written and keeps the questions that pass every check, up to the count', async () => {
    const { seen, fetcher } = fakeFetch(() =>
      json(200, {
        questions: [
          q(),
          q({ question: 'why?' }), // the same question again
          q({ question: 'No points?', points: [] }),
          q({ question: 'Seven points?', points: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
          q({ question: 'An empty point?', points: ['a', ' '] }),
          q({ question: 'Another slide?', page: 999 }),
          q({ question: 'Second' }),
          q({ question: 'Third' }),
        ],
      }),
    );
    expect(await new HttpAiBackend('/ai/', fetcher).makeWrittenQuestions(asked)).toEqual([q(), q({ question: 'Second' })]);
    expect(seen.map((s) => s.url)).toEqual(['/ai/written']);
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual(asked);
  });

  it('none usable is an error', async () => {
    const ai = new HttpAiBackend('/ai/', fakeFetch(() => json(200, { questions: [q({ page: 999 })] })).fetcher);
    expect(await codeOf(ai.makeWrittenQuestions(asked))).toBe('unavailable');
  });
});

describe('HttpAiBackend: status', () => {
  it('asks /ai/whoami with a GET (no body, no AI used) and checks the answer', async () => {
    const { seen, fetcher } = fakeFetch(() => json(200, { email: 'matt@example.com', ready: true, usedToday: 3, dailyLimit: 200 }));
    expect(await new HttpAiBackend('/ai/', fetcher).status()).toEqual({ email: 'matt@example.com', usedToday: 3, dailyLimit: 200 });
    expect(seen.map((s) => s.url)).toEqual(['/ai/whoami']);
    expect(seen[0]!.init.method).toBe('GET');
    expect(seen[0]!.init.body).toBeUndefined();
    expect(seen[0]!.init.credentials).toBe('same-origin');
    expect(seen[0]!.init.redirect).toBe('manual');
  });
  it('says signed out, not allowed or unreadable like the jobs do', async () => {
    const status = (response: () => Response) => new HttpAiBackend('/ai/', fakeFetch(response).fetcher).status();
    expect(await codeOf(status(() => json(401, { error: 'x' })))).toBe('signed-out');
    expect(await codeOf(status(() => new Response(null, { status: 302, headers: { location: 'https://access.example' } })))).toBe('signed-out');
    expect(await codeOf(status(() => json(403, { email: 'x@example.com', ready: false, error: 'This account can’t use the AI helper.' })))).toBe('not-allowed');
    expect(await codeOf(status(() => json(200, { email: 'x@example.com', usedToday: -1, dailyLimit: 200 })))).toBe('unavailable');
    expect(await codeOf(status(() => json(200, { email: 7, usedToday: 0, dailyLimit: 200 })))).toBe('unavailable');
    expect(await codeOf(status(() => json(200, { usedToday: 0, dailyLimit: 200 })))).toBe('unavailable');
  });
});

describe('HttpAiBackend: errors', () => {
  const ai = (response: () => Response) => new HttpAiBackend('/ai/', fakeFetch(response).fetcher);
  const explain = (backend: HttpAiBackend) => backend.explain({ selection: 'x', slides: SLIDES });

  it('Access’s sign-in redirect means signed out', async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response;
    expect(await codeOf(explain(ai(() => opaque)))).toBe('signed-out');
    expect(await codeOf(explain(ai(() => new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/' } }))))).toBe(
      'signed-out',
    );
    expect(await codeOf(explain(ai(() => json(401, { error: 'Not signed in.' }))))).toBe('signed-out');
  });

  it('maps the helper’s answers to plain errors, keeping its message', async () => {
    expect(await codeOf(explain(ai(() => json(403, { error: 'No.' }))))).toBe('not-allowed');
    const limited = explain(ai(() => json(429, { error: 'You’ve used today’s 200 AI requests.' })));
    await expect(limited).rejects.toThrow('today’s 200');
    expect(await codeOf(explain(ai(() => json(429, {}))))).toBe('limit');
    for (const status of [400, 413, 415]) expect(await codeOf(explain(ai(() => json(status, {}))))).toBe('invalid');
    for (const status of [500, 502, 503, 504]) expect(await codeOf(explain(ai(() => json(status, {}))))).toBe('unavailable');
  });

  it('a 200 that isn’t JSON (e.g. an HTML page) is unusable, not trusted', async () => {
    expect(await codeOf(explain(ai(() => new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } }))))).toBe(
      'unavailable',
    );
  });

  it('no connection, and cancelling', async () => {
    const failing = new HttpAiBackend('/ai/', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    expect(await codeOf(explain(failing))).toMatch(/offline|unavailable/);
    const aborting = new HttpAiBackend('/ai/', (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch);
    expect(await codeOf(explain(aborting))).toBe('cancelled');
  });
});

describe('checking replies on the device', () => {
  const pages = [21, 22];

  it('keeps only questions that pass every check', () => {
    const reply = {
      questions: [
        good(21),
        { ...good(21, 'Three options?'), options: ['a', 'b', 'c'] },
        { ...good(21, 'Answer outside?'), answer: 4 },
        { ...good(21, 'Fractional answer?'), answer: 1.5 },
        { ...good(99, 'Slide not asked about?') },
        { ...good(21, 'Repeated options?'), options: ['Same', 'same', 'b', 'c'] },
        { ...good(21, 'Empty option?'), options: ['a', ' ', 'b', 'c'] },
        { ...good(21, ' ') },
        good(21), // a repeat of the first
        good(22, 'What does an ionic bond do?'),
        'not an object',
      ],
    };
    expect(checkQuestions(reply, pages, 10).map((q) => q.question)).toEqual(['What do atoms share in a covalent bond?', 'What does an ionic bond do?']);
  });

  it('no more than asked for; none usable is an error', () => {
    expect(checkQuestions({ questions: [good(21, 'a?'), good(21, 'b?'), good(21, 'c?')] }, pages, 2)).toHaveLength(2);
    expect(() => checkQuestions({ questions: [{ ...good(), page: 1 }] }, pages, 2)).toThrow(AiError);
    expect(() => checkQuestions({ nope: 1 }, pages, 2)).toThrow(AiError);
  });

  it('the client checks even when the helper said 200', async () => {
    const backend = new HttpAiBackend('/ai/', fakeFetch(() => json(200, { questions: [{ ...good(), answer: 7 }] })).fetcher);
    expect(await codeOf(backend.makeQuestions({ pages: SLIDES, count: 1 }))).toBe('unavailable');
    const grading = new HttpAiBackend('/ai/', fakeFetch(() => json(200, { mark: 3, feedback: 'x' })).fetcher);
    expect(await codeOf(grading.gradeAnswer({ question: 'q', points: ['a', 'b'], answer: 'a', slides: SLIDES }))).toBe('unavailable');
    const empty = new HttpAiBackend('/ai/', fakeFetch(() => json(200, { text: '  ' })).fetcher);
    expect(await codeOf(empty.ask({ question: 'q', slides: SLIDES }))).toBe('unavailable');
  });
});

describe('FakeAiBackend', () => {
  it('makes valid questions from the slides, records calls, and can fail on demand', async () => {
    const fake = new FakeAiBackend();
    const questions = await fake.makeQuestions({ pages: SLIDES, count: 3 });
    expect(checkQuestions({ questions }, [21, 22], 3)).toHaveLength(3); // passes the real checks
    expect((await fake.gradeAnswer({ question: 'q', points: ['share', 'pair'], answer: 'They share a pair.', slides: SLIDES })).mark).toBe(2);
    expect(fake.calls.map((c) => c.job)).toEqual(['makeQuestions', 'gradeAnswer']);
    fake.failWith = 'limit';
    expect(await codeOf(fake.explain({ selection: 'x', slides: SLIDES }))).toBe('limit');
  });
});

describe('exam style (#121)', () => {
  const pages = [21, 22];
  const short = (over: Record<string, unknown> = {}) => ({ form: 'short', level: 3, question: 'Why do atoms bond?', points: ['to be stable'], page: 22, explanation: 'To be stable.', ...over });
  const mix = { choice: [1, 1, 0] as [number, number, number], short: 1 };
  const GUIDE = { tests: 'Bonding, mostly explained.', levels: ['Name it.', 'Apply it.', 'Explain it.'] as [string, string, string], shortShare: 0.5 };

  it('questions keep their level (none: 2); short ones only as many as the mix asked for, level 3, 1 to 3 points', () => {
    const reply = {
      questions: [
        { ...good(21, 'Level one?'), level: 1 },
        { ...good(21, 'No level?'), level: undefined },
        { ...good(21, 'Level four?'), level: 4 },
        short({ level: 2 }),
        short({ question: 'Four points?', points: ['a', 'b', 'c', 'd'] }),
        short({ question: 'An empty point?', points: [' '] }),
        short({ question: 'A second short one?' }),
      ],
    };
    const made = checkQuestions(reply, pages, 10, mix);
    expect(made.map((q) => [q.question, q.form, q.level])).toEqual([
      ['Level one?', 'choice', 1],
      ['No level?', 'choice', 2],
      ['Why do atoms bond?', 'short', 3], // level 3 whatever the reply said
    ]);
    expect(made[2]).toEqual({ form: 'short', level: 3, question: 'Why do atoms bond?', points: ['to be stable'], page: 22, explanation: 'To be stable.' });
    expect(checkQuestions({ questions: [short(), good()] }, pages, 10).map((q) => q.form)).toEqual(['choice']); // no mix: no short ones
  });

  it('makeQuestions sends the guide and the mix, and checks the reply against the mix', async () => {
    const { seen, fetcher } = fakeFetch(() => json(200, { questions: [short(), short({ question: 'Extra?' }), good()] }));
    const made = await new HttpAiBackend('/ai/', fetcher).makeQuestions({ pages: SLIDES, count: 2, guide: GUIDE, mix: { choice: [1, 0, 0], short: 1 } });
    expect(made.map((q) => q.form)).toEqual(['short', 'choice']);
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ guide: GUIDE, mix: { choice: [1, 0, 0], short: 1 } });
  });

  const items = [
    { question: 'What is a covalent bond?', points: ['share', 'pair'], answer: 'They share.', page: 21 },
    { question: 'What is an ionic bond?', points: ['transfer'], answer: '', page: 22 },
  ];

  it('gradeMany posts to /ai/grade-many and gives one grade per answer, out of its points', async () => {
    const { seen, fetcher } = fakeFetch(() => json(200, { marks: [{ mark: 1, feedback: 'Half.' }, { mark: 0, feedback: 'Blank.' }] }));
    expect(await new HttpAiBackend('/ai/', fetcher).gradeMany({ slides: SLIDES, items })).toEqual([
      { mark: 1, outOf: 2, feedback: 'Half.' },
      { mark: 0, outOf: 1, feedback: 'Blank.' },
    ]);
    expect(seen.map((s) => s.url)).toEqual(['/ai/grade-many']);
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ slides: SLIDES, items });
  });

  it('gradeMany is all or nothing: one mark too many, too few, out of range or without feedback, and none are used', () => {
    const ok = { mark: 1, feedback: 'x' };
    expect(checkGradeMany({ marks: [ok, { mark: 1, feedback: 'y' }] }, [2, 1])).toHaveLength(2);
    for (const marks of [[ok], [ok, ok, ok], [ok, { mark: 2, feedback: 'x' }], [ok, { mark: 0.5, feedback: 'x' }], [ok, { mark: 0, feedback: ' ' }]]) {
      expect(() => checkGradeMany({ marks }, [2, 1]), JSON.stringify(marks)).toThrow(AiError);
    }
    expect(() => checkGradeMany({}, [1])).toThrow(AiError);
  });

  const request = { className: 'CHEM 101', notes: 'No proofs.', materials: [{ kind: 'past-exam' as const, title: 'Midterm', text: 'Q1' }], lectures: [], previous: null };

  it('makeStyleGuide posts to /ai/style and checks the guide', async () => {
    const { seen, fetcher } = fakeFetch(() => json(200, { tests: ' Bonding. ', levels: ['a', 'b', 'c'], shortShare: 0.25 }));
    expect(await new HttpAiBackend('/ai/', fetcher).makeStyleGuide(request)).toEqual({ tests: 'Bonding.', levels: ['a', 'b', 'c'], shortShare: 0.25 });
    expect(seen.map((s) => s.url)).toEqual(['/ai/style']);
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual(request);
  });

  it('a guide without its description, three levels, or a share from 0 to 1 is unusable', () => {
    const guide = { tests: 'T', levels: ['a', 'b', 'c'], shortShare: 0.5 };
    expect(checkStyle(guide)).toEqual(guide);
    for (const bad of [
      { ...guide, tests: ' ' },
      { ...guide, levels: ['a', 'b'] },
      { ...guide, levels: ['a', '', 'c'] },
      { ...guide, shortShare: -0.1 },
      { ...guide, shortShare: 1.1 },
      { ...guide, shortShare: '0.5' },
      { ...guide, shortShare: Number.NaN },
    ]) {
      expect(() => checkStyle(bad), JSON.stringify(bad)).toThrow(AiError);
    }
  });

  it('the fake follows the mix, passes the real checks, marks many, and writes a guide', async () => {
    const fake = new FakeAiBackend();
    const made = await fake.makeQuestions({ pages: SLIDES, count: 4, mix: { choice: [1, 1, 1], short: 1 } });
    expect(made.map((q) => [q.form, q.level])).toEqual([
      ['choice', 1],
      ['choice', 2],
      ['choice', 3],
      ['short', 3],
    ]);
    expect(checkQuestions({ questions: made }, pages, 4, { choice: [1, 1, 1], short: 1 })).toHaveLength(4);
    expect((await fake.gradeMany({ slides: SLIDES, items })).map((g) => g.mark)).toEqual([1, 0]);
    expect(checkStyle(await fake.makeStyleGuide(request))).toBeTruthy();
    expect(fake.calls.map((c) => c.job)).toEqual(['makeQuestions', 'gradeMany', 'makeStyleGuide']);
  });
});
