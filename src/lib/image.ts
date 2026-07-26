// Сжатие изображения в JPEG dataURL. Для чата держим компактно (E2E-шифротекст
// летит по WebSocket и хранится в Durable Object) — меньше сторона и качество,
// чем для «Мест».

/** Больше этого на вход не берём.
 *
 *  Не из жадности к трафику: файл сначала целиком оказывается в памяти как
 *  изображение, и снимок с современного телефона на 50 мегапикселей укладывает
 *  вкладку на слабом устройстве раньше, чем дойдёт до сжатия. Отказ с внятным
 *  текстом лучше, чем перезагрузка приложения без объяснений. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor() {
    super('Файл слишком большой');
    this.name = 'ImageTooLargeError';
  }
}

export class ImageDecodeError extends Error {
  constructor() {
    super('Не удалось открыть изображение');
    this.name = 'ImageDecodeError';
  }
}

/** Декодирование с учётом EXIF-ориентации.
 *
 *  createImageBitmap с imageOrientation:'from-image' сам разворачивает снимок
 *  по метке камеры. Через FileReader + new Image() этого не происходит:
 *  drawImage рисует пиксели как есть, и фотография, снятая вертикально,
 *  приходила собеседнику лежащей на боку — камеры телефонов почти всегда
 *  пишут кадр в альбомной ориентации и добавляют EXIF-метку поворота.
 *  Заодно экономится память: файл не превращается по дороге в base64-строку,
 *  которая на треть больше самого файла.
 *
 *  Fallback на старый путь оставлен для браузеров без поддержки опции
 *  (Safari до 15) и для форматов, которые движок не разбирает через
 *  createImageBitmap. Там ориентация может остаться неверной — это лучше,
 *  чем невозможность отправить фотографию вовсе. */
async function decode(
  file: File,
): Promise<{ width: number; height: number; draw: CanvasImageSource; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bmp.width, height: bmp.height, draw: bmp, close: () => bmp.close() };
    } catch {
      /* формат не поддержан этим движком — пробуем через <img> */
    }
  }
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(new ImageDecodeError());
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new ImageDecodeError());
    i.src = dataUrl;
  });
  return {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    draw: img,
  };
}

export async function compressImage(file: File, max = 1024, quality = 0.6): Promise<string> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageTooLargeError();

  const src = await decode(file);
  let { width, height } = src;
  if (width === 0 || height === 0) throw new ImageDecodeError();

  if (Math.max(width, height) > max) {
    const s = max / Math.max(width, height);
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageDecodeError();
  ctx.drawImage(src.draw, 0, 0, width, height);
  // Освобождаем битмап сразу: браузер держит его вне кучи JS, и сборщик до
  // него доходит не скоро — на серии из десятка фотографий это заметно.
  src.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}
