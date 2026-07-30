import { Module } from '@nestjs/common';
import { VehiculosController } from './vehiculos.controller.js';
import { VehiculosService } from './vehiculos.service.js';

@Module({
  controllers: [VehiculosController],
  providers: [VehiculosService],
})
export class VehiculosModule {}
