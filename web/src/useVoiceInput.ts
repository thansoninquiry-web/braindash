import { useCallback, useEffect, useRef, useState } from "react";
import { initialVoiceStatus, type VoiceStatus } from "./voice";

export type { VoiceStatus } from "./voice";

/**
 * Minimal shapes for the Web Speech API. It is not in lib.dom, and support is
 * Chromium-only, so the hook feature-detects instead of assuming.
 */
interface SpeechAlternative {
  transcript: string;
}

interface SpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative | undefined;
}

interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult | undefined;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: SpeechResultList;
}

interface SpeechErrorEvent {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

interface VoiceInputOptions {
  /** Interim text streams while speaking; `final` marks the settled transcript. */
  onTranscript: (text: string, final: boolean) => void;
  lang?: string;
}

/**
 * Dictation for the search field. Reports *why* it cannot listen rather than
 * failing silently, and always releases the microphone on unmount.
 */
export function useVoiceInput({ onTranscript, lang = "en-US" }: VoiceInputOptions) {
  const supported = typeof window !== "undefined" && getRecognitionCtor() !== null;
  // `isSecureContext` is false for a plain-HTTP LAN page, which is how a phone
  // reaches this dashboard. The API is not involved: the browser itself will not
  // hand over the microphone there, so saying "permission blocked" would send
  // someone looking in the wrong place.
  const secure = typeof window === "undefined" || window.isSecureContext !== false;
  const [status, setStatus] = useState<VoiceStatus>(() =>
    initialVoiceStatus({ supported, secure }),
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setStatus((current) => (current === "listening" ? "idle" : current));
  }, []);

  const start = useCallback(() => {
    const unavailable = initialVoiceStatus({ supported, secure });
    if (unavailable !== "idle") {
      setStatus(unavailable);
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    recognitionRef.current?.abort();
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = "";
      let settled = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) settled += text;
        else interim += text;
      }
      if (settled) transcriptRef.current(settled.trim(), true);
      else if (interim) transcriptRef.current(interim.trim(), false);
    };

    recognition.onerror = (event) => {
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
      setStatus(denied ? "denied" : event.error === "no-speech" ? "idle" : "error");
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setStatus((current) => (current === "listening" ? "idle" : current));
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setStatus("listening");
    } catch {
      // start() throws if the microphone is already in use.
      recognitionRef.current = null;
      setStatus("error");
    }
  }, [lang, supported, secure]);

  const toggle = useCallback(() => {
    if (status === "listening") stop();
    else start();
  }, [status, start, stop]);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { supported, status, start, stop, toggle };
}
