// Jest-only setup (jest.config.js `setupFiles`). Gesture Handler's own mocks (native module, buttons); the Skia
// renderer is replaced by inert host components (no CanvasKit in Jest): the board's drawing data is unit-tested as
// pure data (src/board/board-scene.ts) and the canvas only maps it to Skia elements.
require('react-native-gesture-handler/jestSetup');

jest.mock('@shopify/react-native-skia', () => require('./react-native-skia.cjs'));
