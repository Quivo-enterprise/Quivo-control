import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

// `ConfigModule` es global (`isGlobal: true` en AppModule), pero sin este import explícito
// Nest no garantiza que ya esté instanciado cuando `HealthService` pide `ConfigService` en
// su constructor — Nest instancia módulos hermanos en paralelo y solo una relación de
// import directa fuerza el orden. Encontrado en cold-boot real: `ConfigService` llegaba
// `undefined` a `HealthService` (`Cannot read properties of undefined (reading 'get')`).
@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
