// One-off: render the app icons from the logo SVG.
import sharp from 'sharp';
const svg = (pad) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${32 + 2 * pad} ${32 + 2 * pad}"><rect x="${-pad}" y="${-pad}" width="${32 + 2 * pad}" height="${32 + 2 * pad}" fill="#0b0f14"/><rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="#22d3ee"/><rect x="7.5" y="7" width="17" height="18" rx="3.2" fill="#0b0f14"/><rect x="7.5" y="15" width="17" height="2.2" fill="#22d3ee"/><rect x="10.5" y="10" width="11" height="3" rx="1.5" fill="#22d3ee" opacity=".35"/><rect x="10.5" y="19.5" width="7" height="3" rx="1.5" fill="#22d3ee" opacity=".35"/></svg>`);
for (const [name, size, pad] of [['icon-192', 192, 2], ['icon-512', 512, 2], ['maskable-512', 512, 9], ['apple-180', 180, 3]]) {
  await sharp(svg(pad), { density: 1200 }).resize(size, size).png().toFile(`public/icons/${name}.png`);
}
console.log('icons ok');
