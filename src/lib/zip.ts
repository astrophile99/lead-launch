import { deflateRawSync } from "node:zlib";
import { AppError } from "@/lib/errors";

/**
 * A minimal ZIP writer.
 *
 * Hand-rolled rather than pulled from npm because the format's writing side is
 * small and completely specified, and because every archive library that has
 * ever had a CVE had it in the *reading* side — which this does not have. We
 * only ever produce archives; we never extract one.
 *
 * The security that matters here is the entry name. A ZIP stores whatever
 * string it likes as a path, and a consumer that joins that string onto a
 * directory without checking is the "zip slip" bug. We refuse to write a name
 * that would be dangerous to extract, so an archive from this app cannot be the
 * vector even if the person unzipping it is careless:
 *
 *   - no absolute paths, no drive letters
 *   - no `..` segment anywhere
 *   - no backslashes (a Windows separator smuggled through a POSIX check)
 *   - no NUL, no control characters, no trailing dots or spaces
 *   - no reserved Windows device names (CON, NUL, COM1 …)
 */

const RESERVED_WINDOWS = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

export function assertSafeArchivePath(name: string): string {
  const reject = (why: string): never => {
    throw new AppError({
      kind: "invalid-input",
      message: `Refusing to add "${name}" to the archive: ${why}.`,
      remedy: "This is a bug in the generator — report the file path.",
    });
  };

  if (!name || name.length > 200) reject("the path is empty or unreasonably long");
  // Written as a code-point scan rather than a regex character class: a class
  // spanning C0 is easy to mangle when this file is edited, and a mangled one
  // fails open.
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) reject("it contains control characters");
  }
  if (name.includes("\\")) reject("backslashes are not valid archive separators");
  if (name.startsWith("/")) reject("it is an absolute path");
  if (/^[a-zA-Z]:/.test(name)) reject("it carries a drive letter");

  const segments = name.split("/");
  for (const seg of segments) {
    if (!seg) reject("it has an empty path segment");
    if (seg === "." || seg === "..") reject("it walks outside the archive root");
    if (seg.endsWith(".") || seg.endsWith(" ")) {
      reject("a segment ends with a dot or space, which Windows silently strips");
    }
    if (RESERVED_WINDOWS.has(seg.split(".")[0].toLowerCase())) {
      reject(`"${seg}" is a reserved device name on Windows`);
    }
  }
  return name;
}

export type ZipEntry = { path: string; content: Buffer | string };

/* ------------------------------------------------------------------- CRC-32 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** MS-DOS date/time, which is what the format stores. */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Builds a complete ZIP in memory.
 *
 * Generated sites are a handful of text files, so buffering is fine and
 * streaming would be more machinery than the job needs. If a build ever
 * produces tens of megabytes this becomes a stream; the signature would not
 * change.
 */
export function createZip(entries: ZipEntry[], at: Date = new Date()): Buffer {
  const { time, date } = dosStamp(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    const name = assertSafeArchivePath(entry.path);
    if (seen.has(name)) {
      throw new AppError({
        kind: "invalid-input",
        message: `The archive would contain "${name}" twice.`,
        remedy: "This is a bug in the generator — report the duplicated path.",
      });
    }
    seen.add(name);

    const raw = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const crc = crc32(raw);
    const deflated = deflateRawSync(raw, { level: 9 });
    // Deflate can be larger than the input for tiny or already-dense files.
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const method = stored ? 0 : 8;
    const nameBuf = Buffer.from(name, "utf8");

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0o100644 << 16, 38); // external attrs: rw-r--r--
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
}

/** Strips anything that would be awkward in a download filename. */
export function safeFilename(name: string, fallback = "website"): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}
