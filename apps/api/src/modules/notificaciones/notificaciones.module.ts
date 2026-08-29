import { Module } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller.js';
import { NotificacionesQueue } from './notificaciones.queue.js';
import { NotificacionesService } from './notificaciones.service.js';

@Module({
  controllers: [NotificacionesController],
  providers: [NotificacionesQueue, NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
