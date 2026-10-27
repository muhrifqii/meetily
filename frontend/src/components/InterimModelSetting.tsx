import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { useConfig } from '@/contexts/ConfigContext';

interface WhisperModelInfo {
    name: string;
    status: unknown;
}

const OPTIONS = [
    { value: 'same', label: 'Same as transcript model (best, heaviest)' },
    { value: 'small', label: 'Whisper small (lighter, slightly rougher)' },
    { value: 'base', label: 'Whisper base (lightest, often off)' },
    { value: 'off', label: 'Off (text appears after each pause)' },
];

/**
 * Chooses the model for interim captions: the grey text shown while someone is
 * still speaking. The final transcript always uses the transcript model above.
 */
export function InterimModelSetting() {
    const { interimModel, setInterimModel } = useConfig();
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        if (interimModel === 'same' || interimModel === 'off') {
            setMissing(false);
            return;
        }
        invoke<WhisperModelInfo[]>('whisper_get_available_models')
            .then(models => {
                const model = models.find(m => m.name === interimModel);
                setMissing(model?.status !== 'Available');
            })
            .catch(() => setMissing(false));
    }, [interimModel]);

    return (
        <div>
            <Label className="block text-sm font-medium text-gray-700 mb-1">
                Live caption model
            </Label>
            <div className="mx-1">
                <Select value={interimModel} onValueChange={setInterimModel}>
                    <SelectTrigger className='focus:ring-1 focus:ring-blue-500 focus:border-blue-500'>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                    Grey text shown while someone is still speaking. The saved transcript always uses the transcript model.
                </p>
                {missing && (
                    <p className="text-xs text-amber-600 mt-1">
                        Whisper {interimModel} is not downloaded yet. Download it from the Local Whisper model list; until then the transcript model is used.
                    </p>
                )}
            </div>
        </div>
    );
}
