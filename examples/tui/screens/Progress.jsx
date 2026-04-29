import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ProgressStage, PROGRESS_STAGE_ORDER } from '../../../src/core/progress.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const STAGE_LABELS = {
  [ProgressStage.QUERIES]: 'build queries',
  [ProgressStage.SEARCH]:  'search the web',
  [ProgressStage.EXTRACT]: 'extract events',
  [ProgressStage.DEDUPE]:  'dedupe',
  [ProgressStage.FILTER]:  'filter',
  [ProgressStage.RANK]:    'rank',
  [ProgressStage.PERSIST]: 'save',
};

const STAGES = PROGRESS_STAGE_ORDER.map((key) => ({ key, label: STAGE_LABELS[key] }));

/**
 * @param {{ progress: Record<string, { phase: 'pending'|'active'|'done', current?: number, total?: number, count?: number, note?: string }>, label: string }} props
 */
export default function ProgressScreen({ progress, label }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, []);
  const frame = SPINNER[tick % SPINNER.length];

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{frame} {label}</Text>
      <Box marginTop={1} flexDirection="column">
        {STAGES.map((s) => {
          const st = progress[s.key] ?? { phase: 'pending' };
          let icon = '·';
          let color;
          if (st.phase === 'active') { icon = frame; color = 'cyan'; }
          else if (st.phase === 'done') { icon = '✓'; color = 'green'; }
          else { icon = '·'; color = undefined; }

          let detail = '';
          if (st.phase === 'active' && st.total !== undefined) {
            detail = ` ${st.current ?? 0}/${st.total}${st.note ? ` (${st.note})` : ''}`;
          } else if (st.phase === 'done' && st.count !== undefined) {
            detail = ` → ${st.count}`;
          }

          return (
            <Box key={s.key}>
              <Box width={3}><Text color={color}>{icon}</Text></Box>
              <Text color={st.phase === 'pending' ? 'gray' : undefined}>
                {s.label}
              </Text>
              <Text dimColor>{detail}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
