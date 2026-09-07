import { Module } from '@nestjs/common';
import { MobilityPublicationController } from './mobility-publication.controller.js';
import { MobilityPublicationService } from './mobility-publication.service.js';
import { PublicMobilityController } from './public-mobility.controller.js';
import { PublicMobilityService } from './public-mobility.service.js';

@Module({
  controllers: [MobilityPublicationController, PublicMobilityController],
  providers: [MobilityPublicationService, PublicMobilityService],
})
export class PublicMobilityModule {}
