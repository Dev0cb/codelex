/**
 * The match's bottom sheets (E-1.5 §5.5.1, §5.5.4, §5.5.6, §5.5.8): Exchange, score breakdown, move log, board
 * legend, match menu and the Pass / Resign confirmations. Presentation only: every number shown comes from the
 * engine (breakdowns, layout data) and every action goes back through `reduceMatch`.
 */
import type { Layout, LetterTable, SquareKind } from '@codelex/game-engine';
import type { MessageKey } from '@codelex/i18n';
import { useState, type JSX } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../../i18n/i18n-provider';
import { breakdownLines } from '../../match/breakdown';
import type { MoveEntry, RackSlot } from '../../match/match-model';
import { HUMAN_SEAT } from '../../match/play-config';
import type { Names } from '../../match/status';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';
import { Sheet } from '../../ui/sheet';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
/** D-30: the blank shows `_` (a code glyph, not copy). */
const BLANK_GLYPH = '_';
const CODE_A = 65;

function Actions({ children }: { readonly children: readonly JSX.Element[] }): JSX.Element {
  const { space } = useTokens();
  return <View style={[styles.actions, { gap: space[3] }]}>{children}</View>;
}

/** Pass or Resign: one confirmation (AC-7, AC-10). */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  testID,
  onConfirm,
  onCancel,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly destructive?: boolean;
  readonly testID: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const { color, type } = useTokens();
  return (
    <Sheet visible={visible} title={title} onClose={onCancel}>
      <Text style={[type.body, { color: color.textMuted }]}>{body}</Text>
      <Actions>
        <Button testID={`${testID}.cancel`} label={cancelLabel} onPress={onCancel} />
        <View style={styles.spacer} />
        <Button
          testID={`${testID}.confirm`}
          variant={destructive ? 'destructive' : 'primary'}
          label={confirmLabel}
          onPress={onConfirm}
        />
      </Actions>
    </Sheet>
  );
}

/** §5.5.6 Exchange: multi-select 1–7 rack tiles; the confirm names the count; uses the turn, scores 0. */
export function ExchangeSheet({
  visible,
  slots,
  letters,
  onConfirm,
  onCancel,
}: {
  readonly visible: boolean;
  readonly slots: readonly RackSlot[];
  readonly letters: LetterTable;
  readonly onConfirm: (slotIds: readonly number[]) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { board, color, layout, radius, space, type } = useTokens();
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const close = (): void => {
    setChosen(new Set());
    onCancel();
  };
  return (
    <Sheet visible={visible} title={t('match.exchange.title')} onClose={close}>
      <Text style={[type.body, { color: color.textMuted }]}>{t('match.exchange.body')}</Text>
      <Text style={[type.bodyS, { color: color.textMuted }]}>
        {t('match.exchange.select_hint')}
      </Text>
      <View style={[styles.tiles, { gap: layout.rackGap }]}>
        {slots.map((slot, index) => {
          const isBlank = slot.tile === '?';
          const value = isBlank ? 0 : (letters.values[slot.tile.charCodeAt(0) - CODE_A] ?? 0);
          const selected = chosen.has(slot.id);
          return (
            <Pressable
              key={slot.id}
              testID={`match.exchange.tile.${String(index)}`}
              accessibilityRole="checkbox"
              accessibilityLabel={
                isBlank
                  ? t('a11y.tile.blank_rack')
                  : t('a11y.tile.letter', { letter: slot.tile, points: value })
              }
              accessibilityState={{ checked: selected, selected }}
              onPress={() => {
                const next = new Set(chosen);
                if (selected) next.delete(slot.id);
                else next.add(slot.id);
                setChosen(next);
              }}
              style={[
                styles.tile,
                {
                  width: layout.tileRackWidth,
                  height: layout.tileRackHeight,
                  borderRadius: radius.tile,
                  backgroundColor: board.tileFace,
                  // Selected = thick accent border and a lift (never colour alone).
                  borderColor: selected ? color.accentPrimary : board.tileBlankOutline,
                  borderWidth: selected ? 3 : 1,
                  transform: [{ translateY: selected ? -space[2] : 0 }],
                },
              ]}
            >
              <Text maxFontSizeMultiplier={1.3} style={[styles.letter, { color: board.tileInk }]}>
                {isBlank ? BLANK_GLYPH : slot.tile}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Actions>
        <Button testID="match.exchange.cancel" label={t('common.cancel')} onPress={close} />
        <View style={styles.spacer} />
        <Button
          testID="match.exchange.confirm"
          variant="primary"
          disabled={chosen.size === 0}
          label={t('match.exchange.confirm', { count: chosen.size })}
          onPress={() => {
            const ids = slots.filter((s) => chosen.has(s.id)).map((s) => s.id);
            setChosen(new Set());
            onConfirm(ids);
          }}
        />
      </Actions>
    </Sheet>
  );
}

/** §5.5.4: the engine's breakdown verbatim, in R-SCORE-008 order. */
export function BreakdownSheet({
  entry,
  names,
  onClose,
}: {
  readonly entry: Extract<MoveEntry, { kind: 'word' }> | null;
  readonly names: Names;
  readonly onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  const lines = entry === null ? [] : breakdownLines(entry.breakdown, entry.chainFrom);
  return (
    <Sheet
      visible={entry !== null}
      title={t('match.breakdown.title')}
      onClose={onClose}
      testID="match.breakdown.sheet"
    >
      {entry !== null && (
        <Text style={[type.body, { color: color.textMuted }]}>
          {entry.seat === HUMAN_SEAT
            ? t('match.breakdown.you_scored', { points: entry.points })
            : t('match.breakdown.bot_scored', { bot: names.bot, points: entry.points })}
        </Text>
      )}
      <View style={{ gap: space[2] }}>
        {lines.map((line, i) => (
          <Text
            key={i}
            testID={line.kind === 'total' ? 'match.breakdown.total' : undefined}
            style={[
              line.kind === 'detail' ? type.bodyS : type.body,
              line.kind === 'detail' && { paddingStart: space[4] },
              (line.kind === 'word' || line.kind === 'total') && styles.strong,
              styles.mono,
              { color: line.kind === 'detail' ? color.textMuted : color.textPrimary },
            ]}
          >
            {t(line.notice.key, {
              ...line.notice.params,
              ...(line.difficultyKey === undefined ? {} : { difficulty: t(line.difficultyKey) }),
            })}
          </Text>
        ))}
      </View>
      <Button label={t('common.close')} onPress={onClose} />
    </Sheet>
  );
}

/** §5.5.1 move log, newest first; exchanged tiles are counted, never named; rejected attempts are not logged. */
export function MoveLogSheet({
  visible,
  log,
  names,
  onClose,
}: {
  readonly visible: boolean;
  readonly log: readonly MoveEntry[];
  readonly names: Names;
  readonly onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  const line = (entry: MoveEntry): string => {
    const actor = entry.seat === HUMAN_SEAT ? names.you : names.bot;
    switch (entry.kind) {
      case 'word':
        return t('match.log.entry.word', { actor, form: entry.form, points: entry.points });
      case 'pass':
        return t('match.log.entry.pass', { actor });
      case 'exchange':
        return t('match.log.entry.exchange', { actor, count: entry.count });
      case 'resign':
        return t('match.log.entry.resign', { actor });
    }
  };
  return (
    <Sheet visible={visible} title={t('match.log.title')} onClose={onClose} testID="match.log">
      {log.length === 0 ? (
        <Text style={[type.body, { color: color.textMuted }]}>{t('match.log.empty')}</Text>
      ) : (
        <View style={{ gap: space[2] }}>
          {[...log].reverse().map((entry) => (
            <Text
              key={entry.turn}
              testID={`match.log.entry.${String(entry.turn)}`}
              style={[type.body, styles.mono, { color: color.textPrimary }]}
            >
              {line(entry)}
            </Text>
          ))}
        </View>
      )}
      <Button label={t('common.close')} onPress={onClose} />
    </Sheet>
  );
}

type PremiumKind = 'DL' | 'TL' | 'DW' | 'TW';

const LEGEND: readonly { readonly kind: PremiumKind; readonly key: MessageKey }[] = [
  { kind: 'DL', key: 'legend.dl' },
  { kind: 'TL', key: 'legend.tl' },
  { kind: 'DW', key: 'legend.dw' },
  { kind: 'TW', key: 'legend.tw' },
];

/** §5.5.8 legend: counts are read from the pinned layout data, never hard-coded. */
export function LegendSheet({
  visible,
  layout,
  premiumLabels,
  onClose,
}: {
  readonly visible: boolean;
  readonly layout: Layout;
  readonly premiumLabels: Readonly<Record<PremiumKind, string>>;
  readonly onClose: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  const count = (kind: SquareKind): number => layout.squares.filter((k) => k === kind).length;
  return (
    <Sheet visible={visible} title={t('legend.title')} onClose={onClose} testID="match.legend">
      <View style={{ gap: space[2] }}>
        {LEGEND.map(({ kind, key }) => (
          <View
            key={kind}
            testID={`match.legend.${kind}`}
            accessible
            style={[styles.legendRow, { gap: space[3] }]}
          >
            <Text style={[type.body, styles.mono, styles.strong, { color: color.textPrimary }]}>
              {premiumLabels[kind]}
            </Text>
            <Text style={[type.body, { color: color.textPrimary }]}>{t(key)}</Text>
            <Text style={[type.bodyS, { color: color.textMuted }]}>
              {t('legend.count', { count: count(kind) })}
            </Text>
          </View>
        ))}
        <Text style={[type.body, { color: color.textPrimary }]}>{t('legend.start')}</Text>
      </View>
      <Button label={t('common.close')} onPress={onClose} />
    </Sheet>
  );
}

/** §5.5.8 match menu: Move log, Board legend, then Resign (destructive, separated). */
export function MenuSheet({
  visible,
  onLog,
  onLegend,
  onResign,
  onClose,
  canResign,
}: {
  readonly visible: boolean;
  readonly onLog: () => void;
  readonly onLegend: () => void;
  readonly onResign: () => void;
  readonly onClose: () => void;
  readonly canResign: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const { space } = useTokens();
  return (
    <Sheet visible={visible} title={t('match.menu.a11y')} onClose={onClose} testID="match.menu">
      <View style={{ gap: space[3] }}>
        <Button testID="match.menu.log" label={t('match.menu.log')} onPress={onLog} />
        <Button testID="match.menu.legend" label={t('match.menu.legend')} onPress={onLegend} />
      </View>
      <View style={{ gap: space[3], paddingTop: space[4] }}>
        {canResign && (
          <Button
            testID="match.menu.resign"
            variant="destructive"
            label={t('match.menu.resign')}
            onPress={onResign}
          />
        )}
        <Button label={t('common.close')} onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  spacer: { flex: 1 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', direction: 'ltr' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 24, fontWeight: '700', fontFamily: MONO },
  mono: { fontFamily: MONO, fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '700' },
  legendRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});
