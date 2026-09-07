
const STEPS = [
  { title: 'Preparamos tu operación', text: 'Cargamos el recorrido y los puntos que quieres controlar en el panel.' },
  { title: 'Cada vehículo activa la app', text: 'El celular de cada unidad comparte su ubicación durante el recorrido.' },
  { title: 'Tú ves el movimiento', text: 'Miras en vivo dónde está cada vehículo y qué punto acaba de pasar.' },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="section simple-process">
      <div className="container">
        <div className="section-header"><h2>Cómo funciona QUIVO</h2></div>
        <ol className="simple-steps">
          {STEPS.map((step, index) => {
            return <li key={step.title}><div className="simple-step-top"><span>0{index + 1}</span></div><h3>{step.title}</h3><p>{step.text}</p></li>;
          })}
        </ol>
      </div>
    </section>
  );
}
