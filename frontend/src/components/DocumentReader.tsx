"use client";

import { PendingLabel } from "@/components/ui/Button";

import "pdfjs-dist/web/pdf_viewer.css";

import { useEffect, useRef, useState, useCallback } from "react";
import type * as PDFJS from "pdfjs-dist";
import { API_URL } from "@/lib/api";
import FeedbackMessage from "@/components/FeedbackMessage";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface DocumentReaderProps {
  documentId: string;
  documentTitle: string;
  approved: boolean;
  onDownload: () => void;
  downloading?: boolean;
}

type ReaderStatus =
  | "PROBING"
  | "LOADING_FILE"
  | "RENDERING"
  | "READY"
  | "ERROR";

type ErrorType =
  | "AUTH_REQUIRED"
  | "NOT_FOUND"
  | "UNSUPPORTED_FORMAT"
  | "PARSE_ERROR"
  | "NETWORK_ERROR";

export default function DocumentReader({
  documentId,
  documentTitle,
  approved,
  onDownload,
  downloading = false,
}: DocumentReaderProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<ReaderStatus>("PROBING");
  const [errorType, setErrorType] = useState<ErrorType | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [format, setFormat] = useState<"pdf" | "image" | null>(null);

  // PDF Viewer State
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [fitWidthMode, setFitWidthMode] = useState(true);
  const [fitWidthScale, setFitWidthScale] = useState<number | null>(null);
  const [readerWidth, setReaderWidth] = useState<number | null>(null);
  const [isRenderingPage, setIsRenderingPage] = useState<boolean>(false);
  const [readingMessage, setReadingMessage] = useState<string | null>(null);
  const [positionReady, setPositionReady] = useState(false);

  // Image Viewer State
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState<number>(1.0);

  // DOM Refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  // Lifecycle & Cancellation Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadingTaskRef = useRef<PDFJS.PDFDocumentLoadingTask | null>(null);
  const pdfDocRef = useRef<PDFJS.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<PDFJS.RenderTask | null>(null);
  const currentDocIdRef = useRef<string>(documentId);
  const activeImageUrlRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<number>(0);
  const activeRenderIdRef = useRef<number>(0);
  const activeTextLayerRef = useRef<PDFJS.TextLayer | null>(null);
  const openedVisitsRef = useRef<Set<string>>(new Set());
  const readingRequestRef = useRef<AbortController | null>(null);
  const positionRequestRef = useRef<AbortController | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desiredPageRef = useRef(1);
  const savedPageRef = useRef<number | null>(null);
  const positionReadyRef = useRef(false);
  const positionBusyRef = useRef(false);
  const userNavigatedRef = useRef(false);
  const accountRef = useRef(user?.id ?? null);
  const lastPdfRenderInputsRef = useRef<{
    page: number | null;
    scale: number | null;
    fitWidth: boolean | null;
    width: number | null;
  }>({ page: null, scale: null, fitWidth: null, width: null });

  useEffect(() => {
    accountRef.current = user?.id ?? null;
  }, [user?.id]);

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 2.5;
  const SCALE_STEP = 0.25;
  const MAX_CANVAS_DIM = 4096; // Guard against browser canvas OOM / crashes

  const measureReaderWidth = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 0;
    const styles = window.getComputedStyle(container);
    // clientWidth already excludes borders and a classic vertical scrollbar. Remove
    // the horizontal padding to get the actual space available to the PDF page.
    return Math.max(
      0,
      container.clientWidth -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight),
    );
  }, []);

  useEffect(() => {
    // The viewer ref is mounted only in READY; attach the observer then.
    if (format !== "pdf" || status !== "READY") return;
    const container = containerRef.current;
    if (!container) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = measureReaderWidth();
        setReaderWidth((previous) => previous === width ? previous : width);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [format, status, measureReaderWidth]);

  const viewUrl = `${API_URL}/api/v1/documents/${documentId}/view`;

  // Clear canvas pixels and text layer overlay content
  const clearCanvasAndText = useCallback(() => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = "";
      textLayerRef.current.style.removeProperty("--scale-factor");
    }
  }, []);

  // Cleanup all pending tasks, documents, and object URLs
  const cleanupResources = useCallback(() => {
    readingRequestRef.current?.abort();
    readingRequestRef.current = null;
    positionRequestRef.current?.abort();
    positionRequestRef.current = null;
    if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
    positionTimerRef.current = null;
    positionReadyRef.current = false;
    setPositionReady(false);
    positionBusyRef.current = false;
    savedPageRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (activeTextLayerRef.current) {
      try {
        activeTextLayerRef.current.cancel();
      } catch {
        // ignore cancellation errors
      }
      activeTextLayerRef.current = null;
    }
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    if (loadingTaskRef.current) {
      loadingTaskRef.current.destroy();
      loadingTaskRef.current = null;
    }
    if (pdfDocRef.current) {
      pdfDocRef.current.destroy();
      pdfDocRef.current = null;
    }
    if (activeImageUrlRef.current) {
      URL.revokeObjectURL(activeImageUrlRef.current);
      activeImageUrlRef.current = null;
    }
    clearCanvasAndText();
    setImageUrl(null);
  }, [clearCanvasAndText]);

  // Main loader: probes format then initializes appropriate reader
  const loadDocument = useCallback(async () => {
    const requestId = ++activeRequestIdRef.current;
    currentDocIdRef.current = documentId;
    cleanupResources();

    setStatus("PROBING");
    setErrorType(null);
    setErrorMessage("");
    setFormat(null);
    setCurrentPage(1);
    desiredPageRef.current = 1;
    userNavigatedRef.current = false;
    setNumPages(0);
    setScale(1.0);
    setFitWidthMode(true);
    setFitWidthScale(null);
    lastPdfRenderInputsRef.current = { page: null, scale: null, fitWidth: null, width: null };
    setImageScale(1.0);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // 1. Inspect format via bounded range request without transferring entire file
      const probeResponse = await fetch(viewUrl, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        credentials: "include",
        signal: abortController.signal,
      });

      // Close / cancel the unused response body stream immediately so full payload is not buffered
      if (probeResponse.body) {
        try {
          probeResponse.body.cancel().catch(() => {});
        } catch {
          // ignore stream cancellation error
        }
      }

      if (activeRequestIdRef.current !== requestId || currentDocIdRef.current !== documentId) return;

      if (!probeResponse.ok && probeResponse.status !== 206) {
        cleanupResources();
        if (probeResponse.status === 401 || probeResponse.status === 403) {
          setErrorType("AUTH_REQUIRED");
          setErrorMessage("Please log in to view this document.");
        } else if (probeResponse.status === 404) {
          setErrorType("NOT_FOUND");
          setErrorMessage("Document not found or unavailable.");
        } else if (probeResponse.status === 415) {
          setErrorType("UNSUPPORTED_FORMAT");
          setErrorMessage("Unsupported document format for inline viewing.");
        } else {
          setErrorType("NETWORK_ERROR");
          setErrorMessage("Unable to load document from the server.");
        }
        setStatus("ERROR");
        return;
      }

      const contentType = (probeResponse.headers.get("content-type") || "").toLowerCase();

      if (contentType.includes("application/pdf")) {
        setFormat("pdf");
        setStatus("LOADING_FILE");

        let openPromise: Promise<{ position: { last_page: number } | null; error: boolean }> | null = null;
        const visitKey = `${user?.id ?? "guest"}:${documentId}`;
        if (approved && user && !authLoading && !openedVisitsRef.current.has(visitKey)) {
          openedVisitsRef.current.add(visitKey);
          const controller = new AbortController();
          readingRequestRef.current = controller;
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          openPromise = fetchApi<{ last_page: number }>(
            `/api/v1/communities/irm/documents/${encodeURIComponent(documentId)}/reading/open`,
            { method: "POST", signal: controller.signal },
          ).then(
            (position) => ({ position, error: false as const }),
            () => ({ position: null, error: true as const }),
          ).finally(() => clearTimeout(timeoutId));
        }

        // 2. Load PDF directly via PDF.js with session credentials
        const pdfjs = await import("pdfjs-dist");
        if (activeRequestIdRef.current !== requestId || currentDocIdRef.current !== documentId) return;

        // Configure matching worker from our own application
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "/pdf.worker.min.mjs",
          window.location.origin
        ).toString();

        const loadingTask = pdfjs.getDocument({
          url: viewUrl,
          withCredentials: true,
        });
        loadingTaskRef.current = loadingTask;

        const docProxy = await loadingTask.promise;
        if (activeRequestIdRef.current !== requestId || currentDocIdRef.current !== documentId) return;

        pdfDocRef.current = docProxy;
        setNumPages(docProxy.numPages);
        setCurrentPage(1);
        desiredPageRef.current = 1;
        savedPageRef.current = 1;
        positionReadyRef.current = false;
        setPositionReady(false);
        setStatus("READY");
        if (openPromise) {
          void openPromise.then((result) => {
            if (activeRequestIdRef.current !== requestId || currentDocIdRef.current !== documentId) return;
            if (result.error || !result.position) {
              setReadingMessage("Your reading position could not be restored. You can still read this document.");
              savedPageRef.current = null;
              positionReadyRef.current = true;
              setPositionReady(true);
              return;
            }
            const restoredPage = Math.min(Math.max(result.position.last_page, 1), docProxy.numPages);
            if (!userNavigatedRef.current) {
              desiredPageRef.current = restoredPage;
              savedPageRef.current = restoredPage;
              setCurrentPage(restoredPage);
            } else {
              savedPageRef.current = null;
            }
            positionReadyRef.current = true;
            setPositionReady(true);
            setReadingMessage(null);
          });
        } else {
          savedPageRef.current = null;
        }
      } else if (
        contentType.includes("image/jpeg") ||
        contentType.includes("image/png") ||
        contentType.includes("image/jpg")
      ) {
        setFormat("image");
        setStatus("LOADING_FILE");

        // Fetch image blob securely with credentials
        const imgResponse = await fetch(viewUrl, {
          credentials: "include",
          signal: abortController.signal,
        });

        if (activeRequestIdRef.current !== requestId || currentDocIdRef.current !== documentId) return;

        if (!imgResponse.ok) {
          throw new Error(`Failed to load image: status ${imgResponse.status}`);
        }

        const blob = await imgResponse.blob();
        if (activeRequestIdRef.current !== requestId || currentDocIdRef.current !== documentId) return;

        const objUrl = URL.createObjectURL(blob);
        activeImageUrlRef.current = objUrl;
        setImageUrl(objUrl);
        setStatus("READY");
      } else {
        cleanupResources();
        setErrorType("UNSUPPORTED_FORMAT");
        setErrorMessage("Unsupported document format for inline viewing.");
        setStatus("ERROR");
      }
    } catch (err) {
      if (activeRequestIdRef.current !== requestId || currentDocIdRef.current !== documentId) return;
      if (err instanceof Error && err.name === "AbortError") {
        return; // Normal cancellation
      }

      cleanupResources();
      setStatus("ERROR");
      const errStr = String(err);
      if (errStr.includes("InvalidPDF") || errStr.includes("FormatError")) {
        setErrorType("PARSE_ERROR");
        setErrorMessage("Unable to read this document. The file may be damaged.");
      } else {
        setErrorType("NETWORK_ERROR");
        setErrorMessage("Unable to load document from the server. Please check your connection and try again.");
      }
    }
  }, [documentId, viewUrl, cleanupResources, user, authLoading, approved]);

  // Trigger load on documentId change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocument();
    return () => {
      cleanupResources();
    };
  }, [loadDocument, cleanupResources]);

  const writeLatestPosition = useCallback(async (keepalive = false) => {
    const ownerId = user?.id;
    const page = desiredPageRef.current;
    if (!ownerId || ownerId !== accountRef.current || !positionReadyRef.current || positionBusyRef.current || savedPageRef.current === page) return;
    positionBusyRef.current = true;
    const controller = new AbortController();
    positionRequestRef.current = controller;
    try {
      await fetchApi<{ last_page: number }>(
        `/api/v1/communities/irm/documents/${encodeURIComponent(documentId)}/reading/position`,
        { method: "PUT", body: JSON.stringify({ page }), signal: controller.signal, keepalive },
      );
      if (accountRef.current === ownerId) {
        savedPageRef.current = page;
        setReadingMessage(null);
      }
    } catch {
      if (!controller.signal.aborted && accountRef.current === ownerId) {
        setReadingMessage("Your reading position could not be saved. You can keep reading; try changing page again later.");
      }
    } finally {
      if (positionRequestRef.current === controller) positionRequestRef.current = null;
      positionBusyRef.current = false;
      if (accountRef.current === ownerId && positionReadyRef.current && savedPageRef.current !== desiredPageRef.current) {
        if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
        positionTimerRef.current = setTimeout(() => void writeLatestPosition(), 0);
      }
    }
  }, [documentId, user?.id]);

  useEffect(() => {
    if (!positionReady || status !== "READY" || format !== "pdf" || savedPageRef.current === currentPage) return;
    desiredPageRef.current = currentPage;
    if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
    positionTimerRef.current = setTimeout(() => {
      positionTimerRef.current = null;
      void writeLatestPosition();
    }, 500);
    return () => {
      if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
      positionTimerRef.current = null;
    };
  }, [currentPage, format, positionReady, status, writeLatestPosition]);

  useEffect(() => {
    const flush = () => {
      if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
      positionTimerRef.current = null;
      if (!positionBusyRef.current && savedPageRef.current !== desiredPageRef.current) {
        void writeLatestPosition(true);
      }
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [writeLatestPosition]);

  // Render current PDF page
  const renderPdfPage = useCallback(
      async (pageNumber: number, targetScale: number, fitWidth: boolean) => {
      const pdfDoc = pdfDocRef.current;
      const canvas = canvasRef.current;
      if (!pdfDoc || !canvas) return;

      const renderId = ++activeRenderIdRef.current;

      // Cancel any ongoing text layer and page render
      if (activeTextLayerRef.current) {
        try {
          activeTextLayerRef.current.cancel();
        } catch {
          // ignore cancellation
        }
        activeTextLayerRef.current = null;
      }
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      // Immediately clear the stale text layer to prevent duplicate text spans
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = "";
      }

      setIsRenderingPage(true);

      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (activeRenderIdRef.current !== renderId || currentDocIdRef.current !== documentId) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const unscaledViewport = page.getViewport({ scale: 1.0 });

        let requestedScale = targetScale;
        if (fitWidth) {
          const availableWidth = measureReaderWidth();
          if (availableWidth <= 0 || unscaledViewport.width <= 0) return;
          // getViewport includes the page's effective rotation, so this also fits
          // landscape and rotated pages using their actual displayed width.
          requestedScale = Math.min(MAX_SCALE, availableWidth / unscaledViewport.width);
        }

        // Enforce canvas dimension budget to avoid OOM on large documents
        let effectiveScale = requestedScale;
        const maxRawDim = Math.max(unscaledViewport.width, unscaledViewport.height);
        if (maxRawDim * effectiveScale * dpr > MAX_CANVAS_DIM) {
          effectiveScale = MAX_CANVAS_DIM / (maxRawDim * dpr);
        }

        if (fitWidth) setFitWidthScale(effectiveScale);

        const viewport = page.getViewport({ scale: effectiveScale });

        const cssWidth = `${viewport.width}px`;
        const cssHeight = `${viewport.height}px`;

        // Apply device-pixel-ratio scaling only to canvas backing buffer resolution
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = cssWidth;
        canvas.style.height = cssHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Map logical page viewport coordinates to high-DPI canvas backing store
        ctx.setTransform(canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (activeRenderIdRef.current !== renderId || currentDocIdRef.current !== documentId) return;

        // Render text layer overlay matching logical viewport exactly
        const textContainer = textLayerRef.current;
        if (textContainer) {
          textContainer.innerHTML = "";
          // Set required PDF.js scale factor CSS variable for font sizing and geometry
          textContainer.style.setProperty("--scale-factor", `${viewport.scale}`);
          textContainer.style.width = cssWidth;
          textContainer.style.height = cssHeight;

          try {
            const pdfjs = await import("pdfjs-dist");
            const textContent = await page.getTextContent();
            if (activeRenderIdRef.current !== renderId || currentDocIdRef.current !== documentId) return;

            const textLayer = new pdfjs.TextLayer({
              textContentSource: textContent,
              container: textContainer,
              viewport: viewport,
            });
            activeTextLayerRef.current = textLayer;
            await textLayer.render();
            if (activeTextLayerRef.current === textLayer) {
              activeTextLayerRef.current = null;
            }
          } catch {
            // Text layer failure is non-fatal; canvas remains viewable
          }
        }
      } catch (err: unknown) {
        if (err && typeof err === "object" && "name" in err && err.name === "RenderingCancelledException") {
          return; // Expected cancellation on rapid zoom/page changes
        }
        if (activeRenderIdRef.current === renderId && currentDocIdRef.current === documentId) {
          setErrorMessage("Failed to render the document page.");
        }
      } finally {
        if (activeRenderIdRef.current === renderId) {
          setIsRenderingPage(false);
        }
      }
    },
    [documentId, measureReaderWidth]
  );

  // Trigger page render when READY status, currentPage, or scale changes
  useEffect(() => {
    if (status !== "READY" || format !== "pdf" || numPages <= 0 || readerWidth === null || readerWidth <= 0) return;
    const previous = lastPdfRenderInputsRef.current;
    const pageOrZoomChanged = previous.page !== currentPage || previous.scale !== scale || previous.fitWidth !== fitWidthMode;
    const widthChanged = previous.width !== readerWidth;
    lastPdfRenderInputsRef.current = {
      page: currentPage,
      scale,
      fitWidth: fitWidthMode,
      width: readerWidth,
    };
    // A width-only update rerenders only in Fit width mode. Manual zoom retains
    // its percentage and canvas until the page or the selected scale changes.
    if (pageOrZoomChanged || (fitWidthMode && widthChanged)) {
      renderPdfPage(currentPage, scale, fitWidthMode);
    }
  }, [status, format, numPages, currentPage, scale, fitWidthMode, readerWidth, renderPdfPage]);

  // Page Navigation Handlers
  const handlePrevPage = () => {
    if (currentPage > 1) {
      userNavigatedRef.current = true;
      desiredPageRef.current = currentPage - 1;
      if (fitWidthMode) setFitWidthScale(null);
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < numPages) {
      userNavigatedRef.current = true;
      desiredPageRef.current = currentPage + 1;
      if (fitWidthMode) setFitWidthScale(null);
      setCurrentPage(currentPage + 1);
    }
  };

  // Zoom Handlers for PDF
  const handleZoomIn = () => {
    const currentScale = fitWidthMode ? fitWidthScale ?? scale : scale;
    const nextScale = Math.min(currentScale + SCALE_STEP, MAX_SCALE);
    setFitWidthMode(false);
    setScale(nextScale);
  };

  const handleZoomOut = () => {
    const currentScale = fitWidthMode ? fitWidthScale ?? scale : scale;
    const nextScale = Math.max(currentScale - SCALE_STEP, MIN_SCALE);
    setFitWidthMode(false);
    setScale(nextScale);
  };

  const handleFitWidth = () => {
    setFitWidthMode(true);
    setFitWidthScale(null);
  };

  // Zoom Handlers for Image
  const handleImageZoomIn = () => {
    setImageScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  };

  const handleImageZoomOut = () => {
    setImageScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  };

  const handleImageResetZoom = () => {
    setImageScale(1.0);
  };

  const displayedPdfScale = fitWidthMode ? fitWidthScale : scale;

  // Top action bar: Open in New Tab & Download
  const renderActions = (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={viewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-text border border-control-border bg-surface hover:bg-surface-secondary hover:border-accent hover:text-accent px-4 py-2.5 rounded-control transition-colors min-h-[44px] focus:outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
        title="Open original document in a new tab"
      >
        <span>Open in new tab</span>
        <span className="sr-only">(opens in a new tab)</span>
        <svg
          className="w-4 h-4 text-accent shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading} aria-busy={downloading}
        className="ui-button ui-button--primary"
      >
        <PendingLabel pending={!!(downloading)} idle="Download Original" busy="Downloading..." />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Action Header */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-text">Document Reader</h2>
          <p className="text-xs text-text-subtle">
            {format === "pdf" && numPages > 0
              ? `PDF Document — ${numPages} page${numPages > 1 ? "s" : ""}`
              : format === "image"
              ? "Image Document"
              : "Protected Document"}
          </p>
        </div>
        {renderActions}
      </div>
      {readingMessage && <p role="status" className="text-sm text-text-muted">{readingMessage}</p>}

      {/* Reader Body */}
      {status === "PROBING" || status === "LOADING_FILE" ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center p-12 bg-surface-secondary border border-border rounded-surface min-h-[300px] text-text-muted text-sm space-y-3"
        >
          <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <p>
            {status === "PROBING"
              ? "Verifying document format..."
              : "Loading document content..."}
          </p>
        </div>
      ) : status === "ERROR" ? (
        <div className="p-6 bg-surface border border-border rounded-surface space-y-4">
          {errorType === "AUTH_REQUIRED" ? (
            <AccessDeniedGuidance
              isGuest={true}
            />
          ) : errorType === "NOT_FOUND" ? (
            <AccessDeniedGuidance
              isNotFound={true}
              notFoundMessage="This document is not available or you do not have permission to view it."
            />
          ) : (
            <div className="space-y-4">
              <FeedbackMessage
                type="error"
                message={errorMessage || "Unable to display this document."}
                onRetry={loadDocument}
                retryLabel="Retry Loading"
              />
              <div className="text-sm text-text-muted space-y-2">
                <p>You can still try accessing the file directly:</p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <a
                    href={viewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-button ui-button--secondary"
                  >
                    <span>Try opening in new tab</span>
                    <span className="sr-only">(opens in a new tab)</span>
                    <svg
                      className="w-4 h-4 text-accent shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                  <button
                    type="button"
                    onClick={onDownload}
                    disabled={downloading} aria-busy={downloading}
                    className="ui-button ui-button--secondary"
                  >
                    Download file instead
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : format === "pdf" ? (
        <div className="border border-border rounded-surface overflow-hidden bg-surface shadow-none">
          {/* PDF Toolbar */}
          <div className="ui-reader-toolbar flex flex-wrap items-center justify-between gap-3 p-2.5 sm:p-3 bg-surface-secondary border-b border-border">
            {/* Page navigation */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={currentPage <= 1}
                aria-label="Previous page"
                className="ui-button ui-button--secondary"
              >
                &larr; Prev
              </button>
              <span
                aria-live="polite"
                className="text-xs sm:text-sm text-text font-semibold px-2 select-none"
              >
                Page {currentPage} of {numPages}
              </span>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={currentPage >= numPages}
                aria-label="Next page"
                className="ui-button ui-button--secondary"
              >
                Next &rarr;
              </button>
            </div>

            {/* Zoom controls */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={displayedPdfScale === null || (fitWidthMode ? displayedPdfScale <= 0.1 : displayedPdfScale <= MIN_SCALE)}
                aria-label="Zoom out"
                className="ui-button ui-button--secondary ui-icon-button"
              >
                &minus;
              </button>
              <span className="text-xs sm:text-sm text-text font-semibold w-14 text-center select-none">
                {displayedPdfScale === null ? "Fitting…" : `${Math.round(displayedPdfScale * 100)}%`}
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={displayedPdfScale === null || displayedPdfScale >= MAX_SCALE}
                aria-label="Zoom in"
                className="ui-button ui-button--secondary ui-icon-button"
              >
                &#43;
              </button>
              <button
                type="button"
                onClick={handleFitWidth}
                aria-label="Fit to width"
                aria-pressed={fitWidthMode}
                className="ui-button ui-button--secondary"
              >
                Fit Width
              </button>
            </div>
          </div>

          {/* Canvas viewport container: stable responsive height independent of zoom scale */}
          <div
            ref={containerRef}
            className="w-full overflow-auto h-[520px] sm:h-[640px] max-h-[75vh] min-h-[360px] bg-reader-viewport flex p-2 sm:p-6 relative focus:outline-none"
            tabIndex={0}
            aria-busy={isRenderingPage}
            aria-label={`PDF Viewer: ${documentTitle}, Page ${currentPage}`}
          >
            <div className="relative shadow-none bg-document-paper m-auto shrink-0 select-text">
              <canvas ref={canvasRef} className="block" data-testid="pdf-canvas" />
              <div
                ref={textLayerRef}
                className="textLayer absolute inset-0 pointer-events-auto select-text"
              />
            </div>
          </div>
        </div>
      ) : format === "image" && imageUrl ? (
        <div className="border border-border rounded-surface overflow-hidden bg-surface shadow-none">
          {/* Image Toolbar */}
          <div className="ui-reader-toolbar flex flex-wrap items-center justify-between gap-3 p-2.5 sm:p-3 bg-surface-secondary border-b border-border">
            <span className="text-xs sm:text-sm text-text font-semibold px-1">
              Image Viewer
            </span>
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={handleImageZoomOut}
                disabled={imageScale <= MIN_SCALE}
                aria-label="Zoom out"
                className="ui-button ui-button--secondary ui-icon-button"
              >
                &minus;
              </button>
              <span className="text-xs sm:text-sm text-text font-semibold w-14 text-center select-none">
                {Math.round(imageScale * 100)}%
              </span>
              <button
                type="button"
                onClick={handleImageZoomIn}
                disabled={imageScale >= MAX_SCALE}
                aria-label="Zoom in"
                className="ui-button ui-button--secondary ui-icon-button"
              >
                &#43;
              </button>
              <button
                type="button"
                onClick={handleImageResetZoom}
                aria-label="Reset zoom"
                className="ui-button ui-button--secondary"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Image Viewport Container: stable responsive height independent of zoom scale */}
          <div
            className="w-full overflow-auto h-[520px] sm:h-[640px] max-h-[75vh] min-h-[360px] bg-reader-viewport flex p-2 sm:p-6 relative focus:outline-none"
            tabIndex={0}
            aria-label={`Image Viewer: ${documentTitle}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={documentTitle}
              className="max-w-full h-auto object-contain rounded shadow-none m-auto transition-transform duration-150 ease-out"
              style={{
                transform: `scale(${imageScale})`,
                transformOrigin: "center center",
              }}
              data-testid="document-image"
            />
          </div>
        </div>
      ) : null}

      {/* Scoped PDF.js Text Layer protection */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .textLayer {
          position: absolute;
          text-align: initial;
          inset: 0;
          overflow: clip;
          opacity: 1;
          line-height: 1;
          -webkit-text-size-adjust: none;
          -moz-text-size-adjust: none;
          text-size-adjust: none;
          forced-color-adjust: none;
          transform-origin: 0 0;
          caret-color: CanvasText;
          z-index: 1;
        }
        .textLayer :is(span, br) {
          color: transparent !important;
          position: absolute !important;
          white-space: pre !important;
          cursor: text;
          transform-origin: 0% 0% !important;
        }
        .textLayer span.markedContent {
          top: 0;
          height: 0;
        }
        .textLayer ::selection {
          background: rgba(109, 40, 217, 0.3) !important;
        }
        .textLayer br::selection {
          background: transparent !important;
        }
      `,
        }}
      />
    </div>
  );
}
