// src/api/base44Client.ts

// Base44 client bridge.
// In Base44 environments, the SDK is usually injected on window.
// This file makes sure the project compiles and provides a clear error if Base44 is not available.

declare global {
  interface Window {
    base44?: any;
  }
}

export const base44 = window.base44 ?? {
  entities: new Proxy(
    {},
    {
      get() {
        throw new Error(
          '[base44Client] Base44 SDK is not available (window.base44 is undefined).'
        );
      },
    }
  ),
};
