'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface Anchor {
  text: string;
  top: number;
  left: number;
}

interface SelectionCorrectionProps {
  children: ReactNode;
  /** Called with the selected text and its corrected form; returns places fixed */
  onCorrect: (selected: string, corrected: string) => number;
}

// Selections longer than this are reading, not correcting.
const MAX_SELECTION_CHARS = 120;

/**
 * Select words in the transcript to correct them. The fix applies to what is
 * already shown and, through the glossary, to what is transcribed next.
 */
export function SelectionCorrection({ children, onCorrect }: SelectionCorrectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onMouseUp = () => {
      if (editing) return;
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? '';
      const container = containerRef.current;
      if (!selection || !text || text.length > MAX_SELECTION_CHARS || !container
        || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) {
        setAnchor(null);
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setAnchor({ text, top: rect.top - 8, left: rect.left + rect.width / 2 });
      setValue(text);
      setNote(null);
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [editing]);

  const close = () => {
    setAnchor(null);
    setEditing(false);
  };

  const submit = () => {
    const corrected = value.trim();
    if (!anchor || !corrected || corrected === anchor.text) {
      close();
      return;
    }
    const fixed = onCorrect(anchor.text, corrected);
    window.getSelection()?.removeAllRanges();
    setEditing(false);
    setNote(fixed > 0
      ? `Fixed ${fixed} ${fixed === 1 ? 'place' : 'places'}. New text will use "${corrected}".`
      : `New text will use "${corrected}".`);
    setTimeout(() => setAnchor(null), 2500);
  };

  return (
    <div ref={containerRef}>
      {children}
      {anchor && (
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-gray-200 bg-white p-2 shadow-md"
          style={{ top: anchor.top, left: anchor.left }}
          onMouseUp={e => e.stopPropagation()}
        >
          {note ? (
            <p className="max-w-xs text-xs text-gray-700">{note}</p>
          ) : editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={e => {
                e.preventDefault();
                submit();
              }}
            >
              <Input
                autoFocus
                aria-label="Correct text"
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && close()}
                className="h-8 w-64"
              />
              <Button type="submit" size="sm">Fix</Button>
            </form>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              Correct
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
