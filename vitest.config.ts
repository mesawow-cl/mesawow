import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migraciones = await readD1Migrations('migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        // Las pruebas nunca usan claves reales de .dev.vars: sin Brevo, ningún envío sale de verdad.
        miniflare: { bindings: { MIGRACIONES: migraciones, BREVO_API_KEY: '', BREVO_WEBHOOK_CLAVE: '', GOOGLE_CLIENT_SECRET: '' } },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/preparar.ts'],
    },
  };
});
