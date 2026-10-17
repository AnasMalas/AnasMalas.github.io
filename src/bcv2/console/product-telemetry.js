"use strict";

(() => {
  const PAYLOAD_LENGTH = 22;
  const CSV_HEADER = "timestamp_ms,vbus_mv,current_ma,power_mw,contract_mv,contract_ma,attached,load_enabled";
  const FLAG_ATTACHED = 1 << 0;
  const FLAG_LOAD_REQUESTED = 1 << 2;
  const FLAG_OUTPUT_EFFECTIVE = 1 << 3;
  // Set when the output started only after the card stepped the voltage down
  // and back (WARN I), until LOAD next turns on (v1.2 and later; 0 before).
  const FLAG_INRUSH_ROUTINE = 1 << 4;
  const INRUSH_LINE = "WARN I (inrush): the output did not start when LOAD turned on. Factors including inrush current can trip the output switch, so the card ran its inrush reduction routine: it stepped the voltage down and back up, and the output started.";
  const FLAG_LOAD_SAFETY_V1 = 1 << 10;
  const LOAD_SAFETY_MASK = (1 << 1) | (1 << 2) | FLAG_OUTPUT_EFFECTIVE | (1 << 9) | (1 << 11);
  // What last turned the LOAD request off, in bits 12-14 (v1.2 and later;
  // 0 before).
  const LOAD_OFF_REASONS = ["", "LOAD key", "APPLY", "USB command or library", "brake", "PD session change"];

  const u16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
  const u32 = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

  function decode(payload) {
    if (payload.length !== PAYLOAD_LENGTH) return null;
    return {
      timestampMs: u32(payload, 0),
      vbusMv: u32(payload, 4),
      currentMa: u32(payload, 8),
      contractMv: u32(payload, 12),
      contractMa: u32(payload, 16),
      flags: u16(payload, 20),
    };
  }

  function csvRow(sample) {
    return [
      sample.timestampMs,
      sample.vbusMv,
      sample.currentMa,
      Math.round(sample.vbusMv * sample.currentMa / 1000),
      sample.contractMv,
      sample.contractMa,
      sample.flags & FLAG_ATTACHED ? 1 : 0,
      sample.flags & FLAG_OUTPUT_EFFECTIVE ? 1 : 0,
    ];
  }

  function loadSafetyFlags(sample) {
    return sample.flags & FLAG_LOAD_SAFETY_V1 ? sample.flags & LOAD_SAFETY_MASK : null;
  }

  function loadSafetyLine(sample) {
    if (!(sample.flags & FLAG_LOAD_SAFETY_V1)) return "LOAD safety details require firmware build 0x01050018 or newer";
    const has = (bit) => Boolean(sample.flags & (1 << bit));
    const reason = has(2) ? "" : LOAD_OFF_REASONS[(sample.flags >> 12) & 7] ?? "";
    return `LOAD: contract=${has(1)} requested=${has(2)}${reason ? ` (off by ${reason})` : ""} effective=${has(3)} OPA-high=${has(9)} brake-latched=${has(11)} VBUS=${(sample.vbusMv / 1000).toFixed(2)}V`;
  }

  // True while LOAD is on and the inrush routine started it.
  function inrushRoutineUsed(sample) {
    const both = FLAG_INRUSH_ROUTINE | FLAG_LOAD_REQUESTED;
    return (sample.flags & both) === both;
  }

  function rollingAverage(points, windowMs) {
    if (!Number.isFinite(windowMs) || windowMs <= 0 || points.length < 2) return points;
    const averaged = [];
    let first = 0;
    let volts = 0;
    let amps = 0;
    let watts = 0;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      volts += point.volts;
      amps += point.amps;
      watts += point.watts;
      const cutoff = point.hostMs - windowMs;
      while (first < index && points[first].hostMs < cutoff) {
        volts -= points[first].volts;
        amps -= points[first].amps;
        watts -= points[first].watts;
        first += 1;
      }
      const count = index - first + 1;
      averaged.push({
        ...point,
        volts: volts / count,
        amps: amps / count,
        watts: watts / count,
      });
    }
    return averaged;
  }

  globalThis.Bcv2ProductTelemetry = Object.freeze({
    CSV_HEADER, INRUSH_LINE, decode, csvRow, rollingAverage, loadSafetyFlags, loadSafetyLine, inrushRoutineUsed,
  });
})();
