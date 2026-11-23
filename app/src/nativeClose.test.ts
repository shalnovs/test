import { expect, it, vi } from 'vitest';
import caps from '../src-tauri/capabilities/default.json';
import { bindCloseGuard } from './nativeClose';
it('allows a clean close and awaits the native unsaved-text decision', async () => {
  let handler: any,
    dirty = false;
  const confirm = vi.fn().mockResolvedValue(false),
    error = vi.fn(),
    off = vi.fn();
  const dispose = bindCloseGuard(
    async (h) => {
      handler = h;
      return off;
    },
    confirm,
    () => dirty,
    error,
  );
  await Promise.resolve();
  const preventDefault = vi.fn();
  await handler({ preventDefault });
  expect(preventDefault).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  dirty = true;
  await handler({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  confirm.mockResolvedValue(true);
  preventDefault.mockClear();
  await handler({ preventDefault });
  expect(preventDefault).not.toHaveBeenCalled();
  dispose();
  expect(off).toHaveBeenCalledOnce();
});
it('cleans up delayed subscriptions and prevents a disposed handler from closing the window', async () => {
  let resolve: any, handler: any;
  const off = vi.fn();
  const dispose = bindCloseGuard(
    (h) => {
      handler = h;
      return new Promise((r) => {
        resolve = r;
      });
    },
    vi.fn(),
    () => false,
    vi.fn(),
  );
  dispose();
  resolve(off);
  await Promise.resolve();
  expect(off).toHaveBeenCalledOnce();
  const preventDefault = vi.fn();
  await handler({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
});
it('prevents duplicate dialogs and preserves edits if confirmation fails', async () => {
  let handler: any, reject: any;
  const confirm = vi.fn(
      () =>
        new Promise<boolean>((_, r) => {
          reject = r;
        }),
    ),
    error = vi.fn();
  bindCloseGuard(
    async (h) => {
      handler = h;
      return () => {};
    },
    confirm,
    () => true,
    error,
  );
  const first = vi.fn(),
    second = vi.fn();
  const waiting = handler({ preventDefault: first });
  await handler({ preventDefault: second });
  expect(confirm).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  reject('native error');
  await waiting;
  expect(first).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalled();
});
it('grants the native close handler permission to destroy the window and show confirmation', () => {
  expect(caps.permissions).toContain('core:window:allow-destroy');
  expect(caps.permissions).toContain('dialog:allow-confirm');
});
