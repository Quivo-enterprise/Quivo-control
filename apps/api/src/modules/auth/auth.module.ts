import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

// Guards de autorización + RLS de Postgres quedan para QUI-220+ (doc técnico §5) —
// todavía no hay endpoints/tablas de dominio reales que proteger.
@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
