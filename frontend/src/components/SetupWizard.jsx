import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Network, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';

export default function SetupWizard({ onComplete }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email || !password) { setError('Enter an email and password.'); return; }
    if (password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
    if (password !== confirm) { setError('Your passwords do not match.'); return; }
    setError('');
    setLoading(true);
    try {
      const { user } = await api.auth.setup(email, password, name);
      onComplete(user);
    } catch (err) {
      setError(err.message || 'Account setup failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="spider-login spider-setup">
      <section className="spider-login-story" aria-label="SpiderChat setup">
        <div className="spider-login-story-top"><span className="spider-mark"><Network size={25} strokeWidth={2.3} /></span><span className="spider-wordmark">spider<span>chat</span><span className="spider-wordmark-dot">.</span></span></div>
        <div className="spider-orbit" aria-hidden="true"><span className="spider-orbit-ring ring-one" /><span className="spider-orbit-ring ring-two" /><span className="spider-orbit-ring ring-three" /><span className="spider-orbit-line line-one" /><span className="spider-orbit-line line-two" /><span className="spider-orbit-line line-three" /><span className="spider-orbit-node node-one" /><span className="spider-orbit-node node-two" /><span className="spider-orbit-node node-three" /><span className="spider-orbit-center"><Network size={38} /></span></div>
        <div className="spider-login-story-bottom"><span className="spider-eyebrow">START YOUR WORKSPACE</span><h1>A place for<br /><em>every thread.</em></h1><p>Create your admin account to set up your team's conversation workspace.</p><div className="spider-story-meta"><span><span className="spider-live-dot" /> First-time setup</span><span>SPIDERCHAT / 00</span></div></div>
      </section>
      <section className="spider-login-form-side">
        <div className="spider-mobile-brand"><span className="spider-mark"><Network size={22} /></span><span className="spider-wordmark">spider<span>chat</span><span className="spider-wordmark-dot">.</span></span></div>
        <div className="spider-login-form-wrap spider-setup-form">
          <div className="spider-login-kicker"><ShieldCheck size={15} /> SIGN UP</div>
          <h2>Create your account.</h2>
          <p className="spider-login-subtitle">Sign up as the first admin. You can invite your team after signing in.</p>
          <form onSubmit={handleSubmit}>
            <label className="spider-field-label" htmlFor="spider-name">Your name <span className="spider-optional">(optional)</span></label>
            <input id="spider-name" className="spider-input" type="text" autoComplete="name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
            <label className="spider-field-label" htmlFor="spider-setup-email">Email address</label>
            <input id="spider-setup-email" className="spider-input" type="email" autoComplete="username" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
            <label className="spider-field-label" htmlFor="spider-setup-password">Password</label>
            <div className="spider-password-wrap"><input id="spider-setup-password" className="spider-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} /><button type="button" className="spider-password-toggle" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            <label className="spider-field-label" htmlFor="spider-confirm">Confirm password</label>
            <input id="spider-confirm" className="spider-input" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter the password again" value={confirm} onChange={e => setConfirm(e.target.value)} />
            {error && <p role="alert" className="spider-login-error">{error}</p>}
            <button className="spider-login-submit" type="submit" disabled={loading}><span>{loading ? 'Signing up…' : 'Sign up'}</span><ArrowRight size={19} /></button>
          </form>
        </div>
        <div className="spider-login-footer">SpiderChat · Conversation workspace</div>
      </section>
    </main>
  );
}
