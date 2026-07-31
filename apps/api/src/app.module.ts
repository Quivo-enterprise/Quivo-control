import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from './common/validation/zod-validation.pipe.js';
import { AuditInterceptor } from './common/audit/audit.interceptor.js';
import { PingController } from './common/ping/ping.controller.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/index.js';
import { SindicatosModule } from './modules/sindicatos/index.js';
import { SociosModule } from './modules/socios/index.js';
import { VehiculosModule } from './modules/vehiculos/index.js';
import { ConductoresModule } from './modules/conductores/index.js';
import { LineasModule } from './modules/lineas/index.js';
import { RutasModule } from './modules/rutas/index.js';
import { ControlPointsModule } from './modules/control-points/index.js';
import { ReglasModule } from './modules/reglas/index.js';
import { RotacionesModule } from './modules/rotaciones/index.js';
import { TrackingModule } from './modules/tracking/index.js';
import { SyncModule } from './modules/sync/index.js';
import { ReportesModule } from './modules/reportes/index.js';
import { AuditoriaModule } from './modules/auditoria/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // QUI-251: no había ningún rate limiting en toda la API — `/v1/auth/login` quedaba
    // abierto a fuerza bruta sin límite. Límite general generoso (100 req/min/IP) acá;
    // `AuthController.login` pisa esto con uno mucho más estricto (ver ese archivo).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    LoggerModule.forRoot({
      pinoHttp: {
        // req.id ya viene de Fastify (genReqId configurado en main.ts).
        customProps: (req) => ({ requestId: (req as { id?: string }).id }),
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
    }),
    HealthModule,
    AuthModule,
    SindicatosModule,
    SociosModule,
    VehiculosModule,
    ConductoresModule,
    LineasModule,
    RutasModule,
    ControlPointsModule,
    ReglasModule,
    RotacionesModule,
    TrackingModule,
    SyncModule,
    ReportesModule,
    AuditoriaModule,
  ],
  controllers: [PingController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
