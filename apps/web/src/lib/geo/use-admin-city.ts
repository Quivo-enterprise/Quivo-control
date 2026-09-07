'use client';

import { useEffect, useState } from 'react';
import {
  CIUDAD_DEFAULT,
  CIUDADES_BOLIVIA,
  encontrarCiudadMasCercana,
  resolverCiudadBolivia,
  type CiudadBolivia,
} from '@quivo/shared';

const STORAGE_CITY_KEY = 'quivo.admin_city';

export function useAdminCity(overrideCityId?: string | null) {
  const [ciudad, setCiudad] = useState<CiudadBolivia>(() => {
    if (overrideCityId) return resolverCiudadBolivia(overrideCityId);
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_CITY_KEY);
      if (stored) return resolverCiudadBolivia(stored);
    }
    return CIUDAD_DEFAULT;
  });

  // Si cambia el cityId especificado externamente (ej. al cambiar de línea), enfocar esa ciudad
  useEffect(() => {
    if (overrideCityId) {
      setCiudad(resolverCiudadBolivia(overrideCityId));
    }
  }, [overrideCityId]);

  // Si no hay override ni selección previa guardada, intentar autodetectar la ciudad vía geolocalización del navegador
  useEffect(() => {
    if (overrideCityId) return;
    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;

    const stored = localStorage.getItem(STORAGE_CITY_KEY);
    if (stored) return; // Respetar la preferencia manual

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const detectada = encontrarCiudadMasCercana(pos.coords.latitude, pos.coords.longitude);
        setCiudad(detectada);
        localStorage.setItem(STORAGE_CITY_KEY, detectada.id);
      },
      () => {
        // En caso de denegación o timeout, se mantiene Cochabamba por defecto
      },
      { timeout: 5000, maximumAge: 60000 },
    );
  }, [overrideCityId]);

  const cambiarCiudad = (id: string) => {
    const nueva = resolverCiudadBolivia(id);
    setCiudad(nueva);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_CITY_KEY, nueva.id);
    }
  };

  return {
    ciudad,
    centro: [ciudad.lat, ciudad.lng] as [number, number],
    zoom: ciudad.zoomDefault,
    cambiarCiudad,
    ciudadesDisponibles: Object.values(CIUDADES_BOLIVIA),
  };
}
