import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth, AppRole } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Loader2, KeyRound, Mail, X, History } from 'lucide-react';
import { toast } from 'sonner';

const roleLabels: Record<AppRole, string> = { admin: 'Administrador', supervisor: 'Supervisor', user: 'Usuário' };

interface UserRow { user_id: string; username: string; name: string; active: boolean; role: AppRole; department_id: string | null; department_ids: string[]; }
interface DepartmentLite { id: string; name: string; }

export default function UsersPage() {
  const { user: currentUser, isAdmin, isSupervisor } = useAuth();
  const { tenantId } = useTenant();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentLite[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<AppRole>('user');
  const [formDepartments, setFormDepartments] = useState<string[]>([]);
  const [formPrimaryDept, setFormPrimaryDept] = useState<string>('none');
  const [saving, setSaving] = useState(false);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [emailUser, setEmailUser] = useState<UserRow | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const openAudit = async () => {
    setShowAudit(true);
    setAuditLoading(true);
    const { data: logs } = await supabase
      .from('user_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    const ids = Array.from(new Set([
      ...(logs || []).map((l: any) => l.target_user_id),
      ...(logs || []).map((l: any) => l.performed_by).filter(Boolean),
    ]));
    const nameMap: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('user_id, name, username').in('user_id', ids);
      (profs || []).forEach((p: any) => { nameMap[p.user_id] = p.name || p.username; });
    }
    setAuditLogs((logs || []).map((l: any) => ({
      ...l,
      target_name: nameMap[l.target_user_id] || l.target_user_id?.slice(0, 8),
      performed_name: l.performed_by ? (nameMap[l.performed_by] || l.performed_by.slice(0, 8)) : 'Sistema',
    })));
    setAuditLoading(false);
  };

  const fetchDepartments = useCallback(async () => {
    if (!tenantId) { setDepartments([]); return; }
    const { data } = await supabase.from('departments').select('id, name').eq('tenant_id', tenantId).eq('active', true).order('name');
    setDepartments((data as any) || []);
  }, [tenantId]);

  const fetchUsers = useCallback(async () => {
    if (!tenantId) { setUsers([]); return; }

    const { data: members } = await supabase
      .from('tenant_members')
      .select('user_id')
      .eq('tenant_id', tenantId);

    const memberIds = (members || []).map((m: any) => m.user_id);
    if (memberIds.length === 0) { setUsers([]); return; }

    const [{ data: profiles }, { data: roles }, { data: pds }] = await Promise.all([
      supabase.from('profiles').select('*').in('user_id', memberIds),
      supabase.from('user_roles').select('*').in('user_id', memberIds),
      supabase.from('profile_departments').select('user_id, department_id').eq('tenant_id', tenantId).in('user_id', memberIds),
    ]);

    const roleMap: Record<string, AppRole> = {};
    roles?.forEach((r: any) => { roleMap[r.user_id] = r.role as AppRole; });

    const depsMap: Record<string, string[]> = {};
    (pds || []).forEach((row: any) => {
      depsMap[row.user_id] = depsMap[row.user_id] || [];
      depsMap[row.user_id].push(row.department_id);
    });

    setUsers((profiles || [])
      .map((p: any) => ({
        user_id: p.user_id,
        username: p.username,
        name: p.name,
        active: p.active,
        role: roleMap[p.user_id] || 'user',
        department_id: p.department_id ?? null,
        department_ids: depsMap[p.user_id] || (p.department_id ? [p.department_id] : []),
      }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
    );
  }, [tenantId]);

  useEffect(() => { fetchUsers(); fetchDepartments(); }, [fetchUsers, fetchDepartments]);

  const openNew = () => {
    setEditingUser(null);
    setFormName(''); setFormEmail(''); setFormPassword(''); setFormRole('user');
    setFormDepartments([]); setFormPrimaryDept('none');
    setShowForm(true);
  };
  const openEdit = (u: UserRow) => {
    setEditingUser(u);
    setFormName(u.name); setFormEmail(''); setFormPassword(''); setFormRole(u.role);
    setFormDepartments(u.department_ids);
    setFormPrimaryDept(u.department_id || (u.department_ids[0] ?? 'none'));
    setShowForm(true);
  };

  const toggleDepartment = (depId: string) => {
    setFormDepartments(prev => {
      const has = prev.includes(depId);
      const next = has ? prev.filter(id => id !== depId) : [...prev, depId];
      // Ajusta o primário se necessário
      if (has && formPrimaryDept === depId) {
        setFormPrimaryDept(next[0] || 'none');
      } else if (!has && formPrimaryDept === 'none') {
        setFormPrimaryDept(depId);
      }
      return next;
    });
  };

  const syncDepartments = async (userId: string) => {
    if (!tenantId) return;
    // Remove tudo e reinsere o set atual
    await supabase.from('profile_departments').delete().eq('user_id', userId).eq('tenant_id', tenantId);
    if (formDepartments.length > 0) {
      const rows = formDepartments.map(department_id => ({ tenant_id: tenantId, user_id: userId, department_id }));
      const { error } = await supabase.from('profile_departments').insert(rows);
      if (error) console.error('profile_departments insert', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const primary = formPrimaryDept === 'none' ? null : formPrimaryDept;
      // O setor primário precisa estar entre os selecionados
      const primaryFinal = primary && formDepartments.includes(primary) ? primary : (formDepartments[0] ?? null);

      if (editingUser) {
        await supabase.from('profiles').update({ name: formName, department_id: primaryFinal }).eq('user_id', editingUser.user_id);
        const { error: delErr } = await supabase.from('user_roles').delete().eq('user_id', editingUser.user_id);
        if (delErr) { console.error('Role delete error:', delErr); }
        const { error: insErr } = await supabase.from('user_roles').insert({ user_id: editingUser.user_id, role: formRole as any });
        if (insErr) {
          console.error('Role insert error:', insErr);
          toast.error('Erro ao atualizar perfil: ' + insErr.message);
          setSaving(false);
          return;
        }
        await syncDepartments(editingUser.user_id);
        toast.success('Usuário atualizado');
      } else {
        if (!formEmail || !formPassword || !formName) { toast.error('Preencha todos os campos'); setSaving(false); return; }
        if (!tenantId) { toast.error('Tenant não selecionado'); setSaving(false); return; }
        const { data, error } = await supabase.functions.invoke('create-user', { body: { email: formEmail, password: formPassword, name: formName, role: formRole, tenant_id: tenantId, department_id: primaryFinal, department_ids: formDepartments } });
        if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message || 'Erro ao criar'); setSaving(false); return; }
        toast.success('Usuário criado');
      }
      setShowForm(false); fetchUsers();
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const toggleActive = async (u: UserRow) => { await supabase.from('profiles').update({ active: !u.active }).eq('user_id', u.user_id); fetchUsers(); };

  const deleteUser = async (u: UserRow) => {
    if (u.role === 'admin' && !isAdmin) return toast.error('Apenas Administradores podem excluir outros administradores');
    if (u.role === 'admin' && isAdmin) {
      const remaining = users.filter(x => x.role === 'admin' && x.user_id !== u.user_id).length;
      if (remaining === 0) return toast.error('Não é possível excluir o último administrador');
    }
    if (u.user_id === currentUser?.id) return toast.error('Não é possível excluir a si mesmo');
    if (!confirm(`Excluir "${u.name}"?`)) return;
    await supabase.from('profile_departments').delete().eq('user_id', u.user_id);
    await supabase.from('profiles').delete().eq('user_id', u.user_id);
    await supabase.from('user_roles').delete().eq('user_id', u.user_id);
    fetchUsers(); toast.success('Usuário excluído');
  };

  const handleResetPassword = async () => {
    if (!resetUser || !resetPassword.trim()) return;
    if (resetPassword.length < 6) { toast.error('Mínimo 6 caracteres'); return; }
    setResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', { body: { action: 'reset-password', user_id: resetUser.user_id, new_password: resetPassword } });
      if (error || data?.error) toast.error(data?.error || error?.message || 'Erro');
      else { toast.success(`Senha de "${resetUser.name}" alterada`); setResetUser(null); setResetPassword(''); }
    } catch (e: any) { toast.error(e.message); }
    setResetting(false);
  };

  const handleChangeEmail = async () => {
    if (!emailUser || !newEmail.trim()) return;
    setChangingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', { body: { action: 'change-email', user_id: emailUser.user_id, new_email: newEmail.trim() } });
      if (error || data?.error) toast.error(data?.error || error?.message || 'Erro ao alterar e-mail');
      else { toast.success(`E-mail de "${emailUser.name}" alterado`); setEmailUser(null); setNewEmail(''); fetchUsers(); }
    } catch (e: any) { toast.error(e.message); }
    setChangingEmail(false);
  };

  const depName = (id: string) => departments.find(d => d.id === id)?.name || '—';

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-foreground tracking-tight">Usuários</h1>
          <p className="text-[13px] text-muted-foreground mt-1">{users.length} usuário(s) cadastrado(s)</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && <Button variant="outline" className="h-10 text-[13px] font-semibold px-4" onClick={openAudit}><History className="h-4 w-4 mr-2" /> Histórico</Button>}
          {isAdmin && <Button className="h-10 text-[13px] font-semibold px-5" onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo Usuário</Button>}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="divide-y divide-border">
          {users.map(u => (
            <div key={u.user_id} className="flex items-center justify-between px-6 py-4 hover:bg-accent/40 transition-colors duration-200">
              <div className="flex items-center gap-4 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-[14px] font-bold shrink-0">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-foreground truncate">{u.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">@{u.username} · <span className="badge-status bg-primary/10 text-primary">{roleLabels[u.role]}</span></p>
                  {u.department_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {u.department_ids.map(id => (
                        <Badge key={id} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {depName(id)}{u.department_id === id && ' ★'}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 mr-2">
                  <span className={`text-[11px] font-medium ${u.active ? 'text-success' : 'text-muted-foreground'}`}>{u.active ? 'Ativo' : 'Inativo'}</span>
                  <Switch checked={u.active} onCheckedChange={() => toggleActive(u)} disabled={!isAdmin} />
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEmailUser(u); setNewEmail(u.username); }} title="Alterar E-mail"><Mail className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setResetUser(u); setResetPassword(''); }} title="Alterar Senha"><KeyRound className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteUser(u)} title="Excluir"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[16px] font-bold">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</DialogTitle></DialogHeader>
          <div className="space-y-5 mt-2">
            <div className="space-y-2"><Label className="text-[13px] font-medium">Nome</Label><Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Nome completo" className="h-10 text-[13px]" /></div>
            {!editingUser && <div className="space-y-2"><Label className="text-[13px] font-medium">E-mail</Label><Input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="email@exemplo.com" className="h-10 text-[13px]" /></div>}
            {!editingUser && <div className="space-y-2"><Label className="text-[13px] font-medium">Senha</Label><Input type="password" value={formPassword} onChange={e => setFormPassword(e.target.value)} placeholder="••••••" className="h-10 text-[13px]" /></div>}
            <div className="space-y-2"><Label className="text-[13px] font-medium">Perfil</Label>
              <Select value={formRole} onValueChange={v => setFormRole(v as AppRole)} disabled={!!editingUser && editingUser.role === 'admin' && !isAdmin}>
                <SelectTrigger className="h-10 text-[13px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuário</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  {isAdmin && <SelectItem value="admin">Administrador</SelectItem>}
                </SelectContent>
              </Select>
              {!isAdmin && isSupervisor && (
                <p className="text-[11px] text-muted-foreground">Supervisores não podem criar ou modificar Administradores.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Setores</Label>
              <p className="text-[11px] text-muted-foreground">Selecione um ou mais setores. O usuário receberá atendimentos de todos os setores marcados.</p>
              {departments.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-2">Nenhum setor cadastrado. Crie em Configurações → Setores.</p>
              ) : (
                <div className="border border-border rounded-lg divide-y divide-border max-h-52 overflow-y-auto">
                  {departments.map(d => {
                    const checked = formDepartments.includes(d.id);
                    return (
                      <label key={d.id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40 cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={() => toggleDepartment(d.id)} />
                        <span className="text-[13px] flex-1">{d.name}</span>
                        {checked && formPrimaryDept === d.id && <Badge variant="secondary" className="text-[10px]">Principal</Badge>}
                      </label>
                    );
                  })}
                </div>
              )}
              {formDepartments.length > 1 && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] text-muted-foreground">Setor principal</Label>
                  <Select value={formPrimaryDept === 'none' ? (formDepartments[0] || 'none') : formPrimaryDept} onValueChange={setFormPrimaryDept}>
                    <SelectTrigger className="h-9 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {formDepartments.map(id => (
                        <SelectItem key={id} value={id}>{depName(id)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {formDepartments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {formDepartments.map(id => (
                    <Badge key={id} variant="outline" className="text-[11px] gap-1">
                      {depName(id)}
                      <button type="button" onClick={() => toggleDepartment(id)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetUser} onOpenChange={() => setResetUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-[16px] font-bold">Alterar Senha — {resetUser?.name}</DialogTitle></DialogHeader>
          <div className="space-y-5 mt-2">
            <div className="space-y-2"><Label className="text-[13px] font-medium">Nova Senha</Label><Input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="Mínimo 6 caracteres" className="h-10 text-[13px]" /></div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setResetUser(null)}>Cancelar</Button>
            <Button onClick={handleResetPassword} disabled={resetting || resetPassword.length < 6}>{resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Alterar Senha'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Email Dialog */}
      <Dialog open={!!emailUser} onOpenChange={() => setEmailUser(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-[16px] font-bold">Alterar E-mail — {emailUser?.name}</DialogTitle></DialogHeader>
          <div className="space-y-5 mt-2">
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">E-mail atual</Label>
              <Input value={emailUser?.username || ''} disabled className="h-10 text-[13px] bg-muted" />
            </div>
            <div className="space-y-2">
              <Label className="text-[13px] font-medium">Novo E-mail</Label>
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="novo@email.com" className="h-10 text-[13px]" />
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="outline" onClick={() => setEmailUser(null)}>Cancelar</Button>
            <Button onClick={handleChangeEmail} disabled={changingEmail || !newEmail.trim()}>{changingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Alterar E-mail'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Audit Log Dialog */}
      <Dialog open={showAudit} onOpenChange={setShowAudit}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[16px] font-bold">Histórico de Alterações</DialogTitle></DialogHeader>
          {auditLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : auditLogs.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-6 text-center">Nenhum registro encontrado.</p>
          ) : (
            <div className="divide-y divide-border border border-border rounded-lg">
              {auditLogs.map(l => {
                const actionLabel: Record<string, string> = {
                  role_assigned: 'Cargo atribuído',
                  role_removed: 'Cargo removido',
                  role_changed: 'Cargo alterado',
                  user_activated: 'Usuário ativado',
                  user_deactivated: 'Usuário desativado',
                };
                const color = l.action === 'user_deactivated' || l.action === 'role_removed' ? 'text-destructive' : 'text-primary';
                return (
                  <div key={l.id} className="px-4 py-3 text-[12px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`font-semibold ${color}`}>{actionLabel[l.action] || l.action}</span>
                      <span className="text-muted-foreground text-[11px]">{new Date(l.created_at).toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="mt-1 text-foreground">
                      <strong>{l.performed_name}</strong> alterou <strong>{l.target_name}</strong>
                      {l.old_value && l.new_value && <> — de <code className="px-1 bg-muted rounded">{l.old_value}</code> para <code className="px-1 bg-muted rounded">{l.new_value}</code></>}
                      {!l.old_value && l.new_value && <> — <code className="px-1 bg-muted rounded">{l.new_value}</code></>}
                      {l.old_value && !l.new_value && <> — <code className="px-1 bg-muted rounded">{l.old_value}</code></>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
