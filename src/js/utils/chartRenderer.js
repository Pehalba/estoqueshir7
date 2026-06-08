function drawRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const fallbackH = Number(canvas.getAttribute('height')) || 220;
  const width = Math.max(rect.width || canvas.clientWidth || 300, 1);
  const height = Math.max(rect.height || fallbackH, 1);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function getColors() {
  const root = getComputedStyle(document.documentElement);
  return {
    primary: root.getPropertyValue('--color-primary').trim() || '#6b4fa0',
    success: root.getPropertyValue('--color-success').trim() || '#2e9e6b',
    muted: root.getPropertyValue('--color-text-muted').trim() || '#888',
    border: root.getPropertyValue('--color-border').trim() || '#e0e0e0',
    surface: root.getPropertyValue('--color-surface').trim() || '#fff',
  };
}

export function renderBarChart(canvas, { labels = [], values = [], color, title = '' }) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  const colors = getColors();
  const barColor = color || colors.primary;
  const padding = { top: title ? 28 : 16, right: 12, bottom: 36, left: 12 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const max = Math.max(...values, 1);

  ctx.clearRect(0, 0, width, height);

  if (title) {
    ctx.fillStyle = colors.muted;
    ctx.font = '600 12px Montserrat, sans-serif';
    ctx.fillText(title, padding.left, 18);
  }

  const barGap = 8;
  const barW = Math.max(12, (chartW - barGap * (labels.length - 1)) / Math.max(labels.length, 1));

  labels.forEach((label, i) => {
    const value = values[i] || 0;
    const barH = (value / max) * chartH;
    const x = padding.left + i * (barW + barGap);
    const y = padding.top + chartH - barH;

    ctx.fillStyle = barColor;
    drawRoundRect(ctx, x, y, barW, barH, 4);
    ctx.fill();

    ctx.fillStyle = colors.muted;
    ctx.font = '500 10px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + barW / 2, height - 10);
    ctx.textAlign = 'left';
  });
}

export function renderGroupedBarChart(canvas, { labels = [], series = [], title = '' }) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  const colors = getColors();
  const palette = [colors.primary, colors.success, '#c9a227'];
  const padding = { top: title ? 36 : 20, right: 12, bottom: 36, left: 12 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const allValues = series.flatMap((s) => s.values);
  const max = Math.max(...allValues, 1);
  const groupCount = labels.length;
  const seriesCount = Math.max(series.length, 1);

  ctx.clearRect(0, 0, width, height);

  if (!labels.length) {
    ctx.fillStyle = colors.muted;
    ctx.font = '500 12px Montserrat, sans-serif';
    ctx.fillText('Sem dados no período', padding.left, padding.top + 20);
    return;
  }

  if (title) {
    ctx.fillStyle = colors.muted;
    ctx.font = '600 12px Montserrat, sans-serif';
    ctx.fillText(title, padding.left, 18);
  }

  let legendX = padding.left;
  series.forEach((s, si) => {
    ctx.fillStyle = palette[si % palette.length];
    ctx.fillRect(legendX, title ? 24 : 6, 10, 10);
    ctx.fillStyle = colors.muted;
    ctx.font = '500 10px Montserrat, sans-serif';
    ctx.fillText(s.name, legendX + 14, title ? 14 : 6);
    legendX += ctx.measureText(s.name).width + 28;
  });

  const groupW = chartW / Math.max(groupCount, 1);
  const innerGap = 4;
  const barW = Math.max(8, (groupW - innerGap * (seriesCount + 1)) / seriesCount);

  labels.forEach((label, gi) => {
    const groupX = padding.left + gi * groupW;
    series.forEach((s, si) => {
      const value = s.values[gi] || 0;
      const barH = (value / max) * chartH;
      const x = groupX + innerGap + si * (barW + innerGap);
      const y = padding.top + chartH - barH;
      ctx.fillStyle = palette[si % palette.length];
      drawRoundRect(ctx, x, y, barW, barH, 3);
      ctx.fill();
    });

    ctx.fillStyle = colors.muted;
    ctx.font = '500 10px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, groupX + groupW / 2, height - 10);
    ctx.textAlign = 'left';
  });
}

export function renderDoughnutChart(canvas, { labels = [], values = [], title = '' }) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  const colors = getColors();
  const palette = [colors.primary, colors.success, '#c9a227', '#e07a5f'];
  const padding = title ? 28 : 12;
  const size = Math.min(width, height) - padding * 2;
  const cx = width / 2;
  const cy = padding + size / 2;
  const radius = size / 2;
  const inner = radius * 0.55;
  const total = values.reduce((sum, v) => sum + v, 0) || 1;

  ctx.clearRect(0, 0, width, height);

  if (title) {
    ctx.fillStyle = colors.muted;
    ctx.font = '600 12px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, cx, 18);
    ctx.textAlign = 'left';
  }

  let start = -Math.PI / 2;
  values.forEach((value, i) => {
    const slice = (value / total) * Math.PI * 2;
    ctx.fillStyle = palette[i % palette.length];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + slice);
    ctx.closePath();
    ctx.fill();
    start += slice;
  });

  ctx.fillStyle = colors.surface;
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fill();

  let legendY = height - 14;
  labels.forEach((label, i) => {
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect(12, legendY - 8, 10, 10);
    ctx.fillStyle = colors.muted;
    ctx.font = '500 10px Montserrat, sans-serif';
    ctx.fillText(`${label}: ${values[i] || 0}`, 26, legendY);
    legendY -= 14;
  });
}
