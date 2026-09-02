#!/usr/bin/env python3
"""
Genera `confirmacion-chime.wav`: la alerta que suena cuando el conductor pasa por un punto de
control (QUI — "sonido de confirmación de registro").

Por qué existe este script en el repo (no solo el .wav binario): el asset es 100% sintético
—no hay conexión a internet para bajar un sonido de stock— así que este generador es la única
fuente reproducible del audio. Si algún día hay que ajustar timbre/duración/frecuencias, se
edita este archivo y se vuelve a correr, en vez de tocar el binario a mano.

Diseño (rediseñado — pedido explícito: "debe ser un sonido super fuerte para que se escuche"):
- El diseño ANTERIOR (dos notas de campana C6->G6, tipo confirmación de pago) sonaba premium
  pero suave — se pierde con el motor del trufi andando y el ruido de calle. Este conductor no
  puede mirar la pantalla mientras maneja: el sonido tiene que imponerse sobre el ambiente, no
  sonar bonito.
- Tres beeps cortos e idénticos (no dos notas melódicas) — un patrón repetitivo y seco se lee
  como "alerta/atención" (mismo lenguaje que un sensor de reversa o un lector de código de
  barras), no como un efecto decorativo.
- Frecuencia fundamental 2200 Hz: la banda donde el oído humano es más sensible (2-4 kHz) y
  además queda muy por encima del ruido de motor/tráfico, que es predominantemente de baja
  frecuencia — así el beep se separa del ruido de fondo en vez de mezclarse con él.
- Timbre "buzzer" por síntesis aditiva con armónicos IMPARES (1º, 3º, 5º — como una onda
  cuadrada) en vez de la serie 1-2-3 tipo campana del diseño anterior: más armónicos altos se
  perciben como más fuerte/urgente a igual amplitud de pico, y es el timbre estándar de
  alarmas y avisadores.
- Envolvente casi de compuerta (ataque de 2 ms, sostenido a amplitud plena, decaimiento de
  10 ms): un beep de alerta debe sonar seco e inmediato, no tener el ataque suave de una
  campana. El decaimiento de 10 ms sigue siendo suficiente para no chasquear al cortar.
- 44.1 kHz / 16-bit / mono — igual que antes, es un efecto corto y el estéreo no aporta nada.
- Normalizado a pico ~-1 dBFS (antes ~-3 dBFS): el margen que se le deja al pico es SOLO el
  necesario para no clipear con el redondeo a PCM16, no un margen de "no sonar fuerte".
- Fade-out final (ventana Hann) que fuerza el último tramo del buffer a 0 exacto — mismo
  motivo que antes: cortar una onda a mitad de ciclo se escucha como un click seco.

No usa numpy (no está instalado en este entorno) — `wave` + `math` de la stdlib alcanzan para
un efecto de menos de un segundo. La verificación de abajo (duración, pico, muestras de borde,
espectro por Goertzel) tampoco necesita numpy.
"""

import math
import wave
import struct
import os

SR = 44100  # 44.1 kHz
SAMPLE_WIDTH_BYTES = 2  # 16-bit
MAX_INT16 = 32767

# --- Patrón: 3 beeps idénticos, cortos y seguidos ---
BEEP_FREQ = 2200.0  # Hz — banda de máxima sensibilidad auditiva, muy por encima del ruido de motor
BEEP_DUR_S = 0.120  # cada beep dura 120 ms
GAP_S = 0.070  # silencio entre beeps
N_BEEPS = 3
BEEP_STARTS = [i * (BEEP_DUR_S + GAP_S) for i in range(N_BEEPS)]

# --- Envolvente: casi de compuerta, no de campana ---
ATTACK_S = 0.002  # 2 ms: ataque casi instantáneo, seco
DECAY_S = 0.010  # 10 ms de decaimiento lineal al final de CADA beep (evita el click de corte)

# --- Timbre "buzzer": armónicos impares (serie de una onda cuadrada), más fuerte/urgente
#     a igual pico que una serie de campana --- (multiplicador de frecuencia, amplitud relativa)
HARMONICS = [(1, 1.0), (3, 1.0 / 3.0), (5, 1.0 / 5.0)]

TOTAL_DUR_S = BEEP_STARTS[-1] + BEEP_DUR_S  # 0.480 s (3*120ms + 2*70ms)
FINAL_FADE_S = 0.015  # fade-out final adicional, ventana Hann (derivada nula en el borde)

# --- Normalización: pico cerca de 0 dBFS a propósito (pedido: "sonido super fuerte") ---
TARGET_PEAK_DBFS = -1.0
TARGET_PEAK_LINEAR = 10 ** (TARGET_PEAK_DBFS / 20.0)

OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'confirmacion-chime.wav')


def envolvente_beep(t_rel: float) -> float:
    """Ataque lineal de `ATTACK_S`, sostenido a 1.0, decaimiento lineal de `DECAY_S` al final
    de `BEEP_DUR_S`. `t_rel` fuera de [0, BEEP_DUR_S] da 0."""
    if t_rel < 0 or t_rel > BEEP_DUR_S:
        return 0.0
    if t_rel < ATTACK_S:
        return t_rel / ATTACK_S
    if t_rel > BEEP_DUR_S - DECAY_S:
        return max(0.0, (BEEP_DUR_S - t_rel) / DECAY_S)
    return 1.0


def muestra_beep(t_rel: float) -> float:
    env = envolvente_beep(t_rel)
    if env <= 0.0:
        return 0.0
    total = 0.0
    for mult, amp in HARMONICS:
        total += amp * math.sin(2.0 * math.pi * BEEP_FREQ * mult * t_rel)
    return env * total


def generar() -> list:
    n_samples = int(round(TOTAL_DUR_S * SR))
    buf = [0.0] * n_samples
    for i in range(n_samples):
        t = i / SR
        muestra = 0.0
        for inicio in BEEP_STARTS:
            muestra += muestra_beep(t - inicio)
        buf[i] = muestra

    # Fade-out final: ventana Hann sobre los últimos FINAL_FADE_S segundos, para terminar en 0
    # exacto sin discontinuidad de pendiente.
    fade_samples = int(round(FINAL_FADE_S * SR))
    for k in range(fade_samples):
        idx = n_samples - fade_samples + k
        if idx < 0:
            continue
        mult = 0.5 * (1.0 + math.cos(math.pi * k / (fade_samples - 1)))
        buf[idx] *= mult

    return buf


def normalizar(buf: list) -> list:
    """Escala `buf` (síntesis aditiva cruda, picos > 1.0 esperados con 3 armónicos) a pico
    `TARGET_PEAK_LINEAR` (~-1 dBFS). Devuelve floats — la verificación corre SIEMPRE sobre esta
    versión normalizada, que es la que termina en el .wav."""
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
    depender de numpy/FFT)."""
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
    ultima = buf[-1]

    print('--- Verificación numérica de confirmacion-chime.wav ---')
    print(f'Duración total: {duracion_s * 1000:.1f} ms ({n} muestras a {SR} Hz)')
    print(f'Pico máximo: {pico:.5f}  ({pico_dbfs:.2f} dBFS)  [objetivo: ~{TARGET_PEAK_DBFS} dBFS, nunca > 0 dBFS]')
    print(f'Muestra inicial: {primera:.6f} (objetivo: ~0)')
    print(f'Muestra final: {ultima:.6f} (objetivo: ~0)')

    # Ventana del primer beep, ya pasado el ataque [10-100 ms].
    ini1, fin1 = int(0.010 * SR), int(0.100 * SR)
    ventana1 = buf[ini1:fin1]
    cruces1 = contar_cruces_por_cero(ventana1)
    freq_estimada1 = cruces1 / 2.0 / ((fin1 - ini1) / SR)
    mag_fund = goertzel_magnitud(ventana1, BEEP_FREQ, SR)
    mag_h3 = goertzel_magnitud(ventana1, BEEP_FREQ * 3, SR)
    mag_h5 = goertzel_magnitud(ventana1, BEEP_FREQ * 5, SR)
    print(f'\nBeep 1 [10-100 ms] — cruces por cero: {cruces1}, freq. fundamental estimada: {freq_estimada1:.1f} Hz (esperado ~{BEEP_FREQ} Hz)')
    print(f'  Goertzel @ fundamental ({BEEP_FREQ:.0f} Hz): {mag_fund:.4f}   @3° ({BEEP_FREQ*3:.0f} Hz): {mag_h3:.4f}   @5° ({BEEP_FREQ*5:.0f} Hz): {mag_h5:.4f}  (fundamental debe dominar, 3°/5° presentes pero menores)')

    # Silencio entre beep 1 y beep 2: debe estar prácticamente en cero.
    ini_gap = int((BEEP_DUR_S + GAP_S / 2) * SR)
    fin_gap = ini_gap + int(0.01 * SR)
    pico_gap = max(abs(x) for x in buf[ini_gap:fin_gap])
    print(f'\nPico en el silencio entre beep 1 y 2: {pico_gap:.6f} (objetivo: ~0, confirma que hay 3 beeps separados, no un tono continuo)')

    # Tercer beep: confirma que el patrón completo (3 repeticiones) está presente.
    ini3, fin3 = int((BEEP_STARTS[2] + 0.010) * SR), int((BEEP_STARTS[2] + 0.100) * SR)
    ventana3 = buf[ini3:fin3]
    mag_fund_3 = goertzel_magnitud(ventana3, BEEP_FREQ, SR)
    print(f'Beep 3 [{BEEP_STARTS[2]*1000+10:.0f}-{BEEP_STARTS[2]*1000+100:.0f} ms] — Goertzel @ fundamental: {mag_fund_3:.4f} (debe tener energía similar al beep 1)')

    assert duracion_s <= 0.9, 'la duración total no puede superar ~900 ms (3 beeps cortos, no un tono largo)'
    assert pico <= 1.0, 'no puede clipear'
    assert abs(primera) < 0.001, 'la muestra inicial debe ser ~0 para no chasquear'
    assert abs(ultima) < 1e-6, 'la muestra final debe ser 0 exacto para no chasquear'
    assert pico_gap < 0.01, 'el silencio entre beeps debe estar prácticamente en cero (deben sonar como 3 beeps separados)'
    assert mag_fund_3 > mag_fund * 0.5, 'el tercer beep debe sonar con energía comparable al primero'
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
