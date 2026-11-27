// Which ticks on Tasks are new (#153): done since the page was last shown, so they draw themselves in. Kept in
// memory for this session only (nothing stored). The first look of a study day seeds it, since there's nothing
// to compare with: after the app opens, or at the day's start, every tick just shows.

export class TickMemory {
  private day: string | null = null;
  private seen = new Set<string>();

  /** The ids in `done` not seen before today (none on the day's first look); all of them count as seen after. */
  fresh(day: string, done: readonly string[]): ReadonlySet<string> {
    const first = this.day !== day;
    if (first) {
      this.day = day;
      this.seen = new Set();
    }
    const fresh = first ? new Set<string>() : new Set(done.filter((id) => !this.seen.has(id)));
    for (const id of done) this.seen.add(id);
    return fresh;
  }
}

/** The one the Tasks page uses, for as long as the page (the app) stays open. */
export const tickMemory = new TickMemory();
