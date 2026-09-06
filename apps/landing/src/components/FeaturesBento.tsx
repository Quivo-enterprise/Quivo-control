import { Clock, FileCheck2, ListChecks, MapPinned, Route, ShieldCheck, Smartphone } from 'lucide-react';

const FEATURES = [
  { icon: Clock, title: 'Horarios claros', text: 'La hora de paso queda registrada.' },
  { icon: ListChecks, title: 'Turnos organizados', text: 'Cada conductor sabe cuándo le toca salir.' },
  { icon: Smartphone, title: 'También sin señal', text: 'El celular guarda el registro y lo envía cuando vuelve internet.' },
  { icon: Route, title: 'Recorridos y paradas', text: 'Consulta tus trayectos y puntos de control desde un mismo lugar.' },
  { icon: MapPinned, title: 'Puntos de paso', text: 'Identifica dónde está cada trufi durante el recorrido.' },
  { icon: FileCheck2, title: 'Historial consultable', text: 'Revisa lo ocurrido por vehículo y turno.' },
  { icon: ShieldCheck, title: 'Operación ordenada', text: 'Mantén visible el movimiento de toda la línea.' },
];

export function FeaturesBento() {
  return <section className="section simple-benefits" id="caracteristicas"><div className="container"><div className="section-header"><h2>Qué puedes hacer con QUIVO</h2></div><div className="simple-benefit-grid">{FEATURES.map(({ icon: Icon, title, text }) => <article key={title}><Icon size={28} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></article>)}</div></div></section>;
}
