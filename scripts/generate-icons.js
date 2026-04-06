const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
const assetsDir = path.join(__dirname, '..', 'assets');

const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function createIco(pngBuffers) {
  // ICO format: header (6 bytes) + directory entries (16 bytes each) + image data
  const numImages = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * numImages;
  let dataOffset = headerSize + dirSize;

  // Header: reserved(2) + type(2, 1=ico) + count(2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type = ICO
  header.writeUInt16LE(numImages, 4);

  const dirEntries = [];
  const offsets = [];
  for (const buf of pngBuffers) {
    offsets.push(dataOffset);
    dataOffset += buf.length;
  }

  for (let i = 0; i < numImages; i++) {
    const entry = Buffer.alloc(16);
    const size = icoSizes[i];
    entry.writeUInt8(size >= 256 ? 0 : size, 0);  // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);  // height
    entry.writeUInt8(0, 2);   // color palette
    entry.writeUInt8(0, 3);   // reserved
    entry.writeUInt16LE(1, 4);  // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(pngBuffers[i].length, 8);  // image size
    entry.writeUInt32LE(offsets[i], 12);  // offset
    dirEntries.push(entry);
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers]);
}

// Generate an SVG with adjusted gap width for small sizes
function createSvgWithGap(gap, centerPad) {
  const mid = 256; // center of 512 viewBox
  const halfGap = gap / 2;
  const lo = mid - halfGap; // left/top edge of gap (replaces 253)
  const hi = mid + halfGap; // right/bottom edge of gap (replaces 259)
  const notchIn = lo - 103 + (gap - 6) * 0.5; // inner notch (replaces 150)
  const notchOut = hi + 103 - (gap - 6) * 0.5; // outer notch (replaces 362)
  const cLo = mid - 86 - centerPad; // center rect left (replaces 170)
  const cHi = mid + 86 + centerPad; // center rect right (replaces 342)
  const cSize = cHi - cLo;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <clipPath id="rounded">
      <rect x="20" y="20" width="472" height="472" rx="64" ry="64"/>
    </clipPath>
  </defs>
  <rect x="20" y="20" width="472" height="472" rx="64" ry="64" fill="white"/>
  <g clip-path="url(#rounded)">
    <path d="M20,20 L${lo},20 L${lo},${notchIn} L${notchIn},${notchIn} L${notchIn},${lo} L20,${lo} Z" fill="#D97757"/>
    <path d="M${hi},20 L492,20 L492,${lo} L${notchOut},${lo} L${notchOut},${notchIn} L${hi},${notchIn} Z" fill="#D97757"/>
    <path d="M20,${hi} L${notchIn},${hi} L${notchIn},${notchOut} L${lo},${notchOut} L${lo},492 L20,492 Z" fill="#D97757"/>
    <path d="M${notchOut},${hi} L492,${hi} L492,492 L${hi},492 L${hi},${notchOut} L${notchOut},${notchOut} Z" fill="#D97757"/>
    <rect x="${cLo}" y="${cLo}" width="${cSize}" height="${cSize}" fill="#5A2E1A"/>
  </g>
</svg>`;
}

async function generate() {
  const svgBuffer = fs.readFileSync(svgPath);
  const icoPngBuffers = [];

  for (const size of sizes) {
    let srcBuffer = svgBuffer;

    // For small sizes, widen the white borders so they remain visible
    if (size <= 24) {
      srcBuffer = Buffer.from(createSvgWithGap(30, 8));
    } else if (size <= 48) {
      srcBuffer = Buffer.from(createSvgWithGap(18, 4));
    } else if (size <= 64) {
      srcBuffer = Buffer.from(createSvgWithGap(12, 2));
    }

    const pngBuffer = await sharp(srcBuffer)
      .resize(size, size)
      .png()
      .toBuffer();

    const outPath = path.join(assetsDir, `icon-${size}.png`);
    fs.writeFileSync(outPath, pngBuffer);
    console.log(`Generated ${outPath} ${srcBuffer !== svgBuffer ? '(wide borders)' : ''}`);

    if (icoSizes.includes(size)) {
      icoPngBuffers.push(pngBuffer);
    }
  }

  // Generate ICO
  const icoBuffer = createIco(icoPngBuffers);
  const icoPath = path.join(assetsDir, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuffer);
  console.log(`Generated ${icoPath}`);

  console.log('\nDone! All icons generated.');
}

generate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
