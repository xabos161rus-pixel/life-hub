// Инкрементальный парсер SSE-потока OpenAI chat completions.
//
// Worker отдаёт поток провайдера байт в байт (§4.2 плана), формат разбирает
// клиент. Парсер отделён от fetch и написан на «скармливай куски любого
// размера»: сетевые чанки рвут события где угодно — посреди строки, посреди
// UTF-8 символа (это решает TextDecoder со stream:true снаружи), между
// `data:` и телом. Всё состояние — в буфере строки.
//
// Понимает ровно то, что нужно чату:
//   data: {"choices":[{"delta":{"content":"..."},"finish_reason":null}],...}
//   data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2}}
//   data: [DONE]
// Остальные поля события игнорируются. Событий `event:`/`id:` у completions
// не бывает, но строки без `data:` на всякий случай просто пропускаются.

export interface StreamState {
  buffer: string;
  content: string;
  finishReason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  done: boolean;
}

export function newStreamState(): StreamState {
  return { buffer: '', content: '', finishReason: null, tokensIn: null, tokensOut: null, done: false };
}

interface OpenAiChunk {
  choices?: {
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/** Скормить кусок потока. Возвращает текст, ДОБАВИВШИЙСЯ этим куском. */
export function feedStream(st: StreamState, chunk: string): string {
  st.buffer += chunk;
  let added = '';
  // Событие SSE заканчивается пустой строкой, но completions шлют по одному
  // `data:` на событие — разбор построчно проще и покрывает оба случая.
  for (;;) {
    const nl = st.buffer.indexOf('\n');
    if (nl < 0) break;
    const line = st.buffer.slice(0, nl).replace(/\r$/, '');
    st.buffer = st.buffer.slice(nl + 1);
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    if (payload === '[DONE]') {
      st.done = true;
      continue;
    }
    let obj: OpenAiChunk;
    try {
      obj = JSON.parse(payload) as OpenAiChunk;
    } catch {
      // Обрезанное посередине событие в конец потока — не повод терять
      // накопленный текст; просто пропускаем неразобранную строку.
      continue;
    }
    const choice = obj.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta) {
      st.content += delta;
      added += delta;
    }
    if (choice?.finish_reason) st.finishReason = choice.finish_reason;
    // usage приходит финальным чанком при stream_options.include_usage —
    // как правило, с пустым choices.
    if (obj.usage) {
      if (typeof obj.usage.prompt_tokens === 'number') st.tokensIn = obj.usage.prompt_tokens;
      if (typeof obj.usage.completion_tokens === 'number') st.tokensOut = obj.usage.completion_tokens;
    }
  }
  return added;
}
