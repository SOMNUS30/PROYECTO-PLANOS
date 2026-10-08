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

let activeTool = 'select'; // select, pan, rect, circle, line, draw, text, stamp
let currentColor = '#ef4444';
let currentFill = '0.2';
let currentStrokeWidth = 4;

let annotations = []; // Array of annotation objects for active document
let selectedAnnotationId = null;
let undoStack = [];

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
    }

    // SPACEBAR PAN DETECTOR
    document.addEventListener("keydown", (e) => {
        if (e.code === "Space" && !isSpacePressed) {
            const activeView = document.querySelector(".app-view.active-view");
            if (activeView && activeView.id === "view-editor") {
                isSpacePressed = true;
                updateCursorStyle();
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
    currentPageNum = 1;
    zoomScale = 1.0;
    activePdfArrayBuffer = null;

    document.body.classList.add("in-editor-mode");

    // Fetch binary buffer from IndexedDB first (no localStorage quota limit)
    const binaryBuffer = await getPdfBinary(activeDocument.id);
    if (binaryBuffer) {
        loadPdfFromArrayBuffer(binaryBuffer);
    } else if (activeDocument.pdfDataUrl) {
        loadPdfFromDataUrl(activeDocument.pdfDataUrl);
    } else {
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

    const baseWidth = Math.round(1400 * zoomScale);
    const baseHeight = Math.round(950 * zoomScale);

    pdfCanvas.width = baseWidth;
    pdfCanvas.height = baseHeight;
    overlayCanvas.width = baseWidth;
    overlayCanvas.height = baseHeight;

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
        activePdfRenderTask.cancel();
        activePdfRenderTask = null;
    }

    pdfDoc.getPage(pageNum).then(page => {
        const viewport = page.getViewport({ scale: 2.0 * zoomScale });
        
        pdfCanvas.width = Math.round(viewport.width);
        pdfCanvas.height = Math.round(viewport.height);
        overlayCanvas.width = pdfCanvas.width;
        overlayCanvas.height = pdfCanvas.height;

        pdfCtx.imageSmoothingEnabled = true;
        pdfCtx.imageSmoothingQuality = 'high';

        const renderContext = {
            canvasContext: pdfCtx,
            viewport: viewport
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
    });
}

// Render Annotation Shapes on top of PDF Canvas
function renderOverlayAnnotations() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

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
        const r = (ann.radius || 35) * zoomScale;

        switch (ann.type) {
            case "rect":
                overlayCtx.fillRect(x, y, w, h);
                overlayCtx.strokeRect(x, y, w, h);
                if (ann.label) {
                    overlayCtx.fillStyle = ann.color;
                    overlayCtx.font = `bold ${Math.round(16 * zoomScale)}px Outfit, sans-serif`;
                    overlayCtx.fillText(ann.label, x + 5 * zoomScale, y - 8 * zoomScale);
                }
                break;

            case "circle":
                overlayCtx.beginPath();
                overlayCtx.arc(x, y, r, 0, 2 * Math.PI);
                overlayCtx.fill();
                overlayCtx.stroke();
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
            overlayCtx.strokeRect(x - 6 * zoomScale, y - 6 * zoomScale, w + 12 * zoomScale, h + 12 * zoomScale);
            overlayCtx.setLineDash([]);
        }

        overlayCtx.restore();
    });
}

// Convert Mouse/Touch Client Coordinates to 1:1 Unscaled Canvas Coordinates
function getCanvasMouseCoords(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    return {
        x: ((e.clientX - rect.left) * scaleX) / zoomScale,
        y: ((e.clientY - rect.top) * scaleY) / zoomScale
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
                return dist <= (ann.radius || 35);
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
            annotations.push({
                id: "ann_" + Date.now(),
                type: "text",
                page: currentPageNum,
                x: startX,
                y: startY,
                text: textValue,
                color: currentColor,
                fontSize: 18
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

        annotations.push({
            id: "ann_" + Date.now(),
            type: "stamp",
            page: currentPageNum,
            x: startX,
            y: startY,
            text: stampText,
            color: stampColor
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

    overlayCtx.save();
    overlayCtx.strokeStyle = currentColor;
    overlayCtx.lineWidth = currentStrokeWidth * zoomScale;
    overlayCtx.fillStyle = getFillColorRGBA(currentColor, currentFill);

    const sX = startX * zoomScale;
    const sY = startY * zoomScale;
    const cX = currentX * zoomScale;
    const cY = currentY * zoomScale;

    if (activeTool === "rect") {
        const width = cX - sX;
        const height = cY - sY;
        overlayCtx.fillRect(sX, sY, width, height);
        overlayCtx.strokeRect(sX, sY, width, height);
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

    if (activeTool === "rect") {
        const w = Math.abs(endX - startX) || 120;
        const h = Math.abs(endY - startY) || 80;
        annotations.push({
            id: newId,
            type: "rect",
            page: currentPageNum,
            x: Math.min(startX, endX),
            y: Math.min(startY, endY),
            width: w,
            height: h,
            color: currentColor,
            fillColor: getFillColorRGBA(currentColor, currentFill),
            strokeWidth: currentStrokeWidth
        });
    } else if (activeTool === "circle") {
        const radius = Math.max(20, Math.hypot(endX - startX, endY - startY) / 2);
        annotations.push({
            id: newId,
            type: "circle",
            page: currentPageNum,
            x: startX + (endX - startX) / 2,
            y: startY + (endY - startY) / 2,
            radius: radius,
            color: currentColor,
            fillColor: getFillColorRGBA(currentColor, currentFill),
            strokeWidth: currentStrokeWidth
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
            strokeWidth: currentStrokeWidth
        });
    } else if (activeTool === "draw") {
        annotations.push({
            id: newId,
            type: "draw",
            page: currentPageNum,
            points: currentFreehandPoints,
            color: currentColor,
            strokeWidth: currentStrokeWidth
        });
    }

    renderOverlayAnnotations();
    updateAnnotationsListUI();
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
    saveStateForUndo();
    annotations = annotations.filter(a => a.id !== selectedAnnotationId);
    selectedAnnotationId = null;
    renderOverlayAnnotations();
    updateAnnotationsListUI();
    showToast("Elemento eliminado", "info");
}

function updateAnnotationsListUI() {
    const listContainer = document.getElementById("annotations-list");
    document.getElementById("annotation-count-tag").textContent = `${annotations.length} elementos`;

    if (annotations.length === 0) {
        listContainer.innerHTML = '<p class="empty-list-text">No hay elementos agregados aún. Usa la barra superior para insertar rectángulos, círculos, flechas o texto.</p>';
        return;
    }

    listContainer.innerHTML = "";
    annotations.forEach((ann, idx) => {
        const item = document.createElement("div");
        item.className = `annotation-item ${ann.id === selectedAnnotationId ? 'selected' : ''}`;
        
        let typeLabel = "Forma";
        let iconName = "square";
        if (ann.type === "rect") { typeLabel = `Rectángulo #${idx + 1}`; iconName = "square"; }
        if (ann.type === "circle") { typeLabel = `Círculo #${idx + 1}`; iconName = "circle"; }
        if (ann.type === "line") { typeLabel = `Flecha / Línea #${idx + 1}`; iconName = "move-up-right"; }
        if (ann.type === "text") { typeLabel = `Nota: "${ann.text.substring(0, 10)}..."`; iconName = "type"; }
        if (ann.type === "stamp") { typeLabel = `Sello: ${ann.text}`; iconName = "stamp"; }

        item.innerHTML = `
            <span><i data-lucide="${iconName}" style="color:${ann.color}; width:16px;"></i> ${typeLabel}</span>
            <button class="btn btn-icon btn-sm" onclick="event.stopPropagation(); deleteAnnotationById('${ann.id}')">&times;</button>
        `;
        item.onclick = () => {
            selectedAnnotationId = ann.id;
            renderOverlayAnnotations();
            updateAnnotationsListUI();
        };
        listContainer.appendChild(item);
    });

    if (window.lucide) lucide.createIcons();
}

function deleteAnnotationById(id) {
    saveStateForUndo();
    annotations = annotations.filter(a => a.id !== id);
    if (selectedAnnotationId === id) selectedAnnotationId = null;
    renderOverlayAnnotations();
    updateAnnotationsListUI();
}

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

        localStorage.setItem("planos_documents", JSON.stringify(docs));
        activeDocument = docs[docIdx];

        // Update User Edits Count
        const users = JSON.parse(localStorage.getItem("planos_users") || "[]");
        const uIdx = users.findIndex(u => u.id === user.id);
        if (uIdx !== -1) {
            users[uIdx].editsCount = (users[uIdx].editsCount || 0) + 1;
            localStorage.setItem("planos_users", JSON.stringify(users));
        }

        // Add Audit Log Entry
        addAuditLog(
            "PDF_EDIT",
            `Edición guardada en plano: ${activeDocument.name}`,
            `Se actualizaron ${annotations.length} elementos/formas por el usuario ${user.name} (${user.role})`
        );

        showToast("¡Edición guardada y registrada en el historial!", "success");
        document.getElementById("editor-doc-badge").textContent = `Versión ${activeDocument.editsCount}`;

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

        // Scale ratio from Canvas coordinates to PDF Page coordinates
        const scaleX = width / pdfCanvas.width;
        const scaleY = height / pdfCanvas.height;

        // Embed Vector Annotations directly into native PDF Page
        annotations.forEach(ann => {
            if (ann.page && ann.page !== currentPageNum) return;

            const hex = ann.color || "#ef4444";
            const r = (parseInt(hex.slice(1, 3), 16) || 239) / 255;
            const g = (parseInt(hex.slice(3, 5), 16) || 68) / 255;
            const b = (parseInt(hex.slice(5, 7), 16) || 68) / 255;

            const x = ann.x * zoomScale * scaleX;
            const y = height - (ann.y * zoomScale * scaleY); // PDF coordinate origin is bottom-left
            const w = (ann.width || 0) * zoomScale * scaleX;
            const h = (ann.height || 0) * zoomScale * scaleY;

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
            } else if (ann.type === "circle") {
                targetPage.drawEllipse({
                    x: x,
                    y: y,
                    xScale: (ann.radius || 35) * zoomScale * scaleX,
                    yScale: (ann.radius || 35) * zoomScale * scaleY,
                    borderColor: rgb(r, g, b),
                    borderWidth: (ann.strokeWidth || 4) * scaleX
                });
            } else if (ann.type === "line") {
                targetPage.drawLine({
                    start: { x: x, y: y },
                    end: { x: ann.endX * zoomScale * scaleX, y: height - (ann.endY * zoomScale * scaleY) },
                    color: rgb(r, g, b),
                    thickness: (ann.strokeWidth || 4) * scaleX
                });
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
    zoomScale = Math.max(0.4, Math.min(3.0, zoomScale + delta));
    const zoomText = document.getElementById("zoom-percentage");
    if (zoomText) zoomText.textContent = `${Math.round(zoomScale * 100)}%`;

    if (pdfDoc) renderPdfPage(currentPageNum);
    else renderBlueprintBackground(activeDocument ? activeDocument.sampleType : "blueprint-arch");
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
    
    const availableWidth = viewport.clientWidth - 48;
    const baseUnscaled = 1400;
    zoomScale = Math.max(0.4, Math.min(2.8, (availableWidth / baseUnscaled)));
    
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
    const icon = document.getElementById("sidebar-toggle-icon");
    if (sidebar) {
        if (collapse) sidebar.classList.add("collapsed");
        else sidebar.classList.remove("collapsed");
        if (icon) icon.setAttribute("data-lucide", collapse ? "panel-left-open" : "panel-left-close");
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
