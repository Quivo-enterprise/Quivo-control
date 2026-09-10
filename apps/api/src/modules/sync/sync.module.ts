import { Module } from '@nestjs/common';
import { AuthMovilModule } from '../auth-movil/index.js';
import { SyncController } from './sync.controller.js';
import { SyncDeviceThrottlerGuard } from './sync-device-throttler.guard.js';
import { SyncErroresController } from './sync-errores.controller.js';
import { SyncErroresService } from './sync-errores.service.js';
import { SyncQueueService } from './sync-queue.service.js';

// QUI-240: POST /v1/sync/batches (productor). El worker consumidor (QUI-241) vive en un
// proceso separado, no en este módulo. QUI-242: GET /v1/sync-errores (solo lectura, admin).
@Module({
  imports: [AuthMovilModule],
  controllers: [SyncController, SyncErroresController],
  providers: [SyncQueueService, SyncErroresService, SyncDeviceThrottlerGuard],
})
export class SyncModule {}
