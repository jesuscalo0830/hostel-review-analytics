import React, { useState } from 'react';
import { BookingReview } from '../types';
import { Star, ThumbsUp, ThumbsDown, MessageSquare, Languages, Loader2, Smile, Frown, Meh, ArrowRightLeft, MapPin } from 'lucide-react';
import { resolvePropertyForReview, PROPERTY_LOCATIONS } from '../constants';
import { cn } from '../utils/cn';
import { translateReview } from '../services/gemini';
import { motion, AnimatePresence } from 'motion/react';
import { isValidFeedback } from '../utils/validation';

interface ReviewCardProps {
  review: BookingReview;
  index?: number;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({ review, index = 0 }) => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [localTranslatedPos, setLocalTranslatedPos] = useState<string | null>(null);
  const [localTranslatedNeg, setLocalTranslatedNeg] = useState<string | null>(null);

  const [showOriginal, setShowOriginal] = useState(false);

  const translatedPos = review.translatedPositive || localTranslatedPos;
  const translatedNeg = review.translatedNegative || localTranslatedNeg;

  const handleTranslate = async () => {
    if (isTranslating) return;
    setIsTranslating(true);
    try {
      if (review.positiveReview && !translatedPos) {
        const trans = await translateReview(review.positiveReview, "English");
        setLocalTranslatedPos(trans);
      }
      if (review.negativeReview && !translatedNeg) {
        const trans = await translateReview(review.negativeReview, "English");
        setLocalTranslatedNeg(trans);
      }
    } catch (error) {
      console.error("Translation failed", error);
    } finally {
      setIsTranslating(false);
    }
  };

  const hasTranslation = !!(translatedPos || translatedNeg || review.translatedTitle || review.translatedReply);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4, shadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)" }}
      className="bg-[var(--card-bg)] rounded-[40px] border border-slate-200/60 shadow-sm overflow-hidden group transition-all duration-500"
    >
      <div className="p-6 md:p-12">
        {/* Top Meta */}
        <div className="flex flex-wrap items-center justify-between gap-6 mb-10">
          <div className="flex items-center gap-4">
            <motion.div 
              whileHover={{ scale: 1.1, rotate: 5 }}
              className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-slate-200"
            >
              {review.reviewScore}
            </motion.div>
            <div>
              <h4 className="text-base md:text-lg font-black text-[var(--text-primary)] tracking-tight leading-tight">
                {(showOriginal ? review.reviewTitle : (review.translatedTitle || review.reviewTitle)) || "Untitled Review"}
              </h4>
              {(review.guestName || review.reservationNumber) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 mb-2">
                  {review.guestName && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full">
                      Guest: <span className="font-black text-slate-900">{review.guestName}</span>
                    </span>
                  )}
                  {review.reservationNumber && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full">
                      Booking #<span className="font-black tabular-nums ml-0.5">{review.reservationNumber}</span>
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                <span className="text-[9px] md:text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{review.reviewDate}</span>
                <span className="w-1 h-1 rounded-full bg-slate-200" />
                <span className="text-[9px] md:text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{review.roomName}</span>
                {(() => {
                  const propertyName = resolvePropertyForReview(review);
                  if (!propertyName) return null;
                  return (
                    <>
                      <span className="hidden sm:inline w-1 h-1 rounded-full bg-slate-200" />
                      <span className="inline-flex items-center gap-1.5 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-indigo-600">
                        <MapPin className="w-3 h-3" />
                        {propertyName}
                        <span className="text-[var(--text-secondary)] font-bold normal-case tracking-normal opacity-70 ml-1">{PROPERTY_LOCATIONS[propertyName]}</span>
                      </span>
                    </>
                  );
                })()}
                {review.platform && (
                  <>
                    <span className="hidden sm:inline w-1 h-1 rounded-full bg-slate-200" />
                    <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-teal-600">
                      {review.platform}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AnimatePresence mode="wait">
              {hasTranslation && (
                <motion.button 
                  key="toggle-translation"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowOriginal(!showOriginal)}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
                >
                  <ArrowRightLeft className="w-3 h-3" />
                  {showOriginal ? "Show Translated" : "Show Original"}
                </motion.button>
              )}
            </AnimatePresence>
            
            {review.sentiment && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border",
                  review.sentiment === 'positive' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                  review.sentiment === 'negative' ? "bg-rose-50 text-rose-700 border-rose-100" :
                  "bg-amber-50 text-amber-700 border-amber-100"
                )}
              >
                {review.sentiment === 'positive' ? <Smile className="w-4 h-4 text-emerald-600" /> :
                 review.sentiment === 'negative' ? <Frown className="w-4 h-4 text-rose-600" /> :
                 <Meh className="w-4 h-4 text-amber-600" />}
                {review.sentiment}
              </motion.div>
            )}
            
            {!hasTranslation && (
              <motion.button 
                whileHover={{ scale: 1.05, backgroundColor: '#6366f1' }}
                whileTap={{ scale: 0.95 }}
                onClick={handleTranslate}
                disabled={isTranslating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-navy text-white text-[10px] font-black uppercase tracking-widest hover:bg-indigo transition-all disabled:opacity-50"
              >
                {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />}
                {isTranslating ? "Translating..." : "Translate to English"}
              </motion.button>
            )}
          </div>
        </div>

        {/* Review Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div className="space-y-8">
            {isValidFeedback(review.positiveReview) && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="relative pl-8 border-l-2 border-emerald-500/30"
              >
                <div className="absolute -left-1 top-0 w-2 h-2 rounded-full bg-emerald-500" />
                <h5 className="text-[9px] md:text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-3">Positive Feedback</h5>
                <p className="text-[var(--text-secondary)] leading-relaxed font-medium italic text-base md:text-lg">
                   "{showOriginal ? review.positiveReview : (translatedPos || review.positiveReview)}"
                </p>
              </motion.div>
            )}
            {isValidFeedback(review.negativeReview) && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="relative pl-8 border-l-2 border-rose-500/30"
              >
                <div className="absolute -left-1 top-0 w-2 h-2 rounded-full bg-rose-500" />
                <h5 className="text-[9px] md:text-[10px] font-black text-rose-600 uppercase tracking-[0.2em] mb-3">Areas for Improvement</h5>
                <p className="text-[var(--text-secondary)] leading-relaxed font-medium italic text-base md:text-lg">
                   "{showOriginal ? review.negativeReview : (translatedNeg || review.negativeReview)}"
                </p>
              </motion.div>
            )}
          </div>

          <div className="space-y-8">
            <div className="grid grid-cols-2 md:grid-cols-2 gap-3 lg:gap-4">
              <MiniStat label="Staff" val={review.staff} delay={0.2} />
              <MiniStat label="Cleanliness" val={review.cleanliness} delay={0.3} />
              <MiniStat label="Location" val={review.location} delay={0.4} />
              <MiniStat label="Facilities" value={review.facilities} delay={0.5} />
            </div>

            {review.propertyReply && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="bg-[var(--bg-main)] rounded-3xl p-8 border border-[var(--border-color)]"
              >
                <h5 className="text-[9px] md:text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-4">Property Response</h5>
                <p className="text-slate-600 text-xs md:text-sm leading-relaxed font-medium">
                  {showOriginal ? review.propertyReply : (review.translatedReply || review.propertyReply)}
                </p>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const MiniStat = ({ label, val, value, delay = 0 }: { label: string; val?: number; value?: number; delay?: number }) => {
  const displayValue = val !== undefined ? val : value || 0;
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className="bg-[var(--card-bg)] border border-[var(--border-color)] p-5 rounded-2xl flex flex-col items-center justify-center text-center group-hover:border-brand-100 transition-colors"
    >
      <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-1">{label}</span>
      <span className="text-xl font-black text-[var(--text-primary)]">{displayValue}</span>
    </motion.div>
  );
};
