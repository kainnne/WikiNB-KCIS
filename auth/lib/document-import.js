import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';

const SUPPORTED_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
  '.docx',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
]);

const MIME_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
]);

function safeStem(filename) {
  const ext = path.extname(String(filename || ''));
  const stem = path.basename(String(filename || 'document'), ext);
  return (
    stem
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `document-${Date.now()}`
  );
}

function escapeMarkdown(value) {
  return String(value || '').replace(/([\\`*_[\]<>])/g, '\\$1');
}

function sanitizeImportedHtml(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: [
      'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
      'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'table', 'thead', 'tbody',
      'tfoot', 'tr', 'th', 'td', 'caption', 'a', 'img', 'hr', 'sup', 'sub', 'figure',
      'figcaption',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' },
      }),
      img: (_tagName, attribs) => ({
        tagName: 'img',
        attribs: { ...attribs, loading: 'lazy' },
      }),
    },
  });
}

async function docxToHtml(buffer, assetDir, assetUrlPrefix) {
  let imageIndex = 0;
  fs.mkdirSync(assetDir, { recursive: true });
  const converted = await mammoth.convertToHtml(
    { buffer },
    {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async (image) => {
        imageIndex += 1;
        const ext = MIME_EXTENSIONS.get(image.contentType) || '.bin';
        const filename = `image-${String(imageIndex).padStart(2, '0')}${ext}`;
        fs.writeFileSync(path.join(assetDir, filename), await image.readAsBuffer());
        return { src: `${assetUrlPrefix}/${filename}`, loading: 'lazy' };
      }),
    },
  );
  return {
    html: sanitizeImportedHtml(converted.value),
    warnings: converted.messages.map((item) => item.message).filter(Boolean),
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 12;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pdfItemFontSize(item) {
  const transform = item?.transform || [];
  return Math.max(1, Math.hypot(Number(transform[0]) || 0, Number(transform[1]) || 0));
}

function shouldJoinWithoutSpace(left, right) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(left)
    || /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？；：、）】》]/u.test(right)
    || /[(（【《]$/u.test(left);
}

function joinPdfText(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a) return b;
  if (!b) return a;
  if (a.endsWith('-') && /^[A-Za-z]/.test(b)) return `${a.slice(0, -1)}${b}`;
  return shouldJoinWithoutSpace(a, b) ? `${a}${b}` : `${a} ${b}`;
}

function cleanPdfText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyPdfMath(text) {
  const value = cleanPdfText(text);
  const notMath = (reason) => ({ isMath: false, confidence: 0, reasons: [reason] });
  if (!value || value.length > 220) return notMath('empty-or-too-long');
  if (/^(const|let|var|function|class|import|export)\s|[{};].*(?:=>|=)/.test(value)) {
    return notMath('program-code');
  }

  const explicitLatex = /(?:\$\$?|\\\(|\\\[|\\(?:frac|sum|sqrt|int|lim|begin)\b)/.test(value);
  const advancedSyntax = /(?:\^|_[A-Za-z0-9]|\bsum\s*\(|\bsqrt\s*\(|[∑√∫∞])/i.test(value);
  const relation = /(?:=|≠|≈|≤|≥|<|>)/.test(value);
  const arithmetic = /(?:\s[+\-*/]\s|[±×÷])/.test(value);
  const singleLetterVariables = value.match(/(?:^|[^A-Za-z])[A-Za-z](?=$|[^A-Za-z])/g) || [];
  const functionNotation = /\b[A-Za-z][A-Za-z0-9_]*\s*\([^)]*\)/.test(value);
  const numericSequence = /^[\d\s.,:/%+\-]+$/.test(value)
    || /^(?:numbers?|date|time|page|頁碼|日期|時間|編號|數字)\s*[:：]/i.test(value);
  const measurement = /^\s*\d+(?:\.\d+)?\s*[×x*]\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|km|px|pt|in|kg|g|ml|l)\s*$/i.test(value);
  const prosePrefix = /^.{2,28}[:：]\s*/u.test(value)
    && !/^(?:公式|方程式|equation|formula)\s*[:：]/i.test(value);
  const symbolLegend = prosePrefix && !relation && singleLetterVariables.length === 0;
  if (numericSequence) return notMath('numeric-sequence');
  if (measurement) return notMath('measurement');
  if (symbolLegend) return notMath('symbol-legend');

  let score = 0;
  const reasons = [];
  if (explicitLatex) {
    score += 6;
    reasons.push('explicit-latex');
  }
  if (advancedSyntax) {
    score += 3;
    reasons.push('advanced-math-syntax');
  }
  if (relation && singleLetterVariables.length) {
    score += 3;
    reasons.push('variable-relation');
  } else if (relation && arithmetic) {
    score += 3;
    reasons.push('arithmetic-relation');
  }
  if (functionNotation) {
    score += 2;
    reasons.push('function-notation');
  }
  if (arithmetic && singleLetterVariables.length >= 2) {
    score += 2;
    reasons.push('symbolic-expression');
  }
  if (relation && /^[A-Za-z0-9\s()[\]_=+\-*/^.,|∞∑√∫±×÷<>]+$/u.test(value)) {
    score += 1;
    reasons.push('low-prose-density');
  }
  if (prosePrefix) score -= 2;
  const isMath = score >= 4 && (explicitLatex || relation || (advancedSyntax && singleLetterVariables.length));
  return {
    isMath,
    confidence: Math.max(0, Math.min(1, score / 8)),
    reasons: reasons.length ? reasons : ['insufficient-math-structure'],
  };
}

function normalizePdfMath(text) {
  return cleanPdfText(text)
    .replace(/\bsum\s*\(\s*([A-Za-z])\s*=\s*([^.)]+)\.\.([^.)]+)\s*\)/gi, '\\sum_{$1=$2}^{$3}')
    .replace(/\bsqrt\s*\(([^()]+)\)/gi, '\\sqrt{$1}')
    .replace(/\s+\|\s+/g, ' \\mid ')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/±/g, '\\pm ')
    .replace(/∞/g, '\\infty ')
    .replace(/→/g, '\\to ')
    .replace(/←/g, '\\leftarrow ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergePdfRowItems(items) {
  const ordered = items.slice().sort((a, b) => a.x - b.x);
  const segments = [];
  for (const item of ordered) {
    const text = cleanPdfText(item.text);
    if (!text) {
      const previous = segments.at(-1);
      if (previous) {
        previous.xEnd = Math.max(previous.xEnd, item.x + item.width);
        previous.width = previous.xEnd - previous.x;
      }
      continue;
    }
    const previous = segments.at(-1);
    const gap = previous ? item.x - previous.xEnd : Number.POSITIVE_INFINITY;
    const joinThreshold = Math.max(13, Math.min(previous?.fontSize || item.fontSize, item.fontSize) * 1.25);
    if (previous && gap <= joinThreshold) {
      previous.text = /^\d{1,3}$/.test(previous.text)
        ? `${previous.text} ${text}`
        : joinPdfText(previous.text, text);
      previous.xEnd = Math.max(previous.xEnd, item.x + item.width);
      previous.width = previous.xEnd - previous.x;
      previous.fontSize = Math.max(previous.fontSize, item.fontSize);
    } else {
      segments.push({
        text,
        x: item.x,
        xEnd: item.x + item.width,
        width: item.width,
        y: item.y,
        fontSize: item.fontSize,
      });
    }
  }
  return segments;
}

function extractPdfRows(content) {
  const sourceItems = content.items
    .filter((item) => 'str' in item && String(item.str || '').trim())
    .map((item) => ({
      text: item.str,
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0,
      width: Number(item.width) || 0,
      fontSize: pdfItemFontSize(item),
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  for (const item of sourceItems) {
    const tolerance = Math.max(2, item.fontSize * 0.38);
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) {
      row.items.push(item);
      row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => ({
      y: row.y,
      segments: mergePdfRowItems(row.items),
    }))
    .filter((row) => row.segments.length);
}

function rowsForSegments(rows, predicate) {
  return rows
    .map((row) => ({ ...row, segments: row.segments.filter(predicate) }))
    .filter((row) => row.segments.length);
}

function orderPdfRegions(rows, pageWidth, pageHeight) {
  const withoutPageLabels = rowsForSegments(
    rows,
    (segment) => !/^PAGE\s+\d+\s*\//i.test(segment.text),
  );
  const headerCutoff = pageHeight * 0.86;
  const footerCutoff = pageHeight * 0.08;
  const core = withoutPageLabels.filter((row) => row.y <= headerCutoff && row.y >= footerCutoff);
  const leftCount = core.flatMap((row) => row.segments).filter((segment) => segment.x < pageWidth * 0.47).length;
  const rightCount = core.flatMap((row) => row.segments).filter((segment) => segment.x >= pageWidth * 0.5).length;
  const isTwoColumn = leftCount >= 4 && rightCount >= 4;
  if (!isTwoColumn) return [withoutPageLabels];

  const header = withoutPageLabels.filter((row) => row.y > headerCutoff);
  const footer = withoutPageLabels.filter((row) => row.y < footerCutoff);
  const middle = withoutPageLabels.filter((row) => row.y <= headerCutoff && row.y >= footerCutoff);
  return [
    header,
    rowsForSegments(middle, (segment) => segment.x < pageWidth * 0.5),
    rowsForSegments(middle, (segment) => segment.x >= pageWidth * 0.5),
    footer,
  ].filter((region) => region.length);
}

function tableAt(rows, start) {
  const first = rows[start];
  const columnCount = first?.segments.length || 0;
  if (columnCount < 3) return null;
  const tableRows = [first];
  let end = start;
  for (let index = start + 1; index < rows.length; index += 1) {
    const candidate = rows[index];
    const gap = tableRows.at(-1).y - candidate.y;
    if (gap > 55 || candidate.segments.length !== columnCount) break;
    const aligned = candidate.segments.every((segment, column) => (
      Math.abs(segment.x - first.segments[column].x) <= 28
    ));
    if (!aligned) break;
    tableRows.push(candidate);
    end = index;
  }
  return tableRows.length >= 3 ? { rows: tableRows, end } : null;
}

function listAt(rows, start, bodySize) {
  const first = rows[start];
  if (first?.segments.length !== 1 || first.segments[0].text.length > 32) return null;
  const items = [first.segments[0]];
  let end = start;
  for (let index = start + 1; index < rows.length; index += 1) {
    const candidate = rows[index];
    if (candidate.segments.length !== 1) break;
    const segment = candidate.segments[0];
    const gap = items.at(-1).y - segment.y;
    if (Math.abs(segment.x - first.segments[0].x) > 8 || gap < bodySize || gap > bodySize * 3) break;
    if (segment.text.length > 32 || segment.fontSize > bodySize * 1.4) break;
    items.push(segment);
    end = index;
  }
  return items.length >= 3 ? { items, end } : null;
}

function pdfRowsToBlocks(rows, pageNumber, pageWidth, pageHeight) {
  const allSegments = rows.flatMap((row) => row.segments);
  const bodySize = median(allSegments.map((segment) => segment.fontSize));
  const blocks = [];
  let paragraph = null;

  const flushParagraph = () => {
    if (!paragraph?.text) return;
    blocks.push({ type: 'paragraph', text: paragraph.text, page: pageNumber });
    paragraph = null;
  };

  for (const region of orderPdfRegions(rows, pageWidth, pageHeight)) {
    flushParagraph();
    for (let rowIndex = 0; rowIndex < region.length; rowIndex += 1) {
      const table = tableAt(region, rowIndex);
      if (table) {
        flushParagraph();
        blocks.push({
          type: 'table',
          headers: table.rows[0].segments.map((segment) => segment.text),
          rows: table.rows.slice(1).map((row) => row.segments.map((segment) => segment.text)),
          page: pageNumber,
        });
        rowIndex = table.end;
        continue;
      }

      const list = listAt(region, rowIndex, bodySize);
      if (list) {
        flushParagraph();
        blocks.push({ type: 'list', items: list.items.map((item) => item.text), page: pageNumber });
        rowIndex = list.end;
        continue;
      }

      const row = region[rowIndex];
      if (row.segments.length >= 3) {
        flushParagraph();
        blocks.push({ type: 'labels', items: row.segments.map((segment) => segment.text), page: pageNumber });
        continue;
      }

      for (const segment of row.segments) {
        const text = segment.text.trim();
        const ratio = segment.fontSize / Math.max(bodySize, 1);
        const isShort = text.length <= 110;
        const bullet = text.match(/^[•●▪◦‣‧]\s*(.+)$/u) || text.match(/^[-–—]\s+(.+)$/u);
        const isQuote = /^[「『“\"]/.test(text) && /[」』”\"]$/.test(text);
        const isCode = /^(const|let|var|function|class|import|export)\s/.test(text);
        const math = classifyPdfMath(text);
        const isAllCapsLabel = /^[A-Z0-9][A-Z0-9 /+_.-]{3,60}$/.test(text);
        const isHeading = isShort && (ratio >= 1.32 || isAllCapsLabel) && !/[。！？.!?]$/.test(text);

        if (math.isMath) {
          flushParagraph();
          blocks.push({
            type: 'math',
            text: normalizePdfMath(text),
            sourceText: text,
            confidence: math.confidence,
            classificationReasons: math.reasons,
            page: pageNumber,
          });
          continue;
        }
        if (isCode) {
          flushParagraph();
          blocks.push({ type: 'code', text, page: pageNumber });
          continue;
        }
        if (isQuote) {
          flushParagraph();
          blocks.push({ type: 'quote', text, page: pageNumber });
          continue;
        }
        if (isHeading) {
          flushParagraph();
          blocks.push({ type: 'heading', level: ratio >= 1.75 ? 2 : 3, text, page: pageNumber });
          continue;
        }
        if (bullet) {
          flushParagraph();
          const last = blocks.at(-1);
          if (last?.type === 'list') last.items.push(bullet[1]);
          else blocks.push({ type: 'list', items: [bullet[1]], page: pageNumber });
          continue;
        }

        const horizontalJump = paragraph ? Math.abs(segment.x - paragraph.x) : 0;
        const verticalGap = paragraph ? paragraph.y - segment.y : 0;
        const shouldBreak = paragraph && (
          horizontalJump > 24
          || verticalGap <= 0
          || verticalGap > bodySize * 2.6
          || (verticalGap > bodySize * 1.55 && /[。！？.!?:：；;]$/.test(paragraph.text))
        );
        if (shouldBreak) flushParagraph();
        if (!paragraph) paragraph = { text, x: segment.x, y: segment.y, page: pageNumber };
        else {
          paragraph.text = joinPdfText(paragraph.text, text);
          paragraph.y = segment.y;
        }
      }
    }
  }
  flushParagraph();
  return blocks;
}

function blocksToMarkdown(blocks) {
  return blocks.map((block) => {
    if (block.type === 'heading') return `${'#'.repeat(block.level)} ${escapeMarkdown(block.text)}`;
    if (block.type === 'list') return block.items.map((item) => `- ${escapeMarkdown(item)}`).join('\n');
    if (block.type === 'quote') return `> ${escapeMarkdown(block.text)}`;
    if (block.type === 'math') return `$$\n${block.text}\n$$`;
    if (block.type === 'code') return `\`\`\`\n${block.text.replace(/\`\`\`/g, '\`\`\\\`')}\n\`\`\``;
    if (block.type === 'labels') return block.items.map(escapeMarkdown).join(' · ');
    if (block.type === 'table') {
      const cell = (value) => escapeMarkdown(value).replace(/\|/g, '\\|');
      return [
        `| ${block.headers.map(cell).join(' | ')} |`,
        `| ${block.headers.map(() => '---').join(' | ')} |`,
        ...block.rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ].join('\n');
    }
    return escapeMarkdown(block.text);
  }).join('\n\n');
}

function medianChannel(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function sampledPageBackground(data, width, height) {
  const samples = [];
  const inset = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const points = [
    [inset, inset],
    [width - inset - 1, inset],
    [inset, height - inset - 1],
    [width - inset - 1, height - inset - 1],
  ];
  for (const [centerX, centerY] of points) {
    for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        const x = Math.max(0, Math.min(width - 1, centerX + offsetX));
        const y = Math.max(0, Math.min(height - 1, centerY + offsetY));
        const index = (y * width + x) * 4;
        samples.push([data[index], data[index + 1], data[index + 2]]);
      }
    }
  }
  return [0, 1, 2].map((channel) => medianChannel(samples.map((sample) => sample[channel])));
}

/**
 * 從均勻底色頁面找出主要連通圖形。標題通常是矮而寬的獨立區塊，會被高度門檻排除；
 * 若找不到明顯的單一主圖，回傳 null 並保留整頁，避免把教材錯切成殘缺圖片。
 */
function dominantPdfFigureBounds(canvas) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  const background = sampledPageBackground(data, width, height);
  const cellSize = 7;
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  const active = new Uint8Array(gridWidth * gridHeight);
  // 淺色卡片底不應壓過真正的圖形；42 可排除近似頁面底色，同時保留線條與彩色物件。
  const colorThresholdSquared = 42 * 42;

  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      let changed = 0;
      let sampled = 0;
      const startX = gridX * cellSize;
      const startY = gridY * cellSize;
      for (let y = startY; y < Math.min(height, startY + cellSize); y += 2) {
        for (let x = startX; x < Math.min(width, startX + cellSize); x += 2) {
          const index = (y * width + x) * 4;
          const red = data[index] - background[0];
          const green = data[index + 1] - background[1];
          const blue = data[index + 2] - background[2];
          if (red * red + green * green + blue * blue >= colorThresholdSquared) changed += 1;
          sampled += 1;
        }
      }
      if (changed >= Math.max(2, Math.ceil(sampled * 0.08))) active[gridY * gridWidth + gridX] = 1;
    }
  }

  const connected = new Uint8Array(active.length);
  const dilation = 2;
  for (let index = 0; index < active.length; index += 1) {
    if (!active[index]) continue;
    const sourceX = index % gridWidth;
    const sourceY = Math.floor(index / gridWidth);
    for (let dy = -dilation; dy <= dilation; dy += 1) {
      for (let dx = -dilation; dx <= dilation; dx += 1) {
        const x = sourceX + dx;
        const y = sourceY + dy;
        if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) connected[y * gridWidth + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(connected.length);
  const candidates = [];
  for (let start = 0; start < connected.length; start += 1) {
    if (!connected[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let cursor = 0;
    let minX = gridWidth;
    let minY = gridHeight;
    let maxX = 0;
    let maxY = 0;
    let inkCells = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const x = index % gridWidth;
      const y = Math.floor(index / gridWidth);
      if (active[index]) {
        inkCells += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= gridWidth || nextY < 0 || nextY >= gridHeight) continue;
          const next = nextY * gridWidth + nextX;
          if (connected[next] && !visited[next]) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    if (!inkCells) continue;
    const cellWidth = maxX - minX + 1;
    const cellHeight = maxY - minY + 1;
    if (cellWidth < gridWidth * 0.16 || cellHeight < gridHeight * 0.10 || inkCells < 28) continue;
    const areaRatio = (cellWidth * cellHeight) / (gridWidth * gridHeight);
    const inkDensity = inkCells / (cellWidth * cellHeight);
    if (areaRatio < 0.025 || areaRatio > 0.78) continue;
    // 接近實心的大色塊多半是頁首或文字卡片，不應誤認為獨立圖表。
    if (inkDensity > 0.68) continue;
    candidates.push({
      minX,
      minY,
      maxX,
      maxY,
      inkCells,
      inkDensity,
      areaRatio,
      score: inkCells * (1 + areaRatio) * (1 - inkDensity * 0.35),
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  const runnerUp = candidates[1];
  if (runnerUp && best.score < runnerUp.score * 1.3) return null;

  const padding = Math.round(Math.min(width, height) * 0.025);
  const x = Math.max(0, best.minX * cellSize - padding);
  const y = Math.max(0, best.minY * cellSize - padding);
  const right = Math.min(width, (best.maxX + 1) * cellSize + padding);
  const bottom = Math.min(height, (best.maxY + 1) * cellSize + padding);
  return { x, y, width: right - x, height: bottom - y, confidence: runnerUp ? 0.82 : 0.9 };
}

async function renderPdfVisualAsset(page, assetDir, pageNumber) {
  const viewport = page.getViewport({ scale: 1.55 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const crop = dominantPdfFigureBounds(canvas);
  const prefix = crop ? 'pdf-figure' : 'pdf-page';
  const name = `${prefix}-${String(pageNumber).padStart(3, '0')}.png`;
  if (!crop) {
    fs.writeFileSync(path.join(assetDir, name), canvas.toBuffer('image/png'));
    return { name, kind: 'full-page', crop: null };
  }
  const figure = createCanvas(crop.width, crop.height);
  figure.getContext('2d').drawImage(
    canvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  fs.writeFileSync(path.join(assetDir, name), figure.toBuffer('image/png'));
  return {
    name,
    kind: 'figure-crop',
    crop: {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
      sourceWidth: canvas.width,
      sourceHeight: canvas.height,
      confidence: crop.confidence,
    },
  };
}

async function pdfToDocument(buffer, assetDir, assetUrlPrefix) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const metadata = await pdf.getMetadata().catch(() => ({ info: {}, metadata: null }));
  const pages = [];
  const warnings = [];
  let renderedPages = 0;
  fs.mkdirSync(assetDir, { recursive: true });
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const [content, operators, annotations] = await Promise.all([
        page.getTextContent({ includeMarkedContent: true }),
        page.getOperatorList(),
        page.getAnnotations({ intent: 'display' }),
      ]);
      const viewport = page.getViewport({ scale: 1 });
      const rows = extractPdfRows(content);
      const blocks = pdfRowsToBlocks(rows, pageNumber, viewport.width, viewport.height);
      const imageOps = new Set([
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintImageMaskXObject,
        pdfjs.OPS.paintSolidColorImageMask,
      ]);
      const imageCount = operators.fnArray.filter((op) => imageOps.has(op)).length;
      const vectorCount = operators.fnArray.filter((op) => op === pdfjs.OPS.constructPath).length;
      const visualHeavy = imageCount > 0 || vectorCount >= 8 || (!rows.length && vectorCount > 0);
      let image = '';
      let visualRender = null;

      if (visualHeavy && renderedPages < 12) {
        try {
          visualRender = await renderPdfVisualAsset(page, assetDir, pageNumber);
          image = `${assetUrlPrefix}/${visualRender.name}`;
          renderedPages += 1;
        } catch (error) {
          warnings.push(`第 ${pageNumber} 頁的視覺內容無法轉成圖片：${error?.message || error}`);
        }
      } else if (visualHeavy) {
        warnings.push('視覺頁面超過 12 頁；其餘頁面保留文字與原始 PDF 連結。');
      }

      pages.push({
        number: pageNumber,
        blocks,
        image,
        links: annotations
          .filter((annotation) => /^(https?:|mailto:)/i.test(String(annotation.url || '')))
          .map((annotation) => ({
            label: String(annotation.title || annotation.contents || annotation.url).trim(),
            url: String(annotation.url).trim(),
          })),
        textLength: rows.flatMap((row) => row.segments).reduce((sum, segment) => sum + segment.text.length, 0),
        visualHeavy,
        visual: {
          kind: imageCount > 0 ? 'mixed-image-layout' : vectorCount >= 8 ? 'vector-layout' : 'text-layout',
          embeddedImageOperations: imageCount,
          vectorPathOperations: vectorCount,
          renderedAsset: image || null,
          renderMode: visualRender?.kind || null,
          crop: visualRender?.crop || null,
        },
      });
      page.cleanup();
    }
  } finally {
    if (typeof loadingTask.destroy === 'function') await loadingTask.destroy();
  }

  return {
    pageCount,
    pages,
    warnings,
    renderedPages,
    metadata: {
      title: cleanPdfText(metadata?.info?.Title),
      author: cleanPdfText(metadata?.info?.Author),
      subject: cleanPdfText(metadata?.info?.Subject),
    },
  };
}

export function isSupportedDocument(filename) {
  return SUPPORTED_EXTENSIONS.has(path.extname(String(filename || '')).toLowerCase());
}

export function supportedDocumentExtensions() {
  return [...SUPPORTED_EXTENSIONS];
}

/**
 * 將常見教材整理成可由 Wiki renderer 顯示的 Markdown／安全 HTML。
 * 影像與原檔由呼叫端決定存放位置，這裡只寫 DOCX 內嵌影像。
 */
export async function convertDocument({ filename, buffer, assetDir, assetUrlPrefix, originalUrl }) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error(`尚不支援 ${ext || '此'} 格式`);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('上傳檔案是空的');

  const title = safeStem(filename).replace(/-/g, ' ');
  const warnings = [];
  let body = '';
  if (ext === '.md' || ext === '.markdown') {
    body = buffer.toString('utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  } else if (ext === '.txt') {
    body = `# ${escapeMarkdown(title)}\n\n${escapeMarkdown(buffer.toString('utf8').trim())}`;
  } else if (ext === '.html' || ext === '.htm') {
    body = `# ${escapeMarkdown(title)}\n\n${sanitizeImportedHtml(buffer.toString('utf8'))}`;
  } else if (ext === '.docx') {
    const converted = await docxToHtml(buffer, assetDir, assetUrlPrefix);
    body = `# ${escapeMarkdown(title)}\n\n${converted.html}`;
    warnings.push(...converted.warnings);
  } else if (ext === '.pdf') {
    const converted = await pdfToDocument(buffer, assetDir, assetUrlPrefix);
    const pdfTitle = converted.metadata.title || title;
    const pageBodies = converted.pages.map((page) => {
      const parts = [];
      if (page.image) {
        const alt = page.visual?.renderMode === 'figure-crop'
          ? `Figure from page ${page.number}`
          : `Original page ${page.number}`;
        parts.push(`<figure class="pdf-visual-page"><img src="${page.image}" alt="${alt}" loading="lazy"></figure>`);
      }
      if (page.blocks.length) parts.push(blocksToMarkdown(page.blocks));
      else parts.push('*No searchable text on this page. Download the original PDF.*');
      if (page.links.length) {
        const links = page.links.map((link) => `- [${escapeMarkdown(link.label)}](${link.url})`).join('\n');
        parts.push(`**Related links**\n\n${links}`);
      }
      return parts.join('\n\n');
    });
    body = `# ${escapeMarkdown(pdfTitle)}\n\n${pageBodies.join('\n\n<hr class="pdf-page-divider">\n\n')}`;
    warnings.push(...converted.warnings);
    return {
      title: pdfTitle,
      body: body.trim(),
      warnings,
      extension: ext,
      source: { type: 'pdf', pageCount: converted.pageCount, originalName: filename },
      document: {
        schemaVersion: 1,
        conversionVersion: 4,
        sourceType: 'pdf',
        originalName: filename,
        metadata: converted.metadata,
        pageCount: converted.pageCount,
        renderedPages: converted.renderedPages,
        pages: converted.pages,
      },
    };
  } else {
    body = originalUrl
      ? `# ${escapeMarkdown(title)}\n\n![${escapeMarkdown(title)}](${originalUrl})`
      : `# ${escapeMarkdown(title)}\n\n原始圖片已安全保存在私有課堂，並會直接提供給 Gemini 視覺模型。`;
  }

  return { title, body: body.trim(), warnings, extension: ext, source: null, document: null };
}
