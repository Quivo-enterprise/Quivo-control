import { Module } from '@nestjs/common';
import { PasajerosController } from './pasajeros.controller.js';
import { PasajerosService } from './pasajeros.service.js';

@Module({
  controllers: [PasajerosController],
  providers: [PasajerosService],
})
export class PasajerosModule {}
