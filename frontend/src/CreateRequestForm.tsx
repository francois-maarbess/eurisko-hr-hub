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
interface MacroEditorTask {
  key: string;
  departmentId: string;
  requestTypeId: string;
  title: string;
  description: string;
}

function idempotencyKeyFor(payload: Record<string, unknown>): string {
  const fingerprint = JSON.stringify(payload);
  try {
    const previous = JSON.parse(localStorage.getItem('request-submission-key-v1') || 'null') as { fingerprint?: string; key?: string } | null;
    if (previous?.fingerprint === fingerprint && previous.key) return previous.key;
    const key = crypto.randomUUID();
    localStorage.setItem('request-submission-key-v1', JSON.stringify({ fingerprint, key }));
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

const DRAFT_KEY = 'new-request-draft-v1';

function loadDraft(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
}

export default function CreateRequestForm({ token, onCreated, catalogVersion }: CreateRequestFormProps) {
  const [draft] = useState<Record<string, any>>(loadDraft);
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
  const [macroTasks, setMacroTasks] = useState<MacroEditorTask[]>(() => Array.isArray(draft.macroTasks) ? draft.macroTasks : []);
  const [macroSummary, setMacroSummary] = useState(typeof draft.macroSummary === 'string' ? draft.macroSummary : '');
  const [dupLoading, setDupLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<{ id: string; title: string; status: string }[] | null>(null);
  const [dupConfirmedFor, setDupConfirmedFor] = useState<string | null>(null);
  // Stepper: 1 AI draft → 2 Classify → 3 Details → 4 Review.
  // Purely presentational; all fields stay mounted in the same form.
  const [step, setStep] = useState(1);

  // Draft persistence: survives reloads, cleared on submit. Private-mode
  // failures are ignored — the form simply starts empty.
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ selectedDept, selectedType, title, description, priority, aiText, macroTasks, macroSummary }),
      );
    } catch {
      // Ignore quota/private-mode errors.
    }
  }, [selectedDept, selectedType, title, description, priority, aiText, macroTasks, macroSummary]);

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
      if (data.needsClarification === true) {
        const questions = Array.isArray(data.clarificationQuestions) ? data.clarificationQuestions : [];
        const hadGoodDraft = title.trim().length >= 3 || macroTasks.length > 0;
        // Never let a worse second result clobber a good draft: keep every
        // field and task, and say so plainly.
        setAiNote(
          (questions.length ? `Please clarify: ${questions.join(' ')}` : 'AI needs more detail. Select the request category and describe the outcome you need.') +
          (hadGoodDraft ? ' Your previous draft below is untouched.' : ''),
        );
        setAiTrace({
          provider: data.provider || 'local', promptVersion: data.promptVersion || '',
          confidence: data.confidence || 'low',
          matched: Array.isArray(data?.trace?.matchedKeywords) ? data.trace.matchedKeywords : [],
          rationale: typeof data?.trace?.rationale === 'string' ? data.trace.rationale : '',
        });
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
      if (data.macro && Array.isArray(data.macro.childTasks)) {
        setMacroSummary(data.macro.summary || 'Suggested multi-department workflow');
        setMacroTasks(data.macro.childTasks.map((task: any) => ({
          key: crypto.randomUUID(),
          departmentId: task.departmentId,
          requestTypeId: task.requestTypeId,
          title: task.task,
          description: task.reason,
        })));
      } else {
        setMacroTasks([]);
        setMacroSummary('');
      }
      let note =
        data.confidence === 'high'
          ? 'AI suggestion applied — review it, then Submit below.'
          : 'AI is unsure about this one — please double-check every field before submitting.';
      if (data.sensitive === true) {
        note += ' This looks personal and urgent — it will be handled discreetly.';
      }
      setAiNote(note + (data.macro?.childTasks?.length ? ` Review ${data.macro.childTasks.length} proposed cross-department tasks below before submitting.` : ''));
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
      const payload: Record<string, unknown> = {
        departmentId: selectedDept,
        requestTypeId: selectedType,
        title,
        description,
        priority,
        ...(macroTasks.length ? { childTasks: macroTasks.map(({ departmentId, requestTypeId, title: childTitle, description: childDescription }) => ({
          departmentId, requestTypeId, title: childTitle, description: childDescription, priority,
        })) } : {}),
      };
      payload.submissionKey = idempotencyKeyFor(payload);
      const res = await fetch(apiUrl('/requests'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
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
      try { localStorage.removeItem('request-submission-key-v1'); } catch { /* Optional persistence. */ }
      setMacroTasks([]);
      setMacroSummary('');
      onCreated(createdId);
    } catch {
      setError('Cannot reach the server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="New Service Request" sub="Four quick steps — AI draft is optional, review is required.">
      <div className="stepper" role="tablist" aria-label="New request steps">
        {[
          { n: 1, label: 'Draft' },
          { n: 2, label: 'Classify' },
          { n: 3, label: 'Details' },
          { n: 4, label: 'Review' },
        ].map((s) => (
          <button
            key={s.n}
            type="button"
            role="tab"
            aria-selected={step === s.n}
            className={`stepper-step${step === s.n ? ' active' : ''}${step > s.n ? ' done' : ''}`}
            onClick={() => setStep(s.n)}
          >
            {s.n}. {s.label}
          </button>
        ))}
      </div>
      {step === 1 && (
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
        {macroTasks.length > 0 && (
          <section className="macro-proposal" aria-label="Review proposed workflow tasks">
            <div className="row macro-proposal-heading">
              <div>
                <strong>Proposed workflow</strong>
                <p className="muted mt-sm">{macroSummary} — each task becomes a separate request for its department. Review, edit, or remove tasks before submission.</p>
              </div>
              <Button type="button" variant="ghost" small onClick={() => { setMacroTasks([]); setMacroSummary(''); }}>Reject all suggestions</Button>
            </div>
            {macroTasks.map((task, index) => {
              const taskTypes = requestTypes.filter((type) => type.departmentId === task.departmentId);
              return (
                <div className="macro-task-editor" key={task.key}>
                  <div className="row macro-task-heading"><strong>Task {index + 1}</strong>
                    <Button type="button" variant="ghost" small onClick={() => setMacroTasks((items) => items.filter((item) => item.key !== task.key))}>Remove</Button>
                  </div>
                  <Field label="Task title">
                    <input className="input" maxLength={240} value={task.title} onChange={(event) => setMacroTasks((items) => items.map((item) => item.key === task.key ? { ...item, title: event.target.value } : item))} />
                  </Field>
                  <div className="macro-task-routing">
                    <Field label="Department">
                      <select className="select" value={task.departmentId} onChange={(event) => {
                        const departmentId = event.target.value;
                        const firstType = requestTypes.find((type) => type.departmentId === departmentId);
                        setMacroTasks((items) => items.map((item) => item.key === task.key ? { ...item, departmentId, requestTypeId: firstType?.id || '' } : item));
                      }}>
                        {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Request type">
                      <select className="select" value={task.requestTypeId} onChange={(event) => setMacroTasks((items) => items.map((item) => item.key === task.key ? { ...item, requestTypeId: event.target.value } : item))}>
                        {taskTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Task details">
                    <textarea className="textarea" maxLength={400} rows={3} value={task.description} onChange={(event) => setMacroTasks((items) => items.map((item) => item.key === task.key ? { ...item, description: event.target.value } : item))} />
                  </Field>
                </div>
              );
            })}
          </section>
        )}
        {aiTrace && (
          <details className="muted mt-sm" style={{ fontSize: '0.8rem' }}>
            <summary
              style={{ cursor: 'pointer', fontWeight: 700 }}
              title={aiTrace.promptVersion ? `Draft rules ${aiTrace.promptVersion}` : undefined}
            >
              Why this classification? ({aiTrace.provider === 'local' ? 'Offline assistant' : 'AI assistant'})
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
      )}
      {step === 1 && (
        <div className="row" style={{ marginTop: '1rem', justifyContent: 'flex-end' }}>
          <Button type="button" variant="primary" small onClick={() => setStep(2)}>
            Continue → Classify
          </Button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
      >
      {step === 2 && (
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
      )}
      {step === 2 && (
        <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
          <Button type="button" variant="ghost" small onClick={() => setStep(1)}>
            ← Back
          </Button>
          <Button type="button" variant="primary" small onClick={() => setStep(3)} disabled={!selectedDept || !selectedType}>
            Continue → Details
          </Button>
        </div>
      )}

      {step === 3 && (
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
            placeholder="Title (3–200 chars)"
            minLength={3}
            maxLength={200}
            required
            aria-describedby="title-count"
          />
          <p id="title-count" className="muted mt-sm" style={{ fontSize: '0.78rem' }}>{title.length}/200</p>
        </Field>

        <Field label="Description *">
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (10–2000 chars)"
            minLength={10}
            maxLength={2000}
            rows={3}
            required
            aria-describedby="description-count"
          />
          <p id="description-count" className="muted mt-sm" style={{ fontSize: '0.78rem' }}>{description.length}/2000</p>
        </Field>
      </Section>
      )}
      {step === 3 && (
        <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
          <Button type="button" variant="ghost" small onClick={() => setStep(2)}>
            ← Back
          </Button>
          <Button
            type="button"
            variant="primary"
            small
            onClick={() => setStep(4)}
            disabled={title.trim().length < 3 || description.trim().length < 10}
          >
            Continue → Review
          </Button>
        </div>
      )}

      {step === 4 && (
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

        {macroTasks.length > 0 && (
          <section className="macro-proposal" aria-label="Workflow tasks included in this submission">
            <strong>
              {macroTasks.length} cross-department task{macroTasks.length > 1 ? 's' : ''} will be filed with this request
            </strong>
            {macroSummary && <p className="muted mt-sm">{macroSummary}</p>}
            <ul className="plain-list">
              {macroTasks.map((task) => {
                const deptName = departments.find((d) => d.id === task.departmentId)?.name || 'Department';
                const typeName = requestTypes.find((t) => t.id === task.requestTypeId)?.name || 'request';
                return <li key={task.key}>{task.title} <span className="muted">({deptName} · {typeName})</span></li>;
              })}
            </ul>
            <p className="muted mt-sm" style={{ fontSize: '0.78rem' }}>Edit or remove tasks back in step 1.</p>
          </section>
        )}

        <div className="submit-wrap">
          <Button type="submit" variant="success" block disabled={loading}>
            {loading ? 'Creating…' : macroTasks.length > 0 ? `Create request + ${macroTasks.length} tasks` : 'Create request'}
          </Button>
        </div>
      </Section>
      )}
      {step === 4 && (
        <div className="row" style={{ marginTop: '1rem', justifyContent: 'flex-start' }}>
          <Button type="button" variant="ghost" small onClick={() => setStep(3)}>
            ← Back to details
          </Button>
        </div>
      )}
      </form>
    </Card>
  );
}
