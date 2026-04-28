const imageInput = document.getElementById('imageInput');
const sizeSelect = document.getElementById('sizeSelect');
const paletteSizeInput = document.getElementById('paletteSize');
const processBtn = document.getElementById('processBtn');
const saveBtn = document.getElementById('saveBtn');
const originalCanvas = document.getElementById('originalCanvas');
const resultCanvas = document.getElementById('resultCanvas');
const palettePreview = document.getElementById('palettePreview');

const originalCtx = originalCanvas.getContext('2d');
const resultCtx = resultCanvas.getContext('2d');

originalCtx.imageSmoothingEnabled = false;
resultCtx.imageSmoothingEnabled = false;

let sourceImage = null;

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

function kMeansQuantization(pixels, k, maxIterations = 8) {
  if (!pixels.length) return [];

  const centroids = [];
  const step = Math.max(1, Math.floor(pixels.length / k));
  for (let i = 0; i < k; i += 1) {
    centroids.push(pixels[(i * step) % pixels.length].slice());
  }

  const assignments = new Array(pixels.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter += 1) {
    for (let p = 0; p < pixels.length; p += 1) {
      let bestCluster = 0;
      let bestDistance = Infinity;

      for (let c = 0; c < centroids.length; c += 1) {
        const d = distanceSq(pixels[p], centroids[c]);
        if (d < bestDistance) {
          bestDistance = d;
          bestCluster = c;
        }
      }

      assignments[p] = bestCluster;
    }

    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let p = 0; p < pixels.length; p += 1) {
      const cluster = assignments[p];
      sums[cluster][0] += pixels[p][0];
      sums[cluster][1] += pixels[p][1];
      sums[cluster][2] += pixels[p][2];
      sums[cluster][3] += 1;
    }

    for (let c = 0; c < k; c += 1) {
      if (sums[c][3] === 0) continue;
      centroids[c][0] = Math.round(sums[c][0] / sums[c][3]);
      centroids[c][1] = Math.round(sums[c][1] / sums[c][3]);
      centroids[c][2] = Math.round(sums[c][2] / sums[c][3]);
    }
  }

  return { centroids, assignments };
}

function mergeCloseColors(centroids, assignments, distanceThresholdSq = 26 * 26) {
  if (!centroids.length) {
    return { centroids: [], assignments: [] };
  }

  const groups = centroids.map((_, index) => [index]);

  for (let i = 0; i < groups.length; i += 1) {
    let merged = false;

    for (let j = i + 1; j < groups.length; j += 1) {
      const colorA = centroids[groups[i][0]];
      const colorB = centroids[groups[j][0]];

      if (distanceSq(colorA, colorB) <= distanceThresholdSq) {
        groups[i].push(...groups[j]);
        groups.splice(j, 1);
        merged = true;
        break;
      }
    }

    if (merged) {
      i -= 1;
    }
  }

  const centroidUseCount = new Array(centroids.length).fill(0);
  for (let i = 0; i < assignments.length; i += 1) {
    centroidUseCount[assignments[i]] += 1;
  }

  const mergedCentroids = [];
  const centroidToMerged = new Array(centroids.length).fill(0);

  groups.forEach((group, mergedIndex) => {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let totalWeight = 0;

    group.forEach((centroidIndex) => {
      const weight = centroidUseCount[centroidIndex] || 1;
      const centroid = centroids[centroidIndex];
      sumR += centroid[0] * weight;
      sumG += centroid[1] * weight;
      sumB += centroid[2] * weight;
      totalWeight += weight;
      centroidToMerged[centroidIndex] = mergedIndex;
    });

    mergedCentroids.push([
      Math.round(sumR / totalWeight),
      Math.round(sumG / totalWeight),
      Math.round(sumB / totalWeight),
    ]);
  });

  const mergedAssignments = assignments.map((cluster) => centroidToMerged[cluster]);

  return { centroids: mergedCentroids, assignments: mergedAssignments };
}

function renderPalette(colors) {
  palettePreview.innerHTML = '';
  colors.forEach((color) => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.title = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    swatch.style.backgroundColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    palettePreview.appendChild(swatch);
  });
}

function processImage() {
  if (!sourceImage) return;

  const size = Number(sizeSelect.value);
  const paletteSize = Number(paletteSizeInput.value) || 8;

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

  const quantized = kMeansQuantization(
    pixels,
    Math.max(2, Math.min(32, paletteSize))
  );
  const { centroids, assignments } = mergeCloseColors(
    quantized.centroids,
    quantized.assignments
  );

  for (let i = 0, p = 0; i < imageData.data.length; i += 4, p += 1) {
    const color = centroids[assignments[p]];
    imageData.data[i] = color[0];
    imageData.data[i + 1] = color[1];
    imageData.data[i + 2] = color[2];
    imageData.data[i + 3] = 255;
  }

  resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  workCtx.putImageData(imageData, 0, 0);
  resultCtx.imageSmoothingEnabled = false;
  resultCtx.drawImage(workCanvas, 0, 0, resultCanvas.width, resultCanvas.height);

  renderPalette(centroids);
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
      processImage();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

processBtn.addEventListener('click', processImage);

saveBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `painting-by-numbers-${Date.now()}.png`;
  link.href = resultCanvas.toDataURL('image/png');
  link.click();
});
