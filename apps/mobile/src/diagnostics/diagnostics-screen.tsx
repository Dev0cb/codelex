/**
 * The Diagnostics screen (DG1 note §5–§8): suites 1–5 with progress and Cancel, the build check, the owner's RAM
 * and phone-class choice (the A2 device block needs both; neither is readable without a new native dependency) and
 * "Share report…" through the TM-04 path. Developer surface, preview-diagnostics builds only.
 *
 * Accessibility (note §8): ≥ 48 dp targets, every control labelled from the local catalog, pass/fail as text and an
 * icon (never colour alone), progress as a polite live region updated per suite, completion announced, scrolls at
 * 200 % text, no animation beyond the system spinner.
 */
import { GOLDEN_RUNNER_MARKER, type GoldenCorpus } from '@codelex/golden-runner/core';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useI18n } from '../i18n/i18n-provider';
import type { ShareOutcome, ShareServices } from '../sharing/share-file';
import { useTokens } from '../theme/use-tokens';
import { Button } from '../ui/button';
import type { DeviceFields } from './device-info';
import { RUN_ALL_ORDER, SUITE_ORDER, type SuiteId } from './jobs/job';
import { diagnosticsTranslator, type DiagnosticsKey } from './messages/catalog';
import {
  buildDiagnosticsReport,
  DEVICE_CLASSES,
  RAM_CLASSES,
  serializeReport,
  type DeviceClass,
  type RamClass,
} from './report';
import { shareDiagnosticsReport } from './share-report';
import { useDiagnosticsRun, type DiagnosticsDeps, type SuiteResults } from './use-diagnostics';

const SUITE_LABEL = {
  goldens: 'diagnostics.suite.goldens',
  micro: 'diagnostics.suite.micro',
  bots: 'diagnostics.suite.bots',
  resume: 'diagnostics.suite.resume',
  drift: 'diagnostics.suite.drift',
} as const satisfies Record<SuiteId, DiagnosticsKey>;

const RAM_LABEL = {
  'le-2gb': 'diagnostics.ram.le_2gb',
  '3gb': 'diagnostics.ram.3gb',
  '4gb': 'diagnostics.ram.4gb',
  '6gb': 'diagnostics.ram.6gb',
  '8gb': 'diagnostics.ram.8gb',
  'ge-12gb': 'diagnostics.ram.ge_12gb',
} as const satisfies Record<RamClass, DiagnosticsKey>;

const CLASS_LABEL = {
  'owner-device': 'diagnostics.device_class.owner',
  'reference-class': 'diagnostics.device_class.reference',
} as const satisfies Record<DeviceClass, DiagnosticsKey>;

const GLYPH = { pass: '✓', fail: '✗', none: '–' } as const;

type SuiteStatus = 'pass' | 'fail' | 'none';

/** Pass/fail per suite: the goldens by the runner verdict, the benches by whether they measured. */
export function suiteStatus(suite: SuiteId, results: SuiteResults): SuiteStatus {
  switch (suite) {
    case 'goldens':
      return results.goldens === undefined
        ? 'none'
        : results.goldens.verdict === 'pass'
          ? 'pass'
          : 'fail';
    case 'micro':
      return results.micro === undefined
        ? 'none'
        : results.micro.kind === 'measured' &&
            results.micro.has !== null &&
            results.micro.apply !== null
          ? 'pass'
          : 'fail';
    case 'bots':
    case 'resume':
    case 'drift': {
      const result = results[suite];
      return result === undefined ? 'none' : result.kind === 'measured' ? 'pass' : 'fail';
    }
  }
}

type Translate = ReturnType<typeof diagnosticsTranslator>;

/**
 * What the A2 report cannot carry, for the H1 record: the `has()` reading is a batch mean (review C-3), the
 * snapshot + tail restore path next to the full replay in the report (C-M2), and the two-blank constants fit (C-6).
 */
export function suiteDetail(suite: SuiteId, results: SuiteResults, t: Translate): string | null {
  switch (suite) {
    case 'micro': {
      const micro = results.micro;
      if (micro?.kind !== 'measured' || micro.has === null || micro.apply === null) return null;
      return t('diagnostics.detail.micro', { has: micro.has.p99, apply: micro.apply.p95 });
    }
    case 'resume': {
      const resume = results.resume;
      if (resume?.kind !== 'measured') return null;
      return t('diagnostics.detail.resume', {
        full: resume.fullReplay.p95,
        tail: resume.snapshotTail.p95,
      });
    }
    case 'bots': {
      const bots = results.bots;
      if (bots?.kind !== 'measured') return null;
      const fit = bots.constants.twoBlanks;
      return fit === null
        ? t('diagnostics.detail.fit_two_blanks_none')
        : t('diagnostics.detail.fit_two_blanks', {
            tFixed: fit.tFixedUs,
            cNode: fit.cNodeNs,
            cCand: fit.cCandNs,
          });
    }
    case 'goldens':
    case 'drift':
      return null;
  }
}

export interface DiagnosticsScreenProps {
  readonly deps: DiagnosticsDeps;
  readonly corpus: GoldenCorpus;
  readonly device: DeviceFields | null;
  readonly appVersion: string;
  readonly gitSha: string | null;
  readonly share: ShareServices;
  readonly onClose: () => void;
}

export function DiagnosticsScreen({
  deps,
  corpus,
  device,
  appVersion,
  gitSha,
  share,
  onClose,
}: DiagnosticsScreenProps): JSX.Element {
  const i18n = useI18n();
  const t = useMemo(() => diagnosticsTranslator(i18n.locale), [i18n.locale]);
  const { color, layout, radius, space, type } = useTokens();
  const { state, start, cancel } = useDiagnosticsRun(deps);
  const [ram, setRam] = useState<RamClass | null>(null);
  const [deviceClass, setDeviceClass] = useState<DeviceClass | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'busy' | ShareOutcome>('idle');
  const { runtime } = deps;
  const running = state.phase === 'running';

  // Completion is announced once per finished run (note §8).
  const announced = useRef(state.phase);
  useEffect(() => {
    if (state.phase === 'done' && announced.current !== 'done') {
      const verdict = SUITE_ORDER.some((s) => suiteStatus(s, state.results) === 'fail')
        ? t('diagnostics.status.fail')
        : t('diagnostics.status.pass');
      AccessibilityInfo.announceForAccessibility(t('diagnostics.a11y.done', { verdict }));
    }
    announced.current = state.phase;
  }, [state.phase, state.results, t]);

  const runner = state.results.goldens;
  const canShare =
    !running &&
    runner !== undefined &&
    ram !== null &&
    deviceClass !== null &&
    gitSha !== null &&
    device !== null &&
    shareStatus !== 'busy';

  const onShare = (): void => {
    if (runner === undefined || ram === null || deviceClass === null) return;
    if (gitSha === null || device === null) return;
    const text = serializeReport(
      buildDiagnosticsReport({
        appVersion,
        gitSha,
        device,
        ramClass: ram,
        deviceClass,
        releaseHermes: runtime.releaseHermes,
        corpus,
        results: { ...state.results, runner },
      }),
    );
    if (text === null) {
      setShareStatus('file_error');
      return;
    }
    setShareStatus('busy');
    void shareDiagnosticsReport(share, text, t('diagnostics.share')).then(setShareStatus);
  };

  const notice = (key: DiagnosticsKey | null, tone: string, testID: string): JSX.Element | null =>
    key === null ? null : (
      <Text testID={testID} style={[type.body, { color: tone }]}>
        {t(key)}
      </Text>
    );

  const chips = <T extends string>(
    title: string,
    values: readonly T[],
    labels: Record<T, DiagnosticsKey>,
    selected: T | null,
    select: (value: T) => void,
    testID: string,
  ): JSX.Element => (
    <View style={{ gap: space[2] }}>
      <Text accessibilityRole="header" style={[type.body, { color: color.textPrimary }]}>
        {title}
      </Text>
      <View accessibilityRole="radiogroup" style={[styles.wrap, { gap: space[2] }]}>
        {values.map((value) => {
          const on = selected === value;
          return (
            <Pressable
              key={value}
              testID={`${testID}.${value}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: running }}
              disabled={running}
              onPress={() => {
                select(value);
              }}
              style={[
                styles.centre,
                {
                  minHeight: layout.touchMin,
                  minWidth: layout.touchMin,
                  paddingHorizontal: space[4],
                  borderRadius: radius.button,
                  borderWidth: 1,
                  borderColor: on ? color.accentPrimary : color.borderSubtle,
                  backgroundColor: on ? color.accentPrimary : color.bgRaised,
                },
              ]}
            >
              <Text style={[type.body, { color: on ? color.accentOnPrimary : color.textPrimary }]}>
                {t(labels[value])}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const ended: DiagnosticsKey | null =
    state.phase === 'cancelled'
      ? 'diagnostics.cancelled'
      : state.phase === 'interrupted'
        ? 'diagnostics.interrupted'
        : state.phase === 'failed'
          ? 'diagnostics.failed'
          : null;

  return (
    <View style={[styles.root, { backgroundColor: color.bgBase }]}>
      <View style={[styles.bar, { padding: space[3], gap: space[2] }]}>
        <Text
          accessibilityRole="header"
          style={[type.title, styles.grow, { color: color.textPrimary }]}
        >
          {t('diagnostics.title')}
        </Text>
        <Button
          testID="diagnostics.close"
          label={i18n.t('common.close')}
          onPress={() => {
            cancel();
            onClose();
          }}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: layout.marginScreen, gap: space[5] }}>
        <Text style={[type.body, { color: color.textPrimary }]}>{t('diagnostics.intro')}</Text>
        <Text style={[type.body, { color: color.textMuted }]}>{t('diagnostics.keep_on')}</Text>
        <Text
          testID="diagnostics.build"
          style={[
            type.body,
            { color: runtime.releaseHermes ? color.textPrimary : color.feedbackWarning },
          ]}
        >
          {runtime.releaseHermes
            ? t('diagnostics.build.ok', {
                version: runtime.hermesVersion ?? t('diagnostics.build.hermes_unknown'),
              })
            : t('diagnostics.build.invalid')}
        </Text>
        {notice(
          gitSha === null ? 'diagnostics.build.no_commit' : null,
          color.feedbackWarning,
          'diagnostics.noCommit',
        )}
        <View style={{ gap: space[3] }}>
          {SUITE_ORDER.map((suite) => {
            const status = suiteStatus(suite, state.results);
            const detail = suiteDetail(suite, state.results, t);
            const label =
              status === 'pass'
                ? t('diagnostics.status.pass')
                : status === 'fail'
                  ? t('diagnostics.status.fail')
                  : t('diagnostics.status.not_run');
            return (
              <View
                key={suite}
                testID={suite === 'goldens' ? GOLDEN_RUNNER_MARKER : `diagnostics.suite.${suite}`}
                style={[styles.row, { gap: space[3], minHeight: layout.touchMin }]}
              >
                <View style={styles.grow}>
                  <Text style={[type.body, { color: color.textPrimary }]}>
                    {t(SUITE_LABEL[suite])}
                  </Text>
                  <Text
                    testID={`diagnostics.status.${suite}`}
                    style={[
                      type.caption,
                      { color: status === 'fail' ? color.feedbackError : color.textMuted },
                    ]}
                  >
                    {`${GLYPH[status]} ${label}`}
                  </Text>
                  {detail === null ? null : (
                    <Text
                      testID={`diagnostics.detail.${suite}`}
                      style={[type.caption, { color: color.textMuted }]}
                    >
                      {detail}
                    </Text>
                  )}
                </View>
                <Button
                  testID={`diagnostics.run.${suite}`}
                  label={t('diagnostics.run')}
                  accessibilityLabel={`${t('diagnostics.run')}, ${t(SUITE_LABEL[suite])}`}
                  disabled={running}
                  onPress={() => {
                    setShareStatus('idle');
                    start([suite]);
                  }}
                />
              </View>
            );
          })}
        </View>
        {running ? (
          <View style={[styles.row, { gap: space[3] }]}>
            <ActivityIndicator color={color.accentPrimary} />
            <Text
              testID="diagnostics.progress"
              accessibilityLiveRegion="polite"
              style={[type.body, styles.grow, { color: color.textPrimary }]}
            >
              {state.suite === null
                ? ''
                : `${t(SUITE_LABEL[state.suite])} · ${t('diagnostics.progress', {
                    done: state.progress?.done ?? 0,
                    total: state.progress?.total ?? 0,
                  })}`}
            </Text>
            <Button
              testID="diagnostics.cancel"
              variant="destructive"
              label={i18n.t('common.cancel')}
              onPress={cancel}
            />
          </View>
        ) : (
          <Button
            testID="diagnostics.runAll"
            variant="primary"
            label={t('diagnostics.run_all')}
            onPress={() => {
              setShareStatus('idle');
              start(RUN_ALL_ORDER);
            }}
          />
        )}
        {notice(ended, color.feedbackWarning, 'diagnostics.ended')}
        {chips(t('diagnostics.ram'), RAM_CLASSES, RAM_LABEL, ram, setRam, 'diagnostics.ram')}
        {chips(
          t('diagnostics.device_class'),
          DEVICE_CLASSES,
          CLASS_LABEL,
          deviceClass,
          setDeviceClass,
          'diagnostics.class',
        )}
        <Text style={[type.caption, { color: color.textMuted }]}>
          {t('diagnostics.share.notice')}
        </Text>
        {canShare ? null : (
          <Text testID="diagnostics.share.needs" style={[type.caption, { color: color.textMuted }]}>
            {t('diagnostics.share.needs')}
          </Text>
        )}
        <Button
          testID="diagnostics.share"
          variant="primary"
          label={t('diagnostics.share')}
          disabled={!canShare}
          busy={shareStatus === 'busy'}
          onPress={onShare}
        />
        {shareStatus === 'file_error' || shareStatus === 'share_error' ? (
          <Text
            testID="diagnostics.share.error"
            accessibilityLiveRegion="polite"
            style={[type.body, { color: color.feedbackError }]}
          >
            {i18n.t(shareStatus === 'file_error' ? 'export.error.file' : 'export.error.share')}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
