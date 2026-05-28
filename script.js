/* ============================================================
   Viora Studio Tools — main script
   Pure ES module. All logic lives here.
   ============================================================ */

// ---- Viora AI (используется внутренний API сервиса) ----
const VIORA_AI_KEY = 'W3fKNQC6YjfB51B4c8eofiAiwSktHasu';
const VIORA_AI_MODEL = 'mistral-large-latest';
const VIORA_AI_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const VIORA_AI_SYSTEM = [
  'Ты — Viora AI. Твоя задача — сгенерировать готовый текст документа (резюме, договор, заявление, письмо, статья и т.п.), который сразу будет преобразован в PDF-файл и отдан пользователю на скачивание.',
  '',
  'Правила ответа — соблюдай строго:',
  '1. Возвращай ТОЛЬКО содержимое документа. Никаких пояснений, инструкций «как сохранить в PDF», предложений помощи в конце, фраз вроде «вот ваш документ», «надеюсь, поможет», «если нужно, могу добавить».',
  '2. Не упоминай, что ты ИИ. Не описывай свой ответ. Не задавай вопросов.',
  '3. Используй разметку Markdown для структуры:',
  '   - `# Заголовок документа` — один раз, в самом начале (например «Резюме», «Договор аренды квартиры»).',
  '   - `## Раздел`, `### Подраздел` — для подзаголовков.',
  '   - `**жирный**` — для важных терминов, должностей, реквизитов.',
  '   - `- пункт` — для маркированных списков (навыки, обязанности).',
  '   - `1. пункт` — для нумерованных списков (пункты договора).',
  '   - Пустая строка между абзацами.',
  '4. Язык — русский. Тон — деловой, по делу, без воды.',
  '5. Заполняй документ реалистичными данными. Если не хватает деталей — используй разумные значения по умолчанию (например, для договора — стандартные пункты ГК РФ).',
  '6. Не используй горизонтальные разделители (`---`), таблицы, цитаты и блоки кода.',
].join('\n');

// ---- Cobalt (video) ----
// Список публичных инстансов с CORS. Перебираем по очереди.
const COBALT_INSTANCES = [
  'https://co.eepy.today/',
  'https://api.cobalt.tools/',
];

// Перевод кодов ошибок Cobalt в человеческие сообщения
function humanizeCobaltError(code) {
  if (!code) return '';
  const map = {
    'error.api.content.video.unavailable': 'Видео недоступно (приватное, удалено или ограничено регионом).',
    'error.api.content.video.region':     'Видео заблокировано в регионе сервиса.',
    'error.api.content.video.age':        'Видео с возрастным ограничением — недоступно для скачивания.',
    'error.api.content.video.live':       'Это прямой эфир — пока не идёт, скачать нельзя.',
    'error.api.content.post.unavailable': 'Пост недоступен (удалён, скрыт или приватный).',
    'error.api.content.post.private':     'Пост приватный.',
    'error.api.link.unsupported':         'Эта ссылка не поддерживается сервисом.',
    'error.api.link.invalid':             'Ссылка некорректная.',
    'error.api.fetch.empty':              'Сервис не смог получить контент по ссылке.',
    'error.api.fetch.fail':               'Сервис не смог получить контент по ссылке.',
    'error.api.rate_exceeded':            'Слишком много запросов — попробуйте через минуту.',
    'error.api.timed_out':                'Сервис не успел ответить — попробуйте ещё раз.',
  };
  if (map[code]) return map[code];
  if (code.includes('rate'))   return 'Превышен лимит запросов — подождите минуту.';
  if (code.includes('region')) return 'Контент недоступен в регионе сервиса.';
  if (code.includes('private')) return 'Контент приватный.';
  if (code.includes('unavailable')) return 'Контент недоступен (удалён или ограничен).';
  return '';
}

// ---- Background removal (динамический ESM-импорт) ----
let bgRemoveFn = null;
async function loadBgRemover() {
  if (bgRemoveFn) return bgRemoveFn;
  const mod = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm');
  bgRemoveFn = mod.removeBackground || mod.default;
  if (!bgRemoveFn) throw new Error('Не удалось загрузить движок удаления фона');
  return bgRemoveFn;
}

// ---- pdf.js worker ----
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ============================================================
// Section navigation
// ============================================================
const sections = {
  home:   document.getElementById('section-home'),
  pdf:    document.getElementById('section-pdf'),
  bg:     document.getElementById('section-bg'),
  video:  document.getElementById('section-video'),
  images: document.getElementById('section-images'),
  qr:     document.getElementById('section-qr'),
  rec:    document.getElementById('section-rec'),
};
function showSection(name) {
  Object.values(sections).forEach((s) => s.classList.remove('active'));
  sections[name].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.card[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => showSection(btn.dataset.tool));
  btn.addEventListener('mousemove', (e) => {
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--mx', `${e.clientX - r.left}px`);
    btn.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});
document.querySelectorAll('[data-back]').forEach((b) => {
  b.addEventListener('click', () => showSection('home'));
});

// ============================================================
// Generic helpers
// ============================================================
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function setMsg(node, text, type = '') {
  node.innerHTML = `<div class="msg ${type}">${text}</div>`;
}
function clearResult(node) { node.innerHTML = ''; }
function addDownloadLink(node, blob, filename, label) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.className = 'dl-link';
  a.innerHTML = `<span>⬇</span> ${label || filename}`;
  node.appendChild(a);
  a.click();
  return a;
}
function btnLoading(btn, on, originalLabel) {
  if (on) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.classList.add('is-loading');
    btn.textContent = originalLabel || 'Обработка...';
    btn.disabled = true;
  } else {
    btn.classList.remove('is-loading');
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}
function formatBytes(b) {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / (1024 * 1024)).toFixed(2)} МБ`;
}
function sanitizeFilename(name) {
  return (name || 'document').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 64);
}

// ============================================================
// Dropzones: click + drag-n-drop + visual feedback
// ============================================================
$$('.dropzone').forEach((dz) => {
  const inputId = dz.dataset.input;
  const input = document.getElementById(inputId);
  if (!input) return;

  const updateLabel = () => {
    const files = input.files;
    if (files && files.length) {
      const txt = dz.querySelector('.dz-text');
      const hint = dz.querySelector('.dz-hint');
      dz.classList.add('has-file');
      if (files.length === 1) {
        txt.textContent = files[0].name;
        hint.textContent = formatBytes(files[0].size);
      } else {
        txt.textContent = `Выбрано файлов: ${files.length}`;
        hint.textContent = formatBytes([...files].reduce((s, f) => s + f.size, 0));
      }
    } else {
      dz.classList.remove('has-file');
    }
  };

  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    updateLabel();
    dz.dispatchEvent(new CustomEvent('files', { detail: input.files }));
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    dz.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dz.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dz.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dz.classList.remove('is-drag');
    });
  });
  dz.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt || !dt.files || !dt.files.length) return;
    // Filter by accept
    const accept = (input.accept || '').split(',').map((s) => s.trim()).filter(Boolean);
    const list = new DataTransfer();
    [...dt.files].forEach((f) => {
      if (!accept.length || accept.some((a) => {
        if (a.startsWith('.')) return f.name.toLowerCase().endsWith(a.toLowerCase());
        if (a.endsWith('/*')) return f.type.startsWith(a.slice(0, -1));
        return f.type === a;
      })) list.items.add(f);
    });
    if (!input.multiple) {
      // keep only the first
      const single = new DataTransfer();
      if (list.files.length) single.items.add(list.files[0]);
      input.files = single.files;
    } else {
      input.files = list.files;
    }
    updateLabel();
    dz.dispatchEvent(new CustomEvent('files', { detail: input.files }));
  });
});

// ============================================================
// PDF tabs
// ============================================================
$$('.tab[data-pdf-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab[data-pdf-tab]').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.pdfTab;
    $$('.pdf-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  });
});

// ============================================================
// Tool: PDF -> JPG/PNG (zip)
// ============================================================
$('#pdf2img-run').addEventListener('click', async () => {
  const btn = $('#pdf2img-run');
  const result = $('#pdf2img-result');
  const file = $('#pdf2img-file').files?.[0];
  if (!file) return setMsg(result, 'Сначала выберите PDF-файл.', 'err');
  const format = $('#pdf2img-format').value; // png | jpg
  const scale = parseFloat($('#pdf2img-scale').value);
  clearResult(result);
  btnLoading(btn, true, 'Конвертируется...');

  try {
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const zip = new window.JSZip();
    const baseName = sanitizeFilename(file.name.replace(/\.pdf$/i, ''));

    const progressWrap = document.createElement('div');
    progressWrap.className = 'progress';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    progressWrap.appendChild(bar);
    result.appendChild(progressWrap);

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (format === 'jpg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise((res) =>
        canvas.toBlob(res, format === 'png' ? 'image/png' : 'image/jpeg', 0.92)
      );
      zip.file(`${baseName}-page-${String(i).padStart(3, '0')}.${format}`, blob);
      bar.style.width = `${(i / pdf.numPages) * 100}%`;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    progressWrap.remove();
    setMsg(result, `Готово. Страниц: <b>${pdf.numPages}</b>, формат: <b>${format.toUpperCase()}</b>. Размер архива: <b>${formatBytes(zipBlob.size)}</b>.`, 'ok');
    addDownloadLink(result, zipBlob, `${baseName}-${format}.zip`, 'Скачать архив');
  } catch (err) {
    console.error(err);
    setMsg(result, `Ошибка: ${err.message || err}`, 'err');
  } finally {
    btnLoading(btn, false);
  }
});

// ============================================================
// Tool: JPG/PNG -> PDF
// ============================================================
$('#img2pdf-run').addEventListener('click', async () => {
  const btn = $('#img2pdf-run');
  const result = $('#img2pdf-result');
  const files = $('#img2pdf-file').files;
  if (!files || !files.length) return setMsg(result, 'Выберите хотя бы одну картинку.', 'err');
  const sizeOpt = $('#img2pdf-size').value;
  clearResult(result);
  btnLoading(btn, true, 'Создание PDF...');

  try {
    const { jsPDF } = window.jspdf;
    let doc = null;

    const sizes = {
      a4: { w: 595.28, h: 841.89 },
      letter: { w: 612, h: 792 },
    };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await fileToDataURL(file);
      const img = await loadImage(dataUrl);
      const isPng = file.type === 'image/png';

      let pageW, pageH;
      if (sizeOpt === 'auto') {
        // points: 72 dpi base; treat image px as 72 dpi for simplicity
        pageW = img.width * 0.75; // 96dpi -> 72dpi: factor ~0.75
        pageH = img.height * 0.75;
      } else {
        const s = sizes[sizeOpt];
        pageW = s.w; pageH = s.h;
      }
      const orientation = pageW >= pageH ? 'l' : 'p';

      if (i === 0) {
        doc = new jsPDF({ unit: 'pt', format: [pageW, pageH], orientation });
      } else {
        doc.addPage([pageW, pageH], orientation);
      }

      // Fit image to page (contain)
      const iw = img.width, ih = img.height;
      const ratio = Math.min(pageW / iw, pageH / ih);
      const drawW = iw * ratio;
      const drawH = ih * ratio;
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;

      doc.addImage(dataUrl, isPng ? 'PNG' : 'JPEG', x, y, drawW, drawH, undefined, 'FAST');
    }

    const blob = doc.output('blob');
    setMsg(result, `Готово. Страниц: <b>${files.length}</b>. Размер: <b>${formatBytes(blob.size)}</b>.`, 'ok');
    addDownloadLink(result, blob, 'images.pdf', 'Скачать PDF');
  } catch (err) {
    console.error(err);
    setMsg(result, `Ошибка: ${err.message || err}`, 'err');
  } finally {
    btnLoading(btn, false);
  }
});

// ============================================================
// Tool: Merge PDFs
// ============================================================
$('#merge-run').addEventListener('click', async () => {
  const btn = $('#merge-run');
  const result = $('#merge-result');
  const files = $('#merge-file').files;
  if (!files || files.length < 2) return setMsg(result, 'Выберите минимум два PDF-файла.', 'err');

  clearResult(result);
  btnLoading(btn, true, 'Объединение...');
  try {
    const { PDFDocument } = window.PDFLib;
    const out = await PDFDocument.create();
    let total = 0;
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      total += src.getPageCount();
    }
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    setMsg(result, `Готово. Объединено страниц: <b>${total}</b>. Размер: <b>${formatBytes(blob.size)}</b>.`, 'ok');
    addDownloadLink(result, blob, 'merged.pdf', 'Скачать PDF');
  } catch (err) {
    console.error(err);
    setMsg(result, `Ошибка: ${err.message || err}`, 'err');
  } finally {
    btnLoading(btn, false);
  }
});

// ============================================================
// Tool: Split PDF -> zip of single-page PDFs
// ============================================================
$('#split-run').addEventListener('click', async () => {
  const btn = $('#split-run');
  const result = $('#split-result');
  const file = $('#split-file').files?.[0];
  if (!file) return setMsg(result, 'Выберите PDF-файл.', 'err');

  clearResult(result);
  btnLoading(btn, true, 'Разделение...');
  try {
    const { PDFDocument } = window.PDFLib;
    const buf = await file.arrayBuffer();
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const zip = new window.JSZip();
    const baseName = sanitizeFilename(file.name.replace(/\.pdf$/i, ''));

    for (let i = 0; i < src.getPageCount(); i++) {
      const out = await PDFDocument.create();
      const [p] = await out.copyPages(src, [i]);
      out.addPage(p);
      const bytes = await out.save();
      zip.file(`${baseName}-page-${String(i + 1).padStart(3, '0')}.pdf`, bytes);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    setMsg(result, `Готово. Страниц: <b>${src.getPageCount()}</b>. Размер архива: <b>${formatBytes(zipBlob.size)}</b>.`, 'ok');
    addDownloadLink(result, zipBlob, `${baseName}-split.zip`, 'Скачать архив');
  } catch (err) {
    console.error(err);
    setMsg(result, `Ошибка: ${err.message || err}`, 'err');
  } finally {
    btnLoading(btn, false);
  }
});

// ============================================================
// Tool: Compress PDF (re-render pages as JPEGs)
// ============================================================
$('#compress-run').addEventListener('click', async () => {
  const btn = $('#compress-run');
  const result = $('#compress-result');
  const file = $('#compress-file').files?.[0];
  if (!file) return setMsg(result, 'Выберите PDF-файл.', 'err');
  const level = $('#compress-level').value; // low | medium | high

  const presets = {
    low:    { scale: 1.4, quality: 0.82 },
    medium: { scale: 1.1, quality: 0.65 },
    high:   { scale: 0.9, quality: 0.45 },
  };
  const { scale, quality } = presets[level];

  clearResult(result);
  btnLoading(btn, true, 'Сжатие...');
  try {
    const { jsPDF } = window.jspdf;
    const buf = await file.arrayBuffer();
    const originalSize = buf.byteLength;
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;

    let doc = null;
    const progressWrap = document.createElement('div');
    progressWrap.className = 'progress';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    progressWrap.appendChild(bar);
    result.appendChild(progressWrap);

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', quality);

      const pageW = canvas.width * 0.75;
      const pageH = canvas.height * 0.75;
      const orientation = pageW >= pageH ? 'l' : 'p';

      if (!doc) doc = new jsPDF({ unit: 'pt', format: [pageW, pageH], orientation });
      else doc.addPage([pageW, pageH], orientation);

      doc.addImage(dataUrl, 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
      bar.style.width = `${(i / pdf.numPages) * 100}%`;
    }

    const blob = doc.output('blob');
    const ratio = (1 - blob.size / originalSize) * 100;
    progressWrap.remove();
    setMsg(result, `Готово. Было: <b>${formatBytes(originalSize)}</b> → стало: <b>${formatBytes(blob.size)}</b>. Сжатие: <b>${ratio > 0 ? ratio.toFixed(1) + '%' : 'не получилось уменьшить'}</b>.`, 'ok');
    addDownloadLink(result, blob, `compressed-${sanitizeFilename(file.name)}`, 'Скачать PDF');
  } catch (err) {
    console.error(err);
    setMsg(result, `Ошибка: ${err.message || err}`, 'err');
  } finally {
    btnLoading(btn, false);
  }
});

// ============================================================
// Tool: AI -> PDF (Viora AI)
// ============================================================
$('#ai-run').addEventListener('click', async () => {
  const btn = $('#ai-run');
  const result = $('#ai-result');
  const prompt = $('#ai-prompt').value.trim();
  if (!prompt) return setMsg(result, 'Опишите, что нужно сгенерировать.', 'err');
  const filename = sanitizeFilename($('#ai-filename').value || 'document');
  const pageSize = $('#ai-pagesize').value;

  clearResult(result);
  btnLoading(btn, true, 'Viora AI думает...');

  try {
    const text = await callVioraAI(prompt);
    setMsg(result, 'Текст готов, формирую PDF...', 'ok');
    const blob = await textToPdf(text, { pageSize });
    addDownloadLink(result, blob, `${filename}.pdf`, 'Скачать PDF');
    // Also append preview
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin-top:16px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;color:var(--muted);white-space:pre-wrap;word-wrap:break-word;font-family:Inter,sans-serif;font-size:13px;max-height:320px;overflow:auto;';
    pre.textContent = text;
    result.appendChild(pre);
  } catch (err) {
    console.error(err);
    setMsg(result, `Ошибка: ${err.message || err}`, 'err');
  } finally {
    btnLoading(btn, false);
  }
});

async function callVioraAI(userPrompt) {
  const res = await fetch(VIORA_AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VIORA_AI_KEY}`,
    },
    body: JSON.stringify({
      model: VIORA_AI_MODEL,
      messages: [
        { role: 'system', content: VIORA_AI_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Viora AI вернул ${res.status}. ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Viora AI вернул пустой ответ');
  return content.trim();
}

// Render markdown-ish text to a nicely typeset PDF.
// Supports: # / ## / ### headings, **bold** spans, "- " bullets, "1. " numbers.
// Cyrillic-safe (canvas-based, system font Inter).
async function textToPdf(text, { pageSize = 'a4' } = {}) {
  const { jsPDF } = window.jspdf;
  const sizes = {
    a4:     { w: 595.28, h: 841.89 },
    letter: { w: 612, h: 792 },
  };
  const { w: pageWpt, h: pageHpt } = sizes[pageSize] || sizes.a4;

  // Render at 2x for crisp PDF
  const scale = 2;
  const pageWpx = Math.round(pageWpt * scale);
  const pageHpx = Math.round(pageHpt * scale);
  const marginPx = Math.round(60 * scale);
  const contentW = pageWpx - marginPx * 2;

  const base = 13 * scale; // base body size in px
  const fontFamily = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

  // Typography presets
  const styles = {
    h1: { size: Math.round(base * 1.85), weight: 700, lh: 1.25, gapBefore: base * 0.2, gapAfter: base * 0.9 },
    h2: { size: Math.round(base * 1.35), weight: 700, lh: 1.3,  gapBefore: base * 1.0, gapAfter: base * 0.5 },
    h3: { size: Math.round(base * 1.12), weight: 600, lh: 1.35, gapBefore: base * 0.8, gapAfter: base * 0.4 },
    p:  { size: base,                    weight: 400, lh: 1.55, gapBefore: 0,          gapAfter: base * 0.55 },
    li: { size: base,                    weight: 400, lh: 1.5,  gapBefore: 0,          gapAfter: base * 0.25 },
  };

  // --- Step 1: parse markdown into a list of blocks ---
  const blocks = []; // { type, runs:[{text,bold}], marker?:string, indent?:number }

  const parseInline = (str) => {
    // split by **bold** preserving order
    const runs = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0, m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) runs.push({ text: str.slice(last, m.index), bold: false });
      runs.push({ text: m[1], bold: true });
      last = re.lastIndex;
    }
    if (last < str.length) runs.push({ text: str.slice(last), bold: false });
    // strip leftover *italic*, `code`, ~~strike~~
    return runs.map(r => ({
      text: r.text.replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/~~(.+?)~~/g, '$1'),
      bold: r.bold,
    })).filter(r => r.text.length > 0);
  };

  // Skip horizontal rules and code fences, keep everything else
  const rawLines = text
    .replace(/```[\s\S]*?```/g, '') // strip code fences entirely
    .split(/\r?\n/);

  for (let raw of rawLines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { blocks.push({ type: 'blank' }); continue; }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) continue; // skip horizontal rules
    let m;
    if ((m = line.match(/^#\s+(.*)/)))   { blocks.push({ type: 'h1', runs: parseInline(m[1]) }); continue; }
    if ((m = line.match(/^##\s+(.*)/)))  { blocks.push({ type: 'h2', runs: parseInline(m[1]) }); continue; }
    if ((m = line.match(/^###\s+(.*)/))) { blocks.push({ type: 'h3', runs: parseInline(m[1]) }); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      blocks.push({ type: 'li', marker: '•', runs: parseInline(m[1]) });
      continue;
    }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) {
      blocks.push({ type: 'li', marker: `${m[1]}.`, runs: parseInline(m[2]) });
      continue;
    }
    blocks.push({ type: 'p', runs: parseInline(line) });
  }

  // Collapse multiple blanks
  const cleaned = [];
  for (const b of blocks) {
    if (b.type === 'blank' && cleaned[cleaned.length - 1]?.type === 'blank') continue;
    cleaned.push(b);
  }
  // Trim leading/trailing blanks
  while (cleaned[0]?.type === 'blank') cleaned.shift();
  while (cleaned[cleaned.length - 1]?.type === 'blank') cleaned.pop();

  // --- Step 2: layout — break each block into wrapped visual lines ---
  const measure = document.createElement('canvas').getContext('2d');
  const setFont = (cx, weight, size) => { cx.font = `${weight} ${size}px ${fontFamily}`; };

  const wrapRuns = (runs, size, weight, maxW, indent = 0) => {
    // Returns array of visual lines, each: { runs:[{text,bold}], height }
    const lines = [];
    let curRuns = [];
    let curWidth = indent;

    const pushLine = () => {
      lines.push({ runs: curRuns, height: size * 1 });
      curRuns = [];
      curWidth = 0; // continuation lines have no marker indent
    };

    for (const r of runs) {
      // tokens that include leading whitespace
      const tokens = r.text.split(/(\s+)/).filter(t => t.length > 0);
      for (const tok of tokens) {
        setFont(measure, r.bold ? 700 : weight, size);
        const w = measure.measureText(tok).width;
        if (curWidth + w > maxW && curRuns.length > 0) {
          // wrap: don't carry leading spaces to new line
          if (/^\s+$/.test(tok)) { pushLine(); continue; }
          pushLine();
        }
        curRuns.push({ text: tok, bold: r.bold });
        curWidth += w;
      }
    }
    if (curRuns.length) pushLine();
    return lines;
  };

  // --- Step 3: page rendering ---
  const doc = new jsPDF({ unit: 'pt', format: [pageWpt, pageHpt], orientation: 'p' });
  let pageIdx = 0;

  const newPage = () => {
    const cv = document.createElement('canvas');
    cv.width = pageWpx; cv.height = pageHpx;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, pageWpx, pageHpx);
    cx.fillStyle = '#0f0f12';
    cx.textBaseline = 'alphabetic';
    return { cv, cx };
  };

  let { cv, cx } = newPage();
  let y = marginPx;
  const maxY = pageHpx - marginPx;

  const flushPage = () => {
    // Add page footer
    cx.save();
    cx.fillStyle = '#999';
    setFont(cx, 400, 10 * scale);
    cx.textBaseline = 'alphabetic';
    cx.fillText(`Viora Studio · стр. ${pageIdx + 1}`, marginPx, pageHpx - marginPx * 0.45);
    cx.restore();

    const dataUrl = cv.toDataURL('image/jpeg', 0.92);
    if (pageIdx > 0) doc.addPage([pageWpt, pageHpt], 'p');
    doc.addImage(dataUrl, 'JPEG', 0, 0, pageWpt, pageHpt, undefined, 'FAST');
    pageIdx++;
  };

  const ensureSpace = (need) => {
    if (y + need > maxY) {
      flushPage();
      ({ cv, cx } = newPage());
      y = marginPx;
    }
  };

  for (const b of cleaned) {
    if (b.type === 'blank') {
      y += styles.p.size * 0.6;
      continue;
    }
    const st = styles[b.type] || styles.p;
    y += st.gapBefore;

    // li handling: marker indent
    let textX = marginPx;
    let availW = contentW;
    let markerWidth = 0;
    if (b.type === 'li') {
      setFont(measure, 600, st.size);
      markerWidth = measure.measureText(b.marker + '  ').width;
      textX = marginPx + markerWidth;
      availW = contentW - markerWidth;
    }

    const lines = wrapRuns(b.runs, st.size, st.weight, availW);

    for (let i = 0; i < lines.length; i++) {
      const lineH = st.size * st.lh;
      ensureSpace(lineH);

      // draw marker on first line of list item
      if (b.type === 'li' && i === 0) {
        setFont(cx, 600, st.size);
        cx.fillStyle = '#0f0f12';
        cx.textBaseline = 'alphabetic';
        cx.fillText(b.marker, marginPx, y + st.size);
      }

      let x = (b.type === 'li') ? textX : marginPx;
      for (const r of lines[i].runs) {
        setFont(cx, r.bold ? 700 : st.weight, st.size);
        cx.fillStyle = (b.type === 'h1' || b.type === 'h2') ? '#0a0a0a' : '#1a1a1f';
        cx.textBaseline = 'alphabetic';
        cx.fillText(r.text, x, y + st.size);
        x += measure.measureText(r.text).width;
      }
      y += lineH;
    }

    // Underline for h1 / h2
    if (b.type === 'h1') {
      ensureSpace(8);
      cx.fillStyle = '#a855f7';
      cx.fillRect(marginPx, y + 2, Math.round(40 * scale), Math.round(2 * scale));
      y += 6 * scale;
    }

    y += st.gapAfter;
  }
  flushPage();

  return doc.output('blob');
}

// ============================================================
// Tool: Background removal
// ============================================================
let bgState = { beforeUrl: null, afterUrl: null, afterBlob: null, originalName: 'image' };

const bgFileInput = $('#bg-file');
const bgRunBtn = $('#bg-run');
const bgResult = $('#bg-result');
const bgCompare = $('#bg-compare');

$('#bg-drop').addEventListener('files', (e) => {
  const file = e.detail?.[0];
  if (!file) return;
  bgRunBtn.disabled = false;
  bgState.originalName = sanitizeFilename(file.name.replace(/\.[a-z0-9]+$/i, ''));
});

bgRunBtn.addEventListener('click', async () => {
  const file = bgFileInput.files?.[0];
  if (!file) return setMsg(bgResult, 'Сначала выберите картинку.', 'err');

  bgCompare.hidden = true;
  clearResult(bgResult);
  btnLoading(bgRunBtn, true, 'Загрузка модели...');

  try {
    setMsg(bgResult, 'Загружаю движок и модель. В первый раз это занимает 10–60 секунд.', 'ok');
    const removeBackground = await loadBgRemover();

    btnLoading(bgRunBtn, true, 'Обработка изображения...');
    setMsg(bgResult, 'Удаляю фон... Это может занять до минуты.', 'ok');

    const model = $('#bg-quality').value; // small | medium | large
    const blob = await removeBackground(file, {
      model,
      output: { format: 'image/png', quality: 1 },
    });

    // Build URLs
    if (bgState.beforeUrl) URL.revokeObjectURL(bgState.beforeUrl);
    if (bgState.afterUrl) URL.revokeObjectURL(bgState.afterUrl);
    bgState.beforeUrl = URL.createObjectURL(file);
    bgState.afterUrl = URL.createObjectURL(blob);
    bgState.afterBlob = blob;

    $('#bg-before-img').src = bgState.beforeUrl;
    $('#bg-after-img').src = bgState.afterUrl;

    bgCompare.hidden = false;
    setMsg(bgResult, `Готово. Размер PNG: <b>${formatBytes(blob.size)}</b>.`, 'ok');
    initCompare();
  } catch (err) {
    console.error(err);
    setMsg(bgResult, `Ошибка: ${err.message || err}`, 'err');
  } finally {
    btnLoading(bgRunBtn, false);
  }
});

$('#bg-download').addEventListener('click', () => {
  if (!bgState.afterBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(bgState.afterBlob);
  a.download = `${bgState.originalName}-no-bg.png`;
  a.click();
});

function initCompare() {
  const wrap = $('.compare-wrap');
  const clip = $('#bg-clip');
  const handle = $('#bg-handle');
  const slider = $('#bg-slider');
  const beforeImg = $('#bg-before-img');

  // Ensure the inner clipped image matches container natural width
  const sync = () => {
    const w = wrap.clientWidth;
    beforeImg.style.width = `${w}px`;
    clip.style.setProperty('--compare-w', `${w}px`);
  };
  sync();
  new ResizeObserver(sync).observe(wrap);

  const setPos = (pct) => {
    const p = Math.max(0, Math.min(100, pct));
    clip.style.width = `${p}%`;
    handle.style.left = `${p}%`;
    slider.value = p;
  };
  slider.addEventListener('input', () => setPos(parseFloat(slider.value)));

  // Touch / pointer
  const onMove = (clientX) => {
    const r = wrap.getBoundingClientRect();
    setPos(((clientX - r.left) / r.width) * 100);
  };
  wrap.addEventListener('pointerdown', (e) => {
    onMove(e.clientX);
    const move = (ev) => onMove(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  setPos(50);
}

// ============================================================
// Tool: Video download — via Viora video backend (yt-dlp)
// ============================================================
const VIDEO_BACKEND = 'https://viora-video-dsfg.zocomputer.io';

$('#video-run').addEventListener('click', async () => {
  const btn = $('#video-run');
  const result = $('#video-result');
  const url = $('#video-url').value.trim();
  if (!url) return setMsg(result, 'Вставьте ссылку.', 'err');
  if (!/^https?:\/\//i.test(url)) {
    return setMsg(result, 'Ссылка должна начинаться с http:// или https://', 'err');
  }

  const quality = $('#video-quality').value;
  const audioOnly = $('#video-audio').checked;

  clearResult(result);
  btnLoading(btn, true, 'Получаю файл...');

  const apiUrl = new URL(VIDEO_BACKEND + '/dl');
  apiUrl.searchParams.set('url', url);
  apiUrl.searchParams.set('quality', quality);
  apiUrl.searchParams.set('audio', String(audioOnly));

  try {
    setMsg(result, 'Подключаюсь к серверу...', '');
    const res = await fetch(apiUrl.toString());

    // Error path — server returns JSON {status:"error",error:{message}}
    if (!res.ok) {
      let msg = `Ошибка ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error?.message) msg = j.error.message;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }

    // Determine filename from Content-Disposition (RFC 5987 first)
    const cd = res.headers.get('content-disposition') || '';
    let filename = 'video.mp4';
    const m1 = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    const m2 = cd.match(/filename\s*=\s*"([^"]+)"/i);
    if (m1) {
      try { filename = decodeURIComponent(m1[1]); } catch { filename = m1[1]; }
    } else if (m2) {
      filename = m2[1];
    }

    const total = parseInt(res.headers.get('content-length') || '0', 10);
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + ' МБ';

    const renderProgress = () => {
      const pct = total ? Math.min(100, Math.round((received / total) * 100)) : null;
      const bar = pct == null
        ? ''
        : `<div style="height:6px;background:var(--surface-2);border-radius:999px;overflow:hidden;margin-top:8px"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),#c084fc);transition:width .2s var(--ease)"></div></div>`;
      const label = total
        ? `Скачиваю: ${pct}% — ${fmtMB(received)} / ${fmtMB(total)}`
        : `Скачиваю: ${fmtMB(received)}`;
      setMsg(result, label + bar, '');
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      renderProgress();
    }

    const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
    clearResult(result);
    setMsg(result, `Готово: ${fmtMB(blob.size)} — ${escapeHtml(filename)}`, 'ok');
    addDownloadLink(result, blob, filename, '⬇ Сохранить файл');
    toast({ title: 'Скачано', body: escapeHtml(filename), type: 'ok' });

  } catch (err) {
    console.error(err);
    const msg = err.message || String(err);
    setMsg(result, msg, 'err');
    toast({ title: 'Не удалось скачать', body: escapeHtml(msg), type: 'err' });
  } finally {
    btnLoading(btn, false);
  }
});

// Загрузка blob с прогрессом
async function fetchBlobAsBlob(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ошибка загрузки ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress || !total) {
    return await res.blob();
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded / total);
  }
  return new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
}

// Удобное сохранение Blob с конкретным именем
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ffmpeg.wasm — ленивая инициализация, переиспользуем экземпляр
let ffmpegInstance = null;
async function getFfmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpegMod = await import('https://esm.sh/@ffmpeg/ffmpeg@0.12.10');
  const utilMod  = await import('https://esm.sh/@ffmpeg/util@0.12.1');
  const { FFmpeg } = ffmpegMod;
  const { toBlobURL } = utilMod;
  const ff = new FFmpeg();
  const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ff.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegInstance = ff;
  return ff;
}

async function muxVideoAudio(videoBlob, audioBlob) {
  const ff = await getFfmpeg();
  const vBuf = new Uint8Array(await videoBlob.arrayBuffer());
  const aBuf = new Uint8Array(await audioBlob.arrayBuffer());
  await ff.writeFile('v.mp4', vBuf);
  await ff.writeFile('a.m4a', aBuf);
  // copy streams — без перекодирования, быстро
  await ff.exec(['-i', 'v.mp4', '-i', 'a.m4a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', 'out.mp4']);
  const out = await ff.readFile('out.mp4');
  return new Blob([out.buffer], { type: 'video/mp4' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function guessName(srcUrl, audioOnly) {
  try {
    const u = new URL(srcUrl);
    const host = u.hostname.replace(/^www\./, '').split('.')[0];
    return `${host}-${Date.now()}.${audioOnly ? 'mp3' : 'mp4'}`;
  } catch {
    return `video-${Date.now()}.${audioOnly ? 'mp3' : 'mp4'}`;
  }
}

// ============================================================
// Utils
// ============================================================
function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Не удалось прочитать файл'));
    r.readAsDataURL(file);
  });
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Не удалось загрузить изображение'));
    img.src = src;
  });
}

// ============================================================
// WOW: Toasts, 3D tilt, typewriter, global file drop
// ============================================================

// --- Toast system ---
function toast({ title = '', body = '', type = '', duration = 4200 } = {}) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type ? 'toast-' + type : ''}`;
  el.innerHTML = `<div><div class="toast-title">${escapeHtml(title)}</div>${body ? `<div class="toast-body">${body}</div>` : ''}</div>`;
  host.appendChild(el);
  const remove = () => {
    el.classList.add('is-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}
window.vsToast = toast;

// --- 3D tilt on home cards ---
document.querySelectorAll('.card[data-tool]').forEach((card) => {
  let raf = 0;
  const maxTilt = 8;
  card.addEventListener('mousemove', (e) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top)  / r.height;
      const ry = (px - 0.5) *  maxTilt * 2;
      const rx = (0.5 - py) *  maxTilt * 2;
      card.style.setProperty('--tilt-x', `${rx.toFixed(2)}deg`);
      card.style.setProperty('--tilt-y', `${ry.toFixed(2)}deg`);
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
  card.addEventListener('mouseleave', () => {
    card.style.setProperty('--tilt-x', '0deg');
    card.style.setProperty('--tilt-y', '0deg');
  });
});

// --- Typewriter on home subtitle ---
(function typewriter() {
  const el = document.getElementById('hero-subtitle');
  if (!el || sessionStorage.getItem('vs_typed') === '1') return;
  const phrases = [
    'Бесплатно. Без регистрации. Без лимитов.',
    'PDF · фон · видео — в одном окне.',
    'Всё работает прямо в браузере.',
  ];
  el.textContent = '';
  const caret = document.createElement('span');
  caret.className = 'typewriter-caret';
  el.parentNode.appendChild(caret);

  let pi = 0;
  const typePhrase = async (s) => {
    for (let i = 0; i < s.length; i++) {
      el.textContent = s.slice(0, i + 1);
      await sleep(28 + Math.random() * 30);
    }
    await sleep(1600);
  };
  const erase = async () => {
    const s = el.textContent;
    for (let i = s.length; i >= 0; i--) {
      el.textContent = s.slice(0, i);
      await sleep(14);
    }
  };
  (async () => {
    while (pi < phrases.length) {
      await typePhrase(phrases[pi]);
      if (pi < phrases.length - 1) await erase();
      pi++;
    }
    sessionStorage.setItem('vs_typed', '1');
  })();
})();
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Global file drop overlay (drop anywhere → routes to right tool) ---
(function globalDrop() {
  const overlay = document.getElementById('drop-overlay');
  if (!overlay) return;
  let depth = 0;
  const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth++;
    overlay.classList.add('is-active');
  });
  window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.remove('is-active');
  });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('is-active');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    routeDroppedFiles(files);
  });
})();

function routeDroppedFiles(files) {
  const f = files[0];
  const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  const isImg = /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);

  if (isPdf) {
    showSection('pdf');
    // если несколько PDF — открываем «Объединить», иначе по умолчанию «PDF→JPG»
    if (files.length > 1) {
      document.querySelector('[data-pdf-tab="merge"]')?.click();
      const inp = document.querySelector('#merge-files');
      if (inp) setFiles(inp, files);
    } else {
      document.querySelector('[data-pdf-tab="pdf2img"]')?.click();
      const inp = document.querySelector('#p2i-file');
      if (inp) setFiles(inp, files);
    }
    toast({ title: 'Файл подхвачен', body: `PDF: <b>${escapeHtml(f.name)}</b>`, type: 'ok' });
    return;
  }
  if (isImg) {
    // если несколько картинок — JPG/PNG → PDF
    if (files.length > 1) {
      showSection('pdf');
      document.querySelector('[data-pdf-tab="img2pdf"]')?.click();
      const inp = document.querySelector('#i2p-files');
      if (inp) setFiles(inp, files);
      toast({ title: 'Картинки добавлены', body: `Будут собраны в PDF (${files.length} шт.)`, type: 'ok' });
    } else {
      showSection('bg');
      const inp = document.querySelector('#bg-file');
      if (inp) {
        setFiles(inp, files);
        const dz = document.querySelector('#bg-drop');
        if (dz) dz.dispatchEvent(new CustomEvent('files', { detail: files }));
      }
      toast({ title: 'Картинка подхвачена', body: 'Жмите «Удалить фон»', type: 'ok' });
    }
    return;
  }
  toast({ title: 'Не понял тип файла', body: 'Закидывайте PDF или картинку.', type: 'err' });
}

// Установить FileList на скрытый input (через DataTransfer)
function setFiles(input, files) {
  try {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) {
    console.warn('setFiles failed', e);
  }
}

// Welcome toast on first load of the session
if (!sessionStorage.getItem('vs_welcome')) {
  setTimeout(() => {
    toast({
      title: 'Подсказка',
      body: 'Перетащите PDF или картинку в любое место страницы — Viora сама подберёт инструмент.',
      duration: 6000,
    });
    sessionStorage.setItem('vs_welcome', '1');
  }, 1200);
}

// ============================================================
// NEW TOOLS: Images / QR / Recorder
// Generic tab switch + per-tool logic
// ============================================================

// --- Generic tab switching for new tools ---
function wireTabs(tabAttr, paneAttr) {
  $$(`.tab[${tabAttr}]`).forEach((tab) => {
    tab.addEventListener('click', () => {
      const tool = tab.closest('.tool-wrap');
      $$(`.tab[${tabAttr}]`, tool).forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.getAttribute(tabAttr);
      $$(`.tab-pane[${paneAttr}]`, tool).forEach((p) =>
        p.classList.toggle('active', p.getAttribute(paneAttr) === name)
      );
    });
  });
}
wireTabs('data-img-tab', 'data-img-pane');
wireTabs('data-qr-tab',  'data-qr-pane');
wireTabs('data-rec-tab', 'data-rec-pane');

// ============================================================
// Lazy loaders for heavy libs
// ============================================================
function loadScriptOnce(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((res, rej) => {
    const existing = document.querySelector(`script[data-lazy="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => res(globalName ? window[globalName] : true));
      existing.addEventListener('error', rej);
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.lazy = src;
    s.onload = () => res(globalName ? window[globalName] : true);
    s.onerror = () => rej(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

const CDN_TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
const CDN_QRCODE    = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm';
const CDN_JSQR      = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

const loadTesseract = () => loadScriptOnce(CDN_TESSERACT, 'Tesseract');
const loadJsQR      = () => loadScriptOnce(CDN_JSQR,      'jsQR');

// QRCode is ESM-only — dynamic import + cache
let _qrcodeMod = null;
async function loadQRCode() {
  if (_qrcodeMod) return _qrcodeMod;
  const mod = await import(CDN_QRCODE);
  _qrcodeMod = mod.default || mod;
  return _qrcodeMod;
}

// ============================================================
// Image helpers
// ============================================================
async function decodeImageFile(file) {
  // Use createImageBitmap for fast, color-correct decode
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch (_) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function drawToCanvas(src, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(src, 0, 0, w, h);
  return cv;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((res, rej) => {
    canvas.toBlob((b) => b ? res(b) : rej(new Error('Не удалось закодировать ' + type)), type, quality);
  });
}

function fmtBytes(n) {
  if (n < 1024) return n + ' Б';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
  return (n / (1024 * 1024)).toFixed(2) + ' МБ';
}

function extFor(mime) {
  return {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  }[mime] || 'bin';
}

function baseName(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

// ============================================================
// Tool: Image — Compress
// ============================================================
$('#img-compress-q').addEventListener('input', (e) => {
  $('#img-compress-q-label').textContent = e.target.value + '%';
});

$('#img-compress-run').addEventListener('click', async () => {
  const btn = $('#img-compress-run');
  const result = $('#img-compress-result');
  const file = $('#img-compress-file').files?.[0];
  if (!file) return setMsg(result, 'Выберите картинку.', 'err');

  const type = $('#img-compress-format').value;
  const q    = parseInt($('#img-compress-q').value, 10) / 100;
  const max  = parseInt($('#img-compress-max').value, 10) || 4000;

  clearResult(result);
  btnLoading(btn, true, 'Сжимаю...');
  try {
    const bmp = await decodeImageFile(file);
    let w = bmp.width || bmp.naturalWidth;
    let h = bmp.height || bmp.naturalHeight;
    const scale = Math.min(1, max / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const cv = drawToCanvas(bmp, w, h);
    let blob;
    try { blob = await canvasToBlob(cv, type, q); }
    catch (e) {
      if (type === 'image/avif') {
        setMsg(result, 'Браузер не поддерживает AVIF-кодирование. Попробуйте WebP.', 'err');
        return;
      }
      throw e;
    }
    const outName = `${baseName(file.name)}-min.${extFor(type)}`;
    const saved = file.size - blob.size;
    const pct = ((1 - blob.size / file.size) * 100).toFixed(1);
    setMsg(result,
      `Готово: <b>${fmtBytes(file.size)}</b> → <b>${fmtBytes(blob.size)}</b> ` +
      `(${saved > 0 ? '−' : '+'}${Math.abs(pct)}%, ${w}×${h})`, 'ok');
    addDownloadLink(result, blob, outName, '⬇ Скачать');
    toast({ title: 'Картинка сжата', body: `Экономия: ${pct}%`, type: 'ok' });
  } catch (e) {
    setMsg(result, 'Ошибка: ' + (e.message || e), 'err');
  } finally { btnLoading(btn, false); }
});

// ============================================================
// Tool: Image — Convert (batch → zip if multiple)
// ============================================================
$('#img-convert-q').addEventListener('input', (e) => {
  $('#img-convert-q-label').textContent = e.target.value + '%';
});

$('#img-convert-run').addEventListener('click', async () => {
  const btn = $('#img-convert-run');
  const result = $('#img-convert-result');
  const files = Array.from($('#img-convert-file').files || []);
  if (!files.length) return setMsg(result, 'Выберите хотя бы одну картинку.', 'err');

  const type = $('#img-convert-format').value;
  const q = parseInt($('#img-convert-q').value, 10) / 100;
  const ext = extFor(type);

  clearResult(result);
  btnLoading(btn, true, `Конвертирую (0/${files.length})...`);
  try {
    const blobs = [];
    for (let i = 0; i < files.length; i++) {
      btnLoading(btn, true, `Конвертирую (${i+1}/${files.length})...`);
      const f = files[i];
      const bmp = await decodeImageFile(f);
      const cv = drawToCanvas(bmp, bmp.width || bmp.naturalWidth, bmp.height || bmp.naturalHeight);
      let b;
      try { b = await canvasToBlob(cv, type, q); }
      catch (e) {
        if (type === 'image/avif') throw new Error('Браузер не умеет кодировать AVIF — выберите другой формат');
        throw e;
      }
      blobs.push({ name: `${baseName(f.name)}.${ext}`, blob: b });
    }

    if (blobs.length === 1) {
      setMsg(result, `Готово: ${fmtBytes(blobs[0].blob.size)}`, 'ok');
      addDownloadLink(result, blobs[0].blob, blobs[0].name, '⬇ Скачать');
    } else {
      const zip = new JSZip();
      blobs.forEach((b) => zip.file(b.name, b.blob));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      setMsg(result, `Готово: ${blobs.length} файлов · ${fmtBytes(zipBlob.size)}`, 'ok');
      addDownloadLink(result, zipBlob, `converted-${ext}.zip`, '⬇ Скачать ZIP');
    }
    toast({ title: 'Конвертация завершена', type: 'ok' });
  } catch (e) {
    setMsg(result, 'Ошибка: ' + (e.message || e), 'err');
  } finally { btnLoading(btn, false); }
});

// ============================================================
// Tool: Image — Resize / Crop
// ============================================================
const resizeState = {
  img: null,
  natW: 0, natH: 0,
  displayScale: 1,           // displayed-px per natural-px
  crop: null,                // { x, y, w, h } in natural-pixel coords
  dragging: null,            // { mode: 'create'|'move'|'resize', handle, startX, startY, startRect }
};

$('#img-resize-q').addEventListener('input', (e) => {
  $('#img-resize-q-label').textContent = e.target.value + '%';
});

$('#img-resize-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const bmp = await decodeImageFile(file);
    resizeState.img = bmp;
    resizeState.natW = bmp.width || bmp.naturalWidth;
    resizeState.natH = bmp.height || bmp.naturalHeight;
    resizeState.crop = null;
    $('#img-resize-w').value = resizeState.natW;
    $('#img-resize-h').value = resizeState.natH;
    drawResizeCanvas();
    $('#img-resize-stage').hidden = false;
    $('#img-resize-rect').hidden = true;
  } catch (err) {
    toast({ title: 'Не удалось открыть картинку', body: err.message, type: 'err' });
  }
});

function drawResizeCanvas() {
  const canvas = $('#img-resize-canvas');
  const wrap = $('#img-resize-wrap');
  const maxW = wrap.clientWidth - 24;
  const maxH = 520;
  const scale = Math.min(1, maxW / resizeState.natW, maxH / resizeState.natH);
  const dw = Math.round(resizeState.natW * scale);
  const dh = Math.round(resizeState.natH * scale);
  canvas.width  = dw;
  canvas.height = dh;
  canvas.style.width = dw + 'px';
  canvas.style.height = dh + 'px';
  resizeState.displayScale = scale;
  const cx = canvas.getContext('2d');
  cx.imageSmoothingQuality = 'high';
  cx.clearRect(0, 0, dw, dh);
  cx.drawImage(resizeState.img, 0, 0, dw, dh);
}

function updateCropRectDom() {
  const rect = $('#img-resize-rect');
  if (!resizeState.crop) { rect.hidden = true; return; }
  const s = resizeState.displayScale;
  const canvas = $('#img-resize-canvas');
  const off = { x: canvas.offsetLeft, y: canvas.offsetTop };
  rect.hidden = false;
  rect.style.left   = (off.x + resizeState.crop.x * s) + 'px';
  rect.style.top    = (off.y + resizeState.crop.y * s) + 'px';
  rect.style.width  = (resizeState.crop.w * s) + 'px';
  rect.style.height = (resizeState.crop.h * s) + 'px';
  $('#img-resize-w').value = Math.round(resizeState.crop.w);
  $('#img-resize-h').value = Math.round(resizeState.crop.h);
}

// Crop drag-creation on canvas
(() => {
  const canvas = $('#img-resize-canvas');
  const rect   = $('#img-resize-rect');

  function getXY(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / resizeState.displayScale,
      y: (e.clientY - r.top)  / resizeState.displayScale,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!resizeState.img) return;
    canvas.setPointerCapture(e.pointerId);
    const start = getXY(e);
    resizeState.crop = { x: start.x, y: start.y, w: 0, h: 0 };
    resizeState.dragging = { mode: 'create', startX: start.x, startY: start.y };
    updateCropRectDom();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!resizeState.dragging || resizeState.dragging.mode !== 'create') return;
    const p = getXY(e);
    const x1 = Math.max(0, Math.min(resizeState.dragging.startX, p.x));
    const y1 = Math.max(0, Math.min(resizeState.dragging.startY, p.y));
    const x2 = Math.min(resizeState.natW, Math.max(resizeState.dragging.startX, p.x));
    const y2 = Math.min(resizeState.natH, Math.max(resizeState.dragging.startY, p.y));
    resizeState.crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    updateCropRectDom();
  });
  canvas.addEventListener('pointerup', () => {
    if (resizeState.dragging?.mode === 'create' && (!resizeState.crop || resizeState.crop.w < 4 || resizeState.crop.h < 4)) {
      resizeState.crop = null;
      $('#img-resize-rect').hidden = true;
      $('#img-resize-w').value = resizeState.natW;
      $('#img-resize-h').value = resizeState.natH;
    }
    resizeState.dragging = null;
  });

  // Move and resize on the rect itself
  function startRectDrag(e, mode, handle = null) {
    e.stopPropagation();
    rect.setPointerCapture(e.pointerId);
    resizeState.dragging = {
      mode, handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: { ...resizeState.crop },
    };
  }
  rect.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('crop-handle')) {
      startRectDrag(e, 'resize', e.target.dataset.h);
    } else {
      startRectDrag(e, 'move');
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!resizeState.dragging || resizeState.dragging.mode === 'create') return;
    const d = resizeState.dragging;
    const dx = (e.clientX - d.startClientX) / resizeState.displayScale;
    const dy = (e.clientY - d.startClientY) / resizeState.displayScale;
    let { x, y, w, h } = d.startRect;
    if (d.mode === 'move') {
      x = Math.max(0, Math.min(resizeState.natW - w, x + dx));
      y = Math.max(0, Math.min(resizeState.natH - h, y + dy));
    } else if (d.mode === 'resize') {
      const handle = d.handle;
      if (handle.includes('w')) { x = x + dx; w = w - dx; }
      if (handle.includes('e')) { w = w + dx; }
      if (handle.includes('n')) { y = y + dy; h = h - dy; }
      if (handle.includes('s')) { h = h + dy; }
      if (w < 4 || h < 4) return;
      // clamp
      if (x < 0) { w += x; x = 0; }
      if (y < 0) { h += y; y = 0; }
      if (x + w > resizeState.natW) w = resizeState.natW - x;
      if (y + h > resizeState.natH) h = resizeState.natH - y;
    }
    resizeState.crop = { x, y, w, h };
    updateCropRectDom();
  });
  window.addEventListener('pointerup', () => {
    if (resizeState.dragging && resizeState.dragging.mode !== 'create') resizeState.dragging = null;
  });
})();

// Manual W/H inputs (sync with lock)
function syncResizeInputs(source) {
  const lock = $('#img-resize-lock').checked;
  let w = parseInt($('#img-resize-w').value, 10) || 0;
  let h = parseInt($('#img-resize-h').value, 10) || 0;
  const baseW = resizeState.crop ? resizeState.crop.w : resizeState.natW;
  const baseH = resizeState.crop ? resizeState.crop.h : resizeState.natH;
  if (lock && baseW && baseH) {
    if (source === 'w') h = Math.round(w * baseH / baseW);
    else                w = Math.round(h * baseW / baseH);
  }
  $('#img-resize-w').value = w;
  $('#img-resize-h').value = h;
}
$('#img-resize-w').addEventListener('input', () => syncResizeInputs('w'));
$('#img-resize-h').addEventListener('input', () => syncResizeInputs('h'));
$('#img-resize-clear').addEventListener('click', () => {
  resizeState.crop = null;
  $('#img-resize-rect').hidden = true;
  $('#img-resize-w').value = resizeState.natW;
  $('#img-resize-h').value = resizeState.natH;
});
window.addEventListener('resize', () => { if (resizeState.img) { drawResizeCanvas(); updateCropRectDom(); } });

$('#img-resize-run').addEventListener('click', async () => {
  const btn = $('#img-resize-run');
  const result = $('#img-resize-result');
  if (!resizeState.img) return setMsg(result, 'Сначала загрузите картинку.', 'err');

  const outW = Math.max(1, parseInt($('#img-resize-w').value, 10) || 0);
  const outH = Math.max(1, parseInt($('#img-resize-h').value, 10) || 0);
  const type = $('#img-resize-format').value;
  const q = parseInt($('#img-resize-q').value, 10) / 100;

  clearResult(result);
  btnLoading(btn, true, 'Обрабатываю...');
  try {
    let source = resizeState.img;
    let sx = 0, sy = 0, sw = resizeState.natW, sh = resizeState.natH;
    if (resizeState.crop) {
      sx = resizeState.crop.x; sy = resizeState.crop.y;
      sw = resizeState.crop.w; sh = resizeState.crop.h;
    }
    const cv = document.createElement('canvas');
    cv.width = outW; cv.height = outH;
    const cx = cv.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
    const blob = await canvasToBlob(cv, type, q);
    setMsg(result, `Готово: ${outW}×${outH}, ${fmtBytes(blob.size)}`, 'ok');
    addDownloadLink(result, blob, `resized-${outW}x${outH}.${extFor(type)}`, '⬇ Скачать');
    toast({ title: 'Готово', body: `${outW}×${outH}`, type: 'ok' });
  } catch (e) {
    setMsg(result, 'Ошибка: ' + (e.message || e), 'err');
  } finally { btnLoading(btn, false); }
});

// ============================================================
// Tool: Image — OCR (Tesseract.js, lazy)
// ============================================================
let tesseractWorker = null;
let tesseractLang = '';

async function getTesseractWorker(lang) {
  await loadTesseract();
  if (tesseractWorker && tesseractLang === lang) return tesseractWorker;
  if (tesseractWorker) {
    try { await tesseractWorker.terminate(); } catch {}
    tesseractWorker = null;
  }
  tesseractWorker = await window.Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      if (m.status && m.progress != null) {
        const btn = $('#img-ocr-run');
        const pct = Math.round(m.progress * 100);
        btn.textContent = `${m.status} ${pct}%`;
      }
    },
  });
  tesseractLang = lang;
  return tesseractWorker;
}

async function pdfFirstPageToCanvas(file, scale = 2) {
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = viewport.width; cv.height = viewport.height;
  await page.render({ canvasContext: cv.getContext('2d'), viewport }).promise;
  return { canvas: cv, pages: pdf.numPages };
}

$('#img-ocr-run').addEventListener('click', async () => {
  const btn = $('#img-ocr-run');
  const result = $('#img-ocr-result');
  const file = $('#img-ocr-file').files?.[0];
  if (!file) return setMsg(result, 'Выберите изображение или PDF.', 'err');

  const lang = $('#img-ocr-lang').value;
  clearResult(result);
  $('#img-ocr-output-wrap').hidden = true;
  btnLoading(btn, true, 'Загрузка движка...');

  try {
    setMsg(result, 'Загружаю движок распознавания (первая загрузка ~10 МБ)...', '');
    const worker = await getTesseractWorker(lang);

    let imageSource = file;
    let pdfNote = '';
    if (file.type === 'application/pdf') {
      setMsg(result, 'PDF: рендерю страницу для распознавания...', '');
      const { canvas: pageCanvas, pages } = await pdfFirstPageToCanvas(file, 2);
      imageSource = pageCanvas;
      pdfNote = pages > 1 ? ` (распознана 1 из ${pages} страниц)` : '';
    }

    setMsg(result, 'Распознаю...', '');
    const { data } = await worker.recognize(imageSource);
    const text = (data.text || '').trim();
    if (!text) {
      setMsg(result, 'Текст не найден.' + pdfNote, 'err');
      return;
    }
    $('#img-ocr-output').value = text;
    $('#img-ocr-output-wrap').hidden = false;
    const conf = Math.round(data.confidence || 0);
    setMsg(result, `Готово. Уверенность: <b>${conf}%</b>${pdfNote}`, 'ok');
    toast({ title: 'OCR завершён', body: `Уверенность ${conf}%`, type: 'ok' });
  } catch (e) {
    setMsg(result, 'Ошибка: ' + (e.message || e), 'err');
  } finally {
    btnLoading(btn, false);
    $('#img-ocr-run').textContent = 'Распознать';
  }
});

$('#img-ocr-copy').addEventListener('click', async () => {
  const text = $('#img-ocr-output').value;
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Скопировано', type: 'ok' });
  } catch {
    toast({ title: 'Не удалось скопировать', type: 'err' });
  }
});
$('#img-ocr-download').addEventListener('click', () => {
  const text = $('#img-ocr-output').value;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ocr.txt';
  a.click();
});

// ============================================================
// Tool: QR — Generator
// ============================================================
async function renderQrToCanvas(canvas, text, opts) {
  const QR = await loadQRCode();
  await QR.toCanvas(canvas, text, {
    width: opts.size,
    margin: 2,
    errorCorrectionLevel: opts.ec,
    color: {
      dark:  opts.fg,
      light: opts.transparent ? '#00000000' : opts.bg,
    },
  });
}

async function renderQrToSvgString(text, opts) {
  const QR = await loadQRCode();
  return await QR.toString(text, {
    type: 'svg',
    width: opts.size,
    margin: 2,
    errorCorrectionLevel: opts.ec,
    color: {
      dark:  opts.fg,
      light: opts.transparent ? '#00000000' : opts.bg,
    },
  });
}

$('#qr-gen-run').addEventListener('click', async () => {
  const btn = $('#qr-gen-run');
  const result = $('#qr-gen-result');
  const text = $('#qr-gen-text').value.trim();
  if (!text) return setMsg(result, 'Введите текст или ссылку.', 'err');

  const opts = {
    size: parseInt($('#qr-gen-size').value, 10) || 512,
    ec:   $('#qr-gen-ec').value,
    fg:   $('#qr-gen-fg').value,
    bg:   $('#qr-gen-bg').value,
    transparent: $('#qr-gen-transparent').checked,
  };

  clearResult(result);
  btnLoading(btn, true, 'Генерирую...');
  try {
    await renderQrToCanvas($('#qr-gen-canvas'), text, opts);
    $('#qr-gen-stage').hidden = false;
    setMsg(result, 'Готово.', 'ok');
    $('#qr-gen-canvas').dataset.text = text;
    $('#qr-gen-canvas').dataset.opts = JSON.stringify(opts);
  } catch (e) {
    setMsg(result, 'Ошибка: ' + (e.message || e), 'err');
  } finally { btnLoading(btn, false); }
});

$('#qr-gen-dl-png').addEventListener('click', () => {
  const cv = $('#qr-gen-canvas');
  cv.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'qr.png';
    a.click();
  });
});

$('#qr-gen-dl-svg').addEventListener('click', async () => {
  const text = $('#qr-gen-canvas').dataset.text;
  if (!text) return;
  const opts = JSON.parse($('#qr-gen-canvas').dataset.opts);
  try {
    const svg = await renderQrToSvgString(text, opts);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'qr.svg';
    a.click();
  } catch (e) {
    toast({ title: 'Не удалось сохранить SVG', body: e.message, type: 'err' });
  }
});

// ============================================================
// Tool: QR — Scanner (camera + image upload)
// ============================================================
const qrScanState = {
  stream: null,
  raf: 0,
  scanning: false,
};

async function startQrCamera() {
  await loadJsQR();
  const video = $('#qr-scan-video');
  const overlay = $('#qr-scan-overlay');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  qrScanState.stream = stream;
  video.srcObject = stream;
  await video.play();
  $('.qr-scan-cam').classList.add('is-active');
  $('#qr-scan-start').hidden = true;
  $('#qr-scan-stop').hidden = false;
  qrScanState.scanning = true;
  scanQrLoop();
}

function stopQrCamera() {
  qrScanState.scanning = false;
  cancelAnimationFrame(qrScanState.raf);
  if (qrScanState.stream) {
    qrScanState.stream.getTracks().forEach((t) => t.stop());
    qrScanState.stream = null;
  }
  const video = $('#qr-scan-video');
  video.srcObject = null;
  $('.qr-scan-cam').classList.remove('is-active');
  $('#qr-scan-start').hidden = false;
  $('#qr-scan-stop').hidden = true;
}

function scanQrLoop() {
  if (!qrScanState.scanning) return;
  const video = $('#qr-scan-video');
  const overlay = $('#qr-scan-overlay');
  if (video.readyState !== video.HAVE_ENOUGH_DATA) {
    qrScanState.raf = requestAnimationFrame(scanQrLoop);
    return;
  }
  const cv = document.createElement('canvas');
  cv.width = video.videoWidth; cv.height = video.videoHeight;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(video, 0, 0, cv.width, cv.height);
  const img = cx.getImageData(0, 0, cv.width, cv.height);
  const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  if (code && code.data) {
    handleQrFound(code.data, 'камера');
    stopQrCamera();
    return;
  }
  qrScanState.raf = requestAnimationFrame(scanQrLoop);
}

function handleQrFound(text, source) {
  const result = $('#qr-scan-result');
  const isUrl = /^https?:\/\//i.test(text);
  result.innerHTML = `
    <div class="msg ok">QR распознан (${source}):</div>
    <div class="qr-found">
      ${isUrl ? `<a href="${escapeHtml(text)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`
              : `<pre>${escapeHtml(text)}</pre>`}
      <div class="row" style="margin-top:12px">
        <button class="btn-ghost" id="qr-found-copy">📋 Скопировать</button>
      </div>
    </div>`;
  document.getElementById('qr-found-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); toast({ title: 'Скопировано', type: 'ok' }); }
    catch { toast({ title: 'Не получилось', type: 'err' }); }
  });
  toast({ title: 'QR-код прочитан', type: 'ok' });
}

$('#qr-scan-start').addEventListener('click', async () => {
  try { await startQrCamera(); }
  catch (e) { toast({ title: 'Нет доступа к камере', body: e.message, type: 'err' }); }
});
$('#qr-scan-stop').addEventListener('click', stopQrCamera);

$('#qr-scan-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await loadJsQR();
    const bmp = await decodeImageFile(file);
    const cv = drawToCanvas(bmp, bmp.width || bmp.naturalWidth, bmp.height || bmp.naturalHeight);
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const img = cx.getImageData(0, 0, cv.width, cv.height);
    const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) handleQrFound(code.data, 'картинка');
    else setMsg($('#qr-scan-result'), 'QR-код не найден на изображении.', 'err');
  } catch (err) {
    setMsg($('#qr-scan-result'), 'Ошибка: ' + (err.message || err), 'err');
  }
});

// ============================================================
// Tool: Recorder — Screen capture
// ============================================================
const screenRec = {
  recorder: null,
  chunks: [],
  stream: null,
  startedAt: 0,
  timer: 0,
};

function pickRecorderMime(format) {
  const candidates = format === 'mp4'
    ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function fmtSec(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

$('#rec-screen-start').addEventListener('click', async () => {
  const result = $('#rec-screen-result');
  const fmt = $('#rec-screen-format').value;
  const wantMic = $('#rec-screen-mic').checked;
  const wantSys = $('#rec-screen-sysaudio').checked;
  clearResult(result);
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: wantSys,
    });
    let combined = display;
    if (wantMic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // Merge audio tracks via AudioContext for proper mixing
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        if (wantSys && display.getAudioTracks().length) {
          ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
        }
        ctx.createMediaStreamSource(mic).connect(dest);
        combined = new MediaStream([
          ...display.getVideoTracks(),
          ...dest.stream.getAudioTracks(),
        ]);
        screenRec._extraTracks = [...mic.getTracks(), ...display.getAudioTracks()];
      } catch (e) {
        toast({ title: 'Нет доступа к микрофону, продолжаю без него', type: 'err' });
      }
    }

    const mime = pickRecorderMime(fmt);
    if (!mime) throw new Error('Формат не поддерживается этим браузером');
    const recorder = new MediaRecorder(combined, { mimeType: mime });
    screenRec.recorder = recorder;
    screenRec.stream = combined;
    screenRec.chunks = [];
    screenRec.startedAt = Date.now();

    recorder.ondataavailable = (e) => { if (e.data?.size) screenRec.chunks.push(e.data); };
    recorder.onstop = () => {
      const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      const blob = new Blob(screenRec.chunks, { type: mime });
      const preview = $('#rec-screen-preview');
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
      setMsg(result, `Готово: ${fmtBytes(blob.size)} · ${fmtSec((Date.now() - screenRec.startedAt) / 1000)}`, 'ok');
      addDownloadLink(result, blob, `screen-${Date.now()}.${ext}`, '⬇ Скачать');
      combined.getTracks().forEach((t) => t.stop());
      (screenRec._extraTracks || []).forEach((t) => t.stop());
      $('#rec-screen-status').classList.remove('is-recording');
      clearInterval(screenRec.timer);
      $('#rec-screen-start').hidden = false;
      $('#rec-screen-stop').hidden = true;
      toast({ title: 'Запись сохранена', type: 'ok' });
    };

    // Auto-stop when user clicks browser's "Stop sharing"
    display.getVideoTracks()[0].addEventListener('ended', () => {
      if (recorder.state === 'recording') recorder.stop();
    });

    recorder.start(1000);
    $('#rec-screen-status').classList.add('is-recording');
    $('#rec-screen-start').hidden = true;
    $('#rec-screen-stop').hidden = false;
    screenRec.timer = setInterval(() => {
      $('#rec-screen-time').textContent = fmtSec((Date.now() - screenRec.startedAt) / 1000);
    }, 500);
  } catch (e) {
    if (e.name === 'NotAllowedError') setMsg(result, 'Запись отменена.', 'err');
    else setMsg(result, 'Ошибка: ' + (e.message || e), 'err');
  }
});

$('#rec-screen-stop').addEventListener('click', () => {
  if (screenRec.recorder?.state === 'recording') screenRec.recorder.stop();
});

// ============================================================
// Tool: Recorder — Audio from video (ffmpeg.wasm)
// ============================================================
$('#rec-audio-run').addEventListener('click', async () => {
  const btn = $('#rec-audio-run');
  const result = $('#rec-audio-result');
  const file = $('#rec-audio-file').files?.[0];
  if (!file) return setMsg(result, 'Выберите видео-файл.', 'err');

  const format = $('#rec-audio-format').value; // mp3 | wav | aac | opus
  const fmtMap = {
    mp3:   { ext: 'mp3', mime: 'audio/mpeg',     args: ['-vn', '-codec:a', 'libmp3lame', '-b:a', '192k'] },
    wav:   { ext: 'wav', mime: 'audio/wav',      args: ['-vn', '-codec:a', 'pcm_s16le'] },
    aac:   { ext: 'm4a', mime: 'audio/mp4',      args: ['-vn', '-codec:a', 'aac', '-b:a', '192k'] },
    opus:  { ext: 'ogg', mime: 'audio/ogg',      args: ['-vn', '-codec:a', 'libopus', '-b:a', '128k'] },
  };
  const conf = fmtMap[format];

  clearResult(result);
  btnLoading(btn, true, 'Загрузка ffmpeg.wasm...');
  try {
    setMsg(result, 'Загружаю движок ffmpeg (первый раз ~25 МБ)...', '');
    const ffmpeg = await getFfmpeg();
    setMsg(result, 'Извлекаю аудио...', '');
    const inName  = 'in.' + (file.name.split('.').pop() || 'mp4');
    const outName = 'out.' + conf.ext;
    await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    await ffmpeg.exec(['-i', inName, ...conf.args, outName]);
    const data = await ffmpeg.readFile(outName);
    const blob = new Blob([data.buffer], { type: conf.mime });
    setMsg(result, `Готово: ${fmtBytes(blob.size)}`, 'ok');
    addDownloadLink(result, blob, `${baseName(file.name)}.${conf.ext}`, '⬇ Скачать');
    toast({ title: 'Аудио извлечено', type: 'ok' });
    try { await ffmpeg.deleteFile(inName); await ffmpeg.deleteFile(outName); } catch {}
  } catch (e) {
    setMsg(result, 'Ошибка: ' + (e.message || e), 'err');
  } finally { btnLoading(btn, false); }
});

// ============================================================
// Bootstrap: stop QR camera when leaving the section
// ============================================================
document.querySelectorAll('[data-back], .card[data-tool]').forEach((el) => {
  el.addEventListener('click', () => {
    if (qrScanState.scanning) stopQrCamera();
  });
});