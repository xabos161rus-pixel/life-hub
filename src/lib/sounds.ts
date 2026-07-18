// Звуки уведомлений внутри приложения: WebAudio-синтез (без аудиофайлов).
// Играют, когда приложение открыто; для закрытого — системный звук пуша.
// Autoplay-политика: контекст разлочивается первым жестом (armSoundUnlock).
import { db } from '../db/db';

export type MessageSound = 'tritone' | 'ding' | 'pop' | 'none';

export const MESSAGE_SOUNDS: { value: MessageSound; label: string }[] = [
  { value: 'tritone', label: 'Три ноты' },
  { value: 'ding', label: 'Колокольчик' },
  { value: 'pop', label: 'Бульк' },
  { value: 'none', label: 'Без звука' },
];

let ctx: AudioContext | null = null;
let armed = false;

/** Разлочить WebAudio первым жестом в сессии — чтобы звук нового сообщения
 *  сыграл сразу, а не после следующего касания. */
export function armSoundUnlock(): void {
  if (armed) return;
  armed = true;
  const unlock = () => {
    try {
      ctx = ctx ?? new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      if (ctx.state === 'running') window.removeEventListener('pointerdown', unlock);
    } catch {
      /* WebAudio недоступен */
    }
  };
  window.addEventListener('pointerdown', unlock);
}

function tone(ac: AudioContext, at: number, freq: number, dur: number, peak = 0.22) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  g.connect(ac.destination);
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  o.connect(g);
  o.start(at);
  o.stop(at + dur);
}

/** Проиграть звук сообщения. Без аргумента — берёт выбранный в настройках. */
export async function playMessageSound(kind?: MessageSound): Promise<void> {
  let k = kind;
  if (!k) {
    const s = await db.settings.get('app');
    k = (s?.messageSound as MessageSound | undefined) ?? 'tritone';
  }
  if (k === 'none') return;
  try {
    ctx = ctx ?? new AudioContext();
  } catch {
    return;
  }
  const ac = ctx;
  if (ac.state === 'suspended') {
    try {
      await ac.resume();
    } catch {
      return;
    }
  }
  if (ac.state !== 'running') return; // жеста ещё не было — молчим, не копим залп
  const t = ac.currentTime + 0.02;
  if (k === 'tritone') {
    // Знакомое «ди-ди-дин» в духе классического SMS-сигнала: E6 → C6 → G5.
    tone(ac, t, 1318.5, 0.18);
    tone(ac, t + 0.14, 1046.5, 0.18);
    tone(ac, t + 0.28, 784, 0.32, 0.2);
  } else if (k === 'ding') {
    // Колокольчик: основная нота + тихий верхний обертон.
    tone(ac, t, 880, 0.7, 0.24);
    tone(ac, t, 1760, 0.45, 0.07);
  } else if (k === 'pop') {
    // Мягкий «бульк»: короткий свип вниз.
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    g.connect(ac.destination);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.14);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.18);
  }
}
