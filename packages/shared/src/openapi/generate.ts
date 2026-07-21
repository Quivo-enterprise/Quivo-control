import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';
import {
  SindicatoSchema,
  SocioSchema,
  VehiculoSchema,
  ConductorSchema,
} from '../entities/index.js';
import { EventoSyncSchema } from '../sync/index.js';

registry.register('Sindicato', SindicatoSchema);
registry.register('Socio', SocioSchema);
registry.register('Vehiculo', VehiculoSchema);
registry.register('Conductor', ConductorSchema);
registry.register('EventoSync', EventoSyncSchema);

const generator = new OpenApiGeneratorV3(registry.definitions);

const document = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'QUIVO Control API',
    version: 'v1',
    description:
      'Contrato generado desde los schemas Zod de @quivo/shared. Ver docs/documento-tecnico-cto.md §8.',
  },
  servers: [{ url: '/v1' }],
});

const outPath = fileURLToPath(new URL('../../openapi.json', import.meta.url));
writeFileSync(outPath, JSON.stringify(document, null, 2));

console.log(`OpenAPI doc generado en ${outPath}`);
