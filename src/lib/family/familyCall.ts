// Аудиозвонки в семье (WebRTC, 1:1). Медиа идёт P2P между устройствами —
// серверу платить не за что. Сигналинг (SDP/ICE) проходит через семейный
// WebSocket и E2E-шифруется тем же семейным ключом, что чат. ICE-серверы
// (STUN бесплатен; TURN-relay из Cloudflare Realtime free tier) берём с Worker.
//
// Надёжность «открой приложение, чтобы ответить»: offer не trickle, а с уже
// собранными ICE-кандидатами в SDP, и переотправляется раз в OFFER_RESEND_MS —
// если адресат подключится позже (по пуш-нуджу), он получит полный offer.

import { useSyncExternalStore } from 'react';
import { db } from '../../db/db';
import { encryptJSON, decryptJSON } from '../crypto';
import { getFamilyConfig } from './familyState';
import { sendSignal, sendSystemMessage, connectFamily, type SignalFrame, type SignalKind } from './familyChat';
import { startRingtone, stopRingtone } from './ringtone';

const WORKER_URL = 'https://life-hub-push.xabos161rus.workers.dev';
const RING_TIMEOUT_MS = 30_000;
const OFFER_RESEND_MS = 2500;
const ICE_GATHER_CAP_MS = 2000;
// Фолбэк на случай недоступности /family/turn: только STUN. TURN-креды
// короткоживущие и приходят с воркера — статических здесь держать нельзя
// (анонимный Open Relay мёртв — проверено).
const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

export interface CallSnapshot {
  status: CallStatus;
  familyId: string | null;
  peerId: string | null;
  peerName: string;
  muted: boolean;
  speakerOn: boolean; // громкая связь или «к уху»
  speakerAvailable: boolean; // платформа умеет переключать маршрут — иначе кнопки нет
  // Системный выбор аудиовыхода (AirPods/наушники/колонка) — AirPlay-пикер iOS.
  outputPickerAvailable: boolean;
  startedAt: number | null; // когда соединение стало active (для таймера)
  endReason: string | null;
}

const IDLE: CallSnapshot = {
  status: 'idle',
  familyId: null,
  peerId: null,
  peerName: '',
  muted: false,
  speakerOn: true,
  speakerAvailable: false,
  outputPickerAvailable: false,
  startedAt: null,
  endReason: null,
};

class CallManager {
  private snap: CallSnapshot = IDLE;
  private listeners = new Set<() => void>();

  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;

  private familyId: string | null = null;
  private peerId: string | null = null;
  private callId: string | null = null;
  private role: 'caller' | 'callee' | null = null;
  private gen = 0; // поколение звонка: end() инкрементит → in-flight setup сверяет и бросает осиротевшие mic/pc

  private pendingOffer: string | null = null; // зашифрованный SDP входящего
  private pendingCandidates: RTCIceCandidateInit[] = [];

  // Громкая связь.
  // iOS/Safari: Audio Session API — type 'play-and-record' ведёт звук «к уху»
  // как обычный телефонный звонок (и позволяет аудио жить в фоне), 'playback' —
  // громкоговоритель. Дефолт на iOS — «к уху», как у телефона.
  // Прочие: setSinkId на <audio> (receiver по label) или смена микрофонного
  // входа (Android Chrome, лейблы 'Speakerphone'/'Headset earpiece' захардкожены
  // в Chromium). Ни один путь не доступен — кнопки нет.
  private speakerMode: 'none' | 'audioSession' | 'sinkId' | 'inputSwitch' = 'none';
  private receiverSinkId: string | null = null;
  private earpieceInputId: string | null = null;
  private speakerInputId: string | null = null;

  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  // Возврат в приложение: iOS мог заглушить/убить микрофон в фоне — оживляем.
  private visHandler: (() => void) | null = null;

  private armMicRecovery() {
    this.disarmMicRecovery();
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      void this.recoverMicIfDead();
    };
    document.addEventListener('visibilitychange', onVis);
    this.visHandler = onVis;
  }
  private disarmMicRecovery() {
    if (this.visHandler) {
      document.removeEventListener('visibilitychange', this.visHandler);
      this.visHandler = null;
    }
  }
  /** Микрофонный трек умер/заглушён после фона — берём свежий и подменяем
   *  в отправителе, собеседник снова слышит без переподключения звонка. */
  private async recoverMicIfDead(): Promise<void> {
    const pc = this.pc;
    const stream = this.localStream;
    if (!pc || !stream) return;
    const track = stream.getAudioTracks()[0];
    if (track && track.readyState === 'live' && !track.muted) return; // жив — не трогаем
    const gen = this.gen;
    let fresh: MediaStream;
    try {
      fresh = await this.getMic();
    } catch {
      return; // разрешение потеряно — восстановим при следующем возврате
    }
    if (this.gen !== gen || this.pc !== pc || this.localStream !== stream) {
      for (const t of fresh.getTracks()) t.stop();
      return;
    }
    const newTrack = fresh.getAudioTracks()[0];
    newTrack.enabled = !this.snap.muted;
    const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
    try {
      await sender?.replaceTrack(newTrack);
    } catch {
      for (const t of fresh.getTracks()) t.stop();
      return;
    }
    for (const t of stream.getTracks()) t.stop();
    this.localStream = fresh;
  }
  // Страховка «Соединение…»: ICE не пробился (глухой NAT/VPN без TURN) —
  // честно завершаем вместо вечного спиннера.
  private connTimer: ReturnType<typeof setTimeout> | null = null;

  private armConnTimeout() {
    this.clearConnTimeout();
    this.connTimer = setTimeout(() => {
      this.connTimer = null;
      if (this.snap.status === 'connecting') {
        this.end('Не удалось соединиться — сеть не пропускает звонок');
      }
    }, 25_000);
  }
  private clearConnTimeout() {
    if (this.connTimer) {
      clearTimeout(this.connTimer);
      this.connTimer = null;
    }
  }

  // === стор для useSyncExternalStore ===
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): CallSnapshot => this.snap;
  private set(p: Partial<CallSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }

  // Audio Session API (Safari/iOS): управляет системным аудиомаршрутом.
  private audioSession(): { type: string } | null {
    const as = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    return as ?? null;
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audioEl) {
      const a = document.createElement('audio');
      a.autoplay = true;
      a.setAttribute('playsinline', '');
      a.style.display = 'none';
      document.body.appendChild(a);
      this.audioEl = a;
    }
    return this.audioEl;
  }

  private async peerName(peerId: string): Promise<string> {
    const m = await db.familyMembers.get(peerId);
    return m?.displayName || 'Участник';
  }

  private getMic(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  }

  private async fetchIce(familyId: string): Promise<RTCIceServer[]> {
    try {
      const c = await getFamilyConfig(familyId);
      if (!c) return DEFAULT_ICE;
      const r = await fetch(`${WORKER_URL}/family/turn?familyId=${familyId}`, {
        headers: { Authorization: `Bearer ${c.familyToken}` },
      });
      if (!r.ok) return DEFAULT_ICE;
      const d = (await r.json()) as { iceServers?: RTCIceServer[] };
      return Array.isArray(d.iceServers) && d.iceServers.length ? d.iceServers : DEFAULT_ICE;
    } catch {
      return DEFAULT_ICE;
    }
  }

  // Ждём сбор ICE-кандидатов (с потолком), чтобы offer/answer ушли «полными».
  private waitIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(done, ICE_GATHER_CAP_MS);
    });
  }

  private async signal(kind: SignalKind, payload: unknown | null) {
    if (!this.familyId || !this.peerId || !this.callId) return;
    const c = await getFamilyConfig(this.familyId);
    if (!c) return;
    const data = payload == null ? null : await encryptJSON(c.familyKey, payload);
    sendSignal(this.familyId, { to: this.peerId, call: this.callId, kind, data });
  }

  private async createPc(familyId: string): Promise<RTCPeerConnection> {
    const iceServers = await this.fetchIce(familyId);
    const pc = new RTCPeerConnection({ iceServers });
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (stream) {
        this.ensureAudio().srcObject = stream;
        void this.audioEl?.play().catch(() => {});
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.signal('ice', { candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        this.clearResend();
        this.clearConnTimeout();
        if (this.ringTimer) {
          clearTimeout(this.ringTimer);
          this.ringTimer = null;
        }
        if (this.snap.status !== 'active') this.set({ status: 'active', startedAt: Date.now() });
      } else if (s === 'failed') {
        this.end('Соединение потеряно');
      }
    };
    for (const t of this.localStream?.getTracks() ?? []) pc.addTrack(t, this.localStream!);
    this.pc = pc;
    return pc;
  }

  private async drainCandidates() {
    if (!this.pc) return;
    for (const cand of this.pendingCandidates) {
      try {
        await this.pc.addIceCandidate(cand);
      } catch {
        /* устаревший кандидат */
      }
    }
    this.pendingCandidates = [];
  }

  // Освобождает mic/pc, захваченные ПОСЛЕ того как звонок был снесён (gen сменился
  // во время await). Чистит ТОЛЬКО переданные локальные ресурсы и отвязывает
  // this.* лишь если они всё ещё указывают на них — чтобы не задеть уже начатый
  // НОВЫЙ звонок.
  private abortLocal(pc: RTCPeerConnection | null, stream: MediaStream | null): void {
    if (pc) {
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {
        /* уже закрыт */
      }
      if (this.pc === pc) this.pc = null;
    }
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      if (this.localStream === stream) this.localStream = null;
    }
  }

  // === Исходящий звонок ===
  async startCall(familyId: string, peerId: string): Promise<void> {
    if (this.snap.status !== 'idle' && this.snap.status !== 'ended') return;
    this.cancelDismiss();
    // Статус — СИНХРОННО до любого await: иначе двойной тап «позвонить» прошёл бы
    // guard выше дважды и поднял бы два звонка (два микрофона/pc). Имя дозагрузим.
    this.set({ status: 'outgoing', familyId, peerId, peerName: '', muted: false, startedAt: null, endReason: null });
    connectFamily(familyId);
    this.familyId = familyId;
    this.peerId = peerId;
    this.callId = crypto.randomUUID();
    this.role = 'caller';
    this.pendingCandidates = [];
    const gen = this.gen;
    const name = await this.peerName(peerId);
    if (this.gen !== gen) return;
    this.set({ peerName: name });
    let stream: MediaStream;
    try {
      stream = await this.getMic();
    } catch {
      this.end('Нет доступа к микрофону');
      return;
    }
    if (this.gen !== gen) return this.abortLocal(null, stream); // снесли, пока брали микрофон
    this.localStream = stream;
    void this.probeSpeaker();
    this.armMicRecovery();
    const pc = await this.createPc(familyId);
    if (this.gen !== gen) return this.abortLocal(pc, stream);
    await pc.setLocalDescription(await pc.createOffer());
    if (this.gen !== gen) return this.abortLocal(pc, stream);
    await this.waitIce(pc);
    if (this.gen !== gen) return this.abortLocal(pc, stream);
    const sendOffer = () => void this.signal('offer', { sdp: pc.localDescription });
    sendOffer();
    this.resendTimer = setInterval(sendOffer, OFFER_RESEND_MS);
    this.ringTimer = setTimeout(() => {
      // cancel — синхронно и напрямую (не this.signal: end() обнулит поля до
      // его await). Недоставленный cancel сервер превратит в «пропущенный звонок».
      if (this.familyId && this.peerId && this.callId) {
        sendSignal(this.familyId, { to: this.peerId, call: this.callId, kind: 'cancel', data: null });
      }
      this.end('Не ответили');
    }, RING_TIMEOUT_MS);
  }

  // === Приём входящего ===
  async accept(): Promise<void> {
    if (this.snap.status !== 'incoming' || !this.familyId || !this.peerId || !this.pendingOffer) return;
    if (this.ringTimer) {
      clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
    stopRingtone();
    this.clearCallNotifications(this.callId);
    this.set({ status: 'connecting' }); // синхронно до await — дедуп двойного «Принять»
    this.armConnTimeout();
    const gen = this.gen;
    const familyId = this.familyId;
    const pendingOffer = this.pendingOffer; // захватываем: end() обнулит this.pendingOffer
    const c = await getFamilyConfig(familyId);
    if (!c) {
      this.end('Ошибка');
      return;
    }
    if (this.gen !== gen) return;
    let stream: MediaStream;
    try {
      stream = await this.getMic();
    } catch {
      void this.signal('decline', null);
      this.end('Нет доступа к микрофону');
      return;
    }
    if (this.gen !== gen) return this.abortLocal(null, stream); // снесли, пока брали микрофон
    this.localStream = stream;
    void this.probeSpeaker();
    this.armMicRecovery();
    const offer = await decryptJSON<{ sdp: RTCSessionDescriptionInit }>(c.familyKey, pendingOffer);
    if (this.gen !== gen) return this.abortLocal(null, stream);
    const pc = await this.createPc(familyId);
    if (this.gen !== gen) return this.abortLocal(pc, stream);
    await pc.setRemoteDescription(offer.sdp);
    if (this.gen !== gen) return this.abortLocal(pc, stream);
    await this.drainCandidates();
    await pc.setLocalDescription(await pc.createAnswer());
    if (this.gen !== gen) return this.abortLocal(pc, stream);
    await this.waitIce(pc);
    if (this.gen !== gen) return this.abortLocal(pc, stream);
    void this.signal('answer', { sdp: pc.localDescription });
  }

  decline(): void {
    if (this.familyId && this.peerId && this.callId) {
      sendSignal(this.familyId, { to: this.peerId, call: this.callId, kind: 'decline', data: null });
    }
    this.end('Отклонено');
  }

  hangup(): void {
    const outgoing = this.snap.status === 'outgoing';
    if (this.familyId && this.peerId && this.callId) {
      sendSignal(this.familyId, {
        to: this.peerId,
        call: this.callId,
        kind: outgoing ? 'cancel' : 'hangup',
        data: null,
      });
    }
    this.end(outgoing ? 'Отменено' : 'Звонок завершён');
  }

  toggleMute(): void {
    if (!this.localStream) return;
    const newMuted = !this.snap.muted;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !newMuted;
    this.set({ muted: newMuted });
  }

  // Закрыть висящие пуш-карточки «звонит» ТЕКУЩЕГО дозвона: на Android
  // requireInteraction держит их до ручного смахивания даже после ответа.
  // Только свой callId — иначе стёрли бы непросмотренный «пропущенный звонок»
  // другого вызова. На iOS getNotifications исторически пуст — тихий no-op.
  private clearCallNotifications(callId: string | null): void {
    if (!callId) return;
    const tag = 'family-call:' + callId;
    try {
      void navigator.serviceWorker?.ready.then(async (reg) => {
        const ns = await reg.getNotifications();
        for (const n of ns) if (n.tag === tag) n.close();
      });
    } catch {
      /* SW недоступен (например, не-PWA контекст) */
    }
  }

  // Определяем, умеет ли платформа переключать маршрут. Зовётся после getMic —
  // до выдачи разрешения лейблы устройств пустые.
  private async probeSpeaker(): Promise<void> {
    this.speakerMode = 'none';
    this.receiverSinkId = null;
    this.earpieceInputId = null;
    this.speakerInputId = null;
    // iOS/Safari: телефонная аудиосессия. Дефолт — «к уху», как обычный звонок;
    // заодно iOS перестаёт глушить микрофон при сворачивании (VoIP-поведение).
    const as = this.audioSession();
    if (as) {
      this.speakerMode = 'audioSession';
      try {
        as.type = 'play-and-record';
      } catch {
        /* тип не поддержан — остаёмся на системном дефолте */
      }
      // AirPlay-пикер WebKit: системный выбор выхода (AirPods/колонка/телефон).
      const el = this.ensureAudio() as HTMLAudioElement & {
        webkitShowPlaybackTargetPicker?: () => void;
      };
      const hasPicker = typeof el.webkitShowPlaybackTargetPicker === 'function';
      this.set({ speakerAvailable: true, speakerOn: false, outputPickerAvailable: hasPicker });
      return;
    }
    const gen = this.gen;
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      if (this.gen !== gen) return; // звонок снесли, пока перечисляли устройства
      const audioEl = this.ensureAudio() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof audioEl.setSinkId === 'function') {
        const outs = devs.filter((d) => d.kind === 'audiooutput');
        const receiver = outs.find((d) => /receiver|earpiece|приёмник|приемник|трубк/i.test(d.label));
        if (receiver && outs.length >= 2) {
          this.speakerMode = 'sinkId';
          this.receiverSinkId = receiver.deviceId;
        }
      }
      if (this.speakerMode === 'none') {
        const ins = devs.filter((d) => d.kind === 'audioinput');
        const earpiece = ins.find((d) => d.label === 'Headset earpiece');
        const speaker = ins.find((d) => d.label === 'Speakerphone');
        if (earpiece && speaker) {
          this.speakerMode = 'inputSwitch';
          this.earpieceInputId = earpiece.deviceId;
          this.speakerInputId = speaker.deviceId;
        }
      }
    } catch {
      /* enumerateDevices недоступен — остаёмся без кнопки */
    }
    this.set({ speakerAvailable: this.speakerMode !== 'none', speakerOn: true });
  }

  /** Системный выбор аудиовыхода (AirPlay-пикер): AirPods, наушники, колонки.
   *  Требует жеста пользователя — вызывается из кнопки оверлея. */
  showOutputPicker(): void {
    const el = this.ensureAudio() as HTMLAudioElement & {
      webkitShowPlaybackTargetPicker?: () => void;
    };
    try {
      el.webkitShowPlaybackTargetPicker?.();
    } catch {
      /* пикер недоступен */
    }
  }

  async toggleSpeaker(): Promise<void> {
    const wantOn = !this.snap.speakerOn;
    if (this.speakerMode === 'audioSession') {
      const as = this.audioSession();
      if (!as) return;
      try {
        as.type = wantOn ? 'playback' : 'play-and-record';
      } catch {
        return; // маршрут не сменился — состояние кнопки не трогаем
      }
      this.set({ speakerOn: wantOn });
      return;
    }
    if (this.speakerMode === 'sinkId') {
      const audioEl = this.ensureAudio() as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> };
      const target = wantOn ? '' : this.receiverSinkId!;
      try {
        await audioEl.setSinkId(target);
      } catch {
        try {
          await audioEl.setSinkId(target); // Safari 26.0: первый switch мог падать — одна повторная попытка
        } catch {
          return; // маршрут не сменился — состояние кнопки не трогаем
        }
      }
      this.set({ speakerOn: wantOn });
    } else if (this.speakerMode === 'inputSwitch') {
      const targetId = wantOn ? this.speakerInputId : this.earpieceInputId;
      if (!targetId || !this.pc || !this.localStream) return;
      const gen = this.gen;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: targetId },
            // echoCancellation обязателен: только с ним Chrome держит Android
            // в communication-режиме, где и работает переключение маршрута.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch {
        return;
      }
      if (this.gen !== gen || !this.pc || !this.localStream) {
        for (const t of stream.getTracks()) t.stop();
        return; // звонок снесли, пока меняли устройство
      }
      const newTrack = stream.getAudioTracks()[0];
      newTrack.enabled = !this.snap.muted;
      const sender = this.pc.getSenders().find((s) => s.track?.kind === 'audio');
      try {
        await sender?.replaceTrack(newTrack);
      } catch {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = stream;
      this.set({ speakerOn: wantOn });
    }
  }

  // === Входящие сигналы (роутятся из CallRunner по каждой семье) ===
  async onSignal(familyId: string, f: SignalFrame): Promise<void> {
    if (!f.from || !f.call) return;
    const c = await getFamilyConfig(familyId);
    if (!c) return;
    if (f.to && f.to !== c.selfMemberId) return; // не мне (страховка; сервер уже таргетит)

    if (f.kind === 'offer') {
      // Повтор offer текущего входящего — просто обновим SDP.
      if (this.snap.status === 'incoming' && this.callId === f.call) {
        this.pendingOffer = f.data;
        return;
      }
      // Занят другим звонком — вежливо отказываем.
      const busy = this.snap.status !== 'idle' && this.snap.status !== 'ended';
      if (busy && this.callId !== f.call) {
        sendSignal(familyId, { to: f.from, call: f.call, kind: 'busy', data: null });
        return;
      }
      if (busy) return;
      this.cancelDismiss();
      this.familyId = familyId;
      this.peerId = f.from;
      this.callId = f.call;
      this.role = 'callee';
      this.pendingOffer = f.data;
      this.pendingCandidates = [];
      const name = await this.peerName(f.from);
      this.set({ status: 'incoming', familyId, peerId: f.from, peerName: name, muted: false, startedAt: null, endReason: null });
      startRingtone();
      this.ringTimer = setTimeout(() => this.end('Пропущенный звонок'), RING_TIMEOUT_MS);
      return;
    }

    if (f.call !== this.callId) return; // сигнал не текущего звонка

    if (f.kind === 'answer') {
      if (this.role !== 'caller' || !this.pc || !f.data) return;
      const pc = this.pc;
      this.clearResend();
      const ans = await decryptJSON<{ sdp: RTCSessionDescriptionInit }>(c.familyKey, f.data);
      if (this.pc !== pc) return; // звонок снесён/заменён, пока расшифровывали
      try {
        await pc.setRemoteDescription(ans.sdp);
      } catch {
        return; // pc закрыт во время await
      }
      if (this.pc !== pc) return;
      await this.drainCandidates();
      if (this.snap.status === 'outgoing') {
        this.set({ status: 'connecting' });
        this.armConnTimeout();
      }
    } else if (f.kind === 'ice') {
      if (!f.data) return;
      const { candidate } = await decryptJSON<{ candidate: RTCIceCandidateInit }>(c.familyKey, f.data);
      if (this.pc && this.pc.remoteDescription) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch {
          /* устаревший кандидат */
        }
      } else {
        this.pendingCandidates.push(candidate);
      }
    } else if (f.kind === 'decline') {
      this.end('Отклонено');
    } else if (f.kind === 'busy') {
      this.end('Занято');
    } else if (f.kind === 'hangup' || f.kind === 'cancel') {
      this.end(this.snap.status === 'incoming' ? 'Пропущенный звонок' : 'Звонок завершён');
    }
  }

  private clearResend() {
    if (this.resendTimer) {
      clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
  }

  private cancelDismiss() {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private end(reason: string) {
    // Журнал звонка в ленту чата пишет ТОЛЬКО звонящий — иначе обе стороны
    // продублировали бы одно событие. Сервер писать не может (E2E: у него нет
    // ключа), поэтому кейс «звонящий умер до таймаута» остаётся без записи —
    // его прикрывает missed-пуш от alarm'а.
    if (this.role === 'caller' && this.familyId && reason !== 'Нет доступа к микрофону') {
      const dur = this.snap.startedAt ? Date.now() - this.snap.startedAt : null;
      const s = dur ? Math.max(1, Math.floor(dur / 1000)) : 0;
      void sendSystemMessage(
        this.familyId,
        dur
          ? `📞 Аудиозвонок · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
          : '📵 Пропущенный аудиозвонок',
      );
    }
    this.gen++; // инвалидирует любой in-flight setup (getMic/createPc/waitIce)
    stopRingtone();
    this.clearCallNotifications(this.callId);
    this.clearResend();
    this.clearConnTimeout();
    this.disarmMicRecovery();
    // Вернуть системной аудиосессии обычный режим (iOS).
    {
      const as = this.audioSession();
      if (as) {
        try {
          as.type = 'auto';
        } catch {
          /* не поддержано */
        }
      }
    }
    if (this.ringTimer) {
      clearTimeout(this.ringTimer);
      this.ringTimer = null;
    }
    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      } catch {
        /* уже закрыт */
      }
      this.pc = null;
    }
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    if (this.audioEl) {
      try {
        this.audioEl.srcObject = null;
      } catch {
        /* ignore */
      }
      // Скрытый <audio> живёт между звонками: вернуть выход на системный дефолт
      // (громкоговоритель), иначе «К уху» прошлого звонка молча унаследуется
      // следующим при UI, показывающем «Динамик».
      const el = this.audioEl as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof el.setSinkId === 'function') void el.setSinkId('').catch(() => {});
    }
    this.pendingOffer = null;
    this.pendingCandidates = [];
    this.familyId = null;
    this.peerId = null;
    this.callId = null;
    this.role = null;
    this.speakerMode = 'none';
    this.receiverSinkId = null;
    this.earpieceInputId = null;
    this.speakerInputId = null;
    this.set({ status: 'ended', endReason: reason, muted: false, speakerOn: true, speakerAvailable: false, outputPickerAvailable: false, startedAt: null });
    // Показать причину (~2.5с), затем скрыть оверлей.
    this.cancelDismiss();
    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = null;
      if (this.snap.status === 'ended') {
        this.snap = { ...IDLE };
        this.listeners.forEach((l) => l());
      }
    }, 2500);
  }
}

export const callManager = new CallManager();

export function useCall(): CallSnapshot {
  return useSyncExternalStore(callManager.subscribe, callManager.getSnapshot);
}
