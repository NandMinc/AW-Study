import { describe, expect, it } from 'vitest';
import { TickMemory } from './tick-memory';

describe('TickMemory (#153)', () => {
  it('nothing is new on the first look; after it, only what became done since', () => {
    const memory = new TickMemory();
    expect([...memory.fresh('2026-11-18', ['a'])]).toEqual([]);
    expect([...memory.fresh('2026-11-18', ['a', 'b'])]).toEqual(['b']);
    expect([...memory.fresh('2026-11-18', ['a', 'b'])]).toEqual([]); // seen now
    expect([...memory.fresh('2026-11-18', ['a', 'b', 'c', 'd'])]).toEqual(['c', 'd']);
  });

  it('a new study day starts again: its first look is nothing new', () => {
    const memory = new TickMemory();
    memory.fresh('2026-11-18', []);
    expect([...memory.fresh('2026-11-19', ['a'])]).toEqual([]);
    expect([...memory.fresh('2026-11-19', ['a', 'b'])]).toEqual(['b']);
  });

  it('what was seen yesterday is new again today: the same lecture quizzed again', () => {
    const memory = new TickMemory();
    memory.fresh('2026-11-18', []);
    memory.fresh('2026-11-18', ['quiz-s1']);
    memory.fresh('2026-11-19', []);
    expect([...memory.fresh('2026-11-19', ['quiz-s1'])]).toEqual(['quiz-s1']);
  });

  it('an empty first look still counts: what is done next is new', () => {
    const memory = new TickMemory();
    memory.fresh('2026-11-18', []);
    expect([...memory.fresh('2026-11-18', ['a'])]).toEqual(['a']);
  });
});
