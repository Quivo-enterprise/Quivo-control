import { Module } from '@nestjs/common';
import { NotificacionesWorkerService } from './notificaciones.worker.service.js';

@Module({ providers: [NotificacionesWorkerService] })
export class NotificacionesWorkerModule {}
