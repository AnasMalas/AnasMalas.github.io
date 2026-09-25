(function () {
  const root = document.documentElement;
  const themeSelect = document.querySelector("[data-appearance]");
  const validThemes = ["system", "light", "dark"];
  let theme = validThemes.includes(root.dataset.theme) ? root.dataset.theme : "system";

  function setTheme(nextTheme) {
    theme = validThemes.includes(nextTheme) ? nextTheme : "system";
    root.dataset.theme = theme;
    if (themeSelect) themeSelect.value = theme;
    try { localStorage.setItem("anas-appearance", theme); } catch (error) {}
  }

  if (themeSelect) {
    themeSelect.value = theme;
    themeSelect.addEventListener("change", function () { setTheme(themeSelect.value); });
  }

  function updateDisclosure(article, button, expanded) {
    article.dataset.open = String(expanded);
    button.setAttribute("aria-expanded", String(expanded));
    button.querySelector("[data-disclosure-label]").textContent = expanded
      ? (button.dataset.collapseLabel || "Collapse article")
      : (button.dataset.expandLabel || "Expand article");
    button.querySelector("[data-disclosure-icon]").textContent = expanded ? "−" : "+";
  }

  document.querySelectorAll("[data-disclosure-button]").forEach(function (button) {
    button.addEventListener("click", function () {
      const article = button.closest("[data-disclosure]");
      const anchor = article.querySelector(".reading-anchor");
      const expanded = article.dataset.open !== "true";
      const reference = expanded ? anchor : button;
      const referenceTop = reference.getBoundingClientRect().top;

      updateDisclosure(article, button, expanded);

      const correction = reference.getBoundingClientRect().top - referenceTop;
      if (correction) window.scrollBy({ top: correction, left: 0, behavior: "instant" });
      button.focus({ preventScroll: true });
    });
  });

  function expandHashTarget() {
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (target && target.matches("[data-disclosure]")) {
      const button = target.querySelector("[data-disclosure-button]");
      if (button) updateDisclosure(target, button, true);
    }
  }
  expandHashTarget();
  window.addEventListener("hashchange", expandHashTarget);

  document.querySelectorAll("[data-share-button]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const label = button.querySelector("[data-share-label]");
      const url = new URL(button.dataset.shareUrl || location.pathname, location.origin).href;
      const title = button.dataset.shareTitle || document.title;

      try {
        if (navigator.share) {
          await navigator.share({ title: title, url: url });
          return;
        }
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(url);
        } else {
          const temporary = document.createElement("textarea");
          temporary.value = url;
          temporary.setAttribute("readonly", "");
          temporary.style.position = "fixed";
          temporary.style.opacity = "0";
          document.body.appendChild(temporary);
          temporary.select();
          document.execCommand("copy");
          temporary.remove();
        }
        label.textContent = "Link copied";
        window.setTimeout(function () { label.textContent = "Share"; }, 1600);
      } catch (error) {
        if (error && error.name === "AbortError") return;
        label.textContent = "Copy failed";
        window.setTimeout(function () { label.textContent = "Share"; }, 1600);
      }
    });
  });

  const searchInput = document.querySelector("[data-search-input]");
  const resultsRoot = document.querySelector("[data-search-results]");
  const summary = document.querySelector("[data-search-summary]");
  if (!resultsRoot || !summary) return;

  function normalize(value) {
    return String(value || "").normalize("NFKD").toLowerCase().trim().replace(/\s+/g, " ");
  }

  function resultSnippet(item, terms) {
    let text = String(item.content || item.summary || "").replace(/\s+/g, " ").trim();
    if (text.startsWith(String(item.title || ""))) {
      text = text.slice(String(item.title).length).trim();
    }
    const normalized = normalize(text);
    const positions = terms.map(function (term) { return normalized.indexOf(term); }).filter(function (position) { return position >= 0; });
    const matchAt = positions.length ? Math.min.apply(null, positions) : 0;
    const start = Math.max(0, matchAt - 72);
    const end = Math.min(text.length, start + 220);
    return `${start ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
  }

  const params = new URLSearchParams(window.location.search);
  const query = (params.get("q") || "").trim();
  if (searchInput) searchInput.value = query;
  if (!query) return;

  summary.textContent = `Searching for “${query}”…`;
  fetch("/search-index.json").then(function (response) {
    if (!response.ok) throw new Error("Search index unavailable");
    return response.json();
  }).then(function (items) {
    const terms = normalize(query).split(" ").filter(Boolean);
    const matches = items.map(function (item, order) {
      const title = normalize(item.title);
      const type = normalize(item.type);
      const haystack = normalize(`${item.title} ${item.type} ${item.section || ""} ${item.repo || ""} ${item.content}`);
      if (!terms.every(function (term) { return haystack.includes(term); })) return null;
      let score = 0;
      terms.forEach(function (term) {
        if (title === term) score += 12;
        else if (title.startsWith(term)) score += 8;
        else if (title.includes(term)) score += 5;
        if (type.includes(term)) score += 2;
      });
      return { item: item, score: score, order: order };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score || a.order - b.order; });

    summary.textContent = matches.length
      ? `${matches.length} result${matches.length === 1 ? "" : "s"} for “${query}”`
      : `No results for “${query}”`;

    matches.forEach(function (match) {
      const item = match.item;
      const article = document.createElement("article");
      article.className = `search-result${item.image ? " search-result-image" : ""}`;
      const link = document.createElement("a");
      link.href = item.url;
      if (item.image) {
        const image = document.createElement("img");
        image.src = item.image;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        link.appendChild(image);
      }
      const copy = document.createElement("div");
      const meta = document.createElement("div");
      meta.className = "search-result-meta";
      const kind = document.createElement("span");
      kind.className = "post-kind";
      kind.textContent = item.type;
      meta.appendChild(kind);
      if (item.date) {
        const time = document.createElement("time");
        time.dateTime = item.date;
        time.textContent = new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(item.date));
        meta.appendChild(time);
      }
      const heading = document.createElement("h2");
      heading.textContent = item.title;
      const excerpt = document.createElement("p");
      excerpt.textContent = resultSnippet(item, terms);
      copy.append(meta, heading, excerpt);
      link.appendChild(copy);
      article.appendChild(link);
      if (item.alternateUrl || item.repo) {
        const related = document.createElement("div");
        related.className = "search-result-links";
        if (item.alternateUrl) {
          const alternate = document.createElement("a");
          alternate.href = item.alternateUrl;
          alternate.textContent = `${item.alternateLabel} ↗`;
          related.appendChild(alternate);
        }
        if (item.repo) {
          const repository = document.createElement("a");
          repository.href = item.repo;
          repository.rel = "noopener";
          repository.textContent = "GitHub repository ↗";
          related.appendChild(repository);
        }
        article.appendChild(related);
      }
      resultsRoot.appendChild(article);
    });
  }).catch(function () {
    summary.textContent = "Search is temporarily unavailable. Please try again.";
  });
}());
