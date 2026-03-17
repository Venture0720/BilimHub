import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { isNative, initNativeBridge } from './lib/platform';
import { MobileAppWrapper } from './lib/MobileAppWrapper';

// Initialize native bridge when running in Capacitor
initNativeBridge();

// ── Toast Context ─────────────────────────────────────────────────────────────
const ToastContext = createContext(null);
function useToast() { return useContext(ToastContext); }
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  function showToast(message, type = 'info') {
    const id = ++idRef.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }
  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span>{t.type==='success'?'✅':t.type==='error'?'❌':t.type==='warning'?'⚠️':'ℹ️'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────
const ConfirmContext = createContext(null);
function useConfirm() { return useContext(ConfirmContext); }
function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  function showConfirm(message, title = 'Подтверждение', options = {}) {
    return new Promise(resolve => {
      setState({ message, title, resolve, ...options });
    });
  }
  function handleResponse(val) { state?.resolve(val); setState(null); }
  return (
    <ConfirmContext.Provider value={showConfirm}>
      {children}
      {state && (
        <div className="overlay" onClick={() => handleResponse(false)} style={{animation:'fadeIn 0.15s ease'}}>
          <div className="modal" style={{maxWidth:420,animation:'slideUp 0.2s ease'}} onClick={e=>e.stopPropagation()}>
            {state.icon && <div className="confirm-icon">{state.icon}</div>}
            <div className="modal-t" style={{textAlign:state.icon?'center':'left'}}>{state.title}</div>
            <div className="confirm-message">{state.message}</div>
            <div className="confirm-actions">
              <button className={`btn ${state.danger?'btn-d':'btn-p'}`} style={{flex:1}} onClick={() => handleResponse(true)}>
                {state.confirmText || 'Да'}
              </button>
              <button className="btn btn-s" style={{flex:1}} onClick={() => handleResponse(false)}>
                {state.cancelText || 'Отмена'}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </ConfirmContext.Provider>
  );
}

// ── Grading Utils ─────────────────────────────────────────────────────────────
function getGradeColor(score, scale = '10-point') {
  if (scale === '10-point') {
    if (score >= 9) return '#10b981';
    if (score >= 7) return '#3b82f6';
    if (score >= 5) return '#f59e0b';
    if (score >= 3) return '#ef4444';
    return '#991b1b';
  }
  if (scale === '100-point') {
    if (score >= 85) return '#10b981';
    if (score >= 70) return '#3b82f6';
    if (score >= 50) return '#f59e0b';
    if (score >= 30) return '#ef4444';
    return '#991b1b';
  }
  return '#6b7280';
}

function getGradeIcon(score, scale = '10-point') {
  if (scale === '10-point') {
    if (score === 10) return '🏆';
    if (score >= 9) return '⭐';
    if (score >= 7) return '✨';
    if (score >= 5) return '👍';
    if (score >= 3) return '📝';
    return '😢';
  }
  if (scale === '100-point') {
    if (score >= 95) return '🏆';
    if (score >= 85) return '⭐';
    if (score >= 70) return '✨';
    if (score >= 50) return '👍';
    if (score >= 30) return '📝';
    return '😢';
  }
  return '❓';
}

function getGradeLabel(score, scale = '10-point') {
  if (scale === '10-point') {
    if (score >= 9) return 'Отлично';
    if (score >= 7) return 'Хорошо';
    if (score >= 5) return 'Удовлетворительно';
    if (score >= 3) return 'Неудовлетворительно';
    return 'Плохо';
  }
  if (scale === '100-point') {
    if (score >= 85) return 'Отлично';
    if (score >= 70) return 'Хорошо';
    if (score >= 50) return 'Удовлетворительно';
    if (score >= 30) return 'Неудовлетворительно';
    return 'Плохо';
  }
  return 'Не оценено';
}

function generateStars(score, maxScore = 10) {
  if (maxScore !== 10) return null;
  const filled = Math.floor(score);
  const empty = maxScore - filled;
  return '⭐'.repeat(filled) + '☆'.repeat(empty);
}

// ── API layer ─────────────────────────────────────────────────────────────────
import { API_BASE } from './lib/platform';

const API = (() => {
  let _accessToken = null;  // kept in memory only — not localStorage
  let _user = JSON.parse(localStorage.getItem('user') || 'null');
  let _onUnauth = null;

  function setToken(t) { _accessToken = t; }
  function setUser(u) { _user = u; localStorage.setItem('user', JSON.stringify(u)); }
  function getUser() { return _user; }
  function getToken() { return _accessToken; }
  function onUnauth(fn) { _onUnauth = fn; }

  async function req(method, url, body, isForm = false) {
    const headers = { Authorization: `Bearer ${_accessToken}` };
    if (!isForm) headers['Content-Type'] = 'application/json';

    const fullUrl = url.startsWith('http') ? url : API_BASE + url;
    const res = await fetch(fullUrl, {
      method, headers,
      credentials: 'include',
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });

    if (res.status === 401) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'TOKEN_EXPIRED' || errData.error === 'No token provided' || errData.error === 'Invalid token') {
        // Try refresh
        const rr = await fetch(API_BASE + '/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (rr.ok) {
          const { accessToken, user } = await rr.json();
          setToken(accessToken); setUser(user);
          // Retry
          return req(method, url, body, isForm);
        } else {
          setToken(null); setUser(null);
          if (_onUnauth) _onUnauth();
          throw new Error('Session expired');
        }
      }
      throw new Error(errData.error || 'Unauthorized');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  return {
    setToken, setUser, getUser, getToken, onUnauth,
    get: (url) => req('GET', url),
    post: (url, body) => req('POST', url, body),
    postForm: (url, fd) => req('POST', url, fd, true),
    patch: (url, body) => req('PATCH', url, body),
    del: (url) => req('DELETE', url),
    login: async (username, password) => {
      const d = await fetch(API_BASE + '/api/v1/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await d.json();
      if (!d.ok) throw new Error(data.error || 'Ошибка входа');
      setToken(data.accessToken); setUser(data.user);
      return data;
    },
    register: async (name, email, password, inviteToken) => {
      const d = await fetch(API_BASE + '/api/v1/auth/register', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, inviteToken }),
      });
      const data = await d.json();
      if (!d.ok) throw new Error(data.error || 'Registration failed');
      setToken(data.accessToken); setUser(data.user);
      return data;
    },
    logout: async () => {
      await fetch(API_BASE + '/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers: { Authorization: `Bearer ${_accessToken}` } }).catch(() => {});
      setToken(null); setUser(null);
    },
    tryRestoreSession: async () => {
      const savedUserId = _user?.id;
      // If we have a token in memory, try /me; otherwise try refresh
      if (_accessToken) {
        try {
          const data = await req('GET', '/api/v1/auth/me');
          if (savedUserId && data.user && savedUserId !== data.user.id) {
            setToken(null); setUser(null);
            return null;
          }
          return data;
        } catch { return null; }
      }
      // No token in memory — try silent refresh via httpOnly cookie
      try {
        const rr = await fetch(API_BASE + '/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (rr.ok) {
          const { accessToken, user } = await rr.json();
          setToken(accessToken); setUser(user);
          if (savedUserId && user && savedUserId !== user.id) {
            setToken(null); setUser(null);
            return null;
          }
          return { user, center: null };  // center will be fetched separately
        }
      } catch {}
      setToken(null); setUser(null);
      return null;
    },
  };
})();

// ── Helpers ────────────────────────────────────────────────────────────────────
const gColor = p => p >= 90 ? '#059669' : p >= 80 ? 'hsl(160,50%,40%)' : p >= 65 ? '#d97706' : p >= 50 ? '#dc2626' : '#9ca3af';
const gBg = p => p >= 90 ? '#ecfdf5' : p >= 80 ? 'hsl(160,40%,92%)' : p >= 65 ? '#fffbeb' : p >= 50 ? '#fef2f2' : '#f3f4f6';
const typeIco = t => ({ homework:'📚', test:'📋', essay:'✍️', lab:'🔬', project:'🏗️' })[t] || '📄';
const typeBg = t => ({ homework:'#fffbeb', test:'#eef2ff', essay:'#fdf2f8', lab:'#ecfdf5', project:'#eff6ff' })[t] || '#f3f4f6';
const roleLabel = { super_admin:'Суперадмин', center_admin:'Директор', teacher:'Учитель', student:'Ученик', parent:'Родитель' };
const rolePlural = { super_admin:'Суперадмины', center_admin:'Директора', teacher:'Учителя', student:'Ученики', parent:'Родители' };
const avaColor = r => ({ super_admin:'hsl(180,45%,45%)', center_admin:'hsl(160,50%,40%)', teacher:'#0d9488', student:'#f59e0b', parent:'#ec4899' })[r] || '#6b7280';
const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
const initials = n => n ? n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() : '??';
function relativeDate(d) {
  if (!d) return '—';
  const now = new Date(); now.setHours(0,0,0,0);
  const target = new Date(d); target.setHours(0,0,0,0);
  const diff = Math.round((target - now) / 86400000);
  const abs = Math.abs(diff);
  const formatted = fmtDate(d);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Завтра';
  if (diff === -1) return 'Вчера';
  if (diff > 1 && diff <= 7) return `Через ${abs} дн. (${formatted})`;
  if (diff < -1 && diff >= -7) return `Просрочено ${abs} дн.`;
  return 'До ' + formatted;
}

const EMPTY_DEPS = [];
function useApi(fn, deps) {
  const effectiveDeps = deps || EMPTY_DEPS;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fn()); } catch(e) { setError(e.message); }
    setLoading(false);
  }, effectiveDeps);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

// ── Responsive Hook ───────────────────────────────────────────────────────────
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

// ── Components ─────────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info); }
  render() {
    if (this.state.hasError) {
      return React.createElement('div', { style: { padding: 40, textAlign: 'center' } },
        React.createElement('div', { style: { fontSize: 36, marginBottom: 12 } }, '⚠️'),
        React.createElement('div', { style: { fontWeight: 700, fontSize: 16, marginBottom: 8 } }, 'Что-то пошло не так'),
        React.createElement('div', { style: { fontSize: 13, color: 'var(--muted)', marginBottom: 16 } }, String(this.state.error?.message || '')),
        React.createElement('button', { className: 'btn btn-p', onClick: () => this.setState({ hasError: false, error: null }) }, 'Попробовать снова')
      );
    }
    return this.props.children;
  }
}

function Spinner() { return <div style={{textAlign:'center',padding:'40px',color:'var(--muted)',fontSize:13}}>Загрузка...</div>; }

function Alert({ msg }) { return msg ? <div className="err-box">{msg}</div> : null; }

function Modal({ title, onClose, children }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal fade" onClick={e=>e.stopPropagation()}>
        <div className="modal-t">{title}</div>
        {children}
      </div>
    </div>
  );
}

function StatGrid({ stats }) {
  return (
    <div className="sg">
      {stats.map(s => (
        <div className="sc" key={s.label}>
          <div className="sl">{s.label}</div>
          <div className="sv" style={{color:s.color}}>{s.value}</div>
          <div className="ss">{s.sub}</div>
          <div className="si">{s.icon}</div>
        </div>
      ))}
    </div>
  );
}

// ── BOTTOM NAV (Duolingo-style mobile tab bar) ───────────────────────────────
function BottomNav({ nav, page, setPage, unread }) {
  // Show max 5 items in bottom nav (most important ones)
  const mainItems = nav.filter(n => ['dashboard','schedule','assignments','gradebook','grades','classes','notifications'].includes(n.id)).slice(0, 5);
  if (!mainItems.length) return null;
  return (
    <nav className="bottom-nav">
      {mainItems.map(n => (
        <button
          key={n.id}
          className={`bottom-nav-item ${page === n.id ? 'active' : ''}`}
          onClick={() => setPage(n.id)}
        >
          <span className="nav-ico">{n.ico}</span>
          <span>{n.label.length > 10 ? n.label.slice(0, 8) + '…' : n.label}</span>
          {n.id === 'notifications' && unread > 0 && <span className="bottom-nav-badge">{unread}</span>}
        </button>
      ))}
    </nav>
  );
}

// ── RESPONSIVE TABLE → CARDS ──────────────────────────────────────────────────
function ResponsiveTable({ headers, rows, renderRow, renderCard, emptyIcon, emptyText }) {
  const isMobile = useIsMobile();
  if (!rows?.length) {
    return <div className="empty"><div className="empty-ico">{emptyIcon || '📋'}</div>{emptyText || 'Нет данных'}</div>;
  }
  if (isMobile && renderCard) {
    return <div className="mobile-cards">{rows.map(renderCard)}</div>;
  }
  return (
    <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
      <table className="tbl">
        <thead><tr>{headers.map((h,i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
    </div>
  );
}



// ── AUTH SCREENS ───────────────────────────────────────────────────────────────
function AuthPage({ onLogin, onBack }) {
  const [mode, setMode] = useState('login'); // login | register | forgot
  const [form, setForm] = useState({ name:'', username:'', email:'', password:'', inviteToken:'' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokenInfo, setTokenInfo] = useState(null);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStatus, setForgotStatus] = useState(null); // null | 'sent' | 'error'

  const set = k => e => setForm(p=>({...p,[k]:e.target.value}));

  async function checkToken(token) {
    if (token.length < 10) return;
    try {
      const info = await fetch(API_BASE + `/api/v1/tokens/validate/${token.toUpperCase()}`).then(r=>r.json());
      if (info.error) setTokenInfo({ error: info.error });
      else setTokenInfo(info);
    } catch { setTokenInfo(null); }
  }

  async function submitForgot(e) {
    e.preventDefault(); setLoading(true); setForgotStatus(null);
    try {
      await fetch(API_BASE + '/api/v1/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setForgotStatus('sent');
    } catch { setForgotStatus('error'); }
    setLoading(false);
  }

  async function submit(e) {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      if (mode === 'login') {
        await API.login(form.username, form.password); // Используем username вместо email
      } else {
        await API.register(form.name, form.email, form.password, form.inviteToken);
      }
      onLogin(API.getUser());
    } catch(ex) { setErr(ex.message); }
    setLoading(false);
  }

  // ── Forgot password screen ────────────────────────────────────────────────
  if (mode === 'forgot') {
    return (
      <div className="auth-bg">
        <div className="auth-card">
          <div className="auth-logo">
            <div className="auth-logo-icon">B</div>
            <div>
              <div className="auth-logo-text">BilimHub</div>
              <div className="auth-logo-sub">Восстановление пароля</div>
            </div>
          </div>
          {forgotStatus === 'sent' ? (
            <div style={{textAlign:'center',padding:'24px 0'}}>
              <div style={{fontSize:40,marginBottom:12}}>📬</div>
              <div style={{fontWeight:700,fontSize:15,marginBottom:8}}>Ссылка отправлена!</div>
              <div style={{fontSize:13,color:'var(--muted)',marginBottom:20}}>Если аккаунт с этим email существует, администратор получит ссылку для сброса пароля.</div>
              <button className="btn btn-s" style={{width:'100%',justifyContent:'center'}} onClick={()=>{setMode('login');setForgotStatus(null);setForgotEmail('');}}>
                ← Назад ко входу
              </button>
            </div>
          ) : (
            <form onSubmit={submitForgot}>
              <div style={{fontSize:13,color:'var(--muted)',marginBottom:16}}>Введите email вашего аккаунта. Если он найден, администратор отправит вам ссылку для сброса пароля.</div>
              {forgotStatus === 'error' && <div className="err-box">Ошибка. Попробуйте позже.</div>}
              <div className="fg">
                <label className="fl">Email</label>
                <input className="fi" type="email" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} placeholder="ivan@example.com" required />
              </div>
              <button className="btn btn-p" style={{width:'100%',justifyContent:'center',padding:'10px',marginTop:6}} disabled={loading}>
                {loading ? '...' : 'Отправить ссылку'}
              </button>
              <button type="button" className="btn btn-s" style={{width:'100%',justifyContent:'center',marginTop:8}} onClick={()=>{setMode('login');setForgotStatus(null);}}>
                ← Назад
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">B</div>
          <div>
            <div className="auth-logo-text">BilimHub</div>
            <div className="auth-logo-sub">SaaS Platform for Education</div>
          </div>
        </div>
        <div className="auth-h">{mode==='login' ? 'Добро пожаловать' : 'Регистрация'}</div>
        <div className="auth-sub">{mode==='login' ? 'Войдите в свой аккаунт' : 'Введите инвайт-код от вашего центра'}</div>
        <Alert msg={err} />
        <form onSubmit={submit}>
          {mode==='register' && (
            <>
              <div className="fg">
                <label className="fl">Полное имя</label>
                <input className="fi" value={form.name} onChange={set('name')} placeholder="Иванов Иван Иванович" required />
              </div>
              <div className="fg">
                <label className="fl">Инвайт-токен</label>
                <input className="fi" value={form.inviteToken} onChange={e=>{set('inviteToken')(e);checkToken(e.target.value)}}
                  placeholder="STD-AEA2847-XXXXX" style={{fontFamily:"'JetBrains Mono',monospace"}} required />
                {tokenInfo && !tokenInfo.error && (
                  <div style={{background:'var(--green-s)',border:'1px solid #6ee7b7',borderRadius:6,padding:'6px 10px',marginTop:5,fontSize:11,color:'#059669'}}>
                    ✅ {tokenInfo.centerName} · Роль: {roleLabel[tokenInfo.role]}
                    {tokenInfo.label && ` · ${tokenInfo.label}`}
                  </div>
                )}
                {tokenInfo?.error && <div style={{color:'var(--red)',fontSize:11,marginTop:4}}>❌ {tokenInfo.error}</div>}
              </div>
            </>
          )}
          {mode==='register' && (
            <div className="fg">
              <label className="fl">Email (опционально)</label>
              <input className="fi" type="email" value={form.email} onChange={set('email')} placeholder="ivan@example.com (не обязательно)" />
              <div style={{fontSize:10,color:'var(--muted)',marginTop:4}}>Email нужен только для уведомлений (если захотите)</div>
            </div>
          )}
          {mode==='login' && (
            <div className="fg">
              <label className="fl">Логин</label>
              <input className="fi" value={form.username} onChange={set('username')} placeholder="ivan123" required autoComplete="username" />
            </div>
          )}
          <div className="fg">
            <label className="fl">Пароль</label>
            <input className="fi" type="password" value={form.password} onChange={set('password')} placeholder="Минимум 8 символов" required minLength={8} />
            {mode==='login' && <div style={{textAlign:'right',marginTop:4}}>
              <span style={{fontSize:11,color:'var(--accent)',cursor:'pointer'}} onClick={()=>{setMode('forgot');setErr('');}}>
                Забыли пароль?
              </span>
            </div>}
          </div>
          <button className="btn btn-p" style={{width:'100%',justifyContent:'center',padding:'10px',fontSize:14,marginTop:6}} disabled={loading}>
            {loading ? '...' : (mode==='login' ? 'Войти' : 'Зарегистрироваться')}
          </button>
        </form>
        <div style={{textAlign:'center',marginTop:16,fontSize:12,color:'var(--muted)'}}>
          {mode==='login'
            ? <span>Нет аккаунта? <span style={{color:'var(--accent)',cursor:'pointer',fontWeight:600}} onClick={()=>{setMode('register');setErr('');}}>Регистрация</span></span>
            : <span>Уже есть аккаунт? <span style={{color:'var(--accent)',cursor:'pointer',fontWeight:600}} onClick={()=>{setMode('login');setErr('');}}>Войти</span></span>
          }
        </div>
      </div>
    </div>
  );
}

// ── NAVIGATION CONFIGS ────────────────────────────────────────────────────────
const NAV = {
  super_admin: [
    {id:'dashboard',label:'Обзор платформы',ico:'🏠',sec:'Главное'},
    {id:'centers',label:'Центры',ico:'🏫',sec:'Управление'},
    {id:'users_all',label:'Все пользователи',ico:'👥',sec:'Управление'},
    {id:'audit',label:'Журнал действий',ico:'📝',sec:'Управление'},
    {id:'notifications',label:'Уведомления',ico:'🔔',sec:'Аккаунт'},
    {id:'profile',label:'Профиль',ico:'👤',sec:'Аккаунт'},
  ],
  center_admin: [
    {id:'dashboard',label:'Дашборд',ico:'🏠',sec:'Главное'},
    {id:'tokens',label:'Токены',ico:'🔑',sec:'Пользователи'},
    {id:'users',label:'Пользователи',ico:'👥',sec:'Пользователи'},
    {id:'classes',label:'Классы',ico:'📚',sec:'Учёба'},
    {id:'schedule',label:'Расписание',ico:'🗓',sec:'Учёба'},
    {id:'attendance',label:'Посещаемость',ico:'✅',sec:'Учёба'},
    {id:'audit',label:'Журнал действий',ico:'📝',sec:'Управление'},
    {id:'notifications',label:'Уведомления',ico:'🔔',sec:'Аккаунт'},
    {id:'profile',label:'Профиль',ico:'👤',sec:'Аккаунт'},
  ],
  teacher: [
    {id:'dashboard',label:'Кабинет',ico:'🏠',sec:'Главное'},
    {id:'classes',label:'Мои классы',ico:'📚',sec:'Учёба'},
    {id:'schedule',label:'Расписание',ico:'🗓',sec:'Учёба'},
    {id:'assignments',label:'Задания',ico:'📋',sec:'Учёба'},
    {id:'gradebook',label:'Журнал оценок',ico:'📊',sec:'Учёба'},
    {id:'attendance',label:'Посещаемость',ico:'✅',sec:'Учёба'},
    {id:'notifications',label:'Уведомления',ico:'🔔',sec:'Аккаунт'},
    {id:'profile',label:'Профиль',ico:'👤',sec:'Аккаунт'},
  ],
  student: [
    {id:'dashboard',label:'Главная',ico:'🏠',sec:'Обзор'},
    {id:'schedule',label:'Расписание',ico:'🗓',sec:'Учёба'},
    {id:'assignments',label:'Задания',ico:'📋',sec:'Учёба'},
    {id:'grades',label:'Мои оценки',ico:'📊',sec:'Учёба'},
    {id:'classes',label:'Мои классы',ico:'📚',sec:'Учёба'},
    {id:'attendance',label:'Посещаемость',ico:'✅',sec:'Учёба'},
    {id:'notifications',label:'Уведомления',ico:'🔔',sec:'Аккаунт'},
    {id:'profile',label:'Профиль',ico:'👤',sec:'Аккаунт'},
  ],
  parent: [
    {id:'dashboard',label:'Главная',ico:'🏠',sec:'Обзор'},
    {id:'schedule',label:'Расписание',ico:'🗓',sec:'Ребёнок'},
    {id:'grades',label:'Успеваемость',ico:'📊',sec:'Ребёнок'},
    {id:'assignments',label:'Задания',ico:'📋',sec:'Ребёнок'},
    {id:'attendance',label:'Посещаемость',ico:'✅',sec:'Ребёнок'},
    {id:'notifications',label:'Уведомления',ico:'🔔',sec:'Аккаунт'},
    {id:'profile',label:'Профиль',ico:'👤',sec:'Аккаунт'},
  ],
};

// ── VIEWS ─────────────────────────────────────────────────────────────────────

// ·· SUPER ADMIN DASHBOARD
function SuperDash() {
  const { data, loading } = useApi(() => API.get('/api/v1/centers'));
  const isMobile = useIsMobile();
  if (loading) return <Spinner/>;
  const totalStudents = data?.reduce((s,c)=>s+(c.student_count||0),0)||0;
  const totalTeachers = data?.reduce((s,c)=>s+(c.teacher_count||0),0)||0;
  const activeCenters = data?.filter(c=>c.is_active).length||0;
  return (
    <div className="fade">
      <div className="ph"><div className="pt">Платформа BilimHub</div><div className="ps">Сводка по всем центрам</div></div>
      <StatGrid stats={[
        {label:'Центров',value:activeCenters,sub:`Всего: ${data?.length||0}`,icon:'🏫',color:'hsl(160,50%,40%)'},
        {label:'Учеников',value:totalStudents,sub:'Активных',icon:'🎓',color:'#10b981'},
        {label:'Учителей',value:totalTeachers,sub:'Активных',icon:'👨‍🏫',color:'#f59e0b'},
      ]}/>
      <div className="card">
        <div className="ch"><div className="ct">Зарегистрированные центры</div></div>
        <div className="cb" style={{padding:0}}>
          <ResponsiveTable
            headers={['Центр','Код','Учеников','Учителей','Статус']}
            rows={data||[]}
            renderRow={c => (
              <tr key={c.id}>
                <td style={{fontWeight:600}}>{c.name}</td>
                <td><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--muted)'}}>{c.code}</span></td>
                <td>{c.student_count||0}</td>
                <td>{c.teacher_count||0}</td>
                <td><span className={`bdg ${c.is_active?'bg':'br'}`}>{c.is_active?'Активен':'Неактивен'}</span></td>
              </tr>
            )}
            renderCard={c => (
              <div key={c.id} className="mobile-card-item">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <span style={{fontWeight:700,fontSize:14}}>{c.name}</span>
                  <span className={`bdg ${c.is_active?'bg':'br'}`}>{c.is_active?'Активен':'Неактивен'}</span>
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',fontSize:12,color:'var(--muted)'}}>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",background:'#f3f4f6',padding:'2px 6px',borderRadius:4,fontSize:11}}>{c.code}</span>
                </div>
                <div style={{display:'flex',gap:16,marginTop:8,fontSize:12}}>
                  <span>🎓 {c.student_count||0} уч.</span>
                  <span>👨‍🏫 {c.teacher_count||0} преп.</span>
                </div>
              </div>
            )}
            emptyIcon="🏫"
            emptyText="Нет центров"
          />
        </div>
      </div>
    </div>
  );
}

// ·· SUPER ADMIN — CENTERS MANAGEMENT
function CentersView() {
  const { data: centers, loading, reload } = useApi(() => API.get('/api/v1/centers'));
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name:'', plan:'basic' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editErr, setEditErr] = useState('');
  // Invite token generation
  const [inviteCenter, setInviteCenter] = useState(null); // center object to create invite for
  const [inviteRole, setInviteRole] = useState('center_admin');
  const [inviteLabel, setInviteLabel] = useState('');
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteErr, setInviteErr] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // New center result (show token creation prompt)
  const [newCenter, setNewCenter] = useState(null);

  const set = k => e => setForm(p=>({...p,[k]:e.target.value}));

  async function create(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    try {
      const created = await API.post('/api/v1/centers', form);
      reload(); setShowCreate(false); setForm({name:'',plan:'basic'});
      // After creating, prompt to create first admin
      setNewCenter(created);
    } catch(ex) { setErr(ex.message); }
    setSaving(false);
  }

  async function toggleActive(c) {
    try { await API.patch(`/api/v1/centers/${c.id}`, { is_active: c.is_active ? 0 : 1 }); reload(); }
    catch(ex) { alert(ex.message); }
  }

  async function saveEdit(e) {
    e.preventDefault(); setEditErr('');
    try {
      await API.patch(`/api/v1/centers/${editId}`, editForm);
      reload(); setEditId(null);
    } catch(ex) { setEditErr(ex.message); }
  }

  async function createInvite(e) {
    e.preventDefault(); setInviteErr(''); setInviteLoading(true);
    try {
      const result = await API.post(`/api/v1/tokens?centerId=${inviteCenter.id}`, {
        role: inviteRole,
        label: inviteLabel || `${roleLabel[inviteRole]} для ${inviteCenter.name}`,
        expiresInDays: 0,
        centerId: inviteCenter.id,
      });
      setInviteResult(result);
    } catch(ex) { setInviteErr(ex.message); }
    setInviteLoading(false);
  }

  function closeInvite() {
    setInviteCenter(null); setInviteResult(null); setInviteErr('');
    setInviteRole('center_admin'); setInviteLabel(''); setCopied(false);
  }

  function copyToken(token) {
    navigator.clipboard?.writeText(token).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false), 2000);
  }

  if (loading) return <Spinner/>;

  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}>
          <div className="pt">Управление центрами</div>
          <div className="ps">{centers?.length||0} центров в системе</div>
        </div>
        <button className="btn btn-p" onClick={()=>setShowCreate(true)}>🏫 Создать центр</button>
      </div>

      {/* How it works hint */}
      <div className="card" style={{padding:'14px 18px',marginBottom:16,background:'var(--primary-light)',border:'1px solid hsl(160,40%,85%)'}}>
        <div style={{fontWeight:700,fontSize:13,color:'var(--primary)',marginBottom:6}}>📋 Как подключить центр?</div>
        <div style={{fontSize:12,color:'var(--text)',lineHeight:1.6}}>
          <b>1.</b> Создайте центр → <b>2.</b> Нажмите 🔑 чтобы создать инвайт-токен для администратора центра → <b>3.</b> Отправьте токен директору → <b>4.</b> Директор регистрируется по токену на странице входа → <b>5.</b> Он получает доступ к панели управления центра
        </div>
      </div>

      <div className="card">
        <div className="cb" style={{padding:0}}>
          <ResponsiveTable
            headers={['Название','Код','Учеников','Учителей','Создан','Статус','Действия']}
            rows={centers||[]}
            emptyIcon="🏫" emptyText="Нет центров"
            renderRow={c=>(
              <tr key={c.id}>
                <td style={{fontWeight:700}}>{c.name}</td>
                <td><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--muted)',background:'#f3f4f6',padding:'2px 6px',borderRadius:4}}>{c.code}</span></td>
                <td style={{fontWeight:600}}>{c.student_count||0}</td>
                <td style={{fontWeight:600}}>{c.teacher_count||0}</td>
                <td style={{fontSize:11,color:'var(--muted)'}}>{fmtDate(c.created_at)}</td>
                <td><span className={`bdg ${c.is_active?'bg':'br'}`}>{c.is_active?'Активен':'Неактивен'}</span></td>
                <td>
                  <div style={{display:'flex',gap:5}}>
                    <button className="btn btn-s btn-sm" title="Создать инвайт-токен" onClick={()=>{setInviteCenter(c);setInviteRole('center_admin');setInviteLabel('');setInviteResult(null);setInviteErr('');}}>🔑</button>
                    <button className="btn btn-s btn-sm" title="Редактировать" onClick={()=>{setEditId(c.id);setEditForm({name:c.name,plan:c.plan});setEditErr('');}}>✏️</button>
                    <button className={`btn btn-sm ${c.is_active?'btn-d':'btn-g'}`} onClick={()=>toggleActive(c)}>
                      {c.is_active?'Откл.':'Вкл.'}
                    </button>
                  </div>
                </td>
              </tr>
            )}
            renderCard={c=>(
              <div key={c.id} className="card" style={{padding:'14px 16px',marginBottom:8}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15}}>{c.name}</div>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--muted)',background:'#f3f4f6',padding:'2px 6px',borderRadius:4}}>{c.code}</span>
                  </div>
                  <span className={`bdg ${c.is_active?'bg':'br'}`}>{c.is_active?'Активен':'Неактивен'}</span>
                </div>
                <div style={{display:'flex',gap:12,fontSize:12,color:'var(--muted)',marginBottom:10}}>
                  <span><b>{c.student_count||0}</b> учеников</span>
                  <span><b>{c.teacher_count||0}</b> учителей</span>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button className="btn btn-s btn-sm" onClick={()=>{setInviteCenter(c);setInviteRole('center_admin');setInviteLabel('');setInviteResult(null);setInviteErr('');}}>🔑 Инвайт</button>
                  <button className="btn btn-s btn-sm" onClick={()=>{setEditId(c.id);setEditForm({name:c.name,plan:c.plan});setEditErr('');}}>✏️</button>
                  <button className={`btn btn-sm ${c.is_active?'btn-d':'btn-g'}`} onClick={()=>toggleActive(c)}>{c.is_active?'Откл.':'Вкл.'}</button>
                </div>
              </div>
            )}
          />
        </div>
      </div>

      {showCreate && (
        <Modal title="🏫 Создать центр" onClose={()=>setShowCreate(false)}>
          <Alert msg={err}/>
          <form onSubmit={create}>
            <div className="fg"><label className="fl">Название центра</label>
              <input className="fi" required value={form.name} onChange={set('name')} placeholder="Astana Excellence Academy"/>
            </div>
            <div className="fg"><label className="fl">Тариф</label>
              <select className="fi" value={form.plan} onChange={set('plan')}>
                <option value="basic">Basic</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div style={{background:'var(--primary-light)',borderRadius:8,padding:'10px 12px',fontSize:12,color:'var(--primary)',marginBottom:14}}>
              ℹ️ Уникальный код центра будет сгенерирован автоматически
            </div>
            <div style={{display:'flex',gap:8}}>
              <button type="submit" className="btn btn-p" style={{flex:1}} disabled={saving}>{saving?'Создание...':'Создать'}</button>
              <button type="button" className="btn btn-s" onClick={()=>setShowCreate(false)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Prompt after center creation */}
      {newCenter && (
        <Modal title="✅ Центр создан!" onClose={()=>setNewCenter(null)}>
          <div style={{background:'var(--green-s)',border:'1px solid #a7f3d0',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
            <div style={{fontWeight:700,color:'#059669',marginBottom:4}}>Центр «{newCenter.name}» успешно создан</div>
            <div style={{fontSize:12}}>Код центра: <b style={{fontFamily:"'JetBrains Mono',monospace"}}>{newCenter.code}</b></div>
          </div>
          <div style={{fontSize:13,color:'var(--muted)',marginBottom:14,lineHeight:1.6}}>
            <b>Следующий шаг:</b> создайте инвайт-токен для администратора (директора) этого центра. Директор зарегистрируется по токену и получит доступ к управлению.
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-p" style={{flex:1}} onClick={()=>{
              setNewCenter(null);
              setInviteCenter(newCenter);
              setInviteRole('center_admin');
              setInviteLabel(`Директор ${newCenter.name}`);
              setInviteResult(null); setInviteErr('');
            }}>🔑 Создать токен для директора</button>
            <button className="btn btn-s" onClick={()=>setNewCenter(null)}>Позже</button>
          </div>
        </Modal>
      )}

      {editId && (
        <Modal title="✏️ Редактировать центр" onClose={()=>setEditId(null)}>
          <Alert msg={editErr}/>
          <form onSubmit={saveEdit}>
            <div className="fg"><label className="fl">Название</label>
              <input className="fi" required value={editForm.name||''} onChange={e=>setEditForm(p=>({...p,name:e.target.value}))} />
            </div>
            <div className="fg"><label className="fl">Тариф</label>
              <select className="fi" value={editForm.plan||'basic'} onChange={e=>setEditForm(p=>({...p,plan:e.target.value}))}>
                <option value="basic">Basic</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button type="submit" className="btn btn-p" style={{flex:1}}>Сохранить</button>
              <button type="button" className="btn btn-s" onClick={()=>setEditId(null)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Invite token modal */}
      {inviteCenter && (
        <Modal title={`🔑 Инвайт для «${inviteCenter.name}»`} onClose={closeInvite}>
          {!inviteResult ? (
            <>
              <Alert msg={inviteErr}/>
              <div style={{background:'var(--surface2)',borderRadius:8,padding:'10px 13px',marginBottom:14,border:'1px solid var(--border)'}}>
                <div style={{fontSize:12,fontWeight:600}}>{inviteCenter.name}</div>
                <div style={{fontSize:11,color:'var(--muted)'}}>Код: {inviteCenter.code} · Тариф: {inviteCenter.plan}</div>
              </div>
              <form onSubmit={createInvite}>
                <div className="fg"><label className="fl">Роль</label>
                  <select className="fi" value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>
                    <option value="center_admin">Администратор (директор)</option>
                    <option value="teacher">Учитель</option>
                    <option value="student">Ученик</option>
                    <option value="parent">Родитель</option>
                  </select>
                </div>
                <div className="fg"><label className="fl">Метка (необязательно)</label>
                  <input className="fi" value={inviteLabel} onChange={e=>setInviteLabel(e.target.value)} placeholder="Например: Директор Иванов"/>
                </div>
                <div style={{display:'flex',gap:8,marginTop:14}}>
                  <button type="submit" className="btn btn-p" style={{flex:1}} disabled={inviteLoading}>
                    {inviteLoading ? 'Создание...' : '🔑 Создать токен'}
                  </button>
                  <button type="button" className="btn btn-s" onClick={closeInvite}>Отмена</button>
                </div>
              </form>
            </>
          ) : (
            <div>
              <div style={{background:'var(--green-s)',border:'1px solid #a7f3d0',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
                <div style={{fontWeight:700,color:'#059669',marginBottom:6}}>✅ Инвайт-токен создан!</div>
                <div style={{fontSize:12,color:'var(--muted)',marginBottom:8}}>
                  Роль: <b>{roleLabel[inviteResult.role]}</b> · Центр: <b>{inviteCenter.name}</b>
                </div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:700,background:'#fff',border:'1px solid var(--border)',borderRadius:8,padding:'12px 16px',letterSpacing:1,textAlign:'center',userSelect:'all',wordBreak:'break-all'}}>
                  {inviteResult.token}
                </div>
              </div>
              <div style={{background:'var(--primary-light)',border:'1px solid hsl(160,40%,85%)',borderRadius:8,padding:'12px 14px',marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:13,color:'var(--primary)',marginBottom:6}}>📋 Инструкция для получателя:</div>
                <ol style={{fontSize:12,color:'var(--text)',lineHeight:1.8,paddingLeft:18,margin:0}}>
                  <li>Откройте сайт: <b>{window.location.origin}</b></li>
                  <li>Нажмите <b>«Регистрация»</b></li>
                  <li>Вставьте токен: <b style={{fontFamily:"'JetBrains Mono',monospace"}}>{inviteResult.token}</b></li>
                  <li>Заполните имя, email и пароль</li>
                  <li>После регистрации вы получите доступ как <b>{roleLabel[inviteResult.role]}</b></li>
                </ol>
              </div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:12}}>
                {new Date(inviteResult.expires_at).getFullYear()>=2099?'♾ Бессрочный':'⏱ Действителен до: '+fmtDate(inviteResult.expires_at)} · Одноразовый — использовать может только один человек.
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-p" style={{flex:1}} onClick={()=>copyToken(inviteResult.token)}>
                  {copied ? '✅ Скопировано!' : '📋 Скопировать токен'}
                </button>
                <button className="btn btn-s" onClick={closeInvite}>Закрыть</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ·· CENTER ADMIN DASHBOARD
function CenterDash({ user, center }) {
  const { data: stats, loading } = useApi(() => API.get(`/api/v1/centers/stats?centerId=${user.centerId}`));
  if (loading) return <Spinner/>;
  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}>
          <div className="pt">{center?.name || 'Центр'}</div>
          <div className="ps" style={{display:'flex',alignItems:'center',gap:8,marginTop:5,flexWrap:'wrap'}}>
            <span style={{fontFamily:"'JetBrains Mono',monospace",background:'#f3f4f6',padding:'2px 7px',borderRadius:4,fontSize:11}}>{center?.code}</span>
          </div>
        </div>
      </div>
      <StatGrid stats={[
        {label:'Учеников',value:stats?.students||0,sub:`В центре`,icon:'🎓',color:'hsl(160,50%,40%)'},
        {label:'Учителей',value:stats?.teachers||0,sub:'Активных',icon:'👨‍🏫',color:'#10b981'},
        {label:'Классов',value:stats?.classes||0,sub:'Активных',icon:'📚',color:'#f59e0b'},
        {label:'Токенов',value:stats?.activeTokens||0,sub:'Активных инвайтов',icon:'🔑',color:'hsl(220,60%,55%)'},
      ]}/>
      <div className="g2">
        <div className="card">
          <div className="ch"><div className="ct">Активные токены</div></div>
          <div className="cb">
            <div style={{fontSize:36,fontWeight:800,color:'var(--accent)'}}>{stats?.activeTokens||0}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Инвайт-кодов ожидает использования</div>
          </div>
        </div>
        <div className="card">
          <div className="ch"><div className="ct">Всего заданий</div></div>
          <div className="cb">
            <div style={{fontSize:36,fontWeight:800,color:'#10b981'}}>{stats?.assignments||0}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Опубликованных заданий</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ·· TEACHER DASHBOARD
function TeacherDash({ user }) {
  const { data: classes, loading } = useApi(() => API.get('/api/v1/classes'));
  const { data: assignments } = useApi(() => API.get('/api/v1/assignments'));
  if (loading) return <Spinner/>;
  return (
    <div className="fade">
      <div className="ph"><div className="pt">Кабинет учителя</div><div className="ps">{user.name}</div></div>
      <StatGrid stats={[
        {label:'Мои классы',value:classes?.length||0,sub:'Активных',icon:'📚',color:'#4f46e5'},
        {label:'Заданий',value:assignments?.length||0,sub:'Опубликовано',icon:'📋',color:'#f59e0b'},
        {label:'Не проверено',value:assignments?.reduce((s,a)=>s+(a.pending_grading||0),0)||0,sub:'Ждут оценки',icon:'⏳',color:'#ef4444'},
        {label:'Учеников',value:classes?.reduce((s,c)=>s+(c.student_count||0),0)||0,sub:'Всего',icon:'🎓',color:'#10b981'},
      ]}/>
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Мои классы</div>
      <div className="g3" style={{marginBottom:16}}>
        {(classes||[]).map(c=>(
          <div className="card" key={c.id} style={{padding:'14px 16px',borderLeft:`4px solid ${c.color||'#6366f1'}`}}>
            <div style={{fontWeight:700,fontSize:13}}>{c.name}</div>
            <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{c.subject} · {c.student_count||0} учеников</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ·· STUDENT DASHBOARD
function StudentDash({ user }) {
  const { data: grades, loading } = useApi(() => API.get(`/api/v1/grades/student/${user.id}`));
  const { data: assignments } = useApi(() => API.get('/api/v1/assignments'));
  if (loading) return <Spinner/>;
  const pending = (assignments||[]).filter(a=>!a.submission_id && new Date(a.due_date)>=new Date());
  const overdue = (assignments||[]).filter(a=>!a.submission_id && new Date(a.due_date)<new Date());
  const avgPct = grades?.length ? Math.round(grades.filter(g=>g.pct!==null).reduce((s,g)=>s+(g.pct||0),0)/grades.filter(g=>g.pct!==null).length) : null;
  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',alignItems:'center',gap:14}}>
        <div className="ava" style={{width:48,height:48,fontSize:18,background:`linear-gradient(135deg,${avaColor('student')},#ef4444)`,borderRadius:14}}>{initials(user.name)}</div>
        <div><div className="pt">{user.name}</div><div className="ps">Ученик</div></div>
      </div>
      <StatGrid stats={[
        {label:'Средний балл',value:avgPct!==null?`${avgPct}%`:'—',sub:'По всем предметам',icon:'📈',color:'#10b981'},
        {label:'Заданий',value:pending.length,sub:'Нужно сдать',icon:'📋',color:'#4f46e5'},
        {label:'Просрочено',value:overdue.length,sub:'Нужно исправить',icon:'⚠️',color:'#ef4444'},
        {label:'Предметов',value:grades?.length||0,sub:'Активных',icon:'📚',color:'#f59e0b'},
      ]}/>
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Оценки по предметам</div>
      <div className="card">
        <div style={{padding:'2px 18px'}}>
          {(grades||[]).map((g,i)=>(
            <div key={g.id} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 0',borderBottom:i<grades.length-1?'1px solid var(--border)':'none'}}>
              <div className="gc" style={{background:gBg(g.pct),color:gColor(g.pct)}}>{g.letter||'—'}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{g.name}</div>
                <div style={{fontSize:11,color:'var(--muted)'}}>{g.teacher_name} · {g.subject}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontWeight:800,fontSize:16,color:gColor(g.pct)}}>{g.pct!==null?`${g.pct}%`:'—'}</div>
                <div style={{fontSize:11,color:'var(--muted)'}}>{g.totalScore}/{g.totalMax} б.</div>
              </div>
            </div>
          ))}
          {(!grades||!grades.length)&&<div className="empty"><div className="empty-ico">📊</div>Нет данных</div>}
        </div>
      </div>
    </div>
  );
}

// ·· PARENT DASHBOARD
function ParentDash({ user }) {
  const { data: children } = useApi(() => API.get('/api/v1/users/me/children'));
  const [childId, setChildId] = useState(null);
  const effectiveChildId = childId || children?.[0]?.id;
  const { data: grades } = useApi(() => effectiveChildId ? API.get(`/api/v1/grades/student/${effectiveChildId}`) : Promise.resolve([]), [effectiveChildId]);
  const child = children?.find(c=>c.id===effectiveChildId);
  const avgPct = grades?.filter(g=>g.pct!==null).length ? Math.round(grades.filter(g=>g.pct!==null).reduce((s,g)=>s+g.pct,0)/grades.filter(g=>g.pct!==null).length) : null;
  return (
    <div className="fade">
      <div className="ph"><div className="pt">Родительский кабинет</div><div className="ps">{user.name}</div></div>
      {children?.length>1 && (
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {children.map(c=>(
            <button key={c.id} className={`btn ${effectiveChildId===c.id?'btn-p':'btn-s'}`} onClick={()=>setChildId(c.id)}>{c.name}</button>
          ))}
        </div>
      )}
      {child && (
        <div className="card" style={{padding:'16px 18px',marginBottom:16,display:'flex',alignItems:'center',gap:14}}>
          <div className="ava" style={{width:48,height:48,fontSize:18,background:`linear-gradient(135deg,#f59e0b,#ef4444)`,borderRadius:14}}>{initials(child.name)}</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:800,fontSize:16}}>{child.name}</div>
            <div style={{fontSize:12,color:'var(--muted)'}}>Средний балл: <strong style={{color:gColor(avgPct||0)}}>{avgPct!==null?`${avgPct}%`:'—'}</strong></div>
          </div>
          <span className="bdg bg">✅ Активен</span>
        </div>
      )}
      <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Оценки по предметам</div>
      <div className="card">
        <div style={{padding:'2px 18px'}}>
          {(grades||[]).map((g,i)=>(
            <div key={g.id} style={{display:'flex',alignItems:'center',gap:12,padding:'11px 0',borderBottom:i<grades.length-1?'1px solid var(--border)':'none'}}>
              <div className="gc" style={{background:gBg(g.pct),color:gColor(g.pct)}}>{g.letter||'—'}</div>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{g.name}</div><div style={{fontSize:11,color:'var(--muted)'}}>{g.teacher_name}</div></div>
              <div style={{textAlign:'right'}}><div style={{fontWeight:800,fontSize:16,color:gColor(g.pct)}}>{g.pct!==null?`${g.pct}%`:'—'}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ·· TOKENS VIEW
function TokensView() {
  const user = API.getUser();
  const confirm = useConfirm();
  const isSuperAdmin = user?.role === 'super_admin';
  const { data: centers } = useApi(() => isSuperAdmin ? API.get('/api/v1/centers') : Promise.resolve(null));
  const [centerId, setCenterId] = useState(null);
  const effectiveCenterId = isSuperAdmin ? (centerId || centers?.[0]?.id) : null;
  const tokenUrl = isSuperAdmin && effectiveCenterId ? `/api/v1/tokens?centerId=${effectiveCenterId}` : '/api/v1/tokens';
  const studentUrl = isSuperAdmin && effectiveCenterId ? `/api/v1/users?role=student&centerId=${effectiveCenterId}` : '/api/v1/users?role=student';
  const { data: tokens, loading, reload } = useApi(() => {
    if (isSuperAdmin && !effectiveCenterId) return Promise.resolve([]);
    return API.get(tokenUrl);
  }, [tokenUrl, effectiveCenterId]);
  const { data: students } = useApi(() => {
    if (isSuperAdmin && !effectiveCenterId) return Promise.resolve([]);
    return API.get(studentUrl);
  }, [studentUrl, effectiveCenterId]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ role:'student', label:'', expiresInDays:0, linkedStudentId:'' });
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(null);
  const set = k => e => setForm(p=>({...p,[k]:e.target.value}));

  async function create(e) {
    e.preventDefault(); setErr('');
    try {
      const payload = { ...form };
      if (form.linkedStudentId) payload.linkedStudentId = parseInt(form.linkedStudentId);
      else delete payload.linkedStudentId;
      if (isSuperAdmin && effectiveCenterId) payload.centerId = effectiveCenterId;
      const url = isSuperAdmin && effectiveCenterId ? `/api/v1/tokens?centerId=${effectiveCenterId}` : '/api/v1/tokens';
      await API.post(url, payload);
      reload(); setShowModal(false); setForm({role:'student',label:'',expiresInDays:0,linkedStudentId:''});
    } catch(ex) { setErr(ex.message); }
  }

  async function revoke(id) {
    const ok = await confirm('Токен будет отозван и больше не сможет быть использован.', 'Отозвать токен?', { icon: '⚠️', danger: true, confirmText: 'Отозвать' });
    if (!ok) return;
    try { await API.del(`/api/v1/tokens/${id}`); reload(); } catch(ex) { alert(ex.message); }
  }

  function copy(token, id) {
    navigator.clipboard?.writeText(token).catch(()=>{});
    setCopied(id); setTimeout(()=>setCopied(null),2000);
  }

  if (loading) return <Spinner/>;
  const active = (tokens||[]).filter(t=>!t.used_by);
  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}><div className="pt">Управление токенами</div><div className="ps">Инвайт-коды для подключения пользователей</div></div>
        <button className="btn btn-p" onClick={()=>setShowModal(true)}>🔑 Создать токен</button>
      </div>
      <div className="card" style={{padding:'14px 18px',marginBottom:16}}>
        <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
          <div style={{fontSize:13,color:'var(--muted)',flex:'1 1 200px',minWidth:0}}>
            Создайте токен → Отправьте пользователю → Он регистрируется → Автоматически привязывается к центру
          </div>
          {[{label:'Всего',val:(tokens||[]).length,c:'#4f46e5'},{label:'Активных',val:active.length,c:'#10b981'},{label:'Использовано',val:(tokens||[]).length-active.length,c:'#6b7280'}].map(s=>(
            <div key={s.label} style={{textAlign:'center'}}>
              <div style={{fontWeight:800,fontSize:22,color:s.c}}>{s.val}</div>
              <div style={{fontSize:10,color:'var(--muted)'}}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      {isSuperAdmin && centers?.length > 0 && (
        <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:10}}>
          <label style={{fontSize:12,fontWeight:600,color:'var(--muted)'}}>Центр:</label>
          <select className="fi" style={{width:'100%',maxWidth:320}} value={effectiveCenterId||''} onChange={e=>setCenterId(parseInt(e.target.value))}>
            {centers.map(c=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(min(320px,100%),1fr))',gap:12}}>
        {(tokens||[]).map(t=>(
          <div className="card" key={t.id} style={{padding:'13px 15px',opacity:t.used_by?0.65:1}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div><div style={{fontWeight:700,fontSize:13}}>{t.label||'Без метки'}</div>{t.linked_student_name&&<div style={{fontSize:11,color:'#ec4899',marginTop:2}}>👶 {t.linked_student_name}</div>}<div style={{fontSize:10,color:'var(--muted)',marginTop:1}}>{new Date(t.expires_at).getFullYear()>=2099?'♾ Бессрочный':`Истекает ${fmtDate(t.expires_at)}`}</div></div>
              <span className={`bdg ${t.role==='teacher'?'bp':t.role==='student'?'bg':t.role==='parent'?'ba':'bb'}`}>{roleLabel[t.role]}</span>
            </div>
            <div className="tok-str">
              <span>{t.token}</span>
              <span style={{cursor:'pointer',fontSize:14,opacity:.7}} onClick={()=>copy(t.token,t.id)}>{copied===t.id?'✅':'📋'}</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span className={`bdg ${t.used_by?'bk':'bg'}`}>{t.used_by?`✓ ${t.used_by_name||'Использован'}`:'⬤ Активен'}</span>
              {!t.used_by && <button className="btn btn-d btn-sm" onClick={()=>revoke(t.id)}>Отозвать</button>}
            </div>
          </div>
        ))}
      </div>
      {showModal && (
        <Modal title="🔑 Создать инвайт-токен" onClose={()=>setShowModal(false)}>
          <Alert msg={err}/>
          <form onSubmit={create}>
            <div className="fg"><label className="fl">Роль</label>
              <select className="fi" value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value,linkedStudentId:''}))}>
                <option value="student">Ученик</option><option value="teacher">Учитель</option>
                <option value="parent">Родитель</option>
                {isSuperAdmin && <option value="center_admin">Администратор (директор)</option>}
              </select>
            </div>
            {form.role==='parent' && (
              <div className="fg"><label className="fl">Ребёнок <span style={{color:'var(--muted)',fontWeight:400}}>(привязать к ученику)</span></label>
                <select className="fi" value={form.linkedStudentId} onChange={set('linkedStudentId')}>
                  <option value="">— выберите ученика —</option>
                  {(students||[]).map(s=><option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
                </select>
              </div>
            )}
            <div className="fg"><label className="fl">Метка</label><input className="fi" value={form.label} onChange={set('label')} placeholder="Например: Мама Алины"/></div>
            <div className="fg"><label className="fl">Срок действия</label>
              <select className="fi" value={form.expiresInDays} onChange={set('expiresInDays')}>
                <option value={0}>♾ Бессрочный (до использования)</option>
                <option value={7}>7 дней</option><option value={14}>14 дней</option>
                <option value={30}>30 дней</option><option value={90}>90 дней</option>
              </select>
            </div>
            <div style={{display:'flex',gap:8,marginTop:14}}>
              <button type="submit" className="btn btn-p" style={{flex:1}}>Создать</button>
              <button type="button" className="btn btn-s" onClick={()=>setShowModal(false)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ·· ATTENDANCE VIEW (teacher / center_admin)
function AttendanceTeacherView({ user }) {
  const isTeacher = user.role === 'teacher';
  const { data: classes } = useApi(() => API.get('/api/v1/classes'));
  const [classId, setClassId] = useState(null);
  const effectiveCls = classId || classes?.[0]?.id;

  // Month navigation
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthDates = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(year, month, i + 1);
    return d.toISOString().slice(0, 10);
  });
  const from = monthDates[0];
  const to = monthDates[monthDates.length - 1];

  const { data, loading, reload } = useApi(() =>
    effectiveCls ? API.get(`/api/v1/attendance/${effectiveCls}?from=${from}&to=${to}`) : Promise.resolve(null),
    [effectiveCls, from, to]
  );

  const [saving, setSaving] = useState({});

  const statusCycle = ['present', 'absent', 'late', 'excused'];
  const statusColors = { present: '#10b981', absent: '#ef4444', late: '#f59e0b', excused: '#6b7280' };
  const statusLabels = { present: '✓', absent: '✗', late: '⏱', excused: 'E' };
  const statusTitles = { present: 'Присутствует', absent: 'Отсутствует', late: 'Опоздал', excused: 'Уважительная' };

  const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DAY_SHORTS = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  function getRecord(studentId, date) {
    return (data?.records || []).find(r => r.student_id === studentId && r.date === date);
  }

  async function toggleCell(studentId, date) {
    if (!isTeacher) return;
    const rec = getRecord(studentId, date);
    const currentStatus = rec?.status || null;
    const nextIdx = currentStatus ? (statusCycle.indexOf(currentStatus) + 1) % statusCycle.length : 0;
    const nextStatus = statusCycle[nextIdx];

    const key = `${studentId}-${date}`;
    setSaving(p => ({ ...p, [key]: true }));
    try {
      await API.patch(`/api/v1/attendance/${effectiveCls}/${studentId}/${date}`, { status: nextStatus });
      reload();
    } catch (ex) { console.error(ex); }
    setSaving(p => ({ ...p, [key]: false }));
  }

  async function fillDayAll(date, status) {
    if (!isTeacher || !data?.summary) return;
    setSaving(p => ({ ...p, [`day-${date}`]: true }));
    try {
      const records = data.summary.map(s => ({ studentId: s.id, status }));
      await API.post(`/api/v1/attendance/${effectiveCls}`, { date, records });
      reload();
    } catch (ex) { console.error(ex); }
    setSaving(p => ({ ...p, [`day-${date}`]: false }));
  }

  function exportCsv() {
    if (!effectiveCls) return;
    window.open(`/api/v1/attendance/${effectiveCls}/export?token=${API.getToken()}`, '_blank');
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }

  // Compute summary for current month from loaded records
  function getMonthSummary(studentId) {
    const recs = (data?.records || []).filter(r => r.student_id === studentId);
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    recs.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
    const total = recs.length;
    const pct = total > 0 ? Math.round(((counts.present + counts.late * 0.5) / total) * 100) : 100;
    return { ...counts, total, pct };
  }

  const todayStr = today.toISOString().slice(0, 10);
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}>
          <div className="pt">Посещаемость</div>
          {isTeacher && <div className="ps">Кликайте по ячейке для смены статуса: ✓ → ✗ → ⏱ → E</div>}
        </div>
        <div style={{display:'flex',gap:8}}>
          {effectiveCls && data && <button className="btn btn-s" onClick={exportCsv}>⬇ CSV</button>}
        </div>
      </div>

      {/* Class selector */}
      {classes?.length > 0 && (
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          {classes.map(c => (
            <button key={c.id} className={`btn ${effectiveCls===c.id?'btn-p':'btn-s'}`} onClick={()=>setClassId(c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      {/* Month navigation */}
      <div className="card" style={{padding:'10px 16px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <button className="btn btn-s btn-sm" onClick={prevMonth}>← {MONTH_NAMES[(month+11)%12].slice(0,3)}</button>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontWeight:800,fontSize:16}}>{MONTH_NAMES[month]} {year}</span>
          {!isCurrentMonth && <button className="btn btn-s btn-sm" onClick={goToday}>Сегодня</button>}
        </div>
        <button className="btn btn-s btn-sm" onClick={nextMonth}>{MONTH_NAMES[(month+1)%12].slice(0,3)} →</button>
      </div>

      {loading ? <Spinner/> : data ? (
        <div className="card">
          <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
            <table className="tbl" style={{minWidth: Math.min(200 + daysInMonth * 38, 1200)}}>
              <thead>
                <tr>
                  <th style={{position:'sticky',left:0,background:'var(--surface2)',zIndex:2,minWidth:140}}>Ученик</th>
                  <th style={{textAlign:'center',minWidth:50}}>%</th>
                  {monthDates.map(d => {
                    const dayNum = parseInt(d.slice(8));
                    const dayOfWeek = new Date(d).getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const isToday = d === todayStr;
                    return (
                      <th key={d} style={{
                        textAlign:'center',padding:'4px 2px',minWidth:34,
                        background: isToday ? 'var(--primary-light)' : isWeekend ? '#f9fafb' : 'var(--surface2)',
                        borderBottom: isToday ? '2px solid var(--primary)' : undefined,
                      }}>
                        <div style={{fontSize:8,color:isWeekend?'var(--red)':'var(--muted)',lineHeight:1}}>{DAY_SHORTS[dayOfWeek]}</div>
                        <div style={{fontSize:11,fontWeight:700,color:isToday?'var(--primary)':isWeekend?'var(--red)':'var(--text)'}}>{dayNum}</div>
                        {isTeacher && (
                          <div style={{marginTop:2,cursor:'pointer',fontSize:8,color:'var(--muted)',opacity:.6}} title="Всех ✓"
                            onClick={()=>fillDayAll(d,'present')}>
                            {saving[`day-${d}`] ? '...' : '▼'}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(data.summary || []).map(s => {
                  const ms = getMonthSummary(s.id);
                  return (
                    <tr key={s.id}>
                      <td style={{position:'sticky',left:0,background:'#fff',zIndex:1,fontWeight:600,fontSize:12,whiteSpace:'nowrap',borderRight:'1px solid var(--border)'}}>
                        {s.name}
                      </td>
                      <td style={{textAlign:'center'}}>
                        <span style={{fontWeight:700,fontSize:11,color:ms.pct>=90?'var(--green)':ms.pct>=75?'#d97706':'var(--red)'}}>{ms.total > 0 ? `${ms.pct}%` : '—'}</span>
                      </td>
                      {monthDates.map(d => {
                        const rec = getRecord(s.id, d);
                        const status = rec?.status;
                        const dayOfWeek = new Date(d).getDay();
                        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                        const isToday = d === todayStr;
                        const key = `${s.id}-${d}`;
                        const isSaving = saving[key];
                        return (
                          <td key={d} style={{
                            textAlign:'center', padding:'3px 1px',
                            background: isToday ? 'var(--primary-light)' : isWeekend ? '#fafafa' : '#fff',
                            cursor: isTeacher ? 'pointer' : 'default',
                          }}
                            onClick={() => toggleCell(s.id, d)}
                            title={status ? statusTitles[status] : 'Не отмечено'}
                          >
                            {isSaving ? (
                              <span style={{fontSize:10,color:'var(--muted)'}}>···</span>
                            ) : status ? (
                              <span style={{
                                display:'inline-flex',alignItems:'center',justifyContent:'center',
                                width:26,height:26,borderRadius:6,fontSize:12,fontWeight:800,
                                background: statusColors[status] + '18',
                                color: statusColors[status],
                                transition: 'all .15s',
                              }}>{statusLabels[status]}</span>
                            ) : (
                              <span style={{
                                display:'inline-flex',alignItems:'center',justifyContent:'center',
                                width:26,height:26,borderRadius:6,fontSize:10,
                                color:'#d1d5db',
                              }}>{isTeacher ? '·' : '—'}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Legend + month summary */}
          <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
            <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
              {statusCycle.map(st => (
                <div key={st} style={{display:'flex',alignItems:'center',gap:4,fontSize:11}}>
                  <span style={{display:'inline-flex',width:20,height:20,borderRadius:5,alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,background:statusColors[st]+'18',color:statusColors[st]}}>{statusLabels[st]}</span>
                  <span style={{color:'var(--muted)'}}>{statusTitles[st]}</span>
                </div>
              ))}
            </div>
            <div style={{fontSize:11,color:'var(--muted)'}}>
              {MONTH_NAMES[month]} {year} · {daysInMonth} дней · {data.summary?.length || 0} учеников
            </div>
          </div>
        </div>
      ) : <div className="empty"><div className="empty-ico">✅</div>Выберите класс</div>}
    </div>
  );
}

function AttendanceView({ user }) {
  if (user.role === 'student' || user.role === 'parent') return <AttendancePersonalView user={user}/>;
  return <AttendanceTeacherView user={user}/>;
}

function AttendancePersonalView({ user }) {
  const { data: children } = useApi(() => user.role==='parent' ? API.get('/api/v1/users/me/children') : Promise.resolve(null));
  const [childId, setChildId] = useState(null);
  const targetId = user.role==='parent' ? (childId||children?.[0]?.id) : user.id;
  const { data, loading } = useApi(() => targetId ? API.get(`/api/v1/attendance/my/${targetId}`) : Promise.resolve(null), [targetId]);

  const sCol = { present:'#10b981', absent:'#ef4444', late:'#f59e0b', excused:'#6b7280' };
  const sIco  = { present:'✓', absent:'✗', late:'⏱', excused:'E' };
  const sLbl  = { present:'Присут.', absent:'Пропуск', late:'Опоздал', excused:'Уваж.' };

  return (
    <div className="fade">
      <div className="ph"><div className="pt">Моя посещаемость</div></div>
      {user.role==='parent' && children?.length>1 && (
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          {children.map(c=><button key={c.id} className={`btn ${targetId===c.id?'btn-p':'btn-s'}`} onClick={()=>setChildId(c.id)}>{c.name}</button>)}
        </div>
      )}
      {loading ? <Spinner/> : data ? (
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          {(data.classes||[]).map(cls=>(
            <div className="card" key={cls.id}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:8,height:40,borderRadius:4,background:cls.color||'var(--primary)',flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:800,fontSize:16}}>{cls.name}</div>
                  {cls.subject && <div style={{fontSize:12,color:'var(--muted)'}}>{cls.subject}</div>}
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:800,fontSize:22,color:cls.pct>=90?'var(--green)':cls.pct>=75?'#d97706':'var(--red)'}}>{cls.pct}%</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>{cls.present}✓ {cls.absent}✗ {cls.late}⏱</div>
                </div>
              </div>
              <div className="cb" style={{padding:'10px 0 6px'}}>
                {cls.records.length > 0 ? (
                  <table className="tbl" style={{fontSize:11}}>
                    <thead><tr><th>Дата</th><th>Статус</th></tr></thead>
                    <tbody>
                      {cls.records.map((r,i)=>(
                        <tr key={i}>
                          <td style={{fontWeight:600,maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(r.date)}</td>
                          <td style={{textAlign:'center'}}>
                            <span className={`bdg ${r.status==='graded'?'bg':r.status==='submitted'?'ba':'bk'}`}>{r.status==='graded'?'Проверено':r.status==='submitted'?'Сдано':'—'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div style={{textAlign:'center',padding:'12px',fontSize:12,color:'var(--muted)'}}>Нет данных</div>}
              </div>
            </div>
          ))}
          {(!data.classes||!data.classes.length)&&<div className="empty"><div className="empty-ico">📊</div>Нет данных о посещаемости</div>}
        </div>
      ) : <div className="empty"><div className="empty-ico">✅</div>Загрузка...</div>}
    </div>
  );
}

// ·· GRADES VIEW (student/parent)
function GradesView({ user }) {
  const [childId, setChildId] = useState(null);
  const { data: children } = useApi(() => user.role==='parent' ? API.get('/api/v1/users/me/children') : Promise.resolve(null));
  const targetId = user.role==='parent' ? (childId||children?.[0]?.id) : user.id;
  const { data: grades, loading } = useApi(() => targetId ? API.get(`/api/v1/grades/student/${targetId}`) : Promise.resolve([]), [targetId]);

  return (
    <div className="fade">
      <div className="ph"><div className="pt">Оценки</div></div>
      {user.role==='parent' && children?.length>1 && (
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {children.map(c=><button key={c.id} className={`btn ${targetId===c.id?'btn-p':'btn-s'}`} onClick={()=>setChildId(c.id)}>{c.name}</button>)}
        </div>
      )}
      {loading ? <Spinner/> : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {(grades||[]).map(g=>(
            <div className="card" key={g.id}>
              <div style={{padding:'14px 18px',display:'flex',alignItems:'center',gap:12,borderBottom:'1px solid var(--border)'}}>
                <div className="gc" style={{background:gBg(g.pct),color:gColor(g.pct),width:50,height:50,fontSize:16}}>{g.letter||'—'}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:800,fontSize:15}}>{g.name}</div>
                  <div style={{fontSize:12,color:'var(--muted)'}}>{g.subject} · {g.teacher_name}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontWeight:800,fontSize:22,color:gColor(g.pct)}}>{g.pct!==null?`${g.pct}%`:'—'}</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>{g.totalScore}/{g.totalMax} баллов</div>
                </div>
              </div>
              <div className="cb" style={{padding:'10px 0 6px'}}>
                {g.submissions.length > 0 ? (
                  <table className="tbl" style={{fontSize:11}}>
                    <thead><tr><th>Задание</th><th>Тип</th><th>До</th><th>Балл</th><th>Статус</th></tr></thead>
                    <tbody>
                      {g.submissions.map((s,i)=>(
                        <tr key={i}>
                          <td style={{fontWeight:600,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</td>
                          <td>{typeIco(s.type)}</td>
                          <td style={{color:'var(--muted)'}}>{fmtDate(s.due_date)}</td>
                          <td>
                            {s.score!==null ? <span style={{fontWeight:700,color:gColor((s.score/s.max_score)*100)}}>{s.score}/{s.max_score}</span> : <span className="bdg ba">Не проверено</span>}
                          </td>
                          <td><span className={`bdg ${s.status==='graded'?'bg':s.status==='submitted'?'ba':'bk'}`}>{s.status==='graded'?'Проверено':s.status==='submitted'?'Сдано':'—'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div style={{textAlign:'center',padding:'12px',fontSize:12,color:'var(--muted)'}}>Нет сданных работ</div>}
              </div>
            </div>
          ))}
          {(!grades||!grades.length)&&<div className="empty"><div className="empty-ico">📊</div>Нет данных об оценках</div>}
        </div>
      )}
    </div>
  );
}

// ·· CLASSES VIEW
function ClassesView({ user }) {
  const { data: classes, loading, reload } = useApi(() => API.get('/api/v1/classes'));
  const { data: teachers } = useApi(() =>
    ['center_admin','super_admin'].includes(user.role) ? API.get('/api/v1/users?role=teacher') : Promise.resolve([])
  );
  const { data: students } = useApi(() =>
    ['center_admin','super_admin','teacher'].includes(user.role) ? API.get('/api/v1/users?role=student') : Promise.resolve([])
  );
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name:'', subject:'', teacherId:'', color:'#6366f1' });
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [enrollIds, setEnrollIds] = useState([]);
  const [showEnroll, setShowEnroll] = useState(false);
  const [editCls, setEditCls] = useState(null);
  const [editForm, setEditForm] = useState({ name:'', subject:'', teacherId:'', color:'' });
  const [editErr, setEditErr] = useState('');
  const canManage = ['super_admin','teacher'].includes(user.role);
  const isAdmin = user.role === 'super_admin';
  const toast = useToast();
  const confirm = useConfirm();

  async function loadDetail(id) {
    try { const d = await API.get(`/api/v1/classes/${id}`); setDetailData(d); setDetail(id); } catch(ex) { alert(ex.message); }
  }

  async function create(e) {
    e.preventDefault(); setErr('');
    try {
      const body = { name: form.name, subject: form.subject || undefined, color: form.color };
      if (isAdmin && form.teacherId) body.teacherId = parseInt(form.teacherId);
      await API.post('/api/v1/classes', body);
      reload(); setShowCreate(false); setForm({ name:'', subject:'', teacherId:'', color:'#6366f1' });
      toast('Класс создан', 'success');
    } catch(ex) { setErr(ex.message); }
  }

  async function saveEdit(e) {
    e.preventDefault(); setEditErr('');
    try {
      const body = { name: editForm.name, subject: editForm.subject, color: editForm.color };
      if (editForm.teacherId) body.teacherId = parseInt(editForm.teacherId);
      await API.patch(`/api/v1/classes/${editCls.id}`, body);
      reload(); setEditCls(null); toast('Класс обновлён', 'success');
    } catch(ex) { setEditErr(ex.message); }
  }

  async function enroll(e) {
    e.preventDefault();
    if (!enrollIds.length) return;
    try {
      await API.post(`/api/v1/classes/${detail}/enroll`, { studentIds: enrollIds.map(Number) });
      loadDetail(detail); setShowEnroll(false); setEnrollIds([]); toast('Ученики записаны', 'success');
    } catch(ex) { alert(ex.message); }
  }

  async function unenroll(studentId) {
    const ok = await confirm('Ученик будет удалён из этого класса. Его оценки и посещаемость сохранятся.', 'Удалить ученика из класса?', { icon: '👤', danger: true, confirmText: 'Удалить' });
    if (!ok) return;
    try { await API.del(`/api/v1/classes/${detail}/enroll/${studentId}`); loadDetail(detail); toast('Ученик удалён из класса', 'success'); } catch(ex) { alert(ex.message); }
  }

  if (loading) return <Spinner/>;

  if (detail && detailData) {
    const cls = detailData;
    const enrolledIds = (cls.students||[]).map(s=>s.id);
    const available = (students||[]).filter(s => !enrolledIds.includes(s.id));
    return (
      <div className="fade">
        <div style={{marginBottom:16}}>
          <button className="btn btn-s btn-sm" onClick={()=>{setDetail(null);setDetailData(null);}}>← Назад к классам</button>
        </div>
        <div className="card" style={{marginBottom:16}}>
          <div style={{padding:'18px',display:'flex',alignItems:'center',gap:14}}>
            <div style={{width:48,height:48,borderRadius:12,background:cls.color||'#6366f1',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,color:'#fff',fontWeight:800}}>
              {cls.name?.[0]||'?'}
            </div>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:18}}>{cls.name}</div>
              <div style={{fontSize:12,color:'var(--muted)'}}>{cls.subject||'Без предмета'} · {cls.teacher_name||'Без учителя'}</div>
            </div>
            <span className="bdg bg">{(cls.students||[]).length} учеников</span>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:14}}>Ученики класса</div>
          {canManage && <button className="btn btn-p btn-sm" onClick={()=>setShowEnroll(true)}>+ Записать</button>}
        </div>
        <div className="card">
          <div className="cb" style={{padding:0}}>
            <table className="tbl">
              <thead><tr><th>Имя</th><th>Email</th>{canManage&&<th style={{width:60}}></th>}</tr></thead>
              <tbody>
                {(cls.students||[]).map(s=>(
                  <tr key={s.id}>
                    <td><div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div className="ava" style={{width:26,height:26,fontSize:10,background:'#f59e0b'}}>{initials(s.name)}</div>
                      <span style={{fontWeight:600}}>{s.name}</span>
                    </div></td>
                    <td style={{color:'var(--muted)',fontSize:12}}>{s.email}</td>
                    {canManage&&<td><button className="btn btn-d btn-sm" onClick={()=>unenroll(s.id)}>✕</button></td>}
                  </tr>
                ))}
                {(!cls.students||!cls.students.length)&&<tr><td colSpan={3}><div className="empty"><div className="empty-ico">👥</div>Нет учеников</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        {showEnroll && (
          <Modal title="Записать учеников" onClose={()=>setShowEnroll(false)}>
            <form onSubmit={enroll}>
              <div className="fg"><label className="fl">Выберите учеников</label>
                <select className="fi" multiple style={{height:180}} value={enrollIds} onChange={e=>setEnrollIds([...e.target.selectedOptions].map(o=>o.value))}>
                  {available.map(s=><option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
                </select>
                <div style={{fontSize:10,color:'var(--muted)',marginTop:4}}>Ctrl+клик для выбора нескольких</div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:14}}>
                <button type="submit" className="btn btn-p" style={{flex:1}}>Записать ({enrollIds.length})</button>
                <button type="button" className="btn btn-s" onClick={()=>setShowEnroll(false)}>Отмена</button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}><div className="pt">Классы</div><div className="ps">{canManage?'Управление классами и учениками':'Ваши классы'}</div></div>
        {canManage && <button className="btn btn-p" onClick={()=>setShowCreate(true)}>+ Создать класс</button>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(min(300px,100%),1fr))',gap:14}}>
        {(classes||[]).map(c=>(
          <div className="card" key={c.id} style={{cursor:'pointer',transition:'all .2s'}} onClick={()=>loadDetail(c.id)}>
            <div style={{padding:'14px 16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                <div style={{width:38,height:38,borderRadius:10,background:c.color||'#6366f1',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,color:'#fff',fontWeight:800}}>
                  {c.name?.[0]||'?'}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14}}>{c.name}</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>{c.subject||'Без предмета'}</div>
                </div>
                {isAdmin && <button className="btn btn-s btn-sm" onClick={e=>{e.stopPropagation();setEditCls(c);setEditForm({name:c.name,subject:c.subject||'',teacherId:c.teacher_id||'',color:c.color||'#6366f1'});setEditErr('');}}>✏️</button>}
              </div>
              <div style={{display:'flex',gap:10,fontSize:11,color:'var(--muted)'}}>
                <span>👨‍🏫 {c.teacher_name||'—'}</span>
                <span>👥 {c.student_count||0} уч.</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {(!classes||!classes.length)&&<div className="empty"><div className="empty-ico">📚</div>Нет классов</div>}
      {showCreate && (
        <Modal title="Создать класс" onClose={()=>setShowCreate(false)}>
          <Alert msg={err}/>
          <form onSubmit={create}>
            <div className="fg"><label className="fl">Название</label><input className="fi" required value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Математика 7А"/></div>
            <div className="fg"><label className="fl">Предмет</label><input className="fi" value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))} placeholder="Математика"/></div>
            {isAdmin && <div className="fg"><label className="fl">Учитель</label>
              <select className="fi" value={form.teacherId} onChange={e=>setForm(f=>({...f,teacherId:e.target.value}))}>
                <option value="">— не назначен —</option>
                {(teachers||[]).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>}
            <div className="fg"><label className="fl">Цвет</label><input type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))} style={{width:60,height:34,border:'none',cursor:'pointer'}}/></div>
            <div style={{display:'flex',gap:8,marginTop:14}}>
              <button type="submit" className="btn btn-p" style={{flex:1}}>Создать</button>
              <button type="button" className="btn btn-s" onClick={()=>setShowCreate(false)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}
      {editCls && (
        <Modal title={`Редактировать: ${editCls.name}`} onClose={()=>setEditCls(null)}>
          <Alert msg={editErr}/>
          <form onSubmit={saveEdit}>
            <div className="fg"><label className="fl">Название</label><input className="fi" required value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))}/></div>
            <div className="fg"><label className="fl">Предмет</label><input className="fi" value={editForm.subject} onChange={e=>setEditForm(f=>({...f,subject:e.target.value}))}/></div>
            {isAdmin && <div className="fg"><label className="fl">Учитель</label>
              <select className="fi" value={editForm.teacherId} onChange={e=>setEditForm(f=>({...f,teacherId:e.target.value}))}>
                <option value="">— не назначен —</option>
                {(teachers||[]).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>}
            <div className="fg"><label className="fl">Цвет</label><input type="color" value={editForm.color} onChange={e=>setEditForm(f=>({...f,color:e.target.value}))} style={{width:60,height:34,border:'none',cursor:'pointer'}}/></div>
            <div style={{display:'flex',gap:8,marginTop:14}}>
              <button type="submit" className="btn btn-p" style={{flex:1}}>Сохранить</button>
              <button type="button" className="btn btn-s" onClick={()=>setEditCls(null)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ·· GRADE MODAL (красивая форма выставления оценки)
function GradeModal({ submission, assignment, onGrade, onClose }) {
  const [selectedScore, setSelectedScore] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const maxScore = assignment.max_score || 10;
  const gradingScale = assignment.grading_scale || '10-point';
  const buttons = Array.from({length: maxScore}, (_, i) => i + 1);

  async function handleSubmit() {
    if (selectedScore === null) {
      alert('Выберите оценку');
      return;
    }
    setLoading(true);
    try {
      await onGrade(submission.id, selectedScore, feedback);
      onClose();
    } catch(ex) {
      alert(ex.message);
    }
    setLoading(false);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:'min(500px, 92vw)'}} onClick={e=>e.stopPropagation()}>
        <div className="modal-t">Оценить работу</div>
        <div className="modal-sub">{submission.student_name}</div>

        {/* Ответ ученика */}
        {submission.text_answer && (
          <div style={{marginBottom:16,padding:12,background:'var(--surface2)',borderRadius:8}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--muted)',marginBottom:6}}>Текстовый ответ:</div>
            <div style={{fontSize:13,lineHeight:1.6,maxHeight:120,overflow:'auto'}}>{submission.text_answer}</div>
          </div>
        )}

        {/* Файлы */}
        {submission.file_name && submission.file_path && (
          <div style={{marginBottom:16}}>
            <a
              href={submission.file_path.startsWith('http') ? submission.file_path : `/uploads/${submission.file_path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-s btn-sm"
            >
              📎 {submission.file_name}
            </a>
          </div>
        )}

        {/* Кнопки оценки */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>Выберите оценку:</div>
          <div style={{
            display:'grid',
            gridTemplateColumns: gradingScale === '10-point' ? 'repeat(5, 1fr)' : 'repeat(auto-fill, minmax(40px, 1fr))',
            gap:8
          }}>
            {buttons.map(score => (
              <button
                key={score}
                type="button"
                style={{
                  aspectRatio: gradingScale === '10-point' ? '1' : 'auto',
                  padding: gradingScale === '10-point' ? 0 : '8px 6px',
                  borderRadius: 10,
                  border: `2px solid ${selectedScore === score ? 'transparent' : 'var(--border)'}`,
                  background: selectedScore === score ? getGradeColor(score, gradingScale) : 'var(--surface)',
                  color: selectedScore === score ? '#fff' : 'var(--text)',
                  fontSize: gradingScale === '10-point' ? 20 : 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  transform: selectedScore === score ? 'scale(1.1)' : 'scale(1)'
                }}
                onClick={() => setSelectedScore(score)}
                onMouseOver={e => {
                  if (selectedScore !== score) {
                    e.target.style.borderColor = getGradeColor(score, gradingScale);
                    e.target.style.transform = 'scale(1.05)';
                  }
                }}
                onMouseOut={e => {
                  if (selectedScore !== score) {
                    e.target.style.borderColor = 'var(--border)';
                    e.target.style.transform = 'scale(1)';
                  }
                }}
              >
                {score}
              </button>
            ))}
          </div>

          {/* Preview оценки */}
          {selectedScore !== null && (
            <div style={{
              marginTop:12,
              textAlign:'center',
              fontSize:18,
              fontWeight:700,
              color:getGradeColor(selectedScore, gradingScale)
            }}>
              {getGradeIcon(selectedScore, gradingScale)} {selectedScore}/{maxScore} — {getGradeLabel(selectedScore, gradingScale)}
              {gradingScale === '10-point' && (
                <div style={{fontSize:20,marginTop:6}}>
                  {generateStars(selectedScore, maxScore)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Комментарий */}
        <div className="fg">
          <label className="fl">💬 Комментарий для ученика</label>
          <textarea
            className="fi"
            rows={4}
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Напишите свой комментарий..."
          />
        </div>

        {/* Кнопки */}
        <div style={{display:'flex',gap:8,marginTop:16}}>
          <button
            className="btn btn-p"
            style={{flex:1}}
            onClick={handleSubmit}
            disabled={loading || selectedScore === null}
          >
            {loading ? 'Сохранение...' : '💾 Выставить оценку'}
          </button>
          <button className="btn btn-s" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// ·· ASSIGNMENTS VIEW
// ── RETURN FEEDBACK MODAL (teacher returns work with comment) ─────────────────
function ReturnFeedbackModal({ submission, onClose, onConfirm }) {
  const [feedback, setFeedback] = useState('');
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal fade" onClick={e=>e.stopPropagation()} style={{maxWidth:440}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <div style={{fontSize:28}}>↩️</div>
          <div>
            <div style={{fontWeight:800,fontSize:16}}>Вернуть работу</div>
            <div style={{fontSize:12,color:'var(--muted)'}}>{submission.student_name}</div>
          </div>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--muted)'}}>✕</button>
        </div>
        <div className="fg">
          <label className="fl">💬 Комментарий для ученика</label>
          <textarea className="fi" rows={4} placeholder="Объясните что нужно исправить..." value={feedback} onChange={e=>setFeedback(e.target.value)} autoFocus/>
        </div>
        <div style={{display:'flex',gap:8,marginTop:8}}>
          <button className="btn btn-d" style={{flex:1,justifyContent:'center'}} onClick={()=>onConfirm(feedback)}>↩ Вернуть на доработку</button>
          <button className="btn btn-s" onClick={onClose} style={{padding:'10px 18px'}}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// ── SUBMIT MODAL (student homework submission) ─────────────────────────────
function SubmitModal({ assignment, onClose, onSuccess }) {
  const [textAnswer, setTextAnswer] = useState('');
  const [comment, setComment] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = React.useRef();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!textAnswer.trim() && !file) { setErr('Напишите ответ или прикрепите файл'); return; }
    setErr(''); setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('assignmentId', assignment.id);
      if (textAnswer.trim()) fd.append('textAnswer', textAnswer.trim());
      if (comment.trim()) fd.append('comment', comment.trim());
      if (file) fd.append('file', file);
      await API.postForm('/api/v1/submissions', fd);
      onSuccess();
    } catch(ex) { setErr(ex.message); }
    setSubmitting(false);
  }

  const ALLOWED = '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.zip,.pptx,.xlsx';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal fade" onClick={e=>e.stopPropagation()} style={{maxWidth:500}}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:18}}>
          <div style={{width:44,height:44,borderRadius:12,background:typeBg(assignment.type),display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>
            {typeIco(assignment.type)}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:800,fontSize:16,marginBottom:2}}>{assignment.title}</div>
            <div style={{fontSize:12,color:'var(--muted)'}}>{assignment.class_name} · до {fmtDate(assignment.due_date)} · Макс: {assignment.max_score}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--muted)',lineHeight:1,padding:'0 0 0 8px'}}>✕</button>
        </div>

        {/* Task description (if any) */}
        {assignment.description && (
          <div style={{background:'var(--bg2)',borderRadius:10,padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--text)',lineHeight:1.6,borderLeft:'3px solid var(--primary)'}}>
            {assignment.description}
          </div>
        )}

        {err && <Alert msg={err}/>}

        <form onSubmit={handleSubmit}>
          {/* Text answer */}
          <div className="fg">
            <label className="fl">✍️ Текстовый ответ</label>
            <textarea
              className="fi"
              rows={5}
              placeholder="Напишите ваш ответ здесь..."
              value={textAnswer}
              onChange={e=>setTextAnswer(e.target.value)}
              style={{resize:'vertical',lineHeight:1.6}}
            />
          </div>

          {/* File attachment */}
          <div className="fg">
            <label className="fl">📎 Прикрепить файл <span style={{fontWeight:400,color:'var(--muted)'}}>— необязательно</span></label>
            <input type="file" accept={ALLOWED} ref={fileRef} style={{display:'none'}} onChange={e=>setFile(e.target.files[0]||null)}/>
            {file ? (
              <div style={{display:'flex',alignItems:'center',gap:10,background:'var(--primary-light)',border:'1px solid hsl(160,40%,80%)',borderRadius:8,padding:'10px 14px'}}>
                <span style={{fontSize:22}}>📄</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{file.name}</div>
                  <div style={{fontSize:11,color:'var(--muted)'}}>{(file.size/1024).toFixed(0)} KB</div>
                </div>
                <button type="button" onClick={()=>{setFile(null);fileRef.current.value='';}} style={{background:'none',border:'none',fontSize:16,cursor:'pointer',color:'var(--muted)'}}>✕</button>
              </div>
            ) : (
              <button type="button" onClick={()=>fileRef.current.click()} className="btn btn-s" style={{width:'100%',justifyContent:'center',gap:8,padding:'10px'}}>
                <span>📂</span> Выбрать файл
              </button>
            )}
            <div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>PDF, Word, TXT, изображения, ZIP — до 10 МБ</div>
          </div>

          {/* Comment */}
          <div className="fg">
            <label className="fl">💬 Комментарий учителю <span style={{fontWeight:400,color:'var(--muted)'}}>— необязательно</span></label>
            <input className="fi" placeholder="Например: работал над этим 2 часа..." value={comment} onChange={e=>setComment(e.target.value)}/>
          </div>

          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button type="submit" className="btn btn-p" style={{flex:1,justifyContent:'center',padding:'11px'}} disabled={submitting}>
              {submitting ? '⏳ Отправка...' : '🚀 Сдать работу'}
            </button>
            <button type="button" className="btn btn-s" onClick={onClose} style={{padding:'11px 20px'}}>Отмена</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignmentsView({ user }) {
  const { data: classes } = useApi(() => API.get('/api/v1/classes'));
  const [classFilter, setClassFilter] = useState('');
  const url = '/api/v1/assignments' + (classFilter ? `?classId=${classFilter}` : '');
  const { data: assignments, loading, reload } = useApi(() => API.get(url), [url]);
  const canCreate = ['teacher','center_admin','super_admin'].includes(user.role);
  const isTeacher = user.role === 'teacher';
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ classId:'', title:'', description:'', type:'homework', gradingScale:'10-point', maxScore:10, dueDate:'', isPublished:1 });
  const [err, setErr] = useState('');
  const [viewAssign, setViewAssign] = useState(null);
  const [subs, setSubs] = useState(null);
  const [gradingSubmission, setGradingSubmission] = useState(null); // Для GradeModal
  const [submitModal, setSubmitModal] = useState(null); // assignment object to submit
  const toast = useToast();
  const confirm = useConfirm();

  async function create(e) {
    e.preventDefault(); setErr('');
    try {
      await API.post('/api/v1/assignments', form);
      reload(); setShowCreate(false); setForm({ classId:'', title:'', description:'', type:'homework', gradingScale:'10-point', maxScore:10, dueDate:'', isPublished:1 });
      toast('Задание создано', 'success');
    } catch(ex) { setErr(ex.message); }
  }

  async function deleteAssign(id) {
    const ok = await confirm('Задание и все работы учеников будут удалены безвозвратно. Это действие нельзя отменить.', 'Удалить задание?', { icon: '🗑️', danger: true, confirmText: 'Удалить' });
    if (!ok) return;
    try { await API.del(`/api/v1/assignments/${id}`); reload(); toast('Задание удалено', 'success'); } catch(ex) { alert(ex.message); }
  }

  async function viewSubmissions(a) {
    setViewAssign(a);
    try { const d = await API.get(`/api/v1/submissions/assignment/${a.id}`); setSubs(d); } catch(ex) { alert(ex.message); }
  }

  async function gradeSubmission(subId, score, feedback) {
    try {
      await API.patch(`/api/v1/submissions/${subId}/grade`, { score: parseFloat(score), feedback });
      viewSubmissions(viewAssign);
      toast('Оценка выставлена', 'success');
      setGradingSubmission(null); // Закрыть модалку
    } catch(ex) {
      alert(ex.message);
      throw ex; // Пробросить ошибку для GradeModal
    }
  }

  function openGradeModal(submission) {
    setGradingSubmission(submission);
  }

  const [returnFeedbackModal, setReturnFeedbackModal] = useState(null); // submission to return

  async function doReturn(subId, feedback) {
    try { await API.patch(`/api/v1/submissions/${subId}/return`, { feedback }); viewSubmissions(viewAssign); toast('Работа возвращена', 'success'); } catch(ex) { alert(ex.message); }
  }

  function returnSubmission(sub) {
    setReturnFeedbackModal(sub);
  }

  // Student submit — opens modal
  function submitWork(assignment) {
    setSubmitModal(assignment);
  }

  if (loading) return <Spinner/>;

  if (viewAssign && subs) {
    return (
      <div className="fade">
        <button className="btn btn-s btn-sm" style={{marginBottom:14}} onClick={()=>{setViewAssign(null);setSubs(null);}}>← Назад</button>
        <div className="ph"><div className="pt">{viewAssign.title}</div><div className="ps">{viewAssign.class_name} · до {fmtDate(viewAssign.due_date)} · Макс: {viewAssign.max_score}</div></div>
        {viewAssign.description && <div className="card" style={{padding:'12px 16px',marginBottom:14,fontSize:13,color:'var(--muted)'}}>{viewAssign.description}</div>}
        <div className="card">
          <div className="ch"><div className="ct">Сданные работы ({subs.submissions?.length||0})</div></div>
          <div className="cb" style={{padding:0}}>
            <ResponsiveTable
              headers={['Ученик','Ответ','Файл','Дата','Балл','Статус','Действия']}
              rows={subs.submissions||[]}
              emptyIcon="📝" emptyText="Нет сданных работ"
              renderRow={s=>(
                <tr key={s.id}>
                  <td style={{fontWeight:600}}>{s.student_name}</td>
                  <td style={{maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:11}}>{s.text_answer||'—'}</td>
                  <td>{s.file_name && s.file_path ? <a href={s.file_path.startsWith('http') ? s.file_path : `/uploads/${s.file_path}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--accent)',fontSize:11}}>📎 {s.file_name}</a> : '—'}</td>
                  <td style={{fontSize:11,color:'var(--muted)'}}>{fmtDate(s.submitted_at)}</td>
                  <td>
                    {s.score!==null ? (
                      <span style={{fontWeight:700,color:getGradeColor(s.score, viewAssign.grading_scale),fontSize:13}}>
                        {getGradeIcon(s.score, viewAssign.grading_scale)} {s.score}/{viewAssign.max_score}
                      </span>
                    ) : '—'}
                  </td>
                  <td><span className={`bdg ${s.status==='graded'?'bg':s.status==='submitted'?'ba':s.status==='returned'?'br':'bk'}`}>{s.status==='graded'?'Проверено':s.status==='submitted'?'Сдано':s.status==='returned'?'Возвращено':'—'}</span></td>
                  <td>
                    {s.status==='submitted' && <>
                      <button className="btn btn-p btn-sm" style={{marginRight:4}} onClick={()=>openGradeModal(s)}>✓ Оценить</button>
                      <button className="btn btn-d btn-sm" onClick={()=>returnSubmission(s)}>↩</button>
                    </>}
                  </td>
                </tr>
              )}
              renderCard={s=>(
                <div key={s.id} className="card" style={{padding:'12px 14px',marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                    <div style={{fontWeight:700,fontSize:14}}>{s.student_name}</div>
                    <span className={`bdg ${s.status==='graded'?'bg':s.status==='submitted'?'ba':s.status==='returned'?'br':'bk'}`}>{s.status==='graded'?'Проверено':s.status==='submitted'?'Сдано':s.status==='returned'?'Возвращено':'—'}</span>
                  </div>
                  {s.text_answer && <div style={{fontSize:12,color:'var(--muted)',marginBottom:6,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.text_answer}</div>}
                  <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',fontSize:12}}>
                    {s.file_name && s.file_path && <a href={s.file_path.startsWith('http') ? s.file_path : `/uploads/${s.file_path}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--accent)'}}>📎 {s.file_name}</a>}
                    <span style={{color:'var(--muted)'}}>{fmtDate(s.submitted_at)}</span>
                    {s.score!==null && <span style={{fontWeight:700,color:getGradeColor(s.score, viewAssign.grading_scale)}}>{getGradeIcon(s.score, viewAssign.grading_scale)} {s.score}/{viewAssign.max_score}</span>}
                  </div>
                  {s.status==='submitted' && (
                    <div style={{display:'flex',gap:6,marginTop:8}}>
                      <button className="btn btn-p btn-sm" onClick={()=>openGradeModal(s)}>✓ Оценить</button>
                      <button className="btn btn-d btn-sm" onClick={()=>returnSubmission(s)}>↩ Вернуть</button>
                    </div>
                  )}
                </div>
              )}
            />
          </div>
        </div>
        {subs.notSubmitted?.length>0 && (
          <div style={{marginTop:14}}>
            <div style={{fontSize:12,fontWeight:600,color:'var(--muted)',marginBottom:6}}>Не сдали ({subs.notSubmitted.length}):</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {subs.notSubmitted.map(s=><span key={s.id} className="bdg br">{s.name}</span>)}
            </div>
          </div>
        )}

        {returnFeedbackModal && (
          <ReturnFeedbackModal
            submission={returnFeedbackModal}
            onClose={()=>setReturnFeedbackModal(null)}
            onConfirm={feedback=>{ setReturnFeedbackModal(null); doReturn(returnFeedbackModal.id, feedback); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}><div className="pt">Задания</div><div className="ps">{canCreate?'Управление заданиями':'Ваши задания'}</div></div>
        {canCreate && <button className="btn btn-p" onClick={()=>setShowCreate(true)}>+ Создать задание</button>}
      </div>
      {classes?.length>1 && (
        <div style={{marginBottom:14}}>
          <select className="fi" style={{maxWidth:280}} value={classFilter} onChange={e=>setClassFilter(e.target.value)}>
            <option value="">Все классы</option>
            {(classes||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {(assignments||[]).map(a=>(
          <div className="ac" key={a.id} onClick={()=>canCreate?viewSubmissions(a):null}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:40,height:40,borderRadius:10,background:typeBg(a.type),display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{typeIco(a.type)}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:13}}>{a.title}</div>
                <div style={{fontSize:11,color:'var(--muted)'}}>
                  {a.class_name} · {relativeDate(a.due_date)} · Макс: {a.max_score} {a.grading_scale==='10-point'?'(10-бальная)':'(100-бальная)'}
                </div>
              </div>
              {canCreate && <div style={{textAlign:'right',fontSize:11}}>
                <div>{a.submission_count||0}/{a.total_students||0} сдали</div>
                {a.pending_grading>0 && <span className="bdg ba">{a.pending_grading} ждут</span>}
              </div>}
              {user.role==='student' && (
                a.submission_status
                  ? (a.submission_status==='graded'
                      ? <div style={{
                          display:'flex',
                          alignItems:'center',
                          gap:6,
                          padding:'6px 12px',
                          background:getGradeColor(a.score, a.grading_scale)+'15',
                          border:`2px solid ${getGradeColor(a.score, a.grading_scale)}`,
                          borderRadius:8,
                          fontWeight:700,
                          fontSize:14,
                          color:getGradeColor(a.score, a.grading_scale)
                        }}>
                          <span>{getGradeIcon(a.score, a.grading_scale)}</span>
                          <span>{a.score}/{a.max_score}</span>
                        </div>
                      : <span className={`bdg ${a.submission_status==='submitted'?'ba':a.submission_status==='returned'?'br':'bk'}`}>
                          {a.submission_status==='submitted'?'Сдано':a.submission_status==='returned'?'Возвращено':'—'}
                        </span>
                    )
                  : <button className="btn btn-p btn-sm" onClick={e=>{e.stopPropagation();submitWork(a);}}>Сдать</button>
              )}
              {canCreate && <button className="btn btn-d btn-sm" onClick={e=>{e.stopPropagation();deleteAssign(a.id);}}>🗑</button>}
            </div>
          </div>
        ))}
      </div>
      {(!assignments||!assignments.length)&&<div className="empty"><div className="empty-ico">📋</div>Нет заданий</div>}

      {submitModal && (
        <SubmitModal
          assignment={submitModal}
          onClose={()=>setSubmitModal(null)}
          onSuccess={()=>{ setSubmitModal(null); reload(); toast('Работа сдана! 🎉','success'); }}
        />
      )}

      {showCreate && (
        <Modal title="Создать задание" onClose={()=>setShowCreate(false)}>
          <Alert msg={err}/>
          <form onSubmit={create}>
            <div className="fg"><label className="fl">Класс</label>
              <select className="fi" required value={form.classId} onChange={e=>setForm(f=>({...f,classId:parseInt(e.target.value)}))}>
                <option value="">— выберите —</option>
                {(classes||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="fg"><label className="fl">Название</label><input className="fi" required value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Контрольная №1"/></div>
            <div className="fg"><label className="fl">Описание</label><textarea className="fi" rows={3} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
            <div className="g2">
              <div className="fg"><label className="fl">Тип</label>
                <select className="fi" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                  <option value="homework">Домашка</option><option value="test">Тест</option>
                  <option value="essay">Эссе</option><option value="lab">Лабораторная</option>
                  <option value="project">Проект</option>
                </select>
              </div>
              <div className="fg"><label className="fl">Срок сдачи</label><input className="fi" type="date" required value={form.dueDate} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))}/></div>
            </div>
            <div className="fg">
              <label className="fl">Шкала оценивания</label>
              <div style={{display:'flex',gap:16,padding:'8px 0'}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                  <input
                    type="radio"
                    name="gradingScale"
                    value="10-point"
                    checked={form.gradingScale === '10-point'}
                    onChange={e => setForm(f=>({...f, gradingScale:'10-point', maxScore:10}))}
                  />
                  <span style={{fontWeight:600}}>10-бальная</span>
                  <span style={{fontSize:11,color:'var(--muted)'}}>(1-10)</span>
                </label>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                  <input
                    type="radio"
                    name="gradingScale"
                    value="100-point"
                    checked={form.gradingScale === '100-point'}
                    onChange={e => setForm(f=>({...f, gradingScale:'100-point', maxScore:100}))}
                  />
                  <span style={{fontWeight:600}}>100-бальная</span>
                  <span style={{fontSize:11,color:'var(--muted)'}}>(0-100)</span>
                </label>
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:14}}>
              <button type="submit" className="btn btn-p" style={{flex:1}}>Создать</button>
              <button type="button" className="btn btn-s" onClick={()=>setShowCreate(false)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}

      {/* GradeModal для выставления оценок */}
      {gradingSubmission && viewAssign && (
        <GradeModal
          submission={gradingSubmission}
          assignment={viewAssign}
          onGrade={gradeSubmission}
          onClose={() => setGradingSubmission(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ·· HOMEWORK MODULE v2 — clean rewrite
//    • Teacher: create / edit / delete assignments, view & grade submissions
//    • Student: view list, submit with optional file upload, see grades
//    • File upload: browser → Vercel Blob CDN directly (no 4.5 MB serverless limit)
// ══════════════════════════════════════════════════════════════════════════════

// ── Status badge helper ───────────────────────────────────────────────────────
function HWStatusBadge({ status, score, maxScore }) {
  const map = {
    submitted:  { label: 'Сдано',       cls: 'ba' },
    graded:     { label: score != null ? `${score}/${maxScore}` : 'Проверено', cls: 'bg' },
    returned:   { label: 'На доработку', cls: 'br' },
    overdue:    { label: 'Просрочено',   cls: 'bk' },
    pending:    { label: 'Не сдано',     cls: 'bk' },
  };
  const s = map[status] || map.pending;
  return <span className={`bdg ${s.cls}`}>{s.label}</span>;
}

// ── Deadline label ────────────────────────────────────────────────────────────
function Deadline({ date }) {
  const d = new Date(date);
  const now = new Date();
  const diff = Math.ceil((d - now) / 86400000);
  const label = fmtDate(date);
  const color = diff < 0 ? 'var(--red)' : diff <= 1 ? 'var(--amber)' : 'var(--muted)';
  const prefix = diff < 0 ? '⚠️ ' : diff === 0 ? '🔔 Сегодня · ' : diff === 1 ? '⏰ Завтра · ' : '';
  return <span style={{ color, fontSize: 11 }}>{prefix}{label}</span>;
}

// ── Blob upload: browser → Vercel CDN ────────────────────────────────────────
// Returns { url, name } or throws
async function uploadFileToBlobCDN(file) {
  if (!file) throw new Error('Файл не выбран');

  // 1. Get client token from our server (small JSON, no payload limit issues)
  const { clientToken, blobPathname, localMode } = await API.post('/api/v1/hw/upload-token', {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
  });

  // 2a. Local dev fallback (no BLOB_READ_WRITE_TOKEN set)
  if (localMode) {
    return { url: null, name: file.name };
  }

  // 2b. Production — use the official @vercel/blob/client put() which:
  //   • uploads to https://vercel.com/api/blob (NOT the CDN read domain)
  //   • sends the required x-api-version header
  //   • fully bypasses the Vercel serverless 4.5 MB body limit
  const { put } = await import('@vercel/blob/client');
  const blob = await put(blobPathname, file, {
    access: 'public',
    token: clientToken,          // must start with 'vercel_blob_client_'
    contentType: file.type || 'application/octet-stream',
  });
  return { url: blob.url, name: file.name };
}

// ── Modal shell ───────────────────────────────────────────────────────────────
function HWModal({ title, subtitle, onClose, children, wide }) {
  // Close on Escape
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: wide ? 'min(780px, 96vw)' : 'min(520px, 96vw)', maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 18px 0' }}>
          <div style={{ flex: 1 }}>
            <div className="modal-t" style={{ margin: 0 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button className="btn btn-d btn-sm" onClick={onClose} style={{ flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px 18px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── File picker with progress ─────────────────────────────────────────────────
function FilePicker({ onFile, file, uploading, progress, onClear }) {
  const inputRef = useRef(null);
  const MAX = 50 * 1024 * 1024;
  const TYPES = '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif,.webp,.zip,.ppt,.pptx,.xls,.xlsx';

  function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX) { alert('Файл слишком большой (максимум 50 МБ)'); return; }
    onFile(f);
  }
  return (
    <div>
      <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: 'block' }}>
        Прикрепить файл <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(до 50 МБ)</span>
      </label>
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
          <span style={{ fontSize: 18 }}>📎</span>
          <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          {uploading ? (
            <span style={{ fontSize: 11, color: 'var(--accent)', minWidth: 60, textAlign: 'right' }}>
              {progress < 100 ? `${progress}%` : '✓ Загружено'}
            </span>
          ) : (
            <button type="button" className="btn btn-d btn-sm" onClick={onClear}>✕</button>
          )}
        </div>
      ) : (
        <div
          style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '16px 12px', textAlign: 'center', cursor: 'pointer' }}
          onClick={() => inputRef.current?.click()}
        >
          <div style={{ fontSize: 24, marginBottom: 4 }}>📁</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Нажмите для выбора файла</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>PDF, Word, Excel, PowerPoint, изображения, ZIP</div>
        </div>
      )}
      <input ref={inputRef} type="file" accept={TYPES} style={{ display: 'none' }} onChange={pick} />
    </div>
  );
}

// ── Create / Edit assignment modal (teacher) ──────────────────────────────────
function HWCreateModal({ classes, editData, onSave, onClose }) {
  const isEdit = !!editData;
  const [form, setForm] = useState({
    classId:      editData?.class_id  || classes?.[0]?.id || '',
    title:        editData?.title     || '',
    description:  editData?.description || '',
    type:         editData?.type      || 'homework',
    gradingScale: editData?.grading_scale || '10-point',
    maxScore:     editData?.max_score || 10,
    dueDate:      editData?.due_date ? editData.due_date.slice(0, 10) : '',
    isPublished:  editData ? editData.is_published : 1,
  });
  const [file, setFile]         = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [err, setErr]   = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function set(k) { return v => setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    if (!form.title.trim())   { setErr('Введите название'); return; }
    if (!form.dueDate)        { setErr('Укажите дедлайн'); return; }
    if (!form.classId)        { setErr('Выберите класс'); return; }

    setSaving(true);
    let filePath = editData?.file_path || null;
    let fileName = editData?.file_name || null;

    try {
      // Upload file if one was chosen
      if (file) {
        setUploading(true);
        setProgress(10);
        const result = await uploadFileToBlobCDN(file);
        setProgress(100);
        filePath = result.url;
        fileName = result.name;
        setUploading(false);
      }

      const body = {
        classId:      parseInt(form.classId, 10),
        title:        form.title.trim(),
        description:  form.description.trim() || undefined,
        type:         form.type,
        gradingScale: form.gradingScale,
        maxScore:     parseInt(form.maxScore, 10),
        dueDate:      form.dueDate,
        isPublished:  form.isPublished ? 1 : 0,
        filePath,
        fileName,
      };

      if (isEdit) {
        await API.patch(`/api/v1/hw/assignments/${editData.id}`, body);
        toast('Задание обновлено', 'success');
      } else {
        await API.post('/api/v1/hw/assignments', body);
        toast('Задание создано', 'success');
      }
      onSave();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  const TYPES = [
    { v: 'homework', l: '📝 Домашнее задание' },
    { v: 'test',     l: '📋 Контрольная работа' },
    { v: 'essay',    l: '✍️ Сочинение' },
    { v: 'lab',      l: '🔬 Лабораторная' },
    { v: 'project',  l: '🚀 Проект' },
  ];

  return (
    <HWModal
      title={isEdit ? 'Редактировать задание' : 'Новое задание'}
      subtitle={isEdit ? editData.title : 'Заполните детали задания'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="fi-label">Класс</label>
          <select className="fi" value={form.classId} onChange={e => set('classId')(e.target.value)} required>
            <option value="">— выберите —</option>
            {(classes || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="fi-label">Название *</label>
          <input className="fi" value={form.title} onChange={e => set('title')(e.target.value)} placeholder="Например: Глава 3, упр. 4–8" required />
        </div>
        <div>
          <label className="fi-label">Описание / инструкция</label>
          <textarea className="fi" rows={3} value={form.description} onChange={e => set('description')(e.target.value)} placeholder="Опишите задание подробнее..." style={{ resize: 'vertical' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="fi-label">Тип</label>
            <select className="fi" value={form.type} onChange={e => set('type')(e.target.value)}>
              {TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div>
            <label className="fi-label">Система оценки</label>
            <select className="fi" value={form.gradingScale} onChange={e => { set('gradingScale')(e.target.value); set('maxScore')(e.target.value === '100-point' ? 100 : 10); }}>
              <option value="10-point">10-балльная</option>
              <option value="100-point">100-балльная</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="fi-label">Макс. балл</label>
            <input className="fi" type="number" min={1} max={form.gradingScale === '100-point' ? 100 : 10} value={form.maxScore} onChange={e => set('maxScore')(e.target.value)} />
          </div>
          <div>
            <label className="fi-label">Дедлайн *</label>
            <input className="fi" type="date" value={form.dueDate} min={new Date().toISOString().slice(0, 10)} onChange={e => set('dueDate')(e.target.value)} required />
          </div>
        </div>
        <FilePicker
          file={file}
          uploading={uploading}
          progress={progress}
          onFile={setFile}
          onClear={() => setFile(null)}
        />
        {editData?.file_path && !file && (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            📎 Прикреплён: <a href={editData.file_path} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{editData.file_name || 'Файл учителя'}</a>
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={!!form.isPublished} onChange={e => set('isPublished')(e.target.checked ? 1 : 0)} />
          Опубликовать сразу (ученики увидят задание)
        </label>
        {err && <div style={{ color: 'var(--red)', fontSize: 12, padding: '8px 12px', background: 'var(--red-s)', borderRadius: 6 }}>⚠️ {err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn btn-s" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-p" disabled={saving || uploading}>
            {saving ? 'Сохранение...' : uploading ? 'Загрузка файла...' : isEdit ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </form>
    </HWModal>
  );
}

// ── Submissions list modal (teacher) ──────────────────────────────────────────
function HWSubmissionsModal({ assignment, onClose, onReload }) {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(null); // submission being graded
  const [scoreInput, setScoreInput] = useState('');
  const [feedbackInput, setFeedbackInput] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    try { setData(await API.get(`/api/v1/hw/assignments/${assignment.id}/submissions`)); } catch (ex) { toast(ex.message, 'error'); }
    setLoading(false);
  }
  useEffect(() => { load(); }, [assignment.id]);

  async function grade(sub) {
    setSaving(true);
    const score = parseFloat(scoreInput);
    if (isNaN(score) || score < 0 || score > assignment.max_score) {
      toast(`Оценка от 0 до ${assignment.max_score}`, 'error');
      setSaving(false); return;
    }
    try {
      await API.post(`/api/v1/hw/submissions/${sub.id}/grade`, { score, feedback: feedbackInput.trim() || undefined });
      toast('Оценка сохранена', 'success');
      setGrading(null);
      await load();
      onReload();
    } catch (ex) { toast(ex.message, 'error'); }
    setSaving(false);
  }

  async function returnWork(sub) {
    const fb = window.prompt('Комментарий для ученика (необязательно):') ?? null;
    if (fb === null && !confirm('Вернуть работу без комментария?')) return;
    try {
      await API.post(`/api/v1/hw/submissions/${sub.id}/return`, { feedback: fb || undefined });
      toast('Работа возвращена на доработку', 'info');
      await load();
    } catch (ex) { toast(ex.message, 'error'); }
  }

  const statusColor = { submitted: 'var(--amber)', graded: 'var(--green)', returned: 'var(--red)' };

  return (
    <HWModal
      title={`Работы: ${assignment.title}`}
      subtitle={`${data?.submissions?.length || 0} сдано · ${data?.missing?.length || 0} не сдано · макс. ${assignment.max_score}`}
      onClose={onClose}
      wide
    >
      {loading ? <div style={{textAlign:'center',padding:32}}><Spinner/></div> : !data ? null : (
        <>
          {data.submissions.length === 0 && <div className="empty" style={{padding:'24px 0'}}><div className="empty-ico">📭</div>Никто ещё не сдал</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.submissions.map(sub => (
              <div key={sub.id} className="card" style={{ padding: '12px 14px', borderLeft: `4px solid ${statusColor[sub.status] || 'var(--border)'}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{sub.student_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmtDate(sub.submitted_at)}</div>
                    {sub.text_answer && (
                      <div style={{ marginTop: 6, fontSize: 12, background: 'var(--surface2)', borderRadius: 6, padding: '6px 10px', maxHeight: 80, overflow: 'auto' }}>
                        {sub.text_answer}
                      </div>
                    )}
                    {sub.file_path && (
                      <a href={sub.file_path} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 12, color: 'var(--accent)' }}>
                        📎 {sub.file_name || 'Скачать файл'}
                      </a>
                    )}
                    {sub.feedback && (
                      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>💬 {sub.feedback}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <HWStatusBadge status={sub.status} score={sub.score} maxScore={assignment.max_score} />
                    {grading?.id === sub.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                        <input
                          autoFocus
                          type="number" min={0} max={assignment.max_score} step={0.5}
                          placeholder={`0–${assignment.max_score}`}
                          style={{ width: 70, textAlign: 'center', padding: '4px 8px', border: '2px solid var(--accent)', borderRadius: 6, fontSize: 14 }}
                          value={scoreInput}
                          onChange={e => setScoreInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') grade(sub); if (e.key === 'Escape') setGrading(null); }}
                        />
                        <input
                          type="text" placeholder="Комментарий..."
                          style={{ width: 160, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                          value={feedbackInput}
                          onChange={e => setFeedbackInput(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-s btn-sm" onClick={() => setGrading(null)}>Отмена</button>
                          <button className="btn btn-p btn-sm" disabled={saving} onClick={() => grade(sub)}>
                            {saving ? '...' : 'Сохранить'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-p btn-sm"
                          onClick={() => { setGrading(sub); setScoreInput(sub.score != null ? String(sub.score) : ''); setFeedbackInput(sub.feedback || ''); }}
                        >
                          {sub.status === 'graded' ? '✏️ Изменить' : '✓ Оценить'}
                        </button>
                        {sub.status !== 'graded' && (
                          <button className="btn btn-d btn-sm" onClick={() => returnWork(sub)}>↩ Вернуть</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data.missing.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>НЕ СДАЛИ ({data.missing.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.missing.map(s => (
                  <span key={s.id} className="bdg bk">{s.name}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </HWModal>
  );
}

// ── Submit / view submission modal (student) ──────────────────────────────────
function HWSubmitModal({ assignment, onClose, onReload }) {
  const existing = assignment.submission_id ? {
    id: assignment.submission_id,
    status: assignment.submission_status,
    score: assignment.submission_score,
    feedback: assignment.submission_feedback,
  } : null;

  const isPast     = new Date(assignment.due_date) < new Date();
  const isGraded   = existing?.status === 'graded';
  const canEdit    = !isPast && (!existing || existing.status === 'returned' || existing.status === 'submitted');

  const [text, setText]       = useState('');
  const [file, setFile]       = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [err, setErr]   = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function submit(e) {
    e.preventDefault();
    if (!text.trim() && !file) { setErr('Добавьте текстовый ответ или файл'); return; }
    setErr('');
    setSaving(true);

    let filePath = null, fileName = null;
    try {
      if (file) {
        setUploading(true);
        setProgress(20);
        const result = await uploadFileToBlobCDN(file);
        setProgress(100);
        filePath = result.url;
        fileName = result.name;
        setUploading(false);
      }
      await API.post(`/api/v1/hw/assignments/${assignment.id}/submit`, {
        textAnswer: text.trim() || undefined,
        filePath,
        fileName,
      });
      toast('Работа отправлена!', 'success');
      onReload();
      onClose();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  return (
    <HWModal
      title={assignment.title}
      subtitle={`${assignment.class_name} · до ${fmtDate(assignment.due_date)} · макс. ${assignment.max_score}`}
      onClose={onClose}
    >
      {assignment.description && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 13, lineHeight: 1.6 }}>
          {assignment.description}
        </div>
      )}
      {assignment.file_path && (
        <a href={assignment.file_path} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14, fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
          📎 Материал учителя: {assignment.file_name || 'Скачать'}
        </a>
      )}

      {/* Grade result */}
      {isGraded && (
        <div style={{ marginBottom: 14, padding: 14, background: 'var(--green-s)', borderRadius: 8, border: '1px solid var(--green)' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--green)' }}>
            {getGradeIcon(existing.score, assignment.grading_scale)} {existing.score}/{assignment.max_score}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{getGradeLabel(existing.score, assignment.grading_scale)}</div>
          {existing.feedback && <div style={{ marginTop: 8, fontSize: 13 }}>💬 {existing.feedback}</div>}
        </div>
      )}

      {/* Returned notice */}
      {existing?.status === 'returned' && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--amber-s)', borderRadius: 8, border: '1px solid var(--amber)', fontSize: 13 }}>
          ↩ Работа возвращена на доработку{existing.feedback ? `: ${existing.feedback}` : ''}
        </div>
      )}

      {/* Submitted notice */}
      {existing?.status === 'submitted' && !canEdit && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: 'var(--blue-s)', borderRadius: 8, fontSize: 13 }}>
          ✅ Работа отправлена, ожидает проверки
        </div>
      )}

      {/* Past deadline */}
      {isPast && !isGraded && (
        <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--red-s)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
          ⏱ Дедлайн истёк
        </div>
      )}

      {/* Submit form */}
      {canEdit && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="fi-label">Ответ</label>
            <textarea
              className="fi" rows={4}
              placeholder="Напишите ваш ответ здесь..."
              value={text}
              onChange={e => setText(e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>
          <FilePicker
            file={file}
            uploading={uploading}
            progress={progress}
            onFile={setFile}
            onClear={() => setFile(null)}
          />
          {err && <div style={{ color: 'var(--red)', fontSize: 12, padding: '8px 12px', background: 'var(--red-s)', borderRadius: 6 }}>⚠️ {err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-s" onClick={onClose}>Закрыть</button>
            <button type="submit" className="btn btn-p" disabled={saving || uploading}>
              {saving ? 'Отправка...' : uploading ? 'Загрузка...' : existing ? 'Обновить' : 'Отправить'}
            </button>
          </div>
        </form>
      )}

      {!canEdit && (
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <button className="btn btn-s" onClick={onClose}>Закрыть</button>
        </div>
      )}
    </HWModal>
  );
}

// ── Main HomeworkModule ───────────────────────────────────────────────────────
function HomeworkModule({ user }) {
  const isTeacher = ['teacher','center_admin','super_admin'].includes(user.role);
  const isStudent = user.role === 'student';

  const { data: classes } = useApi(() => API.get('/api/v1/classes'));
  const [classFilter, setClassFilter] = useState('');
  const url = '/api/v1/hw/assignments' + (classFilter ? `?classId=${classFilter}` : '');
  const { data: assignments, loading, reload } = useApi(() => API.get(url), [url]);

  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [viewSubs, setViewSubs]     = useState(null); // assignment for submissions modal
  const [submitTarget, setSubmitTarget] = useState(null); // assignment for submit modal

  const confirm = useConfirm();
  const toast   = useToast();

  async function deleteAssignment(a) {
    const ok = await confirm(
      `Задание «${a.title}» и все сданные работы будут удалены. Отменить нельзя.`,
      'Удалить задание?', { danger: true, confirmText: 'Удалить', icon: '🗑️' });
    if (!ok) return;
    try {
      await API.del(`/api/v1/hw/assignments/${a.id}`);
      toast('Задание удалено', 'success');
      reload();
    } catch (ex) { toast(ex.message, 'error'); }
  }

  // Compute student stats
  const pending = isStudent ? (assignments || []).filter(a => !a.submission_id && new Date(a.due_date) >= new Date()) : [];
  const overdue = isStudent ? (assignments || []).filter(a => !a.submission_id && new Date(a.due_date) < new Date()) : [];
  const graded  = isStudent ? (assignments || []).filter(a => a.submission_status === 'graded') : [];

  if (loading) return <Spinner />;

  return (
    <div className="fade">
      {/* Header */}
      <div className="ph" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pt">Задания</div>
          <div className="ps">{isTeacher ? 'Управление заданиями и проверка работ' : 'Мои домашние задания'}</div>
        </div>
        {isTeacher && (
          <button className="btn btn-p btn-sm" onClick={() => setShowCreate(true)}>+ Создать</button>
        )}
      </div>

      {/* Student stats */}
      {isStudent && (
        <div className="g3" style={{ marginBottom: 16 }}>
          {[
            { label: 'К сдаче',    value: pending.length, color: '#4f46e5', icon: '📋' },
            { label: 'Просрочено', value: overdue.length, color: '#ef4444', icon: '⚠️' },
            { label: 'Проверено',  value: graded.length,  color: '#10b981', icon: '✅' },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>{s.icon}</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 20, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Class filter */}
      {(classes?.length > 1 || isTeacher) && (
        <div style={{ marginBottom: 14 }}>
          <select className="fi" style={{ maxWidth: 260 }} value={classFilter} onChange={e => setClassFilter(e.target.value)}>
            <option value="">Все классы</option>
            {(classes || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {/* Assignment list */}
      {!assignments?.length
        ? <div className="empty"><div className="empty-ico">📋</div>Нет заданий</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {assignments.map(a => {
              const isPast   = new Date(a.due_date) < new Date();
              const subStatus = a.submission_status || (isPast && !a.submission_id ? 'overdue' : !a.submission_id ? 'pending' : null);

              return (
                <div key={a.id} className="card" style={{ padding: '14px 16px', borderLeft: `4px solid ${a.class_color || '#6366f1'}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{a.title}</span>
                        {isTeacher && !a.is_published && <span className="bdg bk" style={{fontSize:10}}>Черновик</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                        {a.class_name} · <Deadline date={a.due_date} /> · макс. {a.max_score}
                      </div>
                      {a.description && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {a.description}
                        </div>
                      )}
                      {isTeacher && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, display: 'flex', gap: 12 }}>
                          <span>✅ Проверено: <strong>{a.graded_count || 0}</strong></span>
                          <span>⏳ Ожидает: <strong style={{ color: +a.pending_count > 0 ? 'var(--amber)' : undefined }}>{a.pending_count || 0}</strong></span>
                          <span>👥 Всего: <strong>{a.student_count || 0}</strong></span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                      {isStudent && <HWStatusBadge status={subStatus} score={a.submission_score} maxScore={a.max_score} />}
                      <div style={{ display: 'flex', gap: 6 }}>
                        {isTeacher && (
                          <>
                            <button className="btn btn-p btn-sm" onClick={() => setViewSubs(a)}>
                              📋 Работы {+a.pending_count > 0 ? `(${a.pending_count} новых)` : ''}
                            </button>
                            <button className="btn btn-s btn-sm" onClick={() => setEditTarget(a)}>✏️</button>
                            <button className="btn btn-d btn-sm" onClick={() => deleteAssignment(a)}>🗑️</button>
                          </>
                        )}
                        {isStudent && (
                          <button
                            className={`btn btn-sm ${a.submission_status === 'graded' ? 'btn-s' : 'btn-p'}`}
                            onClick={() => setSubmitTarget(a)}
                            disabled={isPast && !a.submission_id}
                          >
                            {a.submission_status === 'graded'   ? '📊 Оценка' :
                             a.submission_status === 'returned'  ? '↩ Доработать' :
                             a.submission_status === 'submitted' ? '👁 Просмотр' :
                             isPast ? '⏱ Просрочено' : '📤 Сдать'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }

      {/* Modals */}
      {showCreate && (
        <HWCreateModal
          classes={classes}
          onSave={() => { setShowCreate(false); reload(); }}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editTarget && (
        <HWCreateModal
          classes={classes}
          editData={editTarget}
          onSave={() => { setEditTarget(null); reload(); }}
          onClose={() => setEditTarget(null)}
        />
      )}
      {viewSubs && (
        <HWSubmissionsModal
          assignment={viewSubs}
          onClose={() => setViewSubs(null)}
          onReload={reload}
        />
      )}
      {submitTarget && (
        <HWSubmitModal
          assignment={submitTarget}
          onClose={() => setSubmitTarget(null)}
          onReload={reload}
        />
      )}
    </div>
  );
}

// ·· GRADEBOOK VIEW (teacher / admin)
function GradebookView({ user }) {
  const { data: classes, loading: clsLoading } = useApi(() => API.get('/api/v1/classes'));
  const [selClass, setSelClass] = useState('');
  const classId = selClass || (classes?.[0]?.id);
  const { data: gb, loading, reload } = useApi(() => classId ? API.get(`/api/v1/grades/class/${classId}`) : Promise.resolve(null), [classId]);
  const [editing, setEditing] = useState(null); // {r, c}
  const [editVal, setEditVal] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function saveScore(r, c) {
    if (saving) return;
    const val = editVal.trim();
    setEditing(null);
    if (val === '') return;
    const score = parseFloat(val);
    const assignment = gb.assignments[c];
    if (isNaN(score) || score < 0 || score > assignment.max_score) {
      toast(`Оценка от 0 до ${assignment.max_score}`, 'error');
      return;
    }
    setSaving(true);
    try {
      await API.post('/api/v1/grades/direct', {
        studentId: gb.matrix[r].student.id,
        assignmentId: assignment.id,
        score,
      });
      reload();
      toast('Оценка сохранена', 'success');
    } catch(ex) { toast(ex.message, 'error'); }
    setSaving(false);
  }

  function startEdit(r, c, currentScore) {
    setEditing({r, c});
    setEditVal(currentScore != null ? String(currentScore) : '');
  }

  if (clsLoading) return <Spinner/>;
  if (!classes?.length) return <div className="fade"><div className="empty"><div className="empty-ico">📊</div>Нет классов</div></div>;

  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}><div className="pt">Журнал оценок</div><div className="ps">Нажмите на ячейку — введите оценку — Enter</div></div>
        {classId && <a href={`/api/v1/grades/class/${classId}/export`} className="btn btn-s">📥 CSV</a>}
      </div>
      <div style={{marginBottom:14,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <select className="fi" style={{maxWidth:280}} value={classId||''} onChange={e=>{setSelClass(parseInt(e.target.value));setEditing(null);}}>
          {(classes||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {saving && <span style={{fontSize:11,color:'var(--muted)'}}>Сохранение...</span>}
      </div>
      {loading ? <Spinner/> : gb ? (
        <div className="card" style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
          <div className="cb" style={{padding:0}}>
            <table className="tbl" style={{fontSize:11}}>
              <thead>
                <tr>
                  <th style={{position:'sticky',left:0,background:'var(--surface2)',zIndex:1}}>Ученик</th>
                  {(gb.assignments||[]).map(a=>(
                    <th key={a.id} style={{textAlign:'center',maxWidth:80,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={`${a.title} (макс: ${a.max_score})`}>
                      {a.title}<div style={{fontWeight:400,color:'var(--muted)',fontSize:10}}>/{a.max_score}</div>
                    </th>
                  ))}
                  <th style={{textAlign:'center'}}>Итог</th>
                  <th style={{textAlign:'center'}}>Оценка</th>
                </tr>
              </thead>
              <tbody>
                {(gb.matrix||[]).map((row,i)=>(
                  <tr key={i}>
                    <td style={{fontWeight:600,position:'sticky',left:0,background:'#fff',zIndex:1}}>{row.student.name}</td>
                    {row.scores.map((s,j)=>{
                      const isEditing = editing?.r===i && editing?.c===j;
                      const scoreNum = s?.score != null ? s.score : null;
                      const pctColor = scoreNum != null ? gColor((scoreNum/gb.assignments[j].max_score)*100) : '#d1d5db';
                      return (
                        <td key={j} style={{textAlign:'center',cursor:'pointer',padding:'4px 6px'}}
                          onClick={()=>!isEditing && startEdit(i, j, scoreNum)}>
                          {isEditing ? (
                            <input
                              autoFocus
                              style={{width:44,textAlign:'center',padding:'2px 4px',border:'2px solid var(--accent)',borderRadius:4,fontSize:12,outline:'none'}}
                              value={editVal}
                              onChange={e=>setEditVal(e.target.value)}
                              onKeyDown={e=>{
                                if(e.key==='Enter'){e.preventDefault();saveScore(i,j);}
                                if(e.key==='Escape'){setEditing(null);}
                              }}
                            />
                          ) : scoreNum != null ? (
                            <span style={{fontWeight:700,color:pctColor}}>{scoreNum}</span>
                          ) : (
                            <span style={{color:'#d1d5db',fontSize:14}}>·</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{textAlign:'center',fontWeight:700}}>{row.pct!==null?`${row.pct}%`:'—'}</td>
                    <td style={{textAlign:'center'}}>{row.letter ? <span className="gc" style={{width:30,height:30,fontSize:12,display:'inline-flex',background:gBg(row.pct),color:gColor(row.pct)}}>{row.letter}</span> : '—'}</td>
                  </tr>
                ))}
                {(!gb.matrix||!gb.matrix.length)&&<tr><td colSpan={99}><div className="empty">Нет данных</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : <div className="empty">Выберите класс</div>}
    </div>
  );
}

// ·· NOTIFICATIONS PAGE (full page view)
function NotificationsPage({ onRead }) {
  const { data, loading, reload } = useApi(() => API.get('/api/v1/notifications'));
  const notifs = data?.notifs || [];
  async function readAll() { await API.post('/api/v1/notifications/read-all'); reload(); if(onRead) onRead(); }
  async function del(id) { await API.del(`/api/v1/notifications/${id}`); reload(); if(onRead) onRead(); }
  async function markRead(id) { await API.patch(`/api/v1/notifications/${id}/read`); reload(); if(onRead) onRead(); }

  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}><div className="pt">Уведомления</div><div className="ps">Все ваши уведомления</div></div>
        {notifs.length>0 && <button className="btn btn-s" onClick={readAll}>Прочитать все</button>}
      </div>
      {loading ? <Spinner/> : notifs.length===0 ? <div className="empty"><div className="empty-ico">🔔</div>Нет уведомлений</div> : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {notifs.map(n=>(
            <div key={n.id} className="card" style={{padding:'12px 16px',opacity:n.is_read?0.7:1,borderLeft:n.is_read?'':'3px solid var(--accent)',cursor:'pointer'}} onClick={()=>markRead(n.id)}>
              <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
                <span style={{fontSize:18}}>{n.type==='success'?'✅':n.type==='warning'?'⚠️':n.type==='error'?'❌':'ℹ️'}</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13}}>{n.title}</div>
                  <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{n.body}</div>
                  <div style={{fontSize:10,color:'var(--muted)',marginTop:4}}>{fmtDate(n.created_at)}</div>
                </div>
                <button className="btn btn-d btn-sm" onClick={e=>{e.stopPropagation();del(n.id);}}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ·· PROFILE PAGE
function ProfilePage({ user, onLogout, onNameChange }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword:'', newPassword:'' });
  const [pwErr, setPwErr] = useState('');
  const [pwOk, setPwOk] = useState(false);
  const toast = useToast();

  // Avatar: stored in localStorage, keyed by user id
  const AVATAR_EMOJIS = ['😊','🦁','🐯','🐻','🦊','🐸','🐧','🦋','🌟','🚀','🎯','🎨','🎵','💡','🌈'];
  const AVATAR_COLORS = ['hsl(160,50%,40%)','hsl(220,60%,55%)','hsl(280,55%,55%)','hsl(340,60%,55%)','hsl(30,70%,50%)','hsl(190,60%,45%)'];
  const storedAvatar = JSON.parse(localStorage.getItem(`avatar_${user.id}`) || 'null');
  const [avatarEmoji, setAvatarEmoji] = useState(storedAvatar?.emoji || '');
  const [avatarColor, setAvatarColor] = useState(storedAvatar?.color || avaColor(user.role));
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  function saveAvatar(emoji, color) {
    localStorage.setItem(`avatar_${user.id}`, JSON.stringify({ emoji, color }));
    setAvatarEmoji(emoji); setAvatarColor(color); setShowAvatarPicker(false);
    toast('Аватар обновлён', 'success');
  }

  async function saveName(e) {
    e.preventDefault(); setSaving(true);
    try { await API.patch('/api/v1/users/me', { name }); if(onNameChange) onNameChange(name); toast('Имя обновлено','success'); } catch(ex) { alert(ex.message); }
    setSaving(false);
  }

  async function saveEmail(e) {
    e.preventDefault(); setEmailSaving(true);
    try { await API.patch('/api/v1/users/me', { email }); toast('Email обновлён','success'); } catch(ex) { alert(ex.message); }
    setEmailSaving(false);
  }

  async function changePassword(e) {
    e.preventDefault(); setPwErr(''); setPwOk(false);
    try { await API.patch('/api/v1/auth/change-password', pwForm); setPwOk(true); setPwForm({currentPassword:'',newPassword:''}); toast('Пароль изменён','success'); } catch(ex) { setPwErr(ex.message); }
  }

  const displayEmoji = avatarEmoji;
  const displayColor = avatarColor;

  return (
    <div className="fade">
      <div className="ph"><div className="pt">Профиль</div><div className="ps">Настройки аккаунта</div></div>
      <div className="g2">
        <div className="card" style={{padding:'18px'}}>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:18}}>
            <div style={{position:'relative',cursor:'pointer'}} onClick={()=>setShowAvatarPicker(v=>!v)}>
              <div className="ava" style={{width:56,height:56,fontSize:displayEmoji?26:20,background:displayColor}}>
                {displayEmoji || initials(user.name)}
              </div>
              <div style={{position:'absolute',bottom:-2,right:-2,background:'var(--primary)',color:'#fff',borderRadius:'50%',width:18,height:18,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10}}>✏️</div>
            </div>
            <div>
              <div style={{fontWeight:800,fontSize:16}}>{user.name}</div>
              <div style={{fontSize:12,color:'var(--muted)'}}>{user.email}</div>
              <span className="bdg bp" style={{marginTop:4}}>{roleLabel[user.role]}</span>
            </div>
          </div>
          {showAvatarPicker && (
            <div style={{background:'var(--bg2)',borderRadius:10,padding:14,marginBottom:14,border:'1px solid var(--border)'}}>
              <div style={{fontWeight:600,fontSize:12,marginBottom:8,color:'var(--muted)'}}>Выберите эмодзи</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
                {AVATAR_EMOJIS.map(e=>(
                  <button key={e} onClick={()=>setAvatarEmoji(e)} style={{fontSize:22,background:avatarEmoji===e?'var(--primary-light)':'transparent',border:avatarEmoji===e?'2px solid var(--primary)':'2px solid transparent',borderRadius:8,padding:'2px 4px',cursor:'pointer'}}>{e}</button>
                ))}
                <button onClick={()=>setAvatarEmoji('')} style={{fontSize:12,background:!avatarEmoji?'var(--primary-light)':'transparent',border:!avatarEmoji?'2px solid var(--primary)':'2px solid var(--border)',borderRadius:8,padding:'2px 8px',cursor:'pointer',color:'var(--muted)'}}>Инициалы</button>
              </div>
              <div style={{fontWeight:600,fontSize:12,marginBottom:8,color:'var(--muted)'}}>Цвет фона</div>
              <div style={{display:'flex',gap:6,marginBottom:12}}>
                {AVATAR_COLORS.map(c=>(
                  <button key={c} onClick={()=>setAvatarColor(c)} style={{width:28,height:28,borderRadius:'50%',background:c,border:avatarColor===c?'3px solid var(--text)':'3px solid transparent',cursor:'pointer'}}/>
                ))}
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-p btn-sm" onClick={()=>saveAvatar(avatarEmoji,avatarColor)}>Сохранить</button>
                <button className="btn btn-s btn-sm" onClick={()=>setShowAvatarPicker(false)}>Отмена</button>
              </div>
            </div>
          )}
          <form onSubmit={saveName} style={{marginBottom:12}}>
            <div className="fg"><label className="fl">Имя</label><input className="fi" value={name} onChange={e=>setName(e.target.value)} required/></div>
            <button type="submit" className="btn btn-p" disabled={saving} style={{width:'100%',justifyContent:'center'}}>{saving?'...':'Сохранить имя'}</button>
          </form>
          <form onSubmit={saveEmail}>
            <div className="fg"><label className="fl">Email</label><input className="fi" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></div>
            <button type="submit" className="btn btn-s" disabled={emailSaving} style={{width:'100%',justifyContent:'center'}}>{emailSaving?'...':'Изменить email'}</button>
          </form>
        </div>
        <div className="card" style={{padding:'18px'}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>🔒 Сменить пароль</div>
          <Alert msg={pwErr}/>
          {pwOk && <div style={{background:'var(--green-s)',border:'1px solid #a7f3d0',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#059669',marginBottom:12}}>✅ Пароль успешно изменён</div>}
          <form onSubmit={changePassword}>
            <div className="fg"><label className="fl">Текущий пароль</label><input className="fi" type="password" required value={pwForm.currentPassword} onChange={e=>setPwForm(f=>({...f,currentPassword:e.target.value}))}/></div>
            <div className="fg"><label className="fl">Новый пароль</label><input className="fi" type="password" required minLength={8} value={pwForm.newPassword} onChange={e=>setPwForm(f=>({...f,newPassword:e.target.value}))} placeholder="Минимум 8 символов"/></div>
            <button type="submit" className="btn btn-p" style={{width:'100%',justifyContent:'center'}}>Сменить пароль</button>
          </form>
        </div>
      </div>
      <div style={{marginTop:24,textAlign:'center'}}>
        <button className="btn btn-d" onClick={async()=>{await API.logout();onLogout();}}>🚪 Выйти из аккаунта</button>
      </div>
    </div>
  );
}

// ·· USERS VIEW (admin)
function UsersView({ user }) {
  const [tab, setTab] = useState('student');
  const isSuperAdmin = user.role === 'super_admin';
  const { data: centers } = useApi(() => isSuperAdmin ? API.get('/api/v1/centers') : Promise.resolve(null));
  const [centerId, setCenterId] = useState(null);
  const effectiveCenterId = isSuperAdmin ? (centerId || centers?.[0]?.id) : null;
  const queryStr = isSuperAdmin && effectiveCenterId ? `/api/v1/users?role=${tab}&centerId=${effectiveCenterId}` : `/api/v1/users?role=${tab}`;
  const { data: users, loading, reload } = useApi(() => {
    if (isSuperAdmin && !effectiveCenterId) return Promise.resolve([]);
    return API.get(queryStr);
  }, [tab, effectiveCenterId]);
  const { data: students } = useApi(() => {
    if (isSuperAdmin && !effectiveCenterId) return Promise.resolve([]);
    return API.get(isSuperAdmin ? `/api/v1/users?role=student&centerId=${effectiveCenterId}` : '/api/v1/users?role=student');
  }, [effectiveCenterId]);
  const [linkParent, setLinkParent] = useState(null); // parent user object
  const [linkStudentId, setLinkStudentId] = useState('');
  const [linkErr, setLinkErr] = useState('');
  const [search, setSearch] = useState('');
  const [resetUser, setResetUser] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [resetErr, setResetErr] = useState('');
  const [resetOk, setResetOk] = useState(false);

  async function handleResetPassword(e) {
    e.preventDefault(); setResetErr(''); setResetOk(false);
    if (!resetPw || resetPw.length < 8) return setResetErr('Минимум 8 символов');
    try {
      await API.post(`/api/v1/users/${resetUser.id}/reset-password`, { newPassword: resetPw });
      setResetOk(true);
    } catch(ex) { setResetErr(ex.message); }
  }

  async function addChild(e) {
    e.preventDefault(); setLinkErr('');
    try {
      await API.post(`/api/v1/users/${linkParent.id}/children`, { studentId: parseInt(linkStudentId) });
      setLinkParent(null); setLinkStudentId('');
    } catch(ex) { setLinkErr(ex.message); }
  }

  return (
    <div className="fade">
      <div className="ph"><div className="pt">Пользователи</div></div>
      {isSuperAdmin && centers?.length > 0 && (
        <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:10}}>
          <label style={{fontSize:12,fontWeight:600,color:'var(--muted)'}}>Центр:</label>
          <select className="fi" style={{width:'100%',maxWidth:320}} value={effectiveCenterId||''} onChange={e=>setCenterId(parseInt(e.target.value))}>
            {centers.map(c=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
        </div>
      )}
      <div className="tabs">
        {['student','teacher','parent','center_admin'].map(r=>(
          <button key={r} className={`tab ${tab===r?'active':''}`} onClick={()=>setTab(r)}>{rolePlural[r]}</button>
        ))}
      </div>
      <div style={{marginBottom:14}}>
        <input className="fi" style={{maxWidth:320}} placeholder="🔍 Поиск по имени или email..." value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>
      {loading ? <Spinner/> : (
        <div className="card">
          <div className="cb" style={{padding:0}}>
            <ResponsiveTable
              headers={['Имя','Email','Роль','Статус','Создан',...(tab==='parent'?['Дети']:[]),'Действия']}
              rows={(users||[]).filter(u => {
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
              })}
              emptyIcon="👥" emptyText="Нет пользователей"
              renderRow={u=>(
                <tr key={u.id}>
                  <td><div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div className="ava" style={{width:28,height:28,fontSize:11,background:avaColor(u.role)}}>{initials(u.name)}</div>
                    <span style={{fontWeight:600}}>{u.name}</span>
                  </div></td>
                  <td style={{color:'var(--muted)',fontSize:12}}>{u.email}</td>
                  <td><span className={`bdg ${u.role==='teacher'?'bp':u.role==='student'?'bg':u.role==='parent'?'ba':'bb'}`}>{roleLabel[u.role]}</span></td>
                  <td><span className={`bdg ${u.is_active?'bg':'br'}`}>{u.is_active?'Активен':'Заблокирован'}</span></td>
                  <td style={{fontSize:11,color:'var(--muted)'}}>{fmtDate(u.created_at)}</td>
                  {tab==='parent'&&<td><button className="btn btn-sm btn-s" onClick={()=>{setLinkParent(u);setLinkStudentId('');setLinkErr('');}}>+ Ребёнок</button></td>}
                  <td><button className="btn btn-sm btn-s" onClick={()=>{setResetUser(u);setResetPw('');setResetErr('');setResetOk(false);}} title="Сбросить пароль">🔑</button></td>
                </tr>
              )}
              renderCard={u=>(
                <div key={u.id} className="card" style={{padding:'12px 14px',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                    <div className="ava" style={{width:36,height:36,fontSize:13,background:avaColor(u.role)}}>{initials(u.name)}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:14}}>{u.name}</div>
                      <div style={{fontSize:12,color:'var(--muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.email}</div>
                    </div>
                    <span className={`bdg ${u.is_active?'bg':'br'}`}>{u.is_active?'Активен':'Забл.'}</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    <span className={`bdg ${u.role==='teacher'?'bp':u.role==='student'?'bg':u.role==='parent'?'ba':'bb'}`}>{roleLabel[u.role]}</span>
                    <span style={{fontSize:11,color:'var(--muted)'}}>{fmtDate(u.created_at)}</span>
                    <div style={{marginLeft:'auto',display:'flex',gap:6}}>
                      {tab==='parent'&&<button className="btn btn-sm btn-s" onClick={()=>{setLinkParent(u);setLinkStudentId('');setLinkErr('');}}>+ Ребёнок</button>}
                      <button className="btn btn-sm btn-s" onClick={()=>{setResetUser(u);setResetPw('');setResetErr('');setResetOk(false);}}>🔑</button>
                    </div>
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      )}
      {linkParent && (
        <Modal title={`👶 Привязать ребёнка к ${linkParent.name}`} onClose={()=>setLinkParent(null)}>
          <Alert msg={linkErr}/>
          <p style={{fontSize:13,color:'var(--muted)',marginBottom:12}}>Выберите ученика, которого хотите привязать к этому родителю. После этого родитель сможет видеть оценки, посещаемость и задания ребёнка.</p>
          <form onSubmit={addChild}>
            <div className="fg"><label className="fl">Ученик</label>
              <select className="fi" required value={linkStudentId} onChange={e=>setLinkStudentId(e.target.value)}>
                <option value="">— выберите ученика —</option>
                {(students||[]).map(s=><option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
              </select>
            </div>
            <div style={{display:'flex',gap:8,marginTop:14}}>
              <button type="submit" className="btn btn-p" style={{flex:1}}>Привязать</button>
              <button type="button" className="btn btn-s" onClick={()=>setLinkParent(null)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}
      {resetUser && (
        <Modal title={`🔑 Сбросить пароль: ${resetUser.name}`} onClose={()=>setResetUser(null)}>
          <Alert msg={resetErr}/>
          {resetOk ? (
            <div>
              <div style={{background:'var(--green-s)',border:'1px solid #a7f3d0',borderRadius:8,padding:'10px 12px',fontSize:12,color:'#059669',marginBottom:12}}>✅ Пароль успешно изменён</div>
              <div style={{fontSize:13,marginBottom:12}}>Новый пароль для <b>{resetUser.name}</b>:</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:700,background:'#fff',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',marginTop:8,letterSpacing:1,textAlign:'center',userSelect:'all'}}>{resetPw}</div>
              <div style={{fontSize:11,color:'var(--muted)',marginTop:6}}>Передайте этот пароль пользователю. Все его сессии были завершены.</div>
            </div>
          ) : (
            <form onSubmit={handleResetPassword}>
              <p style={{fontSize:13,color:'var(--muted)',marginBottom:12}}>Введите новый временный пароль. Все текущие сессии пользователя будут завершены.</p>
              <div className="fg"><label className="fl">Новый пароль</label>
                <input className="fi" type="text" required minLength={8} value={resetPw} onChange={e=>setResetPw(e.target.value)} placeholder="Минимум 8 символов"/>
              </div>
              <div style={{display:'flex',gap:8,marginTop:14}}>
                <button type="submit" className="btn btn-p" style={{flex:1}}>Сбросить пароль</button>
                <button type="button" className="btn btn-s" onClick={()=>setResetUser(null)}>Отмена</button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}

function NotifPanel({ onClose, onRead }) {
  const { data: notifData, loading, reload } = useApi(() => API.get('/api/v1/notifications'));
  const notifs = notifData?.notifs || [];
  async function readAll() {
    await API.post('/api/v1/notifications/read-all');
    reload(); if (onRead) onRead();
  }
  function markRead(id) {
    API.patch(`/api/v1/notifications/${id}/read`).then(()=>{ reload(); if (onRead) onRead(); });
  }
  function del(id, e) {
    e.stopPropagation();
    API.del(`/api/v1/notifications/${id}`).then(()=>{ reload(); if (onRead) onRead(); });
  }
  return (
    <div className="np" onClick={e=>e.stopPropagation()}>
      <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontWeight:700,fontSize:13,display:'flex',justifyContent:'space-between'}}>
        Уведомления
        <span style={{fontSize:11,color:'var(--accent)',cursor:'pointer',fontWeight:600}} onClick={readAll}>Прочитать все</span>
      </div>
      {loading ? <div style={{padding:20,textAlign:'center',fontSize:12,color:'var(--muted)'}}>...</div> :
        (notifs||[]).length===0 ? <div style={{padding:20,textAlign:'center',fontSize:12,color:'var(--muted)'}}>Нет уведомлений</div> :
        (notifs||[]).map(n=>(
          <div key={n.id} className={`ni ${!n.is_read?'unread':''}`} onClick={()=>markRead(n.id)}>
            <span style={{fontSize:16}}>{n.type==='success'?'✅':n.type==='warning'?'⚠️':n.type==='error'?'❌':'ℹ️'}</span>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600}}>{n.title}</div><div style={{fontSize:11,color:'var(--muted)',marginTop:1}}>{n.body}</div></div>
            <span style={{fontSize:11,cursor:'pointer',color:'var(--muted)',padding:'2px 4px',borderRadius:4,flexShrink:0}} onClick={e=>del(n.id,e)} title="Удалить">✕</span>
          </div>
        ))
      }
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ·· SCHEDULE MODULE v2  — full rewrite
//    Architecture:
//      lessons          — repeating weekly slot
//      lesson_teachers  — M:M teachers ↔ lessons
//      lesson_students  — M:M students ↔ individual lessons
//    Backend: /api/v1/sched (routes/sched.js)
//    Migration: 20250316000000_lessons.js
// ══════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────────
const SM_DAYS   = ['','Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const SM_DFULL  = ['','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const SM_WORK   = [1,2,3,4,5,6];          // Mon–Sat
const SM_COLORS = ['#6366f1','#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];
const HOUR_H    = 56;    // px per hour in time-grid
const GRID_FROM = 7;     // 07:00
const GRID_TO   = 21;    // 21:00

function smToMins(hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function smAddMins(hhmm, mins) {
  const t = smToMins(hhmm) + mins;
  return `${String(Math.floor(t/60)%24).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
}
function smTop(st)  { return Math.max(0, (smToMins(st) - GRID_FROM * 60) / 60 * HOUR_H); }
function smHeight(d){ return Math.max((d / 60) * HOUR_H, 22); }
function smInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

// ── Lesson card (mobile list) ─────────────────────────────────────────────────
function LessonListCard({ lesson, onClick }) {
  const end = smAddMins(lesson.start_time, lesson.duration_min);
  const teachers = Array.isArray(lesson.teachers) ? lesson.teachers : JSON.parse(lesson.teachers || '[]');
  return (
    <div className="lsn-card" onClick={onClick} style={{ marginBottom: 8 }}>
      <div className="lsn-card-dot" style={{ background: lesson.color || '#6366f1' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="lsn-card-title">{lesson.title}</div>
        <div className="lsn-card-sub">
          {lesson.class_name && <span>{lesson.class_name} · </span>}
          {teachers.map(t => t.name).join(', ')}
        </div>
        {lesson.notes && (
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {lesson.notes}
          </div>
        )}
      </div>
      <div className="lsn-card-time">{lesson.start_time}<br/>{end}</div>
    </div>
  );
}

// ── Lesson detail modal ───────────────────────────────────────────────────────
function LessonDetailModal({ lesson, canDelete, onDelete, onClose }) {
  const teachers = Array.isArray(lesson.teachers) ? lesson.teachers : JSON.parse(lesson.teachers || '[]');
  const students = Array.isArray(lesson.students) ? lesson.students : JSON.parse(lesson.students || '[]');
  const end = smAddMins(lesson.start_time, lesson.duration_min);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 'min(460px,96vw)' }} onClick={e => e.stopPropagation()}>
        {/* Color stripe header */}
        <div style={{ background: lesson.color || '#6366f1', borderRadius: '10px 10px 0 0', padding: '14px 18px', margin: '-20px -20px 16px', color:'#fff' }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Space Grotesk',sans-serif" }}>{lesson.title}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
            {SM_DFULL[lesson.day_of_week]} · {lesson.start_time} – {end} ({lesson.duration_min} мин)
          </div>
        </div>
        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lesson.lesson_type === 'group' && lesson.class_name && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
              <span style={{ fontSize: 18 }}>👥</span>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>ГРУППА</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{lesson.class_name}</div>
              </div>
            </div>
          )}
          {lesson.lesson_type === 'individual' && students.length > 0 && (
            <div style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>УЧЕНИКИ</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {students.map(s => <span key={s.id} className="bdg bb">{s.name}</span>)}
              </div>
            </div>
          )}
          {teachers.length > 0 && (
            <div style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>УЧИТЕЛЯ</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {teachers.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="lsn-avatar" style={{ background: lesson.color || '#6366f1' }}>{smInitials(t.name)}</div>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {lesson.notes && (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
              💬 {lesson.notes}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          {canDelete && (
            <button className="btn btn-d btn-sm" onClick={onDelete}>🗑 Удалить</button>
          )}
          <button className="btn btn-s" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

// ── Create lesson modal ───────────────────────────────────────────────────────
function CreateLessonModal({ user, onSave, onClose }) {
  const [form, setForm] = useState({
    title: '', dayOfWeek: 1, startTime: '09:00', durationMin: 60,
    color: '#6366f1', lessonType: 'group', classId: '', notes: '',
    teacherIds: [user.id], studentIds: [],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const toast = useToast();

  const { data: allClasses } = useApi(() => API.get('/api/v1/classes'));
  const { data: allTeachers } = useApi(() =>
    ['center_admin','super_admin'].includes(user.role)
      ? API.get('/api/v1/users?role=teacher')
      : Promise.resolve([])
  );
  const { data: allStudents } = useApi(() => API.get('/api/v1/users?role=student'));

  function setF(k) { return v => setForm(f => ({ ...f, [k]: v })); }

  function toggleId(key, id) {
    setForm(f => {
      const set = new Set(f[key]);
      set.has(id) ? set.delete(id) : set.add(id);
      return { ...f, [key]: [...set] };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const parsedClassId = parseInt(form.classId, 10);
      await API.post('/api/v1/sched', {
        ...form,
        classId:     form.lessonType === 'group' && !isNaN(parsedClassId) ? parsedClassId : null,
        studentIds:  form.lessonType === 'individual' ? form.studentIds : [],
        teacherIds:  form.teacherIds,
        durationMin: parseInt(form.durationMin, 10),
      });
      toast('Занятие добавлено', 'success');
      onSave();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
    }
  }

  const DUR_OPTS = [
    { v: 30,  l: '30 мин' }, { v: 45,  l: '45 мин' },
    { v: 60,  l: '1 час'  }, { v: 90,  l: '1.5 ч'  },
    { v: 120, l: '2 часа' }, { v: 150, l: '2.5 ч'  },
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 'min(520px,96vw)', maxHeight: '90dvh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>
        <div className="modal-t">➕ Новое занятие</div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title */}
          <div>
            <label className="fi-label">Название *</label>
            <input className="fi" value={form.title} onChange={e => setF('title')(e.target.value)} placeholder="Математика / Алгебра..." required />
          </div>
          {/* Day + Time + Duration */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label className="fi-label">День</label>
              <select className="fi" value={form.dayOfWeek} onChange={e => setF('dayOfWeek')(parseInt(e.target.value))}>
                {SM_WORK.map(d => <option key={d} value={d}>{SM_DFULL[d]}</option>)}
              </select>
            </div>
            <div>
              <label className="fi-label">Начало</label>
              <input className="fi" type="time" value={form.startTime} onChange={e => setF('startTime')(e.target.value)} required />
            </div>
            <div>
              <label className="fi-label">Длительность</label>
              <select className="fi" value={form.durationMin} onChange={e => setF('durationMin')(parseInt(e.target.value))}>
                {DUR_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
          </div>
          {/* Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['group','👥 Групповое'],['individual','👤 Индивидуальное']].map(([v,l]) => (
              <button key={v} type="button"
                style={{ padding: '10px 8px', border: `2px solid ${form.lessonType===v ? (form.color||'var(--primary)') : 'var(--border)'}`,
                  borderRadius: 8, background: form.lessonType===v ? (form.color||'var(--primary)')+'18' : 'var(--surface2)',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all .15s' }}
                onClick={() => setF('lessonType')(v)}>
                {l}
              </button>
            ))}
          </div>
          {/* Group: class picker */}
          {form.lessonType === 'group' && (
            <div>
              <label className="fi-label">Группа *</label>
              <select className="fi" value={form.classId} onChange={e => setF('classId')(e.target.value)} required>
                <option value="">— выбрать —</option>
                {(allClasses || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {/* Individual: student picker */}
          {form.lessonType === 'individual' && (
            <div>
              <label className="fi-label">Ученик * (можно несколько)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 120, overflowY: 'auto', padding: '4px 0' }}>
                {(allStudents || []).map(s => {
                  const active = form.studentIds.includes(s.id);
                  return (
                    <button key={s.id} type="button"
                      style={{ padding: '4px 10px', border: `1.5px solid ${active ? form.color : 'var(--border)'}`,
                        borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: active ? form.color+'18' : 'var(--surface2)', transition: 'all .12s' }}
                      onClick={() => toggleId('studentIds', s.id)}>
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Co-teachers (center_admin only; for teacher it's pre-filled) */}
          {user.role === 'center_admin' && (allTeachers || []).length > 0 && (
            <div>
              <label className="fi-label">Учителя *</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(allTeachers || []).map(t => {
                  const active = form.teacherIds.includes(t.id);
                  return (
                    <button key={t.id} type="button"
                      style={{ padding: '4px 10px', border: `1.5px solid ${active ? form.color : 'var(--border)'}`,
                        borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: active ? form.color+'18' : 'var(--surface2)', transition: 'all .12s' }}
                      onClick={() => toggleId('teacherIds', t.id)}>
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* Color */}
          <div>
            <label className="fi-label">Цвет занятия</label>
            <div className="color-picker">
              {SM_COLORS.map(c => (
                <div key={c} className={`color-swatch${form.color===c?' active':''}`}
                  style={{ background: c }} onClick={() => setF('color')(c)} />
              ))}
            </div>
          </div>
          {/* Notes */}
          <div>
            <label className="fi-label">Заметки</label>
            <textarea className="fi" rows={2} value={form.notes} onChange={e => setF('notes')(e.target.value)} placeholder="Кабинет, тема, напоминание..." style={{ resize: 'vertical' }} />
          </div>
          {err && (
            <div style={{ background: 'var(--red-s)', color: 'var(--red)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
              ⚠️ {err}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-s" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-p" disabled={saving}
              style={{ background: form.color, boxShadow: `0 8px 24px -6px ${form.color}88` }}>
              {saving ? 'Создание...' : 'Создать занятие'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Desktop time-grid view ────────────────────────────────────────────────────
function ScheduleTimeGrid({ lessons, canDelete, onDetail }) {
  const TOTAL_H = GRID_TO - GRID_FROM;
  const hours   = Array.from({ length: TOTAL_H + 1 }, (_, i) => GRID_FROM + i);
  const now     = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const nowTop  = (nowMins - GRID_FROM * 60) / 60 * HOUR_H;
  const showNow = nowMins >= GRID_FROM * 60 && nowMins < GRID_TO * 60;

  return (
    <div className="lsn-grid-wrap">
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '44px repeat(6,1fr)', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
        <div />
        {SM_WORK.map(d => {
          const isToday = (now.getDay() || 7) === d;
          return (
            <div key={d} style={{ textAlign: 'center', padding: '9px 4px', fontSize: 10, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', borderLeft: '1px solid var(--border)' }}>
              {SM_DAYS[d]}
              {isToday && <div style={{ width: 4, height: 4, background: 'var(--primary)', borderRadius: '50%', margin: '3px auto 0' }} />}
            </div>
          );
        })}
      </div>
      {/* Time grid body */}
      <div style={{ display: 'grid', gridTemplateColumns: '44px repeat(6,1fr)', position: 'relative' }}>
        {/* Time labels column */}
        <div style={{ position: 'relative', height: TOTAL_H * HOUR_H }}>
          {hours.map(h => (
            <div key={h} className="lsn-time-col" style={{ position: 'absolute', top: (h - GRID_FROM) * HOUR_H - 6, right: 6, width: 38 }}>
              {String(h).padStart(2,'0')}:00
            </div>
          ))}
        </div>
        {/* Day columns */}
        {SM_WORK.map(d => {
          const dayLessons = lessons.filter(l => l.day_of_week === d);
          const isToday    = (now.getDay() || 7) === d;
          return (
            <div key={d} className="lsn-day-col"
              style={{ height: TOTAL_H * HOUR_H, background: isToday ? 'hsla(160,50%,40%,0.025)' : undefined }}>
              {/* Hour lines */}
              {hours.map(h => (
                <div key={h} className="lsn-hour-line" style={{ top: (h - GRID_FROM) * HOUR_H }} />
              ))}
              {/* Now indicator */}
              {showNow && isToday && (
                <div className="lsn-now-line" style={{ top: nowTop }} />
              )}
              {/* Lesson blocks */}
              {dayLessons.map(l => {
                const teachers = Array.isArray(l.teachers) ? l.teachers : JSON.parse(l.teachers || '[]');
                return (
                  <div key={l.id} className="lsn-block"
                    style={{ top: smTop(l.start_time), height: smHeight(l.duration_min), background: (l.color||'#6366f1')+'20', borderLeftColor: l.color||'#6366f1', color: l.color||'#6366f1' }}
                    onClick={() => onDetail(l)}
                    title={`${l.title} · ${l.start_time}–${smAddMins(l.start_time, l.duration_min)}`}>
                    <div className="lsn-block-title">{l.title}</div>
                    <div className="lsn-block-sub">{l.start_time}–{smAddMins(l.start_time, l.duration_min)}</div>
                    {teachers.length > 0 && (
                      <div className="lsn-block-sub">{teachers.map(t => smInitials(t.name)).join(' · ')}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Admin teacher-list view ───────────────────────────────────────────────────
function AdminTeacherView({ user }) {
  const { data: teachers, loading: tLoad } = useApi(() => API.get('/api/v1/sched/teachers'));
  const [selTeacher, setSelTeacher] = useState(null);
  const url = selTeacher ? `/api/v1/sched?teacherId=${selTeacher.id}` : '/api/v1/sched';
  const { data: lessons, loading: lLoad, reload } = useApi(() => API.get(url), [url]);
  const [detail, setDetail] = useState(null);
  const confirm = useConfirm();
  const toast   = useToast();

  async function del(lesson) {
    const ok = await confirm(`Удалить занятие «${lesson.title}»?`, 'Удалить занятие', { danger: true, confirmText: 'Удалить', icon: '🗑️' });
    if (!ok) return;
    try {
      await API.del(`/api/v1/sched/${lesson.id}`);
      toast('Занятие удалено', 'success');
      setDetail(null);
      reload();
    } catch (ex) { toast(ex.message, 'error'); }
  }

  const isMobile = useIsMobile(768);
  const all = lessons || [];

  return (
    <div className="fade">
      <div className="ph" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="pt">Расписание учителей</div>
          <div className="ps">{all.length} занятий{selTeacher ? ` · ${selTeacher.name}` : ' · все учителя'}</div>
        </div>
      </div>
      {/* Teacher tabs */}
      {tLoad ? null : (
        <div className="sched-day-tabs" style={{ marginBottom: 14 }}>
          <button className={`sched-day-tab${!selTeacher ? ' active' : ''}`} onClick={() => setSelTeacher(null)}>
            Все
          </button>
          {(teachers || []).map(t => (
            <button key={t.id} className={`sched-day-tab${selTeacher?.id === t.id ? ' active' : ''}`}
              style={{ minWidth: 'auto', padding: '6px 12px' }}
              onClick={() => setSelTeacher(t)}>
              {t.name.split(' ')[0]} &nbsp;<span style={{ fontWeight: 400, fontSize: 9 }}>{t.lesson_count}</span>
            </button>
          ))}
        </div>
      )}
      {lLoad ? <Spinner /> : (
        isMobile ? (
          /* Mobile: grouped by day */
          <div>
            {SM_WORK.map(d => {
              const items = all.filter(l => l.day_of_week === d);
              if (!items.length) return null;
              return (
                <div key={d} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>{SM_DFULL[d]}</div>
                  {items.map(l => <LessonListCard key={l.id} lesson={l} onClick={() => setDetail(l)} />)}
                </div>
              );
            })}
            {!all.length && <div className="empty"><div className="empty-ico">🗓</div>Нет занятий</div>}
          </div>
        ) : (
          /* Desktop: time grid */
          !all.length
            ? <div className="empty" style={{ padding: 40 }}><div className="empty-ico">🗓</div>Нет занятий</div>
            : <ScheduleTimeGrid lessons={all} canDelete={false} onDetail={setDetail} />
        )
      )}
      {detail && (
        <LessonDetailModal lesson={detail} canDelete={true} onClose={() => setDetail(null)} onDelete={() => del(detail)} />
      )}
    </div>
  );
}

// ── Teacher view ──────────────────────────────────────────────────────────────
function TeacherScheduleView({ user }) {
  const { data: lessons, loading, reload } = useApi(() => API.get('/api/v1/sched'));
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail]         = useState(null);
  const [activeDay, setActiveDay]   = useState(() => {
    const d = new Date().getDay(); return d === 0 ? 6 : d;
  });
  const confirm = useConfirm();
  const toast   = useToast();
  const isMobile = useIsMobile(768);
  const all = lessons || [];
  const weekCount = all.length;

  async function del(lesson) {
    const ok = await confirm(`Занятие «${lesson.title}» будет удалено.`, 'Удалить занятие?', { danger: true, confirmText: 'Удалить', icon: '🗑️' });
    if (!ok) return;
    try {
      await API.del(`/api/v1/sched/${lesson.id}`);
      toast('Удалено', 'success');
      setDetail(null);
      reload();
    } catch (ex) { toast(ex.message, 'error'); }
  }

  return (
    <div className="fade">
      <div className="ph" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="pt">Моё расписание</div>
          <div className="ps">{weekCount} занятий в неделю</div>
        </div>
        <button className="btn btn-p btn-sm" onClick={() => setShowCreate(true)}>+ Занятие</button>
      </div>

      {loading ? <Spinner /> : (
        isMobile ? (
          /* Mobile: day tabs + list */
          <>
            <div className="sched-day-tabs">
              {SM_WORK.map(d => {
                const isToday = (new Date().getDay() || 7) === d;
                const count   = all.filter(l => l.day_of_week === d).length;
                return (
                  <button key={d}
                    className={`sched-day-tab${activeDay===d?' active':''}${isToday?' today':''}`}
                    onClick={() => setActiveDay(d)}>
                    {SM_DAYS[d]}
                    {count > 0 && <div style={{ fontSize: 8, color: activeDay===d ? 'rgba(255,255,255,0.7)' : 'var(--primary)', fontWeight: 700, marginTop: 1 }}>{count}</div>}
                  </button>
                );
              })}
            </div>
            <div>
              {all.filter(l => l.day_of_week === activeDay).map(l =>
                <LessonListCard key={l.id} lesson={l} onClick={() => setDetail(l)} />
              )}
              {!all.filter(l => l.day_of_week === activeDay).length && (
                <div className="empty" style={{ padding: '24px 0' }}><div className="empty-ico">☀️</div>Нет занятий</div>
              )}
            </div>
          </>
        ) : (
          /* Desktop: time grid */
          !all.length
            ? <div className="empty" style={{ padding: 40 }}><div className="empty-ico">🗓</div>Нет занятий<br/><button className="btn btn-p btn-sm" style={{ marginTop: 12 }} onClick={() => setShowCreate(true)}>Добавить первое</button></div>
            : <ScheduleTimeGrid lessons={all} canDelete={true} onDetail={setDetail} />
        )
      )}

      {showCreate && (
        <CreateLessonModal user={user} onClose={() => setShowCreate(false)} onSave={() => { setShowCreate(false); reload(); }} />
      )}
      {detail && (
        <LessonDetailModal lesson={detail} canDelete={true} onClose={() => setDetail(null)} onDelete={() => del(detail)} />
      )}
    </div>
  );
}

// ── Student / Parent view ─────────────────────────────────────────────────────
function StudentScheduleView({ user }) {
  const isParent = user.role === 'parent';
  const { data: children } = useApi(() =>
    isParent ? API.get('/api/v1/users/me/children') : Promise.resolve(null)
  );
  const [childId, setChildId] = useState(null);
  const effectiveChild = isParent ? (childId || children?.[0]?.id) : null;
  const url = isParent && effectiveChild ? `/api/v1/sched?studentId=${effectiveChild}` : '/api/v1/sched';
  const { data: lessons, loading } = useApi(() => {
    if (isParent && !effectiveChild) return Promise.resolve([]);
    return API.get(url);
  }, [url, effectiveChild]);

  const [activeDay, setActiveDay] = useState(() => {
    const d = new Date().getDay(); return d === 0 ? 6 : d;
  });
  const [detail, setDetail] = useState(null);
  const isMobile = useIsMobile(768);
  const all = lessons || [];

  return (
    <div className="fade">
      <div className="ph">
        <div className="pt">Расписание</div>
        <div className="ps">{all.length} занятий в неделю</div>
      </div>
      {/* Parent child switcher */}
      {isParent && children?.length > 1 && (
        <div className="sched-day-tabs" style={{ marginBottom: 14 }}>
          {children.map(c => (
            <button key={c.id}
              className={`sched-day-tab${effectiveChild===c.id?' active':''}`}
              style={{ padding: '6px 12px', minWidth: 'auto' }}
              onClick={() => setChildId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {loading ? <Spinner /> : (
        isMobile ? (
          <>
            <div className="sched-day-tabs">
              {SM_WORK.map(d => {
                const isToday = (new Date().getDay() || 7) === d;
                const count   = all.filter(l => l.day_of_week === d).length;
                return (
                  <button key={d}
                    className={`sched-day-tab${activeDay===d?' active':''}${isToday?' today':''}`}
                    onClick={() => setActiveDay(d)}>
                    {SM_DAYS[d]}
                    {count > 0 && <div style={{ fontSize: 8, color: activeDay===d ? 'rgba(255,255,255,0.7)' : 'var(--primary)', fontWeight: 700, marginTop: 1 }}>{count}</div>}
                  </button>
                );
              })}
            </div>
            <div>
              {all.filter(l => l.day_of_week === activeDay).map(l =>
                <LessonListCard key={l.id} lesson={l} onClick={() => setDetail(l)} />
              )}
              {!all.filter(l => l.day_of_week === activeDay).length && (
                <div className="empty" style={{ padding: '24px 0' }}><div className="empty-ico">📚</div>Нет занятий</div>
              )}
            </div>
          </>
        ) : (
          !all.length
            ? <div className="empty" style={{ padding: 40 }}><div className="empty-ico">📚</div>Нет занятий</div>
            : <ScheduleTimeGrid lessons={all} canDelete={false} onDetail={setDetail} />
        )
      )}
      {detail && (
        <LessonDetailModal lesson={detail} canDelete={false} onClose={() => setDetail(null)} onDelete={() => {}} />
      )}
    </div>
  );
}

// ── Main entry point ──────────────────────────────────────────────────────────
function ScheduleModule({ user }) {
  if (user.role === 'super_admin') return null;
  if (user.role === 'center_admin') return <AdminTeacherView user={user} />;
  if (user.role === 'teacher')      return <TeacherScheduleView user={user} />;
  return <StudentScheduleView user={user} />;
}

// ·· SCHEDULE VIEW (legacy — kept intact, no longer used in routing)
function ScheduleView({ user }) {
  const DAY_NAMES = ['','Пн','Вт','Ср','Чт','Пт','Сб'];
  const DAY_FULL = ['','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
  const { data: children } = useApi(() => user.role==='parent' ? API.get('/api/v1/users/me/children') : Promise.resolve(null));
  const [childId, setChildId] = useState(null);
  const effectiveChildId = user.role==='parent' ? (childId || children?.[0]?.id) : null;
  const schedUrl = user.role==='parent' && effectiveChildId ? `/api/v1/schedule?studentId=${effectiveChildId}` : '/api/v1/schedule';
  const { data, loading, reload } = useApi(() => {
    if (user.role==='parent' && !effectiveChildId) return Promise.resolve({ schedules: [], byDay: {} });
    return API.get(schedUrl);
  }, [schedUrl, effectiveChildId]);
  const { data: classes } = useApi(() => ['teacher','center_admin','super_admin'].includes(user.role) ? API.get('/api/v1/classes') : Promise.resolve(null));
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ classId:'', dayOfWeek:1, startTime:'08:30', endTime:'09:15', room:'' });
  const [err, setErr] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const canManage = ['teacher','super_admin'].includes(user.role);
  const set = k => e => setForm(p=>({...p,[k]:e.target.value}));

  // Normalize: API always returns a flat array; parent early-exit returns {schedules,byDay}
  const schedules = Array.isArray(data) ? data : (data?.schedules || []);
  const byDay = Array.isArray(data)
    ? schedules.reduce((acc, s) => { (acc[s.day_of_week] = acc[s.day_of_week] || []).push(s); return acc; }, {})
    : (data?.byDay || {});

  // Collect all unique time slots across the schedule
  const allSlots = schedules.map(s => s.start_time).filter((v,i,a)=>a.indexOf(v)===i).sort();

  async function create(e) {
    e.preventDefault(); setErr('');
    try {
      await API.post('/api/v1/schedule', {...form, classId:parseInt(form.classId), dayOfWeek:parseInt(form.dayOfWeek)});
      reload(); setShowCreate(false); toast('Урок добавлен в расписание', 'success');
    } catch(ex) { setErr(ex.message); }
  }

  async function deleteEntry(id) {
    const ok = await confirm('Урок будет удалён из расписания. Это не повлияет на посещаемость и оценки.', 'Удалить урок из расписания?', { icon: '🗓️', danger: true, confirmText: 'Удалить' });
    if (!ok) return;
    try { await API.del(`/api/v1/schedule/${id}`); reload(); toast('Удалено', 'success'); }
    catch(ex) { toast(ex.message, 'error'); }
  }

  if (loading) return <Spinner/>;

  return (
    <div className="fade">
      <div className="ph" style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
        <div style={{minWidth:0,flex:1}}><div className="pt">Расписание</div><div className="ps">{schedules.length} уроков в неделю</div></div>
        {canManage && <button className="btn btn-p" onClick={()=>setShowCreate(true)}>+ Добавить урок</button>}
      </div>
      {user.role==='parent' && children?.length>1 && (
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          {children.map(c=><button key={c.id} className={`btn ${effectiveChildId===c.id?'btn-p':'btn-s'}`} onClick={()=>setChildId(c.id)}>{c.name}</button>)}
        </div>
      )}

      {/* Weekly grid */}
      <div className="card" style={{overflow:'auto'}}>
        <div className="cb" style={{padding:0}}>
          <div className="sched-grid">
            <div className="sched-header">Время</div>
            {[1,2,3,4,5,6].map(d=><div className="sched-header" key={d}>{DAY_NAMES[d]}</div>)}
            {allSlots.length === 0 && (
              <>
                <div className="sched-time">—</div>
                {[1,2,3,4,5,6].map(d=><div className="sched-cell" key={d}/>)}
              </>
            )}
            {allSlots.map(time => (
              <React.Fragment key={time}>
                <div className="sched-time">{time}</div>
                {[1,2,3,4,5,6].map(d => {
                  const items = (byDay[d] || []).filter(s => s.start_time === time);
                  return (
                    <div className="sched-cell" key={d}>
                      {items.map(s => (
                        <div key={s.id} className="sched-item tap-safe" style={{borderLeftColor:s.color||'var(--accent)',background:(s.color||'#6366f1')+'18'}}
                          onClick={()=>canManage && deleteEntry(s.id)} onContextMenu={e=>e.preventDefault()} title={canManage?'Нажмите чтобы удалить':''}>
                          <div style={{fontWeight:700,fontSize:11}}>{s.class_name}</div>
                          <div style={{fontSize:10,color:'var(--muted)'}}>{s.start_time}-{s.end_time}{s.room?` · ${s.room}`:''}</div>
                          {s.teacher_name && <div style={{fontSize:10,color:'var(--muted)'}}>{s.teacher_name}</div>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile-friendly list */}
      <div style={{marginTop:16}}>
        {[1,2,3,4,5,6].map(d => {
          const items = byDay[d] || [];
          if (!items.length) return null;
          return (
            <div key={d} style={{marginBottom:12}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:6,color:'var(--muted)'}}>{DAY_FULL[d]}</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {items.map(s=>(
                  <div key={s.id} className="card tap-safe" style={{padding:'10px 14px',borderLeft:`4px solid ${s.color||'#6366f1'}`,display:'flex',alignItems:'center',gap:12}} onContextMenu={e=>e.preventDefault()}>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:'var(--accent)',fontWeight:600,minWidth:80}}>
                      {s.start_time} - {s.end_time}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13}}>{s.class_name}</div>
                      <div style={{fontSize:11,color:'var(--muted)'}}>{s.subject} · {s.teacher_name}</div>
                    </div>
                    {canManage && <button className="btn btn-d btn-sm" onClick={()=>deleteEntry(s.id)}>✕</button>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!schedules.length && <div className="empty" style={{marginTop:16}}><div className="empty-ico">🗓</div><div style={{fontWeight:600,fontSize:14,marginBottom:4}}>Расписание пока пустое</div><div style={{fontSize:12}}>Добавьте уроки в расписание</div></div>}
      </div>

      {showCreate && (
        <Modal title="🗓 Добавить урок в расписание" onClose={()=>setShowCreate(false)}>
          <Alert msg={err}/>
          <form onSubmit={create}>
            <div className="fg"><label className="fl">Класс</label>
              <select className="fi" required value={form.classId} onChange={set('classId')}>
                <option value="">Выберите класс</option>
                {(classes||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="fg"><label className="fl">День недели</label>
              <select className="fi" value={form.dayOfWeek} onChange={set('dayOfWeek')}>
                {[1,2,3,4,5,6].map(d=><option key={d} value={d}>{DAY_FULL[d]}</option>)}
              </select>
            </div>
            <div className="g2">
              <div className="fg"><label className="fl">Начало</label><input className="fi" type="time" required value={form.startTime} onChange={set('startTime')}/></div>
              <div className="fg"><label className="fl">Конец</label><input className="fi" type="time" required value={form.endTime} onChange={set('endTime')}/></div>
            </div>
            <div className="fg"><label className="fl">Кабинет</label><input className="fi" value={form.room} onChange={set('room')} placeholder="101"/></div>
            <div style={{background:'var(--primary-light)',borderRadius:8,padding:'10px 12px',fontSize:12,color:'var(--primary)',marginBottom:14}}>
              ℹ️ Система автоматически проверит конфликты по кабинетам и учителям
            </div>
            <div style={{display:'flex',gap:8}}>
              <button type="submit" className="btn btn-p" style={{flex:1}}>Добавить</button>
              <button type="button" className="btn btn-s" onClick={()=>setShowCreate(false)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ·· AUDIT LOG VIEW
function AuditLogView({ user }) {
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState('');
  const LIMIT = 50;
  const url = `/api/v1/audit?limit=${LIMIT}&offset=${offset}${filter?`&action=${encodeURIComponent(filter)}`:''}`;
  const { data, loading } = useApi(() => API.get(url), [url]);
  const logs = data?.logs || [];

  return (
    <div className="fade">
      <div className="ph"><div className="pt">Журнал действий</div><div className="ps">Аудит-лог всех операций</div></div>
      <div style={{marginBottom:14}}>
        <input className="fi" style={{maxWidth:320}} placeholder="🔍 Фильтр по действию..." value={filter} onChange={e=>{setFilter(e.target.value);setOffset(0);}}/>
      </div>
      <div className="card">
        <div className="cb" style={{padding:0}}>
          {loading ? <Spinner/> : (
            <ResponsiveTable
              headers={['Время','Пользователь','Действие','Объект']}
              rows={logs}
              emptyIcon="📝" emptyText="Нет записей"
              renderRow={l=>(
                <tr key={l.id}>
                  <td style={{fontSize:11,color:'var(--muted)',whiteSpace:'nowrap'}}>{fmtDate(l.created_at)}</td>
                  <td style={{fontWeight:600,fontSize:12}}>{l.user_name||`ID:${l.user_id}`}</td>
                  <td><span className={`bdg ${l.action?.includes('DELETE')?'br':l.action?.includes('POST')?'bg':'bb'}`} style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>{l.action}</span></td>
                  <td style={{fontSize:11,color:'var(--muted)'}}>{l.entity_type}{l.entity_id?` #${l.entity_id}`:''}</td>
                </tr>
              )}
              renderCard={l=>(
                <div key={l.id} className="card" style={{padding:'10px 14px',marginBottom:6}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <span style={{fontWeight:600,fontSize:13}}>{l.user_name||`ID:${l.user_id}`}</span>
                    <span style={{fontSize:10,color:'var(--muted)'}}>{fmtDate(l.created_at)}</span>
                  </div>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    <span className={`bdg ${l.action?.includes('DELETE')?'br':l.action?.includes('POST')?'bg':'bb'}`} style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace"}}>{l.action}</span>
                    <span style={{fontSize:11,color:'var(--muted)'}}>{l.entity_type}{l.entity_id?` #${l.entity_id}`:''}</span>
                  </div>
                </div>
              )}
            />
          )}
        </div>
      </div>
      {data && (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:12}}>
          <span style={{fontSize:12,color:'var(--muted)'}}>Всего: {data.total} записей</span>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-s btn-sm" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-LIMIT))}>← Назад</button>
            <button className="btn btn-s btn-sm" disabled={offset+LIMIT>=data.total} onClick={()=>setOffset(offset+LIMIT)}>Вперёд →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN APP SHELL ─────────────────────────────────────────────────────────────
function AppShell({ user: initialUser, center, onLogout }) {
  const [user, setUser] = useState(initialUser);
  const [page, setPage] = useState('dashboard');
  const [showNotif, setShowNotif] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data: notifData, reload: reloadNotifs } = useApi(() => API.get('/api/v1/notifications'));
  const unread = notifData?.unread ?? 0;
  const confirm = useConfirm();

  // Auto-refresh notifications every 30 seconds
  useEffect(() => {
    const timer = setInterval(reloadNotifs, 30_000);
    return () => clearInterval(timer);
  }, [reloadNotifs]);

  const nav = NAV[user.role] || [];
  const sections = [...new Set(nav.map(n=>n.sec))];
  const pageTitle = nav.find(n=>n.id===page)?.label || 'BilimHub';

  function renderPage() {
    // Shared pages available to all roles
    if (page==='schedule') return <ScheduleModule user={user}/>;
    if (page==='audit' && ['super_admin','center_admin'].includes(user.role)) return <AuditLogView user={user}/>;
    if (page==='notifications') return <NotificationsPage onRead={reloadNotifs}/>;
    if (page==='profile') return <ProfilePage user={user} onLogout={onLogout} onNameChange={name=>setUser(u=>({...u,name}))}/>;

    if (user.role==='super_admin') {
      if (page==='dashboard') return <SuperDash user={user}/>;
      if (page==='centers')   return <CentersView/>;
      if (page==='users_all') return <UsersView user={user}/>;
    }
    if (user.role==='center_admin') {
      if (page==='dashboard') return <CenterDash user={user} center={center}/>;
      if (page==='tokens') return <TokensView/>;
      if (page==='users') return <UsersView user={user}/>;
      if (page==='classes') return <ClassesView user={user}/>;
      if (page==='attendance') return <AttendanceView user={user}/>;
    }
    if (user.role==='teacher') {
      if (page==='dashboard') return <TeacherDash user={user}/>;
      if (page==='classes') return <ClassesView user={user}/>;
      if (page==='assignments') return <HomeworkModule user={user}/>;
      if (page==='gradebook') return <GradebookView user={user}/>;
      if (page==='attendance') return <AttendanceView user={user}/>;
    }
    if (user.role==='student') {
      if (page==='dashboard') return <StudentDash user={user}/>;
      if (page==='assignments') return <HomeworkModule user={user}/>;
      if (page==='grades') return <GradesView user={user}/>;
      if (page==='classes') return <ClassesView user={user}/>;
      if (page==='attendance') return <AttendanceView user={user}/>;
    }
    if (user.role==='parent') {
      if (page==='dashboard') return <ParentDash user={user}/>;
      if (page==='grades') return <GradesView user={user}/>;
      if (page==='assignments') return <HomeworkModule user={user}/>;
      if (page==='attendance') return <AttendanceView user={user}/>;
    }
    return <div className="empty"><div className="empty-ico">🚧</div><div>В разработке</div></div>;
  }

  return (
    <div className="app">
      <div className={`sb-overlay ${sidebarOpen?'open':''}`} onClick={()=>setSidebarOpen(false)}/>
      <aside className={`sb ${sidebarOpen?'open':''}`}>
        <div className="sb-logo">
          <div className="sb-logo-wrap">
            <div className="sb-icon">B</div>
            <div>
              <div className="sb-name">BilimHub</div>
              <div className="sb-tagline">SaaS Platform</div>
            </div>
          </div>
        </div>
        {center && (
          <div className="sb-center">
            <div className="sb-center-name">{center.name}</div>
            <div className="sb-center-code">{center.code}</div>
          </div>
        )}
        {sections.map(sec=>(
          <div className="nav-sec" key={sec}>
            <div className="nav-lbl">{sec}</div>
            {nav.filter(n=>n.sec===sec).map(n=>(
              <div key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={()=>{setPage(n.id);setSidebarOpen(false);}}>
                <span className="nav-ico">{n.ico}</span>{n.label}
                {n.id==='notifications' && unread>0
                  ? <span className="nav-badge">{unread}</span>
                  : n.badge ? <span className="nav-badge">{n.bagde}</span> : null
                }
              </div>
            ))}
          </div>
        ))}
        <div className="sb-foot">
          <div className="user-pill" onClick={async()=>{
            const ok = await confirm('Вы уверены что хотите выйти из системы?', 'Выйти из аккаунта?', { icon: '👋', confirmText: 'Выйти', cancelText: 'Остаться' });
            if(ok){await API.logout();onLogout();}
          }}>
            <div className="ava" style={{width:32,height:32,fontSize:12,background:avaColor(user.role)}}>{initials(user.name)}</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="user-nm">{user.name}</div>
              <div className="user-rl">{roleLabel[user.role]}</div>
            </div>
            <span style={{color:'#6b7280',fontSize:12}}>↩</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <button className="mob-menu" onClick={()=>setSidebarOpen(p=>!p)}>☰</button>
          <div className="topbar-title">{pageTitle}</div>
          <div style={{display:'flex',alignItems:'center',gap:8,position:'relative'}}>
            <div className="ico-btn" onClick={()=>{setShowNotif(p=>!p);}} title="Уведомления">
              🔔{unread>0&&<div className="dot"/>}
            </div>
            {showNotif && (
              <>
                <div style={{position:'fixed',inset:0,zIndex:40}} onClick={()=>setShowNotif(false)}/>
                <NotifPanel onClose={()=>setShowNotif(false)} onRead={reloadNotifs}/>
              </>
            )}
          </div>
        </div>
        <div className="content">{renderPage()}</div>
      </div>
      {isMobile && <BottomNav nav={nav} page={page} setPage={setPage} unread={unread}/>}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
function Root() {
  const [authState, setAuthState] = useState('loading'); // loading | unauth | auth
  const [user, setUser] = useState(null);
  const [center, setCenter] = useState(null);

  API.onUnauth(() => { setUser(null); setCenter(null); setAuthState('unauth'); });

  useEffect(() => {
    API.tryRestoreSession().then(async data => {
      if (data) {
        setUser(data.user); setCenter(data.center || null); setAuthState('auth');
        // If center is missing (restored via refresh), fetch it
        if (!data.center && data.user) {
          try { const me = await API.get('/api/v1/auth/me'); setCenter(me.center); }
          catch {}
        }
      }
      else setAuthState('unauth');
    });
  }, []);

  if (authState==='loading') {
    return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontSize:14,color:'var(--muted)'}}>Загрузка BilimHub...</div>;
  }

  if (authState==='unauth') {
    return <AuthPage onLogin={u => { setUser(u); setAuthState('auth'); API.get('/api/v1/auth/me').then(d=>setCenter(d.center)).catch(()=>{}); }} />;
  }

  return <AppShell user={user} center={center} onLogout={()=>{ setUser(null); setCenter(null); setAuthState('unauth'); }}/>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <MobileAppWrapper>
      <ToastProvider>
        <ConfirmProvider>
          <Root/>
        </ConfirmProvider>
      </ToastProvider>
    </MobileAppWrapper>
  </ErrorBoundary>
);