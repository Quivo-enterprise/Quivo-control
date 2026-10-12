import { Module } from '@nestjs/common';
import { ReglasModule } from '../reglas/reglas.module.js';
import { InfraccionesController } from './infracciones.controller.js';
import { InfraccionesService } from './infracciones.service.js';

@Module({
  imports: [ReglasModule],
  controllers: [InfraccionesController],
  providers: [InfraccionesService],
})
export class InfraccionesModule {}
