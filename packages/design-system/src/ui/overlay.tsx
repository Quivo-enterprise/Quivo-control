'use client';

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils.js';
import { CloseIcon } from './icons.js';
import { Button } from './primitives.js';

interface BaseDialogProps {
  open: boolean;
  onClose: () => void;
  role: 'dialog' | 'alertdialog';
  title: string;
  description?: string;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Base compartida por `<Modal>` y `<ConfirmDialog>` — portal a `document.body`, cierre con
 * Escape/click en el backdrop, y foco inicial en el contenedor del diálogo. */
function BaseDialog({ open, onClose, role, title, description, footer, children, className }: BaseDialogProps) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  // `onClose` casi nunca llega memoizado desde `apps/web` (ej. `module-table-page.tsx` lo
  // declara de nuevo en cada render porque cierra sobre el estado del formulario). Guardarlo
  // en un ref deja que el listener de Escape siempre vea la versión fresca sin que el efecto
  // de abajo tenga que depender de su identidad — si dependiera, cada tecla del formulario
  // (que cambia `formValues` y por lo tanto recrea `onClose`) volvería a correr el efecto y
  // le robaría el foco al input activo.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Solo debe enfocar el diálogo en la transición `false → true` de `open`, nunca en cada
  // render mientras sigue abierto. `wasOpenRef` guarda si ya enfocamos para el `open` actual.
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return undefined;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    document.addEventListener('keydown', handleKeyDown);
    // Si el modal monta ya con `open=true`, esta primera corrida ocurre con `mounted`
    // todavía en `false` (el portal aún no existe, `dialogRef.current` es `null`). Al
    // depender de `mounted` acá, el efecto vuelve a correr en cuanto pasa a `true` y el
    // foco inicial sí se setea — antes se perdía porque el efecto solo dependía de `open`.
    if (!wasOpenRef.current && mounted) {
      dialogRef.current?.focus();
      wasOpenRef.current = true;
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, mounted]);

  if (!open || !mounted) return null;

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return createPortal(
    <div className="qv-modal-backdrop" onMouseDown={handleBackdropClick}>
      <div
        ref={dialogRef}
        className={cx('qv-modal', className)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="qv-modal__header">
          <h2 id={titleId} className="qv-modal__title">
            {title}
          </h2>
          <button type="button" className="qv-modal__close" onClick={onClose} aria-label="Cerrar">
            <CloseIcon />
          </button>
        </header>
        <div className="qv-modal__body">
          {description && (
            <p id={descriptionId} className="qv-modal__description">
              {description}
            </p>
          )}
          {children}
        </div>
        {footer !== undefined && <footer className="qv-modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------------------------------
 * Modal
 * ------------------------------------------------------------------------------------- */

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Modal({ open, title, description, onClose, footer, children, className }: ModalProps) {
  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      role="dialog"
      title={title}
      description={description}
      footer={footer}
      className={className}
    >
      {children}
    </BaseDialog>
  );
}

/* ---------------------------------------------------------------------------------------
 * ConfirmDialog — siempre `role="alertdialog"` (así lo esperan los tests de aceptación,
 * `page.getByRole('alertdialog')`), con un botón "Cancelar" fijo — ningún call-site de
 * `apps/web` pasa una etiqueta de cancelación distinta.
 * ------------------------------------------------------------------------------------- */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  variant?: 'primary' | 'danger';
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  variant = 'primary',
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <BaseDialog
      open={open}
      onClose={onCancel}
      role="alertdialog"
      title={title}
      description={message}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
