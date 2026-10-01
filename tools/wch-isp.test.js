// Tests for the BCv2 browser updater's WCH ISP code against a simulated
// CH32X035 bootloader. Run with: pnpm test
const test = require("node:test");
const assert = require("node:assert/strict");
const isp = require("../src/bcv2/flash/wch-isp.js");

const CHIP_ID = 0x56;
const UID = [0x3c, 0xa1, 0x07, 0x5e, 0x92, 0x10];
// The last two UID bytes hold the LE sum of the first three LE words.
const uidSum = (UID[0] | (UID[1] << 8)) + (UID[2] | (UID[3] << 8)) + (UID[4] | (UID[5] << 8));
UID.push(uidSum & 0xff, (uidSum >> 8) & 0xff);

/** A bootloader that decodes requests the way the chip does. */
function bootloader({ deviceType = 0x23, uid = UID, corrupt = null, silentEnd = false } = {}) {
  const flash = new Uint8Array(0x10000).fill(0xe3);
  const sum = uid.reduce((total, value) => (total + value) & 0xff, 0);
  const key = [sum, sum, sum, sum, sum, sum, sum, (sum + CHIP_ID) & 0xff];
  const state = { flash, packets: [], erasedSectors: 0, keyed: 0, committed: false, ended: false, pending: null };
  const reply = (command, payload) => Uint8Array.from([command, 0, payload.length & 0xff, payload.length >> 8, ...payload]);
  const decode = (payload) => {
    const address = payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24);
    const data = Array.from(payload.subarray(5), (value, index) => value ^ key[index % 8]);
    return { address, data };
  };
  state.link = {
    async send(bytes) {
      state.packets.push(bytes);
      assert.ok(bytes.length <= 64, "request fits one USB packet");
      const [command] = bytes;
      const length = bytes[1] | (bytes[2] << 8);
      const payload = bytes.subarray(3);
      assert.equal(payload.length, length);
      switch (command) {
        case 0xa1:
          assert.equal(String.fromCharCode(...payload.subarray(2)), "MCU ISP & WCH.CN");
          state.pending = reply(command, [CHIP_ID, deviceType]);
          break;
        case 0xa7:
          state.pending = reply(command, [0x1f, 0x00, ...new Array(12).fill(0xff), 0, 2, 9, 0, ...uid]);
          break;
        case 0xa3:
          assert.equal(length, 0x1e);
          state.keyed += 1;
          state.pending = reply(command, [key.reduce((total, value) => (total + value) & 0xff, 0)]);
          break;
        case 0xa4: {
          state.erasedSectors = payload[0] | (payload[1] << 8);
          state.flash.fill(0xff, 0, state.erasedSectors * 1024);
          state.pending = reply(command, [0, 0]);
          break;
        }
        case 0xa5: {
          const { address, data } = decode(payload);
          if (data.length === 0) state.committed = true;
          state.flash.set(data, address);
          if (corrupt !== null && address <= corrupt && corrupt < address + data.length) state.flash[corrupt] ^= 0x01;
          state.pending = reply(command, [0, 0]);
          break;
        }
        case 0xa6: {
          const { address, data } = decode(payload);
          const same = data.every((value, index) => state.flash[address + index] === value);
          state.pending = reply(command, [same ? 0 : 0xf5, 0]);
          break;
        }
        case 0xa2:
          state.ended = true;
          state.pending = silentEnd ? null : reply(command, [0, 0]);
          break;
        default:
          throw new Error(`unknown command 0x${command.toString(16)}`);
      }
    },
    async receive() {
      if (!state.pending) throw new isp.UpdateError("timeout", "The card stopped answering.");
      const bytes = state.pending;
      state.pending = null;
      return bytes;
    },
  };
  return state;
}

const firmware = (length) => Uint8Array.from({ length }, (_, index) => (index * 7 + 3) & 0xff);
const noWait = { sleep: async () => {}, randomByte: () => 0x5a };

test("writes, checks and restarts with the padded image", async () => {
  const chip = bootloader();
  const image = firmware(62848);
  const stages = [];
  await isp.update(chip.link, image, { ...noWait, onStage: (stage) => stages.push(stage) });
  assert.deepEqual(stages, ["connect", "erase", "write", "verify", "restart"]);
  assert.equal(chip.erasedSectors, 63);
  assert.deepEqual(chip.flash.subarray(0, image.length), image);
  assert.ok(chip.flash.subarray(image.length, 63488).every((value) => value === 0), "padded with zeros to 1 KiB");
  assert.ok(chip.committed, "empty program packet sent");
  assert.equal(chip.keyed, 2);
  assert.ok(chip.ended);
});

test("small images still erase the minimum eight sectors", async () => {
  const chip = bootloader();
  await isp.update(chip.link, firmware(1500), noWait);
  assert.equal(chip.erasedSectors, 8);
});

test("progress reaches the end of the write and of the check", async () => {
  const chip = bootloader();
  const seen = [];
  await isp.update(chip.link, firmware(4000), { ...noWait, onProgress: (done, total) => seen.push([done, total]) });
  const ends = seen.filter(([done, total]) => done === total);
  assert.equal(ends.length, 2);
  assert.equal(ends[0][1], 4096);
});

test("a byte that does not stick fails the check", async () => {
  const chip = bootloader({ corrupt: 1234 });
  await assert.rejects(isp.update(chip.link, firmware(8000), noWait), { code: "verify" });
  assert.ok(!chip.ended);
});

test("refuses other WCH chips before erasing", async () => {
  const chip = bootloader({ deviceType: 0x17 });
  await assert.rejects(isp.update(chip.link, firmware(8000), noWait), { code: "not-bcv2" });
  assert.equal(chip.erasedSectors, 0);
});

test("refuses a chip UID that fails its checksum", async () => {
  const uid = [...UID];
  uid[7] ^= 0xff;
  const chip = bootloader({ uid });
  await assert.rejects(isp.update(chip.link, firmware(8000), noWait), { code: "protocol" });
  assert.equal(chip.erasedSectors, 0);
});

test("refuses images that are empty or reach the settings pages", async () => {
  for (const length of [0, isp.MAX_IMAGE_BYTES + 1]) {
    const chip = bootloader();
    await assert.rejects(isp.update(chip.link, firmware(length), noWait), { code: "image" });
    assert.equal(chip.packets.length, 0);
  }
});

test("a card that restarts without answering the end is still a success", async () => {
  const chip = bootloader({ silentEnd: true });
  await isp.update(chip.link, firmware(3000), noWait);
  assert.ok(chip.ended);
});

test("replies for another command or with a bad length are rejected", () => {
  assert.throws(() => isp.parseReply(0xa5, Uint8Array.from([0xa6, 0, 2, 0, 0, 0])), { code: "protocol" });
  assert.throws(() => isp.parseReply(0xa5, Uint8Array.from([0xa5, 0, 3, 0, 0, 0])), { code: "protocol" });
  assert.deepEqual(Array.from(isp.parseReply(0xa5, Uint8Array.from([0xa5, 0, 2, 0, 7, 8]))), [7, 8]);
});

test("the key matches wchisp's for a known UID", () => {
  const key = isp.xorKey(Uint8Array.from(UID), CHIP_ID);
  const sum = UID.reduce((total, value) => (total + value) & 0xff, 0);
  assert.deepEqual(Array.from(key), [sum, sum, sum, sum, sum, sum, sum, (sum + CHIP_ID) & 0xff]);
});
