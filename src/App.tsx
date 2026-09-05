import { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { parseBookingCSV, detectPlatform, parseXLSBuffer } from './utils/csvParser';
import { BookingReview, UploadLogEntry } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { translateReviewsBatch } from './services/gemini';
import {
  saveReviews, subscribeToReviews, readCachedReviews,
} from './services/firestore';
import { onAuthChange, signOutUser, type User } from './lib/firebase';
import { SignIn } from './components/SignIn';
import { needsEnglishTranslation } from './utils/validation';

export default function App() {
  const [reviews, setReviews] = useState<BookingReview[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  /** undefined = auth state not resolved yet; null = signed out. */
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [uploadToast, setUploadToast] = useState<{ type: 'success' | 'duplicate'; message: string } | null>(null);
  /** Message shown on the loading screen while first-load work runs. */
  const [loadingStatus, setLoadingStatus] = useState('Initializing Dashboard...');
  const [uploadLog, setUploadLog] = useState<UploadLogEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('upload_log') || '[]'); } catch { return []; }
  });

  const showToast = (type: 'success' | 'duplicate', message: string) => {
    setUploadToast({ type, message });
    setTimeout(() => setUploadToast(null), 4000);
  };
  const aiKeyMissing = !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MY_GEMINI_API_KEY';

  // Resolve the signed-in account before touching any data. Reviews live at
  // the shared workspace, so there is nothing to read until this settles.
  useEffect(() => onAuthChange(setUser), []);

  useEffect(() => {
    if (user === undefined) return;          // still resolving
    if (user === null) {                     // signed out: drop everything
      setReviews([]);
      setIsLoaded(false);
      return;
    }

    // Paint from the workspace cache immediately, then let the live
    // subscription correct it. Without this the dashboard waits on a network
    // round trip on every load.
    const cached = readCachedReviews();
    if (cached.length > 0) setReviews(cached);

    let cancelled = false;
    let translatedOnce = false;

    const unsubscribe = subscribeToReviews(
      async (incoming) => {
        if (cancelled) return;
        setReviews(incoming);
        setCloudSyncError(null);

        // Repair translations once per session, after the first snapshot, so
        // reports never render untranslated text. Runs with or without an API
        // key -- translateReviewsBatch falls back to the offline dictionary.
        if (!translatedOnce) {
          translatedOnce = true;
          const needsFix = incoming.filter(needsEnglishTranslation);
          if (needsFix.length > 0) {
            setLoadingStatus(`Translating ${needsFix.length} review${needsFix.length !== 1 ? 's' : ''} to English...`);
            try {
              // Persist after every chunk rather than only at the end.
              //
              // Gemini is called in chunks of 20 with a 2.5s gap to respect
              // the free-tier rate limit, so a few hundred reviews take
              // minutes. Saving only on completion meant a timeout threw away
              // every translation already paid for, and the next load started
              // from nothing -- which is why translations never appeared to
              // stick on a large dataset.
              // Held in an object: TypeScript narrows a `let` that is only
              // assigned inside a callback back to null at the read site.
              const progress: { last: BookingReview[] | null } = { last: null };
              const onProgress = (partial: BookingReview[], done: number, total: number) => {
                if (cancelled) return;
                setLoadingStatus(`Translating reviews to English... ${done} of ${total}`);
                progress.last = partial;
                // Fire and forget: a failed intermediate save must not stop
                // the run, and the next chunk will save again anyway.
                saveReviews(partial).catch(err =>
                  console.warn("[auto-translate] partial save failed:", err)
                );
              };

              // Budget scales with the work: ~6s per chunk of 20 plus slack,
              // capped so a pathological run cannot hang the app forever.
              const chunks = Math.ceil(needsFix.length / 20);
              const TIMEOUT_MS = Math.min(15_000 + chunks * 6_000, 300_000);

              const fixed = await Promise.race([
                translateReviewsBatch(needsFix, "English", onProgress),
                new Promise<null>(resolve => setTimeout(() => resolve(null), TIMEOUT_MS)),
              ]);
              if (!cancelled) {
                if (fixed) {
                  await saveReviews(fixed);
                } else {
                  console.warn(
                    `[auto-translate] hit the ${TIMEOUT_MS}ms budget; ` +
                    `chunks completed so far are saved and the rest resume on the next load.`
                  );
                  if (progress.last) await saveReviews(progress.last);
                }
              }
            } catch (err) {
              console.warn("[auto-translate] skipped:", err);
            }
          }
        }
        setIsLoaded(true);
      },
      (err) => {
        if (cancelled) return;
        setCloudSyncError(err.message);
        setIsLoaded(true);
      }
    );

    return () => { cancelled = true; unsubscribe(); };
  }, [user]);

  const handleUpload = async (csv: string | ArrayBuffer, fileName?: string) => {
    try {
      let parsedReviews: BookingReview[];
      let platform: string;
      if (csv instanceof ArrayBuffer) {
        parsedReviews = await parseXLSBuffer(csv);
        platform = 'XLS';
      } else {
        platform = detectPlatform(csv);
        parsedReviews = parseBookingCSV(csv);
      }
      if (parsedReviews.length === 0) {
        alert(`No reviews could be parsed from this file. Detected format: ${platform}. Check the header row matches a Booking, Agoda, or PMS export.`);
        return;
      }

      // Auto-translate to English in background. Booking reviews split positive
      // and negative; Agoda has a single Review field; PMS has minimal text.
      // Translation is best-effort -- a missing API key or transient network
      // failure shouldn't block the upload from being usable locally.
      let translated = parsedReviews;
      try {
        translated = await translateReviewsBatch(parsedReviews, "English");
      } catch (e: any) {
        console.warn("[upload] translation skipped:", e?.message || e);
      }

      // Save: localStorage is authoritative; Firestore is best-effort sync.
      // saveReviews returns the merged local state directly, avoiding the
      // round-trip through fetchReviews (which used to overwrite local with
      // stale Firestore data after a clear).
      const { merged, added, updated, remoteSaved, remoteError } = await saveReviews(translated);
      setReviews(merged);
      setCloudSyncError(remoteError || null);

      const actuallyNew = added;
      if (parsedReviews.length > 0) {
        if (added === 0) {
          showToast('duplicate', `${parsedReviews.length} review${parsedReviews.length !== 1 ? 's' : ''} already in the database — no new data added.`);
        } else if (updated > 0) {
          showToast('success', `${added} new review${added !== 1 ? 's' : ''} added, ${updated} refreshed, from ${parsedReviews.length} in file.`);
        } else {
          showToast('success', `${added} new review${added !== 1 ? 's' : ''} added from ${parsedReviews.length} in file.`);
        }
      }

      // Record upload in log
      const uniqueProps = Array.from(new Set(parsedReviews.map(r => r.property).filter(Boolean))) as string[];
      const logEntry: UploadLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fileName: fileName || 'Unknown file',
        uploadedAt: new Date().toISOString(),
        rowsParsed: parsedReviews.length,
        rowsAdded: actuallyNew,
        platform,
        properties: uniqueProps,
      };
      setUploadLog(prev => {
        const updated = [logEntry, ...prev];
        try { localStorage.setItem('upload_log', JSON.stringify(updated)); } catch {}
        return updated;
      });

      console.info(
        `[upload] Loaded ${parsedReviews.length} ${platform} review(s); ` +
        `total is now ${merged.length}.` +
        (remoteError
          ? ` Cloud sync skipped (${remoteError}); data is saved locally and will appear after firestore.rules are deployed.`
          : ` Synced ${remoteSaved} to cloud.`)
      );

      if (remoteError) {
        // Non-blocking notice -- the upload still worked, the user just won't
        // have cloud sync until they redeploy firestore.rules.
        console.warn(
          "Cloud sync is currently disabled (Firestore rules denied the write). " +
          "Your data is saved in this browser. " +
          "Run `npx firebase deploy --only firestore` from the project folder to re-enable cloud sync."
        );
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      alert("Could not parse this file. " + (error?.message || "Unknown error"));
    }
  };

  const handleRepairTranslations = async () => {
    try {
      const needsTranslation = reviews.filter(needsEnglishTranslation);
      
      if (needsTranslation.length === 0) {
        alert("All non-English reviews appear to be correctly translated to English!");
        return;
      }

      if (!window.confirm(`Found ${needsTranslation.length} non-English review(s) requiring translation repair. Convert to English now?`)) {
        return;
      }

      // Without an API key the offline dictionary still runs, but it only
      // covers a fixed set of common hostel phrases -- so say what will
      // actually happen rather than either refusing outright or implying
      // full translation.
      if (aiKeyMissing) {
        const proceed = window.confirm(
          'No Gemini API key is configured, so only the built-in offline ' +
          'dictionary can be used.\n\n' +
          'It covers common German, French, Spanish, Catalan, Italian, ' +
          'Portuguese and Dutch phrases -- anything else will stay in its ' +
          'original language.\n\n' +
          'For full translation, set GEMINI_API_KEY and redeploy.\n\n' +
          'Run the offline pass now?'
        );
        if (!proceed) return;
      }

      const translated = await translateReviewsBatch(needsTranslation, "English");

      // Count reviews whose text actually CHANGED, not just whose translated
      // fields are populated.
      //
      // The offline fallback used to echo the source text into translated*,
      // so a populated-field count reported "translated N successfully" while
      // every review on screen was still in its original language.
      const changed = (a?: string, b?: string) =>
        !!a && !!b && a.trim() !== b.trim();
      const successCount = translated.filter(r =>
        changed(r.translatedPositive, r.positiveReview) ||
        changed(r.translatedNegative, r.negativeReview) ||
        changed(r.translatedTitle, r.reviewTitle)
      ).length;

      // Use saveReviews's merged result directly so we don't round-trip
      // through fetchReviews (which used to overwrite local with stale data).
      const { merged, remoteError } = await saveReviews(translated);
      setReviews(merged);
      setCloudSyncError(remoteError || null);

      const engine = aiKeyMissing ? 'offline dictionary' : 'Gemini';
      if (successCount === 0) {
        alert(
          aiKeyMissing
            ? 'No translations were applied. The offline dictionary did not ' +
              'recognise any of these phrases. Set GEMINI_API_KEY for full ' +
              'translation coverage.'
            : 'No translations were applied. The Gemini API may be down or ' +
              'rate-limited; check the browser console for details.'
        );
      } else if (successCount < needsTranslation.length) {
        alert(
          `Translated ${successCount} of ${needsTranslation.length} reviews using the ${engine}. ` +
          `The remaining ${needsTranslation.length - successCount} were left unchanged` +
          (aiKeyMissing ? ' -- set GEMINI_API_KEY to translate them.' : ' -- check the console.')
        );
      } else {
        alert(`Translated ${successCount} reviews using the ${engine}.`);
      }
    } catch (error: any) {
      console.error("Repair error:", error);
      alert("Failed to repair translations. Error: " + (error?.message || "Unknown error"));
    }
  };

  // Deleting reviews is intentionally not possible from the app.
  //
  // The workspace is shared, so one person clearing it would wipe the
  // dataset for the whole team, and uploads are the only way to rebuild it.
  // firestore.rules also denies delete, so this cannot be re-enabled by
  // changing the UI alone.

  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(!isDarkMode);

  // Auth gate. Resolving the session is fast but not instant, so show the
  // spinner rather than flashing the sign-in screen at an already-signed-in
  // user on every page load.
  if (user === undefined) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (user === null) return <SignIn />;

  return (
    <div className="min-h-screen transition-colors duration-300">
      <AnimatePresence mode="wait">
        {isLoaded ? (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <Dashboard
              reviews={reviews}
              onUpload={handleUpload}
              onRepairTranslations={handleRepairTranslations}
              isDarkMode={isDarkMode}
              toggleDarkMode={toggleDarkMode}
              aiKeyMissing={aiKeyMissing}
              uploadToast={uploadToast}
              onDismissToast={() => setUploadToast(null)}
              cloudSyncError={cloudSyncError}
              uploadLog={uploadLog}
              userEmail={user.email || undefined}
              onSignOut={signOutUser}
            />
          </motion.div>
        ) : (
          <div className="flex items-center justify-center h-screen">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-500 font-medium animate-pulse">{loadingStatus}</p>
            </div>
          </div>
        )}
      </AnimatePresence>
      
      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-12 border-t border-slate-200 mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-navy rounded-lg flex items-center justify-center text-white font-black text-xl italic">H</div>
            <span className="font-bold text-slate-900 tracking-tight">Hostel Analyzer</span>
          </div>
          <p className="text-sm text-slate-500">
            (c) 2026 Hostel Analyzer. Multi-platform guest-review intelligence for property managers.
          </p>
        </div>
      </footer>
    </div>
  );
}
