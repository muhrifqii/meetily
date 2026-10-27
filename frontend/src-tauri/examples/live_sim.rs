//! Offline replay of the live transcription path, for comparing segmentation and
//! engine settings on a recording.
//!
//!   live_sim --audio rec.f32 --engine whisper|parakeet --model NAME --seg old|new \
//!            [--interim] [--context] --out hyp.txt
//!
//! `rec.f32` is 16kHz mono f32le. Audio is fed in 50ms blocks on a virtual clock:
//! a block becomes available at its audio time, and one serial worker (as in
//! worker.rs) transcribes queued finals first, then the latest interim snapshot
//! when idle. Compute time is real; arrival time is simulated, so the reported
//! delays are what a live session on this machine would see.

use app_lib::audio::vad::ContinuousVadProcessor;
// BEGIN-V2
use app_lib::audio::live_segmenter::{LiveSegmenter, LiveSegmenterConfig};
// END-V2
use app_lib::parakeet_engine::ParakeetEngine;
use app_lib::whisper_engine::WhisperEngine;
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

const BLOCK: usize = 800; // 50ms at 16kHz

enum Engine {
    Whisper(WhisperEngine),
    Parakeet(ParakeetEngine),
}

impl Engine {
    async fn transcribe(&self, audio: Vec<f32>, prompt: Option<&str>, fast: bool) -> String {
        let _ = (prompt, fast);
        let text = match self {
            // BEGIN-V2
            Engine::Whisper(w) if V2 && ECHO_GUARD.load(std::sync::atomic::Ordering::Relaxed) => w
                .transcribe_with_glossary(audio, Some("en".into()), prompt, fast)
                .await
                .map(|r| r.0),
            Engine::Whisper(w) if V2 => w
                .transcribe_live(audio, Some("en".into()), prompt, fast)
                .await
                .map(|r| r.0),
            // END-V2
            Engine::Whisper(w) => w
                .transcribe_audio_with_confidence(audio, Some("en".into()))
                .await
                .map(|r| r.0),
            Engine::Parakeet(p) => p.transcribe_audio(audio).await,
        };
        text.unwrap_or_else(|e| {
            eprintln!("transcription failed: {e}");
            String::new()
        })
        .trim()
        .to_string()
    }
}

// BEGIN-V2
const V2: bool = true;
static ECHO_GUARD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
// END-V2

enum Segmenter {
    Old(ContinuousVadProcessor),
    // BEGIN-V2
    New(LiveSegmenter),
    // END-V2
}

struct Final {
    start_ms: f64,
    end_ms: f64,
    samples: Vec<f32>,
    arrival_s: f64,
}

struct Interim {
    segment_start_ms: f64,
    end_ms: f64,
    samples: Vec<f32>,
}

/// Something shown on screen: covers audio up to `covered_end_ms` of the segment
/// starting at `segment_start_ms`, visible from `shown_s`.
struct Emission {
    segment_start_ms: f64,
    covered_end_ms: f64,
    shown_s: f64,
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn percentile(v: &mut Vec<f64>, p: f64) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() - 1) as f64 * p).round() as usize]
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let audio_path = arg(&args, "--audio").expect("--audio");
    let engine_name = arg(&args, "--engine").unwrap_or_else(|| "whisper".into());
    let model = arg(&args, "--model").expect("--model");
    let seg_mode = arg(&args, "--seg").unwrap_or_else(|| "old".into());
    let out = arg(&args, "--out").expect("--out");
    let interim_on = args.iter().any(|a| a == "--interim");
    let context_on = args.iter().any(|a| a == "--context");
    // Fixed user glossary, sent as the whisper prompt for every final and interim.
    let glossary = arg(&args, "--glossary");
    // BEGIN-V2
    ECHO_GUARD.store(args.iter().any(|a| a == "--echo-guard"), std::sync::atomic::Ordering::Relaxed);
    // END-V2
    let models_dir = PathBuf::from(arg(&args, "--models-dir").unwrap_or_else(|| {
        format!(
            "{}/Library/Application Support/com.meetily.ai/models",
            std::env::var("HOME").unwrap()
        )
    }));

    let bytes = std::fs::read(&audio_path)?;
    let audio: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let audio_s = audio.len() as f64 / 16000.0;

    let engine = match engine_name.as_str() {
        "whisper" => {
            let e = WhisperEngine::new_with_models_dir(Some(models_dir.clone()))?;
            e.discover_models().await?;
            e.load_model(&model).await?;
            Engine::Whisper(e)
        }
        _ => {
            let e = ParakeetEngine::new_with_models_dir(Some(models_dir.clone()))?;
            e.discover_models().await?;
            e.load_model(&model).await?;
            Engine::Parakeet(e)
        }
    };
    // Optional smaller whisper model for interim captions only.
    let interim_engine = match arg(&args, "--interim-model") {
        Some(name) => {
            let e = WhisperEngine::new_with_models_dir(Some(models_dir.clone()))?;
            e.discover_models().await?;
            e.load_model(&name).await?;
            Some(Engine::Whisper(e))
        }
        None => None,
    };

    // Warm-up so model load and first-run kernel compilation are not billed to segment 1.
    engine.transcribe(vec![0.0; 16000], None, false).await;
    if let Some(e) = &interim_engine {
        e.transcribe(vec![0.0; 16000], None, true).await;
    }

    // Post-meeting path, as in retranscription.rs: whole-file VAD with a 2000ms
    // redemption, segments over 25s split at their quietest point. No clock.
    // BEGIN-V2
    if seg_mode == "batch" {
        const MAX_SEGMENT_SAMPLES: usize = 25 * 16000;
        let mut segments = Vec::new();
        for s in app_lib::audio::vad::get_speech_chunks(&audio, 2000)? {
            if s.samples.len() > MAX_SEGMENT_SAMPLES {
                segments.extend(app_lib::audio::split_segment_at_silence(&s, MAX_SEGMENT_SAMPLES));
            } else {
                segments.push(s);
            }
        }
        let t0 = Instant::now();
        let mut f = std::fs::File::create(&out)?;
        let mut lens: Vec<f64> = Vec::new();
        for s in segments {
            lens.push(s.samples.len() as f64 / 16000.0);
            let text = engine.transcribe(s.samples, None, false).await;
            if !text.is_empty() {
                writeln!(f, "{text}")?;
            }
        }
        let n = lens.len();
        println!(
            "segments={} seg_len_p50={:.1}s busy={:.0}%",
            n,
            percentile(&mut lens, 0.5),
            t0.elapsed().as_secs_f64() / audio_s * 100.0
        );
        return Ok(());
    }
    // END-V2

    let mut seg = match seg_mode.as_str() {
        // BEGIN-V2
        "new" => {
            let mut cfg = LiveSegmenterConfig::default();
            let num = |name: &str| arg(&args, name).map(|v| v.parse::<f64>().expect(name));
            if let Some(v) = num("--base-ms") { cfg.base_redemption_ms = v as u32; }
            if let Some(v) = num("--soft-ms") { cfg.soft_redemption_ms = v as u32; }
            if let Some(v) = num("--soft-max-ms") { cfg.soft_max_ms = v; }
            if let Some(v) = num("--hard-max-ms") { cfg.hard_max_ms = v; }
            if let Some(v) = num("--interval-ms") { cfg.interim_interval_ms = v; }
            if let Some(v) = num("--interim-max-ms") { cfg.interim_max_ms = v; }
            Segmenter::New(LiveSegmenter::new(16000, cfg)?)
        }
        // END-V2
        _ => Segmenter::Old(ContinuousVadProcessor::new(16000, 500)?),
    };

    let mut queue: std::collections::VecDeque<Final> = Default::default();
    let mut latest_interim: Option<Interim> = None;
    let mut emissions: Vec<Emission> = Vec::new();
    let mut finals_out: Vec<(f64, f64, String)> = Vec::new();
    let mut final_spans: Vec<(f64, f64)> = Vec::new();
    let mut worker_free_s = 0.0f64;
    let mut busy_s = 0.0f64;
    let mut interim_runs = 0usize;
    let mut prompt_tail = String::new();
    let mut interims_out: Vec<(f64, f64, String)> = Vec::new();

    let mut pos = 0usize;
    let mut flushed = false;
    loop {
        let now_s;
        if pos < audio.len() {
            let end = (pos + BLOCK).min(audio.len());
            let block = &audio[pos..end];
            pos = end;
            now_s = pos as f64 / 16000.0;
            let segments = match &mut seg {
                Segmenter::Old(v) => v.process_audio(block)?,
                // BEGIN-V2
                Segmenter::New(s) => s.process_audio(block)?,
                // END-V2
            };
            for s in segments {
                if s.samples.len() >= 800 {
                    queue.push_back(Final {
                        start_ms: s.start_timestamp_ms,
                        end_ms: s.end_timestamp_ms,
                        samples: s.samples,
                        arrival_s: now_s,
                    });
                    latest_interim = None;
                }
            }
            // BEGIN-V2
            if interim_on {
                if let Segmenter::New(s) = &mut seg {
                    if let Some(snap) = s.take_interim() {
                        latest_interim = Some(Interim {
                            segment_start_ms: snap.segment_start_ms,
                            end_ms: snap.end_ms,
                            samples: snap.samples,
                        });
                    }
                }
            }
            // END-V2
        } else if !flushed {
            flushed = true;
            now_s = audio_s;
            let segments = match &mut seg {
                Segmenter::Old(v) => v.flush()?,
                // BEGIN-V2
                Segmenter::New(s) => s.flush()?,
                // END-V2
            };
            for s in segments {
                if s.samples.len() >= 800 {
                    queue.push_back(Final {
                        start_ms: s.start_timestamp_ms,
                        end_ms: s.end_timestamp_ms,
                        samples: s.samples,
                        arrival_s: now_s,
                    });
                }
            }
            latest_interim = None;
        } else {
            break;
        }

        // Finals first, in order, whenever the worker is free by `now_s`.
        // After the input ends there is no clock limit: drain everything.
        while !queue.is_empty() {
            if worker_free_s > now_s && !flushed {
                break;
            }
            let f = queue.pop_front().unwrap();
            let start_s = worker_free_s.max(f.arrival_s);
            let prompt = if let Some(g) = glossary.as_deref() {
                Some(g)
            } else if context_on && !prompt_tail.is_empty() {
                Some(prompt_tail.as_str())
            } else {
                None
            };
            let t0 = Instant::now();
            let text = engine.transcribe(f.samples, prompt, false).await;
            let dt = t0.elapsed().as_secs_f64();
            busy_s += dt;
            worker_free_s = start_s + dt;
            emissions.push(Emission {
                segment_start_ms: f.start_ms,
                covered_end_ms: f.end_ms,
                shown_s: worker_free_s,
            });
            final_spans.push((f.start_ms, f.end_ms));
            if !text.is_empty() {
                prompt_tail.push(' ');
                prompt_tail.push_str(&text);
                let mut cut = prompt_tail.len().saturating_sub(300);
                while !prompt_tail.is_char_boundary(cut) {
                    cut += 1;
                }
                prompt_tail.drain(..cut);
                finals_out.push((f.start_ms, f.end_ms, text));
            }
        }

        // Interim only when idle with nothing final waiting.
        if queue.is_empty() && worker_free_s <= now_s {
            if let Some(i) = latest_interim.take() {
                let t0 = Instant::now();
                let text = interim_engine
                    .as_ref()
                    .unwrap_or(&engine)
                    .transcribe(i.samples, glossary.as_deref(), true)
                    .await;
                interims_out.push((i.segment_start_ms, i.end_ms, text));
                let dt = t0.elapsed().as_secs_f64();
                busy_s += dt;
                interim_runs += 1;
                worker_free_s = now_s + dt;
                emissions.push(Emission {
                    segment_start_ms: i.segment_start_ms,
                    covered_end_ms: i.end_ms,
                    shown_s: worker_free_s,
                });
            }
        }
    }

    // Word delay: for every 100ms of speech, the first moment any emission
    // covering it was on screen, minus when it was spoken.
    let mut delays = Vec::new();
    for (start_ms, end_ms) in &final_spans {
        let mut t = *start_ms;
        while t < *end_ms {
            let shown = emissions
                .iter()
                .filter(|e| (e.segment_start_ms - start_ms).abs() < 1.0 && e.covered_end_ms >= t)
                .map(|e| e.shown_s)
                .fold(f64::INFINITY, f64::min);
            if shown.is_finite() {
                delays.push(shown - t / 1000.0);
            }
            t += 100.0;
        }
    }
    let mut seg_lens: Vec<f64> = final_spans.iter().map(|(a, b)| (b - a) / 1000.0).collect();
    let n_seg = seg_lens.len();
    let mut d2 = delays.clone();

    let mut f = std::fs::File::create(&out)?;
    for (_, _, text) in &finals_out {
        writeln!(f, "{text}")?;
    }

    if let Some(path) = arg(&args, "--interim-out") {
        let mut f = std::fs::File::create(path)?;
        for (start, end, text) in &interims_out {
            writeln!(f, "{:.1}-{:.1}\t{text}", start / 1000.0, end / 1000.0)?;
        }
        for (start, end, text) in &finals_out {
            writeln!(f, "{:.1}-{:.1}\tFINAL\t{text}", start / 1000.0, end / 1000.0)?;
        }
    }

    println!(
        "segments={} seg_len_p50={:.1}s word_delay_p50={:.2}s p90={:.2}s max={:.2}s busy={:.0}% interims={} tail={:.1}s",
        n_seg,
        percentile(&mut seg_lens, 0.5),
        percentile(&mut delays, 0.5),
        percentile(&mut d2, 0.9),
        d2.last().copied().unwrap_or(f64::NAN),
        busy_s / audio_s * 100.0,
        interim_runs,
        (worker_free_s - audio_s).max(0.0),
    );
    Ok(())
}
