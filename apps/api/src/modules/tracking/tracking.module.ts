import { Module } from '@nestjs/common';
import { AuthMovilModule } from '../auth-movil/index.js';
import { PaqueteDiaController } from './paquete-dia.controller.js';
import { PaqueteDiaService } from './paquete-dia.service.js';
import { RuteoController } from './ruteo.controller.js';
import { RuteoService } from './ruteo.service.js';
import { VecinosRutaController } from './vecinos-ruta.controller.js';
import { VecinosRutaService } from './vecinos-ruta.service.js';

// QUI-236: paquete del día (asignación + geometría offline). La ingesta GPS/worker
// (RF-58..66) llega en QUI-241. RuteoService: ruteo real sobre calles vía OSRM self-hosted.
@Module({
  imports: [AuthMovilModule],
  controllers: [PaqueteDiaController, RuteoController, VecinosRutaController],
  providers: [PaqueteDiaService, RuteoService, VecinosRutaService],
})
export class TrackingModule {}
