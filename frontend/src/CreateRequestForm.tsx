import React, { useEffect, useState } from 'react';
import { Button, Card, ErrorBox, Field } from './components/ui';
import { apiUrl } from './api';

interface CreateRequestFormProps {
  token: string;
  onCreated: () => void;
}

interface Department { id: string; code: string; name: string; }
interface RequestType { id: string; code: string; name: string; departmentId: string; }

export default function CreateRequestForm({ token, onCreated }: CreateRequestFormProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'STANDARD' | 'URGENT'>('STANDARD');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [dupLoading, setDupLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<{ id: string; title: string; status: string }[] | null>(null);

  useEffect(() => {
    // Pickers load from the product catalog — one option per department and
    // type, no matter how many tickets exist.
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

  const filteredTypes = requestTypes.filter((t) => t.departmentId === selectedDept);

  const handleAiDraft = async () => {
    if (!aiText.trim()) {
      setAiNote('Describe your issue in a few words first.');
      return;
    }
    setAiLoading(true);
    setAiNote('');
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
      const res = await fetch(apiUrl('/requests/check-duplicates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ departmentId: selectedDept, title, description }),
      });
      const data = await res.json();
      setDuplicates(res.ok && Array.isArray(data) ? data : []);
    } catch {
      setDuplicates([]);
    } finally {
      setDupLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      if (!res.ok) {
        const data = await res.json();
        setError(data.message || 'Failed to create request');
        return;
      }

      setTitle('');
      setDescription('');
      setSelectedDept('');
      setSelectedType('');
      onCreated();
    } catch {
      setError('Cannot reach the server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="New Service Request">
      <div className="note-ai">
        <div className="note-ai-title">✨ Describe it in your own words</div>
        <Field label="">
          <textarea
            className="textarea"
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder="e.g. my laptop screen is cracked, need a replacement ASAP"
            rows={2}
          />
        </Field>
        <Button
          variant="ghost"
          onClick={handleAiDraft}
          disabled={aiLoading}
          small
        >
          {aiLoading ? 'Drafting...' : '✨ Draft with AI'}
        </Button>
        {aiNote && <p className="muted" style={{ marginTop: '0.5rem' }}>{aiNote}</p>}
      </div>

      <form onSubmit={handleSubmit}>
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
            required
          >
            <option value="">Select Request Type</option>
            {filteredTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>

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

        <div style={{ marginBottom: '0.8rem' }}>
          <Button variant="ghost" small onClick={handleCheckDuplicates} disabled={dupLoading} type="button">
            {dupLoading ? 'Checking…' : 'Check for duplicates'}
          </Button>
          {duplicates !== null && (
            duplicates.length === 0 ? (
              <p className="muted" style={{ marginTop: '0.4rem' }}>No similar open requests. Good to go.</p>
            ) : (
              <div className="note-info" style={{ background: 'var(--warning-bg)', border: 'none', marginTop: '0.5rem' }}>
                <strong>{duplicates.length} similar open request{duplicates.length > 1 ? 's' : ''}:</strong>
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                  {duplicates.map((d) => (
                    <li key={d.id}>{d.title} <span className="muted">({d.status})</span></li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>

        <Field label="Priority">
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as any)}>
            <option value="LOW">Low</option>
            <option value="STANDARD">Standard</option>
            <option value="URGENT">Urgent</option>
          </select>
        </Field>

        {error && <ErrorBox message={error} />}

        <div style={{ marginTop: '1rem' }}>
          <Button type="submit" variant="success" block disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Request'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
