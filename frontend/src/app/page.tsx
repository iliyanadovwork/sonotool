'use client';

import React, { lazy, Suspense, useCallback, useState } from 'react';
import { useBrandKit } from './hooks/useBrandKit';
import { useAuth } from './hooks/useAuth';
import { useTeamPresence } from './hooks/useTeamPresence';
import { Sidebar } from './components/Sidebar';
import { InstagramConnectionProvider } from './components/InstagramConnection';
import { GoogleConnectionProvider } from './components/GoogleConnection';
import { BrandKitPanel } from './components/BrandKitPanel';
import { AccountPanel } from './components/AccountPanel';
import { AuthForm } from './components/AuthForm';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GRID_BG_STYLE } from '@/lib/ui-constants';
import type { AppSection } from './types';

const TemplateEditorGrid = lazy(() =>
  import('./components/TemplateEditorGrid').then(m => ({ default: m.TemplateEditorGrid }))
);

const ChartReelsSection = lazy(() =>
  import('./components/ChartReelsSection').then(m => ({ default: m.ChartReelsSection }))
);

const VideoReelsSection = lazy(() =>
  import('./components/video-reels/VideoReelsSection').then(m => ({ default: m.VideoReelsSection }))
);

// Persist the active section across page refreshes so you land back where you were
// (not the default). Safe to read in the state initializer below because the section
// content is never server-rendered — the auth-loading spinner gates it until after hydration.
const SECTION_STORAGE_KEY = 'sonotool:activeSection';
const APP_SECTIONS: AppSection[] = ['template-editor', 'posts', 'branding', 'chart-reels', 'video-reels'];

function SectionLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="w-6 h-6 rounded-full border-2 border-separator border-t-label animate-spin" />
    </div>
  );
}

function GridSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={GRID_BG_STYLE}>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export default function Home() {
  const [activeSection, setActiveSectionState] = useState<AppSection>(() => {
    if (typeof window === 'undefined') return 'template-editor';
    try {
      const saved = window.localStorage.getItem(SECTION_STORAGE_KEY);
      if (saved && (APP_SECTIONS as string[]).includes(saved)) return saved as AppSection;
    } catch { /* localStorage unavailable — fall back to the default */ }
    return 'template-editor';
  });
  // Wrap the setter so every section change is remembered for the next refresh.
  const setActiveSection = useCallback((s: AppSection) => {
    setActiveSectionState(s);
    try { window.localStorage.setItem(SECTION_STORAGE_KEY, s); } catch { /* ignore */ }
  }, []);
  const { user, loading: authLoading, signIn, signUp, signOut, resetPassword, changePassword } = useAuth();
  const { brand, saving, uploading, loading, error, setError, save, uploadLogo, deleteLogo, selectLogo, uploadFont, deleteFont } = useBrandKit(user?.id ?? null);
  const online = useTeamPresence(user ?? null, activeSection);   // global presence: who's online + their section

  // Initial session check — hold the UI so we don't flash either the sign-in screen or the app.
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface text-label">
        <div className="w-6 h-6 rounded-full border-2 border-separator border-t-label animate-spin" role="status" aria-label="Loading" />
      </div>
    );
  }

  // Auth gate — Templates, Posts and Branding stay hidden until you're signed in.
  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-surface text-label px-6 py-12">
        <span className="text-title3 font-semibold text-label">Sonotool</span>
        <AuthForm onSignIn={signIn} onSignUp={signUp} onResetPassword={resetPassword} />
      </main>
    );
  }

  return (
    <InstagramConnectionProvider>
    <GoogleConnectionProvider>
    <div className="flex min-h-screen bg-surface text-label">
      <Sidebar
        active={activeSection}
        onSelect={setActiveSection}
        signedIn={!!user}
        online={online}
      />

      <main className="flex-1 ml-56 min-h-screen">

        {activeSection === 'branding' && (
          <BrandKitPanel
            brand={brand}
            loading={loading}
            saving={saving}
            uploading={uploading}
            error={error}
            user={user}
            authLoading={authLoading}
            onSignIn={signIn}
            onSignUp={signUp}
            onResetPassword={resetPassword}
            onSave={save}
            onUploadLogo={uploadLogo}
            onDeleteLogo={deleteLogo}
            onSelectLogo={selectLogo}
            onUploadFont={uploadFont}
            onDeleteFont={deleteFont}
            onClearError={() => setError(null)}
          />
        )}

        {activeSection === 'account' && (
          <AccountPanel user={user} onChangePassword={changePassword} onSignOut={signOut} />
        )}

        {activeSection === 'template-editor' && (
          <ErrorBoundary>
            <GridSection>
              <Suspense fallback={<SectionLoader />}>
                <TemplateEditorGrid brand={brand} userId={user?.id ?? null} />
              </Suspense>
            </GridSection>
          </ErrorBoundary>
        )}

        {activeSection === 'posts' && (
          <ErrorBoundary>
            <GridSection>
              <Suspense fallback={<SectionLoader />}>
                <TemplateEditorGrid brand={brand} userId={user?.id ?? null} userName={user?.email ?? null} mode="posts" />
              </Suspense>
            </GridSection>
          </ErrorBoundary>
        )}

        {activeSection === 'chart-reels' && (
          <ErrorBoundary>
            <Suspense fallback={<SectionLoader />}>
              <ChartReelsSection />
            </Suspense>
          </ErrorBoundary>
        )}

        {activeSection === 'video-reels' && (
          <ErrorBoundary>
            <Suspense fallback={<SectionLoader />}>
              <VideoReelsSection />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
    </div>
    </GoogleConnectionProvider>
    </InstagramConnectionProvider>
  );
}
