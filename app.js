const imageInput = document.getElementById('imageInput');
const sizeSelect = document.getElementById('sizeSelect');
const paletteSizeInput = document.getElementById('paletteSize');
const paletteSizeSlider = document.getElementById('paletteSizeSlider');
const processBtn = document.getElementById('processBtn');
const saveBtn = document.getElementById('saveBtn');
const originalCanvas = document.getElementById('originalCanvas');
const resultCanvas = document.getElementById('resultCanvas');
const sourcePalettePreview = document.getElementById('sourcePalettePreview');
const resultPalettePreview = document.getElementById('resultPalettePreview');

const originalCtx = originalCanvas.getContext('2d');
const resultCtx = resultCanvas.getContext('2d');

originalCtx.imageSmoothingEnabled = false;
resultCtx.imageSmoothingEnabled = false;

let sourceImage = null;

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

function selectDistantPalette(fullPalette, targetSize) {
  if (!fullPalette.length) return [];

  const sortedPalette = fullPalette
    .slice()
    .sort((a, b) => b.count - a.count);

  const maxPaletteSize = Math.min(targetSize, sortedPalette.length);
  const selected = [sortedPalette[0].color.slice()];

  while (selected.length < maxPaletteSize) {
    let bestCandidate = null;
    let bestDistance = -1;

    for (let i = 0; i < sortedPalette.length; i += 1) {
      const candidate = sortedPalette[i].color;
      let minDistanceToSelected = Infinity;

      for (let j = 0; j < selected.length; j += 1) {
        const d = distanceSq(candidate, selected[j]);
        if (d < minDistanceToSelected) {
          minDistanceToSelected = d;
        }
      }

      if (minDistanceToSelected > bestDistance) {
        bestDistance = minDistanceToSelected;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) break;
    selected.push(bestCandidate.slice());
  }

  return selected;
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

  const paletteSize = getClampedPaletteSize(paletteSizeInput.value);
  const sourcePixels = getCanvasPixels(originalCtx);
  const fullSourcePalette = extractSourcePalette(sourcePixels);
  const previewPalette = selectDistantPalette(fullSourcePalette, paletteSize);

  renderPalette(previewPalette, sourcePalettePreview);
}

function processImage() {
  if (!sourceImage) return;

  const size = Number(sizeSelect.value);
  const paletteSize = getClampedPaletteSize(paletteSizeInput.value);
  syncPaletteControls(paletteSize);

  resultCanvas.width = size;
  resultCanvas.height = size;

  const workCanvas = document.createElement('canvas');
  workCanvas.width = size;
  workCanvas.height = size;
  const workCtx = workCanvas.getContext('2d');
  workCtx.imageSmoothingEnabled = true;

  drawImageFitted(workCtx, sourceImage, size);

  const imageData = workCtx.getImageData(0, 0, size, size);
  const pixels = getPixels(imageData);

  const fullPalette = extractSourcePalette(pixels);
  const resultPalette = selectDistantPalette(fullPalette, paletteSize);
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
  workCtx.putImageData(imageData, 0, 0);
  resultCtx.imageSmoothingEnabled = false;
  resultCtx.drawImage(workCanvas, 0, 0, resultCanvas.width, resultCanvas.height);

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
      drawImageFitted(originalCtx, sourceImage, originalCanvas.width);
      renderOriginalPalette();
      processImage();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

processBtn.addEventListener('click', processImage);

paletteSizeInput.addEventListener('input', (event) => {
  syncPaletteControls(event.target.value, true);
});

paletteSizeInput.addEventListener('change', (event) => {
  syncPaletteControls(event.target.value, true);
});

paletteSizeSlider.addEventListener('input', (event) => {
  syncPaletteControls(event.target.value, true);
});

saveBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `painting-by-numbers-${Date.now()}.png`;
  link.href = resultCanvas.toDataURL('image/png');
  link.click();
});
