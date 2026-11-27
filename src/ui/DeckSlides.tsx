// A deck's slides with its notes and highlights (#56): the viewer (src/viewer/AnnotatedViewer.tsx)
// joined to the store and the AI. Used wherever slides are studied: the Slides screen and a study
// session (Play). Annotations belong to the deck's pages, so the same ones show in both.
import { useCallback, useEffect, useMemo } from 'react';
import { prepareAi } from '../reading/explain';
import type { AnnotationChange, AnnotationInput } from '../types/annotation';
import { AnnotatedViewer, type ViewerNotes } from '../viewer/AnnotatedViewer';
import type { SlideRange } from '../viewer/SlideViewer';
import { useAi } from './ai-context';
import { useStore } from './store-context';
import { useLoad } from './useLoad';

export function DeckSlides({
  deckId,
  pdf,
  page,
  range,
  onPageChange,
}: {
  deckId: string;
  pdf: Uint8Array;
  page?: number;
  range?: SlideRange;
  onPageChange?: (page: number) => void;
}) {
  const store = useStore();
  const ai = useAi();
  const { data: list, reload } = useLoad(() => store.listAnnotations(deckId), [store, deckId]);
  // The slides' text, for Explain and Ask; the viewer works without it (they're just not offered)
  const { data: pageTexts } = useLoad(() => store.getSlideDeckPages(deckId).catch(() => [] as string[]), [store, deckId]);

  const after = useCallback(
    async <T,>(action: Promise<T>) => {
      const result = await action;
      await reload();
      return result;
    },
    [reload],
  );

  const notes: ViewerNotes = useMemo(
    () => ({
      list: list ?? [],
      add: (input: Omit<AnnotationInput, 'deckId'>) => after(store.addAnnotation({ ...input, deckId })),
      update: (id: string, change: AnnotationChange) => after(store.updateAnnotation(id, change)),
      remove: (id: string) => after(store.deleteAnnotation(id)),
    }),
    [list, after, store, deckId],
  );

  // Explain and Ask send the slides with what the AI read on their pictures, and a box's picture (#175)
  const prepare = useMemo(() => (pageTexts ? prepareAi({ store, ai, deckId, pdf, pageTexts }) : undefined), [store, ai, deckId, pdf, pageTexts]);
  useEffect(() => () => void prepare?.close(), [prepare]);

  return <AnnotatedViewer pdf={pdf} page={page} range={range} onPageChange={onPageChange} notes={notes} ai={ai} pageTexts={pageTexts ?? undefined} prepare={prepare} />;
}
