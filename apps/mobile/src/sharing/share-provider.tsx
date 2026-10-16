/**
 * React wiring of the share path (slice S6c): the services in a context (tests inject an in-memory double) and the
 * start-up sweep of the share directory (TM-04, DS-7), run right after the first commit. It is not deferred to an
 * idle moment on purpose: a late sweep could delete a file a fast tester (deep link, quick taps) is sharing; the
 * cost is one `exists` check when nothing is left over. The sweep runs whatever the flags: any feature that shares
 * a file relies on it.
 */
import { createContext, useContext, useEffect } from 'react';

import { createDeviceShare } from './device-share';
import { sweepShareDirectory, type ShareServices } from './share-file';

export const ShareContext = createContext<ShareServices>(createDeviceShare());

export function useShare(): ShareServices {
  return useContext(ShareContext);
}

/** Rendered once in the root layout: deletes whatever a previous process left in the share directory. */
export function ShareSweep(): null {
  const { directory } = useShare();
  useEffect(() => {
    sweepShareDirectory(directory);
  }, [directory]);
  return null;
}
