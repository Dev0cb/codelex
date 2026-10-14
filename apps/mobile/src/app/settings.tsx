import type { JSX } from 'react';

import { APP_VERSION } from '../config/build-info';
import { SettingsScreen } from '../features/settings/settings-screen';
import { useLexicon } from '../lexicon/lexicon-gate';
import { PLAY_RULES_VERSION } from '../match/play-config';

/** Settings route (slice S6a): the build's versions come from the app, the rules constant and the loaded lexicon. */
function SettingsRoute(): JSX.Element {
  const { descriptor } = useLexicon();
  return (
    <SettingsScreen
      versions={{
        app: APP_VERSION,
        rules: PLAY_RULES_VERSION,
        lexicon: descriptor.lexiconVersion,
      }}
    />
  );
}

// Expo Router route file: the framework requires a default export (ENGINEERING §1).
export default SettingsRoute;
