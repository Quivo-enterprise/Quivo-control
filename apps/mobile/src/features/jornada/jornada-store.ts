import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  guardarJornadaEn,
  leerJornadaEn,
  type DeclaracionJornada,
  type IdentidadJornada,
} from './jornada-store-core';

/** Declaración de jornada de HOY (Bolivia) para este vehículo + conductor, o `null`. */
export function leerJornada(
  identidad: IdentidadJornada,
  ahora?: Date,
): Promise<DeclaracionJornada | null> {
  return leerJornadaEn(AsyncStorage, identidad, ahora);
}

/** Persiste la declaración; `false` si falló (el llamador sigue en memoria). */
export function guardarJornada(declaracion: DeclaracionJornada): Promise<boolean> {
  return guardarJornadaEn(AsyncStorage, declaracion);
}
