import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { REACTION_CONFIGS, ReactionConfig } from '@/lib/discussion';
import styles from './Discussion.module.css';

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
  callerReaction?: string | null;
  disabled?: boolean;
  alignRight?: boolean;
  className?: string;
}

interface PickerPosition { top: number; left: number; width: number }

function pickerPosition(trigger: HTMLButtonElement | null, alignRight: boolean): PickerPosition | null {
  const rect = trigger?.getBoundingClientRect();
  if (!rect) return null;
  const width = Math.min(324, window.innerWidth - 16);
  const left = Math.max(8, Math.min(alignRight ? rect.right - width : rect.left, window.innerWidth - width - 8));
  const rows = Math.ceil(REACTION_CONFIGS.length / 6);
  const panelHeight = rows * 44 + Math.max(0, rows - 1) * 4 + 14;
  const placeAbove = window.innerHeight - rect.bottom < panelHeight + 8 && rect.top >= panelHeight + 8;
  const requestedTop = placeAbove ? rect.top - panelHeight - 8 : rect.bottom + 8;
  const top = Math.max(8, Math.min(requestedTop, window.innerHeight - panelHeight - 8));
  return { top, left, width };
}

export function ReactionPicker({ onSelect, callerReaction, disabled = false, alignRight = false, className = '' }: ReactionPickerProps) {
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const isOpen = position !== null;

  useLayoutEffect(() => {
    if (isOpen) panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [isOpen]);

  const handleToggle = () => {
    if (isOpen) { setPosition(null); return; }
    setPosition(pickerPosition(triggerRef.current, alignRight));
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPosition(null);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setPosition(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setPosition(null);
    };
    const onScrollOrResize = () => {
      const next = pickerPosition(triggerRef.current, alignRight);
      setPosition(current => current && next && current.top === next.top && current.left === next.left && current.width === next.width ? current : next);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [isOpen, alignRight]);

  const handleSelect = (emojiId: string) => {
    onSelect(emojiId);
    setPosition(null);
    triggerRef.current?.focus();
  };

  return <>
    <button ref={triggerRef} type="button" disabled={disabled} onClick={handleToggle}
      aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined} aria-haspopup="dialog" aria-label="Add reaction"
      className={`ui-button ui-button--secondary ui-icon-button ${className}`}>
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
    {position && createPortal(
      <div ref={panelRef} id={panelId} role="dialog" aria-label="Choose a reaction"
        className={`${styles.pickerPanel} ui-motion-disclosure`} style={{ top: position.top, left: position.left, width: position.width }}>
        {REACTION_CONFIGS.map((reaction: ReactionConfig) => {
          const selected = callerReaction === reaction.id;
          return <button key={reaction.id} type="button" onClick={() => handleSelect(reaction.id)}
            aria-label={`${reaction.label}${selected ? ' (currently selected)' : ''}`} aria-pressed={selected}
            className="ui-button ui-button--secondary ui-icon-button">
            <span className={styles.pickerEmoji} aria-hidden="true">{reaction.emoji}</span>
          </button>;
        })}
      </div>, document.body
    )}
  </>;
}
