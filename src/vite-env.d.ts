/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** Метка сборки (подставляется в vite.config.ts). Показывается в Настройках,
 *  чтобы отличить настоящий баг от старой закэшированной версии PWA. */
declare const __BUILD_ID__: string;
