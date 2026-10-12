import { Module } from '@nestjs/common';
import { ReglasController } from './reglas.controller.js';
import { ReglasService } from './reglas.service.js';
import { SancionesController } from './sanciones.controller.js';
import { SancionesService } from './sanciones.service.js';

@Module({
  controllers: [ReglasController, SancionesController],
  providers: [ReglasService, SancionesService],
  // `InfraccionesService` (docs/plan-en-vivo-alertas.md) crea sanciones reusando `crearEnTx`.
  exports: [SancionesService],
})
export class ReglasModule {}
