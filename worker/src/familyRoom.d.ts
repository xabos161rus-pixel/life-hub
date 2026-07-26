// Типы для тестов, которые поднимают Durable Object вне Workers.
//
// Сам familyRoom.js остаётся на JavaScript: он деплоится через wrangler, и
// вводить ради него сборку TypeScript в воркере — лишний шаг между правкой и
// выкатом. Но тестам, написанным на TypeScript, нужен хоть какой-то тип, иначе
// tsc падает на неявном any.
//
// Описано ровно то, что тесты трогают: конструктор и fetch. Остальные методы
// вызываются изнутри самого класса.

export declare class FamilyRoom {
  constructor(ctx: unknown, env: unknown);
  fetch(request: Request): Promise<Response>;
}
