import { Module } from '@nestjs/common';
import { AuthMovilModule } from '../auth-movil/index.js';
import { FilaService } from './fila.service.js';
import { FrecuenciasService } from './frecuencias.service.js';
import { GruposService } from './grupos.service.js';
import { GruposVehiculoController } from './grupos-vehiculo.controller.js';
import { SalidasMovilController } from './salidas-movil.controller.js';
import { SalidasPanelController } from './salidas-panel.controller.js';

// Fila de salida con frecuencias en la terminal. El backstop del worker de ingesta
// (`ingesta-worker/fila-backstop.ts`) y el logout móvil escriben la tabla sin pasar por este módulo.
@Module({
  imports: [AuthMovilModule],
  controllers: [SalidasMovilController, SalidasPanelController, GruposVehiculoController],
  providers: [FilaService, FrecuenciasService, GruposService],
  exports: [FilaService],
})
export class SalidasModule {}
