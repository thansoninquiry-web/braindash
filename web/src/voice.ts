/**
 * Why dictation is or is not available, kept out of the hook so the rules can
 * be checked without a DOM. Browsers only expose the microphone to a **secure
 * context**: `https://` or `localhost`. A phone opening the dashboard at
 * `http://192.168.x.x:5180` is neither, so the Web Speech API fails with the
 * same `not-allowed` error as a refused permission — a misleading report that
 * this module distinguishes from an actual block.
 */
export type VoiceStatus = "unsupported" | "insecure" | "idle" | "listening" | "denied" | "error";

export interface VoiceEnvironment {
  /** `SpeechRecognition` or `webkitSpeechRecognition` exists. */
  supported: boolean;
  /** `window.isSecureContext`; false on plain-HTTP LAN pages. */
  secure: boolean;
}

/** The status before the mic is ever pressed. */
export function initialVoiceStatus({ supported, secure }: VoiceEnvironment): VoiceStatus {
  if (!supported) return "unsupported";
  if (!secure) return "insecure";
  return "idle";
}

/** One sentence under the search box, and the mic button's tooltip. */
export function voiceMessage(status: VoiceStatus): string {
  switch (status) {
    case "listening":
      return "Listening… speak your search";
    case "unsupported":
      return "This browser has no speech recognition — use your keyboard's mic";
    case "insecure":
      return "Voice needs https:// — a plain http:// address has no microphone. Use your keyboard's mic, or reopen on the https address";
    case "denied":
      return "Microphone permission was blocked — allow it in site settings";
    case "error":
      return "Voice input failed — try again";
    default:
      return "Search by voice";
  }
}

/** Short label inside the mic button. */
export function voiceButtonLabel(status: VoiceStatus): string {
  switch (status) {
    case "listening":
      return "Stop";
    case "unsupported":
      return "No mic";
    case "insecure":
      return "HTTPS";
    default:
      return "Voice";
  }
}

/** A blocked state has no useful click, so the button is disabled. */
export function voiceBlocked(status: VoiceStatus): boolean {
  return status === "unsupported" || status === "insecure";
}
