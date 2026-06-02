// Local database using localStorage with typed interfaces

export type UserRole = 'admin' | 'user' | 'ti';
export type TicketStatus = 'aberto' | 'em_andamento' | 'finalizado';
export type UrgencyLevel = 'baixa' | 'media' | 'alta';

export interface User {
  id: string;
  username: string;
  name: string;
  password: string; // bcrypt-like hash (we'll use a simple hash for local)
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export interface Ticket {
  id: string;
  number: number;
  title: string;
  description: string;
  urgency: UrgencyLevel;
  status: TicketStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  comments: TicketComment[];
  history: TicketHistory[];
}

export interface TicketComment {
  id: string;
  ticketId: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface TicketHistory {
  id: string;
  ticketId: string;
  userId: string;
  field: string;
  oldValue: string;
  newValue: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  ticketId: string;
  read: boolean;
  createdAt: string;
}

// Simple hash function for passwords (not cryptographically secure but works offline)
export function hashPassword(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  // Add salt-like prefix for basic obfuscation
  return `hashed_${Math.abs(hash).toString(36)}_${password.length}`;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

class Database {
  private getStore<T>(key: string): T[] {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  }

  private setStore<T>(key: string, data: T[]): void {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // Initialize with admin user if empty
  init(): void {
    const users = this.getStore<User>('users');
    if (users.length === 0) {
      const admin: User = {
        id: generateId(),
        username: 'admin',
        name: 'Administrador',
        password: hashPassword('admin123'),
        role: 'admin',
        active: true,
        createdAt: new Date().toISOString(),
      };
      this.setStore('users', [admin]);
    }
  }

  // Users
  getUsers(): User[] {
    return this.getStore<User>('users');
  }

  getUserById(id: string): User | undefined {
    return this.getUsers().find(u => u.id === id);
  }

  authenticate(username: string, password: string): User | null {
    const users = this.getUsers();
    const hashed = hashPassword(password);
    const user = users.find(u => u.username === username && u.password === hashed && u.active);
    return user || null;
  }

  createUser(data: Omit<User, 'id' | 'createdAt'>): User {
    const users = this.getUsers();
    if (users.find(u => u.username === data.username)) {
      throw new Error('Nome de usuário já existe');
    }
    const user: User = { ...data, id: generateId(), createdAt: new Date().toISOString() };
    users.push(user);
    this.setStore('users', users);
    return user;
  }

  updateUser(id: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): User {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error('Usuário não encontrado');
    users[idx] = { ...users[idx], ...data };
    this.setStore('users', users);
    return users[idx];
  }

  deleteUser(id: string): void {
    const users = this.getUsers().filter(u => u.id !== id);
    this.setStore('users', users);
  }

  // Tickets
  getTickets(): Ticket[] {
    return this.getStore<Ticket>('tickets');
  }

  getNextTicketNumber(): number {
    const tickets = this.getTickets();
    return tickets.length > 0 ? Math.max(...tickets.map(t => t.number)) + 1 : 1;
  }

  createTicket(data: { title: string; description: string; urgency: UrgencyLevel; createdBy: string }): Ticket {
    const tickets = this.getTickets();
    const ticket: Ticket = {
      id: generateId(),
      number: this.getNextTicketNumber(),
      title: data.title,
      description: data.description,
      urgency: data.urgency,
      status: 'aberto',
      createdBy: data.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      closedAt: null,
      comments: [],
      history: [{
        id: generateId(),
        ticketId: '',
        userId: data.createdBy,
        field: 'status',
        oldValue: '',
        newValue: 'aberto',
        createdAt: new Date().toISOString(),
      }],
    };
    ticket.history[0].ticketId = ticket.id;
    tickets.push(ticket);
    this.setStore('tickets', tickets);

    // Notify admins
    const admins = this.getUsers().filter(u => (u.role === 'admin' || u.role === 'ti') && u.id !== data.createdBy);
    const creator = this.getUserById(data.createdBy);
    admins.forEach(admin => {
      this.addNotification({
        userId: admin.id,
        message: `Novo chamado #${ticket.number} aberto por ${creator?.name || 'Usuário'}`,
        ticketId: ticket.id,
      });
    });

    return ticket;
  }

  updateTicket(id: string, data: Partial<Pick<Ticket, 'urgency' | 'status'>>, userId: string): Ticket {
    const tickets = this.getTickets();
    const idx = tickets.findIndex(t => t.id === id);
    if (idx === -1) throw new Error('Chamado não encontrado');

    const ticket = tickets[idx];
    const histories: TicketHistory[] = [];

    if (data.urgency && data.urgency !== ticket.urgency) {
      histories.push({
        id: generateId(), ticketId: id, userId,
        field: 'urgência', oldValue: ticket.urgency, newValue: data.urgency,
        createdAt: new Date().toISOString(),
      });
      ticket.urgency = data.urgency;
    }

    if (data.status && data.status !== ticket.status) {
      histories.push({
        id: generateId(), ticketId: id, userId,
        field: 'status', oldValue: ticket.status, newValue: data.status,
        createdAt: new Date().toISOString(),
      });
      ticket.status = data.status;
      if (data.status === 'finalizado') ticket.closedAt = new Date().toISOString();
    }

    ticket.history.push(...histories);
    ticket.updatedAt = new Date().toISOString();
    tickets[idx] = ticket;
    this.setStore('tickets', tickets);

    // Notify ticket creator
    if (ticket.createdBy !== userId) {
      const updater = this.getUserById(userId);
      this.addNotification({
        userId: ticket.createdBy,
        message: `Chamado #${ticket.number} atualizado por ${updater?.name || 'TI'}`,
        ticketId: ticket.id,
      });
    }

    return ticket;
  }

  addComment(ticketId: string, userId: string, content: string): Ticket {
    const tickets = this.getTickets();
    const idx = tickets.findIndex(t => t.id === ticketId);
    if (idx === -1) throw new Error('Chamado não encontrado');

    const comment: TicketComment = {
      id: generateId(), ticketId, userId, content,
      createdAt: new Date().toISOString(),
    };

    tickets[idx].comments.push(comment);
    tickets[idx].updatedAt = new Date().toISOString();
    this.setStore('tickets', tickets);

    // Notify ticket creator
    const ticket = tickets[idx];
    if (ticket.createdBy !== userId) {
      const commenter = this.getUserById(userId);
      this.addNotification({
        userId: ticket.createdBy,
        message: `Novo comentário no chamado #${ticket.number} por ${commenter?.name || 'TI'}`,
        ticketId: ticket.id,
      });
    }

    return tickets[idx];
  }

  // Notifications
  getNotifications(userId: string): Notification[] {
    return this.getStore<Notification>('notifications').filter(n => n.userId === userId);
  }

  getUnreadCount(userId: string): number {
    return this.getNotifications(userId).filter(n => !n.read).length;
  }

  addNotification(data: { userId: string; message: string; ticketId: string }): void {
    const notifications = this.getStore<Notification>('notifications');
    notifications.push({
      ...data, id: generateId(), read: false, createdAt: new Date().toISOString(),
    });
    this.setStore('notifications', notifications);
  }

  markNotificationsRead(userId: string): void {
    const notifications = this.getStore<Notification>('notifications');
    notifications.forEach(n => { if (n.userId === userId) n.read = true; });
    this.setStore('notifications', notifications);
  }

  // Backup
  exportData(): string {
    return JSON.stringify({
      users: this.getUsers(),
      tickets: this.getTickets(),
      notifications: this.getStore<Notification>('notifications'),
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  importData(json: string): void {
    const data = JSON.parse(json);
    if (data.users) this.setStore('users', data.users);
    if (data.tickets) this.setStore('tickets', data.tickets);
    if (data.notifications) this.setStore('notifications', data.notifications);
  }
}

export const db = new Database();
