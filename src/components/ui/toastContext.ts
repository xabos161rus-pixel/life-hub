import { createContext, useContext } from 'react';

// Контекст и хук вынесены из Toast.tsx: файл с компонентом должен
// экспортировать только компоненты, иначе ломается Fast Refresh
// (react-refresh/only-export-components).

export const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}
