import { Module } from '@nestjs/common';
import { VueltasModule } from '../vueltas/vueltas.module.js';
import { CumplimientoController } from './cumplimiento.controller.js';
import { CumplimientoService } from './cumplimiento.service.js';
import { RecorridosController } from './recorridos.controller.js';
import { RecorridosService } from './recorridos.service.js';
import { ExportesController } from './exportes.controller.js';
import { ExportesService } from './exportes.service.js';
import { EnVivoController } from './en-vivo.controller.js';
import { EnVivoService } from './en-vivo.service.js';
import { EnVivoUsuarioThrottlerGuard } from './en-vivo-usuario-throttler.guard.js';
import { JornadasController } from './jornadas.controller.js';
import { JornadasService } from './jornadas.service.js';

// QUI-246: dashboard de cumplimiento. QUI-247: reconstrucción de recorridos. QUI-249:
// reportes exportables (CSV). Entrega 3: mapa en vivo (`/en-vivo`). Release 13: jornadas.
@Module({
  imports: [VueltasModule],
  controllers: [
    CumplimientoController,
    RecorridosController,
    ExportesController,
    EnVivoController,
    JornadasController,
  ],
  providers: [
    CumplimientoService,
    RecorridosService,
    ExportesService,
    EnVivoService,
    EnVivoUsuarioThrottlerGuard,
    JornadasService,
  ],
})
export class ReportesModule {}
