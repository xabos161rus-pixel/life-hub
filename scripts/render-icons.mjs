#!/usr/bin/env node
// Пересборка иконок приложения из public/favicon.svg.
//
//   node scripts/render-icons.mjs public/favicon.svg public/icons/icon 192,512
//
// Держим в репозитории, а не гоняем разово: значок ещё будут править, а
// повторить набор размеров и правил по памяти через полгода не выйдет.
//
// Рендер SVG в PNG нужных размеров через браузер, с записью БЕЗ альфа-канала.
//
// Прозрачность в иконке приложения — дефект: iOS подкладывает под неё чёрный,
// Android — свой фон, и логотип получает кайму. Поэтому пиксели вынимаем из
// canvas и пишем своим PNG-энкодером в RGB (colortype 2), а не через
// toDataURL, который всегда отдаёт RGBA.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const [svgPath, outBase, sizesArg] = process.argv.slice(2);
const sizes = (sizesArg || '512').split(',').map(Number);
const svg = readFileSync(svgPath, 'utf8');

function writePng(path, w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 бит, truecolor без альфы
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// Путь к браузеру берём из окружения: на другой машине он другой.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
for (const size of sizes) {
  const px = await page.evaluate(async ({ svg, size }) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);
    return [...ctx.getImageData(0, 0, size, size).data];
  }, { svg, size });
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    // Сведение к непрозрачному: если альфа < 1, смешиваем с белым — но у
    // корректной иконки её быть не должно, и это видно по результату.
    const a = px[i + 3] / 255;
    rgb[j] = Math.round(px[i] * a + 255 * (1 - a));
    rgb[j + 1] = Math.round(px[i + 1] * a + 255 * (1 - a));
    rgb[j + 2] = Math.round(px[i + 2] * a + 255 * (1 - a));
  }
  writePng(`${outBase}-${size}.png`, size, size, rgb);
  console.log(`${outBase}-${size}.png`);
}
await browser.close();
