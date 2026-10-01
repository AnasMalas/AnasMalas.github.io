"use strict";

// Firmware update notice, anonymous bug reports (on by default, with a
// notice that turns them off), and the automatic black-box read after a
// quick reconnect. Nothing leaves the browser once reports are off, unless
// the user sends one.
(() => {
  const CONSOLE_VERSION = "2026.10.01";
  const MANIFEST_URL = "https://anasmalas.com/bcv2/firmware.json";
  // The report service (report-service/, a Worker routed on the site's own
  // /api/*), so the page's connect-src already allows it. Empty disables
  // sending: reports can then only be saved or copied.
  const REPORT_URL = "https://anasmalas.com/api/report";
  // "false" turns automatic reports off; anything else, or nothing, is on.
  const OPT_IN_KEY = "bcv2.bug-reports.opt-in";
  // "seen" once the notice about automatic reports was answered.
  const NOTICE_KEY = "bcv2.bug-reports.notice";
  const QUICK_RECONNECT_MS = 3000;
  const AUTO_REPORT_GAP_MS = 60_000;
  const MAX_AUTO_REPORTS = 10;
  const MAX_LOG_LINES = 300;
  const MAX_LINE_LENGTH = 400;
  const MAX_DESCRIPTION = 2000;
  const MAX_REPORT_BYTES = 48_000;
  // Recent readings sent with a report: four a second for the last minute.
  const TELEMETRY_STEP_MS = 250;
  const TELEMETRY_WINDOW_MS = 60_000;
  const MAX_TELEMETRY_ROWS = 240;
  const MAX_CAPABILITY_LINES = 16;
  const MAX_ERRORS = 5;
  const MAX_ERROR_LENGTH = 800;
  // A contract VBUS misses this long with LOAD off is reported.
  const VBUS_MISS_REPORT_MS = 2000;
  const FLAG_CONTRACT_READY = 1 << 1;
  const FLAG_OUTPUT_EFFECTIVE = 1 << 3;
  const FLAG_BRAKE_LATCHED = 1 << 11;

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

  /**
   * Whether settled, unloaded VBUS is too far from the contract for the
   * charger to have delivered it. Same rule as the firmware's
   * `vbus_misses_contract`: off by more than 1/8 plus 0.5 V.
   */
  function vbusMissesContract(vbusMv, contractMv) {
    return contractMv > 0 && Math.abs(vbusMv - contractMv) > Math.floor(contractMv / 8) + 500;
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

  /**
   * Assemble a report with every free-form field bounded and redacted.
   * `telemetry` rows are [ms before the report, board uptime ms, VBUS mV,
   * current mA, contract mV, contract mA, flags], oldest first.
   */
  function buildReport({
    kind, reason, session, firmware, browser, description = "", blackBox = null,
    log = [], sample = null, uid = null, now = new Date(),
    capabilities = null, telemetry = [], errors = [], connection = null,
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
      capabilities: capabilities ? capabilities.slice(0, MAX_CAPABILITY_LINES).map((line) => redactLine(line, uid)) : null,
      telemetry: telemetry.slice(-MAX_TELEMETRY_ROWS),
      errors: errors.slice(-MAX_ERRORS).map((line) => redactLine(line, uid).slice(0, MAX_ERROR_LENGTH)),
      connection,
      log: log.slice(-MAX_LOG_LINES).map((line) => redactLine(line, uid)),
    };
    // Drop the oldest log lines, then the oldest readings, until it fits.
    const tooBig = () => JSON.stringify(report).length > MAX_REPORT_BYTES;
    while (tooBig() && report.log.length > 0) {
      report.log.splice(0, Math.max(1, Math.ceil(report.log.length / 10)));
    }
    while (tooBig() && report.telemetry.length > 0) {
      report.telemetry.splice(0, Math.max(1, Math.ceil(report.telemetry.length / 4)));
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
    vbusMissesContract,
  });

  if (typeof document === "undefined") return;

  // --- Browser wiring ------------------------------------------------------

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    banner: $("#update-banner"),
    notice: $("#bug-notice"),
    noticeOff: $("#bug-notice-off"),
    noticeOk: $("#bug-notice-ok"),
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
  // Storage can be unavailable (private windows, blocked site data); a
  // choice then lasts for this page only.
  function readSetting(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // Kept in memory for this page.
    }
  }

  const session = randomSession();
  const browser = browserSummary(navigator.userAgent, navigator.platform);
  const reportingAvailable = REPORT_URL !== "" && location.protocol === "https:";
  const support = {
    enabled: readSetting(OPT_IN_KEY) !== "false",
    noticeDismissed: readSetting(NOTICE_KEY) === "seen",
    uid: null,
    firmware: null,
    manifest: undefined,
    sample: null,
    lastBlackBox: null,
    pendingAutoReason: null,
    autoReports: 0,
    lastAutoReportMs: 0,
    capabilities: null,
    // [host ms, board uptime ms, VBUS mV, current mA, contract mV, contract mA, flags]
    telemetry: [],
    errors: [],
    reconnectGapMs: null,
    vbusMissSinceMs: null,
    vbusMissReportedMv: 0,
    brakeLatched: false,
  };
  const log = (line) => globalThis.Bcv2Transport?.logDiagnostic(line);

  function optedIn() {
    return reportingAvailable && support.enabled;
  }

  // Answering the notice, or using the switch, also settles the notice.
  function setEnabled(enabled) {
    support.enabled = enabled;
    support.noticeDismissed = true;
    writeSetting(OPT_IN_KEY, String(enabled));
    writeSetting(NOTICE_KEY, "seen");
    renderOptIn();
  }

  function renderOptIn() {
    ui.optIn.checked = optedIn();
    ui.optIn.disabled = !reportingAvailable;
    ui.optInNote.textContent = !reportingAvailable
      ? REPORT_URL === "" ? "Not set up yet: use Report a bug, save it, and email it to the address on the card."
        : "Reports can be sent from anasmalas.com/bcv2/console. Here they can be saved."
      : ui.optIn.checked ? "On: if something goes wrong, an anonymous report is sent." : "Off: nothing is sent.";
    ui.send.disabled = !reportingAvailable;
    // Optional: a page cached from before the notice has none.
    ui.notice?.classList.toggle("hidden", !optedIn() || support.noticeDismissed);
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
      capabilities: support.capabilities,
      telemetry: support.telemetry.map(([hostMs, ...row]) => [Math.round(performance.now() - hostMs), ...row]),
      errors: support.errors,
      connection: { reconnectGapMs: support.reconnectGapMs },
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

  // Device identity, build, the charger's offers, and the lines that call for
  // an automatic report.
  globalThis.addEventListener("bcv2-device-line", (event) => {
    const line = event.detail;
    if (/^Source caps: /.test(line)) support.capabilities = [line];
    else if (/^PDO\d+ /.test(line) && support.capabilities && support.capabilities.length < MAX_CAPABILITY_LINES) {
      support.capabilities.push(line);
    }
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
    support.reconnectGapMs = event.detail.gapMs;
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
    if (!sample) return;
    support.sample = {
      vbusMv: sample.vbusMv,
      currentMa: sample.currentMa,
      contractMv: sample.contractMv,
      contractMa: sample.contractMa,
      flags: sample.flags,
    };
    // The last minute of readings, four a second. Kept across a disconnect,
    // so a report after a restart shows what led up to it.
    const hostMs = performance.now();
    const last = support.telemetry.at(-1);
    if (!last || hostMs - last[0] >= TELEMETRY_STEP_MS) {
      support.telemetry.push([hostMs, sample.timestampMs, sample.vbusMv, sample.currentMa, sample.contractMv, sample.contractMa, sample.flags]);
      while (support.telemetry.length > MAX_TELEMETRY_ROWS || hostMs - support.telemetry[0][0] > TELEMETRY_WINDOW_MS) {
        support.telemetry.shift();
      }
    }
    // A contract the charger acknowledged but never delivered.
    const settled = (sample.flags & FLAG_CONTRACT_READY) !== 0 && (sample.flags & FLAG_OUTPUT_EFFECTIVE) === 0;
    if (settled && vbusMissesContract(sample.vbusMv, sample.contractMv)) {
      support.vbusMissSinceMs ??= hostMs;
      if (hostMs - support.vbusMissSinceMs >= VBUS_MISS_REPORT_MS && support.vbusMissReportedMv !== sample.contractMv) {
        support.vbusMissReportedMv = sample.contractMv;
        void autoReport("vbus-mismatch");
      }
    } else {
      support.vbusMissSinceMs = null;
    }
    // The load brake tripping (over-current or a supply dip).
    const brakeLatched = (sample.flags & FLAG_BRAKE_LATCHED) !== 0;
    if (brakeLatched && !support.brakeLatched) void autoReport("load-brake");
    support.brakeLatched = brakeLatched;
  });

  // Errors in the console's own scripts (not browser extensions), with where
  // they happened.
  function recordError(message, stack) {
    const where = String(stack ?? "").split("\n").slice(0, 6).join(" | ").replaceAll(location.origin, "");
    support.errors.push(`${message}${where ? ` @ ${where}` : ""}`.slice(0, MAX_ERROR_LENGTH));
    if (support.errors.length > MAX_ERRORS) support.errors.shift();
    log(`Console error: ${message}`);
    void autoReport("console-error");
  }
  globalThis.addEventListener("error", (event) => {
    if (!String(event.filename ?? "").startsWith(location.origin)) return;
    recordError(event.message, event.error?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`);
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const stack = String(reason?.stack ?? "");
    if (stack && !stack.includes(location.origin)) return;
    recordError(`Unhandled: ${reason?.message ?? String(reason)}`, stack);
  });

  ui.optIn.addEventListener("change", () => setEnabled(ui.optIn.checked));
  ui.noticeOff?.addEventListener("click", () => setEnabled(false));
  ui.noticeOk?.addEventListener("click", () => setEnabled(true));

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
