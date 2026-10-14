import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { claveDiaBolivia, debeMostrarAviso } from './vehiculo-foto-core';

const CLAVE_DESCARTE = 'quivo:vehiculo-foto:aviso-descartado-dia';

/** Aviso "sin foto" de la pantalla de operación; el descarte vale hasta el fin del día (Bolivia). */
export function useAvisoFoto(opts: { cargando: boolean; tieneFoto: boolean; tracking: boolean }) {
  const [descartadoDia, setDescartadoDia] = useState<string | null>(null);
  const [leido, setLeido] = useState(false);

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(CLAVE_DESCARTE)
      .then((valor) => {
        if (vivo) setDescartadoDia(valor);
      })
      .catch(() => undefined)
      .finally(() => {
        if (vivo) setLeido(true);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const descartar = useCallback(() => {
    const dia = claveDiaBolivia(new Date());
    setDescartadoDia(dia);
    AsyncStorage.setItem(CLAVE_DESCARTE, dia).catch(() => undefined);
  }, []);

  const visible =
    leido &&
    debeMostrarAviso({
      cargando: opts.cargando,
      tieneFoto: opts.tieneFoto,
      tracking: opts.tracking,
      descartadoDia,
      ahora: new Date(),
    });

  return { visible, descartar };
}
