import { Module } from '@nestjs/common';
import { AuthMovilController, PerfilMovilController } from './auth-movil.controller.js';
import { AuthMovilGuard } from './auth-movil.guard.js';
import { AuthMovilService } from './auth-movil.service.js';
import { CredencialesMovilesController } from './credenciales-moviles.controller.js';
import { FotoVehiculoThrottlerGuard } from './foto-vehiculo-throttler.guard.js';
import { SyncDeviceThrottlerGuard } from './sync-device-throttler.guard.js';

@Module({
  controllers: [AuthMovilController, PerfilMovilController, CredencialesMovilesController],
  providers: [AuthMovilService, AuthMovilGuard, SyncDeviceThrottlerGuard, FotoVehiculoThrottlerGuard],
  exports: [AuthMovilService, AuthMovilGuard, SyncDeviceThrottlerGuard, FotoVehiculoThrottlerGuard],
})
export class AuthMovilModule {}
