import { Module } from '@nestjs/common';
import { CumplimientoController } from './cumplimiento.controller.js';
import { CumplimientoService } from './cumplimiento.service.js';
import { RecorridosController } from './recorridos.controller.js';
import { RecorridosService } from './recorridos.service.js';
import { ExportesController } from './exportes.controller.js';
import { ExportesService } from './exportes.service.js';
import { EnVivoController } from './en-vivo.controller.js';
import { EnVivoService } from './en-vivo.service.js';

// QUI-246: dashboard de cumplimiento. QUI-247: reconstrucción de recorridos. QUI-249:
// reportes exportables (CSV). Entrega 3: mapa en vivo (`/en-vivo`).
@Module({
  controllers: [CumplimientoController, RecorridosController, ExportesController, EnVivoController],
  providers: [CumplimientoService, RecorridosService, ExportesService, EnVivoService],
})
export class ReportesModule {}
