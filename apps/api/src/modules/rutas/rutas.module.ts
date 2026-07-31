import { Module } from '@nestjs/common';
import { LineaRutasController, RutasController } from './rutas.controller.js';
import { RutasService } from './rutas.service.js';
import { RutaVariantesController, VariantesController } from './variantes.controller.js';
import { VariantesService } from './variantes.service.js';
import { ParadasController, RutaParadasController } from './paradas.controller.js';
import { ParadasService } from './paradas.service.js';

// RF-24..33 (QUI-225): rutas, variantes y paradas comparten módulo — todas dependen de la
// misma geometría PostGIS y del mismo mecanismo de tenant-scoping vía `linea` (sin RLS
// propia, ver common/geo/tenant-checks.ts).
@Module({
  controllers: [
    LineaRutasController,
    RutasController,
    RutaVariantesController,
    VariantesController,
    RutaParadasController,
    ParadasController,
  ],
  providers: [RutasService, VariantesService, ParadasService],
})
export class RutasModule {}
