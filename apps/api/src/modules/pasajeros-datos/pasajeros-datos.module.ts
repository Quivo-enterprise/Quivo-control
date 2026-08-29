import { Module } from '@nestjs/common';
import { PlanesModule } from '../planes/planes.module.js';
import { PasajerosDatosController } from './pasajeros-datos.controller.js';
import { PasajerosDatosService } from './pasajeros-datos.service.js';

@Module({
  imports: [PlanesModule],
  controllers: [PasajerosDatosController],
  providers: [PasajerosDatosService],
})
export class PasajerosDatosModule {}
