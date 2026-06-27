import sharp from "sharp";
import { readFileSync } from "node:fs";

const [, , input, output] = process.argv;
const svg = readFileSync(input);

await sharp(svg, { density: 512 })
  .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(output);

console.log("wrote", output);
