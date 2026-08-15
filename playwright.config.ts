import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, 'apps/api/.env'), override: true });

const acceptanceApiURL = process.env.ACCEPTANCE_API_URL ?? 'http://localhost:3002';
// La suite usa puertos propios: evita reutilizar chunks de un `next dev` abierto por otra
// sesión y mantiene el origen exactamente alineado con CORS del API de aceptación.
const baseURL = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3101';
const useExistingServer = process.env.CI !== 'true';

export default defineConfig({
  testDir: './tests/acceptance',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.ACCEPTANCE_BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm --filter @quivo/api build && pnpm --filter @quivo/api start',
          url: `${acceptanceApiURL}/v1/health`,
          timeout: 120_000,
          reuseExistingServer: useExistingServer,
          env: {
            PORT: new URL(acceptanceApiURL).port,
            CORS_ORIGIN: baseURL,
          },
        },
        {
          command: `pnpm --filter @quivo/web dev --port ${new URL(baseURL).port}`,
          url: baseURL,
          timeout: 120_000,
          reuseExistingServer: useExistingServer,
          env: {
            NEXT_PUBLIC_API_URL: acceptanceApiURL,
            NEXT_PUBLIC_DEV_BYPASS_AUTH: 'false',
          },
        },
      ],
});
