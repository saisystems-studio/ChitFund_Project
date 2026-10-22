// Measure the available viewport, never the content-sized modal itself.
export const previewBox = (width, height, headerHeight, padding) => ({
  w: Math.max(1, width * .95 - padding * 2),
  h: Math.max(1, height * .95 - headerHeight - padding * 2),
});
export const previewWidth = (documentWidth, scale, viewportWidth, padding) =>
  Math.min(Math.floor(documentWidth * scale) + padding * 2, viewportWidth * .95);
