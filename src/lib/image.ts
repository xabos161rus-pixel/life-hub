// Сжатие изображения в JPEG dataURL. Для чата держим компактно (E2E-шифротекст
// летит по WS и хранится в DO) — меньше сторона и качество, чем для «Мест».
export async function compressImage(file: File, max = 1024, quality = 0.6): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(new Error('read'));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('decode'));
    i.src = dataUrl;
  });
  let { width, height } = img;
  if (Math.max(width, height) > max) {
    const s = max / Math.max(width, height);
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}
