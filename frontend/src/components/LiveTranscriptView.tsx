'use client';

import { RefObject, useEffect, useMemo, useState } from 'react';
import { InterimUpdate, Transcript } from '@/types';
import { TranscriptTextSize } from '@/hooks/useTranscriptViewPrefs';
import { RecordingStatusBar } from './RecordingStatusBar';
import { cleanStopWords } from './VirtualizedTranscriptView';

// A pause longer than this starts a new paragraph.
const PARAGRAPH_GAP_S = 3;
// Past this many words a paragraph ends at the next sentence end...
const PARAGRAPH_SOFT_WORDS = 60;
// ...and past this many it ends regardless.
const PARAGRAPH_HARD_WORDS = 120;
// Captions show at most this many trailing words; the box clips to its lines.
const CAPTION_WORDS = 60;
const CAPTION_LINES = 3;

interface Paragraph {
  key: string;
  start: number;
  confirmed: string;
  unconfirmed?: string;
}

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Groups final segments into paragraphs and appends the interim caption to the last one. */
function buildParagraphs(transcripts: Transcript[], interim: InterimUpdate | null): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let words = 0;
  let lastEnd = -Infinity;

  const startsNewParagraph = (start: number) => {
    const last = paragraphs[paragraphs.length - 1];
    if (!last) return true;
    if (start - lastEnd > PARAGRAPH_GAP_S) return true;
    if (words >= PARAGRAPH_HARD_WORDS) return true;
    return words >= PARAGRAPH_SOFT_WORDS && /[.?!]$/.test(last.confirmed);
  };

  for (const t of transcripts) {
    const text = cleanStopWords(t.text);
    if (!text) continue;
    const start = t.audio_start_time ?? lastEnd;
    if (startsNewParagraph(start)) {
      paragraphs.push({ key: t.id, start, confirmed: text });
      words = countWords(text);
    } else {
      const last = paragraphs[paragraphs.length - 1];
      last.confirmed = `${last.confirmed} ${text}`;
      words += countWords(text);
    }
    lastEnd = t.audio_end_time ?? start;
  }

  const pending = interim ? cleanStopWords(interim.text) : '';
  if (interim && pending) {
    if (startsNewParagraph(interim.segment_start_time)) {
      paragraphs.push({ key: 'interim', start: interim.segment_start_time, confirmed: '', unconfirmed: pending });
    } else {
      paragraphs[paragraphs.length - 1].unconfirmed = pending;
    }
  }
  return paragraphs;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const FLOW_TEXT: Record<TranscriptTextSize, string> = {
  sm: 'text-sm leading-6',
  md: 'text-base leading-7',
  lg: 'text-lg leading-8',
  xl: 'text-2xl leading-10',
};

// Line height in rem per size; the caption box is exactly CAPTION_LINES lines tall.
const CAPTION_TEXT: Record<TranscriptTextSize, { className: string; lineRem: number }> = {
  sm: { className: 'text-xl', lineRem: 2 },
  md: { className: 'text-2xl', lineRem: 2.5 },
  lg: { className: 'text-3xl', lineRem: 3 },
  xl: { className: 'text-4xl', lineRem: 3.5 },
};

export interface LiveTranscriptViewProps {
  transcripts: Transcript[];
  interim: InterimUpdate | null;
  layout: 'flow' | 'captions';
  textSize: TranscriptTextSize;
  dimUnconfirmed: boolean;
  isRecording: boolean;
  isPaused: boolean;
  /** The scrolling ancestor; followed to the bottom while the user is there */
  scrollContainerRef: RefObject<HTMLDivElement>;
}

export function LiveTranscriptView({
  transcripts,
  interim,
  layout,
  textSize,
  dimUnconfirmed,
  isRecording,
  isPaused,
  scrollContainerRef,
}: LiveTranscriptViewProps) {
  const paragraphs = useMemo(() => buildParagraphs(transcripts, interim), [transcripts, interim]);
  const [atBottom, setAtBottom] = useState(true);

  // Captions read from a fixed box; outside a recording there is nothing live to follow.
  const showCaptions = layout === 'captions' && isRecording;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollContainerRef]);

  // Follow new words only while the reader is already at the bottom.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el && atBottom && !showCaptions) {
      el.scrollTop = el.scrollHeight;
    }
  }, [paragraphs, atBottom, showCaptions, scrollContainerRef]);

  const jumpToLive = () => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const unconfirmedClass = dimUnconfirmed ? 'text-gray-400' : '';

  const statusBar = isRecording && (
    <div className="sticky top-0 z-10 bg-white pb-2">
      <RecordingStatusBar isPaused={isPaused} />
    </div>
  );

  if (paragraphs.length === 0) {
    return (
      <div className="px-4 py-2">
        {statusBar}
        <p className="text-center text-sm text-gray-500 mt-8">
          {!isRecording
            ? 'Start recording to see live transcription'
            : isPaused
              ? 'Recording paused. Resume to continue the transcript.'
              : 'Listening. Text appears here as soon as someone speaks.'}
        </p>
      </div>
    );
  }

  if (showCaptions) {
    const { className, lineRem } = CAPTION_TEXT[textSize];
    const last = paragraphs[paragraphs.length - 1];
    const confirmedWords = last.confirmed.split(/\s+/).filter(Boolean);
    const unconfirmedWords = (last.unconfirmed ?? '').split(/\s+/).filter(Boolean);
    const keepUnconfirmed = unconfirmedWords.slice(-CAPTION_WORDS);
    const keepConfirmed = confirmedWords.slice(-(CAPTION_WORDS - keepUnconfirmed.length));

    return (
      <div className="px-4 py-2">
        {statusBar}
        <div className="flex min-h-[55vh] items-center">
          <div
            className={`w-full overflow-hidden flex flex-col justify-end text-gray-900 ${className}`}
            style={{ height: `${lineRem * CAPTION_LINES}rem`, lineHeight: `${lineRem}rem` }}
            aria-live="polite"
          >
            <p>
              {keepConfirmed.join(' ')}
              {keepUnconfirmed.length > 0 && (
                <span className={unconfirmedClass}>{keepConfirmed.length > 0 ? ' ' : ''}{keepUnconfirmed.join(' ')}</span>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-2">
      {statusBar}
      <div className={`text-gray-900 ${FLOW_TEXT[textSize]}`}>
        {paragraphs.map(p => (
          <div key={p.key} className="grid grid-cols-[3.25rem_1fr] gap-x-2 mb-4">
            <span className="text-xs text-gray-400 pt-1 tabular-nums">{formatTime(p.start)}</span>
            <p>
              {p.confirmed}
              {p.unconfirmed && (
                <span className={unconfirmedClass}>{p.confirmed ? ' ' : ''}{p.unconfirmed}</span>
              )}
            </p>
          </div>
        ))}
      </div>

      {isRecording && !atBottom && (
        <div className="sticky bottom-4 flex justify-center">
          <button
            type="button"
            onClick={jumpToLive}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Back to live
          </button>
        </div>
      )}
    </div>
  );
}
