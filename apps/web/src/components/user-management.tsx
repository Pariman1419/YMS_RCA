'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui/button';
const roles = [
  'Administrator',
  'Yield Engineer',
  'QA Engineer',
  'Production Engineer',
  'Process Engineer',
  'Manager',
  'Executive',
];
export default function UserManagement() {
  const [users, setUsers] = useState<any[]>([]),
    [edit, setEdit] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      setUsers(await api('/users'));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>User management</h2>
          <p>Manage accounts, roles, access, and passwords.</p>
        </div>
        <Button
          onClick={() => {
            setError('');
            setEdit({ username: '', name: '', roles: ['Yield Engineer'], enabled: true, password: '' });
          }}
        >
          Add user
        </Button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="alert-banner">{notice}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Roles</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>{u.roles.join(', ')}</td>
                <td>{u.enabled ? 'Active' : 'Disabled'}</td>
                <td>
                  <button
                    className="link"
                    onClick={() => {
                      setError('');
                      setEdit({ ...u, id: u.user_id, name: u.display_name, password: '' });
                    }}
                  >
                    Edit / reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <form
          className="query-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const { username, name, roles, enabled, password } = edit;
              await api(
                '/users' + (edit.id ? '/' + edit.id : ''),
                { username, name, roles, enabled, ...(password ? { password } : {}) },
                edit.id ? 'PUT' : 'POST',
              );
              setEdit(null);
              setNotice('User saved. Updated accounts must sign in again.');
              await refresh();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{edit.id ? 'Edit account' : 'New account'}</h3>
          <label>
            Username
            <input
              required
              pattern="[a-zA-Z0-9_.-]{3,64}"
              value={edit.username}
              onChange={(e) => setEdit({ ...edit, username: e.target.value })}
            />
          </label>
          <label>
            Display name
            <input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </label>
          <label>
            {edit.id ? 'New password (leave empty to keep current)' : 'Password'}
            <input
              type="password"
              autoComplete="new-password"
              required={!edit.id}
              minLength={5}
              maxLength={128}
              value={edit.password}
              onChange={(e) => setEdit({ ...edit, password: e.target.value })}
            />
          </label>
          <fieldset>
            <legend>Roles</legend>
            {roles.map((r) => (
              <label key={r} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={edit.roles.includes(r)}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      roles: e.target.checked
                        ? [...edit.roles, r]
                        : edit.roles.filter((v: string) => v !== r),
                    })
                  }
                />{' '}
                {r}
              </label>
            ))}
          </fieldset>
          <label>
            <input
              type="checkbox"
              checked={edit.enabled}
              onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
            />{' '}
            Account enabled
          </label>
          <div className="toolbar">
            <Button disabled={busy || !edit.roles.length} type="submit">
              Save user
            </Button>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
