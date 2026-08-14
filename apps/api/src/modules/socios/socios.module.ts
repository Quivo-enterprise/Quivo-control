import { Module } from '@nestjs/common';
import { SociosController } from './socios.controller.js';
import { SociosService } from './socios.service.js';

@Module({
  controllers: [SociosController],
  providers: [SociosService],
})
export class SociosModule {}
