'use client';

import { useState } from 'react';
import { BookText, X } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { TranscriptionHints } from '@/hooks/useTranscriptionHints';

interface GlossaryDialogProps {
  hints: TranscriptionHints;
  onSaveTerms: (terms: string[], usePrompt: boolean) => void;
  onRemoveCorrection: (from: string) => void;
}

/** Names and terms to spell right, and the corrections learned from fixes in the transcript. */
export function GlossaryDialog({ hints, onSaveTerms, onRemoveCorrection }: GlossaryDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [usePrompt, setUsePrompt] = useState(false);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(hints.terms.join('\n'));
      setUsePrompt(hints.usePrompt);
    }
    setOpen(next);
  };

  const save = () => {
    onSaveTerms(draft.split('\n').map(t => t.trim()).filter(Boolean), usePrompt);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Glossary">
          <BookText />
          <span className='hidden md:inline'>Glossary</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Glossary</DialogTitle>
          <DialogDescription>
            Corrections you make in the live transcript are applied to every new sentence, in this and future meetings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Textarea
            aria-label="Glossary terms, one per line"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={'Names and terms, one per line'}
            rows={7}
          />
          <div className="flex items-start justify-between gap-4 pt-1">
            <div>
              <p className="text-sm text-gray-900">Use these terms as hints for the AI</p>
              <p className="text-xs text-gray-500">
                Experimental. Fixes how names and terms are spelled, but in testing it also made some sentences go missing.
              </p>
            </div>
            <Switch checked={usePrompt} onCheckedChange={setUsePrompt} aria-label="Use glossary terms as hints for the AI" />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">Corrections</p>
          {hints.corrections.length === 0 ? (
            <p className="text-xs text-gray-500">
              None yet. Select wrong words in the live transcript and choose Correct to add one.
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {hints.corrections.map(c => (
                <li key={c.from} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    <span className="text-gray-500">{c.from}</span>
                    <span className="mx-2 text-gray-400">to</span>
                    <span className="text-gray-900">{c.to}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove correction ${c.from}`}
                    onClick={() => onRemoveCorrection(c.from)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
