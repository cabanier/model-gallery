export function createNativeRotation(element) {
  if (!element.entityTransform || !element.boundingBoxCenter || typeof DOMMatrix !== 'function') {
    throw new Error('Native model transforms are unavailable.');
  }
  // Orbit fitting encloses the model at every orientation. Preserve that fit,
  // then leave orbit mode so the entityTransform setter can be used by script.
  const fittedTransform = DOMMatrix.fromMatrix(element.entityTransform);
  const center = element.boundingBoxCenter;
  const initialRect = element.getBoundingClientRect();
  const initialSize = Math.min(initialRect.width, initialRect.height);
  if (initialSize <= 0) throw new Error('The model viewport has no size.');
  let resizeScale = 1;
  element.setAttribute('stagemode', 'none');

  const resizeObserver = new ResizeObserver(([entry]) => {
    resizeScale = Math.min(entry.contentRect.width, entry.contentRect.height) / initialSize;
  });
  resizeObserver.observe(element);

  return {
    update(degrees) {
      if (resizeScale <= 0) return;
      // Post-multiply the fit by a model-space rotation about the bounds center.
      // This preserves the fitted position and uses only uniform scale and rotation.
      element.entityTransform = new DOMMatrix().scale(resizeScale)
        .multiply(fittedTransform)
        .translate(center.x, center.y, center.z)
        .rotate(0, degrees, 0)
        .translate(-center.x, -center.y, -center.z);
    },
    dispose() {
      resizeObserver.disconnect();
    },
  };
}
