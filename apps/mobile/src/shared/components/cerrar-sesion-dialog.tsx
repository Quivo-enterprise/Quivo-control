import { QuivoConfirmDialog } from './quivo-confirm-dialog';
export interface CerrarSesionDialogProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
export function CerrarSesionDialog({ visible, onConfirm, onCancel }: CerrarSesionDialogProps) {
  return (
    <QuivoConfirmDialog
      visible={visible}
      title="¿Cerrar sesión?"
      message="Se va a cortar el registro del recorrido hasta que vuelvas a entrar. El GPS deja de guardar tu viaje mientras tanto."
      cancelLabel="Cancelar"
      confirmLabel="Cerrar sesión"
      variant="danger"
      icon="warning-outline"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
