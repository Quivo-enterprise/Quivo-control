import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { HealthService, HealthStatus } from './health.service.js';

@Controller('health')
export class HealthController {
  // `@Inject(...)` explícito en todos los controllers/guards/services de esta app: `tsx`
  // (usado por `dev`/`dev:worker`) no emite `design:paramtypes` de forma confiable —
  // limitación conocida de esbuild (evanw/esbuild#257), no reproduce en producción
  // (`start`/`start:worker` usan `tsc` real). Ver detalle en `health/health.service.ts`.
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const result = await this.healthService.check();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
