import { QuivoConfirmDialog } from './quivo-confirm-dialog';

export interface CerrarSesionDialogProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Diálogo de confirmación único para `onLogout` (Hallazgo 2, ALTO — auditoría post-piloto
 * día 1, ver `docs/plan-v2-app-y-mapa-en-vivo.md` §2.4). Antes había un mensaje distinto por
 * pantalla: `operation-screen.tsx` avisaba que el GPS deja de grabar, pero el botón de
 * `perfil-screen.tsx` —que dispara EXACTAMENTE el mismo `props.onLogout()`, o sea el mismo
 * `borrarSesionMovil()` + el `stop()` nativo IRREVERSIBLE de `detenerTrackingNativo()`
 * (apaga `startOnBoot`, nunca encola `fin_recorrido`)— no lo mencionaba.
 *
 * Centralizado acá para que un tercer call site futuro de `onLogout` no repita el olvido: el
 * mensaje vive en un solo lugar, no en cada pantalla que decide ofrecer "Cerrar sesión".
 */
export function CerrarSesionDialog({ visible, onConfirm, onCancel }: CerrarSesionDialogProps) {
  return (
    <QuivoConfirmDialog
      visible={visible}
      variant="danger"
      icon="log-out-outline"
      title="¿Cerrar sesión?"
      message="Se va a cortar el registro del recorrido hasta que vuelvas a entrar. El GPS deja de guardar tu viaje mientras tanto."
      cancelLabel="Seguir en la app"
      confirmLabel="Cerrar sesión"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
