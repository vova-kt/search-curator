import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { createCurator, llmRank } from '../../src/index.js';
import { sqlite } from '../../src/adapters/storage/sqlite.js';
import { memory } from '../../src/adapters/storage/memory.js';
import { openai } from '../../src/adapters/llm/openai.js';
import { tavily } from '../../src/adapters/search/tavily.js';
import { ProgressPhase } from '../../src/core/progress.js';
import { stubLLM, stubSearch } from '../_stubs.js';
import { resolveKeys, saveStored, loadStored, configPath } from './config.js';
import { Screen } from './screens/screen.js';
import KeysScreen from './screens/Keys.jsx';
import SavedQueriesScreen from './screens/SavedQueries.jsx';
import QueryEditorScreen from './screens/QueryEditor.jsx';
import ResultsScreen from './screens/Results.jsx';
import ProgressScreen from './screens/Progress.jsx';

export default function App({ dry }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout.rows ?? 24);
  const [cols, setCols] = useState(stdout.columns ?? 80);

  const [screen, setScreen] = useState(Screen.BOOT);
  const [curator, setCurator] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({});
  const [progressLabel, setProgressLabel] = useState('');
  const [results, setResults] = useState([]);
  const [savedQueries, setSavedQueries] = useState(/** @type {import('../../src/core/types.js').SavedQuery[]} */ ([]));
  const [editing, setEditing] = useState(/** @type {null | import('../../src/core/types.js').SavedQuery} */ (null));
  const [activeQuery, setActiveQuery] = useState(/** @type {null | import('../../src/core/types.js').SavedQuery} */ (null));
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

  const refreshSaved = async (c = curator) => {
    if (!c) return [];
    const list = await c.listSavedQueries();
    setSavedQueries(list);
    return list;
  };

  // Boot: build curator (or jump to keys screen if we lack credentials).
  useEffect(() => {
    if (dry) {
      buildCurator(null).catch((e) => setError(String(e)));
      return;
    }
    const r = resolveKeys();
    if (!r.openaiApiKey || !r.tavilyApiKey) {
      setScreen(Screen.KEYS);
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
    // The TUI opts into LLM rank so saved-query guidance and 5-word
    // rationales actually flow through.
    const c = await createCurator({ llm, search, storage, strategies: { rank: [llmRank] } });
    setCurator(c);
    await refreshSaved(c);
    setScreen(Screen.SAVED_LIST);
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

  const runSaved = async (q) => {
    setActiveQuery(q);
    setProgress({});
    setProgressLabel(`curating "${q.queryText}" in ${q.city}…`);
    setScreen(Screen.PROGRESS);

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
        city: q.city,
        queryText: q.queryText,
        timeframe: { rolling: { days: q.days } },
        limit: q.limit,
        filters: { excludeKeywords: q.excludeKeywords ?? [] },
        guidance: q.guidance,
      }, { onProgress });
      setResults(events);
      await refreshSaved();
      setScreen(Screen.RESULTS);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSaveQuery = async (q) => {
    await curator.upsertSavedQuery(q);
    await refreshSaved();
    setStatus(`saved ${q.city} / ${q.queryText}`);
    setEditing(null);
    setScreen(Screen.SAVED_LIST);
  };

  const handleSaveAndRunQuery = async (q) => {
    const persisted = await curator.upsertSavedQuery(q);
    await refreshSaved();
    setEditing(null);
    await runSaved(persisted);
  };

  const handleDeleteQuery = async (ref) => {
    await curator.deleteSavedQuery(ref);
    await refreshSaved();
    setStatus(`deleted ${ref.city} / ${ref.queryText}`);
  };

  const handleEditKeys = () => setScreen(Screen.KEYS);

  const handleFeedback = async ({ liked, disliked }) => {
    await curator.recordFeedback({ liked, disliked });
    setStatus(`saved feedback (${liked.length} liked, ${disliked.length} disliked)`);
    setActiveQuery(null);
    setScreen(Screen.SAVED_LIST);
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

        {!error && screen === Screen.BOOT && <Text dimColor>booting…</Text>}

        {!error && screen === Screen.KEYS && (
          <KeysScreen
            initial={loadStored()}
            source={resolveKeys().source}
            onSubmit={handleKeysSubmit}
            onCancel={curator ? () => setScreen(Screen.SAVED_LIST) : null}
          />
        )}

        {!error && screen === Screen.SAVED_LIST && curator && (
          <SavedQueriesScreen
            queries={savedQueries}
            onRun={runSaved}
            onEdit={(q) => { setEditing(q); setScreen(Screen.EDITOR); }}
            onNew={() => { setEditing(null); setScreen(Screen.EDITOR); }}
            onDelete={handleDeleteQuery}
            onEditKeys={dry ? null : handleEditKeys}
            onQuit={handleQuit}
          />
        )}

        {!error && screen === Screen.EDITOR && curator && (
          <QueryEditorScreen
            existing={editing}
            onSave={handleSaveQuery}
            onSaveAndRun={handleSaveAndRunQuery}
            onCancel={() => { setEditing(null); setScreen(Screen.SAVED_LIST); }}
          />
        )}

        {!error && screen === Screen.PROGRESS && (
          <ProgressScreen progress={progress} label={progressLabel} />
        )}

        {!error && screen === Screen.RESULTS && (
          <ResultsScreen
            events={results}
            onSubmit={handleFeedback}
            onBack={() => setScreen(Screen.SAVED_LIST)}
          />
        )}

        {footer}
      </Box>
    </Box>
  );
}
