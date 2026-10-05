// Jest stand-in for @shopify/react-native-skia (see jest/setup.cjs). `Canvas` is a host View so the a11y props and
// testID the app sets on it stay queryable; drawing elements render nothing; no system font exists, so `matchFont`
// returns null and the app skips text drawing exactly as it does on a device without the font.
const { createElement } = require('react');
const { View } = require('react-native');

const inert = (name) => {
  const Component = () => null;
  Component.displayName = `Skia${name}`;
  return Component;
};

function Canvas({ children, ...props }) {
  return createElement(View, props, children);
}

module.exports = {
  Canvas,
  Group: ({ children }) => children ?? null,
  Rect: inert('Rect'),
  RoundedRect: inert('RoundedRect'),
  Circle: inert('Circle'),
  Path: inert('Path'),
  Text: inert('Text'),
  DashPathEffect: inert('DashPathEffect'),
  matchFont: () => null,
};
