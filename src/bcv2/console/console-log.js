"use strict";

(() => {
  function rawTransportLine(bytes, api, enabled) {
    if (!enabled || bytes.length === 0) return null;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    return `RAW ${api} ${bytes.length} B · ${hex}`;
  }

  function pruneEntries(entries, maximum, batch) {
    if (entries.length <= maximum + batch) return 0;
    const removed = entries.length - maximum;
    entries.splice(0, removed);
    return removed;
  }

  globalThis.Bcv2ConsoleLog = Object.freeze({
    pruneEntries,
    rawTransportLine,
  });
})();
