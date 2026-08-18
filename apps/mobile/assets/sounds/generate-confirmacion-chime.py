#!/usr/bin/env python3
"""
Genera `confirmacion-chime.wav`: la campanita de confirmación que suena cuando el conductor
pasa por un punto de control (QUI — "sonido de confirmación de registro").

Por qué existe este script en el repo (no solo el .wav binario): el asset es 100% sintético
—no hay conexión a internet para bajar un sonido de stock— así que este generador es la única
fuente reproducible del audio. Si algún día hay que ajustar timbre/duración/frecuencias, se
edita este archivo y se vuelve a correr, en vez de tocar el binario a mano.

Diseño (decisión ya tomada, ver el ticket):
- Dos notas ascendentes, quinta justa: C6 (1046.5 Hz) -> G6 (1568 Hz). Referencia mental: el
  sonido de confirmación de una app de pagos moderna (Revolut/Apple Pay) — premium, breve,
  inequívocamente positivo. NO un beep de electrodoméstico, NO una alarma.
- La segunda nota entra ~120 ms después de la primera (se solapan) — es lo que da la sensación
  de "resuelto" en vez de dos beeps sueltos.
- Timbre de campana por síntesis aditiva: fundamental + 2do + 3er armónico, amplitudes
  1.0 / 0.5 / 0.25 — una onda pura sonaría a beep de prueba de audiometría, no a campanita.
- Envolvente: ataque de 5 ms (rápido pero no instantáneo — un ataque en cero produce un click
  audible) + decaimiento exponencial suave.
- 44.1 kHz / 16-bit / mono — es un efecto corto, el estéreo no aporta nada y duplica el peso
  del asset.
- Fade-out final (ventana Hann, no lineal, para que la derivada llegue a cero en el borde) que
  fuerza el último tramo del buffer a 0 exacto — sin esto, cortar un seno con decaimiento
  exponencial a mitad de ciclo se escucha como un click seco.
- Normalizado a pico ~-3 dBFS. Nunca clipea (se verifica después de escribir el archivo).

No usa numpy (no está instalado en este entorno) — `wave` + `math` de la stdlib alcanzan para
un efecto de ~0.5 s. La verificación de abajo (duración, pico, muestras de borde, espectro por
Goertzel) tampoco necesita numpy.
"""

import math
import wave
import struct
import os

SR = 44100  # 44.1 kHz, pedido por la spec
SAMPLE_WIDTH_BYTES = 2  # 16-bit
MAX_INT16 = 32767

# --- Notas: quinta justa ascendente, C6 -> G6 ---
NOTE1_FREQ = 1046.5  # C6
NOTE2_FREQ = 1568.0  # G6
NOTE1_START = 0.000
NOTE2_START = 0.120  # la segunda nota entra a los ~120 ms de la primera (solapadas)
NOTE_DUR = 0.400  # cada nota dura ~400 ms (dentro del rango pedido de 350-450 ms)

# --- Envolvente ---
ATTACK_S = 0.005  # 5 ms: rápido pero no cero, evita el click de un ataque instantáneo
DECAY_TAU_S = 0.115  # constante de tiempo del decaimiento exponencial tras el ataque

# --- Timbre: síntesis aditiva, cuerpo de campana ---
HARMONICS = [(1, 1.0), (2, 0.5), (3, 0.25)]  # (multiplicador de frecuencia, amplitud relativa)

# --- Duración total y fade-out final ---
TOTAL_DUR_S = max(NOTE1_START + NOTE_DUR, NOTE2_START + NOTE_DUR)  # 0.520 s (< 600 ms del tope)
FINAL_FADE_S = 0.020  # 20 ms de fade-out al final, ventana Hann (derivada nula en los bordes)

# --- Normalización ---
TARGET_PEAK_DBFS = -3.0
TARGET_PEAK_LINEAR = 10 ** (TARGET_PEAK_DBFS / 20.0)

OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'confirmacion-chime.wav')


def envolvente(t_rel: float) -> float:
    """Ataque lineal de `ATTACK_S` seguido de decaimiento exponencial. `t_rel` < 0 (antes de que
    arranque la nota) da 0 — así cada nota queda en silencio total fuera de su propia ventana."""
    if t_rel < 0:
        return 0.0
    if t_rel < ATTACK_S:
        return t_rel / ATTACK_S
    return math.exp(-(t_rel - ATTACK_S) / DECAY_TAU_S)


def muestra_nota(t_rel: float, freq: float) -> float:
    env = envolvente(t_rel)
    if env <= 0.0:
        return 0.0
    total = 0.0
    for mult, amp in HARMONICS:
        total += amp * math.sin(2.0 * math.pi * freq * mult * t_rel)
    return env * total


def generar() -> list:
    n_samples = int(round(TOTAL_DUR_S * SR))
    buf = [0.0] * n_samples
    for i in range(n_samples):
        t = i / SR
        buf[i] = muestra_nota(t - NOTE1_START, NOTE1_FREQ) + muestra_nota(t - NOTE2_START, NOTE2_FREQ)

    # Fade-out final: ventana Hann sobre los últimos FINAL_FADE_S segundos, para terminar en 0
    # exacto sin discontinuidad de pendiente (evita el chasquido de cortar un seno a mitad de
    # ciclo).
    fade_samples = int(round(FINAL_FADE_S * SR))
    for k in range(fade_samples):
        idx = n_samples - fade_samples + k
        if idx < 0:
            continue
        # k=0 -> multiplicador ~1 (todavía sin atenuar); k=fade_samples-1 -> multiplicador 0.
        mult = 0.5 * (1.0 + math.cos(math.pi * k / (fade_samples - 1)))
        buf[idx] *= mult

    return buf


def normalizar(buf: list) -> list:
    """Escala `buf` (síntesis aditiva cruda, picos > 1.0 esperados con 3 armónicos + 2 notas
    solapadas) a pico `TARGET_PEAK_LINEAR` (~-3 dBFS). Devuelve floats — la verificación corre
    SIEMPRE sobre esta versión normalizada, que es la que termina en el .wav; verificar el
    buffer crudo no dice nada del archivo real."""
    pico_actual = max(abs(x) for x in buf) or 1.0
    factor = TARGET_PEAK_LINEAR / pico_actual
    return [x * factor for x in buf]


def convertir_a_pcm16(buf: list) -> bytes:
    frames = bytearray()
    for x in buf:
        # Clamp defensivo: con la normalización de arriba nunca debería hacer falta, pero una
        # muestra que se pasara por redondeo de punto flotante no debe wrappear a ruido.
        v = max(-1.0, min(1.0, x))
        sample_i16 = int(round(v * MAX_INT16))
        frames += struct.pack('<h', sample_i16)
    return bytes(frames)


def escribir_wav(frames: bytes, path: str) -> None:
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(SAMPLE_WIDTH_BYTES)
        wf.setframerate(SR)
        wf.writeframes(frames)


# --------------------------------------------------------------------------------------------
# Verificación numérica (no se puede escuchar el resultado en este entorno) — corre siempre que
# se ejecuta el script, así que regenerar el asset y verificarlo es un solo comando.
# --------------------------------------------------------------------------------------------

def goertzel_magnitud(muestras: list, freq: float, sr: int) -> float:
    """Energía de `muestras` en `freq` (algoritmo de Goertzel — DFT de un solo bin, sin
    depender de numpy/FFT). Se usa para confirmar que el espectro tiene energía donde
    corresponde (C6/G6 y sus armónicos) en vez de solo mirar el dominio del tiempo."""
    n = len(muestras)
    if n == 0:
        return 0.0
    k = int(0.5 + (n * freq) / sr)
    w = (2.0 * math.pi / n) * k
    cos_w = math.cos(w)
    coeff = 2.0 * cos_w
    s_prev, s_prev2 = 0.0, 0.0
    for x in muestras:
        s = x + coeff * s_prev - s_prev2
        s_prev2 = s_prev
        s_prev = s
    power = s_prev2 ** 2 + s_prev ** 2 - coeff * s_prev * s_prev2
    return math.sqrt(max(power, 0.0)) / n


def contar_cruces_por_cero(muestras: list) -> int:
    cruces = 0
    for a, b in zip(muestras, muestras[1:]):
        if (a >= 0) != (b >= 0):
            cruces += 1
    return cruces


def verificar(buf: list) -> None:
    n = len(buf)
    duracion_s = n / SR
    pico = max(abs(x) for x in buf)
    pico_dbfs = 20 * math.log10(pico) if pico > 0 else float('-inf')
    primera = buf[0]
    ultimas_20 = buf[-20:]
    ultima = buf[-1]

    print('--- Verificación numérica de confirmacion-chime.wav ---')
    print(f'Duración total: {duracion_s * 1000:.1f} ms ({n} muestras a {SR} Hz)')
    print(f'Pico máximo: {pico:.5f}  ({pico_dbfs:.2f} dBFS)  [objetivo: ~{TARGET_PEAK_DBFS} dBFS, nunca > 0 dBFS]')
    print(f'Muestra inicial: {primera:.6f} (objetivo: ~0)')
    print(f'Muestra final: {ultima:.6f} (objetivo: ~0)')
    print(f'Máximo |muestra| en los últimos 20 samples: {max(abs(x) for x in ultimas_20):.6f}')

    # Ventana de la nota 1 sola (antes de que entre la nota 2): 15-100 ms, ya pasado el ataque.
    ini1, fin1 = int(0.015 * SR), int(0.100 * SR)
    ventana1 = buf[ini1:fin1]
    cruces1 = contar_cruces_por_cero(ventana1)
    freq_estimada1 = cruces1 / 2.0 / ((fin1 - ini1) / SR)
    mag_c6 = goertzel_magnitud(ventana1, NOTE1_FREQ, SR)
    mag_g6_en_ventana1 = goertzel_magnitud(ventana1, NOTE2_FREQ, SR)
    print(f'\nVentana nota 1 sola [15-100 ms] — cruces por cero: {cruces1}, freq. fundamental estimada: {freq_estimada1:.1f} Hz (esperado ~{NOTE1_FREQ} Hz)')
    print(f'  Goertzel @ C6 ({NOTE1_FREQ} Hz): {mag_c6:.4f}   Goertzel @ G6 ({NOTE2_FREQ} Hz): {mag_g6_en_ventana1:.4f}  (C6 debe dominar)')

    # Ventana tardía [430-500 ms]: nota 1 ya decayó casi del todo, domina la nota 2.
    ini2, fin2 = int(0.430 * SR), int(0.500 * SR)
    ventana2 = buf[ini2:fin2]
    cruces2 = contar_cruces_por_cero(ventana2)
    freq_estimada2 = cruces2 / 2.0 / ((fin2 - ini2) / SR)
    mag_g6 = goertzel_magnitud(ventana2, NOTE2_FREQ, SR)
    mag_c6_en_ventana2 = goertzel_magnitud(ventana2, NOTE1_FREQ, SR)
    print(f'\nVentana tardía [430-500 ms] — cruces por cero: {cruces2}, freq. fundamental estimada: {freq_estimada2:.1f} Hz (esperado ~{NOTE2_FREQ} Hz)')
    print(f'  Goertzel @ C6 ({NOTE1_FREQ} Hz): {mag_c6_en_ventana2:.4f}   Goertzel @ G6 ({NOTE2_FREQ} Hz): {mag_g6:.4f}  (G6 debe dominar)')

    # Armónicos: energía en 2x y 3x de G6 dentro de la ventana tardía, para confirmar el cuerpo
    # de campana (no debería ser una onda pura).
    mag_g6_h2 = goertzel_magnitud(ventana2, NOTE2_FREQ * 2, SR)
    mag_g6_h3 = goertzel_magnitud(ventana2, NOTE2_FREQ * 3, SR)
    print(f'\nArmónicos de G6 en la ventana tardía: 2x ({NOTE2_FREQ * 2:.0f} Hz) = {mag_g6_h2:.4f}, 3x ({NOTE2_FREQ * 3:.0f} Hz) = {mag_g6_h3:.4f} (deben ser menores que el fundamental, no ausentes)')

    assert duracion_s <= 0.6, 'la duración total no puede superar ~600 ms'
    assert pico <= 1.0, 'no puede clipear'
    assert abs(primera) < 0.001, 'la muestra inicial debe ser ~0 para no chasquear'
    assert abs(ultima) < 1e-6, 'la muestra final debe ser 0 exacto para no chasquear'
    print('\nOK — todas las aserciones pasaron.')


def main() -> None:
    buf_crudo = generar()
    buf = normalizar(buf_crudo)
    verificar(buf)
    frames = convertir_a_pcm16(buf)
    escribir_wav(frames, OUTPUT_PATH)
    tamanio_kb = os.path.getsize(OUTPUT_PATH) / 1024.0
    print(f'\nEscrito: {OUTPUT_PATH} ({tamanio_kb:.1f} KB)')


if __name__ == '__main__':
    main()
