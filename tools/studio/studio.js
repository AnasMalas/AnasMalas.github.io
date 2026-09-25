(function () {
  const config = window.__STUDIO__ || {};
  const library = document.querySelector('[data-library]');
  const canvas = document.querySelector('[data-canvas]');
  const search = document.querySelector('[data-search]');
  const editButton = document.querySelector('[data-edit]');
  const saveButton = document.querySelector('[data-save]');
  const publishOpenButton = document.querySelector('[data-open-publish]');
  const formatbar = document.querySelector('[data-formatbar]');
  const stateElement = document.querySelector('[data-state]');
  const titleElement = document.querySelector('[data-title]');
  const kindElement = document.querySelector('[data-kind]');
  const branchElement = document.querySelector('[data-branch]');
  const picker = document.querySelector('[data-picker]');
  const detailsDialog = document.querySelector('[data-details-dialog]');
  const cropDialog = document.querySelector('[data-crop-dialog]');
  const publishDialog = document.querySelector('[data-publish-dialog]');
  const publishLog = document.querySelector('[data-publish-log]');
  const toast = document.querySelector('[data-toast]');
  const detailFields = Object.fromEntries(Array.from(document.querySelectorAll('[data-detail]')).map((field) => [field.dataset.detail, field]));
  const inlineFile = document.querySelector('[data-inline-file]');
  const leadFile = document.querySelector('[data-lead-file]');
  const compositionTools = document.querySelector('[data-composition]');
  const surfaceMatrix = document.querySelector('[data-surface-matrix]');
  const defaultOpenButtons = Array.from(document.querySelectorAll('[data-default-open]'));
  const desktopRatioButtons = Array.from(document.querySelectorAll('[data-desktop-ratio]'));

  const desktopRatios = {
    '16:10': { width: 1440, height: 900, size: '1440 × 900' },
    '16:9': { width: 1440, height: 810, size: '1440 × 810' }
  };
  let desktopRatio = '16:10';
  try { desktopRatio = localStorage.getItem('studio-desktop-ratio') || desktopRatio; } catch {}
  if (!desktopRatios[desktopRatio]) desktopRatio = '16:10';
  const initialDesktop = desktopRatios[desktopRatio];

  const viewDefinitions = {
    'desktop-light': { label: 'Desktop · light', ...initialDesktop, theme: 'light', phone: false },
    'mobile-light': { label: 'Mobile · light', size: '390 × 844', width: 390, height: 844, theme: 'light', phone: true },
    'desktop-dark': { label: 'Desktop · dark', ...initialDesktop, theme: 'dark', phone: false },
    'mobile-dark': { label: 'Mobile · dark', size: '390 × 844', width: 390, height: 844, theme: 'dark', phone: true }
  };
  const frameObserver = new ResizeObserver((entries) => entries.forEach(({ target }) => fitFrame(target.querySelector('iframe'))));
  const canvasObserver = new ResizeObserver(() => layoutCanvas(visibleViews()));

  let site = null;
  let items = [];
  let selected = null;
  let editing = false;
  let dirty = false;
  let activeFrame = null;
  let activeRange = null;
  let toastTimer = null;
  let previewMode = 'dedicated';
  let variantSettings = {};
  let defaultExpanded = false;
  let draftContent = null;
  let cropDialogSurface = null;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.method && options.method !== 'GET' ? { 'X-Studio-Token': config.token } : {}),
        ...(options.headers || {})
      }
    });
    const result = await response.json().catch(() => ({ ok: false, error: 'The Studio returned an unreadable response.' }));
    if (!response.ok || !result.ok) throw new Error(result.error || 'Studio action failed.');
    return result;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  function setState(message, tone = '') {
    stateElement.dataset.tone = tone;
    stateElement.querySelector('span').textContent = message;
  }

  function setDirty(next = true) {
    dirty = next;
    saveButton.disabled = !dirty;
    publishOpenButton.disabled = dirty;
    if (dirty) setState('Unsaved changes', 'busy');
    else if (editing) setState('Editing', 'good');
    else setState('Saved locally', 'good');
  }

  function groupLabel(value) {
    return ({
      home: 'Site',
      articles: 'Articles',
      projects: 'Projects',
      'open-source': 'Open source',
      pages: 'Pages'
    })[value] || value;
  }

  function renderLibrary(filter = '') {
    const query = filter.trim().toLowerCase();
    const visible = items.filter((item) => !query || item.title.toLowerCase().includes(query) || groupLabel(item.group).toLowerCase().includes(query));
    const groups = [];
    visible.forEach((item) => { if (!groups.includes(item.group)) groups.push(item.group); });
    library.innerHTML = groups.map((group) => {
      const orderedPosts = items.filter((item) => item.type === 'post' && item.group === group);
      const buttons = visible.filter((item) => item.group === group).map((item) => {
        const orderIndex = orderedPosts.findIndex((post) => post.id === item.id);
        const ordering = item.type === 'post' ? `<span class="library-order" aria-label="Move ${escapeHtml(item.title)}"><button type="button" data-move-item="${item.id}" data-move="up" title="Move earlier" aria-label="Move earlier"${orderIndex <= 0 ? ' disabled' : ''}>↑</button><button type="button" data-move-item="${item.id}" data-move="down" title="Move later" aria-label="Move later"${orderIndex < 0 || orderIndex >= orderedPosts.length - 1 ? ' disabled' : ''}>↓</button></span>` : '';
        return `<div class="library-row${selected?.id === item.id ? ' active' : ''}"><button class="library-item${selected?.id === item.id ? ' active' : ''}" type="button" data-item="${item.id}">${escapeHtml(item.title)}</button>${ordering}</div>`;
      }).join('');
      return `<div class="library-group">${escapeHtml(groupLabel(group))}</div>${buttons}`;
    }).join('');
    library.querySelectorAll('[data-item]').forEach((button) => button.addEventListener('click', () => selectItem(items.find((item) => item.id === button.dataset.item))));
    library.querySelectorAll('[data-move-item]').forEach((button) => button.addEventListener('click', () => moveItem(button.dataset.moveItem, button.dataset.move)));
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
  }

  function visibleViews() {
    return Array.from(document.querySelectorAll('.view-options input:checked')).map((input) => input.value);
  }

  function layoutCanvas(views) {
    canvas.style.gridTemplateColumns = '';
    if (views.length !== 2) return;
    const desktopIndex = views.findIndex((key) => !viewDefinitions[key].phone);
    const mobileIndex = views.findIndex((key) => viewDefinitions[key].phone);
    if (desktopIndex < 0 || mobileIndex < 0) return;
    const innerWidth = Math.max(1, canvas.clientWidth - 30);
    const previewBodyHeight = Math.max(1, canvas.clientHeight - 66);
    const desktopView = viewDefinitions[views[desktopIndex]];
    const desktopIdeal = Math.ceil(previewBodyHeight * (desktopView.width / desktopView.height) + 16);
    const desktopWidth = clamp(desktopIdeal, Math.round(innerWidth * .52), innerWidth - 150);
    const mobileWidth = innerWidth - desktopWidth;
    const columns = views.map((_, index) => `${index === desktopIndex ? desktopWidth : mobileWidth}px`);
    canvas.style.gridTemplateColumns = columns.join(' ');
  }

  function setDesktopRatio(nextRatio, rerender = true) {
    const dimensions = desktopRatios[nextRatio];
    if (!dimensions) return;
    desktopRatio = nextRatio;
    ['desktop-light', 'desktop-dark'].forEach((key) => Object.assign(viewDefinitions[key], dimensions));
    desktopRatioButtons.forEach((button) => button.classList.toggle('active', button.dataset.desktopRatio === desktopRatio));
    try { localStorage.setItem('studio-desktop-ratio', desktopRatio); } catch {}
    if (rerender && selected) renderFrames();
  }

  function previewUrl(frameKey) {
    const shared = selected?.type === 'post' && previewMode === 'shared';
    const url = new URL(shared ? selected.sectionUrl : (selected?.url || '/'), window.location.origin);
    url.searchParams.set('studio-preview', `${Date.now()}-${frameKey}`);
    if (shared) url.hash = selected.id;
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function selectItem(item, options = {}) {
    if (!item) return;
    if (dirty && !window.confirm('Discard the unsaved changes on this page?')) return;
    selected = item;
    editing = false;
    dirty = false;
    activeFrame = null;
    activeRange = null;
    draftContent = null;
    previewMode = options.previewMode || 'dedicated';
    variantSettings = JSON.parse(JSON.stringify(item.presentation?.variants || {}));
    defaultExpanded = Boolean(item.presentation?.defaultExpanded);
    titleElement.textContent = item.title;
    picker.value = item.id;
    kindElement.textContent = item.kind || 'Page';
    editButton.textContent = 'Edit';
    editButton.disabled = item.type === 'view';
    saveButton.disabled = true;
    publishOpenButton.disabled = false;
    formatbar.hidden = true;
    compositionTools.hidden = item.type !== 'post';
    populateDetails();
    renderLibrary(search.value);
    renderFrames();
    setState('Saved locally', 'good');
  }

  function populateDetails() {
    const metadata = selected?.presentation || {};
    Object.entries(detailFields).forEach(([key, field]) => { field.value = metadata[key] || ''; });
    updateVariantControls();
  }

  function variantFor(mode, device, create = false) {
    const metadata = selected?.presentation || {};
    const defaults = {
      titlePlacement: metadata.titlePlacement || 'bottom',
      cropAspect: device === 'mobile' ? 'landscape' : 'wide',
      cropX: 0,
      cropY: 0,
      cropZoom: 1,
      cropFill: 'blank',
      cropColor: '#252525'
    };
    const saved = variantSettings?.[mode]?.[device] || {};
    if (!create) return { ...defaults, ...saved };
    variantSettings[mode] ||= {};
    variantSettings[mode][device] = { ...defaults, ...saved };
    return variantSettings[mode][device];
  }

  function updateVariantControls() {
    if (!selected) return;
    if (selected.type !== 'post') return;
    defaultOpenButtons.forEach((button) => {
      const active = (button.dataset.defaultOpen === 'true') === defaultExpanded;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderSurfaceMatrix();
    if (cropDialog?.open && cropDialogSurface) renderCropDialog(cropDialogSurface.mode, cropDialogSurface.device);
  }

  function leadImage() {
    const metadata = selected?.presentation || {};
    return detailFields.image?.value || metadata.images?.[0]?.src || metadata.image || '';
  }

  async function sampleEdgeColor(source) {
    if (!source) return null;
    try {
      const image = document.createElement('img');
      image.decoding = 'async';
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, 32, 32);
      const pixels = context.getImageData(0, 0, 32, 32).data;
      let red = 0; let green = 0; let blue = 0; let count = 0;
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          if (x > 2 && x < 29 && y > 2 && y < 29) continue;
          const index = (y * 32 + x) * 4;
          if (pixels[index + 3] < 32) continue;
          red += pixels[index]; green += pixels[index + 1]; blue += pixels[index + 2]; count += 1;
        }
      }
      if (!count) return null;
      const hex = (value) => Math.round(value / count).toString(16).padStart(2, '0');
      return `#${hex(red)}${hex(green)}${hex(blue)}`;
    } catch (_) { return null; }
  }

  function choice(field, value, label, variant, mode, device, title = '') {
    const active = String(variant[field]) === String(value);
    return `<button type="button" data-variant-field="${field}" data-value="${value}" data-mode="${mode}" data-device="${device}" aria-pressed="${active}" class="${active ? 'active' : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>${label}</button>`;
  }

  function titleChoices(variant, mode, device) {
    return `<fieldset class="surface-choice title-choice"><legend>Title + label + date</legend><div class="mini-grid cols-3">
      ${choice('titlePlacement', 'outside', 'Out', variant, mode, device, 'Title, type, and date outside image')}
      ${choice('titlePlacement', 'top', 'Top', variant, mode, device, 'Title, type, and date over image · top')}
      ${choice('titlePlacement', 'bottom', 'Bottom', variant, mode, device, 'Title, type, and date over image · bottom')}
      ${choice('titlePlacement', 'left', 'Left', variant, mode, device, 'Title, type, and date over image · left')}
      ${choice('titlePlacement', 'right', 'Right', variant, mode, device, 'Title, type, and date over image · right')}
      ${choice('titlePlacement', 'fade', 'Fade', variant, mode, device, 'Title, type, and date over a soft fade')}
    </div></fieldset>`;
  }

  function cropControls(variant, device, large = false) {
    const mode = 'shared';
    const image = leadImage();
    const background = variant.cropFill === 'match' ? variant.cropColor : '#f5f5f1';
    return `<div class="crop-workbench${large ? ' crop-workbench-large' : ''}">
      <div class="crop-frame${large ? ' crop-frame-large' : ''} aspect-${variant.cropAspect}" data-crop-editor data-mode="${mode}" data-device="${device}" tabindex="0" aria-label="Crop ${device} image. Drag or use arrow keys to reposition; scroll to zoom." title="Drag or use arrow keys to reposition. Scroll to zoom." style="background:${escapeHtml(background)}">
        <img src="${escapeHtml(image)}" alt="" draggable="false" style="transform:translate(${variant.cropX}%,${variant.cropY}%) scale(${variant.cropZoom})">
        <span class="crop-boundary" aria-hidden="true"></span>
      </div>
      <div class="crop-options">
        <div class="crop-row"><span>Frame</span>${choice('cropAspect', 'wide', '16:9', variant, mode, device)}${choice('cropAspect', 'landscape', '4:3', variant, mode, device)}</div>
        <div class="crop-row crop-zoom"><span>Zoom</span><button type="button" data-zoom-step="-.1" data-mode="${mode}" data-device="${device}" aria-label="Zoom out">−</button><input type="range" min=".5" max="3" step=".01" value="${variant.cropZoom}" data-crop-zoom data-mode="${mode}" data-device="${device}" aria-label="Crop zoom"><button type="button" data-zoom-step=".1" data-mode="${mode}" data-device="${device}" aria-label="Zoom in">+</button></div>
        <div class="crop-row"><span>Outside</span>${choice('cropFill', 'blank', 'Blank', variant, mode, device, 'Use clean page-colored space beyond the photo')}${choice('cropFill', 'match', 'Match', variant, mode, device, 'Sample and match the photo edge color')}<label class="color-pick" title="Choose matching color"><input type="color" value="${escapeHtml(variant.cropColor)}" data-crop-color data-mode="${mode}" data-device="${device}"><span style="background:${escapeHtml(variant.cropColor)}"></span></label><button type="button" class="eyedropper" data-eyedropper data-mode="${mode}" data-device="${device}" title="Pick a matching color from the screen" aria-label="Pick matching color">⌾</button></div>
        <div class="crop-actions"><button type="button" data-crop-reset data-mode="${mode}" data-device="${device}">Reset crop</button>${large ? '<span>Snaps to center and 100% zoom</span>' : `<button type="button" data-crop-expand data-mode="${mode}" data-device="${device}">Open large</button>`}</div>
      </div>
    </div>`;
  }

  function renderCropDialog(mode, device) {
    if (!cropDialog || !selected || !leadImage()) return;
    const label = device === 'mobile' ? 'Mobile' : 'Desktop';
    cropDialog.innerHTML = `<form method="dialog" class="crop-dialog-card">
      <header><div><span>Shared card · ${label}</span><strong>Crop image</strong><small>Drag the image, use arrow keys for precise moves, or scroll to zoom.</small></div><button value="close" aria-label="Close large crop editor">×</button></header>
      <div class="crop-dialog-workspace">${cropControls(variantFor(mode, device), device, true)}</div>
      <footer><span>Position snaps to center. Zoom snaps to 100%.</span><button class="button button-save" value="close">Done</button></footer>
    </form>`;
    bindCropEditors(cropDialog);
  }

  function renderSurfaceMatrix() {
    if (!surfaceMatrix || selected?.type !== 'post') return;
    const image = leadImage();
    const surfaces = [
      ['dedicated', 'desktop'],
      ['dedicated', 'mobile'],
      ['shared', 'desktop'],
      ['shared', 'mobile']
    ];
    surfaceMatrix.innerHTML = surfaces.map(([mode, device]) => {
      const variant = variantFor(mode, device);
      const crop = mode === 'shared' && image ? cropControls(variant, device) : `<p class="surface-note">${image ? 'Full image · natural ratio' : 'Add a lead image in Details'}</p>`;
      return `<section class="surface-card${previewMode === mode ? ' previewing' : ''}" data-surface="${mode}-${device}">
        <header><span><strong>${mode === 'shared' ? 'Shared card' : 'Full page'}</strong><small>${device}</small></span><button type="button" data-show-mode="${mode}" title="Show this page context in the previews">View</button></header>
        ${titleChoices(variant, mode, device)}
        ${crop}
      </section>`;
    }).join('');
    bindCropEditors(surfaceMatrix);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function snapCenter(value, threshold = 2.5) {
    return Math.abs(value) <= threshold ? 0 : value;
  }

  function snapZoom(value, threshold = .045) {
    return Math.abs(value - 1) <= threshold ? 1 : value;
  }

  function applyVariantsToFrames(forceCollapsed = false) {
    canvas.querySelectorAll('[data-frame]').forEach((frame) => {
      if (!frame.contentDocument) return;
      applyVariantClasses(frame.contentDocument);
      if (forceCollapsed && previewMode === 'shared') {
        const card = postCardFor(frame.contentDocument);
        if (card?.matches('[data-disclosure]')) setCardOpen(card, false);
      }
    });
  }

  function updateCropPreview(mode, device) {
    const variant = variantFor(mode, device);
    document.querySelectorAll(`[data-crop-editor][data-mode="${mode}"][data-device="${device}"]`).forEach((editor) => {
      editor.classList.toggle('aspect-wide', variant.cropAspect === 'wide');
      editor.classList.toggle('aspect-landscape', variant.cropAspect === 'landscape');
      editor.style.background = variant.cropFill === 'match' ? variant.cropColor : '#f5f5f1';
      const image = editor.querySelector('img');
      if (image) image.style.transform = `translate(${variant.cropX}%,${variant.cropY}%) scale(${variant.cropZoom})`;
    });
    document.querySelectorAll(`[data-crop-zoom][data-mode="${mode}"][data-device="${device}"]`).forEach((range) => { range.value = variant.cropZoom; });
    document.querySelectorAll(`[data-crop-color][data-mode="${mode}"][data-device="${device}"]`).forEach((input) => {
      input.value = variant.cropColor;
      const swatch = input.nextElementSibling;
      if (swatch) swatch.style.background = variant.cropColor;
    });
    applyVariantsToFrames(true);
  }

  function bindCropEditors(root = surfaceMatrix) {
    root.querySelectorAll('[data-crop-editor]').forEach((editor) => {
      editor.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const mode = editor.dataset.mode;
        const device = editor.dataset.device;
        const modeChanged = previewMode !== mode;
        previewMode = mode;
        const variant = variantFor(mode, device, true);
        const start = { x: event.clientX, y: event.clientY, cropX: variant.cropX, cropY: variant.cropY };
        editor.setPointerCapture(event.pointerId);
        editor.classList.add('dragging');
        const move = (nextEvent) => {
          const rawX = clamp(start.cropX + ((nextEvent.clientX - start.x) / editor.clientWidth) * 100, -100, 100);
          const rawY = clamp(start.cropY + ((nextEvent.clientY - start.y) / editor.clientHeight) * 100, -100, 100);
          variant.cropX = snapCenter(rawX);
          variant.cropY = snapCenter(rawY);
          editor.classList.toggle('snap-x', variant.cropX === 0);
          editor.classList.toggle('snap-y', variant.cropY === 0);
          setDirty(true);
          updateCropPreview(mode, device);
        };
        const end = () => {
          editor.classList.remove('dragging', 'snap-x', 'snap-y');
          editor.removeEventListener('pointermove', move);
          editor.removeEventListener('pointerup', end);
          editor.removeEventListener('pointercancel', end);
          if (modeChanged) {
            renderSurfaceMatrix();
            renderFrames();
          }
        };
        editor.addEventListener('pointermove', move);
        editor.addEventListener('pointerup', end);
        editor.addEventListener('pointercancel', end);
      });
      editor.addEventListener('wheel', (event) => {
        event.preventDefault();
        const mode = editor.dataset.mode;
        const device = editor.dataset.device;
        const modeChanged = previewMode !== mode;
        previewMode = mode;
        const variant = variantFor(mode, device, true);
        variant.cropZoom = snapZoom(clamp(variant.cropZoom + (event.deltaY < 0 ? .08 : -.08), .5, 3));
        setDirty(true);
        updateCropPreview(mode, device);
        if (modeChanged) {
          renderSurfaceMatrix();
          renderFrames();
        }
      }, { passive: false });
      editor.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const mode = editor.dataset.mode;
        const device = editor.dataset.device;
        const modeChanged = previewMode !== mode;
        previewMode = mode;
        const variant = variantFor(mode, device, true);
        const step = event.shiftKey ? 5 : 1;
        if (event.key === 'ArrowLeft') variant.cropX = snapCenter(clamp(variant.cropX - step, -100, 100), .75);
        if (event.key === 'ArrowRight') variant.cropX = snapCenter(clamp(variant.cropX + step, -100, 100), .75);
        if (event.key === 'ArrowUp') variant.cropY = snapCenter(clamp(variant.cropY - step, -100, 100), .75);
        if (event.key === 'ArrowDown') variant.cropY = snapCenter(clamp(variant.cropY + step, -100, 100), .75);
        editor.classList.toggle('snap-x', variant.cropX === 0);
        editor.classList.toggle('snap-y', variant.cropY === 0);
        setDirty(true);
        updateCropPreview(mode, device);
        window.setTimeout(() => editor.classList.remove('snap-x', 'snap-y'), 240);
        if (modeChanged) { renderSurfaceMatrix(); renderFrames(); }
      });
    });
  }

  function postCardFor(document) {
    return selected?.type === 'post'
      ? document.getElementById(selected.id) || document.querySelector('.post-card-full, .post-card')
      : null;
  }

  function setCardOpen(card, expanded) {
    card.dataset.open = String(expanded);
    const button = card.querySelector('[data-disclosure-button]');
    if (!button) return;
    button.setAttribute('aria-expanded', String(expanded));
    const label = button.querySelector('[data-disclosure-label]');
    const icon = button.querySelector('[data-disclosure-icon]');
    if (label) label.textContent = expanded ? button.dataset.collapseLabel : button.dataset.expandLabel;
    if (icon) icon.textContent = expanded ? '−' : '+';
  }

  function captureDraft() {
    if (!dirty) return;
    const frame = canvas.querySelector('[data-frame]');
    if (!frame?.contentDocument) return;
    const fields = fieldsFor(frame.contentDocument);
    draftContent = {
      title: fields.title?.textContent || '',
      bodyHtml: fields.body?.innerHTML || ''
    };
  }

  function renderFrames() {
    frameObserver.disconnect();
    captureDraft();
    const views = visibleViews();
    canvas.className = `canvas view-count-${views.length}`;
    if (!views.length) {
      canvas.innerHTML = '<p class="empty">Turn on at least one preview.</p>';
      return;
    }
    canvas.innerHTML = views.map((key) => {
      const view = viewDefinitions[key];
      return `<article class="preview${view.phone ? ' phone' : ''}${editing ? ' editing' : ''}" data-preview="${key}"><header><span>${view.label}</span><small>${view.size}</small></header><div class="preview-body"><div class="preview-stage"><iframe title="${view.label} preview" data-frame="${key}"></iframe></div></div></article>`;
    }).join('');
    layoutCanvas(views);
    canvas.querySelectorAll('[data-frame]').forEach((frame) => {
      const body = frame.closest('.preview-body');
      frameObserver.observe(body);
      fitFrame(frame);
      frame.addEventListener('load', () => prepareFrame(frame));
      frame.src = previewUrl(frame.dataset.frame);
    });
  }

  function fitFrame(frame) {
    if (!frame) return;
    const view = viewDefinitions[frame.dataset.frame];
    const stage = frame.parentElement;
    const body = stage.parentElement;
    const availableWidth = Math.max(1, body.clientWidth - 14);
    const availableHeight = Math.max(1, body.clientHeight - 14);
    const scale = Math.min(availableWidth / view.width, availableHeight / view.height);
    stage.style.width = `${view.width * scale}px`;
    stage.style.height = `${view.height * scale}px`;
    frame.style.width = `${view.width}px`;
    frame.style.height = `${view.height}px`;
    frame.style.transform = `scale(${scale})`;
  }

  function injectFrameStyle(document) {
    let style = document.querySelector('#studio-edit-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'studio-edit-style';
      style.textContent = `[data-studio-field][contenteditable="true"]{cursor:text!important;border-radius:2px;outline:1px dashed #0c857d99!important;outline-offset:5px}[data-studio-field][contenteditable="true"]:focus{outline:3px solid #0c857d!important;outline-offset:5px}.post-body[contenteditable="true"]{min-height:100px}.studio-selectable-post{cursor:pointer!important;transition:outline-color .12s}.studio-selectable-post:hover{outline:3px solid #0c857d!important;outline-offset:3px}`;
      document.head.append(style);
    }
  }

  function fieldsFor(document) {
    if (selected.type === 'post') {
      const card = postCardFor(document);
      const titles = Array.from(card?.querySelectorAll('.post-lead') || []);
      return {
        title: titles.find((element) => {
          const block = element.closest('.post-title-block');
          return !block || document.defaultView.getComputedStyle(block).display !== 'none';
        }) || titles[0] || null,
        body: card?.querySelector('.post-body') || null
      };
    }
    if (selected.id === 'about') return { title: null, body: document.querySelector('.about-page') };
    if (selected.id === 'bc2' || selected.id === 'bc2Console') {
      return { title: document.querySelector('.placeholder-page h1'), body: document.querySelector('.studio-page-copy') };
    }
    return { title: null, body: null };
  }

  function prepareFrame(frame) {
    const document = frame.contentDocument;
    if (!document) return;
    const view = viewDefinitions[frame.dataset.frame];
    document.documentElement.dataset.theme = view.theme;
    injectFrameStyle(document);
    applyVariantClasses(document);
    if (draftContent) {
      const fields = fieldsFor(document);
      if (fields.title) fields.title.textContent = draftContent.title;
      if (fields.body) fields.body.innerHTML = draftContent.bodyHtml;
    }
    document.querySelectorAll('a').forEach((link) => link.addEventListener('click', (event) => {
      if (editing) { event.preventDefault(); return; }
      const url = new URL(link.href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      const match = items.find((item) => item.url === url.pathname);
      if (match) { event.preventDefault(); selectItem(match); }
    }));
    if (selected.type === 'view') {
      document.querySelectorAll('.post-card[id]').forEach((card) => {
        const match = items.find((item) => item.type === 'post' && item.id === card.id);
        if (!match) return;
        card.classList.add('studio-selectable-post');
        card.addEventListener('click', (event) => {
          if (event.target.closest('a, button, input, select')) return;
          event.preventDefault();
          selectItem(match, { previewMode: 'shared' });
        });
      });
    }
    if (editing) enableEditing(frame);
  }

  function applyVariantClasses(document) {
    const card = postCardFor(document);
    if (!card?.classList.contains('post-card-photo')) return;
    const prefixes = ['post-title-desktop-', 'post-title-mobile-', 'post-fit-desktop-', 'post-fit-mobile-', 'post-crop-desktop-', 'post-crop-mobile-', 'post-shape-desktop-', 'post-shape-mobile-', 'post-crop-aspect-desktop-', 'post-crop-aspect-mobile-', 'post-crop-fill-desktop-', 'post-crop-fill-mobile-'];
    Array.from(card.classList).forEach((name) => {
      if (prefixes.some((prefix) => name.startsWith(prefix))) card.classList.remove(name);
    });
    ['desktop', 'mobile'].forEach((device) => {
      const variant = variantFor(previewMode, device);
      card.classList.add(`post-title-${device}-${variant.titlePlacement}`);
      card.classList.add(`post-crop-aspect-${device}-${variant.cropAspect}`);
      card.classList.add(`post-crop-fill-${device}-${variant.cropFill}`);
      card.style.setProperty(`--crop-${device}-x`, `${variant.cropX}%`);
      card.style.setProperty(`--crop-${device}-y`, `${variant.cropY}%`);
      card.style.setProperty(`--crop-${device}-zoom`, variant.cropZoom);
      card.style.setProperty(`--crop-${device}-color`, variant.cropColor);
    });
    if (previewMode === 'shared' && card.matches('[data-disclosure]')) setCardOpen(card, defaultExpanded);
  }

  function enableEditing(frame) {
    const document = frame.contentDocument;
    const fields = fieldsFor(document);
    Object.entries(fields).forEach(([key, element]) => {
      if (!element) return;
      element.dataset.studioField = key;
      element.contentEditable = 'true';
      element.spellcheck = true;
      element.addEventListener('focus', () => { activeFrame = frame; });
      element.addEventListener('input', () => {
        synchronizeField(key, element, frame);
        setDirty(true);
      });
    });
    document.addEventListener('selectionchange', () => {
      const selection = frame.contentWindow.getSelection();
      if (!selection || !selection.rangeCount) return;
      const node = selection.anchorNode;
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      if (element?.closest?.('[data-studio-field]')) {
        activeFrame = frame;
        activeRange = selection.getRangeAt(0).cloneRange();
      }
    });
  }

  function synchronizeField(key, source, sourceFrame) {
    if (key === 'title') {
      source.closest('.post-card')?.querySelectorAll('.post-lead').forEach((title) => {
        if (title !== source) title.textContent = source.textContent;
      });
    }
    canvas.querySelectorAll('[data-frame]').forEach((frame) => {
      if (frame === sourceFrame || !frame.contentDocument) return;
      if (key === 'title') {
        const card = postCardFor(frame.contentDocument);
        card?.querySelectorAll('.post-lead').forEach((title) => { title.textContent = source.textContent; });
      } else {
        const target = frame.contentDocument.querySelector(`[data-studio-field="${key}"]`);
        if (target) target.innerHTML = source.innerHTML;
      }
    });
    if (key === 'title') {
      titleElement.textContent = source.textContent.trim();
      selected.title = source.textContent.trim();
      renderLibrary(search.value);
    }
  }

  function toggleEditing() {
    if (selected.type === 'view') return;
    editing = !editing;
    editButton.textContent = editing ? 'Stop editing' : 'Edit';
    formatbar.hidden = !editing;
    canvas.querySelectorAll('.preview').forEach((preview) => preview.classList.toggle('editing', editing));
    canvas.querySelectorAll('[data-frame]').forEach((frame) => {
      const fields = fieldsFor(frame.contentDocument);
      if (editing) enableEditing(frame);
      else Object.values(fields).filter(Boolean).forEach((element) => { element.contentEditable = 'false'; });
    });
    setState(editing ? 'Editing' : (dirty ? 'Unsaved changes' : 'Saved locally'), editing ? 'good' : (dirty ? 'busy' : 'good'));
  }

  function restoreSelection() {
    if (!activeFrame?.contentDocument) return null;
    const selection = activeFrame.contentWindow.getSelection();
    if (activeRange) {
      selection.removeAllRanges();
      selection.addRange(activeRange);
    }
    return activeFrame.contentDocument;
  }

  function runCommand(command, value) {
    const document = restoreSelection();
    if (!document) { showToast('Click inside the text first.'); return; }
    document.execCommand(command, false, value);
    const editable = document.querySelector('[data-studio-field="body"]:focus') || document.activeElement?.closest?.('[data-studio-field]');
    if (editable) {
      synchronizeField(editable.dataset.studioField, editable, activeFrame);
      setDirty(true);
    }
  }

  async function fileData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function upload(file) {
    setState('Uploading image…', 'busy');
    const result = await api('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, data: await fileData(file), slug: selected.id })
    });
    setState('Image added · save when ready', 'busy');
    return result.path;
  }

  function activePayload() {
    const firstFrame = canvas.querySelector('[data-frame]');
    if (!firstFrame?.contentDocument) throw new Error('The preview is still loading.');
    const fields = fieldsFor(firstFrame.contentDocument);
    if (!fields.body) throw new Error('This page does not have an editable content area.');
    const presentation = Object.fromEntries(Object.entries(detailFields).map(([key, field]) => [key, field.value.trim()]));
    presentation.variants = variantSettings;
    presentation.defaultExpanded = defaultExpanded;
    return {
      type: selected.type,
      id: selected.id,
      title: fields.title ? fields.title.textContent.trim() : selected.title,
      bodyHtml: fields.body.innerHTML.trim(),
      presentation
    };
  }

  async function save() {
    try {
      setState('Saving and rebuilding…', 'busy');
      saveButton.disabled = true;
      await api('/api/save', { method: 'POST', body: JSON.stringify(activePayload()) });
      editing = false;
      dirty = false;
      draftContent = null;
      editButton.textContent = 'Edit';
      formatbar.hidden = true;
      publishOpenButton.disabled = false;
      setState('Saved locally', 'good');
      showToast('Saved. Every preview now uses the new version.');
      await refreshSite(false);
      const refreshed = items.find((item) => item.id === selected.id);
      if (refreshed) selected = refreshed;
      renderLibrary(search.value);
      populateDetails();
      renderFrames();
    } catch (error) {
      saveButton.disabled = false;
      setState('Save failed', 'bad');
      showToast(error.message);
    }
  }

  async function moveItem(itemId, direction) {
    const movingItem = items.find((item) => item.id === itemId);
    if (movingItem?.type !== 'post') return;
    if (dirty) { showToast('Save this post before changing its position.'); return; }
    try {
      setState('Reordering and rebuilding…', 'busy');
      library.querySelectorAll('[data-move-item]').forEach((button) => { button.disabled = true; });
      await api('/api/reorder', { method: 'POST', body: JSON.stringify({ id: itemId, direction }) });
      const selectedId = selected?.id;
      await refreshSite(false);
      selected = items.find((item) => item.id === selectedId) || selected;
      if (selected?.id === itemId) previewMode = 'shared';
      variantSettings = JSON.parse(JSON.stringify(selected.presentation?.variants || variantSettings));
      defaultExpanded = Boolean(selected.presentation?.defaultExpanded);
      renderLibrary(search.value);
      updateVariantControls();
      renderFrames();
      setState('Order saved locally', 'good');
      showToast(`Moved ${direction === 'up' ? 'earlier' : 'later'} on the shared page.`);
    } catch (error) {
      setState('Reorder failed', 'bad');
      showToast(error.message);
      renderLibrary(search.value);
    }
  }

  function changeVariant(mode, device, field, value, forceCollapsed = false) {
    const modeChanged = previewMode !== mode;
    previewMode = mode;
    const variant = variantFor(mode, device, true);
    variant[field] = ['cropX', 'cropY', 'cropZoom'].includes(field) ? Number(value) : value;
    setDirty(true);
    updateVariantControls();
    if (modeChanged) renderFrames();
    else applyVariantsToFrames(forceCollapsed);
  }

  function showMode(mode) {
    if (previewMode === mode) return;
    previewMode = mode;
    updateVariantControls();
    renderFrames();
  }

  function resetCrop(mode, device) {
    const modeChanged = previewMode !== mode;
    previewMode = mode;
    const variant = variantFor(mode, device, true);
    variant.cropAspect = device === 'mobile' ? 'landscape' : 'wide';
    variant.cropX = 0;
    variant.cropY = 0;
    variant.cropZoom = 1;
    setDirty(true);
    updateVariantControls();
    if (modeChanged) renderFrames();
    else applyVariantsToFrames(true);
    showToast(`${device === 'mobile' ? 'Mobile' : 'Desktop'} crop reset.`);
  }

  function openCropDialog(mode, device) {
    const modeChanged = previewMode !== mode;
    previewMode = mode;
    if (modeChanged) {
      updateVariantControls();
      renderFrames();
    }
    cropDialogSurface = { mode, device };
    renderCropDialog(mode, device);
    cropDialog.showModal();
    cropDialog.querySelector('[data-crop-editor]')?.focus();
  }

  async function refreshSite(selectInitial = true) {
    site = await api('/api/site', { method: 'GET' });
    items = [
      { id: 'home', type: 'view', group: 'home', kind: 'Site', title: 'Home', url: '/' },
      { id: 'projectsIndex', type: 'view', group: 'home', kind: 'Site', title: 'Projects page', url: '/projects/' },
      { id: 'openSourceIndex', type: 'view', group: 'home', kind: 'Site', title: 'Open source page', url: '/open-source/' },
      ...site.posts,
      ...site.pages
    ];
    picker.innerHTML = items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(groupLabel(item.group))} · ${escapeHtml(item.title)}</option>`).join('');
    branchElement.textContent = `${site.status.branch || 'Git'} · ${site.status.changes} changed file${site.status.changes === 1 ? '' : 's'}`;
    if (selectInitial) selectItem(items[0]);
  }

  search.addEventListener('input', () => renderLibrary(search.value));
  picker.addEventListener('change', () => selectItem(items.find((item) => item.id === picker.value)));
  editButton.addEventListener('click', toggleEditing);
  saveButton.addEventListener('click', save);
  document.querySelectorAll('.view-options input').forEach((input) => input.addEventListener('change', renderFrames));
  desktopRatioButtons.forEach((button) => button.addEventListener('click', () => setDesktopRatio(button.dataset.desktopRatio)));
  defaultOpenButtons.forEach((button) => button.addEventListener('click', () => {
    const modeChanged = previewMode !== 'shared';
    previewMode = 'shared';
    defaultExpanded = button.dataset.defaultOpen === 'true';
    setDirty(true);
    updateVariantControls();
    if (modeChanged) renderFrames();
    else applyVariantsToFrames(false);
  }));
  async function handleCropControlClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.showMode) { showMode(button.dataset.showMode); return; }
    const mode = button.dataset.mode;
    const device = button.dataset.device;
    if (button.hasAttribute('data-crop-expand')) { openCropDialog(mode, device); return; }
    if (button.hasAttribute('data-crop-reset')) { resetCrop(mode, device); return; }
    if (button.dataset.variantField) {
      if (button.dataset.variantField === 'cropFill' && button.dataset.value === 'match') {
        const sampled = await sampleEdgeColor(leadImage());
        if (sampled) variantFor(mode, device, true).cropColor = sampled;
      }
      changeVariant(mode, device, button.dataset.variantField, button.dataset.value, mode === 'shared' && button.dataset.variantField !== 'titlePlacement');
      return;
    }
    if (button.dataset.zoomStep) {
      const modeChanged = previewMode !== mode;
      previewMode = mode;
      const variant = variantFor(mode, device, true);
      variant.cropZoom = snapZoom(clamp(variant.cropZoom + Number(button.dataset.zoomStep), .5, 3));
      setDirty(true);
      updateVariantControls();
      if (modeChanged) renderFrames();
      else applyVariantsToFrames(true);
      return;
    }
    if (button.hasAttribute('data-eyedropper')) {
      try {
        if (!window.EyeDropper) {
          button.closest('.crop-options')?.querySelector('[data-crop-color]')?.click();
          return;
        }
        const result = await new window.EyeDropper().open();
        const variant = variantFor(mode, device, true);
        variant.cropColor = result.sRGBHex;
        variant.cropFill = 'match';
        previewMode = mode;
        setDirty(true);
        updateVariantControls();
        applyVariantsToFrames(true);
      } catch (error) {
        if (error?.name !== 'AbortError') showToast('Could not sample that color.');
      }
    }
  }

  function handleCropControlInput(event) {
    const control = event.target;
    const mode = control.dataset.mode;
    const device = control.dataset.device;
    if (control.matches('[data-crop-zoom]')) {
      const modeChanged = previewMode !== mode;
      previewMode = mode;
      variantFor(mode, device, true).cropZoom = snapZoom(clamp(Number(control.value), .5, 3), .025);
      setDirty(true);
      if (modeChanged) { renderSurfaceMatrix(); renderFrames(); }
      else updateCropPreview(mode, device);
    }
    if (control.matches('[data-crop-color]')) {
      const modeChanged = previewMode !== mode;
      previewMode = mode;
      const variant = variantFor(mode, device, true);
      variant.cropColor = control.value;
      variant.cropFill = 'match';
      setDirty(true);
      if (modeChanged) { renderSurfaceMatrix(); renderFrames(); }
      else updateCropPreview(mode, device);
    }
  }

  surfaceMatrix.addEventListener('click', handleCropControlClick);
  surfaceMatrix.addEventListener('input', handleCropControlInput);
  cropDialog.addEventListener('click', handleCropControlClick);
  cropDialog.addEventListener('input', handleCropControlInput);
  cropDialog.addEventListener('close', () => { cropDialogSurface = null; });
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('mousedown', (event) => { event.preventDefault(); runCommand(button.dataset.command); }));
  document.querySelectorAll('[data-block]').forEach((button) => button.addEventListener('mousedown', (event) => { event.preventDefault(); runCommand('formatBlock', button.dataset.block); }));
  document.querySelector('[data-link]').addEventListener('mousedown', (event) => {
    event.preventDefault();
    const url = window.prompt('Link URL');
    if (url) runCommand('createLink', url);
  });
  document.querySelector('[data-inline-image]').addEventListener('click', () => {
    if (!activeRange) { showToast('Place the cursor in the page text first.'); return; }
    inlineFile.click();
  });
  inlineFile.addEventListener('change', async () => {
    const file = inlineFile.files[0];
    inlineFile.value = '';
    if (!file) return;
    try {
      const imagePath = await upload(file);
      runCommand('insertHTML', `<figure class="inline-figure"><img src="${escapeHtml(imagePath)}" alt="" loading="lazy"><figcaption>Describe this image</figcaption></figure><p><br></p>`);
    } catch (error) { setState('Upload failed', 'bad'); showToast(error.message); }
  });
  document.querySelector('[data-details]').addEventListener('click', () => {
    if (selected.type !== 'post') { showToast('This page has no post details.'); return; }
    detailsDialog.showModal();
  });
  Object.values(detailFields).forEach((field) => field.addEventListener('input', () => setDirty(true)));
  document.querySelector('[data-upload-lead]').addEventListener('click', () => leadFile.click());
  leadFile.addEventListener('change', async () => {
    const file = leadFile.files[0];
    leadFile.value = '';
    if (!file) return;
    try {
      const imagePath = await upload(file);
      detailFields.image.value = imagePath;
      renderSurfaceMatrix();
      canvas.querySelectorAll('[data-frame]').forEach((frame) => {
        const image = frame.contentDocument?.querySelector('.post-gallery img, .post-hero img');
        if (image) image.src = imagePath;
      });
      setDirty(true);
    } catch (error) { setState('Upload failed', 'bad'); showToast(error.message); }
  });

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || selected?.type !== 'post') return;
    if (event.target.closest('input, select, [contenteditable="true"]')) return;
    event.preventDefault();
    moveItem(selected.id, event.key === 'ArrowUp' ? 'up' : 'down');
  });

  publishOpenButton.addEventListener('click', () => {
    publishLog.hidden = true;
    publishLog.textContent = '';
    publishDialog.showModal();
  });
  document.querySelector('[data-publish]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    publishLog.hidden = false;
    publishLog.textContent = 'Building, committing, and pushing to GitHub…';
    setState('Publishing…', 'busy');
    try {
      const result = await api('/api/publish', { method: 'POST', body: '{}' });
      publishLog.innerHTML = `Published successfully.\n\nGitHub Pages is updating now.\n<a href="${escapeHtml(result.liveUrl)}" target="_blank" rel="noopener">Open anasmalas.com ↗</a>`;
      setState('Published', 'good');
      showToast('Published. GitHub Pages is updating the live site.');
      await refreshSite(false);
    } catch (error) {
      publishLog.textContent = error.message;
      setState('Publish failed', 'bad');
    } finally { button.disabled = false; }
  });

  setDesktopRatio(desktopRatio, false);
  canvasObserver.observe(canvas);
  refreshSite().catch((error) => {
    setState('Studio could not load', 'bad');
    canvas.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  });
}());
