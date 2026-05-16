const imageInput = document.getElementById('imageInput');
const sizeSelect = document.getElementById('sizeSelect');
const paletteSizeInput = document.getElementById('paletteSize');
const paletteSizeSlider = document.getElementById('paletteSizeSlider');
const mergeDistanceInput = document.getElementById('mergeDistance');
const mergeDistanceSlider = document.getElementById('mergeDistanceSlider');
const processBtn = document.getElementById('processBtn');
const saveBtn = document.getElementById('saveBtn');
const originalCanvas = document.getElementById('originalCanvas');
const resultCanvas = document.getElementById('resultCanvas');
const finalSizeCanvas = document.getElementById('finalSizeCanvas');
const sourcePalettePreview = document.getElementById('sourcePalettePreview');
const sourcePaletteCount = document.getElementById('sourcePaletteCount');
const resultPalettePreview = document.getElementById('resultPalettePreview');
const originalImageSize = document.getElementById('originalImageSize');
const resultImageSize = document.getElementById('resultImageSize');

const originalCtx = originalCanvas.getContext('2d');
const resultCtx = resultCanvas.getContext('2d');
const finalSizeCtx = finalSizeCanvas.getContext('2d');

originalCtx.imageSmoothingEnabled = false;
resultCtx.imageSmoothingEnabled = false;
finalSizeCtx.imageSmoothingEnabled = false;

let sourceImage = null;
const TRANSPARENT_BACKGROUND_COLOR = '#ffffff';

function formatImageSize(width, height) {
  return `${width} × ${height} px`;
}

function updateOriginalImageSize() {
  if (!originalImageSize) return;
  if (!sourceImage) {
    originalImageSize.textContent = 'Исходный размер: —';
    return;
  }

  const width = sourceImage.naturalWidth || sourceImage.width;
  const height = sourceImage.naturalHeight || sourceImage.height;
  originalImageSize.textContent = `Исходный размер: ${formatImageSize(width, height)}`;
}

function updateResultImageSize(size) {
  if (!resultImageSize) return;
  resultImageSize.textContent = Number.isFinite(size)
    ? `Финальный размер: ${formatImageSize(size, size)}`
    : 'Финальный размер: —';
}

function getClampedPaletteSize(rawValue) {
  const value = Number(rawValue);
  if (Number.isNaN(value)) return 8;
  return Math.max(2, Math.min(32, Math.round(value)));
}

function syncPaletteControls(rawValue, shouldProcess = false) {
  const paletteSize = getClampedPaletteSize(rawValue);
  paletteSizeInput.value = String(paletteSize);
  paletteSizeSlider.value = String(paletteSize);

  if (sourceImage) {
    renderOriginalPalette();
  }

  if (shouldProcess && sourceImage) {
    processImage();
  }
}

function drawImageFitted(ctx, image, targetSize) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = TRANSPARENT_BACKGROUND_COLOR;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const side = Math.min(image.width, image.height);
  const sx = (image.width - side) / 2;
  const sy = (image.height - side) / 2;
  ctx.drawImage(image, sx, sy, side, side, 0, 0, targetSize, targetSize);
}

function getPixels(imageData) {
  const pixels = [];
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }

  return pixels;
}

function distanceSq(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function colorToKey(color) {
  return `${color[0]},${color[1]},${color[2]}`;
}

function extractSourcePalette(pixels) {
  const paletteMap = new Map();

  for (let i = 0; i < pixels.length; i += 1) {
    const color = pixels[i];
    const key = colorToKey(color);
    const existing = paletteMap.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    paletteMap.set(key, { color: color.slice(), count: 1 });
  }

  return Array.from(paletteMap.values());
}

function getClampedMergeDistance(rawValue) {
  const value = Number(rawValue);
  if (Number.isNaN(value)) return 48;
  return Math.max(0, Math.min(441.67, value));
}

function syncMergeDistanceControls(rawValue, shouldProcess = false) {
  const mergeDistance = getClampedMergeDistance(rawValue);
  const roundedMergeDistance = Math.round(mergeDistance);

  mergeDistanceInput.value = String(mergeDistance);
  mergeDistanceSlider.value = String(roundedMergeDistance);

  if (shouldProcess && sourceImage) {
    processImage();
  }
}

function distance(a, b) {
  return Math.sqrt(distanceSq(a, b));
}

function mergePaletteByDistance(fullPalette, mergeDistanceLimit) {
  if (!fullPalette.length) return [];
  const sortedPalette = fullPalette.slice().sort((a, b) => b.count - a.count);
  const mergedPalette = [];

  for (let i = 0; i < sortedPalette.length; i += 1) {
    const entry = sortedPalette[i];
    let merged = false;

    for (let j = 0; j < mergedPalette.length; j += 1) {
      const cluster = mergedPalette[j];
      if (distance(entry.color, cluster.color) < mergeDistanceLimit) {
        const nextCount = cluster.count + entry.count;
        cluster.color = [
          Math.round((cluster.color[0] * cluster.count + entry.color[0] * entry.count) / nextCount),
          Math.round((cluster.color[1] * cluster.count + entry.color[1] * entry.count) / nextCount),
          Math.round((cluster.color[2] * cluster.count + entry.color[2] * entry.count) / nextCount),
        ];
        cluster.count = nextCount;
        merged = true;
        break;
      }
    }

    if (!merged) {
      mergedPalette.push({ color: entry.color.slice(), count: entry.count });
    }
  }

  return mergedPalette;
}

function buildColorAssignmentMap(fullPalette, targetPalette) {
  const assignments = new Map();

  for (let i = 0; i < fullPalette.length; i += 1) {
    const sourceColor = fullPalette[i].color;
    const key = colorToKey(sourceColor);
    let bestIndex = 0;
    let bestDistance = Infinity;

    for (let j = 0; j < targetPalette.length; j += 1) {
      const d = distanceSq(sourceColor, targetPalette[j]);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = j;
      }
    }

    assignments.set(key, bestIndex);
  }

  return assignments;
}

function renderPalette(colors, container) {
  container.innerHTML = '';
  colors.forEach((color) => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.title = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    swatch.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    container.appendChild(swatch);
  });
}


function getCanvasPixels(ctx) {
  const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  return getPixels(imageData);
}

function renderOriginalPalette() {
  if (!sourceImage) return;

  const sourcePixels = getCanvasPixels(originalCtx);
  const fullSourcePalette = extractSourcePalette(sourcePixels).sort((a, b) => b.count - a.count);
  const limitedSourcePalette = fullSourcePalette.slice(0, 32).map((entry) => entry.color);

  if (sourcePaletteCount) {
    sourcePaletteCount.textContent = `Цветов: ${numberToRussian(fullSourcePalette.length)}`;
  }

  renderPalette(limitedSourcePalette, sourcePalettePreview);
}

function numberToRussian(value) {
  const integer = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

  const units = [
    'ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять',
    'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать',
    'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
  ];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  if (integer < 20) return units[integer];
  if (integer < 100) {
    const t = Math.floor(integer / 10);
    const u = integer % 10;
    return u === 0 ? tens[t] : `${tens[t]} ${units[u]}`;
  }

  if (integer < 1000) {
    const h = Math.floor(integer / 100);
    const rem = integer % 100;
    if (rem === 0) return hundreds[h];
    return `${hundreds[h]} ${numberToRussian(rem)}`;
  }

  return String(integer);
}

function processImage() {
  if (!sourceImage) return;

  const size = Number(sizeSelect.value);
  const paletteSize = getClampedPaletteSize(paletteSizeInput.value);
  const mergeDistanceLimit = getClampedMergeDistance(mergeDistanceInput.value);
  syncPaletteControls(paletteSize);
  syncMergeDistanceControls(mergeDistanceLimit);

  resultCanvas.width = size;
  resultCanvas.height = size;
  finalSizeCanvas.width = size;
  finalSizeCanvas.height = size;
  updateResultImageSize(size);

  const workCanvas = document.createElement('canvas');
  workCanvas.width = size;
  workCanvas.height = size;
  const workCtx = workCanvas.getContext('2d');
  workCtx.imageSmoothingEnabled = true;

  drawImageFitted(workCtx, sourceImage, size);

  const imageData = workCtx.getImageData(0, 0, size, size);
  const pixels = getPixels(imageData);

  const fullPalette = extractSourcePalette(pixels);
  const mergedPalette = mergePaletteByDistance(fullPalette, mergeDistanceLimit)
    .sort((a, b) => b.count - a.count);
  const resultPalette = mergedPalette.slice(0, paletteSize).map((entry) => entry.color.slice());
  const colorAssignments = buildColorAssignmentMap(fullPalette, resultPalette);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const sourceColor = [imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]];
    const colorKey = colorToKey(sourceColor);
    const paletteIndex = colorAssignments.get(colorKey) ?? 0;
    const color = resultPalette[paletteIndex];
    imageData.data[i] = color[0];
    imageData.data[i + 1] = color[1];
    imageData.data[i + 2] = color[2];
    imageData.data[i + 3] = 255;
  }

  resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  finalSizeCtx.clearRect(0, 0, finalSizeCanvas.width, finalSizeCanvas.height);
  workCtx.putImageData(imageData, 0, 0);
  resultCtx.imageSmoothingEnabled = false;
  finalSizeCtx.imageSmoothingEnabled = false;
  resultCtx.drawImage(workCanvas, 0, 0, resultCanvas.width, resultCanvas.height);
  finalSizeCtx.drawImage(workCanvas, 0, 0, finalSizeCanvas.width, finalSizeCanvas.height);

  renderPalette(resultPalette, resultPalettePreview);

  saveBtn.disabled = false;
}

imageInput.addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      updateOriginalImageSize();
      drawImageFitted(originalCtx, sourceImage, originalCanvas.width);
      renderOriginalPalette();
      processImage();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

processBtn.addEventListener('click', processImage);

sizeSelect.addEventListener('change', processImage);

paletteSizeInput.addEventListener('input', (event) => {
  syncPaletteControls(event.target.value, true);
});

paletteSizeInput.addEventListener('change', (event) => {
  syncPaletteControls(event.target.value, true);
});

paletteSizeSlider.addEventListener('input', (event) => {
  syncPaletteControls(event.target.value, true);
});

mergeDistanceInput.addEventListener('input', (event) => {
  syncMergeDistanceControls(event.target.value, true);
});

mergeDistanceInput.addEventListener('change', (event) => {
  syncMergeDistanceControls(event.target.value, true);
});

mergeDistanceSlider.addEventListener('input', (event) => {
  syncMergeDistanceControls(event.target.value, true);
});

saveBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `painting-by-numbers-${Date.now()}.png`;
  link.href = resultCanvas.toDataURL('image/png');
  link.click();
});
