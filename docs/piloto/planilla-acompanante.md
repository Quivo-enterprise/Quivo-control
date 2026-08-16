# Planilla del acompañante — piloto Z12

> **Para qué existe.** El sistema mide su propia detección contra sí mismo: el worker del
> servidor revalida el evento con las mismas coordenadas que mandó el teléfono, así que siempre
> coincide. Sin un registro humano independiente, el porcentaje de puntos de control detectados
> no se puede verificar — solo se puede creer.
>
> **Esta planilla es la verdad de campo.** Es lo único que convierte el día 1 en una medición en
> vez de una demostración. Si el sistema dice que detectó 9 de 10 y acá figuran 12 pasos, sabemos
> que el problema existe y de qué tamaño es. Sin esto, ese 9 de 10 no significa nada.

## Antes de arrancar

- [ ] **Sincronizar el reloj.** Usar un teléfono con hora de red (automática), no manual. Anotar
      acá cuál se usó: ______________________
- [ ] Anotar la hora exacta de inicio de jornada: ______________________
- [ ] Anotar el nivel de batería del teléfono del conductor al arrancar: ______ %
- [ ] Confirmar que la app quedó abierta y con el recorrido iniciado.

## Cómo registrar cada paso

**El trufi no se detiene en los puntos de control** salvo que el tráfico lo obligue. Eso hace que
la hora tenga que ser precisa: anotar **hora, minuto y segundo** del momento en que el vehículo
pasa **frente** al punto de control (a la altura, no antes ni después).

La columna "¿Frenó?" es la más importante de todas después de la hora: cuando el vehículo baja de
18 km/h, el GPS toma muestras más seguido y la detección se vuelve mucho más probable. Si no
distinguimos los pasos frenados de los pasos a velocidad, no vamos a saber si el sistema detecta
bien o si solo detecta cuando hay tráfico.

| # | Vuelta | Punto de control | Hora (HH:MM:SS) | ¿Frenó? | ¿Por qué frenó? | Notas |
|---|---|---|---|---|---|---|
| 1 | | | | Sí / No | tráfico / semáforo / pasajero / — | |
| 2 | | | | Sí / No | | |
| 3 | | | | Sí / No | | |
| 4 | | | | Sí / No | | |
| 5 | | | | Sí / No | | |
| 6 | | | | Sí / No | | |
| 7 | | | | Sí / No | | |
| 8 | | | | Sí / No | | |
| 9 | | | | Sí / No | | |
| 10 | | | | Sí / No | | |
| 11 | | | | Sí / No | | |
| 12 | | | | Sí / No | | |
| 13 | | | | Sí / No | | |
| 14 | | | | Sí / No | | |
| 15 | | | | Sí / No | | |
| 16 | | | | Sí / No | | |
| 17 | | | | Sí / No | | |
| 18 | | | | Sí / No | | |
| 19 | | | | Sí / No | | |
| 20 | | | | Sí / No | | |

*(Seguir en hoja aparte si hacen falta más filas. Conviene sobrar espacio: son varias vueltas.)*

## Eventos de la jornada

Anotar la hora de cada uno. Estos explican los huecos que después aparezcan en los datos.

| Evento | Hora | Notas |
|---|---|---|
| Inicio de jornada | | |
| Pantalla apagada (desde / hasta) | | |
| Se cerró la app / se mató | | ¿Fue a propósito o sola? |
| Se reinició el teléfono | | |
| Se quedó sin señal (desde / hasta) | | Zona aproximada |
| Se puso a cargar el teléfono | | |
| Fin de jornada | | |

## Vueltas completadas

El sistema todavía no modela el objetivo de vueltas, así que este conteo es manual y es el único
registro que va a existir del día 1.

- Vueltas que le correspondía hacer: ______
- Vueltas efectivamente completadas: ______
- Motivo si no coinciden: ______________________________________________

## Al cerrar la jornada

- [ ] Batería final del teléfono: ______ % · Hora: ______
- [ ] ¿Se cargó el teléfono durante la jornada? Sí / No
- [ ] ¿El conductor pidió ayuda en algún momento? ¿Para qué?
      ______________________________________________
- [ ] ¿Hubo algún momento en que la app confundió al conductor?
      ______________________________________________
- [ ] Total de pasos por puntos de control anotados en esta planilla: ______

Ese último número es el denominador de todo el análisis. Sin él no hay porcentaje de detección
que valga.

## Qué se hace con esto después

Se cruza la planilla contra `cumplimientos_pc` en la base, por hora y punto de control. De ahí
salen las tres cosas que el piloto tiene que responder:

1. **Cuántos pasos reales detectó el sistema** — el porcentaje verdadero, no el que el sistema
   calcula sobre sí mismo.
2. **Si los pasos no detectados fueron los que no frenaron** — que confirmaría la hipótesis del
   espaciado GPS elástico, y con ella qué radio hace falta.
3. **Si hubo detecciones que no corresponden a ningún paso anotado** — falsos positivos, que hoy
   son indetectables por completo.

Además, la traza GPS cruda queda guardada seis meses, así que con estas horas se puede recalcular
después qué habría detectado cada radio (30 / 50 / 100 / 150 m) sin volver a salir a la calle.
