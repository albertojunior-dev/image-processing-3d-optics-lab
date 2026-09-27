// All distances below use the same 3D scene unit. The thin-lens approximation
// is valid for the paraxial rays drawn in this educational simulation.
export function imageDistance(focal, objectDistance) {
  if (!(focal > 0) || !(objectDistance > focal)) throw new RangeError('O objeto deve estar além do foco de uma lente convergente.');
  return (focal * objectDistance) / (objectDistance - focal);
}

export function imagePoint(objectPoint, lensCenter, focal) {
  const u = objectPoint.x - lensCenter.x;
  const v = imageDistance(focal, u);
  const m = -v / u;
  return {
    x: lensCenter.x - v,
    y: lensCenter.y + m * (objectPoint.y - lensCenter.y),
    z: lensCenter.z + m * (objectPoint.z - lensCenter.z),
  };
}

export function rayThroughAperture(objectPoint, lensCenter, focal, apertureY, apertureZ) {
  return {
    from: objectPoint,
    through: { x: lensCenter.x, y: lensCenter.y + apertureY, z: lensCenter.z + apertureZ },
    to: imagePoint(objectPoint, lensCenter, focal),
  };
}
