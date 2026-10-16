import { useState, type JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useFlag } from '../../config/flags-provider';
import { resolveExportAddress } from '../../config/export-address';
import { useI18n } from '../../i18n/i18n-provider';
import { useMatchLogAccess, type MatchLogAccess } from '../../match-log/match-log-access';
import { MATCH_LOG_FILE_NAME, type MatchLogScope } from '../../match-log/match-log-file';
import { shareTextFile } from '../../sharing/share-file';
import { useShare } from '../../sharing/share-provider';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';
import { Sheet } from '../../ui/sheet';

const SCOPE_KEY = {
  current: 'matchlog.scope.current',
  last: 'matchlog.scope.last',
} as const satisfies Record<MatchLogScope, string>;

/** The sheet's request: the match found on the tap (null = nothing to export). */
interface Request {
  readonly scope: MatchLogScope | null;
}

export interface SendMatchLog {
  /** `playtest.match_log.enabled` is on and the app has saved matches to read: render the entry points. */
  readonly available: boolean;
  /** Opens the confirm sheet (reads which match exists; no file content is read until Share). */
  readonly open: () => void;
  /** The sheet, rendered once by the screen that hosts an entry point; null when unavailable. */
  readonly sheet: JSX.Element | null;
}

/**
 * "Send match log" (E-1.5 AC-20, design §5.8 and §5.10.2; slice S6d, behind `playtest.match_log.enabled`). Works
 * with analytics consent off: it is a user-initiated bug report, not telemetry (TM-05). Nothing is read on mount
 * (TM-02 E-1): only a tap opens the sheet, and only Share reads the match file.
 */
export function useSendMatchLog(): SendMatchLog {
  const enabled = useFlag('playtest.match_log.enabled');
  const access = useMatchLogAccess();
  const [request, setRequest] = useState<Request | null>(null);
  if (!enabled || access === null) return { available: false, open: () => undefined, sheet: null };
  return {
    available: true,
    open: () => {
      setRequest({ scope: access.find() });
    },
    sheet: (
      <MatchLogSheet
        access={access}
        request={request}
        onClose={() => {
          setRequest(null);
        }}
      />
    ),
  };
}

type Status = 'idle' | 'sharing' | 'file_error' | 'share_error';

/**
 * The confirm sheet (TM-05): `matchlog.confirm.body` with the scope ("No personal data in the file"), then
 * `matchlog.email_notice` (email reveals the sender) and, only if a TM-07 address is configured, "Send it to". Share
 * builds the file from the allowlist (`match-log-file.ts`) and hands it to the one share path (`share-file.ts`: cache
 * directory, scoped URI, deleted when the OS sheet closes). With nothing saved: `matchlog.empty` and Close.
 */
function MatchLogSheet({
  access,
  request,
  onClose,
}: {
  readonly access: MatchLogAccess;
  readonly request: Request | null;
  readonly onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  const share = useShare();
  const [status, setStatus] = useState<Status>('idle');
  const scope = request?.scope ?? null;
  // TM-07: a build constant from the bundled allowlist; no remote config in Phase 1 (hidden while none is set).
  const address = resolveExportAddress(undefined);
  const busy = status === 'sharing';

  const close = (): void => {
    if (busy) return;
    setStatus('idle');
    onClose();
  };

  const onShare = async (): Promise<void> => {
    if (scope === null || busy) return;
    const built = access.build(scope);
    if (!built.ok) {
      setStatus('file_error');
      return;
    }
    setStatus('sharing');
    const outcome = await shareTextFile(share, {
      name: MATCH_LOG_FILE_NAME,
      text: built.value,
      mimeType: 'application/json',
      uti: 'public.json',
      title: t('settings.send_match_log'),
    });
    if (outcome === 'closed') {
      setStatus('idle');
      onClose();
      return;
    }
    setStatus(outcome === 'file_error' ? 'file_error' : 'share_error');
  };

  const text = (value: string, testID: string, muted = false): JSX.Element => (
    <Text
      testID={testID}
      style={[type.body, { color: muted ? color.textMuted : color.textPrimary }]}
    >
      {value}
    </Text>
  );

  return (
    <Sheet
      visible={request !== null}
      title={t('matchlog.confirm.title')}
      onClose={close}
      testID="matchlog.sheet"
    >
      {scope === null ? (
        <>
          {text(t('matchlog.empty'), 'matchlog.empty', true)}
          <View style={[styles.actions, { gap: space[3] }]}>
            <Button testID="matchlog.close" label={t('common.close')} onPress={close} />
          </View>
        </>
      ) : (
        <>
          {text(
            t('matchlog.confirm.body', { scope: t(SCOPE_KEY[scope]) }),
            'matchlog.confirm.body',
            true,
          )}
          {text(t('matchlog.email_notice'), 'matchlog.emailNotice', true)}
          {address !== null && (
            <Text
              testID="matchlog.recipient"
              selectable
              style={[type.body, { color: color.textPrimary }]}
            >
              {t('export.recipient', { address })}
            </Text>
          )}
          <View accessibilityLiveRegion="polite">
            {(status === 'file_error' || status === 'share_error') && (
              <Text testID="matchlog.error" style={[type.body, { color: color.feedbackError }]}>
                {t(status === 'file_error' ? 'export.error.file' : 'export.error.share')}
              </Text>
            )}
          </View>
          <View style={[styles.actions, { gap: space[3] }]}>
            <Button
              testID="matchlog.cancel"
              label={t('common.cancel')}
              disabled={busy}
              onPress={close}
            />
            <View style={styles.spacer} />
            <Button
              testID="matchlog.share"
              variant="primary"
              label={status === 'idle' || busy ? t('matchlog.share') : t('common.retry')}
              disabled={busy}
              onPress={() => {
                void onShare();
              }}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  spacer: { flex: 1 },
});
