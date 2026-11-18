import { useState, useEffect } from 'react';
import { api } from './api.js';
import { C, FONT } from './constants.js';
import { useHashRoute } from './hooks/useHashRoute.js';
import LoginGate from './components/LoginGate.jsx';
import SetupWizard from './components/SetupWizard.jsx';
import Topbar from './components/Topbar.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatsPage from './components/ChatsPage.jsx';
import HomePage from './pages/HomePage.jsx';
import ChatbotBuilderPage from './pages/ChatbotBuilderPage.jsx';
import TemplateBuilderPage from './pages/TemplateBuilderPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import BulkMessagePage from './pages/BulkMessagePage.jsx';
import AdminSettingsPage from './pages/AdminSettingsPage.jsx';
import MediaLibraryPage from './pages/MediaLibraryPage.jsx';
import AboutUsPage from './pages/AboutUsPage.jsx';
import PipelinesPage from './pages/PipelinesPage.jsx';
import BookingsPage from './pages/BookingsPage.jsx';
import AiAgentBuilderPage from './pages/AiAgentBuilderPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import VentureSetupWizard from './pages/VentureSetupWizard.jsx';
import WhatsNewModal from './components/WhatsNewModal.jsx';
import ProductTour from './components/ProductTour.jsx';
import { CHANGELOG, LATEST_VERSION, entriesSince } from './changelog.js';

const VALID_PAGES = new Set([
  'home', 'chatbot-builder', 'template-builder', 'chats',
  'contacts', 'stop-contacts', 'pipelines', 'bookings', 'tasks', 'bulk-message', 'admin-settings', 'media-library', 'about',
  'ai-agent-builder', 'venture-setup',
]);

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  // "What's New" pop-up: { entries, isNewUser } | null.
  const [whatsNew, setWhatsNew] = useState(null);
  // Guided product tour for brand-new users.
  const [tourOpen, setTourOpen] = useState(false);

  // Returning users (who've already done the tour) see "What's New" on login;
  // brand-new users get the guided tour instead (wired below).
  useEffect(() => {
    if (!user?.id || !user.tourCompleted) return;
    const key = `epr_whatsnew_v_${user.id}`;
    let seen = 0;
    try { seen = Number(localStorage.getItem(key)) || 0; } catch { /* private mode */ }
    const entries = entriesSince(seen);
    if (entries.length > 0) setWhatsNew({ entries, isNewUser: seen === 0 });
  }, [user?.id, user?.tourCompleted]);

  const dismissWhatsNew = () => {
    if (user?.id) { try { localStorage.setItem(`epr_whatsnew_v_${user.id}`, String(LATEST_VERSION)); } catch { /* ignore */ } }
    setWhatsNew(null);
  };
  const [routeParts, navigate, replaceRoute] = useHashRoute();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const page = VALID_PAGES.has(routeParts[0]) ? routeParts[0] : 'home';
  const subParts = routeParts.slice(1);
  const setPage = (p) => navigate(p);

  // Brand-new users: walk them through the workspace once, from Home. The tour
  // auto-opens only when BOTH the server flag and a local per-device guard say it
  // hasn't run — so it never re-appears even if the server flag lags behind a
  // deploy. (The server flag remains the cross-device source of truth.)
  useEffect(() => {
    if (!user?.id) return;
    let localDone = false;
    try { localDone = localStorage.getItem(`epr_tour_done_${user.id}`) === '1'; } catch { /* private mode */ }
    if (!user.tourCompleted && !localDone) { navigate('home'); setTourOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const finishTour = () => {
    setTourOpen(false);
    if (user?.id) {
      // Mark done locally (belt-and-suspenders) AND fast-forward What's New so a
      // brand-new user isn't hit with the changelog modal the instant the tour ends.
      try {
        localStorage.setItem(`epr_tour_done_${user.id}`, '1');
        localStorage.setItem(`epr_whatsnew_v_${user.id}`, String(LATEST_VERSION));
      } catch { /* private mode */ }
    }
    setUser(u => (u ? { ...u, tourCompleted: true } : u));
    api.users.tourComplete().catch(() => {});
  };

  // Normalize empty hash to #/home so reload always shows a valid URL
  useEffect(() => {
    if (!routeParts[0]) replaceRoute('home');
  }, [routeParts, replaceRoute]);

  // Page guard: non-admins can only reach pages granted to them (user.pages).
  // admin-settings is allowed if they have any admin-settings:* sub-page.
  useEffect(() => {
    if (!user || user.role === 'admin' || !Array.isArray(user.pages)) return;
    const allowed = page === 'admin-settings'
      ? user.pages.some(p => p.startsWith('admin-settings'))
      : (page === 'stop-contacts' ? user.pages.includes('contacts') : user.pages.includes(page));
    if (!allowed) setPage('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, user]);

  useEffect(() => {
    // Collapse main sidebar by default on automation builder page
    if (page === 'chatbot-builder') {
      setSidebarCollapsed(true);
    }
  }, [page]);

  useEffect(() => {
    // First check whether the instance needs first-run setup (no users yet).
    // If so, show the setup wizard; otherwise resume the normal session check.
    api.auth.status()
      .then(({ setupRequired: needed }) => {
        if (needed) { setSetupRequired(true); setChecking(false); return null; }
        return api.auth.me()
          .then(({ user }) => setUser(user))
          .catch(() => setUser(null))
          .finally(() => setChecking(false));
      })
      .catch(() => {
        // status unavailable (DB warming) — fall back to a normal session check.
        api.auth.me()
          .then(({ user }) => setUser(user))
          .catch(() => setUser(null))
          .finally(() => setChecking(false));
      });
  }, []);

  const handleLogout = async () => {
    await api.auth.logout().catch(() => {});
    setUser(null);
    setPage('home');
  };

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        background: C.pageBg,
      }}>
        <div style={{ fontSize: 13, color: C.textMuted, fontWeight: 500 }}>Loading…</div>
      </div>
    );
  }

  if (setupRequired && !user) {
    return <SetupWizard onComplete={(u) => { setSetupRequired(false); setUser(u); }} />;
  }

  if (!user) {
    return <LoginGate onLogin={setUser} />;
  }

  const renderPage = () => {
    switch (page) {
      case 'home': return <HomePage user={user} onPageChange={setPage} />;
      case 'chats': return <ChatsPage subParts={subParts} navigate={navigate} user={user} />;
      case 'contacts': return <ContactsPage user={user} onNavigate={navigate} />;
      case 'stop-contacts': return <ContactsPage user={user} onNavigate={navigate} stopOnly />;
      case 'pipelines': return <PipelinesPage user={user} />;
      case 'bookings': return <BookingsPage user={user} />;
      case 'tasks': return <TasksPage user={user} onNavigate={navigate} />;
      case 'template-builder': return <TemplateBuilderPage subParts={subParts} navigate={navigate} />;
      case 'media-library': return <MediaLibraryPage />;
      case 'bulk-message': return <BulkMessagePage onNavigate={navigate} />;
      case 'chatbot-builder': return <ChatbotBuilderPage subParts={subParts} navigate={navigate} />;
      case 'ai-agent-builder': return <AiAgentBuilderPage user={user} navigate={navigate} />;
      case 'venture-setup':
        return user?.role === 'admin'
          ? <VentureSetupWizard navigate={navigate} onDone={() => setPage('home')} />
          : <HomePage user={user} onPageChange={setPage} />;
      case 'about': return <AboutUsPage />;
      case 'admin-settings': return <AdminSettingsPage onLogout={handleLogout} onNavigate={setPage} subParts={subParts} navigate={navigate} user={user} />;
      default: return <HomePage user={user} onPageChange={setPage} />;
    }
  };

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      fontFamily: FONT,
      background: C.pageBg,
    }}>
      {page !== 'admin-settings' && (
        <Sidebar
          activePage={page}
          onPageChange={(next) => { setPage(next); setMobileNavOpen(false); }}
          collapsed={mobileNavOpen ? false : sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          mobileOpen={mobileNavOpen}
          user={user}
        />
      )}
      {mobileNavOpen && page !== 'admin-settings' && <button className="spider-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <div style={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar
          user={user}
          onLogout={handleLogout}
          onNavigate={setPage}
          showBrand={page === 'admin-settings'}
          currentPage={page}
          onOpenNavigation={() => setMobileNavOpen(true)}
          onShowWhatsNew={() => setWhatsNew({ entries: CHANGELOG, isNewUser: false })}
          onTakeTour={() => { navigate('home'); setTourOpen(true); }}
        />
        <div style={{ flex: 1, overflow: 'auto', background: C.pageBg, display: 'flex', flexDirection: 'column' }}>
          {renderPage()}
        </div>
      </div>

      {whatsNew && (
        <WhatsNewModal entries={whatsNew.entries} isNewUser={whatsNew.isNewUser} onClose={dismissWhatsNew} />
      )}
      {tourOpen && page !== 'admin-settings' && (
        <ProductTour user={user} onClose={finishTour} />
      )}
    </div>
  );
}
