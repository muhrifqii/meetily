import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { LiveTranscriptView } from '@/components/LiveTranscriptView';
import { TranscriptViewMenu } from '@/components/TranscriptViewMenu';
import { useTranscriptViewPrefs } from '@/hooks/useTranscriptViewPrefs';
import { useTranscriptionHints } from '@/hooks/useTranscriptionHints';
import { GlossaryDialog } from '@/components/GlossaryDialog';
import { SelectionCorrection } from '@/components/SelectionCorrection';
import { deriveCorrection, isCommonPhrase } from '@/lib/corrections';
import { PermissionWarning } from '@/components/PermissionWarning';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, GlobeIcon } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useMemo } from 'react';

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, interim, applyCorrection, transcriptContainerRef, copyTranscript } = useTranscripts();
  const { hints, setTerms, addCorrection, removeCorrection } = useTranscriptionHints();

  // A fix rewrites what is shown and teaches the next segments: the corrected
  // phrase joins the glossary, the narrowed rule joins the corrections. A fix
  // made only of everyday words ("the end") stays a one-off on the latest
  // occurrence, since as a rule it would rewrite ordinary speech everywhere.
  const correct = (selected: string, corrected: string) => {
    const rule = deriveCorrection(selected, corrected);
    if (isCommonPhrase(rule.from)) {
      return applyCorrection(selected.trim(), corrected.trim(), true);
    }
    addCorrection(rule, corrected);
    return applyCorrection(rule.from, rule.to);
  };
  const { transcriptModelConfig } = useConfig();
  const { isRecording, isPaused } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    })),
    [transcripts]
  );

  const { prefs: viewPrefs, updatePrefs: updateViewPrefs } = useTranscriptViewPrefs();
  // Before the first recording the original view carries the welcome screen.
  const useLiveView = viewPrefs.layout !== 'segments' && (isRecording || transcripts.length > 0);

  return (
    <div ref={transcriptContainerRef} className="w-full border-r border-gray-200 bg-white flex flex-col overflow-y-auto">
      {/* Title area - Sticky header */}
      <div className="sticky top-0 z-10 bg-white p-4 border-gray-200">
        <div className="flex flex-col space-y-3">
          <div className="flex  flex-col space-y-2">
            <div className="flex justify-center  items-center space-x-2">
              <ButtonGroup>
                {transcripts?.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyTranscript}
                    title="Copy Transcript"
                  >
                    <Copy />
                    <span className='hidden md:inline'>
                      Copy
                    </span>
                  </Button>
                )}
                {transcriptModelConfig.provider === "localWhisper" &&
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showModal('languageSettings')}
                    title="Language"
                  >
                    <GlobeIcon />
                    <span className='hidden md:inline'>
                      Language
                    </span>
                  </Button>
                }
                <TranscriptViewMenu prefs={viewPrefs} onChange={updateViewPrefs} />
                <GlossaryDialog hints={hints} onSaveTerms={setTerms} onRemoveCorrection={removeCorrection} />
              </ButtonGroup>
            </div>
          </div>
        </div>
      </div>

      {/* Permission Warning - Not needed on Linux */}
      {!isRecording && !isChecking && !isLinux && (
        <div className="flex justify-center px-4 pt-4">
          <PermissionWarning
            hasMicrophone={hasMicrophone}
            hasSystemAudio={hasSystemAudio}
            onRecheck={checkPermissions}
            isRechecking={isChecking}
          />
        </div>
      )}

      {/* Transcript content */}
      <SelectionCorrection onCorrect={correct}>
      <div className="pb-20">
        <div className="flex justify-center">
          <div className="w-2/3 max-w-[750px]">
            {useLiveView ? (
              <LiveTranscriptView
                transcripts={transcripts}
                interim={isRecording ? interim : null}
                layout={viewPrefs.layout === 'captions' ? 'captions' : 'flow'}
                textSize={viewPrefs.textSize}
                dimUnconfirmed={viewPrefs.dimUnconfirmed}
                isRecording={isRecording}
                isPaused={isPaused}
                scrollContainerRef={transcriptContainerRef}
              />
            ) : (
              <VirtualizedTranscriptView
                segments={segments}
                isRecording={isRecording}
                isPaused={isPaused}
                isProcessing={isProcessingStop}
                isStopping={isStopping}
                // Interim captions already show text as it is spoken; a typewriter
                // reveal of the final would only delay it.
                enableStreaming={false}
                interimText={isRecording ? interim?.text : undefined}
                showConfidence={true}
              />
            )}
          </div>
        </div>
      </div>
      </SelectionCorrection>
    </div>
  );
}
