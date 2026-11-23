import { createContext, useContext } from 'react';
import type { Archive, Item } from './api';
import type { MaterialSelection } from './materials';
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
  selectedPersonId?: string;
  selectPerson?: (id: string) => void;
  event?: (id: string) => void;
  browse?: (selection: MaterialSelection) => void;
};
export const AppContext = createContext<AppContextType>(null!);
export const useArchive = () => useContext(AppContext);
export function personById(items: Item[], id: string) {
  return items.find((p) => p.id === id);
}
