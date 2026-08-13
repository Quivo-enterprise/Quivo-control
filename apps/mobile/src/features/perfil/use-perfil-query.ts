import { useQuery } from '@tanstack/react-query';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { perfilApi } from '../../shared/api/perfil-api';
import { useOperacionSettings } from './use-operacion-settings';

export function usePerfilQuery(
  contextoInicial: ContextoOperativoMovil,
  obtenerAccessToken: () => Promise<string | null>,
) {
  const { settings } = useOperacionSettings();

  return useQuery({
    queryKey: ['perfil', contextoInicial.sesionId],
    queryFn: async () => {
      const token = await obtenerAccessToken();
      if (!token) throw new Error('No hay sesión activa para cargar el perfil');
      return perfilApi.obtenerPerfil(token);
    },
    // Usamos initialData para que el UI sea inmediato y evitamos el estado "cargando".
    // react-query se encarga de re-fetchear en background (staletime=0 por defecto,
    // pero podemos configurarlo para no golpear tanto al servidor).
    initialData: contextoInicial,
    refetchInterval: settings.ahorroDatos ? 300 * 1000 : 60 * 1000, // 5 min o 60 seg
    staleTime: 30 * 1000,
  });
}
