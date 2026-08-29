import { Module } from '@nestjs/common';
import { PlanesController } from './planes.controller.js';
import { PlanesService } from './planes.service.js';

@Module({
  controllers: [PlanesController],
  providers: [PlanesService],
  exports: [PlanesService],
})
export class PlanesModule {}
