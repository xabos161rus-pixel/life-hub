// Клиент к своему AI-прокси на Cloudflare Worker.
//
// Ключ провайдера живёт в секретах воркера и на устройство не попадает: рядом
// в IndexedDB лежат ключи синхронизации и семьи, и лишняя поверхность там не
// нужна. Авторизация — тем же аккаунтом, что и синхронизация (X-Account +
// Bearer), поэтому раздел ИИ требует включённого синка.

import { WORKER_URL } from '../sync';
import { t } from '../i18n';
import { getSyncConfig } from '../syncState';

export interface AiUsage {
  in: number;
  out: number;
}

export interface AiReply {
  content: string;
  model: string;
  usage: AiUsage;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AiErrorCode =
  | 'no_account' // синхронизация не настроена — нечем авторизоваться
  | 'unauthorized' // воркер не признал аккаунт
  | 'forbidden' // аккаунт не в списке разрешённых
  | 'bad_request'
  | 'rate_limit'
  | 'provider' // ошибка на стороне провайдера
  | 'network'
  | 'aborted';

export class AiError extends Error {
  // Поле объявлено явно, а не через parameter property: в проекте включён
  // erasableSyntaxOnly, и сокращённая форма конструктора там запрещена.
  code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiError';
    this.code = code;
  }
}

/** Текст ошибки для показа пользователю — без кодов и стектрейсов. */
export function aiErrorText(e: unknown): string {
  if (e instanceof AiError) {
    switch (e.code) {
      case 'no_account':
        return t('Включите синхронизацию в Настройках — она нужна для авторизации.');
      case 'unauthorized':
        return t('Сервер не признал аккаунт. Проверьте синхронизацию.');
      case 'forbidden':
        return t('Аккаунт не в списке разрешённых на сервере.');
      case 'rate_limit':
        return t('Слишком часто. Подождите немного.');
      case 'provider':
        return t('Провайдер отказал: {msg}', { msg: e.message });
      case 'network':
        return t('Нет связи с сервером.');
      case 'aborted':
        return t('Запрос отменён.');
      default:
        return e.message;
    }
  }
  return t('Неизвестная ошибка.');
}

export async function requestChat(params: {
  messages: AiChatMessage[];
  systemPrompt?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<AiReply> {
  const c = await getSyncConfig();
  if (!c) throw new AiError('no_account', 'синхронизация не настроена');

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/ai/chat`, {
      method: 'POST',
      headers: {
        'X-Account': c.accountId,
        Authorization: `Bearer ${c.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: params.messages,
        systemPrompt: params.systemPrompt || '',
        model: params.model,
      }),
      signal: params.signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw new AiError('aborted', 'отменено');
    throw new AiError('network', 'нет связи');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    const msg = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
    if (res.status === 401) throw new AiError('unauthorized', msg);
    if (res.status === 403) throw new AiError('forbidden', msg);
    if (res.status === 400) throw new AiError('bad_request', msg);
    if (res.status === 429) throw new AiError('rate_limit', msg);
    throw new AiError('provider', msg);
  }

  const data = (await res.json()) as Partial<AiReply>;
  if (typeof data.content !== 'string') throw new AiError('provider', 'пустой ответ');
  return {
    content: data.content,
    model: typeof data.model === 'string' ? data.model : 'unknown',
    usage: {
      in: Number(data.usage?.in) || 0,
      out: Number(data.usage?.out) || 0,
    },
  };
}
