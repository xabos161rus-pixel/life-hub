import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Рендер ответа модели. Текст приходит из внешнего источника, поэтому обязательно
 * через DOMPurify — тот же приём, что в редакторе заметок. Артефакты (живой
 * рендер HTML/React в iframe) сознательно НЕ делаем: рядом в IndexedDB лежат
 * ключи синхронизации и семьи, и это самая опасная поверхность в приложении.
 */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string, {
        // Ссылки открываем в новой вкладке; на всякий случай запрещаем формы и
        // встраивание — модель может предложить их в разметке.
        FORBID_TAGS: ['form', 'input', 'button', 'iframe', 'object', 'embed', 'style'],
        FORBID_ATTR: ['style', 'onerror', 'onload'],
      }),
    [text],
  );
  return <div className="cc-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
