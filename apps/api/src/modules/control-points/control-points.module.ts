import { Module } from '@nestjs/common';
import { ControlPointsController, RutaControlPointsController } from './control-points.controller.js';
import { ControlPointsService } from './control-points.service.js';

@Module({
  controllers: [RutaControlPointsController, ControlPointsController],
  providers: [ControlPointsService],
})
export class ControlPointsModule {}
