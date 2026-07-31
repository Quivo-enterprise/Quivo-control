import { Module } from '@nestjs/common';
import { ConductoresController } from './conductores.controller.js';
import { ConductoresService } from './conductores.service.js';

@Module({
  controllers: [ConductoresController],
  providers: [ConductoresService],
})
export class ConductoresModule {}
