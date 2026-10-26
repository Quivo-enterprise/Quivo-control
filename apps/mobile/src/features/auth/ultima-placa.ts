import AsyncStorage from '@react-native-async-storage/async-storage';

const CLAVE_ULTIMA_PLACA = 'quivo.mobile.ultima-placa.v1';

/** La memoria del vehículo es una comodidad; un fallo de almacenamiento no bloquea el login. */
export async function leerUltimaPlaca(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CLAVE_ULTIMA_PLACA);
  } catch {
    return null;
  }
}

export async function guardarUltimaPlaca(placa: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_ULTIMA_PLACA, placa);
  } catch {
    // El login ya fue exitoso; conservarlo aunque no se pueda recordar la placa.
  }
}

export async function olvidarUltimaPlaca(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CLAVE_ULTIMA_PLACA);
  } catch {
    // La pantalla permite cambiar de placa aun si el almacenamiento falla.
  }
}
