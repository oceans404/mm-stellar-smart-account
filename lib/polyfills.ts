// With ProvidePlugin in next.config.mjs, `Buffer` is auto-injected wherever
// it's referenced in the client bundle. This file is a no-op safety net
// that pins the global explicitly for any code path that expects it on
// globalThis directly.
import { Buffer } from 'buffer';
if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer === 'undefined') {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}
export {};
