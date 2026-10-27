// audio/live_segmenter.rs
//
// Live-path segmentation: decides when a speech segment is final, and when the
// still-open segment should be re-transcribed as an interim caption.
//
// A fixed redemption time forces a bad trade. Short (the old 500ms live policy)
// splits every breath into its own 2-4s request, which whisper decodes with no
// context and fills from its subtitle prior. Long (the 2000ms batch policy) never
// closes a segment under continuous speech (#756). Here the redemption time
// shrinks as the open segment grows: an utterance waits for a real pause while
// it is short, then gets cut at the next small pause once it is long enough to
// carry its own context, and at any pause at all once it nears the hard cap.
//
// Interim captions make the long first stage free: the open segment is shown
// while it is being spoken, so the final result can afford to wait for a pause.

use super::vad::{ContinuousVadProcessor, SpeechSegment};
use anyhow::Result;

#[derive(Debug, Clone)]
pub struct LiveSegmenterConfig {
    /// Silence that closes a segment shorter than `soft_max_ms`.
    pub base_redemption_ms: u32,
    /// Open-segment length after which `soft_redemption_ms` applies.
    pub soft_max_ms: f64,
    pub soft_redemption_ms: u32,
    /// Open-segment length after which `hard_redemption_ms` applies.
    pub hard_max_ms: f64,
    pub hard_redemption_ms: u32,
    /// Minimum new audio between interim snapshots of the open segment.
    pub interim_interval_ms: f64,
    /// Open segments shorter than this get no interim caption.
    pub interim_min_ms: f64,
    /// Interim snapshots keep only this much trailing audio, bounding their cost.
    pub interim_max_ms: f64,
}

/// Floor for every redemption time. Silero pads a segment's start 300ms back into
/// audio before the speech; that audio is still buffered only if the previous
/// segment closed on at least as much silence. Below this, the pad reaches into
/// audio already handed to the previous segment and silero panics.
pub const MIN_REDEMPTION_MS: u32 = 330;

impl Default for LiveSegmenterConfig {
    fn default() -> Self {
        Self {
            base_redemption_ms: 900,
            soft_max_ms: 8_000.0,
            soft_redemption_ms: 400,
            hard_max_ms: 20_000.0,
            hard_redemption_ms: MIN_REDEMPTION_MS,
            // Measured on AMI ES2004a: 1s/10s costs 39% of real time against 55%
            // for 0.5s/20s, at the same final WER and lower word delay (less
            // queueing behind interims).
            interim_interval_ms: 1_000.0,
            interim_min_ms: 600.0,
            interim_max_ms: 10_000.0,
        }
    }
}

/// Snapshot of the open segment, for an interim caption.
#[derive(Debug, Clone)]
pub struct InterimSnapshot {
    pub samples: Vec<f32>,
    /// Session-absolute start of the open segment. Shared with the final segment
    /// that later closes it, so the UI can match an interim to its final.
    pub segment_start_ms: f64,
    /// Session-absolute end of the audio in `samples`.
    pub end_ms: f64,
}

pub struct LiveSegmenter {
    vad: ContinuousVadProcessor,
    config: LiveSegmenterConfig,
    redemption_ms: u32,
    last_interim_end_ms: Option<f64>,
}

impl LiveSegmenter {
    pub fn new(input_sample_rate: u32, config: LiveSegmenterConfig) -> Result<Self> {
        let vad = ContinuousVadProcessor::new(input_sample_rate, config.base_redemption_ms)?;
        Ok(Self {
            vad,
            redemption_ms: config.base_redemption_ms,
            config,
            last_interim_end_ms: None,
        })
    }

    /// Feed audio; returns segments that became final.
    pub fn process_audio(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        let segments = self.vad.process_audio(samples)?;
        if !segments.is_empty() {
            self.last_interim_end_ms = None;
        }
        self.adapt_redemption();
        Ok(segments)
    }

    pub fn flush(&mut self) -> Result<Vec<SpeechSegment>> {
        self.last_interim_end_ms = None;
        self.vad.flush()
    }

    /// Returns a snapshot of the open segment when enough new audio has arrived
    /// since the previous one.
    pub fn take_interim(&mut self) -> Option<InterimSnapshot> {
        let (samples, start_ms) = self.vad.active_speech()?;
        let open_ms = samples.len() as f64 / 16.0;
        if open_ms < self.config.interim_min_ms {
            return None;
        }
        let end_ms = start_ms + open_ms;
        if let Some(last) = self.last_interim_end_ms {
            if end_ms - last < self.config.interim_interval_ms {
                return None;
            }
        }
        self.last_interim_end_ms = Some(end_ms);

        let keep = (self.config.interim_max_ms * 16.0) as usize;
        let tail = &samples[samples.len().saturating_sub(keep)..];
        Some(InterimSnapshot {
            samples: tail.to_vec(),
            segment_start_ms: start_ms,
            end_ms,
        })
    }

    pub fn processed_ms(&self) -> f64 {
        self.vad.processed_ms()
    }

    fn adapt_redemption(&mut self) {
        let open_ms = self
            .vad
            .active_speech()
            .map(|(samples, _)| samples.len() as f64 / 16.0)
            .unwrap_or(0.0);
        let target = if open_ms >= self.config.hard_max_ms {
            self.config.hard_redemption_ms
        } else if open_ms >= self.config.soft_max_ms {
            self.config.soft_redemption_ms
        } else {
            self.config.base_redemption_ms
        };
        let target = target.max(MIN_REDEMPTION_MS);
        if target != self.redemption_ms {
            self.vad.set_redemption_time_ms(target);
            self.redemption_ms = target;
        }
    }
}
