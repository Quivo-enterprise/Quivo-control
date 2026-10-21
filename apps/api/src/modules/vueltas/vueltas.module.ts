import { Module } from '@nestjs/common';
import { AuthMovilModule } from '../auth-movil/index.js';
import { SalidasModule } from '../salidas/index.js';
import { VueltasMovilController } from './vueltas-movil.controller.js';
import { VueltasService } from './vueltas.service.js';

// docs/plan-molinos-designacion.md, F1: designación a Molinos, vuelta actual / acuse del chofer
// y resumen por línea. Las vueltas las escribe el worker de ingesta (ingesta-worker/).
@Module({
  imports: [AuthMovilModule, SalidasModule],
  controllers: [VueltasMovilController],
  providers: [VueltasService],
  exports: [VueltasService],
})
export class VueltasModule {}
