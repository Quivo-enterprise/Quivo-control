import { Module } from '@nestjs/common';
import { AuthMovilController, PerfilMovilController } from './auth-movil.controller.js';
import { AuthMovilGuard } from './auth-movil.guard.js';
import { AuthMovilService } from './auth-movil.service.js';
import { SyncDeviceThrottlerGuard } from '../sync/sync-device-throttler.guard.js';
import { CredencialesMovilesController } from './credenciales-moviles.controller.js';

@Module({
  controllers: [AuthMovilController, PerfilMovilController, CredencialesMovilesController],
  providers: [AuthMovilService, AuthMovilGuard, SyncDeviceThrottlerGuard],
  exports: [AuthMovilService, AuthMovilGuard],
})
export class AuthMovilModule {}
