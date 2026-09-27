// WebGL reads rows from the bottom upwards. A lens forms a 180-degree rotated
// image on the sensor, while a finished photograph is displayed upright.
export function orientPixels(readback, width, height, inverted = false, grayscale = false) {
  if (readback.length !== width * height * 4) throw new RangeError('Invalid framebuffer dimensions');
  const result = new Uint8ClampedArray(readback.length);
  for (let y = 0; y < height; y++) {
    const sourceY = inverted ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sourceX = inverted ? width - 1 - x : x;
      const src = (sourceY * width + sourceX) * 4;
      const dst = (y * width + x) * 4;
      if (grayscale) {
        const luminance = Math.round(.2126 * readback[src] + .7152 * readback[src + 1] + .0722 * readback[src + 2]);
        result[dst] = result[dst + 1] = result[dst + 2] = luminance;
      } else {
        result[dst] = readback[src];
        result[dst + 1] = readback[src + 1];
        result[dst + 2] = readback[src + 2];
      }
      result[dst + 3] = 255;
    }
  }
  return result;
}
