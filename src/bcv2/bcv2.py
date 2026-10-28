#!/usr/bin/env python3
"""Talk to a BCv2 card (The Negotiator II) over its DATA port.

This is the same protocol the console at anasmalas.com/bcv2/console uses,
documented at anasmalas.com/bcv2/#serial. Needs Python 3.8 or later and
pyserial (pip install pyserial).

    python bcv2.py                    card info, charger offers, then live readings
    python bcv2.py watch --csv log.csv
    python bcv2.py request 9          9V, the card picks the supply
    python bcv2.py request 12.34 2.5 --supply pps
    python bcv2.py load on            or off
    python bcv2.py epr on             or off
    python bcv2.py blackbox
    python bcv2.py display 34 21      brightness 0 to 43, dim dots 3 to 60

Add --port COM5 (or /dev/ttyACM0) if it doesn't find the card on its own.

Or use it from your own script:

    from bcv2 import Card
    with Card() as card:
        card.request(15)
        card.load(True)
        for reading in card.readings(seconds=10):
            print(reading["mv"], reading["ma"])
"""

import argparse
import collections
import struct
import sys
import time

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    sys.exit("This needs pyserial: pip install pyserial")

USB_ID = (0x1A86, 0xFE0C)
MAGIC = b"PD"
VERSION = 1
MAX_PAYLOAD = 56

# Firmware releases by build ID.
RELEASES = {0x01050045: "v1.0", 0x01050049: "v1.1", 0x0105004F: "v1.2"}

# Commands, computer to card.
DEVICE = 0x01
OFFERS_AGAIN = 0x02
ENTER_EPR = 0x05
EPR_OFFERS_AGAIN = 0x06
EXIT_EPR = 0x07
OUTPUT_ON = 0x0C
OUTPUT_OFF = 0x0D
REQUEST = 0x10
BLACK_BOX = 0x32
DISPLAY = 0x34

# Events, card to computer.
RESULT = 0x80
DEVICE_INFO = 0x81
OFFERS = 0x83
HARD_RESET = 0x88
READING = 0xA5
BLACK_BOX_STATE = 0xA7

RESULTS = ["queued", "busy", "invalid", "unsupported"]
SUPPLIES = {"auto": 0, "fixed": 1, "pps": 2, "spr-avs": 3, "epr-avs": 4}
MOST_ON_OFFER = 0xFFFFFFFF
LOAD_OFF_BY = ["", "LOAD key", "APPLY", "USB command", "brake", "PD session change", "", ""]
HARD_RESET_CAUSES = [
    "source-signaled", "invalid-source-capabilities", "soft-reset-failed",
    "source-capabilities-timeout", "request-response-timeout",
    "power-transition-failure", "epr-capabilities-timeout",
    "epr-protocol-error", "epr-keepalive-failed",
]
BLACK_BOX_EVENTS = {
    1: "hard reset", 2: "PHY reset failed", 3: "PD PHY unstable", 4: "partner timeout",
    5: "protocol error", 6: "terminal stop", 7: "EPR entry failed", 8: "power rail fell",
}
CSV_HEADER = "timestamp_ms,vbus_mv,current_ma,power_mw,contract_mv,contract_ma,attached,load_enabled"


def crc8(data):
    """CRC-8: polynomial 0x07, starting at 0, no final XOR."""
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def frame(kind, seq, payload=b""):
    """One frame: PD, version, kind, sequence, length, payload, and the CRC of all but the PD."""
    body = bytes([VERSION, kind, seq, len(payload)]) + bytes(payload)
    return MAGIC + body + bytes([crc8(body)])


class FrameReader:
    """Splits the bytes from the card into (kind, sequence, payload) frames."""

    def __init__(self):
        self.buffer = bytearray()

    def feed(self, data):
        self.buffer += data
        frames = []
        while True:
            start = self.buffer.find(MAGIC)
            if start < 0:
                del self.buffer[:-1]  # it might end with the "P" of the next frame
                return frames
            del self.buffer[:start]
            if len(self.buffer) < 6:
                return frames
            length = self.buffer[5]
            if length > MAX_PAYLOAD:
                del self.buffer[0]
                continue
            end = 7 + length
            if len(self.buffer) < end:
                return frames
            if crc8(self.buffer[2:end - 1]) != self.buffer[end - 1]:
                del self.buffer[0]  # damaged: look for the next "PD"
                continue
            if self.buffer[2] == VERSION:
                frames.append((self.buffer[3], self.buffer[4], bytes(self.buffer[6:end - 1])))
            del self.buffer[:end]


def u32(data, offset):
    return struct.unpack_from("<I", data, offset)[0]


def decode_device(p):
    info = {"id": p[:8].hex(), "max_mv": u32(p, 9), "max_ma": u32(p, 13), "max_mw": u32(p, 17)}
    if len(p) >= 29:  # firmware v1.0 and later
        build = u32(p, 21)
        info["build"] = "%s (0x%08X)" % (RELEASES[build], build) if build in RELEASES else "0x%08X" % build
    if len(p) >= 32:  # firmware v1.1 and later
        info["display"] = {"brightness": p[29], "dim": p[30], "flags": p[31]}
    return info


def decode_pdo(raw):
    """One power data object (PDO), laid out as the USB PD spec has it."""
    if raw == 0:
        return {"supply": "empty"}
    if raw >> 30 == 0:
        return {"supply": "fixed", "mv": ((raw >> 10) & 0x3FF) * 50, "ma": (raw & 0x3FF) * 10}
    if raw >> 30 != 3:
        return {"supply": "unsupported", "raw": raw}  # battery or variable supply
    kind = (raw >> 28) & 3
    if kind == 0:
        return {"supply": "pps", "min_mv": ((raw >> 8) & 0xFF) * 100,
                "max_mv": ((raw >> 17) & 0xFF) * 100, "ma": (raw & 0x7F) * 50}
    if kind == 1:
        return {"supply": "epr-avs", "min_mv": ((raw >> 8) & 0xFF) * 100,
                "max_mv": ((raw >> 17) & 0x1FF) * 100, "pdp_w": raw & 0xFF}
    if kind == 2:
        ma_15v, ma_20v = ((raw >> 10) & 0x3FF) * 10, (raw & 0x3FF) * 10
        return {"supply": "spr-avs", "min_mv": 9000, "max_mv": 20000 if ma_20v else 15000,
                "ma_15v": ma_15v, "ma_20v": ma_20v}
    return {"supply": "unsupported", "raw": raw}


def decode_offers(p):
    """The charger's offers. Positions count from 1; 8 and up are EPR."""
    pdos = [decode_pdo(u32(p, 3 + 4 * index)) for index in range(p[2])]
    return {"epr_list": p[0] == 1, "charger_does_epr": bool(p[1]), "pdos": pdos}


def decode_reading(p):
    t, mv, ma, contract_mv, contract_ma, flags = struct.unpack("<5IH", p)
    return {
        "t_ms": t, "mv": mv, "ma": ma, "mw": mv * ma // 1000,
        "contract_mv": contract_mv, "contract_ma": contract_ma, "flags": flags,
        "attached": bool(flags & 1 << 0),
        "contract": bool(flags & 1 << 1),
        "load_on": bool(flags & 1 << 2),  # what you asked for
        "output_on": bool(flags & 1 << 3),  # what the switch is doing
        "inrush": bool(flags & 1 << 4),  # WARN I, firmware v1.2
        "dimmed": bool(flags & 1 << 5),  # THERM LIM
        "brake": bool(flags & 1 << 11),
        "load_off_by": LOAD_OFF_BY[(flags >> 12) & 7],  # firmware v1.2
        "save_failed": bool(flags & 1 << 15),  # WARN S
    }


def decode_hard_reset(p):
    cause = p[5] if len(p) > 5 else None
    return {
        "from": "card" if p[0] else "charger", "recovery_ms": u32(p, 1),
        "cause": HARD_RESET_CAUSES[cause] if cause is not None and cause < len(HARD_RESET_CAUSES) else cause,
    }


def decode_black_box(p):
    saved_ma = u32(p, 12)
    events = []
    for index in range(min(p[2], 6)):
        offset = 20 + 6 * index
        uptime_s, context = struct.unpack_from("<HH", p, offset)
        kind, detail = p[offset + 4], p[offset + 5]
        event = {"uptime_s": uptime_s, "event": BLACK_BOX_EVENTS.get(kind, "event %d" % kind),
                 "detail": detail, "context": context}
        if kind == 1:
            event.update(decode_hard_reset(bytes([detail >> 7]) + struct.pack("<I", context) + bytes([detail & 0x7F])))
        events.append(event)
    modes = list(SUPPLIES)
    return {
        "saved_mv": u32(p, 8), "saved_ma": None if saved_ma == MOST_ON_OFFER else saved_ma,
        "saved_supply": modes[p[3]] if p[3] < len(modes) else p[3],
        "flags": p[1], "events": events,
    }


def find_port():
    for port in list_ports.comports():
        if (port.vid, port.pid) == USB_ID:
            return port.device
    raise RuntimeError("No BCv2 card found. Is DATA plugged in? Or pass --port.")


class Card:
    def __init__(self, port=None):
        # Any baud rate works, it's USB. The card only talks while DTR is
        # set, and pyserial sets it when it opens the port.
        self.serial = serial.Serial(port or find_port(), 115200, timeout=0.05)
        self.reader = FrameReader()
        self.waiting = collections.deque(maxlen=2000)  # 100 s of readings
        self.seq = 0
        # Firmware v1.2 and earlier can drop the first packet each way after
        # the port opens. Like the console, start with a device query, which
        # send() repeats until the card answers.
        self.send(DEVICE)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self.serial.close()

    def _poll(self):
        return self.reader.feed(self.serial.read(self.serial.in_waiting or 1))

    def events(self, seconds=None):
        """Yield (kind, payload) for everything the card sends, for a while or forever."""
        end = None if seconds is None else time.monotonic() + seconds
        while end is None or time.monotonic() < end:
            if not self.waiting:
                self.waiting.extend(self._poll())
            if self.waiting:
                kind, _, payload = self.waiting.popleft()
                yield kind, payload

    def wait_for(self, kind, seconds):
        """The next event of one kind. Other events stay queued for events()."""
        end = time.monotonic() + seconds
        while True:
            for index, (got, _, payload) in enumerate(self.waiting):
                if got == kind:
                    del self.waiting[index]
                    return payload
            if time.monotonic() >= end:
                return None
            self.waiting.extend(self._poll())

    def send(self, kind, payload=b"", retries=5):
        """Send a command. Returns queued, invalid or unsupported, or busy if it stays busy."""
        answer = None
        for _ in range(retries):
            self.seq = self.seq % 255 + 1  # 1 to 255; the card uses 0 for its own events
            self.serial.write(frame(kind, self.seq, payload))
            answer = None
            end = time.monotonic() + 0.5
            while answer is None and time.monotonic() < end:
                for got in self._poll():
                    if got[0] == RESULT and got[1] == self.seq and answer is None:
                        answer = RESULTS[got[2][0]] if got[2][0] < len(RESULTS) else "result %d" % got[2][0]
                    else:
                        self.waiting.append(got)
            if answer not in (None, "busy"):  # busy: it holds 4 commands at a time
                return answer
            time.sleep(0.1)
        if answer is None:
            raise TimeoutError("The card didn't answer.")
        return answer

    def info(self):
        """Device info. The card sends it when the port opens, but it can be dropped, so ask again."""
        for _ in range(3):
            payload = self.wait_for(DEVICE_INFO, 0.4)
            if payload:
                return decode_device(payload)
            self.send(DEVICE)
        raise TimeoutError("No device info from the card.")

    def offers(self, epr=False):
        """Ask the charger for its offers again and return them (None without a charger)."""
        self.send(EPR_OFFERS_AGAIN if epr else OFFERS_AGAIN)
        payload = self.wait_for(OFFERS, 2)
        return decode_offers(payload) if payload else None

    def request(self, volts, amps=None, supply="auto"):
        """Ask for a voltage, like APPLY. amps=None asks for the most on offer there."""
        mv = round(volts * 1000)
        ma = MOST_ON_OFFER if amps is None else round(amps * 1000)
        if mv < 5000 or ma < 500:
            raise ValueError("The card takes 5V or more, and 0.5A or more.")
        return self.send(REQUEST, struct.pack("<IIB", mv, ma, SUPPLIES[supply]))

    def load(self, on):
        """The output, like LOAD ON/OFF. The card's safety rules still apply."""
        return self.send(OUTPUT_ON if on else OUTPUT_OFF)

    def epr(self, on):
        return self.send(ENTER_EPR if on else EXIT_EPR)

    def black_box(self):
        self.send(BLACK_BOX)
        return decode_black_box(self.wait_for(BLACK_BOX_STATE, 1))

    def display(self, brightness=34, dim=21, hide_zeros=False, hide_marks=False):
        """Brightness 0 to 43 and dim dots 3 to 60, saved on the card. Firmware v1.1 and later."""
        return self.send(DISPLAY, bytes([brightness, dim, hide_zeros | hide_marks << 1]))

    def readings(self, seconds=None):
        """Yield each reading (20 a second) as a dict, see decode_reading."""
        for kind, payload in self.events(seconds):
            if kind == READING:
                yield decode_reading(payload)


def volts(mv):
    return "%.2fV" % (mv / 1000)


def amps(ma):
    return "%.2fA" % (ma / 1000)


def print_offers(offers):
    if not offers:
        print("No charger offers. Is a PD charger in POWER?")
        return
    for position, pdo in enumerate(offers["pdos"], 1):
        supply = pdo["supply"]
        if supply == "fixed":
            what = "%-8s %-15s %s" % ("fixed", volts(pdo["mv"]), amps(pdo["ma"]))
        elif supply == "pps":
            what = "%-8s %-15s %s" % ("PPS", volts(pdo["min_mv"]) + "-" + volts(pdo["max_mv"]), amps(pdo["ma"]))
        elif supply == "spr-avs":
            what = "%-8s %-15s %s at 15V, %s at 20V" % ("SPR AVS", volts(pdo["min_mv"]) + "-" + volts(pdo["max_mv"]),
                                                       amps(pdo["ma_15v"]), amps(pdo["ma_20v"]))
        elif supply == "epr-avs":
            what = "%-8s %-15s %dW" % ("EPR AVS", volts(pdo["min_mv"]) + "-" + volts(pdo["max_mv"]), pdo["pdp_w"])
        else:
            what = supply
        print("PDO%-3d %s" % (position, what))
    if offers["charger_does_epr"] and not offers["epr_list"]:
        print("The charger does EPR: python bcv2.py epr on")


def describe(reading):
    line = "%7.2fs  %6s  %5s  %6.2fW" % (reading["t_ms"] / 1000, volts(reading["mv"]), amps(reading["ma"]), reading["mw"] / 1000)
    line += "  contract " + (volts(reading["contract_mv"]) + " " + amps(reading["contract_ma"]) if reading["contract_mv"] else "none")
    line += "  LOAD " + ("on" if reading["output_on"] else "waiting" if reading["load_on"] else "off")
    for flag, note in (("inrush", "WARN I"), ("dimmed", "THERM LIM"), ("brake", "brake"), ("save_failed", "WARN S")):
        if reading[flag]:
            line += "  " + note
    return line


def watch(card, csv_path=None):
    info = card.info()
    print("Card firmware %s, up to %s %s" % (info.get("build", "before v1.0"), volts(info["max_mv"]), amps(info["max_ma"])))
    print_offers(card.offers())
    print("Readings, Ctrl+C to stop:")
    csv = open(csv_path, "w") if csv_path else None
    if csv:
        csv.write(CSV_HEADER + "\n")
    shown = 0
    try:
        for kind, payload in card.events():
            if kind == READING:
                reading = decode_reading(payload)
                if csv:
                    csv.write("%d,%d,%d,%d,%d,%d,%d,%d\n" % (
                        reading["t_ms"], reading["mv"], reading["ma"], reading["mw"], reading["contract_mv"],
                        reading["contract_ma"], reading["attached"], reading["output_on"]))
                if time.monotonic() - shown >= 0.25:
                    shown = time.monotonic()
                    print(describe(reading))
            elif kind == OFFERS:
                print("New charger offers:")
                print_offers(decode_offers(payload))
            elif kind == HARD_RESET:
                reset = decode_hard_reset(payload)
                print("Hard reset from the %s (%s), LOAD off" % (reset["from"], reset["cause"]))
    except KeyboardInterrupt:
        pass
    finally:
        if csv:
            csv.close()


def request_and_wait(card, args):
    # The contract is the request rounded down to the supply's step: 20 mV
    # for PPS, 100 mV for AVS, exact for fixed.
    target = round(args.volts * 1000)
    reached = lambda reading: reading["contract"] and 0 <= target - reading["contract_mv"] < 100
    previous = next(card.readings(1), None)
    answer = card.request(args.volts, args.amps, args.supply)
    if answer != "queued":
        sys.exit("The card said %s." % answer)
    for reading in card.readings(3):
        if previous and reading["contract_mv"] == previous["contract_mv"] and not reached(previous):
            continue
        if reached(reading):
            print("Contract %s %s, VBUS %s" % (volts(reading["contract_mv"]), amps(reading["contract_ma"]), volts(reading["mv"])))
            return
    sys.exit("The contract didn't change. The charger might not offer that (the card plays WARN R).")


def main():
    parser = argparse.ArgumentParser(description="Talk to a BCv2 card over its DATA port.")
    parser.add_argument("--port", help="like COM5 or /dev/ttyACM0, found on its own if left out")
    commands = parser.add_subparsers(dest="command")
    watch_args = commands.add_parser("watch", help="card info, charger offers, then live readings (the default)")
    watch_args.add_argument("--csv", help="also save every reading to this file")
    request_args = commands.add_parser("request", help="ask for a voltage")
    request_args.add_argument("volts", type=float)
    request_args.add_argument("amps", type=float, nargs="?", help="the most on offer if left out")
    request_args.add_argument("--supply", choices=SUPPLIES, default="auto")
    commands.add_parser("load", help="turn the output on or off").add_argument("state", choices=["on", "off"])
    commands.add_parser("epr", help="enter or exit EPR").add_argument("state", choices=["on", "off"])
    commands.add_parser("blackbox", help="saved settings and the last few problems")
    display_args = commands.add_parser("display", help="brightness and dim dots (firmware v1.1)")
    display_args.add_argument("brightness", type=int, help="0 to 43, default 34")
    display_args.add_argument("dim", type=int, nargs="?", default=21, help="3 to 60, default 21")
    display_args.add_argument("--hide-zeros", action="store_true")
    display_args.add_argument("--hide-marks", action="store_true")
    args = parser.parse_args()

    try:
        run(args)
    except (RuntimeError, TimeoutError, ValueError, serial.SerialException) as error:
        sys.exit(str(error))


def run(args):
    with Card(args.port) as card:
        if args.command in (None, "watch"):
            watch(card, getattr(args, "csv", None))
        elif args.command == "request":
            request_and_wait(card, args)
        elif args.command == "load":
            print(card.load(args.state == "on"))
        elif args.command == "epr":
            print(card.epr(args.state == "on"))
        elif args.command == "blackbox":
            box = card.black_box()
            print("Saved: %s, %s, %s" % (volts(box["saved_mv"]), amps(box["saved_ma"]) if box["saved_ma"] else "most on offer", box["saved_supply"]))
            for event in box["events"] or [{"event": "nothing recorded", "uptime_s": 0}]:
                print("  %5ds  %s" % (event["uptime_s"], ", ".join("%s=%s" % item for item in event.items() if item[0] != "uptime_s")))
        elif args.command == "display":
            print(card.display(args.brightness, args.dim, args.hide_zeros, args.hide_marks))


if __name__ == "__main__":
    main()
