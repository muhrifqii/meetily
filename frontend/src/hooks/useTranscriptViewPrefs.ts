import { useCallback, useState } from 'react';

/**
 * How the live transcript is laid out while recording.
 * - flow: paragraphs that grow in place; unconfirmed words are replaced where they stand
 * - captions: large text, only the last few lines, at a fixed position
 * - segments: one row per transcribed segment with its timestamp (the original view)
 */
export type TranscriptLayout = 'flow' | 'captions' | 'segments';
export type TranscriptTextSize = 'sm' | 'md' | 'lg' | 'xl';

export interface TranscriptViewPrefs {
  layout: TranscriptLayout;
  textSize: TranscriptTextSize;
  /** Show words that may still change in a lighter shade */
  dimUnconfirmed: boolean;
}

const STORAGE_KEY = 'transcriptViewPrefs';

export const DEFAULT_TRANSCRIPT_VIEW_PREFS: TranscriptViewPrefs = {
  layout: 'flow',
  textSize: 'md',
  dimUnconfirmed: false,
};

function load(): TranscriptViewPrefs {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_TRANSCRIPT_VIEW_PREFS, ...JSON.parse(saved) };
    }
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return DEFAULT_TRANSCRIPT_VIEW_PREFS;
}

export function useTranscriptViewPrefs() {
  const [prefs, setPrefs] = useState<TranscriptViewPrefs>(load);

  const updatePrefs = useCallback((change: Partial<TranscriptViewPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...change };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Preference still applies for this session.
      }
      return next;
    });
  }, []);

  return { prefs, updatePrefs };
}
