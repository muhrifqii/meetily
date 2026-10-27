import { Type } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  TranscriptLayout,
  TranscriptTextSize,
  TranscriptViewPrefs,
} from '@/hooks/useTranscriptViewPrefs';

const LAYOUTS: { value: TranscriptLayout; label: string; hint: string }[] = [
  { value: 'flow', label: 'Flow', hint: 'Paragraphs that grow in place, like Chrome captions' },
  { value: 'captions', label: 'Captions', hint: 'Large text, last lines only, fixed position' },
  { value: 'segments', label: 'Segments', hint: 'One row per segment with its time' },
];

const SIZES: { value: TranscriptTextSize; label: string; name: string }[] = [
  { value: 'sm', label: 'S', name: 'Small' },
  { value: 'md', label: 'M', name: 'Medium' },
  { value: 'lg', label: 'L', name: 'Large' },
  { value: 'xl', label: 'XL', name: 'Extra large' },
];

interface TranscriptViewMenuProps {
  prefs: TranscriptViewPrefs;
  onChange: (change: Partial<TranscriptViewPrefs>) => void;
}

function Option({ selected, onClick, children, title }: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? 'default' : 'outline'}
      aria-pressed={selected}
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function TranscriptViewMenu({ prefs, onChange }: TranscriptViewMenuProps) {
  const layoutHint = LAYOUTS.find(l => l.value === prefs.layout)?.hint;
  const sizeApplies = prefs.layout !== 'segments';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" title="Transcript view">
          <Type />
          <span className='hidden md:inline'>View</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">Layout</p>
          <div className="flex gap-2" role="group" aria-label="Layout">
            {LAYOUTS.map(l => (
              <Option key={l.value} selected={prefs.layout === l.value} onClick={() => onChange({ layout: l.value })}>
                {l.label}
              </Option>
            ))}
          </div>
          <p className="text-xs text-gray-500">{layoutHint}</p>
        </div>

        <div className="space-y-2">
          <p className={`text-sm font-medium ${sizeApplies ? 'text-gray-900' : 'text-gray-400'}`}>Text size</p>
          <div className="flex gap-2" role="group" aria-label="Text size">
            {SIZES.map(s => (
              <Option
                key={s.value}
                title={s.name}
                selected={prefs.textSize === s.value}
                onClick={() => onChange({ textSize: s.value })}
              >
                {s.label}
              </Option>
            ))}
          </div>
          {!sizeApplies && <p className="text-xs text-gray-500">Applies to Flow and Captions.</p>}
        </div>

        <div className="space-y-2">
          <p className={`text-sm font-medium ${sizeApplies ? 'text-gray-900' : 'text-gray-400'}`}>Words still being heard</p>
          <div className="flex gap-2" role="group" aria-label="Words still being heard">
            <Option selected={!prefs.dimUnconfirmed} onClick={() => onChange({ dimUnconfirmed: false })}>
              Same color
            </Option>
            <Option selected={prefs.dimUnconfirmed} onClick={() => onChange({ dimUnconfirmed: true })}>
              Lighter
            </Option>
          </div>
          <p className="text-xs text-gray-500">
            The last words can still change for about a second before they are confirmed.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
