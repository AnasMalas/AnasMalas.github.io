"use strict";

// The BCv2 update page: shows the easiest way to update from this device,
// and runs the browser updater (wch-isp.js over WebUSB) where it can.
(() => {
  const isp = globalThis.Bcv2WchIsp;
  const page = document.querySelector("[data-updater]");
  if (!page) return;
  const webUsb = "usb" in navigator && window.isSecureContext;
  // The warning about browsers without WebUSB, only where it applies.
  page.querySelector("[data-usb-warning]").hidden = webUsb;
  if (!isp) return;

  const ua = navigator.userAgent;
  // iPadOS asks for desktop pages as a Mac, but has a touch screen.
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const platform = /iPhone|iPad|iPod/.test(ua) || touchMac ? "ios"
    : /Android/.test(ua) ? "android"
      : /CrOS/.test(ua) ? "chromeos"
        : /Windows/.test(ua) ? "windows"
          : /Macintosh/.test(ua) ? "mac"
            : /Linux/.test(ua) ? "linux" : "other";
  const $ = (selector, root = page) => root.querySelector(selector);

  function showRoute(route) {
    for (const section of page.querySelectorAll("[data-route]")) section.hidden = section.dataset.route !== route;
    for (const button of page.querySelectorAll("[data-show-browser]")) button.hidden = !webUsb || route === "browser";
    $("[data-linux-help]").hidden = route !== "browser" || platform !== "linux";
    $("[data-windows-help]").hidden = route !== "browser" || platform !== "windows";
  }

  function initialRoute() {
    if (platform === "ios") return "ios";
    // Windows too: many already have the driver, and the other methods are
    // one click away if it doesn't work.
    return webUsb ? "browser" : "switch";
  }

  $("[data-device]").textContent = platform === "android" ? "phone" : "computer";
  const browserName = /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
      : /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua) ? "Safari" : "This browser";
  $("[data-browser-name]").textContent = browserName;
  $("[data-good-browsers]").textContent = platform === "android" ? "Chrome" : "Chrome or Edge";
  $("[data-desktop-only]").hidden = platform === "android";

  const share = $("[data-share]");
  if (navigator.share) {
    share.hidden = false;
    share.addEventListener("click", () => navigator.share({ title: document.title, url: location.href }).catch(() => {}));
  }

  const trouble = $("[data-trouble]");
  for (const link of page.querySelectorAll("[data-open-trouble]")) {
    link.addEventListener("click", () => { trouble.open = true; });
  }
  // No beta tag on Android.
  $("[data-beta]").hidden = platform === "android";

  // Other ways to update: one tile per way, each showing its own
  // instructions. Without this script every panel stays visible.
  const ways = page.querySelectorAll("[data-way]");
  const panels = page.querySelectorAll("[data-way-panel]");
  function showWay(way) {
    for (const tile of ways) tile.setAttribute("aria-pressed", String(tile.dataset.way === way));
    for (const panel of panels) panel.hidden = panel.dataset.wayPanel !== way;
  }
  for (const tile of ways) {
    tile.addEventListener("click", () => showWay(tile.getAttribute("aria-pressed") === "true" ? null : tile.dataset.way));
  }
  showWay(null);

  for (const button of page.querySelectorAll("[data-show-browser]")) {
    button.addEventListener("click", () => {
      showRoute("browser");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  showRoute(initialRoute());

  // Windows: the other methods, behind a button and opened by a failed try.
  const moreWays = $("[data-more-ways]");
  const moreWaysPanel = $("[data-more-ways-panel]");
  function showMoreWays(open) {
    moreWaysPanel.hidden = !open;
    moreWays.setAttribute("aria-expanded", String(open));
  }
  moreWays.addEventListener("click", () => showMoreWays(moreWaysPanel.hidden));

  // Browser updater.
  const card = $('[data-route="browser"]');
  const button = $("[data-update]", card);
  const progress = $("[data-progress]", card);
  const bar = $("progress", progress);
  const status = $("[data-status]", progress);
  const result = $("[data-result]", card);
  const firmware = {
    url: page.dataset.firmwareUrl,
    sha256: page.dataset.firmwareSha256,
    version: page.dataset.firmwareVersion,
  };
  // Overall progress: writing fills 5 to 55 %, checking 55 to 100 %.
  const STAGES = {
    download: { label: "Getting the firmware", from: 0, span: 0 },
    connect: { label: "Connecting to the card", from: 1, span: 0 },
    erase: { label: "Erasing", from: 2, span: 0 },
    write: { label: "Writing", from: 5, span: 50 },
    verify: { label: "Checking", from: 55, span: 45 },
    restart: { label: "Restarting the card", from: 100, span: 0 },
  };
  let stage = STAGES.download;
  let firmwareBytes = null;
  let busy = false;

  async function loadFirmware() {
    if (firmwareBytes) return firmwareBytes;
    let bytes;
    try {
      const response = await fetch(firmware.url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (_) {
      throw new isp.UpdateError("download", "Couldnt download the firmware. Check your internet and try again.");
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
    if (hex !== firmware.sha256) {
      throw new isp.UpdateError("download", "The firmware download didnt check out. Reload the page and try again.");
    }
    firmwareBytes = bytes;
    return bytes;
  }

  function setStage(name) {
    stage = STAGES[name];
    bar.value = stage.from;
    status.textContent = `${stage.label}…`;
  }

  function setProgress(done, total) {
    bar.value = stage.from + (stage.span * done) / total;
    status.textContent = `${stage.label}… ${Math.floor((done * 100) / total)}%`;
  }

  function finish(kind, message) {
    result.dataset.kind = kind;
    result.textContent = message;
    result.hidden = false;
  }

  async function openCard(device) {
    try {
      await device.open();
      if (device.configuration === null) await device.selectConfiguration(1);
      await device.claimInterface(0);
    } catch (error) {
      throw new isp.UpdateError("access", error.message);
    }
  }

  const RETRY = " Unplug POWER, do step 2 again and press Update. Nothing is broken, the bootloader cant be erased.";

  function messageFor(error) {
    if (error.code === "access") {
      if (platform === "windows") {
        return "Windows won't let the browser use the card without a driver. Install it or use one of the other methods below.";
      }
      if (platform === "linux") {
        trouble.open = true;
        return "Linux isnt letting Chrome use the card yet. Add the udev rule under Trouble, then try again.";
      }
      return "Couldnt open the card. Close anything else that might be using it, like WCHISPTool, then unplug POWER and try again.";
    }
    if (error.code === "download") return error.message;
    if (error.code === "not-bcv2") return `${error.message} Pick your card in the list.`;
    if (error.name === "NotFoundError") return `The card got unplugged.${RETRY}`;
    if (error instanceof isp.UpdateError) return `${error.message}${RETRY}`;
    return `Something went wrong (${error.message}).${RETRY}`;
  }

  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    result.hidden = true;
    // Download while the card list is open; asking for the card first keeps
    // the click's permission to show that list.
    const bytes = loadFirmware();
    bytes.catch(() => {});
    let device = null;
    try {
      device = await navigator.usb.requestDevice({ filters: isp.USB_FILTERS });
    } catch (_) {
      finish("info", "No card picked. If yours wasnt in the list, it isnt in bootloader mode: unplug POWER and do step 2 again, pressing BOOT a bit harder.");
      if (platform === "windows") showMoreWays(true);
      busy = false;
      button.disabled = false;
      return;
    }
    progress.hidden = false;
    window.addEventListener("beforeunload", holdPage);
    try {
      setStage("download");
      const image = await bytes;
      setStage("connect");
      await openCard(device);
      await isp.update(isp.usbLink(device), image, { onStage: setStage, onProgress: setProgress });
      finish("ok", `Done! Your card restarted on ${firmware.version}.`);
      button.textContent = "Update another card";
    } catch (error) {
      finish("error", messageFor(error));
      if (platform === "windows") showMoreWays(true);
      button.textContent = "Try again";
    } finally {
      try {
        await device.close();
      } catch (_) {
        // The card restarted or was unplugged.
      }
      window.removeEventListener("beforeunload", holdPage);
      progress.hidden = true;
      busy = false;
      button.disabled = false;
    }
  });

  function holdPage(event) {
    event.preventDefault();
    event.returnValue = "";
  }
})();
