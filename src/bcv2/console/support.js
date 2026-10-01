"use strict";

// Firmware update notice, opt-in anonymous bug reports, and the automatic
// black-box read after a quick reconnect. Nothing leaves the browser unless
// bug reports are switched on or the user sends one.
(() => {
  const CONSOLE_VERSION = "2026.09.29";
  const MANIFEST_URL = "https://anasmalas.com/bcv2/firmware.json";
  // The report service (report-service/, a Worker routed on the site's own
  // /api/*), so the page's connect-src already allows it. Empty disables
  // sending: reports can then only be saved or copied.
  const REPORT_URL = "https://anasmalas.com/api/report";
  const OPT_IN_KEY = "bcv2.bug-reports.opt-in";
  const QUICK_RECONNECT_MS = 3000;
  const AUTO_REPORT_GAP_MS = 60_000;
  const MAX_AUTO_REPORTS = 10;
  const MAX_LOG_LINES = 300;
  const MAX_LINE_LENGTH = 400;
  const MAX_DESCRIPTION = 2000;
  const MAX_REPORT_BYTES = 48_000;

  // --- Pure helpers (tested in support.test.js) ---------------------------

  /** Remove the board's unique ID wherever it appears. */
  function redactLine(line, uid = null) {
    let text = String(line)
      .replace(/\b(Device id=)(?:[0-9a-f]{16}|[0-9a-f]{24})\b/gi, "$1<board>")
      .replace(/\bBoard [0-9A-F]{8}\b/g, "Board <board>")
      .replace(/\bMCU unique ID [0-9A-F]+\b/gi, "MCU unique ID <board>");
    if (uid) {
      for (const part of new Set([uid, uid.slice(0, 16), uid.slice(-8)])) {
        if (part.length >= 8) text = text.replace(new RegExp(part, "gi"), "<board>");
      }
    }
    return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text;
  }

  function parseBuild(value) {
    const match = String(value ?? "").trim().match(/^(?:0x)?([0-9a-f]{1,8})$/i);
    return match ? Number.parseInt(match[1], 16) >>> 0 : null;
  }

  function formatBuild(build) {
    return `0x${(build >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  }

  /**
   * Compare a board's build with the published manifest. An older build of
   * the product family (same upper 16 bits) is due an update, unless the
   * manifest lists it as a diagnostic image; anything else is unlisted.
   */
  function updateStatus(deviceBuild, manifest) {
    const product = manifest?.product;
    const latest = parseBuild(product?.latest);
    if (deviceBuild === null || latest === null) return { state: "unknown" };
    if (deviceBuild === latest) return { state: "latest", latest };
    const diagnostic = (product.diagnostic ?? []).map(parseBuild);
    if (deviceBuild >>> 16 === latest >>> 16 && deviceBuild < latest && !diagnostic.includes(deviceBuild)) {
      return { state: "update", latest };
    }
    return { state: "unlisted", latest };
  }

  function browserSummary(userAgent = "", platform = "") {
    const agent = String(userAgent);
    const family = /Edg\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera"
      : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : "Other";
    const major = agent.match(/(?:Edg|OPR|Chrome|Firefox)\/(\d+)/)?.[1] ?? "";
    const os = /Android/i.test(agent) ? "Android" : /Windows/i.test(agent + platform) ? "Windows"
      : /Mac/i.test(agent + platform) ? "macOS" : /CrOS/i.test(agent) ? "ChromeOS"
        : /Linux/i.test(agent + platform) ? "Linux" : "Other";
    return `${family}${major ? ` ${major}` : ""} · ${os}`;
  }

  /** Assemble a report with every free-form field bounded and redacted. */
  function buildReport({
    kind, reason, session, firmware, browser, description = "", blackBox = null,
    log = [], sample = null, uid = null, now = new Date(),
  }) {
    const report = {
      schema: 1,
      kind,
      reason,
      session,
      console: CONSOLE_VERSION,
      // Minute precision is plenty to line a report up with a changelog.
      created: new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString(),
      firmware: firmware ?? null,
      browser,
      description: String(description).slice(0, MAX_DESCRIPTION),
      blackBox: blackBox ? blackBox.map((line) => redactLine(line, uid)) : null,
      sample,
      log: log.slice(-MAX_LOG_LINES).map((line) => redactLine(line, uid)),
    };
    // Drop the oldest log lines until the whole report fits.
    while (JSON.stringify(report).length > MAX_REPORT_BYTES && report.log.length > 0) {
      report.log.splice(0, Math.max(1, Math.ceil(report.log.length / 10)));
    }
    return report;
  }

  function randomSession() {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  globalThis.Bcv2Support = Object.freeze({
    CONSOLE_VERSION,
    QUICK_RECONNECT_MS,
    browserSummary,
    buildReport,
    formatBuild,
    parseBuild,
    redactLine,
    updateStatus,
  });

  if (typeof document === "undefined") return;

  // --- Browser wiring ------------------------------------------------------

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    banner: $("#update-banner"),
    bannerText: $("#update-banner-text"),
    bannerDetails: $("#update-banner-details"),
    bannerDownload: $("#update-download"),
    optIn: $("#bug-opt-in"),
    optInNote: $("#bug-opt-in-note"),
    reportButton: $("#report-bug"),
    dialog: $("#bug-dialog"),
    description: $("#bug-description"),
    includeLog: $("#bug-include-log"),
    send: $("#bug-send"),
    save: $("#bug-save"),
    cancel: $("#bug-cancel"),
    dialogNote: $("#bug-dialog-note"),
  };
  const session = randomSession();
  const browser = browserSummary(navigator.userAgent, navigator.platform);
  const reportingAvailable = REPORT_URL !== "" && location.protocol === "https:";
  const support = {
    uid: null,
    firmware: null,
    manifest: undefined,
    sample: null,
    lastBlackBox: null,
    pendingAutoReason: null,
    autoReports: 0,
    lastAutoReportMs: 0,
  };
  const log = (line) => globalThis.Bcv2Transport?.logDiagnostic(line);

  function optedIn() {
    try {
      return reportingAvailable && localStorage.getItem(OPT_IN_KEY) === "true";
    } catch (_) {
      return false;
    }
  }

  function renderOptIn() {
    ui.optIn.checked = optedIn();
    ui.optIn.disabled = !reportingAvailable;
    ui.optInNote.textContent = !reportingAvailable
      ? REPORT_URL === "" ? "Not set up yet: use Report a bug, save it, and email it to the address on the card."
        : "Reports can be sent from anasmalas.com/bcv2/console. Here they can be saved."
      : ui.optIn.checked ? "On: problems are reported anonymously." : "Off: nothing is sent.";
    ui.send.disabled = !reportingAvailable;
  }

  async function loadManifest() {
    if (support.manifest !== undefined) return support.manifest;
    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      support.manifest = response.ok ? await response.json() : null;
    } catch (_) {
      support.manifest = null;
    }
    return support.manifest;
  }

  async function showUpdateStatus() {
    const build = parseBuild(support.firmware?.build);
    const manifest = await loadManifest();
    const status = updateStatus(build, manifest);
    ui.banner.classList.toggle("hidden", status.state === "unknown");
    ui.banner.classList.toggle("update-available", status.state === "update");
    ui.bannerDetails.classList.toggle("hidden", status.state !== "update");
    if (status.state === "unknown") return;
    const product = manifest.product;
    ui.bannerDownload.href = product.download;
    ui.bannerText.textContent = status.state === "latest"
      ? `Firmware ${formatBuild(build)} is the latest version.`
      : status.state === "update"
        ? `Firmware update available: ${formatBuild(build)} → ${formatBuild(status.latest)}${product.notes ? `. ${product.notes}` : "."}`
        : `This card runs ${formatBuild(build)}, which isn't a public release. The latest release is ${formatBuild(status.latest)}.`;
  }

  function currentReport(kind, reason, description = "", includeLog = true) {
    return buildReport({
      kind,
      reason,
      session,
      firmware: support.firmware,
      browser,
      description,
      blackBox: support.lastBlackBox,
      log: includeLog ? globalThis.Bcv2Transport?.logLines(MAX_LOG_LINES) ?? [] : [],
      sample: support.sample,
      uid: support.uid,
    });
  }

  async function sendReport(report) {
    const response = await fetch(REPORT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
    });
    if (!response.ok) throw new Error(`the report service answered ${response.status}`);
  }

  async function autoReport(reason) {
    if (!optedIn()) return;
    const now = Date.now();
    if (support.autoReports >= MAX_AUTO_REPORTS || now - support.lastAutoReportMs < AUTO_REPORT_GAP_MS) return;
    support.autoReports += 1;
    support.lastAutoReportMs = now;
    try {
      await sendReport(currentReport("auto", reason));
      log(`Sent an anonymous bug report (${reason}). Turn off bug reports to stop these.`);
    } catch (error) {
      log(`Could not send the bug report: ${error.message}`);
    }
  }

  function saveReport(report) {
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bcv2-report-${report.created.slice(0, 16).replaceAll(":", "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  // Device identity, build, and the lines that call for an automatic report.
  globalThis.addEventListener("bcv2-device-line", (event) => {
    const line = event.detail;
    const identity = line.match(/^Device id=([0-9a-f]{16}|[0-9a-f]{24})$/i);
    if (identity) support.uid = identity[1].toLowerCase();
    const build = line.match(/^Device build=(0x[0-9a-f]{8}) library=([0-9a-f]+)$/i);
    if (build) {
      support.firmware = { build: formatBuild(parseBuild(build[1])), library: build[2].toLowerCase() };
      void showUpdateStatus();
    }
    if (/^Hard reset\b/.test(line)) void autoReport("hard-reset");
    else if (/^Protocol lost\b/.test(line)) void autoReport("protocol-lost");
  });

  globalThis.addEventListener("bcv2-disconnected", () => {
    support.uid = null;
    support.firmware = null;
    support.sample = null;
    ui.banner.classList.add("hidden");
  });

  // A card back within three seconds most likely restarted: read its black
  // box into the console, and report it if bug reports are on.
  globalThis.addEventListener("bcv2-quick-reconnect", (event) => {
    support.pendingAutoReason = "quick-reconnect";
    log(`The card came back ${event.detail.gapMs} ms after dropping out, so it probably restarted. Reading its black box.`);
  });

  globalThis.addEventListener("bcv2-black-box", (event) => {
    support.lastBlackBox = event.detail.lines;
    if (support.pendingAutoReason) {
      const reason = support.pendingAutoReason;
      support.pendingAutoReason = null;
      void autoReport(reason);
    }
  });

  globalThis.addEventListener("pd-control-frame", (event) => {
    if (event.detail.kind !== 0xa5) return;
    const sample = globalThis.Bcv2ProductTelemetry?.decode(event.detail.payload);
    if (sample) {
      support.sample = {
        vbusMv: sample.vbusMv,
        currentMa: sample.currentMa,
        contractMv: sample.contractMv,
        contractMa: sample.contractMa,
        flags: sample.flags,
      };
    }
  });

  // Errors in the console itself.
  globalThis.addEventListener("error", (event) => {
    log(`Console error: ${event.message}`);
    void autoReport("console-error");
  });

  ui.optIn.addEventListener("change", () => {
    try {
      localStorage.setItem(OPT_IN_KEY, String(ui.optIn.checked));
    } catch (_) {
      ui.optIn.checked = false;
    }
    renderOptIn();
  });

  ui.reportButton.addEventListener("click", () => {
    ui.dialogNote.textContent = reportingAvailable
      ? "Sent anonymously: no board ID, no personal details. Please don't type any in."
      : "Save it and email the file to the address on the card (its QR code adds me to your contacts). The board ID is already removed.";
    ui.dialog.showModal();
    ui.description.focus();
  });
  ui.cancel.addEventListener("click", () => ui.dialog.close());
  ui.save.addEventListener("click", () => {
    saveReport(currentReport("manual", "user", ui.description.value, ui.includeLog.checked));
    ui.dialog.close();
  });
  ui.send.addEventListener("click", async () => {
    ui.send.disabled = true;
    try {
      await sendReport(currentReport("manual", "user", ui.description.value, ui.includeLog.checked));
      ui.description.value = "";
      ui.dialog.close();
      log("Bug report sent. Thank you!");
    } catch (error) {
      ui.dialogNote.textContent = `Could not send it (${error.message}). You can save it instead.`;
    } finally {
      ui.send.disabled = !reportingAvailable;
    }
  });

  renderOptIn();
})();
