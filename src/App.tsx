import { lazy, Suspense, useEffect, useState } from 'react';
import { BackupWatcher } from './backup/BackupWatcher';
import { BankJobsProvider, BankJobsStatus, useBankJobs } from './ui/bank-jobs';
import { APP_NAME } from './brand';
import type { StudyStore } from './db/store';
import { deviceTimeZone, studyDay } from './lib/studyDay';
import { ClassesScreen } from './ui/ClassesScreen';
import { ClassScreen } from './ui/ClassScreen';
import { VaultContext } from './ui/lock-parts';
import { mainPage, NavBar } from './ui/NavBar';
import { AfterClass } from './ui/AfterClass';
import { go, href, useRoute } from './ui/route';
import { DAY_START_HOUR } from './ui/settings';
import { SettingsScreen } from './ui/SettingsScreen';
import { SetupScreen } from './ui/SetupScreen';
import { StoreContext } from './ui/store-context';
import { TasksScreen } from './ui/TasksScreen';
import { UnlockScreen } from './ui/UnlockScreen';
import { isUpdateReady, onUpdateChange, setActivity } from './ui/update';
import { GOOGLE_SETUP_RETURN, GOOGLE_UNLOCK_RETURN, JOIN_RETURN } from './sync/client';
import { SyncRunner } from './sync/SyncRunner';
import type { Vault, VaultStatus } from './ui/vault';

// With PDF.js, so loaded only when slides are opened
const SlidesScreen = lazy(() => import('./ui/SlidesScreen'));
const QuizScreen = lazy(() => import('./ui/QuizScreen'));
const PlayScreen = lazy(() => import('./ui/PlayScreen'));
const PracticeScreen = lazy(() => import('./ui/PracticeScreen'));

// The page frame: the name (back to Tasks, the home page) and Lock, the current screen, a footer with
// today's study day and whether the app is ready to work offline, and on the three main pages (Tasks,
// Classes, Settings) the nav bar and the after-class reminder (#129). Until the app is unlocked, the only
// screen is setup (first run) or unlock.
export default function App({ store, vault }: { store: StudyStore; vault: Vault }) {
  const route = useRoute();
  // Bumped when another device's changes arrive (#105), so the pages that list things load again
  const [dataVersion, setDataVersion] = useState(0);
  const [status, setStatus] = useState<VaultStatus>(() => vault.status());
  const refresh = () => setStatus(vault.status());
  // A new version waits while you're setting up or unlocked (src/ui/update.ts), and applies on locking
  useEffect(() => setActivity(status === 'unlocked' ? 'unlocked' : status === 'new' ? 'unlocking' : 'locked'), [status]);
  // Back from a Google sign-in for unlocking or setting up (#101): once open, on to Tasks
  useEffect(() => {
    if (status === 'unlocked' && [GOOGLE_UNLOCK_RETURN, GOOGLE_SETUP_RETURN, JOIN_RETURN].some((r) => window.location.hash === r.slice(1))) {
      go({ name: 'tasks' });
    }
  }, [status]);
  // The slides use the whole window (app.css .wide); header and footer line up with them
  const wide = status === 'unlocked' && (route.name === 'slides' || route.name === 'play');
  // On a phone the Slides page is just the slides: no header or footer (app.css .slides-page, #110)
  const slidesPage = status === 'unlocked' && route.name === 'slides';
  const frame = (base: string) => [base, wide && 'wide', slidesPage && 'slides-page'].filter(Boolean).join(' ');
  // Lock also forgets this device's remembered unlock (#99), so the next open asks again. Forgotten
  // first: the unlock screen tries a remembered unlock as soon as it appears.
  const lock = async () => {
    await vault.forget().catch(() => {});
    vault.lock();
    refresh();
    go({ name: 'tasks' });
  };
  const page = status === 'unlocked' ? mainPage(route) : null;

  return (
    <VaultContext value={vault}>
      <StoreContext value={store}>
        <BankJobsProvider store={store}>
        <StopJobsWhenLocked unlocked={status === 'unlocked'} />
        <header className={frame('top')}>
          <h1>
            <a href={href({ name: 'tasks' })}>{APP_NAME}</a>
          </h1>
          {status === 'unlocked' && (
            <button type="button" onClick={() => void lock()}>
              Lock
            </button>
          )}
        </header>
        <main className={frame('app')}>
          {status === 'new' && <SetupScreen onDone={refresh} />}
          {status === 'locked' && <UnlockScreen onUnlocked={refresh} />}
          {status === 'unlocked' && <BackupWatcher store={store} />}
          {status === 'unlocked' && <UpdateBanner />}
          {status === 'unlocked' && <BankJobsStatus />}
          {status === 'unlocked' && <SyncRunner onChanged={() => setDataVersion((v) => v + 1)} />}
          {status === 'unlocked' && <Screen route={route} onLock={lock} dataVersion={dataVersion} onReplaced={() => setDataVersion((v) => v + 1)} />}
          {page && <AfterClass page={page} />}
        </main>
        <Footer wide={wide} slidesPage={slidesPage} nav={page !== null} />
        {page && <NavBar current={page} />}
        </BankJobsProvider>
      </StoreContext>
    </VaultContext>
  );
}

function Screen({
  route,
  onLock,
  dataVersion,
  onReplaced,
}: {
  route: ReturnType<typeof useRoute>;
  onLock: () => void;
  dataVersion: number;
  onReplaced: () => void;
}) {
  return (
    <>
      {route.name === 'tasks' && <TasksScreen key={dataVersion} />}
      {route.name === 'classes' && <ClassesScreen key={dataVersion} />}
      {route.name === 'class' && <ClassScreen key={href(route)} courseId={route.courseId} part={route.part} cover={route.cover} />}
      {route.name === 'slides' && (
        <Suspense fallback={<p className="muted">Opening the slides…</p>}>
          <SlidesScreen key={href(route)} courseId={route.courseId} deckId={route.deckId} first={route.first} last={route.last} />
        </Suspense>
      )}
      {route.name === 'quiz' && (
        <Suspense fallback={<p className="muted">Opening the quiz…</p>}>
          <QuizScreen key={href(route)} courseId={route.courseId} sectionId={route.sectionId} compare={route.compare} />
        </Suspense>
      )}
      {route.name === 'play' && (
        <Suspense fallback={<p className="muted">Getting today ready…</p>}>
          <PlayScreen />
        </Suspense>
      )}
      {route.name === 'practice' && (
        <Suspense fallback={<p className="muted">Getting the practice ready…</p>}>
          <PracticeScreen key={href(route)} examId={route.examId} />
        </Suspense>
      )}
      {route.name === 'settings' && <SettingsScreen onLock={onLock} onReplaced={onReplaced} />}
      {route.name === 'not-found' && (
        <section>
          <h2>Page not found</h2>
          <a className="back" href={href({ name: 'tasks' })}>← Back to Tasks</a>
        </section>
      )}
    </>
  );
}

/** "A new version is ready": reloading closes what you're doing (and locks, unless this device remembers the unlock, #99), so it's your choice when (or it happens on Lock). */
function UpdateBanner() {
  const [ready, setReady] = useState(isUpdateReady);
  useEffect(() => {
    const stop = onUpdateChange(setReady);
    setReady(isUpdateReady()); // it may have arrived between the first render and listening
    return stop;
  }, []);
  if (!ready) return null;
  return (
    <p className="update-banner" role="status" data-testid="update-banner">
      A new version of {APP_NAME} is ready. Finish what you’re doing first: reloading starts {APP_NAME} again.{' '}
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </p>
  );
}

/** Locking stops the background question-making: nothing can be saved while locked. */
function StopJobsWhenLocked({ unlocked }: { unlocked: boolean }) {
  const { stop } = useBankJobs();
  useEffect(() => {
    if (!unlocked) stop();
  }, [unlocked]);
  return null;
}

function Footer({ wide, slidesPage, nav }: { wide: boolean; slidesPage: boolean; nav: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(() => setOfflineReady(true)).catch(() => {});
  }, []);

  return (
    <footer className={['foot muted small', wide && 'wide', slidesPage && 'slides-page', nav && 'above-nav'].filter(Boolean).join(' ')}>
      <span>
        Study day <span data-testid="study-day">{studyDay(now, deviceTimeZone(), DAY_START_HOUR)}</span>
      </span>
      <span data-testid="offline-status">{offlineReady ? 'Ready: works without a connection' : 'Getting ready…'}</span>
      <span>Your classes and slides stay on this device.</span>
    </footer>
  );
}

/** Shown when the browser won't let the app store anything (e.g. some private windows). */
export function StorageProblem({ message }: { message: string }) {
  return (
    <main className="app">
      <h1>{APP_NAME}</h1>
      <p className="error">This browser won’t let {APP_NAME} store your classes and slides on this device.</p>
      <p className="muted">
        Private or incognito windows sometimes block storage. Try a normal window. ({message})
      </p>
    </main>
  );
}
