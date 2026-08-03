import { Module } from '@nestjs/common';
import { AuthMovilController } from './auth-movil.controller.js';
import { AuthMovilGuard } from './auth-movil.guard.js';
import { AuthMovilService } from './auth-movil.service.js';
import { CredencialesMovilesController } from './credenciales-moviles.controller.js';

@Module({
  controllers: [AuthMovilController, CredencialesMovilesController],
  providers: [AuthMovilService, AuthMovilGuard],
  exports: [AuthMovilService, AuthMovilGuard],
})
export class AuthMovilModule {}
