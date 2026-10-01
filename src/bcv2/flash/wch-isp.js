"use strict";

// WCH USB ISP: the bootloader built into the BCv2's CH32X035, which a card
// runs while BOOT is held at power-up. The sequence and timings follow
// wchisp v0.3.0, the tool the cards are flashed with:
//   identify, read config (chip UID), erase, ISP key, program in 56-byte
//   chunks scrambled with a key made from the UID, an empty final program
//   packet, ISP key again, verify, then restart.
// A request is [command, length (LE u16), payload]; a reply is [command,
// status, length (LE u16), payload].
(() => {
  const USB_FILTERS = Object.freeze([
    Object.freeze({ vendorId: 0x4348, productId: 0x55e0 }),
    Object.freeze({ vendorId: 0x1a86, productId: 0x55e0 }),
  ]);
  const ENDPOINT = 2;
  const PACKET_SIZE = 64;
  const CHUNK = 56;
  const SECTOR = 1024;
  const MIN_ERASE_SECTORS = 8;
  /** Device type of the CH32X03x series in the bootloader's identify reply. */
  const CH32X03X = 0x23;
  /** The application region ends where the card keeps its settings. */
  const MAX_IMAGE_BYTES = 0xf600;
  const CMD = Object.freeze({
    identify: 0xa1, ispEnd: 0xa2, ispKey: 0xa3, erase: 0xa4, program: 0xa5, verify: 0xa6, readConfig: 0xa7,
  });
  const IDENTIFY_PAYLOAD = [0, 0, ..."MCU ISP & WCH.CN"].map((value) => (typeof value === "string" ? value.charCodeAt(0) : value));

  class UpdateError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  function request(command, payload = []) {
    const bytes = new Uint8Array(3 + payload.length);
    bytes[0] = command;
    bytes[1] = payload.length & 0xff;
    bytes[2] = payload.length >> 8;
    bytes.set(payload, 3);
    return bytes;
  }

  /** The payload of a reply to `command`, or an error if it is malformed. */
  function parseReply(command, bytes) {
    if (bytes.length < 4 || bytes[0] !== command) {
      throw new UpdateError("protocol", `Unexpected reply to command 0x${command.toString(16)}.`);
    }
    const length = bytes[2] | (bytes[3] << 8);
    if (bytes.length !== 4 + length) throw new UpdateError("protocol", "The card's reply had the wrong length.");
    return bytes.subarray(4);
  }

  const le32 = (value) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
  const byteSum = (bytes) => bytes.reduce((sum, value) => (sum + value) & 0xff, 0);

  /** The 8-byte UID carries a checksum: the sum of its first three LE u16 words. */
  function uidValid(uid) {
    if (uid.length !== 8) return false;
    const word = (offset) => uid[offset] | (uid[offset + 1] << 8);
    return ((word(0) + word(2) + word(4)) & 0xffff) === word(6);
  }

  /** The scrambling key for program and verify data. */
  function xorKey(uid, chipId) {
    const sum = byteSum(uid);
    const key = new Uint8Array(8).fill(sum);
    key[7] = (sum + chipId) & 0xff;
    return key;
  }

  /** Program or verify payload: address, a random byte, scrambled data. */
  function chunkPayload(address, data, key, padding) {
    const payload = new Uint8Array(5 + data.length);
    payload.set(le32(address), 0);
    payload[4] = padding;
    for (let index = 0; index < data.length; index += 1) payload[5 + index] = data[index] ^ key[index % 8];
    return payload;
  }

  /** The image padded with zeros to whole 1 KiB sectors, as wchisp writes it. */
  function prepareImage(firmware) {
    const length = Math.ceil(firmware.length / SECTOR) * SECTOR;
    const image = new Uint8Array(length);
    image.set(firmware);
    return image;
  }

  const eraseSectors = (imageLength) => Math.max(MIN_ERASE_SECTORS, imageLength / SECTOR + 1);

  /**
   * Flash `firmware` through `link` ({ send(bytes), receive(timeoutMs) }).
   * `onStage(name)` reports connect, erase, write, verify and restart;
   * `onProgress(done, total)` reports bytes written or verified.
   */
  async function update(link, firmware, { onStage = () => {}, onProgress = () => {}, sleep, randomByte } = {}) {
    if (firmware.length === 0 || firmware.length > MAX_IMAGE_BYTES) {
      throw new UpdateError("image", "That firmware image is not the right size for this card.");
    }
    const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const padding = randomByte ?? (() => Math.floor(Math.random() * 256));
    const exchange = async (command, payload, timeoutMs) => {
      await link.send(request(command, payload));
      return parseReply(command, await link.receive(timeoutMs));
    };
    const image = prepareImage(firmware);

    onStage("connect");
    await exchange(CMD.identify, IDENTIFY_PAYLOAD, 1000);
    const [chipId, deviceType] = await exchange(CMD.identify, IDENTIFY_PAYLOAD, 1000);
    if (deviceType !== CH32X03X) {
      throw new UpdateError("not-bcv2", "That device is not a BCv2 card (it is a different WCH chip).");
    }
    const config = await exchange(CMD.readConfig, [0x1f, 0x00], 1000);
    const uid = config.slice(18, 26);
    if (!uidValid(uid)) throw new UpdateError("protocol", "The card's chip ID did not check out.");
    const key = xorKey(uid, chipId);
    const sendKey = async () => {
      const reply = await exchange(CMD.ispKey, new Uint8Array(0x1e), 1000);
      if (reply[0] !== byteSum(key)) throw new UpdateError("protocol", "The card did not accept the update key.");
    };

    onStage("erase");
    await exchange(CMD.erase, le32(eraseSectors(image.length)), 5000);
    await wait(1000);

    onStage("write");
    await sendKey();
    for (let address = 0; address < image.length; address += CHUNK) {
      await exchange(CMD.program, chunkPayload(address, image.subarray(address, address + CHUNK), key, padding()), 1000);
      onProgress(Math.min(address + CHUNK, image.length), image.length);
    }
    // The bootloader commits the write on an empty program packet.
    await exchange(CMD.program, chunkPayload(image.length, new Uint8Array(0), key, padding()), 1000);
    await wait(500);

    onStage("verify");
    await sendKey();
    for (let address = 0; address < image.length; address += CHUNK) {
      const reply = await exchange(CMD.verify, chunkPayload(address, image.subarray(address, address + CHUNK), key, padding()), 1000);
      if (reply[0] !== 0) throw new UpdateError("verify", "The written firmware did not match. Put the card in bootloader mode and try again.");
      onProgress(Math.min(address + CHUNK, image.length), image.length);
    }

    onStage("restart");
    try {
      await exchange(CMD.ispEnd, [0x01], 1000);
    } catch (_) {
      // The card restarts at once and may not answer.
    }
  }

  /** A link over an opened WebUSB device. */
  function usbLink(device) {
    return {
      async send(bytes) {
        const result = await device.transferOut(ENDPOINT, bytes);
        if (result.status !== "ok") throw new UpdateError("usb", `USB write failed (${result.status}).`);
      },
      async receive(timeoutMs) {
        let timer;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new UpdateError("timeout", "The card stopped answering.")), timeoutMs);
        });
        try {
          const result = await Promise.race([device.transferIn(ENDPOINT, PACKET_SIZE), timeout]);
          if (result.status !== "ok") throw new UpdateError("usb", `USB read failed (${result.status}).`);
          return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }

  const api = Object.freeze({
    USB_FILTERS, CMD, CH32X03X, MAX_IMAGE_BYTES, UpdateError,
    request, parseReply, uidValid, xorKey, chunkPayload, prepareImage, eraseSectors, update, usbLink,
  });
  if (typeof module !== "undefined") module.exports = api;
  else globalThis.Bcv2WchIsp = api;
})();
