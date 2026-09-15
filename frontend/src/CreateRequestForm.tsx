import React, { useEffect, useState } from 'react';

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

  useEffect(() => {
    fetch('http://localhost:3000/requests', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        const deptMap = new Map<string, Department>();
        const types: RequestType[] = [];
        for (const req of data) {
          if (req.department && !deptMap.has(req.department.id)) {
            deptMap.set(req.department.id, req.department);
          }
          if (req.requestType) {
            types.push(req.requestType);
          }
        }
        setDepartments(Array.from(deptMap.values()));
        setRequestTypes(types);
      })
      .catch(() => {});
  }, [token]);

  const filteredTypes = requestTypes.filter((t) => t.departmentId === selectedDept);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('http://localhost:3000/requests', {
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
    <div style={{ background: '#f8f9fa', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1rem' }}>New Service Request</h3>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <select value={selectedDept} onChange={(e) => { setSelectedDept(e.target.value); setSelectedType(''); }} required style={{ padding: '0.6rem', borderRadius: '8px', border: '1px solid #ccc' }}>
            <option value="">Select Department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>

          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} required style={{ padding: '0.6rem', borderRadius: '8px', border: '1px solid #ccc' }}>
            <option value="">Select Request Type</option>
            {filteredTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (min 3 chars)" minLength={3} required style={{ padding: '0.6rem', borderRadius: '8px', border: '1px solid #ccc' }} />

          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (min 10 chars)" minLength={10} rows={3} required style={{ padding: '0.6rem', borderRadius: '8px', border: '1px solid #ccc', resize: 'vertical' }} />

          <select value={priority} onChange={(e) => setPriority(e.target.value as any)} style={{ padding: '0.6rem', borderRadius: '8px', border: '1px solid #ccc' }}>
            <option value="LOW">Low</option>
            <option value="STANDARD">Standard</option>
            <option value="URGENT">Urgent</option>
          </select>

          {error && <div style={{ background: '#f8d7da', color: '#721c24', padding: '0.6rem', borderRadius: '8px' }}>{error}</div>}

          <button type="submit" disabled={loading} style={{ padding: '0.75rem', borderRadius: '8px', border: 'none', background: '#28a745', color: '#fff', fontSize: '1rem', cursor: 'pointer' }}>
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </form>
    </div>
  );
}
