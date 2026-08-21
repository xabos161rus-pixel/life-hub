// Статус соединения для подзаголовка шапки: «на связи» / «подключение…» /
// «не в сети».
//
// Отдельным файлом, а не рядом с FamilyScreen: файл, который экспортирует и
// компонент, и хук, ломает горячую перезагрузку — при правке хука Vite
// перезагружает страницу целиком вместо обновления компонента.
//
// Только соединение, без счётчиков: присутствие СОБЕСЕДНИКОВ (кто в сети,
// «был(а) в сети…», «печатает») — зона ответственности строки внутри ChatTab,
// второй счётчик был бы дублем.

import { useEffect, useState } from 'react';
import { connectionState, subscribeConnection } from '../../lib/family/familyChat';
import { t } from '../../lib/i18n';

const CONN_LABEL: Record<string, string> = {
  offline: 'не в сети',
  connecting: 'подключение…',
  online: 'на связи',
};

export function useFamilyStatusLine(familyId: string): string {
  const [conn, setConn] = useState(connectionState(familyId));
  useEffect(() => subscribeConnection(familyId, setConn), [familyId]);
  return t(CONN_LABEL[conn]);
}
