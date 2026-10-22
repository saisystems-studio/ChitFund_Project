import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { previewBox, previewWidth } from "./previewLayout";
import styles from "./DocumentPreviewModal.module.css";

// Large attachment viewer shared by Add/Edit Customer, Loan Application and every
// other KycDocumentsSection. Both PDFs and images open in "Fit to Page" mode: the
// whole page (or image) is scaled to fit the available area, keeping its aspect
// ratio, and zoom is relative to that fit (Fit = 100%). Every preview opens at
// DEFAULT_ZOOM (150% of the fit), scrolled to the top centre of the page. PDFs are rendered with pdf.js (loaded on
// demand) so the fit, margins and background are identical in every browser; pages
// are stacked vertically and only drawn as they scroll into view. If pdf.js cannot
// open a file, the browser's own PDF viewer is used as a fallback.
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const DEFAULT_ZOOM = 1.5;
const MAX_IMAGE_FIT = 1;   // images are never enlarged beyond their natural size
const MAX_PDF_FIT = 1.5;   // cap for very large screens (1 = actual page size)

let pdfjsPromise = null;
const loadPdfjs = () => {
  pdfjsPromise ||= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")])
    .then(([lib, worker]) => { lib.GlobalWorkerOptions.workerSrc = worker.default; return lib; })
    .catch(reason => { pdfjsPromise = null; throw reason; });
  return pdfjsPromise;
};

const icons = {
  file: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" />,
  zoomIn: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M8 11h6" /></>,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  download: <path d="M12 4v12m0 0 4-4m-4 4-4-4M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" />,
  print: <path d="M7 8V3h10v5M7 17H5a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};
const Icon = ({ name }) => <svg viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>;

export default function DocumentPreviewModal({ title, fileName, url, isPdf, onClose, onDownload, headerExtra }) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [box, setBox] = useState(null);
  const [natural, setNatural] = useState(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [pdf, setPdf] = useState(null);
  const [pdfStatus, setPdfStatus] = useState("loading");
  const bodyRef = useRef(null);
  const headerRef = useRef(null);
  const printFrameRef = useRef(null);
  const previousScaleRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Capture phase on window so Escape closes only this viewer, not a parent modal
  // (e.g. the Customer List's KYC modal) that also listens on document.
  useEffect(() => {
    const onKey = event => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useLayoutEffect(() => {
    const body = bodyRef.current, header = headerRef.current;
    if (!body || !header) return;
    const measure = () => {
      const padding = parseFloat(getComputedStyle(body).paddingTop) || 0;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const next = { ...previewBox(width, height, header.offsetHeight, padding), viewportWidth: width, padding };
      setBox(previous => previous && Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(header);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false, task = null;
    setPdf(null); setPdfStatus("loading");
    loadPdfjs().then(async lib => {
      if (cancelled) return;
      task = lib.getDocument({ url });
      const doc = await task.promise;
      const sizes = [];
      for (let number = 1; number <= doc.numPages; number += 1) {
        const viewport = (await doc.getPage(number)).getViewport({ scale: 1 });
        sizes.push({ w: viewport.width, h: viewport.height });
      }
      if (!cancelled) { setPdf({ doc, sizes }); setPdfStatus("ready"); }
    }).catch(() => { if (!cancelled) setPdfStatus("error"); });
    return () => { cancelled = true; task?.destroy(); };
  }, [url, isPdf]);

  useEffect(() => () => {
    const frame = printFrameRef.current;
    if (frame) setTimeout(() => frame.remove(), 60000);
  }, []);

  // Fit to Page: the largest page (or the image) fits entirely in the preview area.
  const content = isPdf
    ? pdf && { w: Math.max(...pdf.sizes.map(size => size.w)), h: Math.max(...pdf.sizes.map(size => size.h)) }
    : natural;
  const fitScale = content && box ? Math.min(box.w / content.w, box.h / content.h, isPdf ? MAX_PDF_FIT : MAX_IMAGE_FIT) : null;
  const scale = fitScale ? fitScale * zoom : null;

  // Keep the point at the centre of the view in place while zooming.
  useLayoutEffect(() => {
    const body = bodyRef.current, previous = previousScaleRef.current;
    // First render at the default zoom: start horizontally centred, at the top.
    if (body && !previous && scale) body.scrollLeft = Math.max(0, (body.scrollWidth - body.clientWidth) / 2);
    if (body && previous && scale && previous !== scale) {
      const ratio = scale / previous;
      body.scrollTop = (body.scrollTop + body.clientHeight / 2) * ratio - body.clientHeight / 2;
      body.scrollLeft = (body.scrollLeft + body.clientWidth / 2) * ratio - body.clientWidth / 2;
    }
    previousScaleRef.current = scale;
  }, [scale]);

  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const zoomBy = delta => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIndex + delta))]);
  const zoomLabel = scale ? `${Math.round(zoom * 100)}%` : "Fit";
  const usingFallback = isPdf && pdfStatus === "error";

  const print = () => {
    printFrameRef.current?.remove();
    const frame = document.createElement("iframe");
    frame.title = "Print document";
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch { window.open(url, "_blank", "noopener"); }
    };
    if (isPdf) frame.src = url;
    else frame.srcdoc = `<!doctype html><html><head><title>${fileName || title || "Document"}</title><style>@page{margin:10mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${url}" alt=""></body></html>`;
    document.body.appendChild(frame);
    printFrameRef.current = frame;
  };

  const subtitle = [fileName, pdf && `${pdf.sizes.length} ${pdf.sizes.length === 1 ? "page" : "pages"}`].filter(Boolean).join(" · ");

  return <div className={styles.backdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className={styles.modal} style={content && scale && box ? { width: previewWidth(content.w, scale, box.viewportWidth, box.padding) } : undefined} role="dialog" aria-modal="true" aria-label={`Preview ${title}`}>
      <header ref={headerRef} className={styles.header}>
        <span className={styles.fileIcon}><Icon name="file" /></span>
        <div className={styles.titles}>
          <strong title={title}>{title}</strong>
          {subtitle && <span title={subtitle}>{subtitle}</span>}
        </div>
        {headerExtra && <div className={styles.navigation}>{headerExtra}</div>}
        <div className={styles.toolbar}>
          <div className={styles.group} role="group" aria-label="Zoom">
            <button type="button" className={styles.toolBtn} onClick={() => zoomBy(-1)} disabled={usingFallback || zoomIndex <= 0} aria-label="Zoom out" title="Zoom out"><Icon name="zoomOut" /></button>
            <button type="button" className={styles.zoomValue} onClick={() => setZoom(1)} disabled={usingFallback} title="Fit to page" aria-label={`Zoom ${zoomLabel}, fit to page`}>{zoomLabel}</button>
            <button type="button" className={styles.toolBtn} onClick={() => zoomBy(1)} disabled={usingFallback || zoomIndex >= ZOOM_STEPS.length - 1} aria-label="Zoom in" title="Zoom in"><Icon name="zoomIn" /></button>
            <button type="button" className={styles.toolBtn} onClick={() => setZoom(1)} disabled={usingFallback || zoom === 1} aria-label="Fit to page" title="Fit to page"><Icon name="fit" /></button>
          </div>
          <div className={styles.group}>
            <button type="button" className={styles.actionBtn} onClick={onDownload} title="Download"><Icon name="download" /><span>Download</span></button>
            <button type="button" className={styles.actionBtn} onClick={print} title="Print"><Icon name="print" /><span>Print</span></button>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="close" /></button>
        </div>
      </header>
      <div ref={bodyRef} className={`${styles.body} ${usingFallback ? styles.frameBody : ""}`}>
        {isPdf
          ? usingFallback
            ? <iframe className={styles.frame} title="Document preview" src={`${url}#toolbar=0&navpanes=0&view=Fit`} />
            : pdf && scale
              ? <div className={styles.pages}>{pdf.sizes.map((size, index) => <PdfPage key={index} doc={pdf.doc} number={index + 1} size={size} scale={scale} rootRef={bodyRef} />)}</div>
              : <p className={styles.message}>Loading document…</p>
          : imageFailed
            ? <p className={styles.message}>Preview is not available for this file.</p>
            : <img className={styles.image} src={url} alt={title} draggable={false}
                style={scale ? { width: Math.floor(natural.w * scale), height: Math.floor(natural.h * scale) } : { maxWidth: "100%", maxHeight: "100%" }}
                onLoad={event => setNatural({ w: event.currentTarget.naturalWidth || 1, h: event.currentTarget.naturalHeight || 1 })}
                onError={() => setImageFailed(true)} />}
      </div>
    </div>
  </div>;
}

// One PDF page: a placeholder of the exact scaled size (so scrolling is stable),
// drawn once it comes near the viewport and redrawn sharply after every zoom/resize.
function PdfPage({ doc, number, size, scale, rootRef }) {
  const holderRef = useRef(null);
  const canvasRef = useRef(null);
  const [visible, setVisible] = useState(number <= 2);

  useEffect(() => {
    if (visible || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { root: rootRef.current, rootMargin: "800px 0px" });
    observer.observe(holderRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false, task = null;
    const timer = setTimeout(() => {
      doc.getPage(number).then(page => {
        if (cancelled) return;
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * ratio });
        // Draw off-screen first so the old rendering stays visible until the new one is ready.
        const buffer = document.createElement("canvas");
        buffer.width = Math.floor(viewport.width);
        buffer.height = Math.floor(viewport.height);
        task = page.render({ canvas: buffer, canvasContext: buffer.getContext("2d"), viewport });
        return task.promise.then(() => {
          const canvas = canvasRef.current;
          if (cancelled || !canvas) return;
          canvas.width = buffer.width;
          canvas.height = buffer.height;
          canvas.getContext("2d").drawImage(buffer, 0, 0);
        });
      }).catch(() => {});
    }, 60);
    return () => { cancelled = true; clearTimeout(timer); task?.cancel(); };
  }, [doc, number, scale, visible]);

  return <div ref={holderRef} className={styles.page} style={{ width: Math.floor(size.w * scale), height: Math.floor(size.h * scale) }}>
    <canvas ref={canvasRef} aria-label={`Page ${number}`} />
  </div>;
}
