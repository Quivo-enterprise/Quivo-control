import { Module } from '@nestjs/common';
import { AuthMovilModule } from '../auth-movil/auth-movil.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { VehiculoFotoMovilController } from './vehiculo-foto-movil.controller.js';
import { VehiculoFotoService } from './vehiculo-foto.service.js';
import { VehiculosController } from './vehiculos.controller.js';
import { VehiculosService } from './vehiculos.service.js';

@Module({
  imports: [AuthMovilModule, StorageModule],
  controllers: [VehiculosController, VehiculoFotoMovilController],
  providers: [VehiculosService, VehiculoFotoService],
})
export class VehiculosModule {}
