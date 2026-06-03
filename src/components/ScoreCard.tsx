import React from 'react';
import { cn } from '../utils/cn';
import { Star } from 'lucide-react';
import { motion } from 'motion/react';

interface ScoreCardProps {
  label: string;
  score: number | string;
  icon?: React.ReactNode;
  isPercentage?: boolean;
  className?: string;
  index?: number;
  /** Optional sample size -- when provided, rendered as "n=87" beneath the score. */
  sampleSize?: number;
  /** Optional total -- when provided alongside sampleSize, rendered as "87/100". */
  sampleTotal?: number;
}

export const ScoreCard: React.FC<ScoreCardProps> = ({
  label,
  score,
  icon,
  isPercentage,
  className,
  index = 0,
  sampleSize,
  sampleTotal,
}) => {
  const showSample = typeof sampleSize === 'number' && sampleSize >= 0;
  const lowSample = showSample && (sampleSize as number) > 0 && (sampleSize as number) < 20;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      whileHover={{ y: -4, shadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)" }}
      className={cn(
        "bg-[var(--card-bg)] p-6 md:p-8 rounded-[32px] border border-slate-200/60 shadow-sm transition-all duration-300 group",
        className
      )}
    >
      <div className="flex items-center justify-between mb-6">
        <div className="p-3 rounded-2xl bg-slate-50 text-[var(--text-secondary)] group-hover:bg-indigo/5 group-hover:text-indigo-600 transition-colors">
          {icon || <Star className="w-5 h-5" />}
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn("w-1.5 h-1.5 rounded-full", lowSample ? "bg-orange-500" : "bg-emerald-500")} />
          <span className={cn("text-[10px] font-black uppercase tracking-widest", lowSample ? "text-orange-600" : "text-emerald-600")}>
            {lowSample ? "Low N" : "Live"}
          </span>
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-2">{label}</p>
        <div className="flex items-baseline gap-1">
          <h3 className="text-4xl font-black text-[var(--text-primary)] tracking-tighter">
            {score}
          </h3>
          {isPercentage && <span className="text-xl font-black text-slate-300">%</span>}
        </div>
        {showSample && (
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)] tabular-nums">
            {typeof sampleTotal === 'number' && sampleTotal !== sampleSize
              ? `n=${sampleSize} / ${sampleTotal}`
              : `n=${sampleSize}`}
          </p>
        )}
      </div>
    </motion.div>
  );
};
