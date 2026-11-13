"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSupport } from "./provider";

/*
 * Voice in the reply box: the agent speaks, and what they said becomes notes to write up, a
 * change to the reply, or plain text. With `client.ai.transcribe` the recording goes to your
 * transcription model. Without it, the browser's own speech recognition is used where it exists.
 * With neither, there is no microphone button.
 */

/** Where speech becomes text. */
export type VoiceEngine = "server" | "browser";
/** What happens with what was said. */
export type VoiceIntent = "writeUp" | "instruction" | "insert";
export type VoicePhase = "idle" | "starting" | "listening" | "transcribing" | "applying" | "failed";
type VoiceError = "denied" | "noMicrophone" | "unavailable" | "nothing" | "transcribe" | "apply";

/** Recordings stop here on their own, and what was said is applied. */
export const VOICE_MAX_SECONDS = 120;

// The Web Speech API isn't in every TypeScript DOM library, so only what's used is described.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionConstructor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const canRecord = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
/** Phones and tablets: their speech recognition wants the microphone to itself and ends after each phrase. */
const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

/** Known after mount: how this browser can listen, if at all, and the shortcut as this keyboard shows it. */
export function useVoiceEngine() {
  const { client } = useSupport();
  const server = Boolean(client.ai?.transcribe);
  const [state, setState] = useState<{ engine: VoiceEngine | null; shortcut: string | null }>({ engine: null, shortcut: null });
  useEffect(() => {
    const engine = server && canRecord() ? "server" : recognitionConstructor() ? "browser" : null;
    const shortcut = isTouch() ? null : /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⇧Space" : "Ctrl+Shift+Space";
    setState({ engine, shortcut });
  }, [server]);
  return state;
}

function microphoneError(error: unknown): VoiceError {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "noMicrophone";
  return "unavailable";
}

type Session = {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  recognition: Recognition | null;
  /** What earlier recognition rounds settled on; the browser may end a round at every pause. */
  settled: string;
  /** The current round, settled and tentative. */
  current: string;
  finishing: boolean;
  fatal: VoiceError | null;
  limit: ReturnType<typeof setTimeout> | null;
};

/**
 * One voice session at a time. `resolve` gets what was said and returns the change to make, which
 * only runs if the agent hasn't cancelled in the meantime.
 */
export function useVoice({ engine, resolve }: { engine: VoiceEngine | null; resolve: (said: string) => Promise<() => void> }) {
  const { client, speechLocale } = useSupport();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<{ kind: VoiceError; message?: string } | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const phaseRef = useRef<VoicePhase>("idle");
  const run = useRef(0);
  const session = useRef<Session | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const latestResolve = useRef(resolve);
  useEffect(() => {
    latestResolve.current = resolve;
  });

  const go = (next: VoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  /** Lets go of the microphone. Nothing recorded is kept. */
  const release = () => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    if (s.limit) clearTimeout(s.limit);
    if (s.recorder && s.recorder.state !== "inactive") {
      s.recorder.onstop = null;
      s.recorder.stop();
    }
    if (s.recognition) {
      s.recognition.onresult = s.recognition.onerror = s.recognition.onend = null;
      try {
        s.recognition.abort();
      } catch {
        // Already stopped.
      }
    }
    s.stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setStartedAt(null);
  };

  const fail = (kind: VoiceError, retry: (() => void) | null, message?: string) => {
    release();
    retryRef.current = retry;
    setError({ kind, message });
    go("failed");
  };

  const deliver = async (said: string, id: number) => {
    release();
    const text = said.replace(/\s+/g, " ").trim();
    if (!text) return fail("nothing", start);
    setTranscript(text);
    setError(null);
    go("applying");
    try {
      const commit = await latestResolve.current(text);
      if (run.current !== id) return;
      commit();
      setTranscript("");
      go("idle");
    } catch (e) {
      if (run.current !== id) return;
      fail("apply", () => void deliver(text, id), e instanceof Error && e.message ? e.message : undefined);
    }
  };

  const transcribeRecording = async (audio: Blob, id: number) => {
    release();
    if (!audio.size) return fail("nothing", start);
    setError(null);
    go("transcribing");
    let text: string;
    try {
      text = (await client.ai!.transcribe!({ audio })).text;
    } catch {
      if (run.current === id) fail("transcribe", () => void transcribeRecording(audio, id));
      return;
    }
    if (run.current === id) await deliver(text, id);
  };

  const listenInBrowser = (s: Session, id: number) => {
    const Recognition = recognitionConstructor()!;
    const recognition = new Recognition();
    s.recognition = recognition;
    recognition.lang = speechLocale;
    recognition.interimResults = true;
    recognition.continuous = !isTouch();
    recognition.onresult = (event) => {
      let heard = "";
      for (let i = 0; i < event.results.length; i++) heard += event.results[i]![0].transcript;
      s.current = heard;
      setTranscript(`${s.settled} ${heard}`.replace(/\s+/g, " ").trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") s.fatal = "denied";
      else if (event.error === "audio-capture") s.fatal = "noMicrophone";
      else if (event.error === "network" || event.error === "language-not-supported") s.fatal = "unavailable";
    };
    recognition.onend = () => {
      if (run.current !== id || session.current !== s) return;
      s.settled = `${s.settled} ${s.current}`.trim();
      s.current = "";
      if (s.fatal && !s.settled) return fail(s.fatal, start);
      if (s.finishing || s.fatal) return void deliver(s.settled, id);
      // The browser ended the round at a pause. Keep listening until the agent says they're done.
      try {
        recognition.start();
      } catch {
        void deliver(s.settled, id);
      }
    };
    recognition.start();
  };

  async function start() {
    if (!engine || (phaseRef.current !== "idle" && phaseRef.current !== "failed")) return;
    const id = ++run.current;
    setTranscript("");
    setError(null);
    go("starting");
    const s: Session = { stream: null, recorder: null, chunks: [], recognition: null, settled: "", current: "", finishing: false, fatal: null, limit: null };
    session.current = s;
    try {
      // On a phone the browser's recognition needs the microphone to itself, so there's no level to show.
      if (engine === "server" || !isTouch()) {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("No microphone access", "NotFoundError");
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (run.current !== id) return media.getTracks().forEach((track) => track.stop());
        s.stream = media;
        setStream(media);
      }
      if (engine === "server") {
        const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
        // Speech needs little: two minutes stay under half a megabyte.
        const recorder = new MediaRecorder(s.stream!, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
        s.recorder = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size) s.chunks.push(event.data);
        };
        recorder.onstop = () => void transcribeRecording(new Blob(s.chunks, { type: recorder.mimeType || mimeType || "audio/webm" }), id);
        recorder.start();
      } else {
        listenInBrowser(s, id);
      }
    } catch (e) {
      if (run.current === id) fail(microphoneError(e), start);
      return;
    }
    s.limit = setTimeout(stop, VOICE_MAX_SECONDS * 1000);
    setStartedAt(Date.now());
    go("listening");
  }

  /** The agent is done speaking: apply what was said. */
  function stop() {
    const s = session.current;
    if (!s || phaseRef.current !== "listening" || s.finishing) return;
    s.finishing = true;
    if (s.limit) clearTimeout(s.limit);
    if (s.recorder) return s.recorder.stop();
    const id = run.current;
    try {
      s.recognition?.stop();
    } catch {
      // Between rounds: the fallback below delivers.
    }
    // Some browsers never report the end of a round they were asked to stop.
    s.limit = setTimeout(() => {
      if (run.current === id && session.current === s) void deliver(`${s.settled} ${s.current}`, id);
    }, 1500);
  }

  /** Drops everything: the recording, the transcript and any change still on its way. */
  function cancel() {
    run.current++;
    release();
    retryRef.current = null;
    setTranscript("");
    setError(null);
    go("idle");
  }

  useEffect(
    () => () => {
      run.current++;
      release();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return {
    phase,
    transcript,
    error,
    stream,
    startedAt,
    start: () => void start(),
    stop,
    cancel,
    retry: () => (retryRef.current ?? start)(),
  };
}

export type Voice = ReturnType<typeof useVoice>;

/** The one microphone control: starts listening, and stops when pressed again. */
export function VoiceButton({ voice, shortcut }: { voice: Voice; shortcut: string | null }) {
  const { t } = useSupport();
  const listening = voice.phase === "listening";
  const label = t(listening ? "ai.voice.stop" : "ai.voice.start");
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-pressed={voice.phase !== "idle"}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={voice.phase !== "idle" && !listening}
      onClick={listening ? voice.stop : voice.start}
      className={cn(voice.phase !== "idle" && "text-primary")}
    >
      <Mic className="size-4" />
    </Button>
  );
}

/** Shown in the reply box from the moment the microphone is asked for until what was said is applied. */
export function VoicePanel({
  voice,
  intent,
  intents,
  onIntent,
}: {
  voice: Voice;
  intent: VoiceIntent;
  /** What the agent can choose between here. One choice shows no control. */
  intents: VoiceIntent[];
  onIntent: (intent: VoiceIntent) => void;
}) {
  const { t } = useSupport();
  const { phase, transcript, error } = voice;
  const done = useRef<HTMLButtonElement>(null);
  // Focus goes to Done, so Space or Enter ends the recording without reaching for the mouse.
  useEffect(() => {
    if (phase === "listening") done.current?.focus();
  }, [phase]);
  if (phase === "idle") return null;
  const working = phase === "transcribing" || phase === "applying";

  return (
    <div role="group" aria-label={t("ai.voice.label")} className="space-y-2.5 border-t px-4 py-3">
      <div aria-live="polite" className="min-h-10 text-sm">
        {phase === "failed" && error && <p className="text-destructive">{error.kind === "apply" ? error.message ?? t("ai.failed") : t(`ai.voice.errors.${error.kind}`)}</p>}
        {transcript ? (
          <p dir="auto" className={cn(phase === "failed" && "mt-1 text-muted-foreground")}>
            {transcript}
          </p>
        ) : (
          phase !== "failed" && (
            <p className="text-muted-foreground">
              {t(phase === "starting" ? "ai.voice.waiting" : phase === "transcribing" ? "ai.voice.transcribing" : `ai.voice.hint.${intent}`)}
            </p>
          )
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {intents.length > 1 && phase !== "failed" && (
          <div role="radiogroup" aria-label={t("ai.voice.intentLabel")} className="inline-flex rounded-md border bg-background p-0.5">
            {intents.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={intent === option}
                disabled={working}
                onClick={() => onIntent(option)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                  intent === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t(`ai.voice.intent.${option}`)}
              </button>
            ))}
          </div>
        )}
        <div className="ms-auto flex items-center gap-2">
          {phase === "listening" && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
              <VoiceLevel stream={voice.stream} />
              {voice.startedAt !== null && <VoiceClock startedAt={voice.startedAt} />}
            </span>
          )}
          {working && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {phase === "applying" && intent !== "insert" && t(`ai.voice.applying.${intent}`)}
            </span>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={voice.cancel}>
            {t(phase === "failed" ? "ai.voice.dismiss" : "actions.cancel")}
          </Button>
          {phase === "listening" && (
            <Button ref={done} type="button" size="sm" onClick={voice.stop}>
              <Square className="size-3 fill-current" />
              {t("ai.voice.stop")}
            </Button>
          )}
          {phase === "failed" && (
            <Button type="button" size="sm" onClick={voice.retry}>
              {t("actions.retry")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const BARS = 16;

/** How loud the microphone hears the agent, as the last second and a half of bars. A dot when the level can't be read. */
function VoiceLevel({ stream }: { stream: MediaStream | null }) {
  const bars = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!stream || !AudioContextClass) return;
    const context = new AudioContextClass();
    void context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const levels = new Array<number>(BARS).fill(0);
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 90) return;
      last = now;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      levels.shift();
      // Speech sits low on the scale: lift it so a normal voice fills the bars.
      levels.push(Math.min(1, Math.sqrt(sum / samples.length) * 5));
      const children = bars.current?.children;
      for (let i = 0; children && i < children.length; i++) (children[i] as HTMLElement).style.height = `${Math.max(12, levels[i]! * 100)}%`;
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      void context.close().catch(() => {});
    };
  }, [stream]);

  return (
    <span className="flex items-center gap-2" aria-hidden>
      <span className="size-2 animate-pulse rounded-full bg-red-500" />
      {stream && (
        <span ref={bars} className="flex h-5 items-center gap-0.5">
          {Array.from({ length: BARS }, (_, i) => (
            <span key={i} className="w-0.5 rounded-full bg-primary" style={{ height: "12%" }} />
          ))}
        </span>
      )}
    </span>
  );
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Time spoken, against the limit. */
function VoiceClock({ startedAt }: { startedAt: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const tick = () => setSeconds(Math.min(VOICE_MAX_SECONDS, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [startedAt]);
  return (
    <span className={cn(VOICE_MAX_SECONDS - seconds <= 15 && "text-amber-700 dark:text-amber-300")}>
      {clock(seconds)} / {clock(VOICE_MAX_SECONDS)}
    </span>
  );
}
