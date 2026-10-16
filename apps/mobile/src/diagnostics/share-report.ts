/**
 * Sharing the Diagnostics report (DG1 note DS-7, §6): the S6c TM-04 share and cleanup path, unchanged. The file is
 * created on the tap, written to `<cache>/codelex-share/<uuid>/codelex-diagnostics.json`, handed to the OS share
 * sheet and deleted when the sheet closes; the start-up sweep deletes the whole share directory, so production code
 * never needs this file name. No other write path, no network, no analytics.
 */
import { shareTextFile, type ShareOutcome, type ShareServices } from '../sharing/share-file';
import { REPORT_FILE_NAME } from './report';

export function shareDiagnosticsReport(
  services: ShareServices,
  text: string,
  title: string,
): Promise<ShareOutcome> {
  return shareTextFile(services, {
    name: REPORT_FILE_NAME,
    text,
    mimeType: 'application/json',
    uti: 'public.json',
    title,
  });
}
