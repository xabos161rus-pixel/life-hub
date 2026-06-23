import { useEffect, useRef, useState } from 'react';

const MAX_SEC = 120; // максимум 2 минуты на голосовое

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(new Error('read'));
    fr.readAsDataURL(blob);
  });
}

function pickMime(): string {
  // mp4/aac играет везде (в т.ч. iOS); webm/opus — Chrome/Android. iOS Safari
  // записывает mp4 — значит голосовые от iPhone слышны всем.
  const cands = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  for (const m of cands) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* нет MediaRecorder */
    }
  }
  return '';
}

/** Запись голосового. onComplete вызывается при остановке (не отмене). */
export function useVoiceRecorder(onComplete: (dataUrl: string, durationSec: number) => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const supported =
    typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  function cleanup() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mrRef.current = null;
    setRecording(false);
    setElapsed(0);
  }

  async function start(): Promise<boolean> {
    if (!supported || recording) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      cancelledRef.current = false;
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const dur = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const cancelled = cancelledRef.current;
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/mp4' });
        cleanup();
        if (cancelled || blob.size === 0) return;
        try {
          const dataUrl = await blobToDataUrl(blob);
          onCompleteRef.current(dataUrl, dur);
        } catch {
          /* не удалось прочитать запись */
        }
      };
      mr.start();
      mrRef.current = mr;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(s);
        if (s >= MAX_SEC) stop(); // авто-стоп на пределе
      }, 250);
      return true;
    } catch {
      cleanup();
      return false;
    }
  }

  /** Остановить и отправить (через onComplete). */
  function stop() {
    const mr = mrRef.current;
    if (!mr) return;
    cancelledRef.current = false;
    try {
      mr.stop();
    } catch {
      cleanup();
    }
  }

  /** Остановить и выбросить запись. */
  function cancel() {
    const mr = mrRef.current;
    if (!mr) {
      cleanup();
      return;
    }
    cancelledRef.current = true;
    try {
      mr.stop();
    } catch {
      cleanup();
    }
  }

  // Снять ресурсы при размонтировании.
  useEffect(() => () => cleanup(), []);

  return { supported, recording, elapsed, start, stop, cancel };
}
