import { isTauri } from '@tauri-apps/api/core';
type Request = { preventDefault: () => void };
export function bindCloseGuard(
  subscribe: (handler: (e: Request) => Promise<void>) => Promise<() => void>,
  confirmExit: () => Promise<boolean>,
  dirty: () => boolean,
  onError: (error: unknown) => void,
) {
  let disposed = false,
    unlisten: (() => void) | undefined,
    confirming = false;
  subscribe(async (e) => {
    if (disposed) {
      e.preventDefault();
      return;
    }
    if (!dirty()) return;
    if (confirming) {
      e.preventDefault();
      return;
    }
    confirming = true;
    try {
      if (!(await confirmExit())) e.preventDefault();
    } catch (error) {
      e.preventDefault();
      onError(error);
    } finally {
      confirming = false;
    }
  })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch(onError);
  return () => {
    disposed = true;
    unlisten?.();
  };
}
export function installNativeClose(onError: (error: unknown) => void) {
  if (!isTauri()) return () => {};
  return bindCloseGuard(
    async (handler) => (await import('@tauri-apps/api/window')).getCurrentWindow().onCloseRequested(handler),
    async () =>
      (await import('@tauri-apps/plugin-dialog')).confirm(
        'В тексте есть несохранённые изменения. Закрыть приложение без сохранения?',
        { title: 'Закрыть Родословную', kind: 'warning' },
      ),
    () => !!window.__archiveDirty,
    onError,
  );
}
