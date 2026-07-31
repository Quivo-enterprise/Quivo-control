import { Module } from '@nestjs/common';
import { RotacionesController } from './rotaciones.controller.js';
import { RotacionesService } from './rotaciones.service.js';

@Module({
  controllers: [RotacionesController],
  providers: [RotacionesService],
})
export class RotacionesModule {}
