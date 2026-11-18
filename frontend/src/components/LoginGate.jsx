import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, MessageCircleMore, Network, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';

export default function LoginGate({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { user } = await api.auth.login(email, password);
      onLogin(user);
    } catch (err) {
      setError(err.message || 'Sign in failed. Check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="spider-login">
      <section className="spider-login-story" aria-label="SpiderChat workspace">
        <div className="spider-login-story-top">
          <span className="spider-mark" aria-hidden="true"><Network size={25} strokeWidth={2.3} /></span>
          <span className="spider-wordmark">spider<span>chat</span><span className="spider-wordmark-dot">.</span></span>
        </div>
        <div className="spider-orbit" aria-hidden="true">
          <span className="spider-orbit-ring ring-one" />
          <span className="spider-orbit-ring ring-two" />
          <span className="spider-orbit-ring ring-three" />
          <span className="spider-orbit-line line-one" />
          <span className="spider-orbit-line line-two" />
          <span className="spider-orbit-line line-three" />
          <span className="spider-orbit-node node-one" />
          <span className="spider-orbit-node node-two" />
          <span className="spider-orbit-node node-three" />
          <span className="spider-orbit-center"><MessageCircleMore size={37} strokeWidth={1.7} /></span>
        </div>
        <div className="spider-login-story-bottom">
          <span className="spider-eyebrow">YOUR CONVERSATION NETWORK</span>
          <h1>Every connection<br /><em>in one place.</em></h1>
          <p>Move between conversations, contacts and workflows without losing the thread.</p>
          <div className="spider-story-meta"><span><span className="spider-live-dot" /> Team workspace</span><span>SPIDERCHAT / 01</span></div>
        </div>
      </section>

      <section className="spider-login-form-side">
        <div className="spider-mobile-brand"><span className="spider-mark"><Network size={22} /></span><span className="spider-wordmark">spider<span>chat</span><span className="spider-wordmark-dot">.</span></span></div>
        <div className="spider-login-form-wrap">
          <div className="spider-login-kicker"><LockKeyhole size={15} /> PRIVATE WORKSPACE</div>
          <h2>Welcome back.</h2>
          <p className="spider-login-subtitle">Sign in to pick up the conversation.</p>
          <form onSubmit={handleSubmit}>
            <label className="spider-field-label" htmlFor="spider-email">Email address</label>
            <input id="spider-email" className="spider-input" type="email" autoComplete="username" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
            <label className="spider-field-label" htmlFor="spider-password">Password</label>
            <div className="spider-password-wrap">
              <input id="spider-password" className="spider-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} />
              <button type="button" className="spider-password-toggle" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
            {error && <p role="alert" className="spider-login-error">{error}</p>}
            <button className="spider-login-submit" type="submit" disabled={loading}><span>{loading ? 'Signing in…' : 'Enter workspace'}</span><ArrowRight size={19} /></button>
          </form>
          <div className="spider-login-assurance"><ShieldCheck size={17} /><span>Your workspace is available to your team only.</span></div>
        </div>
        <div className="spider-login-footer">SpiderChat · Conversation workspace</div>
      </section>
    </main>
  );
}
