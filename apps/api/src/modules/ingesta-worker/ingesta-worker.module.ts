import { Module } from '@nestjs/common';
import { IngestaWorkerService } from './ingesta-worker.service.js';

@Module({
  providers: [IngestaWorkerService],
})
export class IngestaWorkerModule {}
