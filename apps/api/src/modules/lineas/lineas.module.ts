import { Module } from '@nestjs/common';
import { LineasController } from './lineas.controller.js';
import { LineasService } from './lineas.service.js';

@Module({
  controllers: [LineasController],
  providers: [LineasService],
})
export class LineasModule {}
