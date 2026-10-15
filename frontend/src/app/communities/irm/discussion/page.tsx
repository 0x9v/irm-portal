"use client";

import { PendingLabel } from "@/components/ui/Button";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import ModerationAction from "@/components/moderation/ModerationAction";
import { RemovalLedger } from "@/lib/moderation";
import { useAsyncScope } from "@/lib/useAsyncScope";
import PageContainer from "@/components/PageContainer";
import FeedbackMessage from "@/components/FeedbackMessage";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import { fetchApi, ApiError } from "@/lib/api";
import {
  DiscussionMessage,
  DiscussionHistoryResponse,
  DiscussionReactionSummaryResponse,
  DiscussionConnectionState,
  PendingSubmission,
  StickerItem,
} from "@/types/discussion";
import {
  getDiscussionWebSocketUrl,
  compareDiscussionMessages,
  normalizeDiscussionMessage,
  normalizeDiscussionMessages,
} from "@/lib/discussion";
import { DiscussionMessageItem } from "@/components/discussion/DiscussionMessageItem";
import { DiscussionComposer } from "@/components/discussion/DiscussionComposer";
import styles from "@/components/discussion/Discussion.module.css";
import { IconDiscussion } from "@/components/navigation/NavIcons";

function messageDayKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function messageDayLabel(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" }).format(date);
}

function isSameAuthorGroup(first: DiscussionMessage | undefined, second: DiscussionMessage | undefined): boolean {
  if (!first?.author_id || !second?.author_id || first.author_id !== second.author_id) return false;
  const elapsed = new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 5 * 60 * 1000 && messageDayKey(first.created_at) === messageDayKey(second.created_at);
}

export default function DiscussionPage() {
  const { user, membership, isLoading: authLoading, error: authError, membershipError, refresh } = useAuth();
  const authenticatedUserId = user?.id ?? null;

  const isActiveMember =
    !authLoading &&
    user !== null &&
    membership?.status === "ACTIVE" &&
    !membershipError && !authError;

  const captureScope = useAsyncScope(`${user?.id}:irm:${isActiveMember}`);
  const [removed] = useState(() => new RemovalLedger());

  // Discussion state
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [messagesUserId, setMessagesUserId] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Sticker catalog state
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [isLoadingStickers, setIsLoadingStickers] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Pagination state
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  // Connection state
  const [connectionState, setConnectionState] = useState<DiscussionConnectionState>("connecting");
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);

  // Pending submission / retry state
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [pendingSubmissionUserId, setPendingSubmissionUserId] = useState<string | null>(null);
  const [reactingMessageIds, setReactingMessageIds] = useState<Set<string>>(new Set());

  // Unread / autoscroll state
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);

  // Refs for tracking async lifecycles and scroll geometry
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const scrollAdjustRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stableConnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
  const olderAbortRef = useRef<AbortController | null>(null);
  const stickersAbortRef = useRef<AbortController | null>(null);
  const connectWebSocketRef = useRef<() => void>(() => {});
  const isManuallyDisconnectedRef = useRef(false);

  // Mobile keyboards can shrink the visual viewport without changing CSS dvh.
  // Keep this adjustment on the Discussion shell and remove it on navigation.
  useEffect(() => {
    if (!isActiveMember || typeof document === "undefined" || !window.visualViewport) return;
    const shell = document.querySelector<HTMLElement>("[data-application-shell]:has([data-discussion-page])");
    if (!shell) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const active = document.activeElement;
      const editing = active instanceof HTMLElement &&
        active.closest("[data-discussion-page]") &&
        active.matches('input, textarea, select, [contenteditable="true"]');
      if (editing) shell.style.setProperty("--discussion-viewport-height", `${Math.ceil(viewport.height + viewport.offsetTop)}px`);
      else shell.style.removeProperty("--discussion-viewport-height");
    };
    const afterBlur = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", afterBlur);
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", afterBlur);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      shell.style.removeProperty("--discussion-viewport-height");
    };
  }, [isActiveMember]);

  const removeMessage = useCallback((id: string, unavailable = false) => {
    const container = scrollContainerRef.current;
    const item = Array.from(container?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])
      .find(node => node.dataset.messageId === id);
    // When a message above the reading position disappears, retain the same
    // visible content. Removals in/below the viewport leave scrollTop alone.
    if (!scrollAdjustRef.current && container && item && item.getBoundingClientRect().bottom <= container.getBoundingClientRect().top) {
      scrollAdjustRef.current = { scrollHeight: container.scrollHeight, scrollTop: container.scrollTop };
    }
    removed.remove(id);
    setMessages(prev => removed.filter(prev));
    setReactingMessageIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    if (removed.saturated) setConnectionNotice("This view needs a refresh to keep removed messages hidden. Reload the page to check the latest discussion.");
    else if (unavailable) setConnectionNotice("The message is unavailable and has been removed from this view.");
  }, [removed]);

  // ---------------------------------------------------------------------------
  // 1. Account change / logout cleanup
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const currentUserId = user?.id || null;
    if (activeUserIdRef.current && activeUserIdRef.current !== currentUserId) {
      // User changed or logged out: tear down connection and clear sensitive state
      if (wsRef.current) {
        const previousSocket = wsRef.current;
        wsRef.current = null;
        previousSocket.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (stableConnectTimerRef.current) {
        clearTimeout(stableConnectTimerRef.current);
        stableConnectTimerRef.current = null;
      }
      historyAbortRef.current?.abort();
      olderAbortRef.current?.abort();
      stickersAbortRef.current?.abort();

      setMessages([]);
      setMessagesUserId(null);
      setOlderCursor(null);
      setHasMoreOlder(false);
      setPendingSubmission(null);
      setPendingSubmissionUserId(null);
      setReactingMessageIds(new Set());
      setHasUnreadBelow(false);
      setHistoryError(null);
      setOlderError(null);
      setIsLoadingHistory(true);
      setConnectionState("offline");
      setConnectionNotice(null);
      setStickers([]);
      setCatalogError(null);
      isNearBottomRef.current = true;
    }
    activeUserIdRef.current = currentUserId;
  }, [user]);

  useEffect(() => {
    if (!isActiveMember) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]); setOlderCursor(null); setHasMoreOlder(false);
      setMessagesUserId(null);
      setPendingSubmission(null); setReactingMessageIds(new Set());
      setPendingSubmissionUserId(null);
      setStickers([]); setHasUnreadBelow(false);
    }
    return () => { removed.clear(); };
  }, [user?.id, isActiveMember, removed]);

  // ---------------------------------------------------------------------------
  // 2. Scroll position management
  // ---------------------------------------------------------------------------
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceToBottom < 80;
    isNearBottomRef.current = nearBottom;
    if (nearBottom && hasUnreadBelow) {
      setHasUnreadBelow(false);
    }
  }, [hasUnreadBelow]);

  const scrollToBottom = useCallback((smooth = true) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto",
    });
    isNearBottomRef.current = true;
    setHasUnreadBelow(false);
  }, []);

  // Restore scroll offset after prepending older messages
  useLayoutEffect(() => {
    if (scrollAdjustRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const { scrollHeight: prevHeight, scrollTop: prevTop } = scrollAdjustRef.current;
      container.scrollTop = container.scrollHeight - prevHeight + prevTop;
      scrollAdjustRef.current = null;
    }
  }, [messages]);

  // ---------------------------------------------------------------------------
  // 3. Load authoritative history snapshot
  // ---------------------------------------------------------------------------
  const loadLatestHistory = useCallback(async (isRefresh = false) => {
    const isCurrent = captureScope();
    if (!isActiveMember) return;

    // Abort both in-flight history snapshot and older pagination requests to prevent mixing incompatible state
    historyAbortRef.current?.abort();
    olderAbortRef.current?.abort();
    setIsLoadingOlder(false);
    setOlderError(null);

    const controller = new AbortController();
    historyAbortRef.current = controller;

    if (!isRefresh) {
      setIsLoadingHistory(true);
    }
    setHistoryError(null);

    try {
      const data = await fetchApi<DiscussionHistoryResponse>(
        "/api/v1/communities/irm/discussion/messages?limit=30",
        { signal: controller.signal }
      );

      if (!isCurrent() || controller.signal.aborted) return;
      const historyItems = normalizeDiscussionMessages(data.items);
      setMessagesUserId(authenticatedUserId);
      setMessages((prev) => {
        const map = new Map<string, DiscussionMessage>();
        // Add all authoritative items from the server snapshot
        removed.filter(historyItems).forEach((m) => map.set(m.id, m));

        // Preserve any messages in prev that are newer than the snapshot window
        // (e.g. live WebSocket messages or confirmed sends that arrived while this request was in flight)
        if (historyItems.length > 0) {
          const newestSnapshot = historyItems[historyItems.length - 1];
          prev.forEach((m) => {
            if (compareDiscussionMessages(m, newestSnapshot) > 0) {
              if (!map.has(m.id)) {
                map.set(m.id, m);
              }
            }
          });
        } else {
          // If server snapshot is empty, preserve all live messages received in flight
          prev.forEach((m) => {
            if (!map.has(m.id)) {
              map.set(m.id, m);
            }
          });
        }

        return removed.filter(Array.from(map.values())).sort(compareDiscussionMessages);
      });

      setOlderCursor(data.older_cursor);
      setHasMoreOlder(data.has_more_older);

      if (!isRefresh) {
        // Initial load: scroll to latest messages immediately
        setTimeout(() => scrollToBottom(false), 50);
      }
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) void refresh();
      if (err instanceof Error && err.name === "AbortError") return;
      setHistoryError(err instanceof Error ? err.message : "Failed to load discussion history.");
    } finally {
      if (isCurrent() && !controller.signal.aborted) setIsLoadingHistory(false);
    }
  }, [isActiveMember, scrollToBottom, captureScope, removed, refresh, authenticatedUserId]);

  // ---------------------------------------------------------------------------
  // 4. Load older messages (pagination)
  // ---------------------------------------------------------------------------
  const loadOlderMessages = useCallback(async () => {
    const isCurrent = captureScope();
    if (!olderCursor || isLoadingOlder || isLoadingHistory || !isActiveMember) return;

    const container = scrollContainerRef.current;
    if (container) {
      scrollAdjustRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }

    olderAbortRef.current?.abort();
    const controller = new AbortController();
    olderAbortRef.current = controller;

    setIsLoadingOlder(true);
    setOlderError(null);

    try {
      const data = await fetchApi<DiscussionHistoryResponse>(
        `/api/v1/communities/irm/discussion/messages?limit=30&before=${encodeURIComponent(olderCursor)}`,
        { signal: controller.signal }
      );

      if (!isCurrent() || controller.signal.aborted) return;
      const historyItems = normalizeDiscussionMessages(data.items);
      setMessagesUserId(authenticatedUserId);
      setMessages((prev) => {
        const map = new Map<string, DiscussionMessage>();
        removed.filter(historyItems).forEach((m) => map.set(m.id, m));
        prev.forEach((m) => map.set(m.id, m));
        return removed.filter(Array.from(map.values())).sort(compareDiscussionMessages);
      });

      setOlderCursor(data.older_cursor);
      setHasMoreOlder(data.has_more_older);
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) void refresh();
      if (err instanceof Error && err.name === "AbortError") return;
      setOlderError(err instanceof Error ? err.message : "Failed to load older messages.");
      scrollAdjustRef.current = null; // Don't adjust scroll if request failed
    } finally {
      if (isCurrent() && !controller.signal.aborted) setIsLoadingOlder(false);
    }
  }, [olderCursor, isLoadingOlder, isLoadingHistory, isActiveMember, captureScope, removed, refresh, authenticatedUserId]);

  // ---------------------------------------------------------------------------
  // 4b. Load sticker catalog
  // ---------------------------------------------------------------------------
  const loadStickerCatalog = useCallback(async () => {
    const isCurrent = captureScope();
    if (!isActiveMember) return;

    stickersAbortRef.current?.abort();
    const controller = new AbortController();
    stickersAbortRef.current = controller;

    setIsLoadingStickers(true);
    setCatalogError(null);

    try {
      const data = await fetchApi<StickerItem[]>(
        "/api/v1/communities/irm/discussion/stickers",
        { signal: controller.signal }
      );
      if (!isCurrent() || controller.signal.aborted) return;
      setStickers(data);
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) void refresh();
      if (err instanceof Error && err.name === "AbortError") return;
      setCatalogError(err instanceof Error ? err.message : "Failed to load stickers.");
    } finally {
      if (isCurrent() && !controller.signal.aborted) setIsLoadingStickers(false);
    }
  }, [isActiveMember, captureScope, refresh]);

  // ---------------------------------------------------------------------------
  // 5. WebSocket connection with exponential backoff & access revalidation
  // ---------------------------------------------------------------------------
  const connectWebSocket = useCallback(() => {
    if (!isActiveMember) return;
    const isCurrent = captureScope();

    if (wsRef.current) {
      const previousSocket = wsRef.current;
      wsRef.current = null;
      previousSocket.close();
    }

    setConnectionState((prev) => (prev === "offline" ? "reconnecting" : "connecting"));

    const wsUrl = getDiscussionWebSocketUrl("irm");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setConnectionState("offline");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isCurrent() || wsRef.current !== ws) return;
      setConnectionState("connected");
      setConnectionNotice(null);
      if (stableConnectTimerRef.current) {
        clearTimeout(stableConnectTimerRef.current);
      }
      stableConnectTimerRef.current = setTimeout(() => {
        reconnectAttemptsRef.current = 0;
      }, 3000);
    };

    ws.onmessage = (event) => {
      if (!isCurrent() || wsRef.current !== ws) return;
      try {
        const data = JSON.parse(event.data);

        if (data.community_slug !== undefined && data.community_slug !== "irm") return;
        if (data.type === "message_removed") {
          if (data.community_slug === "irm" && typeof data.message_id === "string") removeMessage(data.message_id);
          return;
        }
        if (data.type === "message_created" && data.message) {
          const newMsg = normalizeDiscussionMessage(data.message);
          if (!newMsg || !removed.allows(newMsg.id)) return;

          setMessagesUserId(authenticatedUserId);
          setMessages((prev) => {
            // Deduplicate if already present (e.g. from local optimistic REST response)
            if (!removed.allows(newMsg.id) || prev.some((m) => m.id === newMsg.id)) {
              return prev;
            }
            const updated = [...prev, newMsg].sort(compareDiscussionMessages);
            return updated;
          });

          // Autoscroll if near bottom, otherwise indicate new unread messages
          if (isNearBottomRef.current) {
            setTimeout(() => scrollToBottom(true), 50);
          } else {
            setHasUnreadBelow(true);
          }
        } else if (data.type === "reaction_changed") {
          const { message_id, reactions } = data;
          if (!removed.allows(message_id)) return;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === message_id) {
                // Update aggregate counts only; preserve caller_reaction
                return { ...m, reactions: reactions || [] };
              }
              return m;
            })
          );
        } else if (data.type === "resync_required") {
          // Server signaled resync (e.g. queue overflow recovery)
          loadLatestHistory(true);
        }
      } catch {
        // Resiliently ignore unparseable or unknown messages
      }
    };

    ws.onclose = async (event) => {
      if (!isCurrent() || wsRef.current !== ws) return;
      wsRef.current = null;
      if (stableConnectTimerRef.current) {
        clearTimeout(stableConnectTimerRef.current);
        stableConnectTimerRef.current = null;
      }

      const closeUserId = activeUserIdRef.current;
      if (isManuallyDisconnectedRef.current) {
        setConnectionState("offline");
        return;
      }

      // Close 1008: Policy violation (e.g. queue overflow OR session expired/revoked)
      if (event.code === 1008) {
        setConnectionState("offline");
        setConnectionNotice("Session expired or membership revoked. Re-verifying access...");
        const authResult = await refresh();

        // If user changed during revalidation, do not proceed with old user's reconnect
        if (!isCurrent() || activeUserIdRef.current !== closeUserId || authResult.user?.id !== closeUserId) {
          return;
        }

        if (authResult?.isActiveMember) {
          // User remains eligible! (e.g. 1008 was caused by transient queue overflow)
          setConnectionNotice(null);
          setConnectionState("reconnecting");
          const attempts = reconnectAttemptsRef.current;
          const baseDelay = Math.min(15000, 1000 * Math.pow(1.5, attempts));
          const delay = Math.max(1000, Math.round(baseDelay));
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            loadLatestHistory(true);
            connectWebSocketRef.current();
          }, delay);
        } else {
          // Ineligible or verification failed: stop retries and stay offline
          setConnectionState("offline");
          if (authResult?.membershipError) {
            setConnectionNotice(`Membership verification failed: ${authResult.membershipError}`);
          } else {
            // Observed explicit access loss (e.g. logged out or membership revoked):
            // Clear protected messages, cursors, and drafts
            setMessages([]);
            setOlderCursor(null);
            setHasMoreOlder(false);
            setPendingSubmission(null);
            setPendingSubmissionUserId(null);
          }
        }
        return;
      }

      setConnectionState("reconnecting");

      // Capped exponential backoff with jitter
      const attempts = reconnectAttemptsRef.current;
      const baseDelay = Math.min(15000, 1000 * Math.pow(1.5, attempts));
      const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
      const delay = Math.max(500, Math.round(baseDelay + jitter));
      reconnectAttemptsRef.current += 1;

      reconnectTimeoutRef.current = setTimeout(() => {
        // On reconnect, refresh recent discussion window to recover missed events
        loadLatestHistory(true);
        connectWebSocketRef.current();
      }, delay);
    };

    ws.onerror = () => {
      // Handled by onclose
    };
  }, [isActiveMember, loadLatestHistory, refresh, scrollToBottom, captureScope, removed, removeMessage, authenticatedUserId]);

  // Keep ref up to date for reconnect callbacks
  useEffect(() => {
    connectWebSocketRef.current = connectWebSocket;
  }, [connectWebSocket]);

  // Connect WebSocket, load history & stickers on mount / eligibility
  useEffect(() => {
    if (isActiveMember) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadLatestHistory(false);
      loadStickerCatalog();
      connectWebSocket();
    }

    return () => {
      if (wsRef.current) {
        const previousSocket = wsRef.current;
        wsRef.current = null;
        previousSocket.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (stableConnectTimerRef.current) {
        clearTimeout(stableConnectTimerRef.current);
        stableConnectTimerRef.current = null;
      }
      historyAbortRef.current?.abort();
      olderAbortRef.current?.abort();
      stickersAbortRef.current?.abort();
    };
  }, [isActiveMember, loadLatestHistory, loadStickerCatalog, connectWebSocket]);

  // Online event listener for network recovery
  useEffect(() => {
    const handleOnline = () => {
      if (isActiveMember && !isManuallyDisconnectedRef.current) {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        loadLatestHistory(true);
        connectWebSocket();
      }
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [connectWebSocket, isActiveMember, loadLatestHistory]);

  // Lifecycle helpers for controlled disconnect/reconnect in tests
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __discussionTest?: object }).__discussionTest = {
        disconnect: () => {
          isManuallyDisconnectedRef.current = true;
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
          }
          setConnectionState("offline");
        },
        reconnect: () => {
          isManuallyDisconnectedRef.current = false;
          reconnectAttemptsRef.current = 0;
          loadLatestHistory(true);
          connectWebSocket();
        },
      };
    }
    return () => {
      if (typeof window !== "undefined") {
        delete (window as unknown as { __discussionTest?: object }).__discussionTest;
      }
    };
  }, [connectWebSocket, loadLatestHistory]);

  // ---------------------------------------------------------------------------
  // 6. Message creation & idempotent retry
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(
    async (kind: "TEXT" | "STICKER" | "CUSTOM_STICKER", content: string | null, stickerId: string | null, customStickerId: string | null = null, clientMsgId?: string) => {
      if (!isActiveMember) return false;
      const isCurrent = captureScope();
      const submissionUserId = authenticatedUserId;
      const submissionId = clientMsgId || crypto.randomUUID();

      const payload = kind === "CUSTOM_STICKER"
        ? { client_message_id: submissionId, kind, custom_sticker_id: customStickerId }
        : {
            client_message_id: submissionId,
            kind,
            content: kind === "TEXT" ? content : null,
            sticker_id: kind === "STICKER" ? stickerId : null,
          };

      try {
        const response = await fetchApi<DiscussionMessage>(
          "/api/v1/communities/irm/discussion/messages",
          {
            method: "POST",
            body: JSON.stringify(payload),
          }
        );

        // Account changed while submission was in flight: ignore response
        if (!isCurrent() || activeUserIdRef.current !== submissionUserId) {
          return false;
        }

        const confirmedMessage = normalizeDiscussionMessage(response);
        if (!confirmedMessage) {
          loadLatestHistory(true);
          setPendingSubmission(null);
          setPendingSubmissionUserId(null);
          return true;
        }

        // Success (201 Created or 200 Replay): merge into message list
        setMessages((prev) => {
          if (!removed.allows(confirmedMessage.id) || prev.some((m) => m.id === confirmedMessage.id)) {
            return prev;
          }
          return [...prev, confirmedMessage].sort(compareDiscussionMessages);
        });
        setMessagesUserId(submissionUserId);

        setPendingSubmission(null);
        setPendingSubmissionUserId(null);
        if (isNearBottomRef.current) setTimeout(() => scrollToBottom(true), 50);
        else setHasUnreadBelow(true);
        return true;
      } catch (err) {
        // Account changed while submission was in flight: do not set retry card for different account
        if (!isCurrent() || activeUserIdRef.current !== submissionUserId) {
          return false;
        }

        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          void refresh();
          return false;
        }
        const errorMessage = err instanceof ApiError ? err.message : "Failed to send message.";
        // Save pending submission with the same submissionId for safe idempotent retry
        setPendingSubmission({
          client_message_id: submissionId,
          kind,
          content,
          sticker_id: stickerId,
          custom_sticker_id: customStickerId,
          error: errorMessage,
        });
        setPendingSubmissionUserId(submissionUserId);
        return false;
      }
    },
    [scrollToBottom, authenticatedUserId, captureScope, removed, isActiveMember, refresh, loadLatestHistory]
  );

  const handleSendText = useCallback(
    async (text: string) => sendMessage("TEXT", text, null),
    [sendMessage]
  );

  const handleSendSticker = useCallback(
    async (stickerId: string) => sendMessage("STICKER", null, stickerId),
    [sendMessage]
  );

  const handleSendCustomSticker = useCallback(
    async (assetId: string) => sendMessage("CUSTOM_STICKER", null, null, assetId),
    [sendMessage]
  );

  const handleRetrySubmission = useCallback(
    async (pending: PendingSubmission) =>
      sendMessage(pending.kind, pending.content, pending.sticker_id, pending.custom_sticker_id, pending.client_message_id),
    [sendMessage]
  );

  const handleDismissPending = useCallback(() => {
    setPendingSubmission(null);
    setPendingSubmissionUserId(null);
  }, []);

  const visibleMessages = isActiveMember && messagesUserId === authenticatedUserId ? messages : [];
  const visiblePendingSubmission = isActiveMember && pendingSubmissionUserId === authenticatedUserId
    ? pendingSubmission
    : null;

  // ---------------------------------------------------------------------------
  // 7. Reaction toggle (single reaction per message)
  // ---------------------------------------------------------------------------
  const handleReactionToggle = useCallback(
    async (messageId: string, emoji: string) => {
      if (!isActiveMember || !removed.allows(messageId) || reactingMessageIds.has(messageId)) return;
      const isCurrent = captureScope();

      const reactionUserId = user?.id || null;
      const targetMsg = messages.find((m) => m.id === messageId);
      if (!targetMsg) return;

      setReactingMessageIds((prev) => new Set(prev).add(messageId));

      const isCurrentReaction = targetMsg.caller_reaction === emoji;
      const method = isCurrentReaction ? "DELETE" : "PUT";
      const body = isCurrentReaction ? undefined : JSON.stringify({ emoji });

      try {
        const res = await fetchApi<DiscussionReactionSummaryResponse>(
          `/api/v1/communities/irm/discussion/messages/${messageId}/reaction`,
          {
            method,
            body,
          }
        );

        if (!isCurrent() || !removed.allows(messageId) || activeUserIdRef.current !== reactionUserId) return;

        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === messageId) {
              return {
                ...m,
                reactions: res.reactions,
                caller_reaction: res.caller_reaction,
              };
            }
            return m;
          })
        );
      } catch (err) {
        if (!isCurrent() || !removed.allows(messageId)) return;
        if (err instanceof ApiError && err.status === 404) removeMessage(messageId, true);
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) void refresh();
        // Silently preserve previous reaction state on network failure
        console.error("Failed to update reaction:", err);
      } finally {
        if (isCurrent() && removed.allows(messageId) && activeUserIdRef.current === reactionUserId) {
          setReactingMessageIds((prev) => {
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
        }
      }
    },
    [messages, reactingMessageIds, user?.id, captureScope, removed, isActiveMember, removeMessage, refresh]
  );

  // ---------------------------------------------------------------------------
  // 8. Render Access-Control Screens
  // ---------------------------------------------------------------------------
  if (authLoading) {
    return (
      <PageContainer>
        <div className="py-16 text-center text-text-subtle text-sm" role="status">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading discussion...
        </div>
      </PageContainer>
    );
  }

  if (!user) {
    return (
      <PageContainer>
        <AccessDeniedGuidance isGuest={true} returnHref="/" returnLabel="Home" />
      </PageContainer>
    );
  }

  if (membershipError || authError) {
    return (
      <PageContainer>
        <div className="my-6">
          <FeedbackMessage
            type="error"
            message={`Membership could not be verified: ${membershipError || authError}`}
            onRetry={refresh}
            retryLabel="Retry Verification"
          />
        </div>
        {!authError && user && <DiscussionComposer key={user.id} userId={user.id} libraryOnly disabled onSendText={async () => false} onSendSticker={async () => false} onSendCustomSticker={async () => false} />}
      </PageContainer>
    );
  }

  if (membership?.status !== "ACTIVE") {
    return (
      <PageContainer>
        <AccessDeniedGuidance
          membershipStatus={membership?.status}
          returnHref="/"
          returnLabel="Home"
        />
        <DiscussionComposer key={user.id} userId={user.id} libraryOnly disabled onSendText={async () => false} onSendSticker={async () => false} onSendCustomSticker={async () => false} />
      </PageContainer>
    );
  }

  // ---------------------------------------------------------------------------
  // 9. Main Discussion Interface
  // ---------------------------------------------------------------------------
  return (
    <main data-discussion-page className={styles.page}>
      <div className={styles.conversation}>
        <div className={styles.conversationHeader}>
          <div className={styles.communityIdentity}>
            <span className={styles.communityAvatar} aria-hidden="true"><IconDiscussion /></span>
            <div className={styles.headerTitle}>
              <h1>IRM Discussion</h1>
              <p>Community conversation</p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <span role="status" aria-label="Discussion connection" className={connectionState === "connected" ? "sr-only" : styles.connectionState}>
              {connectionState === "connected" ? "Connected to discussion" : connectionState === "connecting" ? "Connecting…" : connectionState === "reconnecting" ? "Reconnecting…" : "Connection lost"}
            </span>
            {connectionNotice && <>
              <span role="status" title={connectionNotice} className={styles.connectionNotice}>{connectionNotice}</span>
              <button type="button" aria-label="Dismiss connection notice" title="Dismiss notice" onClick={() => setConnectionNotice(null)} className="ui-button ui-button--quiet ui-icon-button">×</button>
            </>}

            <button
              type="button"
              onClick={() => {
                loadLatestHistory(true);
                if (connectionState === "offline") {
                  connectWebSocket();
                }
              }}
              title={connectionState === "offline" ? "Retry connection and refresh history" : "Refresh discussion history"}
              aria-label={connectionState === "offline" ? "Retry connection and refresh history" : "Refresh discussion history"}
              className="ui-button ui-button--secondary ui-icon-button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex flex-col flex-1 min-h-0">
          {/* Messages Scroll Area */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            role="log"
            aria-live="off"
            aria-relevant="additions"
            aria-label="Discussion message history"
            className={styles.history}
          >
            {/* Load Older Messages Control */}
            {isActiveMember && messagesUserId === authenticatedUserId && hasMoreOlder ? (
              <div className={styles.historyControl}>
                <button
                  type="button"
                  disabled={isLoadingOlder} aria-busy={isLoadingOlder}
                  onClick={loadOlderMessages}
                  className="ui-button ui-button--secondary"
                >
                  <PendingLabel pending={!!(isLoadingOlder)} idle="Load older messages" busy="Loading older messages..." />
                </button>
              </div>
            ) : visibleMessages.length > 0 ? (
              <div className={styles.historyBeginning}>
                Beginning of IRM discussion history
              </div>
            ) : null}

            {/* Pagination Error */}
            {olderError && (
              <div className="my-2">
                <FeedbackMessage
                  type="error"
                  message={olderError}
                  onRetry={loadOlderMessages}
                  retryLabel="Retry"
                />
              </div>
            )}

            {/* Initial History Loading Spinner */}
            {isLoadingHistory && visibleMessages.length === 0 && (
              <div className={styles.historyState} role="status">
                <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                Loading IRM messages…
              </div>
            )}

            {/* History Load Error */}
            {historyError && visibleMessages.length === 0 && (
              <div className={styles.historyState}>
                <FeedbackMessage
                  type="error"
                  message={historyError}
                  onRetry={() => loadLatestHistory(false)}
                  retryLabel="Retry Loading"
                />
              </div>
            )}

            {/* Empty State */}
            {!isLoadingHistory && !historyError && visibleMessages.length === 0 && (
              <div className={styles.historyState}>
                <span className="text-3xl" aria-hidden="true">💬</span>
                <p className="text-sm font-medium text-text">No messages yet in IRM Discussion.</p>
                <p className="text-xs text-text-muted">Be the first community member to say hello!</p>
              </div>
            )}

            {/* Message List */}
            {visibleMessages.map((message, index) => {
              const previous = visibleMessages[index - 1];
              const next = visibleMessages[index + 1];
              const isOwn = message.author_id === user.id;
              const groupedFromPrevious = isSameAuthorGroup(previous, message);
              const groupedToNext = isSameAuthorGroup(message, next);
              const showDate = !previous || messageDayKey(previous.created_at) !== messageDayKey(message.created_at);
              const ownerState = !message.author_id ? "unclassified" : isOwn ? "current" : "other";
              return (
                <DiscussionMessageItem
                  key={message.id}
                  message={message}
                  isOwn={isOwn}
                  ownerState={ownerState}
                  showAuthor={!isOwn && !groupedFromPrevious}
                  groupedFromPrevious={groupedFromPrevious}
                  groupEnd={!groupedToNext}
                  dateLabel={showDate ? messageDayLabel(message.created_at) : null}
                  onReactionToggle={handleReactionToggle}
                  isReacting={reactingMessageIds.has(message.id)}
                  accountId={user.id}
                  moderation={<ModerationAction kind="message" id={message.id} presentation="message-menu" context={`message by @${message.author_username} · ${new Date(message.created_at).toLocaleString()}`}
                    onRemoved={unavailable => removeMessage(message.id, unavailable)} onCheck={() => loadLatestHistory(true)} />}
                />
              );
            })}

            {hasUnreadBelow && (
              <div className={styles.newMessages}>
                <button type="button" onClick={() => scrollToBottom(true)} className="ui-button ui-button--secondary">
                  New messages <span aria-hidden="true">↓</span>
                </button>
              </div>
            )}
          </div>

          {/* Composer */}
          <DiscussionComposer key={user.id}
            userId={user.id}
            onSendText={handleSendText}
            onSendSticker={handleSendSticker}
            onSendCustomSticker={handleSendCustomSticker}
            onRetrySubmission={handleRetrySubmission}
            onDismissPending={handleDismissPending}
            pendingSubmission={visiblePendingSubmission}
            stickers={stickers}
            catalogError={catalogError}
            onRetryCatalog={loadStickerCatalog}
            isLoadingStickers={isLoadingStickers}
            disabled={!isActiveMember || removed.saturated}
          />
        </div>
      </div>
    </main>
  );
}
