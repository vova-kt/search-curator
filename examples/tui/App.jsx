import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { createCurator } from '../../src/index.js';
import { sqlite } from '../../src/adapters/storage/sqlite.js';
import { memory } from '../../src/adapters/storage/memory.js';
import { openai } from '../../src/adapters/llm/openai.js';
import { tavily } from '../../src/adapters/search/tavily.js';
import { ProgressPhase } from '../../src/core/progress.js';
import { stubLLM, stubSearch } from '../_stubs.js';
import { resolveKeys, saveStored, loadStored, configPath } from './config.js';
import KeysScreen from './screens/Keys.jsx';
import SearchScreen from './screens/Search.jsx';
import ResultsScreen from './screens/Results.jsx';
import ProgressScreen from './screens/Progress.jsx';

export default function App({ dry }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows ?? 24);
  const [cols, setCols] = useState(stdout.columns ?? 80);

  const [screen, setScreen] = useState(dry ? 'boot' : 'boot');
  const [curator, setCurator] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({});
  const [progressLabel, setProgressLabel] = useState('');
  const [results, setResults] = useState([]);
  const [lastQuery, setLastQuery] = useState({ city: '', category: '', days: 14, limit: 10 });
  const [status, setStatus] = useState(null);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      cleanup().finally(() => exit());
    }
  });

  useEffect(() => {
    const onResize = () => {
      setRows(stdout.rows ?? 24);
      setCols(stdout.columns ?? 80);
    };
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  const cleanup = async () => {
    if (curator) {
      try { await curator.close(); } catch {}
    }
  };

  // Boot: build curator (or jump to keys screen if we lack credentials).
  useEffect(() => {
    if (dry) {
      buildCurator(null).catch((e) => setError(String(e)));
      return;
    }
    const r = resolveKeys();
    if (!r.openaiApiKey || !r.tavilyApiKey) {
      setScreen('keys');
    } else {
      buildCurator(r).catch((e) => setError(String(e)));
    }
  }, []);

  const buildCurator = async (keys) => {
    const llm = dry
      ? stubLLM()
      : openai({ apiKey: keys.openaiApiKey, model: keys.openaiModel });
    const search = dry ? [stubSearch()] : [tavily({ apiKey: keys.tavilyApiKey })];
    const storage = dry ? memory() : sqlite({ path: keys.dbPath });
    const c = await createCurator({ llm, search, storage });
    setCurator(c);
    setScreen('search');
  };

  const handleKeysSubmit = async ({ openaiApiKey, tavilyApiKey }) => {
    const stored = loadStored();
    saveStored({ ...stored, openaiApiKey, tavilyApiKey });
    setStatus(`saved keys to ${configPath}`);
    const r = resolveKeys();
    try {
      await buildCurator(r);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSearch = async (params) => {
    setLastQuery(params);
    setProgress({});
    setProgressLabel(`curating ${params.category} in ${params.city}…`);
    setScreen('progress');

    const onProgress = (e) => {
      setProgress((prev) => {
        const next = { ...prev };
        if (e.phase === ProgressPhase.START) {
          next[e.stage] = { phase: 'active', total: e.total, current: 0, note: e.note };
        } else if (e.phase === ProgressPhase.TICK) {
          next[e.stage] = { phase: 'active', total: e.total, current: e.current, note: e.note };
        } else if (e.phase === ProgressPhase.DONE) {
          next[e.stage] = { phase: 'done', count: e.count };
        }
        return next;
      });
    };

    try {
      const { events } = await curator.curate({
        city: params.city,
        category: params.category,
        timeframe: { rolling: { days: params.days } },
        limit: params.limit,
      }, { onProgress });
      setResults(events);
      setScreen('results');
    } catch (e) {
      setError(String(e));
    }
  };

  const handleEditKeys = () => setScreen('keys');

  const handleClearAll = async () => {
    await curator.clearPreferences();
    setStatus('cleared all preferences');
  };

  const handleClearCity = async (city) => {
    await curator.clearPreferences({ city });
    setStatus(`cleared preferences for ${city}`);
  };

  const handleFeedback = async ({ liked, disliked }) => {
    await curator.recordFeedback({ liked, disliked });
    setStatus(`saved feedback (${liked.length} liked, ${disliked.length} disliked)`);
    setScreen('search');
  };

  const handleQuit = async () => {
    await cleanup();
    exit();
  };

  const header = (
    <Box justifyContent="space-between" width={cols} borderStyle="single" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">events-curator</Text>
      <Text dimColor>{dry ? 'dry mode — stub adapters' : 'ctrl-c to quit'}</Text>
    </Box>
  );

  const footer = status ? (
    <Box marginTop={1}><Text color="green">{status}</Text></Box>
  ) : null;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {header}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {error && (
          <Box flexDirection="column">
            <Text color="red">error: {error}</Text>
            <Text dimColor>press Ctrl+C to exit</Text>
          </Box>
        )}

        {!error && screen === 'boot' && <Text dimColor>booting…</Text>}

        {!error && screen === 'keys' && (
          <KeysScreen
            initial={loadStored()}
            source={resolveKeys().source}
            onSubmit={handleKeysSubmit}
            onCancel={curator ? () => setScreen('search') : null}
          />
        )}

        {!error && screen === 'search' && curator && (
          <SearchScreen
            initial={lastQuery}
            dry={dry}
            onSubmit={handleSearch}
            onEditKeys={dry ? null : handleEditKeys}
            onClearAll={handleClearAll}
            onClearCity={handleClearCity}
            onQuit={handleQuit}
          />
        )}

        {!error && screen === 'progress' && (
          <ProgressScreen progress={progress} label={progressLabel} />
        )}

        {!error && screen === 'results' && (
          <ResultsScreen
            events={results}
            onSubmit={handleFeedback}
            onBack={() => setScreen('search')}
          />
        )}

        {footer}
      </Box>
    </Box>
  );
}
