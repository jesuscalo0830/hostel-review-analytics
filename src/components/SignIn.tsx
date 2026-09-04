import { useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';

/**
 * Sign-in gate. Reviews live under the signed-in account, so nothing can be
 * read or written until this completes.
 */
export const SignIn = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      const code = err?.code || '';
      // Google sign-in has to be switched on in the Firebase console; without
      // it the popup fails immediately and the cause is not obvious.
      setError(
        code === 'auth/operation-not-allowed'
          ? 'Google sign-in is not enabled for this Firebase project yet. Enable it under Authentication > Sign-in method.'
          : code === 'auth/unauthorized-domain'
          ? 'This domain is not in the Firebase authorised domains list.'
          : err?.message || 'Sign-in failed. Please try again.'
      );
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md bg-white border border-slate-200 rounded-3xl shadow-xl p-10 text-center"
      >
        <div className="w-14 h-14 mx-auto mb-6 bg-navy rounded-2xl flex items-center justify-center text-white font-black text-2xl italic">
          H
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Hostel Analyzer</h1>
        <p className="text-sm text-slate-500 mt-2 mb-8 leading-relaxed">
          Multi-platform guest-review intelligence.<br />
          Sign in to reach the team's shared review data from any browser.
        </p>

        <button
          onClick={handleSignIn}
          disabled={busy}
          className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all disabled:opacity-60 active:scale-[0.98]"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          {busy ? 'Signing in...' : 'Sign in with Google'}
        </button>

        {error && (
          <p className="mt-5 text-[12px] leading-relaxed text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-left">
            {error}
          </p>
        )}

        <p className="mt-8 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          Your reviews are private to your account
        </p>
      </motion.div>
    </div>
  );
};
