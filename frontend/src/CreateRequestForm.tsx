import React, { useEffect, useState } from 'react';
import { Button, Card, ErrorBox, Field, Section } from './components/ui';
import { apiUrl } from './api';

interface CreateRequestFormProps {
  token: string;
  onCreated: (id?: string) => void;
  catalogVersion?: number;
}

interface Department { id: string; code: string; name: string; }
interface RequestType { id: string; code: string; name: string; departmentId: string; }

const DRAFT_KEY = 'new-request-draft-v1';

function loadDraft(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function CreateRequestForm({ token, onCreated, catalogVersion }: CreateRequestFormProps) {
  const [draft] = useState<Record<string, string>>(loadDraft);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([]);
  const [selectedDept, setSelectedDept] = useState(draft.selectedDept || '');
  const [selectedType, setSelectedType] = useState(draft.selectedType || '');
  const [title, setTitle] = useState(draft.title || '');
  const [description, setDescription] = useState(draft.description || '');
  const [priority, setPriority] = useState<'LOW' | 'STANDARD' | 'URGENT'>(
    draft.priority === 'LOW' || draft.priority === 'URGENT' ? draft.priority : 'STANDARD',
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiText, setAiText] = useState(draft.aiText || '');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [aiTrace, setAiTrace] = useState<{
    provider: string;
    promptVersion: string;
    confidence: string;
    matched: string[];
    rationale: string;
  } | null>(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<{ id: string; title: string; status: string }[] | null>(null);
  const [dupConfirmedFor, setDupConfirmedFor] = useState<string | null>(null);

  // Draft persistence: survives reloads, cleared on submit. Private-mode
  // failures are ignored — the form simply starts empty.
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ selectedDept, selectedType, title, description, priority, aiText }),
      );
    } catch {
      // Ignore quota/private-mode errors.
    }
  }, [selectedDept, selectedType, title, description, priority, aiText]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Nothing to clear.
    }
  };

  const loadCatalog = React.useCallback(() => {
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(apiUrl('/catalog/departments'), { headers }).then((r) => r.json()),
      fetch(apiUrl('/catalog/request-types'), { headers }).then((r) => r.json()),
    ])
      .then(([depts, types]) => {
        if (Array.isArray(depts)) setDepartments(depts);
        if (Array.isArray(types)) setRequestTypes(types);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog, catalogVersion]);

  const filteredTypes = requestTypes.filter((t) => t.departmentId === selectedDept);

  const handleAiDraft = async () => {
    if (!aiText.trim()) {
      setAiNote('Describe your issue in a few words first.');
      setAiTrace(null);
      return;
    }
    setAiLoading(true);
    setAiNote('');
    setAiTrace(null);
    try {
      const res = await fetch(apiUrl('/requests/ai-draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: aiText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiNote(data.message || 'AI could not structure that. Try describing the issue.');
        return;
      }
      const dept = departments.find((d) => d.id === data.departmentId);
      if (dept) {
        setSelectedDept(dept.id);
        const type = requestTypes.find((t) => t.id === data.requestTypeId);
        setSelectedType(type ? type.id : '');
      }
      setTitle(data.title || '');
      setDescription(data.description || '');
      if (['LOW', 'STANDARD', 'URGENT'].includes(data.priority)) {
        setPriority(data.priority);
      }
      let note =
        data.confidence === 'high'
          ? 'AI suggestion applied — review it, then Submit below.'
          : 'AI is unsure about this one — please double-check every field before submitting.';
      if (data.sensitive === true) {
        note += ' This looks personal and urgent — it will be handled discreetly.';
      }
      setAiNote(note);
      setAiTrace({
        provider: data.provider || 'local',
        promptVersion: data.promptVersion || '',
        confidence: data.confidence || '',
        matched: Array.isArray(data?.trace?.matchedKeywords) ? data.trace.matchedKeywords : [],
        rationale: typeof data?.trace?.rationale === 'string' ? data.trace.rationale : '',
      });
    } catch {
      setAiNote('Cannot reach the server');
    } finally {
      setAiLoading(false);
    }
  };

  const handleCheckDuplicates = async () => {
    if (!selectedDept || title.trim().length < 4) {
      setDuplicates(null);
      return;
    }
    setDupLoading(true);
    try {
      const dups = await checkDuplicates();
      setDuplicates(dups);
    } catch {
      setDuplicates([]);
    } finally {
      setDupLoading(false);
    }
  };

  const checkDuplicates = async (): Promise<{ id: string; title: string; status: string }[]> => {
    if (!selectedDept || title.trim().length < 4) return [];
    const res = await fetch(apiUrl('/requests/check-duplicates'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ departmentId: selectedDept, title, description }),
    });
    const data = await res.json();
    return res.ok && Array.isArray(data) ? data : [];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Advisory duplicate guard: warn on twins, never block. Skipped once the
    // user has seen the warning for this exact title+department.
    const dupKey = `${selectedDept}|${title.trim().toLowerCase()}`;
    if (dupConfirmedFor !== dupKey) {
      setLoading(true);
      try {
        const dups = await checkDuplicates();
        setDuplicates(dups);
        if (dups.length > 0) {
          setDupConfirmedFor(`pending:${dupKey}`);
          return;
        }
      } catch {
        // Duplicate service down must never block creation.
      } finally {
        setLoading(false);
      }
    }
    await doCreate();
  };

  const submitAnyway = async () => {
    setDupConfirmedFor(`${selectedDept}|${title.trim().toLowerCase()}`);
    await doCreate();
  };

  const doCreate = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch(apiUrl('/requests'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          departmentId: selectedDept,
          requestTypeId: selectedType,
          title,
          description,
          priority,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as any).message || 'Failed to create request');
        return;
      }

      const createdId = (data as any)?.id as string | undefined;
      setTitle('');
      setDescription('');
      setSelectedDept('');
      setSelectedType('');
      setDuplicates(null);
      setDupConfirmedFor(null);
      setAiText('');
      clearDraft();
      onCreated(createdId);
    } catch {
      setError('Cannot reach the server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="New Service Request">
      <Section
        title="1. What do you need help with?"
        sub="Optional: describe the issue in your own words and AI drafts the fields below. You review everything before anything is created."
      >
      <div className="note-ai">
        <Field label="Request summary">
          <textarea
            className="textarea"
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleAiDraft();
              }
            }}
            placeholder="e.g. my laptop screen is cracked, need a replacement ASAP (Ctrl+Enter to draft)"
            rows={2}
          />
        </Field>
        <div className="row ai-actions">
          <Button
            variant="ghost"
            onClick={handleAiDraft}
            disabled={aiLoading}
            small
          >
            {aiLoading ? 'Drafting...' : 'Draft with AI'}
          </Button>
          <span className="muted compact-help" title="Press Ctrl+Enter (or Cmd+Enter on Mac) inside the description box to draft">
            Ctrl+Enter
          </span>
        </div>
        {aiNote && <p className="muted mt-sm">{aiNote}</p>}
        {aiTrace && (
          <details className="muted mt-sm" style={{ fontSize: '0.8rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
              Why this classification? ({aiTrace.provider}
              {aiTrace.promptVersion ? ` · ${aiTrace.promptVersion}` : ''})
            </summary>
            <div style={{ marginTop: '0.35rem' }}>
              {aiTrace.matched.length > 0 && (
                <div>Matched: {aiTrace.matched.join(', ')}</div>
              )}
              {aiTrace.rationale && <div>{aiTrace.rationale}</div>}
            </div>
          </details>
        )}
      </div>
      </Section>

      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
      >
      <Section
        title="2. Classify your request"
        sub="The department owns the ticket; the type must belong to it."
      >
        <Field label="Department *">
          <select
            className="select"
            value={selectedDept}
            onChange={(e) => { setSelectedDept(e.target.value); setSelectedType(''); }}
            required
          >
            <option value="">Select Department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>

        <Field label="Request Type *">
          <select
            className="select"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            disabled={!selectedDept || filteredTypes.length === 0}
            required
          >
            <option value="">
              {!selectedDept
                ? 'Select a department first'
                : filteredTypes.length === 0
                ? 'No request types configured yet for this department'
                : 'Select Request Type'}
            </option>
            {filteredTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {selectedDept && filteredTypes.length === 0 && (
            <p className="field-warning">
              This department has no active request types yet. An administrator must add at least one request type in the Administration panel before requests can be submitted.
            </p>
          )}
        </Field>

        <Field label="Priority">
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as any)}>
            <option value="LOW">Low</option>
            <option value="STANDARD">Standard</option>
            <option value="URGENT">Urgent</option>
          </select>
        </Field>
      </Section>

      <Section
        title="3. Add the details"
        sub="Used for search, duplicate detection, and the SLA estimate."
      >
        <Field label="Title *">
          <input
            className="input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (min 3 chars)"
            minLength={3}
            required
          />
        </Field>

        <Field label="Description *">
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (min 10 chars)"
            minLength={10}
            rows={3}
            required
          />
        </Field>
      </Section>

      <Section
        title="4. Review and submit"
        sub="Duplicates are advisory — a twin never blocks creation."
      >
        <div className="duplicate-check">
          <Button variant="ghost" small onClick={handleCheckDuplicates} disabled={dupLoading} type="button">
            {dupLoading ? 'Checking…' : 'Check for duplicates'}
          </Button>
          {duplicates !== null && (
            duplicates.length === 0 ? (
              <p className="muted mt-sm">No similar open requests. Good to go.</p>
            ) : (
              <div className="note-info note-warning mt-sm">
                <strong>{duplicates.length} similar open request{duplicates.length > 1 ? 's' : ''}:</strong>
                <ul className="plain-list">
                  {duplicates.map((d) => (
                    <li key={d.id}>{d.title} <span className="muted">({d.status})</span></li>
                  ))}
                </ul>
                  {dupConfirmedFor?.startsWith('pending:') && (
                    <Button variant="ghost" small onClick={submitAnyway} disabled={loading} type="button">
                      {loading ? 'Creating…' : 'Create anyway'}
                    </Button>
                  )}
              </div>
            )
          )}
        </div>

        {error && <ErrorBox message={error} />}

        <div className="submit-wrap">
          <Button type="submit" variant="success" block disabled={loading}>
            {loading ? 'Creating…' : 'Create request'}
          </Button>
        </div>
      </Section>
      </form>
    </Card>
  );
}
