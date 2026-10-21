'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Loader, PageHeader, Select } from '@quivo/design-system';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { FilaEnVivo } from './fila-en-vivo';
import { FrecuenciasPanel } from './frecuencias-panel';
import { GruposPanel } from './grupos-panel';
import { mensajeError, useGruposVehiculo, useTerminales, useVehiculosSalida } from './use-salidas';

const ROLES_GRUPOS = ['admin_quivo', 'admin_sindicato'];

export default function SalidasPage() {
  const { token, user } = useAuth();
  const esAdmin = ROLES_GRUPOS.includes(user?.rol ?? '');
  const terminales = useTerminales(token);
  const vehiculos = useVehiculosSalida(token);
  const grupos = useGruposVehiculo(token, esAdmin);
  const [elegida, setElegida] = useState('');

  const opciones = useMemo(
    () => (terminales.data ?? []).map((t) => ({ label: t.etiqueta, value: t.id })),
    [terminales.data],
  );
  // Con una sola terminal (L16) no hay nada que elegir: queda seleccionada.
  useEffect(() => {
    if (!elegida && opciones.length === 1) setElegida(opciones[0]!.value);
  }, [elegida, opciones]);

  const lista = useMemo(() => vehiculos.data ?? [], [vehiculos.data]);
  const internoPorVehiculo = useMemo(
    () => Object.fromEntries(lista.filter((v) => v.numeroInterno).map((v) => [v.id, v.numeroInterno as string])),
    [lista],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Salidas" subtitle="Fila de salida y frecuencias de la terminal." />
      {terminales.isPending && <Loader label="Cargando terminales…" />}
      {terminales.isError && <Alert variant="danger" title="No se pudieron cargar las terminales">{mensajeError(terminales.error)}</Alert>}
      {terminales.data?.length === 0 && (
        <Alert variant="info" title="Sin terminales">
          Ninguna línea tiene un punto de control con rol terminal. Configuralo desde Rutas.
        </Alert>
      )}
      {opciones.length > 1 && (
        <div style={{ maxWidth: '24rem' }}>
          <Select aria-label="Terminal" label="Terminal" placeholder="Elegí una terminal" options={opciones} value={elegida} onChange={(e) => setElegida(e.target.value)} fullWidth />
        </div>
      )}
      {token && elegida && (
        <>
          <FilaEnVivo token={token} pcId={elegida} internoPorVehiculo={internoPorVehiculo} />
          <FrecuenciasPanel token={token} pcId={elegida} grupos={esAdmin ? (grupos.data ?? []) : null} vehiculos={lista} />
          {esAdmin && <GruposPanel token={token} vehiculos={lista} />}
        </>
      )}
    </div>
  );
}
