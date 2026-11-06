'use client';

import { useState } from 'react';
import { Alert, Button, Card, ConfirmDialog } from '@quivo/design-system';
import { FRECUENCIA_MAX_MINUTOS, FRECUENCIA_MIN_MINUTOS } from '@quivo/shared';
import { Info, Minus, Plus } from 'lucide-react';
import { ajustarBase, validarBase } from '../../../src/lib/salidas/salidas.logic';
import { mensajeError, useAccionesFrecuencia, useReglasSalida } from './use-salidas';

/** Control rápido de frecuencia base (solo celular): mismo `fijarBase` y mismos límites que el formulario de escritorio. */
export function BaseRapida({ token, pcId }: { token: string; pcId: string }) {
  const reglas = useReglasSalida(token, pcId);
  const baseMin = reglas.data?.baseMin ?? null;
  const errorCarga = reglas.isError && reglas.data === undefined ? mensajeError(reglas.error) : null;
  // `key` solo por terminal: el refetch no remonta (conserva ediciones y el aviso de guardado).
  return <Stepper key={pcId} token={token} pcId={pcId} baseMin={baseMin} cargando={reglas.isPending || errorCarga !== null} errorCarga={errorCarga} />;
}

function Stepper({ token, pcId, baseMin, cargando, errorCarga }: { token: string; pcId: string; baseMin: number | null; cargando: boolean; errorCarga: string | null }) {
  const { fijarBase } = useAccionesFrecuencia(token, pcId);
  const [valor, setValor] = useState<number | null>(baseMin);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<number | null>(null);
  // Adopta la base nueva del servidor solo si no hay edición sin guardar.
  const [baseVista, setBaseVista] = useState(baseMin);
  if (baseVista !== baseMin) {
    setBaseVista(baseMin);
    if (valor === baseVista) setValor(baseMin);
  }

  const paso = (d: 1 | -1) => {
    setGuardado(null);
    setValor((v) => ajustarBase(v, d, FRECUENCIA_MIN_MINUTOS, FRECUENCIA_MAX_MINUTOS));
  };

  const guardar = async () => {
    setConfirmando(false);
    const parsed = validarBase(valor);
    if (!parsed.ok) {
      setError(parsed.mensaje);
      return;
    }
    setError(null);
    try {
      await fijarBase.mutateAsync(parsed.data);
      setGuardado(valor);
    } catch (e) {
      setError(mensajeError(e));
    }
  };

  return (
    <Card className="qv-base-rapida">
      <div className="qv-base-rapida__fila" role="group" aria-labelledby="qv-base-rapida-t">
        <span id="qv-base-rapida-t" className="qv-base-rapida__titulo">Frecuencia base</span>
        <Button variant="secondary" aria-label="Restar un minuto" disabled={cargando || (valor !== null && valor <= FRECUENCIA_MIN_MINUTOS)} onClick={() => paso(-1)}>
          <Minus size={24} aria-hidden />
        </Button>
        <output className="qv-base-rapida__valor" aria-labelledby="qv-base-rapida-t">
          {valor ?? '—'}
          <small>min</small>
        </output>
        <Button variant="secondary" aria-label="Sumar un minuto" disabled={cargando || (valor !== null && valor >= FRECUENCIA_MAX_MINUTOS)} onClick={() => paso(1)}>
          <Plus size={24} aria-hidden />
        </Button>
        <Button variant="primary" className="qv-base-rapida__guardar" disabled={cargando || fijarBase.isPending || valor === null || valor === baseMin} onClick={() => setConfirmando(true)}>
          {fijarBase.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
      <p className="qv-base-rapida__ayuda">
        <Info size={20} aria-hidden />
        Aplica todos los días
      </p>
      {errorCarga && <Alert variant="danger" title="No se pudo cargar la frecuencia base">{errorCarga}</Alert>}
      {error && <Alert variant="danger" title="No se pudo guardar la base">{error}</Alert>}
      {guardado !== null && <Alert variant="success" title="Frecuencia base guardada">Ahora rige {guardado} min.</Alert>}
      <ConfirmDialog
        open={confirmando}
        title="Cambiar la frecuencia base"
        message={`Esto cambia la frecuencia base de esta terminal a ${valor} min de forma permanente, para todos los días.`}
        confirmLabel="Cambiar base"
        onConfirm={() => void guardar()}
        onCancel={() => setConfirmando(false)}
      />
    </Card>
  );
}
