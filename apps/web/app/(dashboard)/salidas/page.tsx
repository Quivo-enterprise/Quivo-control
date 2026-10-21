'use client';

import { Suspense, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Alert, Loader, PageHeader, Select } from '@quivo/design-system';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { FilaEnVivo } from './fila-en-vivo';
import { FrecuenciasPanel } from './frecuencias-panel';
import { GruposPanel } from './grupos-panel';
import { mensajeError, useGruposVehiculo, useTerminales, useVehiculosSalida } from './use-salidas';

const ROLES_GRUPOS = ['admin_quivo', 'admin_sindicato'];

export default function SalidasPage() {
  return (
    <Suspense fallback={<Loader label="Cargando salidas…" />}>
      <SalidasContenido />
    </Suspense>
  );
}

function SalidasContenido() {
  const { token, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const esAdmin = ROLES_GRUPOS.includes(user?.rol ?? '');
  const terminales = useTerminales(token);
  const vehiculos = useVehiculosSalida(token);
  const grupos = useGruposVehiculo(token, esAdmin);

  const opciones = useMemo(
    () => (terminales.data?.opciones ?? []).map((t) => ({ label: t.etiqueta, value: t.id })),
    [terminales.data],
  );
  // Terminal en la URL (`?terminal=`); con una sola (L16) no hay nada que elegir y queda seleccionada.
  const param = searchParams.get('terminal') ?? '';
  const elegida = opciones.some((o) => o.value === param) ? param : opciones.length === 1 ? opciones[0]!.value : '';
  const elegir = (id: string) => router.replace(`${pathname}?terminal=${encodeURIComponent(id)}`);

  const lista = useMemo(() => vehiculos.data ?? [], [vehiculos.data]);
  // Nombres de TODOS los vehículos (la fila puede traer uno ya inactivo); los selectores solo ofrecen activos.
  const activos = useMemo(() => lista.filter((v) => v.estado === 'activo'), [lista]);
  const internoPorVehiculo = useMemo(
    () => Object.fromEntries(lista.filter((v) => v.numeroInterno).map((v) => [v.id, v.numeroInterno as string])),
    [lista],
  );
  const placaPorId = useMemo(() => Object.fromEntries(lista.map((v) => [v.id, v.placa])), [lista]);
  const listaGrupos = useMemo(() => grupos.data ?? [], [grupos.data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader title="Salidas" subtitle="Fila de salida y frecuencias de la terminal." />
      {terminales.isPending && <Loader label="Cargando terminales…" />}
      {terminales.isError && <Alert variant="danger" title="No se pudieron cargar las terminales">{mensajeError(terminales.error)}</Alert>}
      {terminales.data && terminales.data.fallidas > 0 && (
        <Alert variant="warning" title="La lista de terminales puede estar incompleta">
          No se pudieron consultar {terminales.data.fallidas} {terminales.data.fallidas === 1 ? 'ruta o línea' : 'rutas o líneas'}. Recargá la página para reintentar.
        </Alert>
      )}
      {terminales.data && opciones.length === 0 && (
        <Alert variant="info" title="Sin terminales">
          Ninguna línea tiene un punto de control con rol terminal. Configuralo desde Rutas.
        </Alert>
      )}
      {vehiculos.isError && (
        <Alert variant="danger" title="No se pudieron cargar los vehículos">
          {mensajeError(vehiculos.error)} Sin ellos no se ven números internos ni se pueden elegir trufis.
        </Alert>
      )}
      {esAdmin && grupos.isError && (
        <Alert variant="danger" title="No se pudieron cargar los grupos">{mensajeError(grupos.error)}</Alert>
      )}
      {opciones.length > 1 && (
        <div style={{ width: '100%', maxWidth: '24rem' }}>
          <Select label="Terminal" placeholder="Elegí una terminal…" options={opciones} value={elegida} onChange={(e) => elegir(e.target.value)} fullWidth />
        </div>
      )}
      {token && elegida && (
        <>
          <FilaEnVivo token={token} pcId={elegida} internoPorVehiculo={internoPorVehiculo} />
          <FrecuenciasPanel
            token={token}
            pcId={elegida}
            grupos={esAdmin ? listaGrupos : null}
            vehiculos={activos}
            placaPorId={placaPorId}
          />
          {esAdmin && (
            <GruposPanel
              token={token}
              grupos={listaGrupos}
              cargandoGrupos={grupos.isPending}
              vehiculos={activos}
              placaPorId={placaPorId}
            />
          )}
        </>
      )}
    </div>
  );
}
