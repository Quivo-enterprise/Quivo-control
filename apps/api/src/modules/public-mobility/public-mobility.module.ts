import { Module } from '@nestjs/common';
import { PublicMobilityController } from './public-mobility.controller.js';
import { PublicMobilityService } from './public-mobility.service.js';
import { MobilityPublicationController } from './mobility-publication.controller.js';
import { MobilityPublicationService } from './mobility-publication.service.js';
import { JourneyService } from './journey.service.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';

@Module({
  imports: [NotificacionesModule],
  controllers: [PublicMobilityController, MobilityPublicationController],
  providers: [PublicMobilityService, MobilityPublicationService, JourneyService],
})
export class PublicMobilityModule {}
