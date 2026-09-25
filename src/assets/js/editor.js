(function () {
  const storageKey = "anas-article-canvas-v2";
  const frames = Array.from(document.querySelectorAll("[data-view]"));
  const layout = document.querySelector("[data-layout]");
  const treatment = document.querySelector("[data-treatment]");
  const saveState = document.querySelector("[data-save-state]");
  const dialog = document.querySelector("[data-dialog]");
  const imageDialog = document.querySelector("[data-image-dialog]");
  const settings = Object.fromEntries(Array.from(document.querySelectorAll("[data-setting]")).map(function (input) { return [input.dataset.setting, input]; }));
  const inlineSettings = Object.fromEntries(Array.from(document.querySelectorAll("[data-inline-setting]")).map(function (input) { return [input.dataset.inlineSetting, input]; }));
  let activeFrame = null;
  let activeRange = null;
  let saveTimer = null;

  const model = {
    title: "A useful detail, explained clearly",
    category: "ENGINEERING NOTE",
    date: new Date().toISOString().slice(0, 10),
    description: "A concise explanation of what this article investigates and why the detail matters.",
    body: "<p>Start with the observation. Show the physical thing, the constraint, or the unexpected result that made the question worth asking.</p><h2>The useful detail</h2><p>Explain what changed once you looked more closely. Keep the reasoning attached to the evidence so another engineer can test the idea.</p>",
    display: "text",
    treatment: "lower",
    slug: "useful-detail",
    tags: "PCB design, DFM",
    image: "/assets/images/posts/usb-c-edge/01-pcb-type-c.jpg",
    imageAlt: "PCB edge USB-C connector test board",
    caption: "The receptacle is normal. The plug is the edge of the PCB."
  };

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>\"]/g, function (character) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[character]; });
  }

  function articleHtml() {
    const title = escapeHtml(model.title);
    const category = escapeHtml(model.category);
    const date = escapeHtml(model.date);
    const description = escapeHtml(model.description);
    if (model.display === "feature") {
      return `<article class="disclosure-article feature-article editing-article" data-open="true" data-treatment="${escapeHtml(model.treatment)}"><figure class="feature-figure"><div class="feature-hero"><img src="${escapeHtml(model.image)}" alt="${escapeHtml(model.imageAlt)}"><button class="change-image" type="button" data-edit-image>Change image</button><header class="feature-title"><small><b data-edit="category">${category}</b><span data-edit="date">${date}</span></small><h2 data-edit="title">${title}</h2></header></div>${model.caption ? `<figcaption data-edit="caption">${escapeHtml(model.caption)}</figcaption>` : ""}</figure><div class="article-dek"><p data-edit="description">${description}</p></div><div class="article-rest page-copy" data-edit="body">${model.body}</div></article>`;
    }
    return `<article class="disclosure-article text-article note-warm editing-article" data-open="true"><div class="text-surface"><header class="text-heading"><small><b data-edit="category">${category}</b><span data-edit="date">${date}</span></small><h2 data-edit="title">${title}</h2></header><div class="text-copy article-preview"><p data-edit="description">${description}</p></div><div class="text-copy article-rest page-copy" data-edit="body">${model.body}</div></div></article>`;
  }

  function frameDocument(mode) {
    const theme = mode.includes("dark") ? "dark" : "light";
    return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/site.css"><style>body{min-width:0}.site-header{position:static}.document{width:min(790px,calc(100% - 72px));margin:34px auto 90px}.editing-article{border:0}.editing-article .article-rest{display:block!important;padding-top:24px}.editing-article .feature-hero{height:520px}.editing-article small b{font:inherit;letter-spacing:inherit}[data-edit]{border-radius:2px;cursor:text}[data-edit]:hover{outline:1px dashed currentColor;outline-offset:4px}[data-edit]:focus{outline:2px solid #39bdb1;outline-offset:5px}.change-image{position:absolute;z-index:4;top:14px;right:14px;padding:7px 10px;border:1px solid #ffffff80;border-radius:3px;background:#121817cc;color:#fff;font:11px 'Segoe UI',sans-serif;cursor:pointer}.site-nav a{cursor:default}@media(max-width:520px){.document{width:calc(100% - 32px);margin:20px auto 55px}.editing-article .feature-hero{height:390px}.page-intro p{display:none}.text-surface{padding-top:25px}}</style></head><body><header class="site-header"><div class="shell header-inner"><div class="identity"><strong>Anas Malas</strong><span>Electronics &amp; Mechanical Engineer</span></div><nav class="site-nav"><a class="active">Articles</a><a>Projects</a><a>Open source</a><a>About</a></nav><div class="header-search"><span class="search-mark"></span><input placeholder="Search articles…" disabled></div></div></header><header class="page-intro shell"><h1>Articles</h1><p>Electronics, mechanical design, and experiments.</p></header><main class="document">${articleHtml()}</main></body></html>`;
  }

  function restore() {
    try { Object.assign(model, JSON.parse(localStorage.getItem(storageKey)) || {}); } catch (error) {}
    layout.value = model.display;
    treatment.value = model.treatment;
    treatment.disabled = model.display !== "feature";
    Object.entries(settings).forEach(function (entry) { entry[1].value = model[entry[0]] || ""; });
  }

  function scheduleSave() {
    saveState.textContent = "Saving…";
    saveState.dataset.dirty = "true";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(storageKey, JSON.stringify(model)); } catch (error) {}
      saveState.textContent = "Saved";
      saveState.dataset.dirty = "false";
    }, 350);
  }

  function syncField(key, sourceFrame) {
    frames.forEach(function (frame) {
      if (frame === sourceFrame || !frame.contentDocument) return;
      const target = frame.contentDocument.querySelector(`[data-edit="${key}"]`);
      if (!target) return;
      if (key === "body") target.innerHTML = model.body;
      else target.textContent = model[key];
    });
    if (settings[key]) settings[key].value = model[key];
  }

  function attachEditing(frame) {
    const document = frame.contentDocument;
    document.querySelectorAll("[data-edit]").forEach(function (element) {
      element.contentEditable = "true";
      element.spellcheck = true;
      element.addEventListener("focus", function () { activeFrame = frame; });
      element.addEventListener("keydown", function (event) {
        if (element.dataset.edit !== "body" && event.key === "Enter") { event.preventDefault(); element.blur(); }
      });
      element.addEventListener("input", function () {
        const key = element.dataset.edit;
        model[key] = key === "body" ? element.innerHTML : element.innerText.replace(/\s+/g, " ").trimStart();
        syncField(key, frame);
        scheduleSave();
      });
    });
    document.addEventListener("selectionchange", function () {
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-edit]")) {
        activeFrame = frame;
        const selection = frame.contentWindow.getSelection();
        if (selection.rangeCount) activeRange = selection.getRangeAt(0).cloneRange();
      }
    });
    document.querySelectorAll("a").forEach(function (link) { link.addEventListener("click", function (event) { event.preventDefault(); }); });
    const imageButton = document.querySelector("[data-edit-image]");
    if (imageButton) imageButton.addEventListener("click", function () {
      const nextImage = window.prompt("Image URL", model.image);
      if (nextImage) { model.image = nextImage; settings.image.value = nextImage; renderAll(); scheduleSave(); }
    });
  }

  function renderAll() {
    frames.forEach(function (frame) {
      frame.srcdoc = frameDocument(frame.dataset.view);
      frame.addEventListener("load", function () { attachEditing(frame); }, { once: true });
    });
  }

  function rangeEditable() {
    if (!activeRange) return null;
    const node = activeRange.commonAncestorContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    return element && element.closest ? element.closest("[data-edit]") : null;
  }

  function runCommand(command, value) {
    if (!activeFrame || !activeFrame.contentDocument) return;
    const document = activeFrame.contentDocument;
    const selection = activeFrame.contentWindow.getSelection();
    if (activeRange) { selection.removeAllRanges(); selection.addRange(activeRange); }
    document.execCommand(command, false, value);
    const editable = rangeEditable() || (document.activeElement.closest ? document.activeElement.closest("[data-edit]") : null);
    if (editable) {
      const key = editable.dataset.edit;
      model[key] = key === "body" ? editable.innerHTML : editable.innerText.replace(/\s+/g, " ");
      syncField(key, activeFrame);
      scheduleSave();
    }
  }

  function slugify(value) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function yamlString(value) { return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }
  function sourceText() {
    const slug = slugify(model.slug || model.title || "untitled-article");
    const tags = model.tags.split(",").map(function (tag) { return tag.trim(); }).filter(Boolean);
    const lines = ["---", "layout: layouts/note.njk", `title: ${yamlString(model.title)}`, `description: ${yamlString(model.description)}`, `date: ${model.date}`, `permalink: /notes/${slug}/`, `display: ${model.display}`, `titleTreatment: ${model.treatment}`];
    if (tags.length) { lines.push("tags:"); tags.forEach(function (tag) { lines.push(`  - ${yamlString(tag)}`); }); }
    if (model.display === "feature") lines.push("heroImage:", `  src: ${yamlString(model.image)}`, `  alt: ${yamlString(model.imageAlt)}`, `  caption: ${yamlString(model.caption)}`);
    lines.push("---", "", model.body, "");
    return lines.join("\n");
  }

  document.querySelectorAll("[data-command]").forEach(function (button) { button.addEventListener("mousedown", function (event) { event.preventDefault(); runCommand(button.dataset.command); }); });
  document.querySelectorAll("[data-block]").forEach(function (button) { button.addEventListener("mousedown", function (event) { event.preventDefault(); runCommand("formatBlock", button.dataset.block); }); });
  document.querySelector("[data-link]").addEventListener("mousedown", function (event) { event.preventDefault(); const url = window.prompt("Link URL"); if (url) runCommand("createLink", url); });
  document.querySelector("[data-inline-image]").addEventListener("mousedown", function (event) {
    event.preventDefault();
    const editable = rangeEditable();
    if (!activeFrame || !editable || editable.dataset.edit !== "body") {
      window.alert("Place the caret in the article body first.");
      return;
    }
    imageDialog.showModal();
    inlineSettings.src.focus();
  });
  document.querySelector("[data-insert-image]").addEventListener("click", function () {
    if (!inlineSettings.src.checkValidity() || !inlineSettings.alt.checkValidity()) {
      inlineSettings.src.closest("form").reportValidity();
      return;
    }
    const sizeClass = inlineSettings.size.value === "compact" ? " inline-figure--compact" : "";
    const alignmentClass = ` inline-figure--${inlineSettings.align.value}`;
    const caption = inlineSettings.caption.value.trim();
    const figure = `<figure class="inline-figure${sizeClass}${alignmentClass}"><img src="${escapeHtml(inlineSettings.src.value.trim())}" alt="${escapeHtml(inlineSettings.alt.value.trim())}" loading="lazy" decoding="async">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure><p><br></p>`;
    imageDialog.close();
    runCommand("insertHTML", figure);
    Object.values(inlineSettings).forEach(function (input) { if (input.tagName === "INPUT") input.value = ""; });
  });

  layout.addEventListener("change", function () { model.display = layout.value; treatment.disabled = model.display !== "feature"; document.querySelectorAll(".image-setting").forEach(function (field) { field.hidden = model.display !== "feature"; }); renderAll(); scheduleSave(); });
  treatment.addEventListener("change", function () { model.treatment = treatment.value; renderAll(); scheduleSave(); });
  document.querySelectorAll(".view-switches input").forEach(function (toggle) { toggle.addEventListener("change", function () { document.querySelector(`[data-view-card="${toggle.value}"]`).hidden = !toggle.checked; }); });
  document.querySelector("[data-details]").addEventListener("click", function () { dialog.showModal(); });
  Object.entries(settings).forEach(function (entry) { entry[1].addEventListener("input", function () { model[entry[0]] = entry[1].value; if (["image", "imageAlt", "caption"].includes(entry[0])) renderAll(); scheduleSave(); }); });
  document.querySelector("[data-copy]").addEventListener("click", async function () { await navigator.clipboard.writeText(sourceText()); saveState.textContent = "Copied"; });
  document.querySelector("[data-download]").addEventListener("click", function () { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([sourceText()], { type: "text/markdown;charset=utf-8" })); link.download = `${slugify(model.slug || model.title)}.md`; link.click(); URL.revokeObjectURL(link.href); });

  restore();
  document.querySelectorAll(".image-setting").forEach(function (field) { field.hidden = model.display !== "feature"; });
  renderAll();
}());
