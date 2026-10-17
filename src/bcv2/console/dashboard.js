"use strict";

(() => {
  const telemetryCodec = globalThis.Bcv2ProductTelemetry;
  const chart = document.querySelector("#power-chart");
  const context = chart.getContext("2d");
  const ui = {
    stream: document.querySelector("#graph-stream"),
    window: document.querySelector("#graph-window"),
    averageButtons: [...document.querySelectorAll(".average-button")],
    averageState: document.querySelector("#average-state"),
    export: document.querySelector("#graph-export"),
    clear: document.querySelector("#graph-clear"),
    empty: document.querySelector("#chart-empty"),
    cursor: document.querySelector("#chart-cursor"),
    count: document.querySelector("#sample-count"),
    voltage: document.querySelector("#reading-voltage"),
    current: document.querySelector("#reading-current"),
    tare: document.querySelector("#current-tare"),
    tareNote: document.querySelector("#current-tare-note"),
    power: document.querySelector("#reading-power"),
    fiveVolt: document.querySelector("#five-volt-note"),
    blackBoxButton: document.querySelector("#inspect-black-box"),
    displayButton: document.querySelector("#display-button"),
    displayDialog: document.querySelector("#display-dialog"),
    brightness: document.querySelector("#display-brightness"),
    brightnessValue: document.querySelector("#display-brightness-value"),
    contrast: document.querySelector("#display-contrast"),
    contrastValue: document.querySelector("#display-contrast-value"),
    zeros: document.querySelector("#display-zeros"),
    marks: document.querySelector("#display-marks"),
    displayNote: document.querySelector("#display-note"),
    displayDefaults: document.querySelector("#display-defaults"),
    displayDone: document.querySelector("#display-done"),
    systemStatus: document.querySelector("#system-status"),
    systemDetail: document.querySelector("#system-status-detail"),
  };

  const STORAGE_STREAM = "bcv2.product-ui.stream-enabled";
  const STORAGE_WINDOW = "bcv2.product-ui.graph-window-s";
  const STORAGE_AVERAGE = "bcv2.product-ui.average-window-ms";
  const MAX_HISTORY_MS = 10 * 60 * 1000;
  const CHART_LEFT = 62;
  const CHART_RIGHT = 10;
  const samples = [];
  let previousDeviceMs = null;
  let previousLoadSafetyFlags = null;
  let latestLoadSample = null;
  let streamEnabled = localStorage.getItem(STORAGE_STREAM) !== "false";
  const savedAverage = localStorage.getItem(STORAGE_AVERAGE);
  let averageWindowMs = savedAverage !== null && [0, 250, 1000].includes(Number(savedAverage))
    ? Number(savedAverage)
    : 250;
  let telemetryWarning = null;
  // A current zero set here (A), or null. Only the console's numbers move;
  // the card is not changed. Samples keep the card's reading as rawAmps.
  let tareAmps = null;
  const TARE_WINDOW_MS = 1000;
  let redrawPending = false;
  const display = globalThis.PdControlProtocol.DISPLAY;
  // The card's display settings, from its device event (v1.1 and later).
  let displayPrefs = null;
  // The card's build, from its device line, or null.
  let deviceBuild = null;

  const u16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
  const u32 = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

  function savePreference(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* Session-only is acceptable. */ }
  }

  function formatValue(value, digits = 2) {
    return Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
  }

  function updateControls() {
    ui.stream.textContent = `Stream: ${streamEnabled ? "On" : "Paused"}`;
    ui.stream.setAttribute("aria-pressed", String(streamEnabled));
    for (const button of ui.averageButtons) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.averageMs) === averageWindowMs));
    }
    ui.averageState.textContent = averageWindowMs === 0
      ? "Display: raw · CSV: raw"
      : `Display: ${averageWindowMs < 1000 ? `${averageWindowMs} ms` : "1 s"} average · CSV: raw`;
    ui.export.disabled = samples.length === 0;
    ui.count.textContent = `${samples.length.toLocaleString()} sample${samples.length === 1 ? "" : "s"}`;
    if (samples.length === 0) {
      ui.empty.textContent = streamEnabled ? "Stream is ready. Connect the card to begin plotting." : "Streaming is paused. The browser will remember this choice.";
      ui.empty.classList.remove("hidden");
    } else {
      ui.empty.classList.add("hidden");
    }
  }

  function visibleSamples() {
    if (samples.length === 0) return [];
    const cutoff = samples[samples.length - 1].hostMs - Number(ui.window.value) * 1000;
    const averageCutoff = cutoff - averageWindowMs;
    const source = samples.filter((sample) => sample.hostMs >= averageCutoff);
    return telemetryCodec.rollingAverage(source, averageWindowMs)
      .filter((sample) => sample.hostMs >= cutoff);
  }

  function displayedLatestSample() {
    if (samples.length === 0) return null;
    if (averageWindowMs === 0) return samples[samples.length - 1];
    const last = samples[samples.length - 1];
    const source = samples.filter((sample) => sample.hostMs >= last.hostMs - averageWindowMs);
    return telemetryCodec.rollingAverage(source, averageWindowMs).at(-1);
  }

  function updateReadings() {
    const point = displayedLatestSample();
    ui.voltage.textContent = point ? formatValue(point.volts, 2) : "—";
    ui.current.textContent = point ? formatValue(point.amps, 2) : "—";
    ui.power.textContent = point ? formatValue(point.watts, 2) : "—";
    // At 5 V the LDO has no headroom, so the LEDs pull the card's supply (and
    // its readings) around; the note says so while VBUS is near 5 V. From
    // 0x01050047 (v1.1) the card measures with its display blanked and 5 V
    // reads as cleanly as 9 V, so only older cards show it.
    const connected = Boolean(globalThis.Bcv2Transport?.isConnected());
    const older = deviceBuild !== null && deviceBuild < 0x01050047;
    ui.fiveVolt.classList.toggle("hidden", !(connected && older && point && point.volts > 4 && point.volts < 5.6));
  }

  function scheduleDraw() {
    if (redrawPending) return;
    redrawPending = true;
    requestAnimationFrame(() => {
      redrawPending = false;
      drawChart();
    });
  }

  function niceMaximum(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const scale = 10 ** Math.floor(Math.log10(value));
    const normalized = value / scale;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * scale;
  }

  function formatTimeOffset(seconds) {
    if (seconds <= 0) return "now";
    if (seconds >= 60 && seconds % 60 === 0) return `−${seconds / 60}m`;
    return `−${Math.round(seconds)}s`;
  }

  function drawChart() {
    const bounds = chart.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (chart.width !== Math.round(width * dpr) || chart.height !== Math.round(height * dpr)) {
      chart.width = Math.round(width * dpr);
      chart.height = Math.round(height * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const visible = visibleSamples();
    const top = 7;
    const bottom = 20;
    const gap = 6;
    const bandHeight = (height - top - bottom - gap * 2) / 3;
    const windowMs = Number(ui.window.value) * 1000;
    const end = visible.length ? visible[visible.length - 1].hostMs : Date.now();
    const start = end - windowMs;
    const series = [
      { key: "volts", label: "V", color: "#62d6ff", fill: "rgba(98,214,255,.030)", digits: 1 },
      { key: "amps", label: "A", color: "#6fe49d", fill: "rgba(111,228,157,.085)", digits: 1 },
      { key: "watts", label: "W", color: "#f6bd60", fill: "rgba(246,189,96,.035)", digits: 1 },
    ];

    context.font = '11px "Cascadia Code", Consolas, monospace';
    context.lineWidth = 1;
    context.textBaseline = "middle";
    for (let band = 0; band < series.length; band += 1) {
      const meta = series[band];
      const y = top + band * (bandHeight + gap);
      const observedMaximum = Math.max(...visible.map((sample) => sample[meta.key]), 0);
      const maximum = Math.max(meta.key === "volts" ? 1 : 0.4, niceMaximum(observedMaximum));
      context.fillStyle = meta.fill;
      context.fillRect(CHART_LEFT, y, width - CHART_LEFT - CHART_RIGHT, bandHeight);
      if (meta.key === "amps") {
        context.strokeStyle = "rgba(111,228,157,.30)";
        context.strokeRect(CHART_LEFT + .5, y + .5, width - CHART_LEFT - CHART_RIGHT - 1, bandHeight - 1);
      }
      for (let line = 0; line <= 8; line += 1) {
        const gridY = y + bandHeight * line / 8;
        context.strokeStyle = line % 2 === 0 ? "#2b373e" : "#1d272c";
        context.beginPath(); context.moveTo(CHART_LEFT, gridY); context.lineTo(width - CHART_RIGHT, gridY); context.stroke();
        if (line % 2 === 0) {
          const value = maximum * (8 - line) / 8;
          const labelY = Math.max(y + 6, Math.min(y + bandHeight - 6, gridY));
          context.fillStyle = meta.color;
          context.textAlign = "right";
          context.fillText(`${formatValue(value, meta.digits)} ${meta.label}`, CHART_LEFT - 6, labelY);
        }
      }
      for (let line = 0; line <= 10; line += 1) {
        const gridX = CHART_LEFT + (width - CHART_LEFT - CHART_RIGHT) * line / 10;
        context.strokeStyle = line % 2 === 0 ? "#29343b" : "#1d272c";
        context.beginPath(); context.moveTo(gridX, y); context.lineTo(gridX, y + bandHeight); context.stroke();
      }

      if (visible.length > 0) {
        context.strokeStyle = meta.color;
        context.lineWidth = 1.7;
        context.beginPath();
        visible.forEach((sample, index) => {
          const x = CHART_LEFT + (sample.hostMs - start) / windowMs * (width - CHART_LEFT - CHART_RIGHT);
          const py = y + bandHeight - Math.min(1, sample[meta.key] / maximum) * bandHeight;
          if (index === 0) context.moveTo(x, py); else context.lineTo(x, py);
        });
        context.stroke();
      }
    }
    context.fillStyle = "#73828a";
    context.textBaseline = "alphabetic";
    for (let tick = 0; tick <= 10; tick += 2) {
      const x = CHART_LEFT + (width - CHART_LEFT - CHART_RIGHT) * tick / 10;
      const seconds = Number(ui.window.value) * (10 - tick) / 10;
      context.textAlign = tick === 0 ? "left" : tick === 10 ? "right" : "center";
      context.fillText(formatTimeOffset(seconds), x, height - 3);
    }
  }

  function observeLoadSafety(sample) {
    if (previousDeviceMs !== null && previousDeviceMs < 0xffff0000 && sample.timestampMs + 1000 < previousDeviceMs) {
      globalThis.Bcv2Transport.logDiagnostic(`Board uptime restarted: ${previousDeviceMs} ms → ${sample.timestampMs} ms. The MCU rebooted; inspect the black box for a power-fail record.`);
      previousLoadSafetyFlags = null;
    }
    previousDeviceMs = sample.timestampMs;
    latestLoadSample = sample;
    const loadSafetyFlags = telemetryCodec.loadSafetyFlags(sample);
    if (loadSafetyFlags !== null && loadSafetyFlags !== previousLoadSafetyFlags) {
      previousLoadSafetyFlags = loadSafetyFlags;
      globalThis.Bcv2Transport.logDiagnostic(telemetryCodec.loadSafetyLine(sample));
    }
  }

  function applyTare(point) {
    point.amps = tareAmps === null ? point.rawAmps : Math.max(0, point.rawAmps - tareAmps);
    point.watts = point.volts * point.amps;
    return point;
  }

  function recentRawAmps() {
    if (samples.length === 0) return [];
    const cutoff = samples[samples.length - 1].hostMs - TARE_WINDOW_MS;
    return samples.filter((sample) => sample.hostMs >= cutoff).map((sample) => sample.rawAmps);
  }

  function updateTare() {
    ui.tare.textContent = tareAmps === null ? "Tare" : "Clear tare";
    ui.tare.setAttribute("aria-pressed", String(tareAmps !== null));
    ui.tare.disabled = tareAmps === null && recentRawAmps().length === 0;
    ui.tareNote.textContent = tareAmps === null ? "" : `tare ${formatValue(tareAmps, 3)} A`;
    ui.tareNote.classList.toggle("hidden", tareAmps === null);
  }

  function setTare(amps) {
    tareAmps = amps;
    for (const sample of samples) applyTare(sample);
    updateTare();
    updateReadings();
    scheduleDraw();
  }

  function addSample(sample) {
    const volts = sample.vbusMv / 1000;
    const rawAmps = sample.currentMa / 1000;
    const point = applyTare({ hostMs: Date.now(), deviceMs: sample.timestampMs, volts, rawAmps });
    samples.push(point);
    const cutoff = point.hostMs - MAX_HISTORY_MS;
    while (samples.length > 0 && samples[0].hostMs < cutoff) samples.shift();
    updateReadings();
    if (sample.flags & (1 << 15)) {
      telemetryWarning = "persistence";
      ui.systemStatus.textContent = "Persistence error";
      ui.systemDetail.textContent = "The settings journal reported a write error";
      ui.systemStatus.parentElement.classList.add("error");
    } else if (sample.flags & (1 << 5)) {
      telemetryWarning = "ldo";
      ui.systemStatus.textContent = "LDO limiting";
      ui.systemDetail.textContent = "Display brightness is being reduced automatically";
      ui.systemStatus.parentElement.classList.add("warning");
    } else if (telemetryWarning !== null) {
      telemetryWarning = null;
      ui.systemStatus.textContent = "OK";
      ui.systemDetail.textContent = "Live power measurements are nominal";
      ui.systemStatus.parentElement.classList.remove("warning", "error");
    }
    updateControls();
    scheduleDraw();
  }

  function decodeBlackBox(payload) {
    if (payload.length !== 56 || payload[0] !== 1) throw new Error("Unsupported black-box response.");
    const flags = payload[1];
    const count = Math.min(payload[2], 6);
    const modes = ["auto", "fixed", "PPS", "SPR AVS", "EPR AVS"];
    const current = u32(payload, 12);
    const result = {
      flags,
      count,
      generation: u32(payload, 4),
      voltage: u32(payload, 8),
      current: current === 0xffffffff ? "auto" : `${current} mA`,
      mode: modes[payload[3]] ?? `mode ${payload[3]}`,
      nextSequence: u16(payload, 16),
      journalUnarmed: payload[18] === 0xff,
      events: [],
    };
    const names = { 1: "Hard reset", 2: "PHY reset failed", 3: "PD PHY unstable", 4: "Partner timeout", 5: "Protocol error", 6: "Terminal stop", 7: "EPR entry failed", 8: "Power rail fell" };
    for (let index = 0; index < count; index += 1) {
      const offset = 20 + index * 6;
      result.events.push({ uptime: u16(payload, offset), context: u16(payload, offset + 2), kind: names[payload[offset + 4]] ?? `Event ${payload[offset + 4]}`, detail: payload[offset + 5] });
    }
    return result;
  }

  /** Log the black box and return its lines (bug reports include them). */
  function renderBlackBox(data) {
    const lines = [];
    const log = (line) => {
      lines.push(line);
      globalThis.Bcv2Transport.logDiagnostic(line);
    };
    const journal = data.flags & 0x04 ? "RAM changes pending flash journal"
      : data.flags & 0x02 ? "restored from flash"
        : data.flags & 0x01 ? "committed to flash this boot" : "not yet saved to flash";
    log(`Black box: generation ${data.generation} · settings ${data.voltage} mV / ${data.current} / ${data.mode} · ${data.count} event${data.count === 1 ? "" : "s"} · ${journal} · load is never restored`);
    if (data.journalUnarmed) log("Black box: power-fail journal is not armed again until reboot.");
    if (data.nextSequence > data.count) log(`Black box: showing the newest ${data.count} event${data.count === 1 ? "" : "s"} (next sequence ${data.nextSequence}).`);
    if (data.events.length === 0) {
      log("Black box: no exceptional events recorded.");
    }
    for (const event of data.events) {
      const interpretation = event.kind === "Hard reset"
        ? ` · ${event.detail & 0x80 ? "sent" : "received"}: ${globalThis.PdControlProtocol.hardResetCauseName(event.detail & 0x7f)} · recovery ${event.context} ms`
        : event.kind === "Power rail fell" ? " · low-voltage detector triggered"
        : ` · context ${event.context}`;
      log(`Black box: ${event.kind} · t=${event.uptime}s · detail 0x${event.detail.toString(16).padStart(2, "0")}${interpretation}`);
    }
    if (data.flags & 0x08) {
      log("Black box: persistence error; the saved-state journal reported an error.");
      ui.systemStatus.textContent = "Persistence error";
      ui.systemDetail.textContent = "The saved-state journal reported an error";
      ui.systemStatus.parentElement.classList.add("error");
    }
    return lines;
  }

  // LEDs and brightness. The contrast slider runs the other way to the dim
  // dots' level: more contrast is dimmer dim dots.
  const DISPLAY_HELP = "Changes show on the card right away and stay after unplugging. On the card: hold COARSE − and MODE for 5 seconds, pick a brightness with FINE and COARSE, then press APPLY.";

  function percent(fraction) {
    return `${Math.max(1, Math.round(fraction * 100))}%`;
  }

  const isDefault = (value, key) => (value === display.defaults[key] ? " (default)" : "");

  function displayForm() {
    return {
      brightness: Number(ui.brightness.value),
      dim: display.dimMax - Number(ui.contrast.value),
      flags: (ui.zeros.checked ? 0 : display.hideLeadingZeros) | (ui.marks.checked ? 0 : display.hideMarks),
    };
  }

  function showDisplayValues(prefs) {
    // The steps look even, so the step says more than the light level.
    ui.brightnessValue.textContent = `${prefs.brightness + 1} of ${display.scales.length}${isDefault(prefs.brightness, "brightness")}`;
    ui.contrastValue.textContent = `dim dots at ${percent(prefs.dim / display.full)}${isDefault(prefs.dim, "dim")}`;
  }

  function renderDisplayForm(prefs) {
    ui.brightness.value = String(prefs.brightness);
    ui.contrast.value = String(display.dimMax - prefs.dim);
    ui.zeros.checked = !(prefs.flags & display.hideLeadingZeros);
    ui.marks.checked = !(prefs.flags & display.hideMarks);
    showDisplayValues(prefs);
  }

  async function sendDisplay(prefs) {
    const [brightness, dim, flags] = globalThis.PdControlProtocol.displayPayload(prefs);
    displayPrefs = { brightness, dim, flags };
    renderDisplayForm(displayPrefs);
    try {
      await globalThis.Bcv2Transport.sendFrame(display.command, Uint8Array.of(brightness, dim, flags));
      ui.displayNote.textContent = DISPLAY_HELP;
    } catch (error) {
      ui.displayNote.textContent = `Could not change it: ${error.message}`;
    }
  }

  function updateDisplayButton() {
    const connected = Boolean(globalThis.Bcv2Transport?.isConnected());
    ui.displayButton.disabled = !connected || displayPrefs === null;
    ui.displayButton.title = connected && displayPrefs === null ? "Needs firmware v1.1 or later." : "";
    if (ui.displayButton.disabled && ui.displayDialog.open) ui.displayDialog.close();
  }

  globalThis.addEventListener("pd-control-frame", (event) => {
    const frame = event.detail;
    if (frame.kind === 0x81) {
      const payload = frame.payload;
      displayPrefs = payload.length === 32 ? { brightness: payload[29], dim: payload[30], flags: payload[31] } : null;
      if (displayPrefs && !ui.displayDialog.open) renderDisplayForm(displayPrefs);
      updateDisplayButton();
    } else if (frame.kind === 0xa5) {
      const sample = telemetryCodec.decode(frame.payload);
      if (sample) {
        observeLoadSafety(sample);
        if (streamEnabled) addSample(sample);
      }
    } else if (frame.kind === 0xa7) {
      try {
        const lines = renderBlackBox(decodeBlackBox(frame.payload));
        globalThis.dispatchEvent(new CustomEvent("bcv2-black-box", { detail: { lines } }));
      } catch (error) { globalThis.Bcv2Transport.logDiagnostic(`Black box: ${error.message}`); }
    }
  });

  globalThis.addEventListener("bcv2-output-command", (event) => {
    setTimeout(() => {
      globalThis.Bcv2Transport.logDiagnostic(latestLoadSample
        ? `${event.detail}: ${telemetryCodec.loadSafetyLine(latestLoadSample)}`
        : `${event.detail}: no live load-status sample yet`);
    }, 300);
  });

  ui.stream.addEventListener("click", () => {
    streamEnabled = !streamEnabled;
    savePreference(STORAGE_STREAM, String(streamEnabled));
    updateControls(); scheduleDraw();
  });
  for (const button of ui.averageButtons) {
    button.addEventListener("click", () => {
      averageWindowMs = Number(button.dataset.averageMs);
      savePreference(STORAGE_AVERAGE, String(averageWindowMs));
      updateReadings();
      updateControls();
      scheduleDraw();
    });
  }
  ui.window.addEventListener("change", () => { savePreference(STORAGE_WINDOW, ui.window.value); scheduleDraw(); });
  ui.clear.addEventListener("click", () => { samples.length = 0; updateReadings(); updateControls(); updateTare(); scheduleDraw(); });
  // The tare is the mean of the last second, so set it with LOAD off.
  ui.tare.addEventListener("click", () => {
    if (tareAmps !== null) return setTare(null);
    const recent = recentRawAmps();
    if (recent.length > 0) setTare(recent.reduce((sum, amps) => sum + amps, 0) / recent.length);
  });
  // CSV keeps the card's own readings; tare_a is the console's zero, if set.
  ui.export.addEventListener("click", () => {
    const tare = tareAmps === null ? "" : tareAmps.toFixed(4);
    const rows = ["host_time_iso,device_timestamp_ms,vbus_v,current_a,power_w,tare_a", ...samples.map((sample) => `${new Date(sample.hostMs).toISOString()},${sample.deviceMs},${sample.volts.toFixed(3)},${sample.rawAmps.toFixed(3)},${(sample.volts * sample.rawAmps).toFixed(3)},${tare}`)];
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([`${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" })); link.download = `bcv2-power-${new Date().toISOString().replaceAll(":", "-")}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  });
  ui.blackBoxButton.addEventListener("click", async () => {
    ui.blackBoxButton.disabled = true;
    ui.blackBoxButton.textContent = "Reading…";
    try { await globalThis.Bcv2Transport.sendFrame(0x32); }
    catch (error) { globalThis.Bcv2Transport.logDiagnostic(`Black box: ${error.message}`); }
    finally { setTimeout(() => { ui.blackBoxButton.textContent = "Inspect black box"; ui.blackBoxButton.disabled = !globalThis.Bcv2Transport?.isConnected(); }, 250); }
  });
  ui.displayButton.addEventListener("click", () => {
    if (!displayPrefs) return;
    renderDisplayForm(displayPrefs);
    ui.displayNote.textContent = DISPLAY_HELP;
    ui.displayDialog.showModal();
  });
  for (const input of [ui.brightness, ui.contrast]) {
    input.addEventListener("input", () => showDisplayValues(displayForm()));
  }
  // One command per change (a slider sends when it is let go), so the log
  // gets one line set per change, not one per pixel dragged.
  for (const input of [ui.brightness, ui.contrast, ui.zeros, ui.marks]) {
    input.addEventListener("change", () => void sendDisplay(displayForm()));
  }
  ui.displayDefaults.addEventListener("click", () => void sendDisplay(display.defaults));
  ui.displayDone.addEventListener("click", () => ui.displayDialog.close());
  globalThis.addEventListener("bcv2-device-line", (event) => {
    const build = event.detail.match(/^Device build=0x([0-9a-f]{8}) /i);
    if (build) deviceBuild = Number.parseInt(build[1], 16);
  });
  globalThis.addEventListener("bcv2-disconnected", () => {
    displayPrefs = null;
    deviceBuild = null;
    updateDisplayButton();
    // Another card has another zero.
    if (tareAmps !== null) setTare(null);
    ui.fiveVolt.classList.add("hidden");
  });

  chart.addEventListener("mousemove", (event) => {
    const visible = visibleSamples();
    if (visible.length === 0) return ui.cursor.classList.add("hidden");
    const rect = chart.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - CHART_LEFT) / Math.max(1, rect.width - CHART_LEFT - CHART_RIGHT)));
    const index = Math.round(ratio * (visible.length - 1));
    const sample = visible[index];
    ui.cursor.textContent = `${formatValue(sample.volts, 3)} V · ${formatValue(sample.amps, 3)} A · ${formatValue(sample.watts, 3)} W`;
    ui.cursor.classList.remove("hidden");
  });
  chart.addEventListener("mouseleave", () => ui.cursor.classList.add("hidden"));

  const savedWindow = localStorage.getItem(STORAGE_WINDOW);
  if ([...ui.window.options].some((option) => option.value === savedWindow)) ui.window.value = savedWindow;
  new ResizeObserver(scheduleDraw).observe(chart);
  setInterval(() => {
    ui.blackBoxButton.disabled = !globalThis.Bcv2Transport?.isConnected();
    updateDisplayButton();
    updateTare();
  }, 400);
  updateControls(); scheduleDraw();
})();
