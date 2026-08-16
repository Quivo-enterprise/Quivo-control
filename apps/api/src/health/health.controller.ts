import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService, HealthStatus } from './health.service.js';

// QUI-354: el ThrottlerGuard global (app.module.ts, QUI-251, 100 req/min/IP) NO debe
// aplicar acá — Cloud Run llama a /v1/health/live repetidamente como startup/liveness
// probe. Bajo carga real, las requests de usuarios y las de la probe comparten la misma
// key de rate limit (aun con trustProxy corregido, la IP del health-checker de Cloud Run
// es una sola y compite con tráfico real); un 429 en la liveness probe se interpreta como
// probe fallida y Cloud Run reinicia el contenedor. Sin límite acá: no hay body sensible
// que proteger y el propio endpoint es intencionalmente liviano.
@SkipThrottle()
@Controller('health')
export class HealthController {
  // `@Inject(...)` explícito en todos los controllers/guards/services de esta app: `tsx`
  // (usado por `dev`/`dev:worker`) no emite `design:paramtypes` de forma confiable —
  // limitación conocida de esbuild (evanw/esbuild#257), no reproduce en producción
  // (`start`/`start:worker` usan `tsc` real). Ver detalle en `health/health.service.ts`.
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  // QUI-354: liveness — sólo confirma que el proceso Nest/Fastify responde, sin tocar
  // Postgres/Redis. Cloud Run reinicia el contenedor si esto falla, así que no debe
  // depender de dependencias externas: un blip de red hacia la DB no es un problema de
  // "¿el proceso está vivo?", es un problema de "¿puede recibir tráfico ahora mismo?"
  // (eso es `ready()` abajo) — mezclarlos dispara reinicios de contenedor inútiles.
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // QUI-354: readiness — confirma que las dependencias (DB, Redis) están disponibles.
  // Cloud Run usa esto para decidir si el contenedor puede recibir tráfico (arranque en
  // frío, rolling deploy): 503 mientras alguna dependencia no esté lista.
  @Get('ready')
  async ready(): Promise<HealthStatus> {
    return this.runReadinessCheck();
  }

  // Compat: `GET /v1/health` (sin sufijo) es el endpoint histórico — documentado en
  // apps/api/README.md y usado por `playwright.config.ts` (`webServer.url`) para esperar a
  // que la API esté lista antes de correr los tests de aceptación. Mismo comportamiento
  // que `ready()`; se mantiene tal cual para no romper a ninguno de los dos consumidores.
  @Get()
  async check(): Promise<HealthStatus> {
    return this.runReadinessCheck();
  }

  private async runReadinessCheck(): Promise<HealthStatus> {
    const result = await this.healthService.check();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
