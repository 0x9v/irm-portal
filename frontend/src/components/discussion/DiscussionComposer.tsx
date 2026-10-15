import React, { useState, useRef, useEffect, useCallback } from 'react';
import { StickerItem, PendingSubmission, StickerLibraryItem, StickerLibraryResponse } from '@/types/discussion';
import { STATIC_STICKERS } from '@/lib/discussion';
import { fetchApi, ApiError } from '@/lib/api';
import { StickerAsset } from './StickerAsset';
import { AuthenticatedStickerImage } from './AuthenticatedStickerImage';
import ConfirmationDialog from '@/components/moderation/ConfirmationDialog';
import styles from './Discussion.module.css';

interface DiscussionComposerProps {
  onSendText: (content: string) => Promise<boolean>;
  onSendSticker: (stickerId: string) => Promise<boolean>;
  onSendCustomSticker: (assetId: string) => Promise<boolean>;
  onRetrySubmission?: (pending: PendingSubmission) => Promise<boolean>;
  onDismissPending?: () => void;
  pendingSubmission?: PendingSubmission | null;
  stickers?: StickerItem[];
  catalogError?: string | null;
  onRetryCatalog?: () => void;
  isLoadingStickers?: boolean;
  disabled?: boolean;
  userId: string;
  libraryOnly?: boolean;
}

const MAX_CHARS = 2000;

export function DiscussionComposer({
  onSendText,
  onSendSticker,
  onSendCustomSticker,
  onRetrySubmission,
  onDismissPending,
  pendingSubmission,
  stickers = STATIC_STICKERS,
  catalogError = null,
  onRetryCatalog,
  isLoadingStickers = false,
  disabled = false,
  userId,
  libraryOnly = false,
}: DiscussionComposerProps) {
  const [text, setText] = useState('');
  const [isStickerPickerOpen, setIsStickerPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickerTab, setPickerTab] = useState<'built-in' | 'mine'>('built-in');
  const [library, setLibrary] = useState<StickerLibraryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'uncertain'>('idle');
  const [removeTarget, setRemoveTarget] = useState<StickerLibraryItem | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const pickerId = React.useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickerPickerRef = useRef<HTMLDivElement>(null);
  const stickerButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<'built-in' | 'mine', HTMLButtonElement | null>>({ 'built-in': null, mine: null });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const libraryAbortRef = useRef<AbortController | null>(null);
  const submissionLockRef = useRef(false);

  // Keep the picker a non-modal disclosure: focus may leave it normally, and
  // Escape/outside dismissal returns focus only when focus was inside it.
  useEffect(() => {
    if (!isStickerPickerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsStickerPickerOpen(false);
        stickerButtonRef.current?.focus();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (stickerPickerRef.current && !stickerPickerRef.current.contains(e.target as Node)) {
        if (stickerPickerRef.current.contains(document.activeElement)) stickerButtonRef.current?.focus();
        setIsStickerPickerOpen(false);
      }
    };
    const handleFocusIn = (e: FocusEvent) => {
      if (stickerPickerRef.current && !stickerPickerRef.current.contains(e.target as Node)) {
        setIsStickerPickerOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [isStickerPickerOpen]);

  useEffect(() => {
    if (isStickerPickerOpen) tabRefs.current[pickerTab]?.focus();
  }, [isStickerPickerOpen, pickerTab]);

  useEffect(() => {
    return () => { if (uploadPreview) URL.revokeObjectURL(uploadPreview); };
  }, [uploadPreview]);

  useEffect(() => () => libraryAbortRef.current?.abort(), []);

  const loadLibrary = useCallback(async (append = false, force = false) => {
    if (libraryLoading && !force) return;
    libraryAbortRef.current?.abort();
    const controller = new AbortController();
    libraryAbortRef.current = controller;
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const query = new URLSearchParams({ limit: '30' });
      if (append && nextCursor) query.set('before', nextCursor);
      const data = await fetchApi<StickerLibraryResponse>(`/api/v1/auth/me/stickers?${query.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setLibrary(prev => append ? [...prev, ...data.items.filter(item => !prev.some(old => old.id === item.id))] : data.items);
      setNextCursor(data.next_cursor);
      setLibraryLoaded(true);
    } catch {
      if (controller.signal.aborted) return;
      setLibraryError('Could not load your sticker library.');
    } finally {
      if (!controller.signal.aborted) setLibraryLoading(false);
    }
  }, [libraryLoading, nextCursor]);

  const trimmedText = text.trim();
  const charCount = Array.from(text).length;
  const isOverLimit = charCount > MAX_CHARS;
  const canSend = trimmedText.length > 0 && !isOverLimit && !isSubmitting && !disabled;

  const beginSubmission = () => {
    if (submissionLockRef.current || disabled) return false;
    submissionLockRef.current = true;
    setIsSubmitting(true);
    return true;
  };

  const finishSubmission = () => {
    submissionLockRef.current = false;
    setIsSubmitting(false);
  };

  const resizeTextarea = useCallback(() => {
    const input = textareaRef.current;
    if (!input) return;
    const maxHeight = window.matchMedia('(max-height: 640px)').matches ? 92 : 136;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => { resizeTextarea(); }, [text, resizeTextarea]);

  const handleSendText = async () => {
    if (!canSend || !beginSubmission()) return;
    const contentToSend = text;
    try {
      const success = await onSendText(contentToSend);
      if (success) {
        setText('');
        textareaRef.current?.focus();
      }
    } finally {
      finishSubmission();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ordinary Enter inserts a newline (default browser textarea behavior)
    // Ctrl+Enter or Cmd+Enter triggers explicit send
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      e.preventDefault();
      handleSendText();
    }
  };

  const handleSelectSticker = async (stickerId: string) => {
    if (!beginSubmission()) return;
    setIsStickerPickerOpen(false);
    stickerButtonRef.current?.focus();
    try {
      await onSendSticker(stickerId);
    } finally {
      finishSubmission();
    }
  };

  const handleSelectCustomSticker = async (assetId: string) => {
    if (!beginSubmission()) return;
    setIsStickerPickerOpen(false);
    stickerButtonRef.current?.focus();
    try { await onSendCustomSticker(assetId); }
    finally { finishSubmission(); }
  };

  const handleRetrySubmission = async (pending: PendingSubmission) => {
    if (!onRetrySubmission || !beginSubmission()) return;
    try { await onRetrySubmission(pending); }
    finally { finishSubmission(); }
  };

  const handlePickerTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const tabs = ['built-in', 'mine'] as const;
    const current = tabs.indexOf(pickerTab);
    let next: typeof tabs[number] | null = null;
    if (event.key === 'ArrowRight') next = tabs[(current + 1) % tabs.length];
    else if (event.key === 'ArrowLeft') next = tabs[(current + tabs.length - 1) % tabs.length];
    else if (event.key === 'Home') next = tabs[0];
    else if (event.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault();
    setPickerTab(next);
    tabRefs.current[next]?.focus();
    if (next === 'mine' && !libraryLoaded && !libraryLoading) void loadLibrary();
  };

  const chooseUpload = (file?: File) => {
    setUploadError(null); setUploadStatus('idle');
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null); setUploadFile(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setUploadError('Choose a PNG or JPEG image.'); return; }
    if (file.size > 2_097_152) { setUploadError('This image is larger than 2 MiB. Choose a smaller file.'); return; }
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
  };

  const cancelUpload = () => {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(null); setUploadFile(null); setUploadError(null); setUploadStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadSticker = async () => {
    if (!uploadFile || uploadStatus === 'uploading') return;
    const form = new FormData();
    form.append('file', uploadFile, uploadFile.name);
    setUploadStatus('uploading'); setUploadError(null);
    try {
      await fetchApi<StickerLibraryItem>('/api/v1/auth/me/stickers', { method: 'POST', body: form }, 201);
      cancelUpload();
      setLibraryLoaded(false);
      await loadLibrary(false, true);
      setPickerTab('mine');
    } catch (error) {
      setUploadStatus('idle');
      if (error instanceof ApiError && error.status === 409 && (error.details as { code?: string } | undefined)?.code === 'sticker_quota_exceeded') {
        setUploadError('Your sticker library is full. Remove a sticker from your library to add another; messages already sent keep their sticker.');
      } else if (error instanceof ApiError && [400, 413, 415, 422].includes(error.status)) {
        setUploadError('The image could not be accepted. Choose a valid PNG or JPEG under 2 MiB.');
      } else if (error instanceof ApiError && error.status === 401) {
        setUploadError('Your session has expired. Refresh your account session and check the library.');
      } else {
        setUploadStatus('uncertain');
        setUploadError('Upload outcome could not be confirmed. Refresh your library to check before trying again.');
      }
    }
  };

  const removeSticker = async () => {
    if (!removeTarget || removingId) return;
    const target = removeTarget;
    libraryAbortRef.current?.abort();
    setLibraryLoading(false);
    setRemovingId(target.id);
    setRemoveError(null);
    try {
      await fetchApi<void>(`/api/v1/auth/me/stickers/${encodeURIComponent(target.id)}`, { method: 'DELETE', body: '' }, 204);
      setLibrary(items => items.filter(item => item.id !== target.id));
      setRemoveTarget(null);
    } catch (error) {
      setRemoveError(error instanceof ApiError && error.status === 404 ? 'This library item is no longer available.' : 'Could not remove this sticker.');
    } finally { setRemovingId(null); }
  };

  return (
    <div className={styles.composer}>
      {pendingSubmission && (
        <div role="alert" className={styles.retryNotice}>
          <p className={styles.retryCopy}>
            <strong>{isSubmitting ? 'Retrying message…' : 'Message not confirmed.'}</strong>{' '}
            <span>{pendingSubmission.error || 'Check the connection and retry this message.'}</span>
          </p>
          <div className={styles.retryActions}>
            {onRetrySubmission && (
              <button
                type="button"
                disabled={isSubmitting || disabled} aria-busy={isSubmitting}
                onClick={() => void handleRetrySubmission(pendingSubmission)}
                className="ui-button ui-button--secondary"
              >
                {isSubmitting ? 'Retrying...' : 'Retry'}
              </button>
            )}
            {onDismissPending && (
              <button
                type="button"
                onClick={onDismissPending}
                className="ui-button ui-button--quiet"
                aria-label="Dismiss unresolved message retry"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`${styles.composerSurface} ${libraryOnly ? styles.libraryOnlySurface : ''}`}>
        {!libraryOnly && <>
        <label htmlFor="discussion-message-input" className="sr-only">
          Write a message
        </label>
        <textarea
          id="discussion-message-input"
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSubmitting}
          placeholder="Write a message to IRM…"
          aria-describedby="discussion-composer-hint"
          rows={1}
          className={styles.composerField}
        />
        <p id="discussion-composer-hint" className="sr-only">Enter starts a new line. Control or Command plus Enter sends. Shift plus Enter also starts a new line.</p>
        </>}

        <div className={styles.composerControlRow}>
          <div className={styles.composerControl} ref={stickerPickerRef}>
            <button
              ref={stickerButtonRef}
              type="button"
              disabled={(disabled && !libraryOnly) || isSubmitting}
              onClick={() => setIsStickerPickerOpen((prev) => !prev)}
              aria-expanded={isStickerPickerOpen}
              aria-controls={`${pickerId}-dialog`}
              aria-haspopup="dialog"
              aria-label="Choose a sticker"
              className={`${styles.composerIconButton} ui-button`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="3" strokeWidth="1.8" />
                <circle cx="8.5" cy="9" r="1.4" strokeWidth="1.6" />
                <path d="m5 17 4.5-4.5 3 3L16 12l4 5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Sticker Picker Popover */}
            {isStickerPickerOpen && (
              <div
                id={`${pickerId}-dialog`}
                role="dialog"
                aria-label="Sticker picker"
                className="ui-motion-disclosure absolute z-40 bottom-full mb-2 left-0 w-[min(22rem,calc(100vw-2rem))] max-h-[min(62dvh,30rem)] overflow-y-auto bg-surface border border-border rounded-2xl shadow-dropdown p-3"
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                    <span className="text-xs font-semibold text-text uppercase tracking-wider">Stickers</span>
                  <button
                    type="button"
                    onClick={() => { setIsStickerPickerOpen(false); stickerButtonRef.current?.focus(); }}
                    aria-label="Close sticker picker"
                    className="ui-button ui-button--secondary ui-icon-button"
                  >
                    ✕
                  </button>
                </div>
                <div role="tablist" aria-label="Sticker collections" className="flex gap-1 pb-2">
                  <button ref={node => { tabRefs.current['built-in'] = node; }} id={`${pickerId}-tab-built-in`} type="button" role="tab" aria-selected={pickerTab === 'built-in'} aria-controls={`${pickerId}-panel`} tabIndex={pickerTab === 'built-in' ? 0 : -1} onKeyDown={handlePickerTabKeyDown} onClick={() => setPickerTab('built-in')} className={`ui-button ${pickerTab === 'built-in' ? 'ui-button--secondary border-accent text-accent' : 'ui-button--quiet'}`}>Built-in</button>
                  <button ref={node => { tabRefs.current.mine = node; }} id={`${pickerId}-tab-mine`} type="button" role="tab" aria-selected={pickerTab === 'mine'} aria-controls={`${pickerId}-panel`} tabIndex={pickerTab === 'mine' ? 0 : -1} onKeyDown={handlePickerTabKeyDown} onClick={() => { setPickerTab('mine'); if (!libraryLoaded && !libraryLoading) void loadLibrary(); }} className={`ui-button ${pickerTab === 'mine' ? 'ui-button--secondary border-accent text-accent' : 'ui-button--quiet'}`}>My stickers</button>
                </div>

                {pickerTab === 'built-in' && catalogError ? (
                  <div id={`${pickerId}-panel`} role="tabpanel" aria-labelledby={`${pickerId}-tab-built-in`} className="p-4 text-center text-xs text-error space-y-2">
                    <p>{catalogError}</p>
                    {onRetryCatalog && (
                      <button
                        type="button"
                        onClick={onRetryCatalog}
                        className="ui-button ui-button--quiet"
                      >
                        Retry Loading Stickers
                      </button>
                    )}
                  </div>
                ) : pickerTab === 'built-in' && isLoadingStickers ? (
                  <div id={`${pickerId}-panel`} role="tabpanel" aria-labelledby={`${pickerId}-tab-built-in`} className="p-4 text-center text-xs text-text-muted">
                    Loading stickers...
                  </div>
                ) : pickerTab === 'built-in' ? (
                  <div id={`${pickerId}-panel`} role="tabpanel" aria-labelledby={`${pickerId}-tab-built-in`} className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto p-1">
                    {stickers.map((stk) => (
                      <button
                        key={stk.id}
                        type="button"
                        disabled={disabled || isSubmitting}
                        onClick={() => handleSelectSticker(stk.id)}
                        title={stk.description}
                        aria-label={`${stk.name} sticker: ${stk.description}`}
                        className="ui-button ui-button--quiet flex-col group"
                      >
                        <StickerAsset stickerId={stk.id} name={stk.name} size={64} />
                        <span className="text-[11px] font-medium text-text mt-1 truncate max-w-full group-hover:text-accent">
                          {stk.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div id={`${pickerId}-panel`} role="tabpanel" aria-labelledby={`${pickerId}-tab-mine`} className="space-y-3">
                    {uploadError && <p role="alert" className="text-xs text-error rounded-lg border border-error-border bg-error-surface p-2">{uploadError}</p>}
                    {uploadPreview && uploadFile ? (
                      <div className="rounded-xl border border-border bg-surface-secondary p-3 space-y-2">
                        <div className="flex items-center gap-3">
                          {/* Local preview is deliberately never submitted as a URL. */}
                          {/* Local file previews should remain local and bypass the Next image optimizer. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={uploadPreview} alt="Selected image preview" className="h-20 w-20 rounded-lg bg-surface object-contain" />
                          <p className="min-w-0 text-xs text-text-muted">PNG transparency is preserved. The full image is fitted into a sticker. Background removal is not included.</p>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={cancelUpload} disabled={uploadStatus === 'uploading'} className="ui-button ui-button--secondary">Cancel</button>
                          <button type="button" onClick={uploadSticker} disabled={uploadStatus === 'uploading' || uploadStatus === 'uncertain'} aria-busy={uploadStatus === 'uploading'} className="ui-button ui-button--primary">{uploadStatus === 'uploading' ? 'Uploading…' : 'Upload sticker'}</button>
                        </div>
                        {uploadStatus === 'uncertain' && <button type="button" onClick={() => { setUploadStatus('idle'); setLibraryLoaded(false); void loadLibrary(); }} className="ui-button ui-button--quiet">Refresh library</button>}
                      </div>
                    ) : (
                      <div>
                        <input ref={fileInputRef} className="sr-only" type="file" accept="image/png,image/jpeg" aria-label="Choose a PNG or JPEG sticker image" onChange={event => chooseUpload(event.currentTarget.files?.[0])} />
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="ui-button ui-button--secondary w-full">Add sticker</button>
                        <p className="mt-1 text-center text-[11px] text-text-muted">PNG or JPEG · up to 2 MiB</p>
                      </div>
                    )}

                    {libraryError && <div role="alert" className="text-xs text-error space-y-1"><p>{libraryError}</p><button type="button" onClick={() => { setLibraryLoaded(false); void loadLibrary(); }} className="ui-button ui-button--quiet">Retry</button></div>}
                    {libraryLoading && <p role="status" className="text-center text-xs text-text-muted">Loading your stickers…</p>}
                    {!libraryLoading && !libraryError && libraryLoaded && library.length === 0 && <p className="py-4 text-center text-xs text-text-muted">Your sticker library is empty. Add a PNG or JPEG to get started.</p>}
                    <div className="grid grid-cols-3 gap-2">
                      {library.map(item => (
                        <div key={item.id} className="min-w-0 rounded-lg border border-border bg-surface-secondary p-1.5">
                          <button type="button" onClick={() => void handleSelectCustomSticker(item.id)} disabled={disabled || isSubmitting} aria-label="Send this custom sticker" className="ui-button ui-button--quiet flex w-full min-w-0 flex-col gap-1 p-1">
                            <AuthenticatedStickerImage path={item.preview_url} accessKey={`${userId}:library:${item.id}`} label="Your sticker" size={84} />
                            <span className="text-[11px] text-text-muted">Send sticker</span>
                          </button>
                          <button type="button" onClick={() => setRemoveTarget(item)} aria-label="Remove sticker from library" className="ui-button ui-button--quiet min-h-11 w-full text-[11px]">Remove</button>
                        </div>
                      ))}
                    </div>
                    {nextCursor && <button type="button" disabled={libraryLoading} onClick={() => void loadLibrary(true)} className="ui-button ui-button--secondary w-full">{libraryLoading ? 'Loading…' : 'Load more'}</button>}
                    {removeTarget && <ConfirmationDialog
                      title="Remove sticker"
                      description="Remove this sticker from your library? Messages already sent will keep it."
                      context="This only removes the item from your private library."
                      pending={!!removingId}
                      error={removeError}
                      onCancel={() => { setRemoveTarget(null); setRemoveError(null); }}
                      onConfirm={() => void removeSticker()}
                      onCheck={() => { setRemoveTarget(null); setRemoveError(null); setLibraryLoaded(false); void loadLibrary(); }}
                    />}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={styles.composerActions}>
            {!libraryOnly && <span className={`${styles.composerCount} ${isOverLimit ? 'text-error font-semibold' : charCount > 1800 ? 'text-warning font-medium' : ''}`} aria-live="polite" aria-atomic="true">
              {charCount.toLocaleString()} / {MAX_CHARS} characters
            </span>}

            {!libraryOnly && <button
              type="button"
              disabled={!canSend} aria-busy={isSubmitting}
              onClick={handleSendText}
              aria-label={isSubmitting ? 'Sending message' : 'Send message'}
              title="Send message"
              className={`${styles.composerSend} ui-button`}
            >
              {isSubmitting ? <span aria-hidden="true">…</span> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M12 19V5m0 0L6.5 10.5M12 5l5.5 5.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>}
          </div>
        </div>
      </div>
      {libraryOnly && <p className={styles.libraryOnly}>Manage your private sticker library. Discussion sending is unavailable for this account.</p>}
      {!libraryOnly && <p className="sr-only">Enter adds a line. Use Control+Enter or Command+Enter to send.</p>}
    </div>
  );
}
