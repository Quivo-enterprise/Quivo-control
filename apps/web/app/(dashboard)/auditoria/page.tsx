'use client';

import { AuditLog, PageHeader } from '@quivo/design-system';
import { AUDITORIA } from '../../../src/lib/demo-data';

export default function AuditoriaPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Auditoría"
        subtitle="Datos de ejemplo — el interceptor real (audit_log en acciones críticas) llega con QUI-230 (M2)."
      />
      <AuditLog logs={AUDITORIA} />
    </div>
  );
}
