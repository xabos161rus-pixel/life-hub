import { Mic } from 'lucide-react';
import { isIOS, useSpeechInput } from '../../hooks/useSpeechInput';

interface Props {
  /** получает распознанный текст — обычно дописывает в поле */
  onText: (text: string) => void;
  className?: string;
}

/**
 * Кнопка голосового ввода. В Chrome/Android реально распознаёт речь.
 * На iOS Web Speech API недоступен — подсказываем диктовку с клавиатуры
 * (микрофон рядом с пробелом), вместо неработающей кнопки.
 */
export function MicButton({ onText, className = '' }: Props) {
  const { listening, start, stop, supported } = useSpeechInput({ onResult: onText });

  if (!supported) {
    if (isIOS()) {
      return (
        <button
          type="button"
          aria-label="Голосовой ввод"
          onClick={() =>
            alert(
              'Для диктовки нажмите 🎤 на клавиатуре iPhone (рядом с пробелом) и говорите — текст появится в поле.',
            )
          }
          className={`shrink-0 rounded-full p-2 text-muted active:scale-90 ${className}`}
        >
          <Mic size={20} />
        </button>
      );
    }
    return null;
  }

  return (
    <button
      type="button"
      aria-label={listening ? 'Остановить' : 'Голосовой ввод'}
      onClick={listening ? stop : start}
      className={`shrink-0 rounded-full p-2 transition-transform active:scale-90 ${
        listening ? 'animate-pulse bg-danger/20 text-danger' : 'text-muted'
      } ${className}`}
    >
      <Mic size={20} />
    </button>
  );
}
