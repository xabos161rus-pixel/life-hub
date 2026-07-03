// Рингтон входящего звонка: синтез через WebAudio (без аудиофайлов).
// Классическая телефонная трель: два тона 440+480 Гц, паттерн 2с звук / 2с пауза.
// Autoplay-политика может держать контекст suspended, пока не было жеста —
// resume() пробуем на старте и при первом же касании экрана (оверлей звонка
// всё равно уже виден, так что звонок не теряется, просто без звука).
// На Android дополнительно вибрация — но Chromium блокирует vibrate() без
// жеста в сессии (холодный запуск из пуша = только звук); iOS игнорирует всегда.

let ctx: AudioContext | null = null;
let stopCurrent: (() => void) | null = null;
let armed = false;

/** Разлочить WebAudio заранее, первым же жестом в сессии (iOS требует жест на
 *  странице; тап по пуш-уведомлению жестом НЕ считается). Тогда к моменту
 *  входящего звонка контекст уже running и рингтон звучит сразу. */
export function armRingtoneUnlock(): void {
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

function burst(ac: AudioContext, at: number, dur: number, dest: GainNode) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(1, at + 0.02);
  g.gain.setValueAtTime(1, at + dur - 0.04);
  g.gain.linearRampToValueAtTime(0, at + dur);
  g.connect(dest);
  const oscs = [440, 480].map((f) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(at);
    o.stop(at + dur);
    return o;
  });
  return () => {
    for (const o of oscs) {
      try {
        o.stop();
      } catch {
        /* уже остановлен */
      }
    }
  };
}

export function startRingtone(): void {
  stopRingtone();
  try {
    ctx = ctx ?? new AudioContext();
  } catch {
    return; // WebAudio недоступен — оверлей всё равно покажется
  }
  const ac = ctx;
  const master = ac.createGain();
  master.gain.value = 0.4;
  master.connect(ac.destination);

  const CYCLE = 4; // 2с трель + 2с тишина
  let cancels: (() => void)[] = [];
  const scheduleCycle = () => {
    if (typeof navigator.vibrate === 'function') navigator.vibrate([700, 300, 700]);
    // У suspended контекста currentTime заморожен: запланированные трели легли
    // бы стопкой на одну и ту же отметку и при разлочке грянули бы все разом
    // клиппованным залпом. Пока не running — просто пропускаем тик.
    if (ac.state !== 'running') return;
    const at = ac.currentTime + 0.05;
    cancels.push(burst(ac, at, 2, master));
  };

  const tryResume = () => {
    if (ac.state === 'suspended') void ac.resume().catch(() => {});
  };
  tryResume();
  scheduleCycle();
  const timer = setInterval(scheduleCycle, CYCLE * 1000);
  // Если autoplay заблокировал звук — первый же тап (по любому месту, включая
  // кнопки оверлея) резюмирует контекст, и следующая трель уже прозвучит.
  window.addEventListener('pointerdown', tryResume);

  stopCurrent = () => {
    clearInterval(timer);
    window.removeEventListener('pointerdown', tryResume);
    for (const c of cancels) c();
    cancels = [];
    try {
      master.disconnect();
    } catch {
      /* контекст уже закрыт */
    }
    if (typeof navigator.vibrate === 'function') navigator.vibrate(0);
  };
}

export function stopRingtone(): void {
  if (stopCurrent) {
    stopCurrent();
    stopCurrent = null;
  }
}
