/* ==========================================================================
   PlanosDoc Pro - Native Binary PDF Engine & Vector Preservation Editor
   ========================================================================== */

// IndexedDB PDF Storage Engine
const DB_NAME = "PlanosDocBinaryDB";
const STORE_NAME = "pdf_files";

function openPdfDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function savePdfBinary(docId, arrayBuffer) {
    try {
        const db = await openPdfDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(arrayBuffer, docId);
            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error("IndexedDB Save Error:", e);
    }
}

async function getPdfBinary(docId) {
    try {
        const db = await openPdfDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(docId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error("IndexedDB Get Error:", e);
        return null;
    }
}

async function deletePdfBinary(docId) {
    try {
        const db = await openPdfDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            store.delete(docId);
            tx.oncomplete = () => resolve(true);
        });
    } catch (e) {
        console.error("IndexedDB Delete Error:", e);
    }
}

async function generatePdfThumbnail(arrayBuffer) {
    try {
        if (!window.pdfjsLib) return null;
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const targetWidth = 360;
        const scale = targetWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale: scale });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        await page.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;

        return canvas.toDataURL("image/png");
    } catch (e) {
        console.error("Error generating PDF thumbnail:", e);
        return null;
    }
}

// Expose IndexedDB & Thumbnail helpers on global window object
window.openPdfDatabase = openPdfDatabase;
window.savePdfBinary = savePdfBinary;
window.getPdfBinary = getPdfBinary;
window.deletePdfBinary = deletePdfBinary;
window.generatePdfThumbnail = generatePdfThumbnail;

let activeDocument = null;
let pdfDoc = null;
let activePdfArrayBuffer = null;
let currentPageNum = 1;
let totalPagesNum = 1;
let zoomScale = 1.0;
let currentPdfPageUnscaledWidth = 1400;
let currentPdfPageUnscaledHeight = 950;
let zoomDebounceTimer = null;

let activeTool = 'select'; // select, pan, rect, circle, line, draw, text, stamp
let currentColor = '#ef4444';
let currentFill = '0.2';
let currentStrokeWidth = 4;

let annotations = []; // Array of annotation objects for active document
let selectedAnnotationId = null;
let undoStack = [];

let hasUnsavedChanges = false;
window.hasUnsavedChanges = false;

function setHasUnsavedChanges(val) {
    hasUnsavedChanges = val;
    window.hasUnsavedChanges = val;
}
window.setHasUnsavedChanges = setHasUnsavedChanges;

function checkUnsavedChangesConfirmation() {
    if (window.hasUnsavedChanges) {
        return confirm("⚠️ Tienes cambios sin guardar en el plano actual.\n\n¿Estás seguro de que deseas salir sin guardar? Los cambios no guardados se perderán.");
    }
    return true;
}
window.checkUnsavedChangesConfirmation = checkUnsavedChangesConfirmation;

window.addEventListener("beforeunload", (e) => {
    if (window.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "⚠️ Tienes cambios sin guardar en el plano actual. ¿Seguro que deseas salir?";
        return e.returnValue;
    }
});

// Canvas references
let pdfCanvas = null;
let pdfCtx = null;
let overlayCanvas = null;
let overlayCtx = null;

let isDrawing = false;
let startX = 0;
let startY = 0;
let currentFreehandPoints = [];

// PDF.js Render Task Tracker
let activePdfRenderTask = null;

// Panning variables
let isPanning = false;
let isSpacePressed = false;
let panStartX = 0;
let panStartY = 0;
let panStartScrollLeft = 0;
let panStartScrollTop = 0;

function initPdfEditorEngine() {
    pdfCanvas = document.getElementById("pdf-render-canvas");
    pdfCtx = pdfCanvas.getContext("2d");
    overlayCanvas = document.getElementById("annotation-overlay-canvas");
    overlayCtx = overlayCanvas.getContext("2d");

    const viewport = document.getElementById("canvas-viewport");

    // Canvas Mouse & Touch Events
    overlayCanvas.addEventListener("mousedown", handleCanvasMouseDown);
    overlayCanvas.addEventListener("mousemove", handleCanvasMouseMove);
    overlayCanvas.addEventListener("mouseup", handleCanvasMouseUp);

    overlayCanvas.addEventListener("touchstart", handleTouchStart);
    overlayCanvas.addEventListener("touchmove", handleTouchMove);
    overlayCanvas.addEventListener("touchend", handleTouchEnd);

    // VIEWPORT DRAG-PANNING IN ANY DIRECTION (Hand Tool, Spacebar, or Middle Click)
    if (viewport) {
        viewport.addEventListener("mousedown", (e) => {
            if (activeTool === 'pan' || e.button === 1 || isSpacePressed) {
                isPanning = true;
                panStartX = e.clientX;
                panStartY = e.clientY;
                panStartScrollLeft = viewport.scrollLeft;
                panStartScrollTop = viewport.scrollTop;
                viewport.style.cursor = "grabbing";
                overlayCanvas.style.cursor = "grabbing";
                e.preventDefault();
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (isPanning) {
                const dx = e.clientX - panStartX;
                const dy = e.clientY - panStartY;
                viewport.scrollLeft = panStartScrollLeft - dx;
                viewport.scrollTop = panStartScrollTop - dy;
                e.preventDefault();
            }
        });

        window.addEventListener("mouseup", () => {
            if (isPanning) {
                isPanning = false;
                updateCursorStyle();
            }
        });

        // Ctrl + Mouse Wheel / Pinch Vector Zoom around cursor
        viewport.addEventListener("wheel", (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.15 : -0.15;
                zoomAroundPoint(delta, e.clientX, e.clientY);
            }
        }, { passive: false });
    }

    // KEYBOARD SHORTCUTS (Spacebar Pan, Ctrl +/-/0 Zoom)
    document.addEventListener("keydown", (e) => {
        const activeView = document.querySelector(".app-view.active-view");
        if (activeView && activeView.id === "view-editor") {
            if (e.code === "Space" && !isSpacePressed) {
                isSpacePressed = true;
                updateCursorStyle();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
                e.preventDefault();
                zoomCanvas(0.15);
            } else if ((e.ctrlKey || e.metaKey) && (e.key === "-" || e.key === "_")) {
                e.preventDefault();
                zoomCanvas(-0.15);
            } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
                e.preventDefault();
                resetZoom();
            } else if ((e.key === "Delete" || e.key === "Backspace") && selectedAnnotationId) {
                const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
                if (tag !== "input" && tag !== "textarea") {
                    e.preventDefault();
                    requestDeleteAnnotation(selectedAnnotationId);
                }
            }
        }
    });

    document.addEventListener("keyup", (e) => {
        if (e.code === "Space") {
            isSpacePressed = false;
            updateCursorStyle();
        }
    });
}


function updateCursorStyle() {
    const viewport = document.getElementById("canvas-viewport");
    if (!viewport || !overlayCanvas) return;
    if (activeTool === 'pan' || isSpacePressed) {
        viewport.style.cursor = isPanning ? "grabbing" : "grab";
        overlayCanvas.style.cursor = isPanning ? "grabbing" : "grab";
    } else {
        viewport.style.cursor = "auto";
        overlayCanvas.style.cursor = activeTool === 'select' ? 'default' : 'crosshair';
    }
}

async function loadDocumentInEditor(docId) {
    if (activeDocument && activeDocument.id !== docId && window.hasUnsavedChanges) {
        if (!checkUnsavedChangesConfirmation()) return;
    }

    const docs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
    activeDocument = docs.find(d => d.id === docId);

    if (!activeDocument) {
        showToast("Documento no encontrado", "error");
        return;
    }

    document.getElementById("editor-doc-title").textContent = activeDocument.name;
    document.getElementById("editor-doc-badge").textContent = `Versión ${activeDocument.editsCount + 1}`;
    
    annotations = activeDocument.annotations || [];
    undoStack = [];
    setHasUnsavedChanges(false);
    currentPageNum = 1;
    zoomScale = 1.0;
    activePdfArrayBuffer = null;

    document.body.classList.add("in-editor-mode");

    // Fetch binary buffer from IndexedDB first (no localStorage quota limit)
    let binaryBuffer = await getPdfBinary(activeDocument.id);
    if (!binaryBuffer && typeof fetchPdfBinaryFromCloud === "function") {
        showToast("Descargando plano PDF desde la nube...", "info");
        binaryBuffer = await fetchPdfBinaryFromCloud(activeDocument.id);
    }

    if (binaryBuffer && binaryBuffer.byteLength > 0) {
        showToast("Plano PDF cargado con éxito desde la nube.", "success");
        loadPdfFromArrayBuffer(binaryBuffer);
    } else if (activeDocument.pdfDataUrl) {
        loadPdfFromDataUrl(activeDocument.pdfDataUrl);
    } else {
        showToast("No se encontró el archivo binario del plano anterior. Mostrando vista interactiva.", "warning");
        renderBlueprintBackground(activeDocument.sampleType || "blueprint-arch");
    }

    updateAnnotationsListUI();
    navigateTo('editor');
}

// Render Blueprint Background
function renderBlueprintBackground(sampleType) {
    pdfDoc = null;
    totalPagesNum = 1;
    document.getElementById("current-page-num").textContent = "1";
    document.getElementById("total-pages-num").textContent = "1";

    const dpr = window.devicePixelRatio || 1;
    const baseWidth = Math.round(1400 * zoomScale);
    const baseHeight = Math.round(950 * zoomScale);

    currentPdfPageUnscaledWidth = 1400;
    currentPdfPageUnscaledHeight = 950;

    // Buffer dimensions multiplied by DPR for ultra-sharp high-DPI rendering
    pdfCanvas.width = Math.round(baseWidth * dpr);
    pdfCanvas.height = Math.round(baseHeight * dpr);
    pdfCanvas.style.width = `${baseWidth}px`;
    pdfCanvas.style.height = `${baseHeight}px`;

    overlayCanvas.width = Math.round(baseWidth * dpr);
    overlayCanvas.height = Math.round(baseHeight * dpr);
    overlayCanvas.style.width = `${baseWidth}px`;
    overlayCanvas.style.height = `${baseHeight}px`;

    const canvasContainer = document.getElementById("canvas-container");
    if (canvasContainer) {
        canvasContainer.style.width = `${baseWidth}px`;
        canvasContainer.style.height = `${baseHeight}px`;
    }

    pdfCtx.save();
    pdfCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pdfCtx.imageSmoothingEnabled = true;
    pdfCtx.imageSmoothingQuality = 'high';

    // Draw Blueprint Navy Background
    pdfCtx.fillStyle = "#0f172a";
    pdfCtx.fillRect(0, 0, baseWidth, baseHeight);

    // Draw Architectural Grid lines
    pdfCtx.strokeStyle = "rgba(99, 102, 241, 0.18)";
    pdfCtx.lineWidth = Math.max(1, 1.5 * zoomScale);
    const gridSize = 45 * zoomScale;
    for (let x = 0; x < baseWidth; x += gridSize) {
        pdfCtx.beginPath();
        pdfCtx.moveTo(x, 0);
        pdfCtx.lineTo(x, baseHeight);
        pdfCtx.stroke();
    }
    for (let y = 0; y < baseHeight; y += gridSize) {
        pdfCtx.beginPath();
        pdfCtx.moveTo(0, y);
        pdfCtx.lineTo(baseWidth, y);
        pdfCtx.stroke();
    }

    // Draw Sample Architectural Layout Walls and Room Labels
    pdfCtx.strokeStyle = "#94a3b8";
    pdfCtx.lineWidth = Math.max(2, 6 * zoomScale);
    pdfCtx.fillStyle = "rgba(148, 163, 184, 0.05)";

    if (sampleType === "blueprint-arch") {
        // Outer Walls
        pdfCtx.strokeRect(100 * zoomScale, 100 * zoomScale, 1200 * zoomScale, 750 * zoomScale);
        // Interior Walls
        pdfCtx.beginPath();
        pdfCtx.moveTo(600 * zoomScale, 100 * zoomScale);
        pdfCtx.lineTo(600 * zoomScale, 550 * zoomScale);
        pdfCtx.lineTo(950 * zoomScale, 550 * zoomScale);
        pdfCtx.lineTo(950 * zoomScale, 850 * zoomScale);
        pdfCtx.stroke();

        // Labels
        pdfCtx.fillStyle = "#cbd5e1";
        pdfCtx.font = `bold ${Math.round(24 * zoomScale)}px Outfit, sans-serif`;
        pdfCtx.fillText("SALA / COMEDOR PRINCIPAL", 150 * zoomScale, 170 * zoomScale);
        pdfCtx.fillText("DORMITORIO MASTER", 660 * zoomScale, 170 * zoomScale);
        pdfCtx.fillText("OFICINA TÉCNICA Y ESTUDIO", 640 * zoomScale, 700 * zoomScale);
    } else if (sampleType === "blueprint-elec") {
        pdfCtx.strokeRect(100 * zoomScale, 100 * zoomScale, 1200 * zoomScale, 750 * zoomScale);
        pdfCtx.font = `bold ${Math.round(24 * zoomScale)}px Outfit, sans-serif`;
        pdfCtx.fillStyle = "#60a5fa";
        pdfCtx.fillText("ESQUEMA ELÉCTRICO UNIFILAR - NIVEL 1", 150 * zoomScale, 170 * zoomScale);

        pdfCtx.strokeStyle = "#3b82f6";
        pdfCtx.lineWidth = Math.max(1.5, 3 * zoomScale);
        pdfCtx.setLineDash([8 * zoomScale, 8 * zoomScale]);
        pdfCtx.beginPath();
        pdfCtx.moveTo(150 * zoomScale, 280 * zoomScale);
        pdfCtx.lineTo(550 * zoomScale, 280 * zoomScale);
        pdfCtx.lineTo(550 * zoomScale, 650 * zoomScale);
        pdfCtx.stroke();
        pdfCtx.setLineDash([]);
    } else {
        pdfCtx.strokeRect(100 * zoomScale, 100 * zoomScale, 1200 * zoomScale, 750 * zoomScale);
        pdfCtx.font = `bold ${Math.round(24 * zoomScale)}px Outfit, sans-serif`;
        pdfCtx.fillStyle = "#f59e0b";
        pdfCtx.fillText("DETALLE CIMENTACIONES Y ZAPATAS ESTRUCTURALES", 150 * zoomScale, 170 * zoomScale);
    }

    pdfCtx.restore();
    renderOverlayAnnotations();
}

// Render Original PDF from ArrayBuffer (IndexedDB)
function loadPdfFromArrayBuffer(arrayBuffer) {
    activePdfArrayBuffer = arrayBuffer.slice(0); // Clone buffer for PDF export
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    loadingTask.promise.then(pdf => {
        pdfDoc = pdf;
        totalPagesNum = pdf.numPages;
        document.getElementById("total-pages-num").textContent = totalPagesNum;
        renderPdfPage(currentPageNum);
    }).catch(err => {
        console.error("Error loading PDF via PDF.js", err);
        showToast("Error al procesar el PDF real.", "error");
        renderBlueprintBackground(activeDocument ? activeDocument.sampleType : "blueprint-arch");
    });
}

// Render Original PDF at Native Resolution
function loadPdfFromDataUrl(dataUrl) {
    const loadingTask = pdfjsLib.getDocument(dataUrl);
    loadingTask.promise.then(pdf => {
        pdfDoc = pdf;
        totalPagesNum = pdf.numPages;
        document.getElementById("total-pages-num").textContent = totalPagesNum;
        renderPdfPage(currentPageNum);
    }).catch(err => {
        console.error("Error loading PDF via PDF.js", err);
        showToast("Error al cargar PDF real. Mostrando vista interactiva.", "warning");
        renderBlueprintBackground("blueprint-arch");
    });
}

function renderPdfPage(pageNum) {
    if (!pdfDoc) return;

    if (activePdfRenderTask) {
        try {
            activePdfRenderTask.cancel();
        } catch (e) {}
        activePdfRenderTask = null;
    }

    pdfDoc.getPage(pageNum).then(page => {
        const dpr = window.devicePixelRatio || 1;
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        currentPdfPageUnscaledWidth = unscaledViewport.width;
        currentPdfPageUnscaledHeight = unscaledViewport.height;

        // Viewport vector a escala exacta para garantizar máxima definición
        const viewport = page.getViewport({ scale: zoomScale });
        
        const canvasW = Math.round(viewport.width * dpr);
        const canvasH = Math.round(viewport.height * dpr);
        const cssW = `${Math.round(viewport.width)}px`;
        const cssH = `${Math.round(viewport.height)}px`;

        pdfCanvas.width = canvasW;
        pdfCanvas.height = canvasH;
        pdfCanvas.style.width = cssW;
        pdfCanvas.style.height = cssH;

        overlayCanvas.width = canvasW;
        overlayCanvas.height = canvasH;
        overlayCanvas.style.width = cssW;
        overlayCanvas.style.height = cssH;

        const canvasContainer = document.getElementById("canvas-container");
        if (canvasContainer) {
            canvasContainer.style.width = cssW;
            canvasContainer.style.height = cssH;
        }

        pdfCtx.save();
        pdfCtx.setTransform(1, 0, 0, 1, 0, 0);
        pdfCtx.clearRect(0, 0, canvasW, canvasH);
        pdfCtx.restore();

        pdfCtx.imageSmoothingEnabled = true;
        pdfCtx.imageSmoothingQuality = 'high';

        // Renderizado vectorial completo usando la matriz de transformación de PDF.js
        const transform = (dpr !== 1) ? [dpr, 0, 0, dpr, 0, 0] : null;

        const renderContext = {
            canvasContext: pdfCtx,
            viewport: viewport,
            transform: transform
        };

        const renderTask = page.render(renderContext);
        activePdfRenderTask = renderTask;

        renderTask.promise.then(() => {
            activePdfRenderTask = null;
            renderOverlayAnnotations();
        }).catch(err => {
            if (err && err.name !== 'RenderingCancelledException') {
                console.error("PDF Render Error:", err);
            }
        });
    }).catch(err => {
        console.error("Error obteniendo página PDF:", err);
    });
}

// Render Annotation Shapes on top of PDF Canvas
function renderOverlayAnnotations() {
    const dpr = window.devicePixelRatio || 1;
    overlayCtx.save();
    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.restore();

    overlayCtx.save();
    if (dpr !== 1) {
        overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    annotations.forEach(ann => {
        if (ann.page && ann.page !== currentPageNum) return;

        overlayCtx.save();
        overlayCtx.strokeStyle = ann.color || "#ef4444";
        overlayCtx.lineWidth = (ann.strokeWidth || 4) * zoomScale;
        overlayCtx.fillStyle = ann.fillColor || "transparent";

        const isSelected = (ann.id === selectedAnnotationId);
        if (isSelected) {
            overlayCtx.shadowColor = "#6366f1";
            overlayCtx.shadowBlur = 14 * zoomScale;
        }

        const x = ann.x * zoomScale;
        const y = ann.y * zoomScale;
        const w = (ann.width || 0) * zoomScale;
        const h = (ann.height || 0) * zoomScale;
        const r = (typeof ann.radius === 'number' ? ann.radius : 14) * zoomScale;

        switch (ann.type) {
            case "rect":
                overlayCtx.fillRect(x, y, w, h);
                overlayCtx.strokeRect(x, y, w, h);
                if (ann.label) {
                    overlayCtx.save();
                    overlayCtx.fillStyle = ann.color || "#ef4444";
                    const fontSz = Math.max(9, Math.min(14, Math.round(11 * zoomScale)));
                    overlayCtx.font = `bold ${fontSz}px Outfit, sans-serif`;
                    overlayCtx.textAlign = "center";
                    overlayCtx.textBaseline = "middle";
                    overlayCtx.fillText(ann.label, x + w / 2, y + h / 2);
                    overlayCtx.restore();
                }
                break;

            case "circle":
                overlayCtx.beginPath();
                overlayCtx.arc(x, y, r, 0, 2 * Math.PI);
                overlayCtx.fill();
                overlayCtx.stroke();
                if (ann.label) {
                    overlayCtx.save();
                    overlayCtx.fillStyle = ann.color || "#ef4444";
                    const fontSz = Math.max(9, Math.min(14, Math.round(Math.min(r * 0.8, 11 * zoomScale))));
                    overlayCtx.font = `bold ${fontSz}px Outfit, sans-serif`;
                    overlayCtx.textAlign = "center";
                    overlayCtx.textBaseline = "middle";
                    overlayCtx.fillText(ann.label, x, y);
                    overlayCtx.restore();
                }
                break;

            case "line":
                overlayCtx.beginPath();
                overlayCtx.moveTo(x, y);
                overlayCtx.lineTo(ann.endX * zoomScale, ann.endY * zoomScale);
                overlayCtx.stroke();
                
                // Draw Arrowhead
                const angle = Math.atan2((ann.endY - ann.y), (ann.endX - ann.x));
                const headLen = 16 * zoomScale;
                overlayCtx.fillStyle = ann.color;
                overlayCtx.beginPath();
                overlayCtx.moveTo(ann.endX * zoomScale, ann.endY * zoomScale);
                overlayCtx.lineTo(ann.endX * zoomScale - headLen * Math.cos(angle - Math.PI / 6), ann.endY * zoomScale - headLen * Math.sin(angle - Math.PI / 6));
                overlayCtx.lineTo(ann.endX * zoomScale - headLen * Math.cos(angle + Math.PI / 6), ann.endY * zoomScale - headLen * Math.sin(angle + Math.PI / 6));
                overlayCtx.fill();
                break;

            case "draw":
                if (ann.points && ann.points.length > 0) {
                    overlayCtx.beginPath();
                    overlayCtx.moveTo(ann.points[0].x * zoomScale, ann.points[0].y * zoomScale);
                    for (let i = 1; i < ann.points.length; i++) {
                        overlayCtx.lineTo(ann.points[i].x * zoomScale, ann.points[i].y * zoomScale);
                    }
                    overlayCtx.stroke();
                }
                break;

            case "text":
                overlayCtx.fillStyle = ann.color;
                overlayCtx.font = `bold ${Math.round((ann.fontSize || 18) * zoomScale)}px Outfit, sans-serif`;
                overlayCtx.fillText(ann.text, x, y);
                break;

            case "stamp":
                const stampText = ann.text || "APROBADO";
                overlayCtx.font = `bold ${Math.round(18 * zoomScale)}px Outfit, sans-serif`;
                const textWidth = overlayCtx.measureText(stampText).width;
                const pWidth = textWidth + 28 * zoomScale;
                const pHeight = 42 * zoomScale;

                overlayCtx.fillStyle = ann.color === "#10b981" ? "rgba(16, 185, 129, 0.2)" : (ann.color === "#f59e0b" ? "rgba(245, 158, 11, 0.2)" : "rgba(239, 68, 68, 0.2)");
                overlayCtx.fillRect(x, y, pWidth, pHeight);
                overlayCtx.strokeStyle = ann.color;
                overlayCtx.lineWidth = 3 * zoomScale;
                overlayCtx.strokeRect(x, y, pWidth, pHeight);

                overlayCtx.fillStyle = ann.color;
                overlayCtx.fillText(stampText, x + 14 * zoomScale, y + 28 * zoomScale);
                break;
        }

        // Highlight selection border
        if (isSelected) {
            overlayCtx.strokeStyle = "#6366f1";
            overlayCtx.lineWidth = 2.5 * zoomScale;
            overlayCtx.setLineDash([6 * zoomScale, 6 * zoomScale]);
            if (ann.type === "circle") {
                overlayCtx.beginPath();
                overlayCtx.arc(x, y, r + 4 * zoomScale, 0, 2 * Math.PI);
                overlayCtx.stroke();
            } else {
                overlayCtx.strokeRect(x - 4 * zoomScale, y - 4 * zoomScale, w + 8 * zoomScale, h + 8 * zoomScale);
            }
            overlayCtx.setLineDash([]);
        }

        overlayCtx.restore();
    });
    overlayCtx.restore();
}

// Convert Mouse/Touch Client Coordinates to 1:1 Unscaled Canvas Coordinates
function getCanvasMouseCoords(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) / zoomScale,
        y: (e.clientY - rect.top) / zoomScale
    };
}

// MOUSE & TOUCH EVENT HANDLERS FOR CANVAS DRAWING AND PANNING
function handleCanvasMouseDown(e) {
    if (activeTool === 'pan' || e.button === 1 || isSpacePressed) return;

    const coords = getCanvasMouseCoords(e);
    startX = coords.x;
    startY = coords.y;

    if (activeTool === "select") {
        // Check hit testing
        const clickedAnn = annotations.slice().reverse().find(ann => {
            if (ann.type === "rect") {
                return startX >= ann.x && startX <= ann.x + ann.width && startY >= ann.y && startY <= ann.y + ann.height;
            } else if (ann.type === "circle") {
                const dist = Math.hypot(startX - ann.x, startY - ann.y);
                const r = typeof ann.radius === "number" ? ann.radius : 14;
                return dist <= (r + 4);
            } else if (ann.type === "stamp" || ann.type === "text") {
                return startX >= ann.x && startX <= ann.x + 140 && startY >= ann.y - 20 && startY <= ann.y + 45;
            }
            return false;
        });

        selectedAnnotationId = clickedAnn ? clickedAnn.id : null;
        renderOverlayAnnotations();
        updateAnnotationsListUI();
        return;
    }

    isDrawing = true;
    saveStateForUndo();

    if (activeTool === "draw") {
        currentFreehandPoints = [{ x: startX, y: startY }];
    } else if (activeTool === "text") {
        const textValue = prompt("Ingresa el texto o nota para la ubicación:", "Nota de revisión");
        if (textValue) {
            const activeUser = (typeof getCurrentUser === "function") ? getCurrentUser() : null;
            const creator = activeUser ? (activeUser.name || activeUser.username) : "Usuario";
            annotations.push({
                id: "ann_" + Date.now(),
                type: "text",
                page: currentPageNum,
                x: startX,
                y: startY,
                text: textValue,
                color: currentColor,
                fontSize: 18,
                createdBy: creator,
                createdById: activeUser ? activeUser.id : null,
                createdAt: new Date().toISOString()
            });
            renderOverlayAnnotations();
            updateAnnotationsListUI();
        }
        isDrawing = false;
    } else if (activeTool === "stamp") {
        const stampChoice = prompt("Selecciona Sello: 1. APROBADO, 2. REVISAR, 3. RECHAZADO", "1");
        let stampText = "APROBADO";
        let stampColor = "#10b981";
        if (stampChoice === "2") { stampText = "REVISAR"; stampColor = "#f59e0b"; }
        if (stampChoice === "3") { stampText = "RECHAZADO"; stampColor = "#ef4444"; }

        const activeUser = (typeof getCurrentUser === "function") ? getCurrentUser() : null;
        const creator = activeUser ? (activeUser.name || activeUser.username) : "Usuario";
        annotations.push({
            id: "ann_" + Date.now(),
            type: "stamp",
            page: currentPageNum,
            x: startX,
            y: startY,
            text: stampText,
            color: stampColor,
            createdBy: creator,
            createdById: activeUser ? activeUser.id : null,
            createdAt: new Date().toISOString()
        });
        renderOverlayAnnotations();
        updateAnnotationsListUI();
        isDrawing = false;
    }
}

function handleCanvasMouseMove(e) {
    if (!isDrawing) return;

    const coords = getCanvasMouseCoords(e);
    const currentX = coords.x;
    const currentY = coords.y;

    renderOverlayAnnotations();

    const dpr = window.devicePixelRatio || 1;
    overlayCtx.save();
    if (dpr !== 1) {
        overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    overlayCtx.strokeStyle = currentColor;
    overlayCtx.lineWidth = currentStrokeWidth * zoomScale;
    overlayCtx.fillStyle = getFillColorRGBA(currentColor, currentFill);

    const sX = startX * zoomScale;
    const sY = startY * zoomScale;
    const cX = currentX * zoomScale;
    const cY = currentY * zoomScale;

    if (activeTool === "rect") {
        const x = Math.min(sX, cX);
        const y = Math.min(sY, cY);
        const width = Math.abs(cX - sX);
        const height = Math.abs(cY - sY);
        overlayCtx.fillRect(x, y, width, height);
        overlayCtx.strokeRect(x, y, width, height);
    } else if (activeTool === "circle") {
        const radius = Math.hypot(cX - sX, cY - sY) / 2;
        const centerX = sX + (cX - sX) / 2;
        const centerY = sY + (cY - sY) / 2;
        overlayCtx.beginPath();
        overlayCtx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        overlayCtx.fill();
        overlayCtx.stroke();
    } else if (activeTool === "line") {
        overlayCtx.beginPath();
        overlayCtx.moveTo(sX, sY);
        overlayCtx.lineTo(cX, cY);
        overlayCtx.stroke();
    } else if (activeTool === "draw") {
        currentFreehandPoints.push({ x: currentX, y: currentY });
        overlayCtx.beginPath();
        overlayCtx.moveTo(currentFreehandPoints[0].x * zoomScale, currentFreehandPoints[0].y * zoomScale);
        for (let i = 1; i < currentFreehandPoints.length; i++) {
            overlayCtx.lineTo(currentFreehandPoints[i].x * zoomScale, currentFreehandPoints[i].y * zoomScale);
        }
        overlayCtx.stroke();
    }

    overlayCtx.restore();
}

function handleCanvasMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;

    const coords = getCanvasMouseCoords(e);
    const endX = coords.x;
    const endY = coords.y;

    const newId = "ann_" + Date.now();
    const activeUser = (typeof getCurrentUser === "function") ? getCurrentUser() : null;
    const creatorName = activeUser ? (activeUser.name || activeUser.username) : "Usuario";

    if (activeTool === "rect") {
        const dragW = Math.abs(endX - startX);
        const dragH = Math.abs(endY - startY);
        const isClick = (Math.max(dragW, dragH) * zoomScale < 3);
        const w = isClick ? Math.round(32 / zoomScale) : Math.max(1, dragW);
        const h = isClick ? Math.round(22 / zoomScale) : Math.max(1, dragH);
        const x = isClick ? (startX - w / 2) : Math.min(startX, endX);
        const y = isClick ? (startY - h / 2) : Math.min(startY, endY);

        annotations.push({
            id: newId,
            type: "rect",
            page: currentPageNum,
            x: x,
            y: y,
            width: w,
            height: h,
            color: currentColor,
            fillColor: getFillColorRGBA(currentColor, currentFill),
            strokeWidth: currentStrokeWidth,
            createdBy: creatorName,
            createdById: activeUser ? activeUser.id : null,
            createdAt: new Date().toISOString(),
            manzana: "",
            lote: ""
        });
    } else if (activeTool === "circle") {
        const dragDist = Math.hypot(endX - startX, endY - startY);
        const isClick = (dragDist * zoomScale < 3);
        const radius = isClick ? Math.round(14 / zoomScale) : Math.max(1, dragDist / 2);
        const centerX = isClick ? startX : (startX + (endX - startX) / 2);
        const centerY = isClick ? startY : (startY + (endY - startY) / 2);

        annotations.push({
            id: newId,
            type: "circle",
            page: currentPageNum,
            x: centerX,
            y: centerY,
            radius: radius,
            color: currentColor,
            fillColor: getFillColorRGBA(currentColor, currentFill),
            strokeWidth: currentStrokeWidth,
            createdBy: creatorName,
            createdById: activeUser ? activeUser.id : null,
            createdAt: new Date().toISOString(),
            manzana: "",
            lote: ""
        });
    } else if (activeTool === "line") {
        annotations.push({
            id: newId,
            type: "line",
            page: currentPageNum,
            x: startX,
            y: startY,
            endX: endX,
            endY: endY,
            color: currentColor,
            strokeWidth: currentStrokeWidth,
            createdBy: creatorName,
            createdById: activeUser ? activeUser.id : null,
            createdAt: new Date().toISOString(),
            manzana: "",
            lote: ""
        });
    } else if (activeTool === "draw") {
        annotations.push({
            id: newId,
            type: "draw",
            page: currentPageNum,
            points: currentFreehandPoints,
            color: currentColor,
            strokeWidth: currentStrokeWidth,
            createdBy: creatorName,
            createdById: activeUser ? activeUser.id : null,
            createdAt: new Date().toISOString(),
            manzana: "",
            lote: ""
        });
    }

    renderOverlayAnnotations();
    updateAnnotationsListUI();

    // Requerimiento 1: Inmediatamente al insertar una forma, abrir formulario de Manzana y Lote
    if (activeTool === "rect" || activeTool === "circle") {
        selectedAnnotationId = newId;
        renderOverlayAnnotations();
        openRenameShapeModal(newId);
    }
}

// Touch Support Handlers
function handleTouchStart(e) {
    if (e.touches.length === 1) {
        const touch = e.touches[0];
        handleCanvasMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
    }
}
function handleTouchMove(e) {
    if (e.touches.length === 1) {
        const touch = e.touches[0];
        handleCanvasMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
    }
}
function handleTouchEnd(e) {
    handleCanvasMouseUp({ clientX: startX, clientY: startY });
}

function getFillColorRGBA(hex, opacity) {
    if (opacity === 'transparent') return 'transparent';
    const r = parseInt(hex.slice(1, 3), 16) || 239;
    const g = parseInt(hex.slice(3, 5), 16) || 68;
    const b = parseInt(hex.slice(5, 7), 16) || 68;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function setActiveTool(tool) {
    activeTool = tool;
    document.querySelectorAll(".tools-group .tool-btn").forEach(btn => {
        if (btn.dataset.tool === tool) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
    updateCursorStyle();
}

function setColorPreset(hex) {
    currentColor = hex;
    document.getElementById("shape-color-picker").value = hex;
}

function updateSelectedToolStyle() {
    currentColor = document.getElementById("shape-color-picker").value;
    currentFill = document.getElementById("shape-fill-select").value;
    currentStrokeWidth = parseInt(document.getElementById("shape-stroke-select").value);
}

function saveStateForUndo() {
    undoStack.push(JSON.stringify(annotations));
    if (undoStack.length > 20) undoStack.shift();
    setHasUnsavedChanges(true);
}

function undoAnnotation() {
    if (undoStack.length > 0) {
        annotations = JSON.parse(undoStack.pop());
        renderOverlayAnnotations();
        updateAnnotationsListUI();
        showToast("Acción deshecha", "info");
    }
}

function deleteSelectedAnnotation() {
    if (!selectedAnnotationId) {
        showToast("Selecciona una forma o elemento primero.", "warning");
        return;
    }
    requestDeleteAnnotation(selectedAnnotationId);
}

// BUSCADOR MZ Y LT & CENTRADO EN CANVAS
let lastUsedManzana = "";
let lastUsedLote = "";

function matchesMzLtFilter(ann, mzQuery, ltQuery) {
    if (!mzQuery && !ltQuery) return true;

    const annMz = (ann.manzana || "").trim().toLowerCase();
    const annLt = (ann.lote || "").trim().toLowerCase();
    const label = (ann.label || "").trim().toLowerCase();

    let mzMatch = true;
    if (mzQuery) {
        if (annMz) {
            mzMatch = annMz.includes(mzQuery);
        } else {
            mzMatch = label.includes(`mz. ${mzQuery}`) || 
                      label.includes(`mz ${mzQuery}`) || 
                      label.includes(`mza ${mzQuery}`) || 
                      label.includes(`manzana ${mzQuery}`) ||
                      label.startsWith(mzQuery + " ") ||
                      label.startsWith(mzQuery + "-") ||
                      label === mzQuery;
        }
        if (!mzMatch && label.includes(mzQuery)) {
            mzMatch = true;
        }
    }

    let ltMatch = true;
    if (ltQuery) {
        if (annLt) {
            ltMatch = annLt.includes(ltQuery);
        } else {
            ltMatch = label.includes(`lt. ${ltQuery}`) || 
                      label.includes(`lt ${ltQuery}`) || 
                      label.includes(`lote ${ltQuery}`) ||
                      label.endsWith(" " + ltQuery) ||
                      label.endsWith("-" + ltQuery) ||
                      label.includes(" " + ltQuery + " ") ||
                      label === ltQuery;
        }
        if (!ltMatch && label.includes(ltQuery)) {
            ltMatch = true;
        }
    }

    return mzMatch && ltMatch;
}

function centerViewportOnAnnotation(ann) {
    if (!ann) return;
    const viewport = document.getElementById("canvas-viewport");
    if (!viewport) return;

    let targetX = ann.x;
    let targetY = ann.y;

    if (ann.type === "rect") {
        targetX = ann.x + (ann.width || 0) / 2;
        targetY = ann.y + (ann.height || 0) / 2;
    } else if (ann.type === "line") {
        targetX = (ann.x + (ann.endX || ann.x)) / 2;
        targetY = (ann.y + (ann.endY || ann.y)) / 2;
    }

    const screenX = targetX * zoomScale;
    const screenY = targetY * zoomScale;

    viewport.scrollTo({
        left: screenX - (viewport.clientWidth / 2),
        top: screenY - (viewport.clientHeight / 2),
        behavior: "smooth"
    });
}

function handleMzLtSearch() {
    updateAnnotationsListUI();
    const mzInput = document.getElementById("search-filter-mz");
    const ltInput = document.getElementById("search-filter-lt");
    const mz = mzInput ? mzInput.value.trim().toLowerCase() : "";
    const lt = ltInput ? ltInput.value.trim().toLowerCase() : "";

    if (mz || lt) {
        const matches = annotations.filter(ann => matchesMzLtFilter(ann, mz, lt));
        if (matches.length > 0) {
            selectedAnnotationId = matches[0].id;
            renderOverlayAnnotations();
            centerViewportOnAnnotation(matches[0]);
        }
    }
}

function clearMzLtSearch() {
    const mzInput = document.getElementById("search-filter-mz");
    const ltInput = document.getElementById("search-filter-lt");
    if (mzInput) mzInput.value = "";
    if (ltInput) ltInput.value = "";
    updateAnnotationsListUI();
    if (mzInput) mzInput.focus();
}

function updateAnnotationsListUI() {
    const listContainer = document.getElementById("annotations-list");
    const countTag = document.getElementById("annotation-count-tag");
    const mzInput = document.getElementById("search-filter-mz");
    const ltInput = document.getElementById("search-filter-lt");
    const mzQuery = mzInput ? mzInput.value.trim().toLowerCase() : "";
    const ltQuery = ltInput ? ltInput.value.trim().toLowerCase() : "";

    if (!listContainer) return;

    if (annotations.length === 0) {
        if (countTag) countTag.textContent = "0 elementos";
        listContainer.innerHTML = '<p class="empty-list-text">No hay elementos agregados aún. Usa la barra superior para insertar rectángulos, círculos, flechas o texto.</p>';
        return;
    }

    const filteredAnnotations = annotations.filter(ann => matchesMzLtFilter(ann, mzQuery, ltQuery));

    if (countTag) {
        if (mzQuery || ltQuery) {
            countTag.textContent = `${filteredAnnotations.length} de ${annotations.length}`;
        } else {
            countTag.textContent = `${annotations.length} elementos`;
        }
    }

    if (filteredAnnotations.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-list-text" style="padding: 22px 10px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <i data-lucide="search-x" style="width: 26px; height: 26px; color: var(--text-dim); margin-bottom: 2px;"></i>
                <span style="line-height: 1.4; font-size: 0.78rem;">No se encontraron formas con:<br>
                ${mzQuery ? `<b>MZ:</b> "${mzQuery.toUpperCase()}" ` : ''}
                ${ltQuery ? `<b>LT:</b> "${ltQuery.toUpperCase()}"` : ''}
                </span>
                <button type="button" class="btn btn-sm btn-secondary" onclick="clearMzLtSearch()" style="margin-top: 6px; font-size: 0.75rem; padding: 4px 10px;">
                    <i data-lucide="rotate-ccw" style="width: 12px; height: 12px;"></i> Limpiar filtro
                </button>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    listContainer.innerHTML = "";
    filteredAnnotations.forEach((ann, idx) => {
        const item = document.createElement("div");
        item.className = `annotation-item ${ann.id === selectedAnnotationId ? 'selected' : ''}`;
        
        let defaultTypeLabel = "Forma";
        let iconName = "square";
        if (ann.type === "rect") { defaultTypeLabel = `Rectángulo #${idx + 1}`; iconName = "square"; }
        if (ann.type === "circle") { defaultTypeLabel = `Círculo #${idx + 1}`; iconName = "circle"; }
        if (ann.type === "line") { defaultTypeLabel = `Flecha / Línea #${idx + 1}`; iconName = "move-up-right"; }
        if (ann.type === "text") { defaultTypeLabel = `Nota: "${ann.text.substring(0, 12)}..."`; iconName = "type"; }
        if (ann.type === "stamp") { defaultTypeLabel = `Sello: ${ann.text}`; iconName = "stamp"; }

        const displayLabel = ann.label || defaultTypeLabel;
        const creator = ann.createdBy || ann.createdByName || (activeDocument && (activeDocument.uploadedByName || activeDocument.uploadedBy)) || "Usuario";

        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px; flex:1; cursor:pointer; overflow:hidden;" onclick="selectAnnotationById('${ann.id}', true)">
                <i data-lucide="${iconName}" style="color:${ann.color}; width:16px; flex-shrink:0;"></i> 
                <div style="display:flex; flex-direction:column; overflow:hidden; min-width:0;">
                    <span style="font-weight:600; font-size:0.86rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${displayLabel}">${displayLabel}</span>
                    <span style="font-size:0.70rem; color:var(--text-muted); display:inline-flex; align-items:center; gap:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;" title="Insertado por ${creator}">
                        <i data-lucide="user" style="width:10px; height:10px; flex-shrink:0;"></i> ${creator}
                    </span>
                </div>
            </div>
            <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
                <button class="btn btn-icon btn-sm btn-secondary" title="Renombrar (Manzana / Lote)" onclick="event.stopPropagation(); openRenameShapeModal('${ann.id}')">
                    <i data-lucide="pencil" style="width:13px; height:13px;"></i>
                </button>
                <button class="btn btn-icon btn-sm btn-outline-danger" title="Eliminar elemento" onclick="event.stopPropagation(); requestDeleteAnnotation('${ann.id}')">&times;</button>
            </div>
        `;
        listContainer.appendChild(item);
    });

    if (window.lucide) lucide.createIcons();
}

function selectAnnotationById(id, shouldCenter = true) {
    selectedAnnotationId = id;
    renderOverlayAnnotations();
    updateAnnotationsListUI();
    if (shouldCenter) {
        const ann = annotations.find(a => a.id === id);
        if (ann) centerViewportOnAnnotation(ann);
    }
}

function openRenameShapeModal(id) {
    const ann = annotations.find(a => a.id === id);
    if (!ann) return;

    const idInput = document.getElementById("rename-shape-id");
    const manzanaInput = document.getElementById("rename-manzana");
    const loteInput = document.getElementById("rename-lote");
    const displayInput = document.getElementById("rename-label-display");

    if (idInput) idInput.value = ann.id;

    let manzanaVal = ann.manzana || "";
    let loteVal = ann.lote || "";
    let labelVal = ann.label || "";

    // Parse existing label if manzana/lote not yet set
    if (!manzanaVal && !loteVal && labelVal) {
        const match = labelVal.match(/(?:mz\.?|manzana\s*)?([a-zA-Z0-9]+)\s*[-_/\s]\s*(?:lt\.?|lote\s*)?([a-zA-Z0-9]+)/i);
        if (match) {
            manzanaVal = match[1];
            loteVal = match[2];
        } else {
            const parts = labelVal.trim().split(/\s+/);
            if (parts.length === 2) {
                manzanaVal = parts[0];
                loteVal = parts[1];
            }
        }
    }

    // Default to last used manzana if starting a fresh shape
    if (!manzanaVal && !labelVal && lastUsedManzana) {
        manzanaVal = lastUsedManzana;
    }

    if (manzanaInput) manzanaInput.value = manzanaVal;
    if (loteInput) loteInput.value = loteVal;
    if (displayInput) displayInput.value = labelVal || (manzanaVal && loteVal ? `${manzanaVal} ${loteVal}` : (manzanaVal ? `Mz. ${manzanaVal}` : ""));

    const modal = document.getElementById("rename-shape-modal");
    if (modal) modal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        if (manzanaInput) {
            manzanaInput.focus();
            if (manzanaVal) {
                if (loteInput && !loteVal) {
                    loteInput.focus();
                } else {
                    manzanaInput.select();
                }
            }
        }
    }, 80);
}

function closeRenameShapeModal() {
    const modal = document.getElementById("rename-shape-modal");
    if (modal) modal.classList.add("hidden");
}

function syncRenamePreview() {
    const manzana = document.getElementById("rename-manzana") ? document.getElementById("rename-manzana").value.trim() : "";
    const lote = document.getElementById("rename-lote") ? document.getElementById("rename-lote").value.trim() : "";
    const displayInput = document.getElementById("rename-label-display");
    if (!displayInput) return;

    if (manzana && lote) {
        displayInput.value = `${manzana} ${lote}`;
    } else if (manzana) {
        displayInput.value = `Mz. ${manzana}`;
    } else if (lote) {
        displayInput.value = `Lote ${lote}`;
    }
}

function handleSaveRenameShape(event) {
    if (event) event.preventDefault();
    const idInput = document.getElementById("rename-shape-id");
    if (!idInput) return;
    const id = idInput.value;
    const ann = annotations.find(a => a.id === id);
    if (!ann) {
        closeRenameShapeModal();
        return;
    }

    const manzana = document.getElementById("rename-manzana") ? document.getElementById("rename-manzana").value.trim() : "";
    const lote = document.getElementById("rename-lote") ? document.getElementById("rename-lote").value.trim() : "";
    const displayInput = document.getElementById("rename-label-display");
    const displayLabel = displayInput ? displayInput.value.trim() : "";

    saveStateForUndo();
    ann.manzana = manzana;
    ann.lote = lote;
    ann.label = displayLabel || (manzana && lote ? `${manzana} ${lote}` : (ann.label || "Forma"));

    if (manzana) lastUsedManzana = manzana;
    if (lote) lastUsedLote = lote;

    setHasUnsavedChanges(true);
    renderOverlayAnnotations();
    updateAnnotationsListUI();
    closeRenameShapeModal();
    showToast(`Elemento identificado como: "${ann.label}"`, "success");
}

function editAnnotationLabel(id) {
    openRenameShapeModal(id);
}

// MODAL DE CONFIRMACIÓN DE ELIMINACIÓN
let pendingDeleteAnnotationId = null;

function requestDeleteAnnotation(id) {
    const ann = annotations.find(a => a.id === id);
    if (!ann) return;

    pendingDeleteAnnotationId = id;

    // Resaltar elemento en el canvas y centrar vista para que el usuario verifique cuál es
    selectedAnnotationId = id;
    renderOverlayAnnotations();
    centerViewportOnAnnotation(ann);

    const modal = document.getElementById("confirm-delete-modal");
    const msgEl = document.getElementById("confirm-delete-message");
    
    const label = ann.label || (ann.type === "rect" ? "Rectángulo" : (ann.type === "circle" ? "Círculo" : "Elemento"));
    
    if (msgEl) {
        msgEl.innerHTML = `¿Estás seguro de que deseas eliminar <b>"${label}"</b>?<br><span style="font-size:0.80rem; opacity:0.8; display:inline-block; margin-top:4px;">Esta forma se removerá de las capas de edición del plano.</span>`;
    }

    if (modal) {
        modal.classList.remove("hidden");
        if (window.lucide) lucide.createIcons();
    }
}

function closeConfirmDeleteModal() {
    const modal = document.getElementById("confirm-delete-modal");
    if (modal) modal.classList.add("hidden");
    pendingDeleteAnnotationId = null;
}

function executeConfirmedDelete() {
    if (!pendingDeleteAnnotationId) {
        closeConfirmDeleteModal();
        return;
    }
    const idToDelete = pendingDeleteAnnotationId;
    closeConfirmDeleteModal();
    deleteAnnotationById(idToDelete);
}

function deleteAnnotationById(id) {
    const ann = annotations.find(a => a.id === id);
    const label = ann ? (ann.label || "Elemento") : "Elemento";

    saveStateForUndo();
    annotations = annotations.filter(a => a.id !== id);
    if (selectedAnnotationId === id) selectedAnnotationId = null;
    renderOverlayAnnotations();
    updateAnnotationsListUI();
    showToast(`Elemento "${label}" eliminado`, "info");
}

// Global modal esc / enter key listener
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const renameModal = document.getElementById("rename-shape-modal");
        if (renameModal && !renameModal.classList.contains("hidden")) {
            closeRenameShapeModal();
        }
        const delModal = document.getElementById("confirm-delete-modal");
        if (delModal && !delModal.classList.contains("hidden")) {
            closeConfirmDeleteModal();
        }
    } else if (e.key === "Enter") {
        const delModal = document.getElementById("confirm-delete-modal");
        if (delModal && !delModal.classList.contains("hidden")) {
            e.preventDefault();
            executeConfirmedDelete();
        }
    }
});

window.openRenameShapeModal = openRenameShapeModal;
window.closeRenameShapeModal = closeRenameShapeModal;
window.syncRenamePreview = syncRenamePreview;
window.handleSaveRenameShape = handleSaveRenameShape;
window.editAnnotationLabel = editAnnotationLabel;
window.handleMzLtSearch = handleMzLtSearch;
window.clearMzLtSearch = clearMzLtSearch;
window.centerViewportOnAnnotation = centerViewportOnAnnotation;
window.requestDeleteAnnotation = requestDeleteAnnotation;
window.closeConfirmDeleteModal = closeConfirmDeleteModal;
window.executeConfirmedDelete = executeConfirmedDelete;
window.deleteAnnotationById = deleteAnnotationById;
window.deleteSelectedAnnotation = deleteSelectedAnnotation;

// SAVE EDITS TO LOCAL STORAGE & AUDIT LOG
function saveCurrentEdits() {
    if (!activeDocument) return;

    const user = getCurrentUser();
    if (!user) {
        showToast("Debes iniciar sesión para guardar cambios", "error");
        return;
    }

    const docs = JSON.parse(localStorage.getItem("planos_documents") || "[]");
    const docIdx = docs.findIndex(d => d.id === activeDocument.id);

    if (docIdx !== -1) {
        docs[docIdx].annotations = annotations;
        docs[docIdx].lastEditedAt = new Date().toISOString();
        docs[docIdx].editsCount = (docs[docIdx].editsCount || 0) + 1;
        docs[docIdx].lastEditedBy = user.username;

        if (typeof saveDocumentsToStorage === "function") saveDocumentsToStorage(docs);
        else localStorage.setItem("planos_documents", JSON.stringify(docs));
        activeDocument = docs[docIdx];

        // Update User Edits Count
        const users = JSON.parse(localStorage.getItem("planos_users") || "[]");
        const uIdx = users.findIndex(u => u.id === user.id);
        if (uIdx !== -1) {
            users[uIdx].editsCount = (users[uIdx].editsCount || 0) + 1;
            if (typeof saveUsersToStorage === "function") saveUsersToStorage(users);
            else localStorage.setItem("planos_users", JSON.stringify(users));
        }

        // Add Audit Log Entry
        addAuditLog(
            "PDF_EDIT",
            `Edición guardada en plano: ${activeDocument.name}`,
            `Se actualizaron ${annotations.length} elementos/formas por el usuario ${user.name} (${user.role})`
        );

        showToast("¡Edición guardada y registrada en el historial!", "success");
        document.getElementById("editor-doc-badge").textContent = `Versión ${activeDocument.editsCount}`;
        setHasUnsavedChanges(false);

        if (window.renderDocumentsLibrary) window.renderDocumentsLibrary();
        if (window.renderAdminDashboard) window.renderAdminDashboard();
    }
}

// EXPORT NATIVE UNRASTERIZED PDF (VECTOR PRESERVATION)
async function exportAnnotatedPDF() {
    if (!activeDocument) return;

    showToast("Generando exportación PDF vectorial original...", "info");

    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        let pdfDocExport;

        let existingPdfBytes = activePdfArrayBuffer;
        if (!existingPdfBytes) {
            existingPdfBytes = await getPdfBinary(activeDocument.id);
        }
        if (!existingPdfBytes && activeDocument.pdfDataUrl) {
            existingPdfBytes = await fetch(activeDocument.pdfDataUrl).then(res => res.arrayBuffer());
        }

        if (existingPdfBytes) {
            pdfDocExport = await PDFDocument.load(existingPdfBytes);
        } else {
            pdfDocExport = await PDFDocument.create();
            pdfDocExport.addPage([1400, 950]);
        }

        const pages = pdfDocExport.getPages();
        const targetPage = pages[currentPageNum - 1] || pages[0];
        const { width, height } = targetPage.getSize();

        // Mapeo exacto a coordenadas nativas del PDF (independiente del zoom de pantalla o DPR)
        const unscaledW = currentPdfPageUnscaledWidth || 1400;
        const unscaledH = currentPdfPageUnscaledHeight || 950;
        const scaleX = width / unscaledW;
        const scaleY = height / unscaledH;

        // Embed Vector Annotations directly into native PDF Page
        annotations.forEach(ann => {
            if (ann.page && ann.page !== currentPageNum) return;

            const hex = ann.color || "#ef4444";
            const r = (parseInt(hex.slice(1, 3), 16) || 239) / 255;
            const g = (parseInt(hex.slice(3, 5), 16) || 68) / 255;
            const b = (parseInt(hex.slice(5, 7), 16) || 68) / 255;

            const x = ann.x * scaleX;
            const y = height - (ann.y * scaleY); // PDF coordinate origin is bottom-left
            const w = (ann.width || 0) * scaleX;
            const h = (ann.height || 0) * scaleY;

            if (ann.type === "rect") {
                targetPage.drawRectangle({
                    x: x,
                    y: y - h,
                    width: w,
                    height: h,
                    borderColor: rgb(r, g, b),
                    borderWidth: (ann.strokeWidth || 4) * scaleX,
                    opacity: 0.95
                });
                if (ann.label) {
                    targetPage.drawText(ann.label, {
                        x: x + 4,
                        y: y - (h / 2) - 3,
                        size: Math.max(7, Math.min(11, 9 * scaleX)),
                        color: rgb(r, g, b)
                    });
                }
            } else if (ann.type === "circle") {
                targetPage.drawEllipse({
                    x: x,
                    y: y,
                    xScale: (typeof ann.radius === 'number' ? ann.radius : 14) * scaleX,
                    yScale: (typeof ann.radius === 'number' ? ann.radius : 14) * scaleY,
                    borderColor: rgb(r, g, b),
                    borderWidth: (ann.strokeWidth || 4) * scaleX
                });
                if (ann.label) {
                    targetPage.drawText(ann.label, {
                        x: x - (ann.label.length * 2.8),
                        y: y - 3,
                        size: Math.max(7, Math.min(11, 9 * scaleX)),
                        color: rgb(r, g, b)
                    });
                }
            } else if (ann.type === "line") {
                targetPage.drawLine({
                    start: { x: x, y: y },
                    end: { x: ann.endX * scaleX, y: height - (ann.endY * scaleY) },
                    color: rgb(r, g, b),
                    thickness: (ann.strokeWidth || 4) * scaleX
                });
            } else if (ann.type === "draw" && ann.points && ann.points.length > 1) {
                for (let i = 0; i < ann.points.length - 1; i++) {
                    const p1 = ann.points[i];
                    const p2 = ann.points[i + 1];
                    targetPage.drawLine({
                        start: { x: p1.x * scaleX, y: height - (p1.y * scaleY) },
                        end: { x: p2.x * scaleX, y: height - (p2.y * scaleY) },
                        color: rgb(r, g, b),
                        thickness: (ann.strokeWidth || 3) * scaleX
                    });
                }
            } else if (ann.type === "text" || ann.type === "stamp") {
                targetPage.drawText(ann.text || "APROBADO", {
                    x: x,
                    y: y - 15,
                    size: (ann.fontSize || 18) * scaleX,
                    color: rgb(r, g, b)
                });
            }
        });

        const pdfBytes = await pdfDocExport.save();

        // Download Original Binary Blob
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `EDITADO_${activeDocument.name}`;
        link.click();

        showToast("PDF original vector exportado con éxito.", "success");
    } catch (e) {
        console.error("Error exporting PDF", e);
        showToast("Error al exportar el archivo PDF original", "error");
    }
}

// Zoom & Navigation Controls
function changePage(delta) {
    const newPage = currentPageNum + delta;
    if (newPage >= 1 && newPage <= totalPagesNum) {
        currentPageNum = newPage;
        document.getElementById("current-page-num").textContent = currentPageNum;
        if (pdfDoc) renderPdfPage(currentPageNum);
        else renderBlueprintBackground(activeDocument ? activeDocument.sampleType : "blueprint-arch");
    }
}

function zoomCanvas(delta) {
    const viewport = document.getElementById("canvas-viewport");
    const oldScale = zoomScale;
    const newScale = Math.max(0.2, Math.min(5.0, Math.round((zoomScale + delta) * 100) / 100));
    if (newScale === oldScale) return;

    // Preserve viewport center
    let centerNormX = 0.5;
    let centerNormY = 0.5;
    if (viewport && viewport.scrollWidth > 0 && viewport.scrollHeight > 0) {
        centerNormX = (viewport.scrollLeft + viewport.clientWidth / 2) / viewport.scrollWidth;
        centerNormY = (viewport.scrollTop + viewport.clientHeight / 2) / viewport.scrollHeight;
    }

    zoomScale = newScale;
    const zoomText = document.getElementById("zoom-percentage");
    if (zoomText) zoomText.textContent = `${Math.round(zoomScale * 100)}%`;

    if (pdfDoc) {
        renderPdfPage(currentPageNum);
    } else {
        renderBlueprintBackground(activeDocument ? activeDocument.sampleType : "blueprint-arch");
    }

    if (viewport) {
        requestAnimationFrame(() => {
            viewport.scrollLeft = (viewport.scrollWidth * centerNormX) - viewport.clientWidth / 2;
            viewport.scrollTop = (viewport.scrollHeight * centerNormY) - viewport.clientHeight / 2;
        });
    }
}

function zoomAroundPoint(delta, clientX, clientY) {
    const viewport = document.getElementById("canvas-viewport");
    if (!viewport) {
        zoomCanvas(delta);
        return;
    }

    const oldScale = zoomScale;
    const newScale = Math.max(0.2, Math.min(5.0, Math.round((zoomScale + delta) * 100) / 100));
    if (newScale === oldScale) return;

    const vRect = viewport.getBoundingClientRect();
    const mouseVX = clientX - vRect.left;
    const mouseVY = clientY - vRect.top;

    const contentX = (viewport.scrollLeft + mouseVX) / oldScale;
    const contentY = (viewport.scrollTop + mouseVY) / oldScale;

    zoomScale = newScale;
    const zoomText = document.getElementById("zoom-percentage");
    if (zoomText) zoomText.textContent = `${Math.round(zoomScale * 100)}%`;

    if (pdfDoc) {
        renderPdfPage(currentPageNum);
    } else {
        renderBlueprintBackground(activeDocument ? activeDocument.sampleType : "blueprint-arch");
    }

    requestAnimationFrame(() => {
        viewport.scrollLeft = contentX * newScale - mouseVX;
        viewport.scrollTop = contentY * newScale - mouseVY;
    });
}

function resetZoom() {
    zoomScale = 1.0;
    const zoomText = document.getElementById("zoom-percentage");
    if (zoomText) zoomText.textContent = "100%";

    if (pdfDoc) renderPdfPage(currentPageNum);
    else renderBlueprintBackground(activeDocument ? activeDocument.sampleType : "blueprint-arch");
}

function fitCanvasToWidth() {
    const viewport = document.getElementById("canvas-viewport");
    if (!viewport) return;
    
    const availableWidth = viewport.clientWidth - 56;
    const baseUnscaled = currentPdfPageUnscaledWidth || 1400;
    zoomScale = Math.max(0.2, Math.min(5.0, Math.round((availableWidth / baseUnscaled) * 100) / 100));
    
    const zoomText = document.getElementById("zoom-percentage");
    if (zoomText) zoomText.textContent = `${Math.round(zoomScale * 100)}%`;

    if (pdfDoc) renderPdfPage(currentPageNum);
    else renderBlueprintBackground(activeDocument ? activeDocument.sampleType : "blueprint-arch");
}

// TOGGLE APP SIDEBAR
function toggleAppSidebar() {
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
        const isCollapsed = sidebar.classList.contains("collapsed");
        toggleAppSidebarCollapse(!isCollapsed);
    }
}

function toggleAppSidebarCollapse(collapse) {
    const sidebar = document.querySelector(".sidebar");
    const icon1 = document.getElementById("sidebar-toggle-icon");
    const icon2 = document.getElementById("sidebar-toggle-icon-sidebar");
    if (sidebar) {
        if (collapse) sidebar.classList.add("collapsed");
        else sidebar.classList.remove("collapsed");
        
        if (icon1) icon1.setAttribute("data-lucide", collapse ? "panel-left-open" : "menu");
        if (icon2) icon2.setAttribute("data-lucide", collapse ? "panel-left-open" : "panel-left-close");
        if (window.lucide) lucide.createIcons();
    }
}

// TOGGLE ANNOTATIONS LAYERS SIDEBAR
function toggleAnnotationsSidebar() {
    const layersSidebar = document.getElementById("annotations-sidebar");
    const reopenBtn = document.getElementById("reopen-layers-btn");

    if (layersSidebar) {
        layersSidebar.classList.toggle("collapsed");
        const isCollapsed = layersSidebar.classList.contains("collapsed");
        if (reopenBtn) {
            if (isCollapsed) reopenBtn.classList.remove("hidden");
            else reopenBtn.classList.add("hidden");
        }
    }
}

// TOGGLE FULLSCREEN EDITOR MODE
function toggleEditorFullscreen() {
    const editorView = document.getElementById("view-editor");
    const icon = document.getElementById("fullscreen-toggle-icon");

    if (editorView) {
        editorView.classList.toggle("fullscreen");
        const isFullscreen = editorView.classList.contains("fullscreen");
        if (icon) icon.setAttribute("data-lucide", isFullscreen ? "shrink" : "expand");
        if (window.lucide) lucide.createIcons();
        
        setTimeout(fitCanvasToWidth, 200);
        showToast(isFullscreen ? "Modo Pantalla Completa activado (Presiona ESC para salir)" : "Modo estándar", "info");
    }
}

// ESC KEY LISTENER TO EXIT FULLSCREEN
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        const editorView = document.getElementById("view-editor");
        if (editorView && editorView.classList.contains("fullscreen")) {
            toggleEditorFullscreen();
        }
    }
});
