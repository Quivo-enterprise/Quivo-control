'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils.js';
import type { SelectChangeEvent, SelectOption } from '../types.js';
import { CalendarIcon, ChevronDownIcon, CloseIcon, SearchIcon } from './icons.js';

// `useLayoutEffect` avisa por consola si corre durante SSR ("does nothing on the server") —
// este archivo es `'use client'`, pero Next igual prerrenderiza los client components en el
// servidor. El patrón isomórfico estándar (Radix, Redux...) evita el warning sin perder el
// efecto síncrono-antes-de-pintar que necesita `Select` para no parpadear en la posición
// equivocada al abrir el listbox portado (ver más abajo).
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/* ---------------------------------------------------------------------------------------
 * FormField — envoltorio label + control + error/helper, usado por module-table-page.tsx y
 * los formularios a medida (vehículos, rotaciones...).
 * ------------------------------------------------------------------------------------- */

export interface FormFieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  children: ReactNode;
}

export function FormField({ label, htmlFor, required, error, helperText, children }: FormFieldProps) {
  return (
    <div className={cx('qv-field', error && 'qv-field--invalid')}>
      <label className="qv-field__label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="qv-field__required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      <div className="qv-field__control">{children}</div>
      {error ? (
        <span className="qv-field__error" role="alert">
          {error}
        </span>
      ) : helperText ? (
        <span className="qv-field__helper">{helperText}</span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * FormGroup — `<form>` semántico con el espaciado vertical estándar de campos.
 * ------------------------------------------------------------------------------------- */

export type FormGroupProps = FormHTMLAttributes<HTMLFormElement>;

export function FormGroup({ className, children, ...rest }: FormGroupProps) {
  return (
    <form className={cx('qv-form-group', className)} {...rest}>
      {children}
    </form>
  );
}

/* ---------------------------------------------------------------------------------------
 * Input
 * ------------------------------------------------------------------------------------- */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  helperText?: string;
  fullWidth?: boolean;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
}

export function Input({
  label,
  helperText,
  fullWidth,
  leftSlot,
  rightSlot,
  id,
  className,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <div className={cx('qv-field', fullWidth && 'qv-field--full')}>
      {label && (
        <label className="qv-field__label" htmlFor={controlId}>
          {label}
          {rest.required && (
            <span className="qv-field__required" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
      )}
      <span
        className={cx(
          'qv-input',
          Boolean(leftSlot) && 'qv-input--has-left',
          Boolean(rightSlot) && 'qv-input--has-right',
          fullWidth && 'qv-input--full',
          className,
        )}
      >
        {leftSlot && (
          <span className="qv-input__slot qv-input__slot--left" aria-hidden="true">
            {leftSlot}
          </span>
        )}
        <input id={controlId} className="qv-input__control" {...rest} />
        {rightSlot && (
          <span className="qv-input__slot qv-input__slot--right" aria-hidden="true">
            {rightSlot}
          </span>
        )}
      </span>
      {helperText && <span className="qv-field__helper">{helperText}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * TextArea
 * ------------------------------------------------------------------------------------- */

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  fullWidth?: boolean;
}

export function TextArea({ label, helperText, fullWidth, id, className, ...rest }: TextAreaProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <div className={cx('qv-field', fullWidth && 'qv-field--full')}>
      {label && (
        <label className="qv-field__label" htmlFor={controlId}>
          {label}
        </label>
      )}
      <textarea
        id={controlId}
        className={cx('qv-textarea', fullWidth && 'qv-textarea--full', className)}
        rows={rest.rows ?? 4}
        {...rest}
      />
      {helperText && <span className="qv-field__helper">{helperText}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * DatePicker — input nativo `type="date"` con el mismo envoltorio visual que Input.
 * ------------------------------------------------------------------------------------- */

export interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  helperText?: string;
  fullWidth?: boolean;
}

export function DatePicker({ label, helperText, fullWidth, id, className, ...rest }: DatePickerProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <div className={cx('qv-field', fullWidth && 'qv-field--full')}>
      {label && (
        <label className="qv-field__label" htmlFor={controlId}>
          {label}
        </label>
      )}
      <span className={cx('qv-input', 'qv-input--has-right', fullWidth && 'qv-input--full', className)}>
        <input id={controlId} type="date" className="qv-input__control" {...rest} />
        <span className="qv-input__slot qv-input__slot--right" aria-hidden="true">
          <CalendarIcon />
        </span>
      </span>
      {helperText && <span className="qv-field__helper">{helperText}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * Checkbox
 * ------------------------------------------------------------------------------------- */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export function Checkbox({ label, id, className, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <label className={cx('qv-checkbox', rest.disabled && 'qv-checkbox--disabled', className)} htmlFor={controlId}>
      <input id={controlId} type="checkbox" className="qv-checkbox__input" {...rest} />
      <span className="qv-checkbox__box" aria-hidden="true" />
      <span className="qv-checkbox__label">{label}</span>
    </label>
  );
}

/* ---------------------------------------------------------------------------------------
 * ColorPicker — usado por module-table-page.tsx para el campo `kind: 'color'` (color propio
 * de cada sindicato en el mapa de rutas). El `onChange` entrega el valor directo, no un
 * evento — así lo consume `handleFieldChange(field.key, next)`.
 * ------------------------------------------------------------------------------------- */

export interface ColorPickerProps {
  id?: string;
  name?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

// `input[type=color]` no admite un estado "sin color": siempre necesita un hex válido para
// pintar su swatch. Antes se mostraba este índigo en el swatch mientras la etiqueta decía
// "Sin color" y el formulario seguía guardando `''` — lo visible y lo almacenado no
// coincidían. Se eligió comprometerse con este valor por defecto real (en vez de fingir un
// swatch de "sin color" que el control nativo no puede representar): en el primer montaje,
// si todavía no hay color, se emite explícitamente por `onChange` para que el estado del
// formulario deje de ser `''` y pase a valer lo mismo que ya se le mostraba al usuario. De
// paso cierra el hallazgo de `route-map-impl.tsx`: una línea guardada sin tocar el picker ya
// no persiste `''` (que ahí producía una ruta invisible en el mapa).
const DEFAULT_COLOR_PICKER_VALUE = '#3226b4';

export function ColorPicker({ id, name, label, value, onChange, className }: ColorPickerProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;

  // Guard con ref (no un array de deps vacío) para que siga funcionando aunque `onChange` no
  // llegue memoizado desde el call site (no lo está en `module-table-page.tsx`): sin el guard,
  // cada render con una nueva identidad de `onChange` volvería a disparar el efecto.
  const didEmitDefault = useRef(false);
  useEffect(() => {
    if (didEmitDefault.current) return;
    didEmitDefault.current = true;
    if (!value) onChange(DEFAULT_COLOR_PICKER_VALUE);
  }, [value, onChange]);

  return (
    <div className="qv-field">
      {label && (
        <label className="qv-field__label" htmlFor={controlId}>
          {label}
        </label>
      )}
      <span className={cx('qv-color-picker', className)}>
        <input
          id={controlId}
          name={name}
          type="color"
          className="qv-color-picker__input"
          value={value || DEFAULT_COLOR_PICKER_VALUE}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="qv-color-picker__value">{value || DEFAULT_COLOR_PICKER_VALUE}</span>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * SearchInput
 * ------------------------------------------------------------------------------------- */

export interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  className?: string;
}

export function SearchInput({ placeholder, value, onChange, onClear, className }: SearchInputProps) {
  return (
    <span className={cx('qv-input', 'qv-search-input', className)}>
      <span className="qv-input__slot qv-input__slot--left" aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        type="search"
        className="qv-input__control"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className="qv-input__slot qv-input__slot--right qv-search-input__clear"
          onClick={onClear}
          aria-label="Limpiar búsqueda"
        >
          <CloseIcon />
        </button>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------
 * Select — combobox accesible (botón + listbox), NO un `<select>` nativo.
 *
 * `apps/web` espera poder hacer `page.locator('button#<id>')` y luego
 * `page.getByRole('option', { name: '...' })` (ver tests/acceptance/admin-panel.spec.ts) — un
 * `<select>` nativo no expone sus `<option>` como nodos clicables por Playwright dentro del
 * DOM (los renderiza el navegador fuera del árbol de accesibilidad web), así que el control
 * real es un botón con `role="combobox"` + una lista `role="listbox"`. El `onChange` expuesto
 * imita la forma mínima de un evento nativo (`{ target: { value } }`) para no romper ningún
 * call-site existente (`event.target.value`).
 *
 * El listbox se porta a `document.body` (con `createPortal`, igual que `<Modal>` en
 * `overlay.tsx`) y se posiciona con `position: fixed` calculado desde el `getBoundingClientRect`
 * del trigger. Antes vivía `position: absolute` dentro de `.qv-select`, así que un `Select`
 * dentro de un `<Modal>` quedaba recortado por el `overflow-y: auto` de `.qv-modal__body` en
 * vez de superponerse. La navegación por teclado sigue el patrón ARIA de combobox con
 * `aria-activedescendant`: el foco del DOM se queda en el botón (no hay "roving focus" entre
 * `<li>`), las flechas mueven `activeIndex` (resaltado visual + `aria-activedescendant`) y
 * Enter confirma la opción activa.
 * ------------------------------------------------------------------------------------- */

/** Estilo inline del listbox portado: anclado por `top` (abre hacia abajo) o `bottom` (flip). */
interface SelectPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: string;
}

const SELECT_GAP = 6;
const SELECT_VIEWPORT_MARGIN = 8;
const SELECT_DEFAULT_HEIGHT = 256; // = `max-height: 16rem` de `.qv-select-listbox`

/**
 * Posiciona el listbox `fixed` dentro del viewport: abre hacia abajo si cabe, si no hacia
 * arriba (flip) cuando hay más espacio ahí, y acota `max-height` al espacio disponible para
 * que ninguna opción quede fuera de pantalla. Un `position: fixed` fuera del viewport no se
 * puede traer con scroll, así que sin esto las opciones quedaban inalcanzables (Playwright:
 * "element is outside of the viewport") cuando el trigger estaba cerca del borde inferior.
 * `contentHeight` es el alto natural del listbox si ya está montado; si no, se asume el máximo.
 */
function computeSelectPosition(rect: DOMRect, contentHeight: number | undefined): SelectPosition {
  const desired = Math.min(contentHeight ?? SELECT_DEFAULT_HEIGHT, SELECT_DEFAULT_HEIGHT);
  const spaceBelow = window.innerHeight - rect.bottom - SELECT_GAP - SELECT_VIEWPORT_MARGIN;
  const spaceAbove = rect.top - SELECT_GAP - SELECT_VIEWPORT_MARGIN;
  const base = { left: rect.left, width: rect.width };
  if (spaceBelow >= desired || spaceBelow >= spaceAbove) {
    return {
      ...base,
      top: rect.bottom + SELECT_GAP,
      maxHeight: `min(16rem, ${Math.max(0, spaceBelow)}px)`,
    };
  }
  return {
    ...base,
    bottom: window.innerHeight - rect.top + SELECT_GAP,
    maxHeight: `min(16rem, ${Math.max(0, spaceAbove)}px)`,
  };
}

export interface SelectProps {
  id?: string;
  name?: string;
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (event: SelectChangeEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
  helperText?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
}

export function Select({
  id,
  name,
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  required,
  fullWidth,
  helperText,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabelProp,
}: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<SelectPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // Cierre por click afuera / Escape. El listbox vive portado en `document.body` (fuera del
  // subárbol de `containerRef`), así que un click adentro de la lista también cuenta como
  // "adentro" — si no, cada click en una opción se interpretaría como click afuera y cerraría
  // el dropdown antes de que el `onClick` de la opción llegara a disparar.
  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (listboxRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Posición del listbox portado, calculada desde el trigger. `capture: true` en el listener
  // de scroll es a propósito: el scroll de un ancestro (ej. `.qv-modal__body`) no burbujea,
  // pero sí se puede capturar en su camino hacia abajo desde `window`.
  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    function updatePosition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition(computeSelectPosition(rect, listboxRef.current?.scrollHeight));
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function openList() {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition(computeSelectPosition(rect, undefined));
    }
    setOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }

  function selectOption(nextValue: string) {
    onChange({ target: { value: nextValue } });
    setOpen(false);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActiveIndex((current) => Math.min(options.length - 1, current + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else setActiveIndex((current) => Math.max(0, current - 1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!open) openList();
        else if (activeIndex >= 0 && options[activeIndex]) selectOption(options[activeIndex].value);
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
      default:
        break;
    }
  }

  const activeOptionId = open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className={cx('qv-field', fullWidth && 'qv-field--full')}>
      {label && (
        <label className="qv-field__label" htmlFor={controlId}>
          {label}
          {required && (
            <span className="qv-field__required" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
      )}
      <div className={cx('qv-select', fullWidth && 'qv-select--full')} ref={containerRef}>
        <button
          type="button"
          id={controlId}
          name={name}
          role="combobox"
          className="qv-select-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabelProp ?? (label ? undefined : placeholder)}
          aria-activedescendant={activeOptionId}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="qv-select-trigger__value">
            {selected ? selected.label : (placeholder ?? '')}
          </span>
          <ChevronDownIcon className="qv-select-trigger__chevron" />
        </button>
        {open &&
          createPortal(
            <ul
              ref={listboxRef}
              className="qv-select-listbox"
              role="listbox"
              id={listboxId}
              aria-label={label ?? ariaLabelProp ?? placeholder}
              style={position ?? undefined}
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  role="option"
                  id={`${listboxId}-option-${index}`}
                  aria-selected={option.value === value}
                  className={cx(
                    'qv-select-option',
                    option.value === value && 'qv-select-option--selected',
                    index === activeIndex && 'qv-select-option--active',
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option.value)}
                >
                  {option.label}
                </li>
              ))}
            </ul>,
            document.body,
          )}
      </div>
      {helperText && <span className="qv-field__helper">{helperText}</span>}
    </div>
  );
}
