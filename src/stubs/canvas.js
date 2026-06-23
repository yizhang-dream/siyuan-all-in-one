// Stub for node-canvas — native C++ addon that cannot load in Electron sandbox.
// PaddleOCR uses it for image preprocessing, but in the browser/Electron renderer
// the native Canvas API is available instead.
module.exports = {};
