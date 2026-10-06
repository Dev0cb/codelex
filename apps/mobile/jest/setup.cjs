// Jest-only setup (jest.config.js `setupFiles`). Gesture Handler's own mocks (native module, buttons); the Skia
// renderer is replaced by inert host components (no CanvasKit in Jest): the board's drawing data is unit-tested as
// pure data (src/board/board-scene.ts) and the canvas only maps it to Skia elements.
require('react-native-gesture-handler/jestSetup');

jest.mock('@shopify/react-native-skia', () => require('./react-native-skia.cjs'));

// React Native's Jest preset reports a system font scale of 2. Tests start from the default text size (1); tests of
// large text (E-1.5 D-20) set their own scale with `Dimensions.set`.
const { Dimensions } = require('react-native');
Dimensions.set({
  window: { ...Dimensions.get('window'), fontScale: 1 },
  screen: { ...Dimensions.get('screen'), fontScale: 1 },
});
