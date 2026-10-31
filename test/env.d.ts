import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      MIGRACIONES: D1Migration[];
    }
  }
}
