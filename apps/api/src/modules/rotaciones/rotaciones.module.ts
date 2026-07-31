import { Module } from '@nestjs/common';
import { RotacionesController } from './rotaciones.controller.js';
import { RotacionesService } from './rotaciones.service.js';
import { VencimientoProcessor } from './vencimiento.processor.js';

@Module({
  controllers: [RotacionesController],
  providers: [RotacionesService, VencimientoProcessor],
})
export class RotacionesModule {}
