#!/usr/bin/env python3
"""
Genera `confirmacion-chime.wav` (+ su copia dedicada `confirmacion_chime_notificacion_v2.wav`): la
alerta que suena cuando el conductor pasa por un punto de control (QUI — "sonido de confirmación
de registro").

Por qué existe este script en el repo (no solo el .wav binario): el asset es 100% sintético
—no hay conexión a internet para bajar un sonido de stock— así que este generador es la única
fuente reproducible del audio. Si algún día hay que ajustar timbre/duración/frecuencias, se
edita este archivo y se vuelve a correr (`python3 -I generate-confirmacion-chime.py`), en vez de
tocar el binario a mano.

Rediseño v2 (prueba de campo del APK r13: "el chime suena saturado"). La versión anterior (tres
beeps de onda casi cuadrada, pico -1 dBFS, RMS -4.6 dBFS, factor de cresta ~3.6 dB) tenía casi
tanta energía media como el pico: sobre el parlante de un celular de gama media eso satura y
suena áspero. Ahora:
- Acorde mayor (La5 880 Hz + Do#6 1108.7 Hz + Mi6 1318.5 Hz: tónica, tercera y quinta) de
  parciales SENOIDALES puros, sin armónicos impares — consonante y limpio.
- Ataque rápido (5 ms) y decaimiento exponencial: un golpe de campana, no un tono sostenido.
  La energía se concentra al inicio, que es lo que da un factor de cresta alto.
- Las notas entran escalonadas (arpegio de 60 ms entre cada una) para que se lea como "listo"
  y no como una alarma.
- Pico normalizado a -3 dBFS: margen real para que el parlante/AGC del teléfono no recorte.
- 44.1 kHz / 16-bit / mono, ~0.7 s.
- Fade-out final (ventana Hann) que fuerza el último tramo a 0 exacto, para no chasquear.

Sonoridad: el pico se subió de -6 a -3 dBFS (más volumen percibido sobre el motor del trufi)
conservando los parciales senoidales y la envolvente; el factor de cresta no cambia con la
escala. Si aún resultara débil, subir la ganancia del dispositivo antes que volver a una onda
cuadrada.

No usa numpy (no está instalado en este entorno) — `wave` + `math` de la stdlib alcanzan.
"""

import math
import os
import struct
import wave

SR = 44100  # 44.1 kHz
SAMPLE_WIDTH_BYTES = 2  # 16-bit
MAX_INT16 = 32767

# --- Notas: (frecuencia Hz, inicio s, amplitud relativa) — acorde mayor arpegiado ---
NOTAS = [
    (880.00, 0.000, 1.0),  # La5 — tónica
    (1108.73, 0.060, 0.8),  # Do#6 — tercera mayor
    (1318.51, 0.120, 0.7),  # Mi6 — quinta
]

# --- Envolvente ---
ATTACK_S = 0.005  # 5 ms: ataque rápido pero sin click
TAU_S = 0.16  # constante de tiempo del decaimiento exponencial (≈ -54 dB/s)

TOTAL_DUR_S = 0.70
FINAL_FADE_S = 0.030  # fade-out final, ventana Hann (derivada nula en el borde)

# --- Normalización: -3 dBFS de pico ---
TARGET_PEAK_DBFS = -3.0
TARGET_PEAK_LINEAR = 10 ** (TARGET_PEAK_DBFS / 20.0)
MIN_CRESTA_DB = 10.0

DIRECTORIO = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATHS = [
    os.path.join(DIRECTORIO, 'confirmacion-chime.wav'),
    # Copia dedicada para el canal de notificación Android `quivo-anuncio-punto-control-v2`:
    # los recursos `raw` de Android solo aceptan `[a-z0-9_.]` (sin guiones), y el sonido de un
    # canal es inmutable tras crearse — por eso el sufijo `_v2` cambia junto con el id del canal.
    os.path.join(DIRECTORIO, 'confirmacion_chime_notificacion_v2.wav'),
]


def envolvente(t_rel: float) -> float:
    """Ataque lineal de `ATTACK_S`, luego decaimiento exponencial con constante `TAU_S`."""
    if t_rel < 0:
        return 0.0
    if t_rel < ATTACK_S:
        return t_rel / ATTACK_S
    return math.exp(-(t_rel - ATTACK_S) / TAU_S)


def generar() -> list:
    n_samples = int(round(TOTAL_DUR_S * SR))
    buf = [0.0] * n_samples
    for i in range(n_samples):
        t = i / SR
        muestra = 0.0
        for freq, inicio, amp in NOTAS:
            t_rel = t - inicio
            if t_rel < 0:
                continue
            muestra += amp * envolvente(t_rel) * math.sin(2.0 * math.pi * freq * t_rel)
        buf[i] = muestra

    # Fade-out final: ventana Hann sobre los últimos FINAL_FADE_S segundos, para terminar en 0
    # exacto sin discontinuidad de pendiente.
    fade_samples = int(round(FINAL_FADE_S * SR))
    for k in range(fade_samples):
        idx = n_samples - fade_samples + k
        mult = 0.5 * (1.0 + math.cos(math.pi * k / (fade_samples - 1)))
        buf[idx] *= mult

    return buf


def normalizar(buf: list) -> list:
    """Escala `buf` a pico `TARGET_PEAK_LINEAR` (-3 dBFS). La verificación corre SIEMPRE sobre
    esta versión normalizada, que es la que termina en el .wav."""
    pico_actual = max(abs(x) for x in buf) or 1.0
    factor = TARGET_PEAK_LINEAR / pico_actual
    return [x * factor for x in buf]


def convertir_a_pcm16(buf: list) -> bytes:
    frames = bytearray()
    for x in buf:
        v = max(-1.0, min(1.0, x))
        frames += struct.pack('<h', int(round(v * MAX_INT16)))
    return bytes(frames)


def escribir_wav(frames: bytes, path: str) -> None:
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(SAMPLE_WIDTH_BYTES)
        wf.setframerate(SR)
        wf.writeframes(frames)


def estadisticas(muestras: list) -> tuple:
    """(pico dBFS, RMS dBFS, factor de cresta dB) de muestras float en [-1, 1]."""
    pico = max(abs(x) for x in muestras)
    rms = math.sqrt(sum(x * x for x in muestras) / len(muestras))
    pico_db = 20 * math.log10(pico)
    rms_db = 20 * math.log10(rms)
    return pico_db, rms_db, pico_db - rms_db


def verificar_archivo(path: str) -> None:
    """Relee el .wav escrito (no el buffer en memoria) y verifica sus propiedades reales."""
    with wave.open(path, 'rb') as wf:
        canales, ancho, sr, n = wf.getnchannels(), wf.getsampwidth(), wf.getframerate(), wf.getnframes()
        crudo = wf.readframes(n)
    muestras = [s / MAX_INT16 for s in struct.unpack('<%dh' % n, crudo)]
    pico_db, rms_db, cresta_db = estadisticas(muestras)
    duracion_s = n / sr
    print(f'--- {os.path.basename(path)} ---')
    print(f'Formato: {canales} canal(es), {ancho * 8} bit, {sr} Hz, {duracion_s:.3f} s ({n} muestras)')
    print(f'Pico: {pico_db:.2f} dBFS | RMS: {rms_db:.2f} dBFS | Cresta: {cresta_db:.2f} dB')
    print(f'Muestra inicial: {muestras[0]:.6f} | final: {muestras[-1]:.6f}')

    assert (canales, ancho, sr) == (1, 2, SR), 'formato debe ser mono / 16-bit / 44.1 kHz'
    assert 0.6 <= duracion_s <= 0.8, 'duración fuera de 0.6-0.8 s'
    assert abs(pico_db - TARGET_PEAK_DBFS) < 0.1, 'pico debe ser ~-3 dBFS'
    assert cresta_db >= MIN_CRESTA_DB, f'factor de cresta < {MIN_CRESTA_DB} dB (suena saturado)'
    assert abs(muestras[0]) < 0.001, 'la muestra inicial debe ser ~0 para no chasquear'
    assert muestras[-1] == 0.0, 'la muestra final debe ser 0 exacto para no chasquear'


def main() -> None:
    frames = convertir_a_pcm16(normalizar(generar()))
    for path in OUTPUT_PATHS:
        escribir_wav(frames, path)
        verificar_archivo(path)
        print(f'Escrito: {path} ({os.path.getsize(path) / 1024.0:.1f} KB)\n')
    print('OK — todas las aserciones pasaron.')


if __name__ == '__main__':
    main()
