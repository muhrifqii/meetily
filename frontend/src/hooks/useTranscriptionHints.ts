import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Correction } from '@/lib/corrections';

/**
 * Corrections (applied to every new segment) and glossary terms. Terms reach
 * Whisper as a prompt only when `usePrompt` is on: it fixes spelling of names
 * and jargon, but measurably makes Whisper skip other speech, so it is opt-in.
 * Kept across meetings.
 */
export interface TranscriptionHints {
  terms: string[];
  corrections: Correction[];
  usePrompt: boolean;
}

const STORAGE_KEY = 'transcriptionHints';
const EMPTY: TranscriptionHints = { terms: [], corrections: [], usePrompt: false };

function load(): TranscriptionHints {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...EMPTY, ...JSON.parse(saved) };
  } catch {
    // Storage unavailable or corrupt: start empty.
  }
  return EMPTY;
}

export function useTranscriptionHints() {
  const [hints, setHints] = useState<TranscriptionHints>(load);

  // Persist and push to the transcription worker on every change, and once on mount.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hints));
    } catch {
      // Hints still apply for this session.
    }
    invoke('set_transcription_hints', {
      terms: hints.terms,
      corrections: hints.corrections,
      usePrompt: hints.usePrompt,
    }).catch(err =>
      console.error('Failed to sync transcription hints:', err)
    );
  }, [hints]);

  const setTerms = useCallback((terms: string[], usePrompt: boolean) => {
    setHints(prev => ({ ...prev, terms, usePrompt }));
  }, []);

  /** Adds the corrected phrase to the glossary and the rule to the corrections. */
  const addCorrection = useCallback((correction: Correction, glossaryTerm: string) => {
    setHints(prev => {
      const sameRule = (c: Correction) => c.from.toLowerCase() === correction.from.toLowerCase();
      const hasTerm = prev.terms.some(t => t.toLowerCase() === glossaryTerm.toLowerCase());
      return {
        ...prev,
        terms: hasTerm ? prev.terms : [...prev.terms, glossaryTerm],
        corrections: [...prev.corrections.filter(c => !sameRule(c)), correction],
      };
    });
  }, []);

  const removeCorrection = useCallback((from: string) => {
    setHints(prev => ({ ...prev, corrections: prev.corrections.filter(c => c.from !== from) }));
  }, []);

  return { hints, setTerms, addCorrection, removeCorrection };
}
