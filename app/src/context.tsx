import { createContext, useContext } from 'react';
import type { Archive, Item } from './api';
export type AppContextType = {
  archive: Archive;
  reload: () => Promise<void>;
  run: <T>(action: () => Promise<T>, message?: string) => Promise<T | undefined>;
  notify: (message: string) => void;
  person: (id: string) => void;
  photo: (id: string) => void;
  text: (id: string) => void;
  navigate: (page: string) => void;
  busy: boolean;
};
export const AppContext = createContext<AppContextType>(null!);
export const useArchive = () => useContext(AppContext);
export function personById(items: Item[], id: string) {
  return items.find((p) => p.id === id);
}
