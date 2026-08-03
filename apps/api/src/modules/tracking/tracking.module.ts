import { Module } from '@nestjs/common';
import { AuthMovilModule } from '../auth-movil/index.js';
import { PaqueteDiaController } from './paquete-dia.controller.js';
import { PaqueteDiaService } from './paquete-dia.service.js';

// QUI-236: paquete del día (asignación + geometría offline). La ingesta GPS/worker
// (RF-58..66) llega en QUI-241.
@Module({
  imports: [AuthMovilModule],
  controllers: [PaqueteDiaController],
  providers: [PaqueteDiaService],
})
export class TrackingModule {}
