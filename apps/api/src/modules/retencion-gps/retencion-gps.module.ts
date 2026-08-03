import { Module } from '@nestjs/common';
import { RetencionGpsService } from './retencion-gps.service.js';

@Module({ providers: [RetencionGpsService] })
export class RetencionGpsModule {}
