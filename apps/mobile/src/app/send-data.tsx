import { Redirect } from 'expo-router';
import type { JSX } from 'react';

import { useAnalyticsSnapshot } from '../analytics/analytics-provider';
import { SendDataScreen } from '../features/send-data/send-data-screen';

/** Send playtest data (slice S6c): closed (Home) while `analytics.upload.enabled` is off, deep link included. */
function SendDataRoute(): JSX.Element {
  const { enabled } = useAnalyticsSnapshot();
  if (!enabled) return <Redirect href="/" />;
  return <SendDataScreen />;
}

// Expo Router route file: the framework requires a default export (ENGINEERING §1).
export default SendDataRoute;
