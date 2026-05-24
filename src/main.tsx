import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import "./styles.css";

type Tool = "pencil" | "eraser" | "eyedropper" | "bucket" | "rectangle" | "line" | "replace" | "lighten" | "darken";
type RectMode = "fill" | "outline" | "erase";
type Point = { x: number; y: number };
type Frame = {
  id: string;
  layers: ImageData[];
};
type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked?: boolean;
};
type Palette = {
  id: string;
  name: string;
  colors: string[];
  locked?: boolean;
};
type ProjectFile = {
  app: "Perfect Pixels" | "Pixel Frame Editor";
  version: 1;
  sheetName: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  fps: number;
  activeIndex: number;
  customPalettes: Palette[];
  activePaletteId: string;
  layers?: Layer[];
  frames: Array<string | string[]>;
};
type ProjectWritableFileStream = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
};
type ProjectFileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<ProjectWritableFileStream>;
};
type ProjectOrigin = "new" | "saved" | "imported" | "restored";
type UnsavedDecision = "save" | "discard" | "cancel";
type ExportPreset = "current-frame" | "sheet-horizontal" | "sheet-vertical" | "gif-preview" | "frames-zip";
type ToolShortcuts = Record<Tool, string>;

const DEFAULT_FRAME_SIZE = 48;
const DEFAULT_LAYERS: Layer[] = [{ id: "layer-1", name: "图层 1", visible: true, locked: false }];
const DEFAULT_PALETTE_ID = "project-basic";
const CUSTOM_PALETTES_KEY = "pixel-frame-editor-palettes";
const TOOL_SHORTCUTS_KEY = "perfect-pixels-tool-shortcuts";
const AUTOSAVE_KEY = "perfect-pixels-autosave-v1";
const AUTOSAVE_INTERVAL_MS = 10000;
const DEFAULT_TOOL_SHORTCUTS: ToolShortcuts = {
  pencil: "b",
  eraser: "e",
  eyedropper: "i",
  bucket: "g",
  rectangle: "r",
  line: "l",
  replace: "x",
  lighten: "o",
  darken: "p",
};
const GRID_PRESETS = [1, 2, 4, 8, 12, 16, 24, 32];
const TOOL_DEFS: Array<{ id: Tool; label: string; icon: string }> = [
  { id: "pencil", label: "画笔", icon: "✎" },
  { id: "eraser", label: "橡皮", icon: "⌫" },
  { id: "eyedropper", label: "吸管", icon: "◉" },
  { id: "bucket", label: "颜料桶", icon: "▣" },
  { id: "rectangle", label: "矩形", icon: "□" },
  { id: "line", label: "直线", icon: "／" },
  { id: "replace", label: "替换同色", icon: "⇄" },
  { id: "lighten", label: "提亮", icon: "☼" },
  { id: "darken", label: "压暗", icon: "◐" },
];
const EXPORT_PRESET_LABELS: Record<ExportPreset, string> = {
  "current-frame": "当前帧 PNG",
  "sheet-horizontal": "横向 Sprite Sheet",
  "sheet-vertical": "纵向 Sprite Sheet",
  "gif-preview": "GIF 预览",
  "frames-zip": "每帧单独 PNG",
};
const DEFAULT_PALETTES: Palette[] = [
  {
    id: DEFAULT_PALETTE_ID,
    name: "基础调色盘",
    locked: true,
    colors: [
      "#000000", "#1b1f2a", "#2f3748", "#596070", "#ffffff", "#c7d0dd", "#8d96a8", "#5a463d",
      "#2b1d1b", "#6d2d2d", "#a9473b", "#d48658", "#e8c170", "#7b8f42", "#3f6f52", "#24545f",
      "#43f0d2", "#24a7b5", "#3662a3", "#6f4bb3", "#ff00ff", "#f2e6c9", "#9b6b43", "#59351f",
    ],
  },
  {
    id: "anime-jp",
    name: "日式二次元",
    locked: true,
    colors: [
      "#1f1f2e", "#3a2d4f", "#684b8f", "#9a6fd8", "#f2d7ee", "#fff4fb", "#f6b7d2", "#e86fa3",
      "#f76f8e", "#ffb3a7", "#ffe2c6", "#fff0dc", "#f7d56e", "#b6e37a", "#67c77f", "#3c9d8f",
      "#7fe4ff", "#4aa3ff", "#3763d8", "#2b3a8f", "#f5f7ff", "#d9e2ff", "#9da8c7", "#5e647a",
    ],
  },
  {
    id: "classic-pixel-game",
    name: "经典像素游戏",
    locked: true,
    colors: [
      "#0f0f1b", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a",
      "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74",
      "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#696a6a",
    ],
  },
  {
    id: "google-ui",
    name: "Google UI",
    locked: true,
    colors: [
      "#202124", "#3c4043", "#5f6368", "#9aa0a6", "#dadce0", "#f1f3f4", "#ffffff", "#4285f4",
      "#1a73e8", "#8ab4f8", "#34a853", "#188038", "#81c995", "#fbbc04", "#f9ab00", "#fde293",
      "#ea4335", "#d93025", "#f28b82", "#a142f4", "#9334e6", "#d7aefb", "#24c1e0", "#12b5cb",
    ],
  },
];

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function makeBlankImageData(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = get2d(canvas);
  return ctx.createImageData(width, height);
}

function makeBlankFrame(width: number, height: number, layerCount = 1): Frame {
  return {
    id: makeId(),
    layers: Array.from({ length: layerCount }, () => makeBlankImageData(width, height)),
  };
}

function get2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas 2D context is not available.");
  }
  return ctx;
}

function imageDataToCanvas(imageData: ImageData) {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  get2d(canvas).putImageData(imageData, 0, 0);
  return canvas;
}

function dataUrlToImageData(dataUrl: string) {
  return new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = get2d(canvas);
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error("Cannot load project frame image."));
    img.src = dataUrl;
  });
}

function cloneImageData(imageData: ImageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function cloneFrame(frame: Frame): Frame {
  return { id: frame.id, layers: frame.layers.map(cloneImageData) };
}

function cloneLayers(layers: Layer[]) {
  return layers.map((layer) => ({ ...layer }));
}

function compositeFrame(frame: Frame, layers: Layer[], soloLayerIndex: number | null = null) {
  const firstLayer = frame.layers[0];
  const canvas = document.createElement("canvas");
  canvas.width = firstLayer.width;
  canvas.height = firstLayer.height;
  const ctx = get2d(canvas);
  frame.layers.forEach((layerImageData, index) => {
    if ((soloLayerIndex === null && layers[index]?.visible !== false) || soloLayerIndex === index) {
      ctx.drawImage(imageDataToCanvas(layerImageData), 0, 0);
    }
  });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function mirrorImageDataHorizontally(imageData: ImageData) {
  const mirrored = makeBlankImageData(imageData.width, imageData.height);
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const sourceIndex = (y * imageData.width + x) * 4;
      const targetIndex = (y * imageData.width + (imageData.width - 1 - x)) * 4;
      mirrored.data[targetIndex] = imageData.data[sourceIndex];
      mirrored.data[targetIndex + 1] = imageData.data[sourceIndex + 1];
      mirrored.data[targetIndex + 2] = imageData.data[sourceIndex + 2];
      mirrored.data[targetIndex + 3] = imageData.data[sourceIndex + 3];
    }
  }
  return mirrored;
}

function resizeImageData(imageData: ImageData, width: number, height: number) {
  const resized = makeBlankImageData(width, height);
  const copyWidth = Math.min(imageData.width, width);
  const copyHeight = Math.min(imageData.height, height);
  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      const sourceIndex = (y * imageData.width + x) * 4;
      const targetIndex = (y * width + x) * 4;
      resized.data[targetIndex] = imageData.data[sourceIndex];
      resized.data[targetIndex + 1] = imageData.data[sourceIndex + 1];
      resized.data[targetIndex + 2] = imageData.data[sourceIndex + 2];
      resized.data[targetIndex + 3] = imageData.data[sourceIndex + 3];
    }
  }
  return resized;
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function normalizeLayers(layers: Layer[]) {
  return layers.map((layer, index) => ({
    id: layer.id || makeId(),
    name: layer.name || DEFAULT_LAYERS[index]?.name || `图层 ${index + 1}`,
    visible: layer.visible !== false,
    locked: Boolean(layer.locked),
  }));
}

function guessSliceSettings(sheetWidth: number, sheetHeight: number, fallbackWidth: number, fallbackHeight: number) {
  const defaultFits = sheetWidth % DEFAULT_FRAME_SIZE === 0 && sheetHeight % DEFAULT_FRAME_SIZE === 0;
  if (defaultFits) {
    return {
      width: DEFAULT_FRAME_SIZE,
      height: DEFAULT_FRAME_SIZE,
      columns: Math.max(1, sheetWidth / DEFAULT_FRAME_SIZE),
      rows: Math.max(1, sheetHeight / DEFAULT_FRAME_SIZE),
    };
  }

  if (sheetWidth > sheetHeight && sheetWidth % sheetHeight === 0) {
    return {
      width: sheetHeight,
      height: sheetHeight,
      columns: Math.max(1, sheetWidth / sheetHeight),
      rows: 1,
    };
  }

  const width = Math.max(1, fallbackWidth);
  const height = Math.max(1, fallbackHeight);
  return {
    width,
    height,
    columns: Math.max(1, Math.floor(sheetWidth / width)),
    rows: Math.max(1, Math.floor(sheetHeight / height)),
  };
}

function hexToRgba(hex: string) {
  const clean = hex.replace("#", "");
  if (![3, 6].includes(clean.length)) return null;
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return null;
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
    a: 255,
  };
}

function rgbaToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeHex(hex: string) {
  const rgba = hexToRgba(hex);
  return rgba ? rgbaToHex(rgba.r, rgba.g, rgba.b) : "#000000";
}

function loadCustomPalettes() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_PALETTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Palette[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((palette) => typeof palette.id === "string" && typeof palette.name === "string" && Array.isArray(palette.colors))
      .map((palette) => ({
        id: palette.id,
        name: palette.name,
        locked: false,
        colors: palette.colors.filter((item) => typeof item === "string").map(normalizeHex),
      }));
  } catch {
    return [];
  }
}

function normalizeShortcutKey(value: string) {
  return value.trim().slice(0, 1).toLowerCase();
}

function loadToolShortcuts(): ToolShortcuts {
  try {
    const raw = window.localStorage.getItem(TOOL_SHORTCUTS_KEY);
    if (!raw) return DEFAULT_TOOL_SHORTCUTS;
    const parsed = JSON.parse(raw) as Partial<ToolShortcuts>;
    return TOOL_DEFS.reduce<ToolShortcuts>((shortcuts, toolDef) => {
      shortcuts[toolDef.id] = normalizeShortcutKey(parsed[toolDef.id] ?? DEFAULT_TOOL_SHORTCUTS[toolDef.id]);
      return shortcuts;
    }, { ...DEFAULT_TOOL_SHORTCUTS });
  } catch {
    return DEFAULT_TOOL_SHORTCUTS;
  }
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png") {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed."));
    }, type);
  });
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(items: number[], value: number) {
  items.push(value & 255, (value >>> 8) & 255);
}

function writeUint32(items: number[], value: number) {
  items.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

function makeZip(files: Array<{ name: string; bytes: Uint8Array }>) {
  const output: number[] = [];
  const centralDirectory: number[] = [];
  files.forEach((file) => {
    const nameBytes = encodeUtf8(file.name);
    const offset = output.length;
    const checksum = crc32(file.bytes);
    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0x0800);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, checksum);
    writeUint32(output, file.bytes.length);
    writeUint32(output, file.bytes.length);
    writeUint16(output, nameBytes.length);
    writeUint16(output, 0);
    output.push(...nameBytes, ...file.bytes);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0x0800);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, checksum);
    writeUint32(centralDirectory, file.bytes.length);
    writeUint32(centralDirectory, file.bytes.length);
    writeUint16(centralDirectory, nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, offset);
    centralDirectory.push(...nameBytes);
  });

  const centralOffset = output.length;
  output.push(...centralDirectory);
  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, files.length);
  writeUint16(output, files.length);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralOffset);
  writeUint16(output, 0);
  return new Blob([new Uint8Array(output)], { type: "application/zip" });
}

function getPixel(imageData: ImageData, x: number, y: number) {
  const index = (y * imageData.width + x) * 4;
  const data = imageData.data;
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3],
  };
}

function setPixel(imageData: ImageData, x: number, y: number, color: { r: number; g: number; b: number; a: number }) {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return;
  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = color.r;
  imageData.data[index + 1] = color.g;
  imageData.data[index + 2] = color.b;
  imageData.data[index + 3] = color.a;
}

function sameColor(a: { r: number; g: number; b: number; a: number }, b: { r: number; g: number; b: number; a: number }) {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function drawChecker(ctx: CanvasRenderingContext2D, width: number, height: number, cell: number) {
  ctx.fillStyle = "#f7f8fa";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#d7dbe2";
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      if ((x / cell + y / cell) % 2 === 0) {
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
}

function applyBrush(
  imageData: ImageData,
  x: number,
  y: number,
  size: number,
  color: { r: number; g: number; b: number; a: number },
) {
  const startX = x - Math.floor(size / 2);
  const startY = y - Math.floor(size / 2);
  for (let py = startY; py < startY + size; py += 1) {
    for (let px = startX; px < startX + size; px += 1) {
      setPixel(imageData, px, py, color);
    }
  }
}

function adjustColor(
  imageData: ImageData,
  x: number,
  y: number,
  size: number,
  amount: number,
) {
  const startX = x - Math.floor(size / 2);
  const startY = y - Math.floor(size / 2);
  for (let py = startY; py < startY + size; py += 1) {
    for (let px = startX; px < startX + size; px += 1) {
      if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) continue;
      const pixel = getPixel(imageData, px, py);
      if (pixel.a === 0) continue;
      setPixel(imageData, px, py, {
        r: Math.max(0, Math.min(255, pixel.r + amount)),
        g: Math.max(0, Math.min(255, pixel.g + amount)),
        b: Math.max(0, Math.min(255, pixel.b + amount)),
        a: pixel.a,
      });
    }
  }
}

function drawLine(
  imageData: ImageData,
  start: Point,
  end: Point,
  color: { r: number; g: number; b: number; a: number },
  size: number,
) {
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;

  while (true) {
    applyBrush(imageData, x0, y0, size, color);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function applyRectangle(
  imageData: ImageData,
  start: { x: number; y: number },
  end: { x: number; y: number },
  mode: RectMode,
  color: { r: number; g: number; b: number; a: number },
) {
  const minX = Math.max(0, Math.min(start.x, end.x));
  const maxX = Math.min(imageData.width - 1, Math.max(start.x, end.x));
  const minY = Math.max(0, Math.min(start.y, end.y));
  const maxY = Math.min(imageData.height - 1, Math.max(start.y, end.y));
  const paintColor = mode === "erase" ? { r: 0, g: 0, b: 0, a: 0 } : color;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const isBorder = x === minX || x === maxX || y === minY || y === maxY;
      if (mode !== "outline" || isBorder) {
        setPixel(imageData, x, y, paintColor);
      }
    }
  }
}

function App() {
  const [frames, setFrames] = useState<Frame[]>(() => [makeBlankFrame(DEFAULT_FRAME_SIZE, DEFAULT_FRAME_SIZE)]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [layers, setLayers] = useState<Layer[]>(DEFAULT_LAYERS);
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  const [frameWidth, setFrameWidth] = useState(DEFAULT_FRAME_SIZE);
  const [frameHeight, setFrameHeight] = useState(DEFAULT_FRAME_SIZE);
  const [columns, setColumns] = useState(4);
  const [rows, setRows] = useState(1);
  const [zoom, setZoom] = useState(12);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState("#43f0d2");
  const [brushSize, setBrushSize] = useState(1);
  const [rectMode, setRectMode] = useState<RectMode>("fill");
  const [customPalettes, setCustomPalettes] = useState<Palette[]>(loadCustomPalettes);
  const [activePaletteId, setActivePaletteId] = useState(DEFAULT_PALETTE_ID);
  const [newPaletteName, setNewPaletteName] = useState("自定义调色盘");
  const [autoAddPickedColor, setAutoAddPickedColor] = useState(true);
  const [fps, setFps] = useState(8);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [gridSize, setGridSize] = useState(1);
  const [showOnion, setShowOnion] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [exportPreset, setExportPreset] = useState<ExportPreset>("sheet-horizontal");
  const [toolShortcuts, setToolShortcuts] = useState<ToolShortcuts>(loadToolShortcuts);
  const [history, setHistory] = useState<Frame[][]>([]);
  const [sourceSheet, setSourceSheet] = useState<ImageData | null>(null);
  const [sheetName, setSheetName] = useState("edited_sprite_sheet");
  const [projectFileName, setProjectFileName] = useState<string | null>(null);
  const [projectFileBound, setProjectFileBound] = useState(false);
  const [projectOrigin, setProjectOrigin] = useState<ProjectOrigin>("new");
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
  const [unsavedPrompt, setUnsavedPrompt] = useState<{ message: string } | null>(null);
  const [exportStatus, setExportStatus] = useState("");
  const [draggedFrameIndex, setDraggedFrameIndex] = useState<number | null>(null);
  const [draggedLayerIndex, setDraggedLayerIndex] = useState<number | null>(null);
  const [soloLayerIndex, setSoloLayerIndex] = useState<number | null>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  const projectFileHandleRef = useRef<ProjectFileHandle | null>(null);
  const unsavedPromptResolveRef = useRef<((decision: UnsavedDecision) => void) | null>(null);
  const shouldCaptureCleanSnapshotRef = useRef(true);
  const didCheckAutosaveRef = useRef(false);
  const allowWindowCloseRef = useRef(false);
  const isPaintingRef = useRef(false);
  const isSpacePanningRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const lineStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
  const [rectDragStart, setRectDragStart] = useState<Point | null>(null);
  const [rectDragEnd, setRectDragEnd] = useState<Point | null>(null);
  const [lineDragStart, setLineDragStart] = useState<Point | null>(null);
  const [lineDragEnd, setLineDragEnd] = useState<Point | null>(null);

  const activeFrame = frames[activeIndex] ?? frames[0];
  const activeLayer = layers[activeLayerIndex] ?? layers[0];
  const activeLayerImageData = activeFrame?.layers[activeLayerIndex] ?? activeFrame?.layers[0];
  const compositedActiveFrame = useMemo(
    () => (activeFrame ? compositeFrame(activeFrame, layers, soloLayerIndex) : null),
    [activeFrame, layers, soloLayerIndex],
  );
  const selectedColor = useMemo(() => hexToRgba(color) ?? { r: 67, g: 240, b: 210, a: 255 }, [color]);
  const palettes = useMemo(() => [...DEFAULT_PALETTES, ...customPalettes], [customPalettes]);
  const activePalette = palettes.find((palette) => palette.id === activePaletteId) ?? palettes[0];
  const canEditActivePalette = !activePalette.locked;
  const projectTitle = projectFileName ?? (sheetName || "未命名工程");
  const buildProjectFile = useCallback((): ProjectFile => ({
    app: "Perfect Pixels",
    version: 1,
    sheetName,
    frameWidth,
    frameHeight,
    columns,
    rows,
    fps,
    activeIndex,
    customPalettes,
    activePaletteId,
    layers,
    frames: frames.map((frame) => frame.layers.map((layerImageData) => imageDataToCanvas(layerImageData).toDataURL("image/png"))),
  }), [activeIndex, activePaletteId, columns, customPalettes, fps, frameHeight, frameWidth, frames, layers, rows, sheetName]);
  const projectSnapshot = useMemo(() => JSON.stringify(buildProjectFile()), [buildProjectFile]);
  const isDirty = lastSavedSnapshot === null ? projectOrigin !== "new" : projectSnapshot !== lastSavedSnapshot;
  const projectStatusLabel = useMemo(() => {
    if (projectOrigin === "restored") return "自动恢复工程（未保存）";
    if (projectOrigin === "imported") return "从图片导入的新工程（未保存）";
    if (projectOrigin === "saved") return isDirty ? "已修改未保存" : "已保存工程";
    return isDirty ? "新建未保存工程" : "新建空白工程";
  }, [isDirty, projectOrigin]);

  useEffect(() => {
    window.localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(customPalettes));
  }, [customPalettes]);

  useEffect(() => {
    window.localStorage.setItem(TOOL_SHORTCUTS_KEY, JSON.stringify(toolShortcuts));
  }, [toolShortcuts]);

  const addColorToPalette = useCallback((hex: string, targetPaletteId = activePaletteId) => {
    const normalized = normalizeHex(hex);
    const target = palettes.find((palette) => palette.id === targetPaletteId);
    if (!target || target.locked) return false;
    setCustomPalettes((current) =>
      current.map((palette) =>
        palette.id === targetPaletteId && !palette.colors.includes(normalized)
          ? { ...palette, colors: [...palette.colors, normalized] }
          : palette,
      ),
    );
    return true;
  }, [activePaletteId, palettes]);

  const createCustomPalette = () => {
    const trimmedName = newPaletteName.trim() || "自定义调色盘";
    const nextPalette: Palette = {
      id: makeId(),
      name: trimmedName,
      colors: [normalizeHex(color)],
    };
    setCustomPalettes((current) => [...current, nextPalette]);
    setActivePaletteId(nextPalette.id);
  };

  const deleteActivePalette = () => {
    if (activePalette.locked) return;
    setCustomPalettes((current) => current.filter((palette) => palette.id !== activePalette.id));
    setActivePaletteId(DEFAULT_PALETTE_ID);
  };

  const pushHistory = useCallback(() => {
    setHistory((items) => [...items.slice(-24), frames.map(cloneFrame)]);
  }, [frames]);

  const updateActiveLayer = useCallback((updater: (imageData: ImageData) => ImageData) => {
    if (layers[activeLayerIndex]?.locked) return;
    setFrames((current) =>
      current.map((frame, index) => {
        if (index !== activeIndex) return frame;
        return {
          ...frame,
          layers: frame.layers.map((layerImageData, layerIndex) =>
            layerIndex === activeLayerIndex ? updater(cloneImageData(layerImageData)) : layerImageData,
          ),
        };
      }),
    );
  }, [activeIndex, activeLayerIndex, layers]);

  const drawEditor = useCallback(() => {
    const canvas = editorCanvasRef.current;
    if (!canvas || !activeFrame || !compositedActiveFrame) return;
    const width = compositedActiveFrame.width;
    const height = compositedActiveFrame.height;
    canvas.width = width * zoom;
    canvas.height = height * zoom;
    const ctx = get2d(canvas);
    ctx.imageSmoothingEnabled = false;
    drawChecker(ctx, canvas.width, canvas.height, Math.max(4, zoom));

    if (showOnion && activeIndex > 0) {
      ctx.globalAlpha = 0.28;
      ctx.drawImage(imageDataToCanvas(compositeFrame(frames[activeIndex - 1], layers, soloLayerIndex)), 0, 0, width * zoom, height * zoom);
      ctx.globalAlpha = 1;
    }

    ctx.drawImage(imageDataToCanvas(compositedActiveFrame), 0, 0, width * zoom, height * zoom);

    if (showGuides) {
      ctx.strokeStyle = "rgba(30, 90, 160, 0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.floor(width / 2) * zoom + 0.5, 0);
      ctx.lineTo(Math.floor(width / 2) * zoom + 0.5, canvas.height);
      ctx.moveTo(0, Math.max(0, height - 12) * zoom + 0.5);
      ctx.lineTo(canvas.width, Math.max(0, height - 12) * zoom + 0.5);
      ctx.stroke();
    }

    if (showGrid && zoom >= 6) {
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += 1) {
        ctx.strokeStyle = x % gridSize === 0 ? "rgba(29, 37, 50, 0.32)" : "rgba(29, 37, 50, 0.12)";
        ctx.beginPath();
        ctx.moveTo(x * zoom + 0.5, 0);
        ctx.lineTo(x * zoom + 0.5, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += 1) {
        ctx.strokeStyle = y % gridSize === 0 ? "rgba(29, 37, 50, 0.32)" : "rgba(29, 37, 50, 0.12)";
        ctx.beginPath();
        ctx.moveTo(0, y * zoom + 0.5);
        ctx.lineTo(canvas.width, y * zoom + 0.5);
        ctx.stroke();
      }
    }

    if (cursorPoint && (tool === "pencil" || tool === "eraser")) {
      const startX = cursorPoint.x - Math.floor(brushSize / 2);
      const startY = cursorPoint.y - Math.floor(brushSize / 2);
      const previewX = startX * zoom;
      const previewY = startY * zoom;
      const previewSize = brushSize * zoom;
      ctx.fillStyle = tool === "eraser" ? "rgba(239, 68, 68, 0.18)" : "rgba(31, 111, 235, 0.16)";
      ctx.strokeStyle = tool === "eraser" ? "rgba(185, 28, 28, 0.95)" : "rgba(31, 111, 235, 0.95)";
      ctx.lineWidth = 2;
      ctx.fillRect(previewX, previewY, previewSize, previewSize);
      ctx.strokeRect(previewX + 1, previewY + 1, Math.max(1, previewSize - 2), Math.max(1, previewSize - 2));
    }

    if (tool === "rectangle" && rectDragStart && rectDragEnd) {
      const minX = Math.min(rectDragStart.x, rectDragEnd.x);
      const maxX = Math.max(rectDragStart.x, rectDragEnd.x);
      const minY = Math.min(rectDragStart.y, rectDragEnd.y);
      const maxY = Math.max(rectDragStart.y, rectDragEnd.y);
      const rectX = minX * zoom;
      const rectY = minY * zoom;
      const rectW = (maxX - minX + 1) * zoom;
      const rectH = (maxY - minY + 1) * zoom;
      ctx.fillStyle = rectMode === "erase" ? "rgba(239, 68, 68, 0.16)" : "rgba(67, 240, 210, 0.16)";
      ctx.strokeStyle = rectMode === "erase" ? "rgba(185, 28, 28, 0.95)" : "rgba(21, 128, 118, 0.95)";
      ctx.lineWidth = 2;
      if (rectMode !== "outline") {
        ctx.fillRect(rectX, rectY, rectW, rectH);
      }
      ctx.strokeRect(rectX + 1, rectY + 1, Math.max(1, rectW - 2), Math.max(1, rectH - 2));
    }
    if (tool === "line" && lineDragStart && lineDragEnd) {
      ctx.strokeStyle = "rgba(31, 111, 235, 0.95)";
      ctx.lineWidth = Math.max(2, brushSize * zoom);
      ctx.lineCap = "square";
      ctx.beginPath();
      ctx.moveTo(lineDragStart.x * zoom + zoom / 2, lineDragStart.y * zoom + zoom / 2);
      ctx.lineTo(lineDragEnd.x * zoom + zoom / 2, lineDragEnd.y * zoom + zoom / 2);
      ctx.stroke();
    }
  }, [
    activeFrame,
    activeIndex,
    brushSize,
    compositedActiveFrame,
    cursorPoint,
    frames,
    layers,
    lineDragEnd,
    lineDragStart,
    rectDragEnd,
    rectDragStart,
    rectMode,
    showGrid,
    showGuides,
    showOnion,
    gridSize,
    tool,
    zoom,
    soloLayerIndex,
  ]);

  const drawPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !compositedActiveFrame) return;
    const previewScale = 4;
    canvas.width = compositedActiveFrame.width * previewScale;
    canvas.height = compositedActiveFrame.height * previewScale;
    const ctx = get2d(canvas);
    ctx.imageSmoothingEnabled = false;
    drawChecker(ctx, canvas.width, canvas.height, 8);
    ctx.drawImage(imageDataToCanvas(compositedActiveFrame), 0, 0, canvas.width, canvas.height);
  }, [compositedActiveFrame]);

  useEffect(() => {
    drawEditor();
    drawPreview();
  }, [drawEditor, drawPreview]);

  useEffect(() => {
    if (!isPlaying || frames.length <= 1) return;
    const duration = Math.max(20, Math.round(1000 / fps));
    const timer = window.setTimeout(() => {
      setActiveIndex((index) => (index + 1) % frames.length);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [activeIndex, fps, frames.length, isPlaying]);

  const importImage = async (file: File) => {
    const canContinue = await confirmUnsavedAction("导入新逐帧图会替换当前画布、帧和图层。");
    if (!canContinue) return;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    const source = document.createElement("canvas");
    source.width = img.naturalWidth;
    source.height = img.naturalHeight;
    const sourceCtx = get2d(source);
    sourceCtx.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);

    const guessed = guessSliceSettings(img.naturalWidth, img.naturalHeight, frameWidth, frameHeight);
    setSourceSheet(sourceCtx.getImageData(0, 0, source.width, source.height));
    setFrameWidth(guessed.width);
    setFrameHeight(guessed.height);
    setColumns(guessed.columns);
    setRows(guessed.rows);
    sliceFromCanvas(source, guessed.width, guessed.height, guessed.columns, guessed.rows, true);
    setSheetName(file.name.replace(/\.[^.]+$/, "") || "edited_sprite_sheet");
    projectFileHandleRef.current = null;
    setProjectFileName(null);
    setProjectFileBound(false);
    setProjectOrigin("imported");
    setLastSavedSnapshot(null);
    setExportStatus(`已导入 ${file.name}，当前为未保存的新工程`);
  };

  const sliceFromCanvas = (
    source: HTMLCanvasElement,
    width: number,
    height: number,
    cols: number,
    sheetRows: number,
    chromaMagenta: boolean,
  ) => {
    const nextFrames: Frame[] = [];
    for (let row = 0; row < sheetRows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if ((col + 1) * width > source.width || (row + 1) * height > source.height) continue;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = get2d(canvas);
        ctx.drawImage(source, col * width, row * height, width, height, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height);
        if (chromaMagenta) {
          for (let i = 0; i < data.data.length; i += 4) {
            if (data.data[i] === 255 && data.data[i + 1] === 0 && data.data[i + 2] === 255) {
              data.data[i + 3] = 0;
            }
          }
        }
        nextFrames.push({
          id: makeId(),
          layers: DEFAULT_LAYERS.map((_, layerIndex) => (layerIndex === 0 ? data : makeBlankImageData(width, height))),
        });
      }
    }
    if (nextFrames.length > 0) {
      pushHistory();
      setLayers(cloneLayers(DEFAULT_LAYERS));
      setActiveLayerIndex(0);
      setSoloLayerIndex(null);
      setFrames(nextFrames);
      setActiveIndex(0);
    }
  };

  const resliceCurrentSheet = () => {
    const currentWidth = activeLayerImageData?.width ?? frameWidth;
    const currentHeight = activeLayerImageData?.height ?? frameHeight;
    const shouldResizeCurrentFrames = !sourceSheet || frameWidth !== currentWidth || frameHeight !== currentHeight;

    if (shouldResizeCurrentFrames && !sourceSheet) {
      pushHistory();
      setFrames((current) =>
        current.map((frame) => ({
          ...frame,
          layers: frame.layers.map((layerImageData) => resizeImageData(layerImageData, frameWidth, frameHeight)),
        })),
      );
      return;
    }

    const sheet = imageDataToCanvas(sourceSheet);
    const canSlice = columns * frameWidth <= sheet.width && rows * frameHeight <= sheet.height;
    if (canSlice) {
      sliceFromCanvas(sheet, frameWidth, frameHeight, columns, rows, false);
      return;
    }

    pushHistory();
    setFrames((current) =>
      current.map((frame) => ({
        ...frame,
        layers: frame.layers.map((layerImageData) => resizeImageData(layerImageData, frameWidth, frameHeight)),
      })),
    );
    setSourceSheet(null);
  };

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = editorCanvasRef.current;
    if (!canvas || !activeLayerImageData) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * activeLayerImageData.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * activeLayerImageData.height);
    if (x < 0 || y < 0 || x >= activeLayerImageData.width || y >= activeLayerImageData.height) return null;
    return { x, y };
  };

  const pickColorAtPoint = (point: Point | null) => {
    if (!point || !activeLayerImageData) return;
    const pixel = getPixel(activeLayerImageData, point.x, point.y);
    if (pixel.a <= 0) return;
    const pickedColor = rgbaToHex(pixel.r, pixel.g, pixel.b);
    setColor(pickedColor);
    if (autoAddPickedColor) addColorToPalette(pickedColor);
  };

  const startCanvasPan = (event: React.PointerEvent, target: HTMLElement) => {
    isPanningRef.current = true;
    target.setPointerCapture(event.pointerId);
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop,
    };
  };

  const zoomAroundPointer = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const scroll = event.currentTarget;
    const canvas = editorCanvasRef.current;
    if (!canvas || !activeLayerImageData) return;
    const nextZoom = Math.max(2, Math.min(48, zoom + (event.deltaY < 0 ? 1 : -1)));
    if (nextZoom === zoom) return;
    const canvasRect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - canvasRect.left;
    const pointerY = event.clientY - canvasRect.top;
    const imageX = pointerX / zoom;
    const imageY = pointerY / zoom;
    setZoom(nextZoom);
    window.requestAnimationFrame(() => {
      const nextCanvasRect = canvas.getBoundingClientRect();
      scroll.scrollLeft += imageX * nextZoom - (event.clientX - nextCanvasRect.left);
      scroll.scrollTop += imageY * nextZoom - (event.clientY - nextCanvasRect.top);
    });
  };

  const setToolShortcut = (toolId: Tool, value: string) => {
    const normalized = normalizeShortcutKey(value);
    setToolShortcuts((current) => ({ ...current, [toolId]: normalized }));
  };

  const resetToolShortcuts = () => {
    setToolShortcuts({ ...DEFAULT_TOOL_SHORTCUTS });
  };

  const floodFill = (imageData: ImageData, x: number, y: number, fillColor: { r: number; g: number; b: number; a: number }) => {
    const target = getPixel(imageData, x, y);
    if (sameColor(target, fillColor)) return imageData;
    const stack = [{ x, y }];
    while (stack.length > 0) {
      const point = stack.pop();
      if (!point) continue;
      if (point.x < 0 || point.y < 0 || point.x >= imageData.width || point.y >= imageData.height) continue;
      if (!sameColor(getPixel(imageData, point.x, point.y), target)) continue;
      setPixel(imageData, point.x, point.y, fillColor);
      stack.push({ x: point.x + 1, y: point.y });
      stack.push({ x: point.x - 1, y: point.y });
      stack.push({ x: point.x, y: point.y + 1 });
      stack.push({ x: point.x, y: point.y - 1 });
    }
    return imageData;
  };

  const paintAt = (event: React.PointerEvent<HTMLCanvasElement>, firstStroke = false) => {
    const point = canvasPoint(event);
    if (!point || !activeLayerImageData) return;
    if (activeLayer?.locked && tool !== "eyedropper") return;
    if (firstStroke && tool !== "eyedropper") pushHistory();

    if (tool === "eyedropper") {
      pickColorAtPoint(point);
      return;
    }

    if (tool === "rectangle" || tool === "line") return;

    updateActiveLayer((imageData) => {
      if (tool === "bucket") {
        return floodFill(imageData, point.x, point.y, selectedColor);
      }
      if (tool === "replace") {
        const target = getPixel(imageData, point.x, point.y);
        if (sameColor(target, selectedColor)) return imageData;
        for (let y = 0; y < imageData.height; y += 1) {
          for (let x = 0; x < imageData.width; x += 1) {
            if (sameColor(getPixel(imageData, x, y), target)) setPixel(imageData, x, y, selectedColor);
          }
        }
        return imageData;
      }
      if (tool === "lighten" || tool === "darken") {
        adjustColor(imageData, point.x, point.y, brushSize, tool === "lighten" ? 16 : -16);
        return imageData;
      }
      applyBrush(
        imageData,
        point.x,
        point.y,
        brushSize,
        tool === "eraser" ? { r: 0, g: 0, b: 0, a: 0 } : selectedColor,
      );
      return imageData;
    });
  };

  const finishRectangle = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = rectStartRef.current;
    const end = canvasPoint(event);
    rectStartRef.current = null;
    setRectDragStart(null);
    setRectDragEnd(null);
    if (!start || !end || !activeLayerImageData) return;
    updateActiveLayer((imageData) => {
      applyRectangle(imageData, start, end, rectMode, selectedColor);
      return imageData;
    });
  };

  const finishLine = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = lineStartRef.current;
    const end = canvasPoint(event);
    lineStartRef.current = null;
    setLineDragStart(null);
    setLineDragEnd(null);
    if (!start || !end || !activeLayerImageData) return;
    updateActiveLayer((imageData) => {
      drawLine(imageData, start, end, selectedColor, brushSize);
      return imageData;
    });
  };

  const exportSheetCanvas = (direction: "horizontal" | "vertical") => {
    const width = compositedActiveFrame?.width ?? frameWidth;
    const height = compositedActiveFrame?.height ?? frameHeight;
    const canvas = document.createElement("canvas");
    canvas.width = direction === "horizontal" ? width * frames.length : width;
    canvas.height = direction === "horizontal" ? height : height * frames.length;
    const ctx = get2d(canvas);
    frames.forEach((frame, index) => {
      ctx.putImageData(
        compositeFrame(frame, layers, soloLayerIndex),
        direction === "horizontal" ? index * width : 0,
        direction === "horizontal" ? 0 : index * height,
      );
    });
    return canvas;
  };

  const downloadBlob = async (blob: Blob, name: string) => {
    if (isTauriRuntime()) {
      try {
        const content = await blobToBase64(blob);
        const savedPath = await invoke<string | null>("export_file", { filename: name, contentBase64: content });
        setExportStatus(savedPath ? `已导出：${savedPath}` : "已取消导出");
        return;
      } catch (error) {
        setExportStatus(`导出失败：${String(error)}`);
        return;
      }
    }
    const link = document.createElement("a");
    link.download = name;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    setExportStatus(`已导出：${name}`);
  };

  const downloadCanvas = async (canvas: HTMLCanvasElement, name: string) => {
    await downloadBlob(await canvasToBlob(canvas, "image/png"), name);
  };

  const exportGifPreview = async () => {
    const width = compositedActiveFrame?.width ?? frameWidth;
    const height = compositedActiveFrame?.height ?? frameHeight;
    const gif = GIFEncoder();
    const delay = Math.max(20, Math.round(1000 / fps));
    frames.forEach((frame) => {
      const imageData = compositeFrame(frame, layers, soloLayerIndex);
      const palette = quantize(imageData.data, 256, { format: "rgba4444", oneBitAlpha: 8 });
      const index = applyPalette(imageData.data, palette, "rgba4444");
      gif.writeFrame(index, width, height, { palette, delay, repeat: 0, transparent: true, transparentIndex: 0 });
    });
    gif.finish();
    const gifBytes = gif.bytes();
    await downloadBlob(new Blob([gifBytes.slice()], { type: "image/gif" }), `${sheetName}_preview.gif`);
  };

  const exportFramesZip = async () => {
    const files = await Promise.all(
      frames.map(async (frame, index) => {
        const canvas = imageDataToCanvas(compositeFrame(frame, layers, soloLayerIndex));
        const blob = await canvasToBlob(canvas, "image/png");
        return {
          name: `${sheetName}_frame_${String(index + 1).padStart(2, "0")}.png`,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      }),
    );
    await downloadBlob(makeZip(files), `${sheetName}_frames.zip`);
  };

  const exportActiveFrame = async () => {
    if (!compositedActiveFrame) return;
    await downloadCanvas(imageDataToCanvas(compositedActiveFrame), `${sheetName}_frame_${String(activeIndex + 1).padStart(2, "0")}.png`);
  };

  const exportSelectedPreset = async () => {
    if (exportPreset === "current-frame") {
      await exportActiveFrame();
      return;
    }
    if (exportPreset === "sheet-horizontal") {
      await downloadCanvas(exportSheetCanvas("horizontal"), `${sheetName}_sheet_horizontal.png`);
      return;
    }
    if (exportPreset === "sheet-vertical") {
      await downloadCanvas(exportSheetCanvas("vertical"), `${sheetName}_sheet_vertical.png`);
      return;
    }
    if (exportPreset === "gif-preview") {
      await exportGifPreview();
      return;
    }
    await exportFramesZip();
  };

  const downloadProjectBlob = (blob: Blob) => {
    const link = document.createElement("a");
    link.download = `${sheetName || "pixel_frame_project"}.pfe.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const writeProjectToHandle = async (handle: ProjectFileHandle, blob: Blob) => {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  };

  const saveProject = async (saveAs = false) => {
    const projectText = JSON.stringify(buildProjectFile());
    const blob = new Blob([projectText], { type: "application/json" });
    try {
      if (!saveAs && projectFileHandleRef.current) {
        await writeProjectToHandle(projectFileHandleRef.current, blob);
        setProjectFileBound(true);
        setProjectOrigin("saved");
        setLastSavedSnapshot(projectText);
        window.localStorage.removeItem(AUTOSAVE_KEY);
        setExportStatus(`已保存工程：${projectFileName ?? "当前工程"}`);
        return true;
      }

      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${sheetName || "pixel_frame_project"}.pfe.json`,
          types: [{ description: "Perfect Pixels Project", accept: { "application/json": [".pfe.json", ".json"] } }],
        });
        projectFileHandleRef.current = handle;
        setProjectFileName(handle.name);
        setProjectFileBound(true);
        setProjectOrigin("saved");
        await writeProjectToHandle(handle, blob);
        setLastSavedSnapshot(projectText);
        window.localStorage.removeItem(AUTOSAVE_KEY);
        setExportStatus(`已保存工程：${handle.name}`);
        return true;
      }

      downloadProjectBlob(blob);
      projectFileHandleRef.current = null;
      setProjectFileName(`${sheetName || "pixel_frame_project"}.pfe.json`);
      setProjectFileBound(false);
      setProjectOrigin("saved");
      setLastSavedSnapshot(projectText);
      window.localStorage.removeItem(AUTOSAVE_KEY);
      setExportStatus("已下载工程文件；浏览器模式下不会绑定覆盖保存位置");
      return true;
    } catch (error) {
      setExportStatus(`保存已取消或失败：${String(error)}`);
      return false;
    }
  };

  const applyProjectData = useCallback(async (
    project: ProjectFile,
    displayName: string,
    handle: ProjectFileHandle | null,
    origin: ProjectOrigin,
  ) => {
    if (!["Perfect Pixels", "Pixel Frame Editor"].includes(project.app) || project.version !== 1 || !Array.isArray(project.frames)) {
      throw new Error("Not a supported Perfect Pixels project file.");
    }
    const projectLayers = normalizeLayers(project.layers?.length ? project.layers : DEFAULT_LAYERS);
    const loadedFrames = await Promise.all(
      project.frames.map(async (frameItem) => {
        const loadedLayers = Array.isArray(frameItem)
          ? await Promise.all(frameItem.map((frameDataUrl) => dataUrlToImageData(frameDataUrl)))
          : [await dataUrlToImageData(frameItem)];
        const width = loadedLayers[0].width;
        const height = loadedLayers[0].height;
        while (loadedLayers.length < projectLayers.length) {
          loadedLayers.push(makeBlankImageData(width, height));
        }
        return { id: makeId(), layers: loadedLayers.slice(0, projectLayers.length) };
      }),
    );
    if (loadedFrames.length === 0) return false;
    if (origin !== "restored") pushHistory();
    setFrames(loadedFrames);
    setActiveIndex(Math.min(project.activeIndex ?? 0, loadedFrames.length - 1));
    setLayers(projectLayers);
    setActiveLayerIndex(0);
    setSoloLayerIndex(null);
    setFrameWidth(project.frameWidth || loadedFrames[0].layers[0].width);
    setFrameHeight(project.frameHeight || loadedFrames[0].layers[0].height);
    setColumns(project.columns || loadedFrames.length);
    setRows(project.rows || 1);
    setFps(project.fps || 8);
    setSheetName(project.sheetName || displayName.replace(/\.pfe\.json$|\.json$/i, "") || "edited_sprite_sheet");
    setCustomPalettes(project.customPalettes ?? []);
    setActivePaletteId(project.activePaletteId ?? DEFAULT_PALETTE_ID);
    setSourceSheet(null);
    projectFileHandleRef.current = handle;
    setProjectFileName(displayName);
    setProjectFileBound(Boolean(handle));
    setProjectOrigin(origin);
    if (origin === "saved") {
      shouldCaptureCleanSnapshotRef.current = true;
      window.localStorage.removeItem(AUTOSAVE_KEY);
    } else {
      setLastSavedSnapshot(null);
    }
    setExportStatus(origin === "restored" ? `已恢复自动保存：${displayName}` : `已打开工程：${displayName}`);
    return true;
  }, [pushHistory]);

  const openProject = async (file: File, handle: ProjectFileHandle | null = null) => {
    const text = await file.text();
    const project = JSON.parse(text) as ProjectFile;
    await applyProjectData(project, handle?.name ?? file.name, handle, "saved");
  };

  const requestUnsavedDecision = (message: string) =>
    new Promise<UnsavedDecision>((resolve) => {
      unsavedPromptResolveRef.current = resolve;
      setUnsavedPrompt({ message });
    });

  const resolveUnsavedPrompt = (decision: UnsavedDecision) => {
    unsavedPromptResolveRef.current?.(decision);
    unsavedPromptResolveRef.current = null;
    setUnsavedPrompt(null);
  };

  const confirmUnsavedAction = async (message: string) => {
    if (!isDirty) return true;
    const decision = await requestUnsavedDecision(message);
    if (decision === "cancel") return false;
    if (decision === "discard") return true;
    return saveProject();
  };

  const openProjectFromPicker = async () => {
    const canContinue = await confirmUnsavedAction("打开其他工程会替换当前画布、帧和图层。");
    if (!canContinue) return;
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "Perfect Pixels Project", accept: { "application/json": [".pfe.json", ".json"] } }],
      });
      const file = await handle.getFile();
      await openProject(file, handle);
      return;
    }
    projectFileInputRef.current?.click();
  };

  useEffect(() => {
    if (shouldCaptureCleanSnapshotRef.current) {
      setLastSavedSnapshot(projectSnapshot);
      shouldCaptureCleanSnapshotRef.current = false;
    }
  }, [projectSnapshot]);

  useEffect(() => {
    document.title = `Perfect Pixels - ${projectTitle}${isDirty ? " *" : ""}`;
  }, [isDirty, projectTitle]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowWindowCloseRef.current) return;
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const appWindow = getCurrentWindow();
    void appWindow.onCloseRequested(async (event) => {
      if (allowWindowCloseRef.current || !isDirty) return;
      event.preventDefault();
      const decision = await requestUnsavedDecision("关闭软件前需要处理当前工程的未保存修改。");
      if (decision === "cancel") return;
      if (decision === "save") {
        const saved = await saveProject();
        if (!saved) return;
      }
      allowWindowCloseRef.current = true;
      await appWindow.close();
    }).then((handler) => {
      if (disposed) handler();
      else unlisten = handler;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDirty, projectSnapshot]);

  useEffect(() => {
    if (didCheckAutosaveRef.current) return;
    didCheckAutosaveRef.current = true;
    const raw = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    try {
      const autosave = JSON.parse(raw) as { savedAt?: number; project?: ProjectFile; projectFileName?: string | null };
      if (!autosave.project) return;
      const savedAt = autosave.savedAt ? new Date(autosave.savedAt).toLocaleString() : "未知时间";
      const shouldRestore = window.confirm(`发现未恢复工程（${savedAt}）。是否恢复？`);
      if (shouldRestore) {
        void applyProjectData(autosave.project, autosave.projectFileName ?? "自动恢复工程", null, "restored");
      } else {
        window.localStorage.removeItem(AUTOSAVE_KEY);
      }
    } catch {
      window.localStorage.removeItem(AUTOSAVE_KEY);
    }
  }, [applyProjectData]);

  useEffect(() => {
    if (!isDirty) {
      if (projectOrigin === "saved") window.localStorage.removeItem(AUTOSAVE_KEY);
      return;
    }

    const writeAutosave = () => {
      const autosave = {
        savedAt: Date.now(),
        project: buildProjectFile(),
        projectFileName,
        projectOrigin,
      };
      window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(autosave));
    };

    writeAutosave();
    const timer = window.setInterval(writeAutosave, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [buildProjectFile, isDirty, projectFileName, projectOrigin]);

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFrames(previous.map(cloneFrame));
    setHistory((items) => items.slice(0, -1));
    setActiveIndex((index) => Math.min(index, previous.length - 1));
  };

  const duplicateFrame = () => {
    if (!activeFrame) return;
    pushHistory();
    const copy = { id: makeId(), layers: activeFrame.layers.map(cloneImageData) };
    setFrames((current) => [...current.slice(0, activeIndex + 1), copy, ...current.slice(activeIndex + 1)]);
    setActiveIndex((index) => index + 1);
  };

  const duplicatePreviousFrame = () => {
    if (activeIndex <= 0) return;
    const previous = frames[activeIndex - 1];
    pushHistory();
    const copy = { id: makeId(), layers: previous.layers.map(cloneImageData) };
    setFrames((current) => [...current.slice(0, activeIndex), copy, ...current.slice(activeIndex)]);
  };

  const addBlankFrame = () => {
    pushHistory();
    setFrames((current) => [...current, makeBlankFrame(frameWidth, frameHeight, layers.length)]);
    setActiveIndex(frames.length);
  };

  const removeFrame = () => {
    if (frames.length <= 1) return;
    pushHistory();
    setFrames((current) => current.filter((_, index) => index !== activeIndex));
    setActiveIndex((index) => Math.max(0, index - 1));
  };

  const addLayer = () => {
    pushHistory();
    const nextName = `图层 ${layers.length + 1}`;
    const nextLayer: Layer = { id: makeId(), name: nextName, visible: true, locked: false };
    setLayers((current) => [...current, nextLayer]);
    setFrames((current) =>
      current.map((frame) => ({
        ...frame,
        layers: [...frame.layers, makeBlankImageData(frame.layers[0].width, frame.layers[0].height)],
      })),
    );
    setActiveLayerIndex(layers.length);
  };

  const removeLayer = () => {
    if (layers.length <= 1) return;
    pushHistory();
    setLayers((current) => current.filter((_, index) => index !== activeLayerIndex));
    setFrames((current) =>
      current.map((frame) => ({
        ...frame,
        layers: frame.layers.filter((_, index) => index !== activeLayerIndex),
      })),
    );
    setActiveLayerIndex((index) => Math.max(0, index - 1));
    setSoloLayerIndex((index) => {
      if (index === null) return null;
      if (index === activeLayerIndex) return null;
      return index > activeLayerIndex ? index - 1 : index;
    });
  };

  const toggleLayerVisibility = (index: number) => {
    setLayers((current) =>
      current.map((layer, layerIndex) =>
        layerIndex === index ? { ...layer, visible: !layer.visible } : layer,
      ),
    );
  };

  const toggleLayerLock = (index: number) => {
    setLayers((current) =>
      current.map((layer, layerIndex) =>
        layerIndex === index ? { ...layer, locked: !layer.locked } : layer,
      ),
    );
  };

  const renameLayer = (index: number, name: string) => {
    setLayers((current) =>
      current.map((layer, layerIndex) =>
        layerIndex === index ? { ...layer, name } : layer,
      ),
    );
  };

  const toggleLayerSolo = (index: number) => {
    setSoloLayerIndex((current) => (current === index ? null : index));
    setActiveLayerIndex(index);
  };

  const moveLayer = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= layers.length || toIndex >= layers.length) return;
    pushHistory();
    setLayers((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setFrames((current) =>
      current.map((frame) => {
        const nextLayers = [...frame.layers];
        const [moved] = nextLayers.splice(fromIndex, 1);
        nextLayers.splice(toIndex, 0, moved);
        return { ...frame, layers: nextLayers };
      }),
    );
    setActiveLayerIndex((index) => {
      if (index === fromIndex) return toIndex;
      if (fromIndex < index && toIndex >= index) return index - 1;
      if (fromIndex > index && toIndex <= index) return index + 1;
      return index;
    });
    setSoloLayerIndex((index) => {
      if (index === null) return null;
      if (index === fromIndex) return toIndex;
      if (fromIndex < index && toIndex >= index) return index - 1;
      if (fromIndex > index && toIndex <= index) return index + 1;
      return index;
    });
  };

  const mirrorFrames = (scope: "current" | "all") => {
    pushHistory();
    setFrames((current) =>
      current.map((frame, frameIndex) => {
        if (scope === "current" && frameIndex !== activeIndex) return frame;
        return {
          ...frame,
          layers: frame.layers.map(mirrorImageDataHorizontally),
        };
      }),
    );
  };

  const moveFrame = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= frames.length || toIndex >= frames.length) return;
    pushHistory();
    setFrames((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setActiveIndex((index) => {
      if (index === fromIndex) return toIndex;
      if (fromIndex < index && toIndex >= index) return index - 1;
      if (fromIndex > index && toIndex <= index) return index + 1;
      return index;
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      const inputType = target instanceof HTMLInputElement ? target.type : "";
      const isTextEditing =
        target?.isContentEditable ||
        tagName === "textarea" ||
        (tagName === "input" && ["email", "number", "password", "search", "tel", "text", "url"].includes(inputType));

      const key = event.key.toLowerCase();
      if (event.key === " " && !isTextEditing) {
        event.preventDefault();
        target?.blur();
        isSpacePanningRef.current = true;
        setIsSpacePanning(true);
        return;
      }

      if (tagName === "input" || tagName === "select" || tagName === "textarea" || target?.isContentEditable) return;

      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "n") {
        event.preventDefault();
        addBlankFrame();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "d") {
        event.preventDefault();
        duplicateFrame();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeFrame();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const matchingTool = TOOL_DEFS.find((toolDef) => toolShortcuts[toolDef.id] === key)?.id;
      if (matchingTool) {
        setTool(matchingTool);
        return;
      }
      if (event.key === "[") setBrushSize((size) => Math.max(1, size - 1));
      if (event.key === "]") setBrushSize((size) => Math.min(12, size + 1));
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " ") return;
      isSpacePanningRef.current = false;
      isPanningRef.current = false;
      setIsSpacePanning(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [history, toolShortcuts, undo]);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <div className="title-row">
            <h1>Perfect Pixels</h1>
            <div className="help-tip" tabIndex={0} aria-label="快捷键帮助">
              ?
              <div className="help-popover" role="tooltip">
                <strong>快捷键</strong>
                <span>Ctrl+Z：撤销</span>
                <span>B：画笔</span>
                <span>E：橡皮</span>
                <span>I：吸管</span>
                <span>G：颜料桶</span>
                <span>R：矩形</span>
                <span>L：直线</span>
                <span>X：替换同色</span>
                <span>O / P：提亮 / 压暗</span>
                <span>[ / ]：笔刷变小 / 变大</span>
                <span>Ctrl+Shift+N：新建帧</span>
                <span>Ctrl+D：复制当前帧</span>
                <span>Delete：删除当前帧</span>
                <span>镜像：可翻转当前帧 / 所有帧</span>
                <span>按住 Space：拖动画布</span>
                <span>B站作者：Rice要永远跑下去</span>
              </div>
            </div>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={undo} disabled={history.length === 0}>撤销</button>
          <button onClick={exportActiveFrame}>导出当前帧</button>
          <select
            className="export-preset-select"
            value={exportPreset}
            onChange={(event) => setExportPreset(event.target.value as ExportPreset)}
            aria-label="导出预设"
          >
            {(Object.keys(EXPORT_PRESET_LABELS) as ExportPreset[]).map((preset) => (
              <option key={preset} value={preset}>{EXPORT_PRESET_LABELS[preset]}</option>
            ))}
          </select>
          <button className="primary" onClick={() => void exportSelectedPreset()}>按预设导出</button>
        </div>
      </header>
      {exportStatus && <div className="export-status">{exportStatus}</div>}
      {unsavedPrompt && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
          <div className="modal-card">
            <h2 id="unsaved-title">有未保存的修改</h2>
            <p>{unsavedPrompt.message}</p>
            <p className="hint">当前工程：{projectTitle}{isDirty ? " *" : ""}</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => resolveUnsavedPrompt("save")}>保存</button>
              <button onClick={() => resolveUnsavedPrompt("discard")}>不保存</button>
              <button onClick={() => resolveUnsavedPrompt("cancel")}>取消</button>
            </div>
          </div>
        </div>
      )}

      <section className="workspace">
        <aside className="panel tools-panel">
          <h2>工具</h2>
          <div className="tool-grid">
            {TOOL_DEFS.map((toolDef) => (
              <button
                key={toolDef.id}
                className={`tool-button ${tool === toolDef.id ? "active" : ""}`}
                onClick={() => setTool(toolDef.id)}
                title={`${toolDef.label} (${toolShortcuts[toolDef.id].toUpperCase() || "未设置"})`}
                aria-label={toolDef.label}
              >
                <span aria-hidden="true">{toolDef.icon}</span>
                <kbd>{toolShortcuts[toolDef.id].toUpperCase()}</kbd>
              </button>
            ))}
          </div>
          <label className="range-row">
            笔刷尺寸
            <input type="range" min="1" max="12" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
            <span>{brushSize}px</span>
          </label>
          <label className="rect-mode">
            矩形模式
            <select value={rectMode} onChange={(event) => setRectMode(event.target.value as RectMode)}>
              <option value="fill">填充矩形</option>
              <option value="outline">描边矩形</option>
              <option value="erase">擦除矩形</option>
            </select>
          </label>
          <label className="color-row">
            颜色
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            <code>{color}</code>
          </label>

          <h2>镜像</h2>
          <div className="mirror-actions">
            <button onClick={() => mirrorFrames("current")}>水平翻转当前帧</button>
            <button onClick={() => mirrorFrames("all")}>水平翻转所有帧</button>
          </div>

          <h2>调色盘</h2>
          <label>
            当前调色盘
            <select value={activePaletteId} onChange={(event) => setActivePaletteId(event.target.value)}>
              {palettes.map((palette) => (
                <option key={palette.id} value={palette.id}>
                  {palette.name}
                </option>
              ))}
            </select>
          </label>
          <div className="palette-grid">
            {activePalette.colors.map((paletteColor, index) => (
              <button
                key={`${paletteColor}-${index}`}
                className={`swatch ${normalizeHex(color) === normalizeHex(paletteColor) ? "selected" : ""}`}
                style={{ backgroundColor: paletteColor }}
                title={paletteColor}
                onClick={() => setColor(normalizeHex(paletteColor))}
                aria-label={`选择颜色 ${paletteColor}`}
              />
            ))}
          </div>
          <div className="palette-actions">
            <button onClick={() => addColorToPalette(color)} disabled={!canEditActivePalette}>
              当前颜色加入
            </button>
            <button onClick={deleteActivePalette} disabled={!canEditActivePalette}>
              删除调色盘
            </button>
          </div>
          <div className="palette-actions">
            <label className="auto-pick">
              <input
                type="checkbox"
                checked={autoAddPickedColor}
                onChange={(event) => setAutoAddPickedColor(event.target.checked)}
              />
              吸管取色后加入
            </label>
          </div>
          {!canEditActivePalette && <p className="hint">默认调色盘固定保留。要保存取到的颜色，请先新建自定义调色盘。</p>}
          <div className="new-palette">
            <input value={newPaletteName} onChange={(event) => setNewPaletteName(event.target.value)} />
            <button onClick={createCustomPalette}>新建调色盘</button>
          </div>

          <div className="toggles">
            <label><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /> 网格</label>
            <label><input type="checkbox" checked={showOnion} onChange={(event) => setShowOnion(event.target.checked)} /> 洋葱皮</label>
            <label><input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} /> 中线/脚底参考</label>
          </div>
          <label className="rect-mode">
            网格规格
            <select value={gridSize} onChange={(event) => setGridSize(Number(event.target.value))}>
              {GRID_PRESETS.map((preset) => (
                <option key={preset} value={preset}>{preset}px</option>
              ))}
            </select>
          </label>
          <h2>快捷键</h2>
          <div className="shortcut-grid">
            {TOOL_DEFS.map((toolDef) => (
              <label key={toolDef.id}>
                {toolDef.label}
                <input
                  maxLength={1}
                  value={toolShortcuts[toolDef.id]}
                  onChange={(event) => setToolShortcut(toolDef.id, event.target.value)}
                />
              </label>
            ))}
          </div>
          <button onClick={resetToolShortcuts}>恢复默认快捷键</button>
        </aside>

        <section className="canvas-stage">
          <div className="stage-toolbar">
            <label>
              缩放
              <input type="range" min="4" max="24" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <span>{zoom}x</span>
            </label>
            <span>{activeLayerImageData?.width ?? 0} x {activeLayerImageData?.height ?? 0}px</span>
          </div>
          <div
            ref={canvasScrollRef}
            className={`canvas-scroll ${isSpacePanning ? "panning-ready" : ""}`}
            onWheel={zoomAroundPointer}
            onPointerMove={(event) => {
              if (!isPanningRef.current) return;
              const start = panStartRef.current;
              event.currentTarget.scrollLeft = start.scrollLeft - (event.clientX - start.x);
              event.currentTarget.scrollTop = start.scrollTop - (event.clientY - start.y);
            }}
            onPointerDown={(event) => {
              if (!isSpacePanningRef.current && event.button !== 1) return;
              event.preventDefault();
              startCanvasPan(event, event.currentTarget);
            }}
            onPointerUp={() => {
              isPanningRef.current = false;
            }}
            onPointerCancel={() => {
              isPanningRef.current = false;
            }}
          >
            <canvas
              ref={editorCanvasRef}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                if ((isSpacePanningRef.current || event.button === 1) && canvasScrollRef.current) {
                  event.preventDefault();
                  startCanvasPan(event, canvasScrollRef.current);
                  return;
                }
                if (event.button === 2) {
                  event.preventDefault();
                  pickColorAtPoint(canvasPoint(event));
                  return;
                }
                const point = canvasPoint(event);
                setCursorPoint(point);
                if (activeLayer?.locked && tool !== "eyedropper") return;
                isPaintingRef.current = true;
                if (tool === "rectangle") {
                  rectStartRef.current = point;
                  setRectDragStart(point);
                  setRectDragEnd(point);
                  if (rectStartRef.current) pushHistory();
                } else if (tool === "line") {
                  lineStartRef.current = point;
                  setLineDragStart(point);
                  setLineDragEnd(point);
                  if (lineStartRef.current) pushHistory();
                } else {
                  paintAt(event, true);
                }
              }}
              onPointerMove={(event) => {
                if (isPanningRef.current) return;
                const point = canvasPoint(event);
                setCursorPoint(point);
                if (isPaintingRef.current && tool === "rectangle") {
                  setRectDragEnd(point);
                }
                if (isPaintingRef.current && tool === "line") {
                  setLineDragEnd(point);
                }
                if (isPaintingRef.current && (tool === "pencil" || tool === "eraser" || tool === "lighten" || tool === "darken")) paintAt(event);
              }}
              onPointerUp={(event) => {
                if (isPanningRef.current) {
                  isPanningRef.current = false;
                  return;
                }
                if (tool === "rectangle") finishRectangle(event);
                if (tool === "line") finishLine(event);
                isPaintingRef.current = false;
              }}
              onPointerCancel={() => {
                isPaintingRef.current = false;
                rectStartRef.current = null;
                setRectDragStart(null);
                setRectDragEnd(null);
                lineStartRef.current = null;
                setLineDragStart(null);
                setLineDragEnd(null);
                setCursorPoint(null);
              }}
              onPointerLeave={() => {
                if (!isPaintingRef.current) setCursorPoint(null);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                pickColorAtPoint(canvasPoint(event));
              }}
            />
          </div>
          <div className="status-bar">
            <span>坐标：{cursorPoint ? `${cursorPoint.x}, ${cursorPoint.y}` : "--, --"}</span>
            <span>颜色：<code>{color}</code></span>
            <span>帧：{activeIndex + 1}/{frames.length}</span>
            <span>图层：{activeLayer?.name ?? "--"}</span>
            <span>缩放：{zoom}x</span>
          </div>
          <div className="timeline">
            <div className="timeline-header">
              <h2>图层与帧</h2>
              <div className="frame-actions">
                <button onClick={addBlankFrame}>新空帧</button>
                <button onClick={duplicateFrame}>复制当前帧</button>
                <button onClick={duplicatePreviousFrame} disabled={activeIndex <= 0}>复制前一帧</button>
                <button onClick={removeFrame} disabled={frames.length <= 1}>删当前帧</button>
              </div>
            </div>
            <div className="timeline-body">
              <div
                className="timeline-layers"
                onDragOver={(event) => {
                  if (draggedLayerIndex === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  if (draggedLayerIndex === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDraggedLayerIndex(null);
                }}
              >
                <div className="layer-list">
                  {layers.map((layer, index) => (
                    <div
                      key={layer.id}
                      className={`layer-row ${activeLayerIndex === index ? "selected" : ""} ${draggedLayerIndex === index ? "dragging" : ""}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (draggedLayerIndex !== null) moveLayer(draggedLayerIndex, index);
                        setDraggedLayerIndex(null);
                      }}
                      onDragEnd={() => setDraggedLayerIndex(null)}
                    >
                      <button
                        className="layer-drag-handle"
                        title="拖拽调整图层顺序"
                        draggable
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", `layer-${index}`);
                          setDraggedLayerIndex(index);
                        }}
                        onDragEnd={(event) => {
                          event.preventDefault();
                          setDraggedLayerIndex(null);
                        }}
                      >
                        ::
                      </button>
                      <input
                        className="layer-name"
                        value={layer.name}
                        onChange={(event) => renameLayer(index, event.target.value)}
                        onFocus={() => setActiveLayerIndex(index)}
                        draggable={false}
                      />
                      <button
                        className="layer-visibility"
                        title={layer.visible ? "隐藏图层" : "显示图层"}
                        onClick={() => toggleLayerVisibility(index)}
                      >
                        {layer.visible ? "显" : "隐"}
                      </button>
                      <button
                        className={soloLayerIndex === index ? "layer-solo active" : "layer-solo"}
                        title={soloLayerIndex === index ? "取消独显" : "仅显示当前图层"}
                        onClick={() => toggleLayerSolo(index)}
                      >
                        S
                      </button>
                      <button
                        className={layer.locked ? "layer-lock active" : "layer-lock"}
                        title={layer.locked ? "解锁图层" : "锁定图层"}
                        onClick={() => toggleLayerLock(index)}
                      >
                        {layer.locked ? "锁" : "开"}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="layer-actions">
                  <button onClick={addLayer}>新建图层</button>
                  <button onClick={removeLayer} disabled={layers.length <= 1}>删除图层</button>
                </div>
                <p className="hint">
                  当前编辑：{activeLayer?.name}{activeLayer?.locked ? "（已锁定）" : ""}{soloLayerIndex !== null ? `；独显：${layers[soloLayerIndex]?.name}` : ""}
                </p>
              </div>
              <div className="frame-list timeline-list">
                {frames.map((frame, index) => (
                  <div
                    key={frame.id}
                    className={`frame-card ${activeIndex === index ? "selected" : ""} ${draggedFrameIndex === index ? "dragging" : ""}`}
                    draggable
                    onDragStart={() => setDraggedFrameIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedFrameIndex !== null) moveFrame(draggedFrameIndex, index);
                      setDraggedFrameIndex(null);
                    }}
                    onDragEnd={() => setDraggedFrameIndex(null)}
                  >
                    <button className="frame-thumb" onClick={() => setActiveIndex(index)}>
                      <FrameThumb frame={frame} layers={layers} soloLayerIndex={soloLayerIndex} />
                      <span>#{index + 1}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="panel frames-panel">
          <h2>导入与切帧</h2>
          <label className="file-drop">
            <span>选择 PNG sprite sheet</span>
            <input
              type="file"
              accept="image/png,image/webp,image/jpeg"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importImage(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <div className="project-actions">
            <button onClick={() => void saveProject()}>保存工程</button>
            <button onClick={() => void saveProject(true)}>另存为</button>
            <button onClick={() => void openProjectFromPicker()}>打开工程</button>
            <label className="project-file-button hidden-project-input">
              <input
                ref={projectFileInputRef}
                type="file"
                accept="application/json,.json,.pfe.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void (async () => {
                      const canContinue = await confirmUnsavedAction("打开其他工程会替换当前画布、帧和图层。");
                      if (canContinue) await openProject(file);
                    })();
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          <p className="project-status">
            当前工程：{projectTitle}{isDirty ? " *" : ""}<br />
            状态：{projectStatusLabel}
            {projectFileName && !projectFileBound ? "；未绑定保存位置，保存时会另存" : ""}
          </p>
          <div className="field-grid">
            <label>
              帧宽
              <input type="number" min="1" value={frameWidth} onChange={(event) => setFrameWidth(Number(event.target.value))} />
            </label>
            <label>
              帧高
              <input type="number" min="1" value={frameHeight} onChange={(event) => setFrameHeight(Number(event.target.value))} />
            </label>
            <label>
              列数
              <input type="number" min="1" value={columns} onChange={(event) => setColumns(Number(event.target.value))} />
            </label>
            <label>
              行数
              <input type="number" min="1" value={rows} onChange={(event) => setRows(Number(event.target.value))} />
            </label>
          </div>
          <button onClick={resliceCurrentSheet}>按当前设置重切</button>

          <h2>播放预览</h2>
          <canvas className="preview-canvas" ref={previewCanvasRef} />
          <div className="playback">
            <button onClick={() => setIsPlaying((value) => !value)}>{isPlaying ? "暂停" : "播放"}</button>
            <label>
              FPS
              <input type="number" min="1" max="30" value={fps} onChange={(event) => setFps(Number(event.target.value))} />
            </label>
          </div>
          <label>
            文件名
            <input value={sheetName} onChange={(event) => setSheetName(event.target.value)} />
          </label>

        </aside>
      </section>
    </main>
  );
}

function FrameThumb({ frame, layers, soloLayerIndex }: { frame: Frame; layers: Layer[]; soloLayerIndex: number | null }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const composited = compositeFrame(frame, layers, soloLayerIndex);
    const scale = Math.max(1, Math.floor(48 / Math.max(composited.width, composited.height)));
    canvas.width = composited.width * scale;
    canvas.height = composited.height * scale;
    const ctx = get2d(canvas);
    ctx.imageSmoothingEnabled = false;
    drawChecker(ctx, canvas.width, canvas.height, Math.max(4, scale * 4));
    ctx.drawImage(imageDataToCanvas(composited), 0, 0, canvas.width, canvas.height);
  }, [frame, layers, soloLayerIndex]);

  return <canvas ref={ref} aria-label="frame thumbnail" />;
}

declare global {
  interface Window {
    pixelFrameEditorRoot?: Root;
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<ProjectFileHandle[]>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<ProjectFileHandle>;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element is missing.");
}
window.pixelFrameEditorRoot ??= createRoot(rootElement);
window.pixelFrameEditorRoot.render(<App />);
