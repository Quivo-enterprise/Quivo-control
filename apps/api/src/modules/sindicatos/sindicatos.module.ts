import { Module } from '@nestjs/common';
import { SindicatosController } from './sindicatos.controller.js';
import { SindicatosService } from './sindicatos.service.js';

@Module({
  controllers: [SindicatosController],
  providers: [SindicatosService],
})
export class SindicatosModule {}
