import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookingReview } from '../types';
import { calculateAverages } from '../utils/csvParser';
import { ScoreCard } from './ScoreCard';
import { ReviewCard } from './ReviewCard';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, AreaChart, Area, Cell, PieChart, Pie, Legend
} from 'recharts';
import {
    Brain, LayoutDashboard, ListFilter, TrendingUp, Download, Upload,
    Calendar, ChevronDown, Star, Users, Home, Settings, DollarSign,
    MessageSquare, AlertCircle, Target, BarChart3, PieChart as PieChartIcon,
    Languages, Loader2, Smile, Search, ArrowRightLeft, Filter, Sparkles,
    Droplets, Volume2, MapPin, Wrench, Table, RefreshCw, ShieldCheck, Briefcase, UserCircle,
    CheckCircle2, AlertTriangle, Heart, Menu, X, Sun, Moon, Building2
} from 'lucide-react';
import { generateInsights, translateReviewsBatch, analyzeSentimentBatch, categorizeNegativeReviews, draftReplyToReview } from '../services/gemini';
import { parseRobustDate } from '../utils/dateUtils';
import {
    format, subDays, subWeeks, subMonths, isWithinInterval,
    startOfDay, endOfDay, isValid, parse, startOfWeek, endOfWeek,
    startOfMonth, endOfMonth, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval
} from 'date-fns';
import { cn } from '../utils/cn';
import { extractKeywords } from '../utils/sentiment';
import { PROPERTY_NAMES, PROPERTY_LOCATIONS, resolvePropertyForReview } from '../constants';
import { isValidFeedback } from '../utils/validation';

interface DashboardProps {
    reviews: BookingReview[];
    onUpload: (csv: string | ArrayBuffer) => void;
    uploadToast?: { type: 'success' | 'duplicate'; message: string } | null;
    onDismissToast?: () => void;
    onClear: () => void;
    onRepairTranslations: () => Promise<void>;
    isDarkMode: boolean;
    toggleDarkMode: () => void;
    /** True when no Gemini API key is configured -- AI features will fail. */
    aiKeyMissing?: boolean;
    /** Set to a string when the most recent Firestore write was denied. */
    cloudSyncError?: string | null;
}

type ReportType =
    | 'overall'
    | 'department'
    | 'monthly_trend'
    | 'negative'
    | 'value'
    | 'facilities'
    | 'staff_impact'
    | 'sentiment'
    | 'scorecard'
    | 'platform'
    | 'room_performance'
    | 'hostel_comparison'
    | 'data_grid';

type Persona = 'admin' | 'staff' | 'guest';

const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'ru', name: 'Russian' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
];



// Returns "Property * Location" for reviews where a known property name was
// detected in the text or roomName, otherwise falls back to the original roomName.
const reviewLocationLabel = (r: BookingReview): string => {
    const prop = resolvePropertyForReview(r);
    if (prop) {
        const loc = PROPERTY_LOCATIONS[prop];
        return loc ? `${prop} * ${loc}` : prop;
    }
    return r.roomName || 'General';
};


/**
 * Action bar for critical/negative review cards.
 *  * Draft Reply -> calls Gemini, opens a modal with the generated reply +
 *    Copy to Clipboard button
 *  * Copy Review -> copies the review text to clipboard
 *  * Mark Handled -> stores a flag in localStorage so the card visually
 *    fades to "addressed" state on re-render
 */
const HANDLED_STORAGE_KEY = 'hostel_handled_review_ids';

const readHandledSet = (): Set<string> => {
    try {
        const raw = localStorage.getItem(HANDLED_STORAGE_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
};
const writeHandledSet = (set: Set<string>): void => {
    try { localStorage.setItem(HANDLED_STORAGE_KEY, JSON.stringify(Array.from(set))); } catch {}
};

const CriticalReviewActions: React.FC<{ review: BookingReview }> = ({ review }) => {
    const [drafting, setDrafting] = useState(false);
    const [draft, setDraft] = useState<string | null>(null);
    const [showDraft, setShowDraft] = useState(false);
    const [copied, setCopied] = useState(false);
    const [handled, setHandled] = useState<boolean>(() => readHandledSet().has(review.reservationNumber));

    const handleDraft = async () => {
        setDrafting(true);
        setShowDraft(true);
        setDraft(null);
        const text = await draftReplyToReview(review, 'English');
        setDraft(text || '(Draft could not be generated -- check the AI key and try again.)');
        setDrafting(false);
    };

    const handleCopyReview = async () => {
        const text = review.translatedNegative || review.negativeReview || review.translatedPositive || review.positiveReview || '';
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
        catch (e) { console.warn('clipboard write failed', e); }
    };

    const handleCopyDraft = async () => {
        if (!draft) return;
        try { await navigator.clipboard.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500); }
        catch (e) { console.warn('clipboard write failed', e); }
    };

    const handleToggleHandled = () => {
        const set = readHandledSet();
        if (handled) set.delete(review.reservationNumber); else set.add(review.reservationNumber);
        writeHandledSet(set);
        setHandled(!handled);
    };

    return (
        <>
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                <button
                    onClick={handleDraft}
                    disabled={drafting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                    title="Generate an AI-drafted reply to this review"
                >
                    {drafting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Draft Reply
                </button>
                <button
                    onClick={handleCopyReview}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                    title="Copy the review text to clipboard"
                >
                    <MessageSquare className="w-3 h-3" />
                    {copied ? 'Copied!' : 'Copy Review'}
                </button>
                <button
                    onClick={handleToggleHandled}
                    className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors",
                        handled
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    )}
                    title="Toggle the addressed/handled state for this review (stored in this browser)"
                >
                    <CheckCircle2 className="w-3 h-3" />
                    {handled ? 'Handled' : 'Mark Handled'}
                </button>
            </div>

            {showDraft && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => setShowDraft(false)}
                >
                    <div
                        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-8 max-h-[80vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-1">Draft Reply</p>
                                <h3 className="text-xl font-black text-slate-900">Review #{review.reservationNumber}</h3>
                                <p className="text-xs text-slate-500 mt-1">{review.guestName || 'Guest'} * Score {review.reviewScore}/10</p>
                            </div>
                            <button onClick={() => setShowDraft(false)} className="text-slate-400 hover:text-slate-700">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="bg-slate-50 rounded-2xl p-4 mb-4 text-xs text-slate-700 italic leading-relaxed">
                            "{review.translatedNegative || review.negativeReview || review.translatedPositive || review.positiveReview}"
                        </div>

                        {drafting && (
                            <div className="flex items-center justify-center py-12 text-slate-500 gap-3">
                                <Loader2 className="w-5 h-5 animate-spin" /> Drafting a reply...
                            </div>
                        )}
                        {!drafting && draft && (
                            <>
                                <textarea
                                    className="w-full min-h-[180px] p-4 rounded-2xl border border-slate-200 text-sm text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                />
                                <div className="flex justify-end gap-2 mt-4">
                                    <button
                                        onClick={() => setShowDraft(false)}
                                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                                    >
                                        Close
                                    </button>
                                    <button
                                        onClick={handleCopyDraft}
                                        className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-700"
                                    >
                                        {copied ? 'Copied!' : 'Copy to Clipboard'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

// Property name matching: looks at roomName plus the review text fields.
// This matters because some CSV exports have no per-property column,
// and guests typically mention the property name in review text.
const matchesPropertyName = (r: BookingReview, name: string): boolean => {
    if (!name || name === 'all') return true;
    const needle = name.toLowerCase();
    const hay = (
        (r.roomName || '') + ' ' +
        (r.reviewTitle || '') + ' ' +
        (r.translatedTitle || '') + ' ' +
        (r.positiveReview || '') + ' ' +
        (r.translatedPositive || '') + ' ' +
        (r.negativeReview || '') + ' ' +
        (r.translatedNegative || '')
    ).toLowerCase();
    return hay.includes(needle);
};

export const Dashboard: React.FC<DashboardProps> = ({ reviews, onUpload, onClear, onRepairTranslations, isDarkMode, toggleDarkMode, aiKeyMissing, cloudSyncError, uploadToast, onDismissToast }) => {
    const [activeReport, setActiveReport] = useState<ReportType>('overall');
    const [persona, setPersona] = useState<Persona>('admin');
    const [isGenerating, setIsGenerating] = useState(false);
    const [aiInsights, setAiInsights] = useState<string | null>(null);
    const [dateFilter, setDateFilter] = useState<string>('custom');
    const [customRange, setCustomRange] = useState({ start: '', end: '' });
    const [targetLanguage, setTargetLanguage] = useState('English');
    const [isTranslating, setIsTranslating] = useState(false);
    const [translatedReviews, setTranslatedReviews] = useState<BookingReview[]>(reviews);
    const [searchTerm, setSearchTerm] = useState('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isComparisonMode, setIsComparisonMode] = useState(false);
    const [hostelFilter, setHostelFilter] = useState<string>('all');
    const [platformFilter, setPlatformFilter] = useState<string>('all');

    // Sync translatedReviews with reviews when reviews change
    useEffect(() => {
        setTranslatedReviews(reviews);
    }, [reviews]);



    const handleLanguageChange = async (langName: string) => {
        setTargetLanguage(langName);

        setIsTranslating(true);
        try {
            const translated = await translateReviewsBatch(reviews, langName);
            setTranslatedReviews(translated);
        } catch (error) {
            console.error("Translation error:", error);
        } finally {
            setIsTranslating(false);
        }
    };

    const dateFilteredReviews = useMemo(() => {
        const sourceReviews = translatedReviews;
        // Use the latest review date as our effective "now" if reviews exist,
        // otherwise fallback to the actual current date.
        let referenceDate = new Date();
        if (sourceReviews.length > 0) {
            const dates = sourceReviews
                .map(r => parseRobustDate(r.reviewDate))
                .filter((d): d is Date => d !== null);
            if (dates.length > 0) {
                referenceDate = new Date(Math.max(...dates.map(d => d.getTime())));
            }
        }

        const now = referenceDate;
        let start: Date;
        let end = endOfDay(now);

        switch (dateFilter) {
            case '1d':
                start = startOfDay(now);
                break;
            case '7d':
                start = startOfDay(subDays(now, 7));
                break;
            case '30d':
                start = startOfDay(subDays(now, 30));
                break;
            case 'custom':
                if (!customRange.start || !customRange.end) return sourceReviews;
                start = startOfDay(new Date(customRange.start));
                end = endOfDay(new Date(customRange.end));
                break;
            default: return sourceReviews;
        }

        return sourceReviews.filter(r => {
            const reviewDate = parseRobustDate(r.reviewDate);
            if (!reviewDate) return false;
            return isWithinInterval(reviewDate, { start, end });
        });
    }, [translatedReviews, dateFilter, customRange]);

    const filteredByDateReviews = useMemo(() => {
        return dateFilteredReviews.filter(r => {
            const matchesSearch = searchTerm === '' ||
                (r.reviewTitle?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (r.translatedTitle?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (r.positiveReview?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (r.translatedPositive?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (r.negativeReview?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (r.translatedNegative?.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (r.roomName?.toLowerCase().includes(searchTerm.toLowerCase()));

            const matchesHostel = hostelFilter === 'all' ||
                matchesPropertyName(r, hostelFilter);

            const matchesPlatform = platformFilter === 'all' ||
                ((r.platform || 'Booking').toLowerCase() === platformFilter.toLowerCase());

            return matchesSearch && matchesHostel && matchesPlatform;
        });
    }, [dateFilteredReviews, searchTerm, hostelFilter, platformFilter]);

    const averages = useMemo(() => calculateAverages(filteredByDateReviews), [filteredByDateReviews]);

    const handleAiInsights = async () => {
        setIsGenerating(true);
        const insights = await generateInsights(filteredByDateReviews, targetLanguage);
        setAiInsights(insights);
        setIsGenerating(false);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const isXLS = /\.(xls|xlsx)$/i.test(file.name);

        if (isXLS) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const buffer = event.target?.result as ArrayBuffer;
                onUpload(buffer);
            };
            reader.readAsArrayBuffer(file);
        } else {
            const reader = new FileReader();
            reader.onload = (event) => {
                let text = event.target?.result as string;

                // Best-effort mojibake recovery: only attempt when the file shows
                // multiple UTF-8-as-Latin-1 markers AND every codepoint fits in a byte
                // (otherwise the re-decode pass corrupts already-correct text).
                const mojibakeMarkers = (text.match(/Ã[¡-¿]|Â[\xA0-\xBF]/g) || []).length;
                if (mojibakeMarkers >= 1) {
                    const allLatin1 = text.split('').every(c => c.charCodeAt(0) <= 0xFF);
                    if (allLatin1) {
                        try {
                            const bytes = new Uint8Array(text.split('').map(c => c.charCodeAt(0)));
                            const recovered = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
                            const recoveredMarkers = (recovered.match(/Ã[¡-¿]|Â[\xA0-\xBF]/g) || []).length;
                            if (recoveredMarkers < mojibakeMarkers) {
                                text = recovered;
                            }
                        } catch (err) {
                            console.warn("Encoding recovery failed:", err);
                        }
                    }
                }

                onUpload(text);
            };
            reader.readAsText(file, 'UTF-8');
        }
    };

    const dataQuality = useMemo(() => {
        const total = reviews.length;
        let invalidDate = 0;
        let missingScore = 0;
        for (const r of reviews) {
            if (!parseRobustDate(r.reviewDate)) invalidDate++;
            if (!(r.reviewScore > 0)) missingScore++;
        }
        return { total, invalidDate, missingScore };
    }, [reviews]);

    const hasData = filteredByDateReviews.length > 0;

    const renderReport = () => {
        if (!hasData) return (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-12 text-center">
                <Calendar className="w-12 h-12 text-amber-400 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-amber-900">No reviews found for this period</h3>
                <p className="text-amber-700 mt-2">Try selecting a different date range or upload a new CSV file.</p>
                <button
                    onClick={() => {
                        setDateFilter('custom');
                        setCustomRange({ start: '', end: '' });
                    }}
                    className="mt-6 px-6 py-2 bg-indigo font-bold text-white rounded-xl hover:bg-purple transition-all"
                >
                    Clear Date Filter
                </button>
            </div>
        );

        switch (activeReport) {
            case 'overall': return <OverallSatisfactionReport reviews={filteredByDateReviews} averages={averages!} setActiveReport={setActiveReport} targetLanguage={targetLanguage} dateFilter={dateFilter} />;
            case 'department': return <DepartmentPerformanceReport averages={averages!} />;
            case 'monthly_trend': return <PerformanceTrendReport reviews={filteredByDateReviews} dateFilter={dateFilter} />;
            case 'negative': return <NegativeExperienceReport reviews={filteredByDateReviews} targetLanguage={targetLanguage} />;
            case 'value': return <ValueForMoneyReport reviews={filteredByDateReviews} averages={averages!} />;
            case 'facilities': return <FacilitiesImprovementReport reviews={filteredByDateReviews} />;
            case 'staff_impact': return <StaffPerformanceImpactReport reviews={filteredByDateReviews} />;
            case 'sentiment': return <ReviewSentimentReport reviews={filteredByDateReviews} />;
            case 'scorecard': return <GuestExperienceScorecard averages={averages!} />;
            case 'platform': return <BookingPlatformReport reviews={filteredByDateReviews} />;
            case 'room_performance': return <RoomPerformanceReport reviews={filteredByDateReviews} />;
            case 'hostel_comparison': return <HostelComparisonReport reviews={dateFilteredReviews} />;
            case 'data_grid': return <ReviewDataGrid reviews={filteredByDateReviews} />;
            default: return null;
        }
    };

    return (
        <div className="flex min-h-screen bg-[var(--bg-main)] nebula-bg transition-colors duration-500">
            {/* Mobile Sidebar Overlay */}
            <AnimatePresence>
                {isSidebarOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setIsSidebarOpen(false)}
                        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
                    />
                )}
            </AnimatePresence>

            {/* Sidebar */}
            {persona !== 'guest' && (
                <aside className={cn(
                    "w-72 premium-glass border-r border-[var(--border-color)] flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
                    isSidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
                )}>
                    <div className="p-8 flex items-center justify-between">
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center gap-3"
                        >
                            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center text-white font-black text-2xl italic shadow-xl shadow-indigo-500/20">H</div>
                            <div className="flex flex-col">
                                <span className="font-extrabold text-[var(--text-primary)] tracking-tight leading-none text-lg">Hostel</span>
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 mt-0.5">Analyzer</span>
                            </div>
                        </motion.div>
                        <button
                            onClick={() => setIsSidebarOpen(false)}
                            className="lg:hidden p-2 text-[var(--text-secondary)] hover:text-indigo-600 hover:bg-slate-50 rounded-xl transition-all"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="px-4 mb-4 flex-1 overflow-y-auto">
                        <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--text-secondary)] px-4 mb-3">Reports</div>
                        <nav className="space-y-1">
                            {[
                                { id: 'overall', icon: <LayoutDashboard className="w-4 h-4" />, label: "Executive Summary" },
                                { id: 'department', icon: <Users className="w-4 h-4" />, label: "Department Performance" },
                                { id: 'negative', icon: <AlertCircle className="w-4 h-4" />, label: "Critical Issues" },
                                { id: 'monthly_trend', icon: <TrendingUp className="w-4 h-4" />, label: "Trends & Volume" },
                                { id: 'sentiment', icon: <MessageSquare className="w-4 h-4" />, label: "Guest Voice" },
                                { id: 'room_performance', icon: <Home className="w-4 h-4" />, label: "Room Performance" },
                                { id: 'hostel_comparison', icon: <ArrowRightLeft className="w-4 h-4" />, label: "Property Comparison" },
                                { id: 'data_grid', icon: <Table className="w-4 h-4" />, label: "Raw Data Explorer" },
                            ].map((item, idx) => (
                                <SidebarItem
                                    key={item.id}
                                    active={activeReport === item.id}
                                    onClick={() => {
                                        setActiveReport(item.id as ReportType);
                                        if (window.innerWidth < 1024) setIsSidebarOpen(false);
                                    }}
                                    icon={item.icon}
                                    label={item.label}
                                    index={idx}
                                />
                            ))}
                        </nav>
                    </div>

                    <div className="p-6 border-t border-slate-100 bg-slate-50/30 space-y-3">
                        <motion.button
                            whileHover={{ scale: 1.02, backgroundColor: '#a855f7' }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleAiInsights}
                            disabled={isGenerating}
                            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo to-purple text-white rounded-2xl font-bold transition-all shadow-lg shadow-indigo/20 disabled:opacity-50 active:scale-95"
                        >
                            <Brain className={cn("w-4 h-4", isGenerating && "animate-pulse")} />
                            <span className="text-sm">{isGenerating ? "Analyzing..." : "AI Insights"}</span>
                        </motion.button>
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={onRepairTranslations}
                            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-indigo-50 text-indigo-700 rounded-2xl font-bold hover:bg-indigo-100 transition-all active:scale-95 border border-indigo-200"
                        >
                            <RefreshCw className="w-4 h-4" />
                            <span className="text-sm">Repair Translations</span>
                        </motion.button>
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={onClear}
                            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-slate-100 text-slate-800 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95"
                        >
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-sm">Clear Data</span>
                        </motion.button>
                    </div>
                </aside>
            )}

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto">
                {/* Top Navigation Bar */}
                <header className="sticky top-0 premium-glass border-b border-[var(--border-color)] h-20 z-30 flex items-center justify-between px-4 lg:px-12 gap-4">
                    <div className="flex items-center gap-4 lg:hidden">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="p-2.5 text-[var(--text-secondary)] hover:text-indigo hover:bg-indigo/5 rounded-xl transition-all"
                        >
                            <Menu className="w-6 h-6" />
                        </button>
                        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black italic">H</div>
                    </div>

                    <div className="flex items-center gap-4 lg:gap-6 flex-1 max-w-2xl">
                        <div className="relative flex-1 group">
                            <Search className="absolute left-3 lg:left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] group-focus-within:text-indigo-600 transition-colors" />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-100/50 border-none rounded-2xl py-2 lg:py-2.5 pl-10 lg:pl-11 pr-4 text-sm font-medium focus:bg-[var(--card-bg)] focus:ring-2 focus:ring-brand-100 transition-all outline-none"
                            />
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setIsComparisonMode(!isComparisonMode)}
                            className={cn(
                                "hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all whitespace-nowrap",
                                isComparisonMode
                                    ? "bg-indigo/5 text-indigo-600 ring-2 ring-brand-100"
                                    : "bg-slate-100 text-[var(--text-secondary)] hover:bg-slate-200"
                            )}
                        >
                            <ArrowRightLeft className="w-4 h-4" />
                            {isComparisonMode ? "Comparing: ON" : "Compare"}
                        </motion.button>
                    </div>

                    <div className="flex items-center gap-2 lg:gap-4">
                        <div className="hidden sm:flex bg-slate-100/50 dark:bg-slate-900/50 p-1 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 backdrop-blur-md">
                            {[
                                { id: 'admin', icon: <ShieldCheck className="w-3.5 h-3.5" />, label: 'Admin', color: 'from-indigo-600 to-indigo-800' },
                                { id: 'staff', icon: <Briefcase className="w-3.5 h-3.5" />, label: 'Staff', color: 'from-emerald-600 to-emerald-800' },
                                { id: 'guest', icon: <UserCircle className="w-3.5 h-3.5" />, label: 'Guest', color: 'from-purple-600 to-purple-800' },
                            ].map((p) => (
                                <motion.button
                                    key={p.id}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setPersona(p.id as Persona)}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all",
                                        persona === p.id
                                            ? "bg-gradient-to-br text-white shadow-lg " + p.color
                                            : "text-[var(--text-secondary)] hover:bg-slate-200/50 dark:hover:bg-slate-800/50"
                                    )}
                                >
                                    {p.icon}
                                    <span className="hidden lg:inline">{p.label}</span>
                                </motion.button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2 lg:gap-3 bg-slate-100/50 rounded-2xl px-3 lg:px-4 py-2 lg:py-2.5">
                            <Languages className={cn("w-4 h-4", isTranslating ? "text-indigo-600 animate-pulse" : "text-[var(--text-secondary)]")} />
                            <select
                                value={targetLanguage}
                                onChange={(e) => handleLanguageChange(e.target.value)}
                                disabled={isTranslating}
                                className="text-xs font-bold text-slate-700 bg-transparent border-none focus:ring-0 cursor-pointer outline-none disabled:opacity-50 uppercase tracking-wider"
                            >
                                {LANGUAGES.map(lang => (
                                    <option key={lang.code} value={lang.name}>{lang.name}</option>
                                ))}
                            </select>
                        </div>
                        <motion.div
                            whileHover={{ scale: 1.1, rotate: 180 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={toggleDarkMode}
                            className="flex w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 items-center justify-center text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                            {isDarkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-[var(--text-secondary)]" />}
                        </motion.div>
                        <motion.div
                            whileHover={{ rotate: 90 }}
                            className="hidden sm:flex w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 items-center justify-center text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                            <Settings className="w-5 h-5" />
                        </motion.div>
                    </div>
                </header>

                <div className="max-w-[1440px] mx-auto p-4 md:p-8 lg:p-10 space-y-8 lg:space-y-12">
                    {/* Global Filter Bar */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 p-6 md:p-8 bg-[var(--card-bg)] rounded-[32px] border border-[var(--border-color)] shadow-sm"
                    >
                        <div className="flex flex-wrap items-center gap-4 lg:gap-8">
                            <div className="space-y-2">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-secondary)]">Property Segment</span>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => setHostelFilter('all')}
                                        className={cn(
                                            "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border shadow-sm flex items-center gap-2",
                                            hostelFilter === 'all'
                                                ? "bg-purple-600 border-purple-600 text-white shadow-lg"
                                                : "bg-white text-[var(--text-secondary)] border-slate-200 hover:border-purple-400"
                                        )}
                                    >
                                        <Building2 className="w-3 h-3" />
                                        All
                                    </button>
                                    {Array.from(new Set(reviews.map(r => {
                                        const known = PROPERTY_NAMES;
                                        const found = known.find(k =>
                                            matchesPropertyName(r, k)
                                        );
                                        return found;
                                    }).filter(Boolean))).map(name => (
                                        <button
                                            key={name as string}
                                            onClick={() => setHostelFilter(name as string)}
                                            className={cn(
                                                "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border shadow-sm",
                                                hostelFilter === name
                                                    ? "bg-purple-600 border-purple-600 text-white shadow-lg"
                                                    : "bg-white text-[var(--text-secondary)] border-slate-200 hover:border-purple-400"
                                            )}
                                        >
                                            {name as string}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="h-10 w-px bg-slate-100 hidden lg:block" />

                            <div className="space-y-2">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-secondary)]">Platform</span>
                                <div className="flex flex-wrap gap-2">
                                    {(['all', 'Booking', 'Agoda', 'PMS'] as const).map(p => {
                                        const isActive = platformFilter === p;
                                        const label = p === 'all' ? 'All' : p;
                                        // Hide a platform button if no reviews from that platform exist
                                        const hasAny = p === 'all' || reviews.some(r => (r.platform || 'Booking') === p);
                                        if (!hasAny) return null;
                                        return (
                                            <button
                                                key={p}
                                                onClick={() => setPlatformFilter(p)}
                                                className={cn(
                                                    "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border shadow-sm",
                                                    isActive
                                                        ? "bg-teal-600 border-teal-600 text-white shadow-lg"
                                                        : "bg-white text-[var(--text-secondary)] border-slate-200 hover:border-teal-400"
                                                )}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="h-10 w-px bg-slate-100 hidden lg:block" />

                            <div className="space-y-2">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-secondary)]" title="Filters are anchored to the most recent review in your data, not today's date.">Time Period <span className="opacity-60">(relative to data)</span></span>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { id: 'custom', label: 'Custom' },
                                        { id: '1d', label: 'Latest 24h' },
                                        { id: '7d', label: 'Latest 7d' },
                                        { id: '30d', label: 'Latest 30d' },
                                    ].map(f => (
                                        <button
                                            key={f.id}
                                            onClick={() => setDateFilter(f.id)}
                                            className={cn(
                                                "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border shadow-sm",
                                                dateFilter === f.id
                                                    ? "bg-indigo-600 border-indigo-600 text-white shadow-lg"
                                                    : "bg-white text-[var(--text-secondary)] border-slate-200 hover:border-indigo-400"
                                            )}
                                        >
                                            {f.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <AnimatePresence>
                                {dateFilter === 'custom' && (
                                    <motion.div
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-100"
                                    >
                                        <input
                                            type="date"
                                            value={customRange.start}
                                            onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })}
                                            className="px-3 py-2 text-xs font-bold bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-100"
                                        />
                                        <span className="text-[10px] font-black text-slate-400 uppercase">to</span>
                                        <input
                                            type="date"
                                            value={customRange.end}
                                            onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })}
                                            className="px-3 py-2 text-xs font-bold bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-100"
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            <div className="flex items-center justify-end gap-3 pr-2">
                                <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">
                                    {filteredByDateReviews.length} Results
                                </span>
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            </div>
                        </div>
                    </motion.div>

                    {persona === 'admin' ? (
                        <>
                            {/* Summary Bar */}
                            <motion.div
                                initial={{ opacity: 0, y: -20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="grid grid-cols-2 md:grid-cols-4 gap-4"
                            >
                                {[
                                    { label: 'Overall', value: averages?.overall || '0.0', color: 'text-indigo-600' },
                                    { label: 'Reviews', value: filteredByDateReviews.length, color: 'text-[var(--text-primary)]' },
                                    { label: 'Staff', value: averages?.staff || '0.0', color: 'text-emerald-600' },
                                    { label: 'Clean', value: averages?.cleanliness || '0.0', color: 'text-indigo-600' },
                                ].map((stat, i) => (
                                    <div key={i} className="bg-[var(--card-bg)] px-5 py-3 rounded-2xl border border-[var(--border-color)] shadow-sm flex items-center justify-between">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)]">{stat.label}</span>
                                        <span className={cn("text-lg font-black tabular-nums", stat.color)}>{stat.value}</span>
                                    </div>
                                ))}
                            </motion.div>

                            {/* Header */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex flex-col lg:flex-row lg:items-end justify-between gap-8"
                            >
                                <div>
                                    <div className="flex items-center gap-2.5 mb-3">
                                        <div className="w-2 h-2 rounded-full bg-indigo/50 animate-pulse" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-600">Live Analytics</span>
                                    </div>
                                    <h1 className="text-2xl md:text-4xl font-black text-[var(--text-primary)] tracking-tight font-display">
                                        {getReportTitle(activeReport)}
                                    </h1>
                                    <p className="text-slate-800 mt-4 font-medium text-base md:text-lg flex flex-wrap items-center gap-2">
                                        Analyzing <span className="text-[var(--text-primary)] font-bold px-2 py-0.5 bg-indigo/5 rounded-lg">{filteredByDateReviews.length}</span> verified reviews from
                                        <span className="text-indigo-600 font-bold">{format(parseRobustDate(filteredByDateReviews[filteredByDateReviews.length - 1]?.reviewDate) || new Date(), 'MMM dd, yyyy')}</span> to
                                        <span className="text-indigo-600 font-bold">{format(parseRobustDate(filteredByDateReviews[0]?.reviewDate) || new Date(), 'MMM dd, yyyy')}</span>
                                        {searchTerm && <span className="text-[var(--text-secondary)] text-sm italic">matching "{searchTerm}"</span>}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-4 lg:gap-6">
                                    <motion.label
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        className="flex items-center gap-2 px-5 py-2 bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-slate-800 dark:to-slate-700 border border-indigo-200/50 dark:border-slate-600/50 rounded-xl cursor-pointer hover:shadow-lg transition-all shadow-sm"
                                    >
                                        <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                        <span className="text-xs font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300">New Data</span>
                                        <input type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={handleFileChange} />
                                    </motion.label>
                                </div>
                            </motion.div>

                            {/* Quick Actions Bar */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                                <QuickActionCard
                                    icon={<Sparkles className="w-5 h-5 text-amber-500" />}
                                    label="AI Analysis"
                                    onClick={handleAiInsights}
                                    loading={isGenerating}
                                    index={0}
                                />
                                <QuickActionCard
                                    icon={<TrendingUp className="w-5 h-5 text-indigo-500" />}
                                    label="Trend Overview"
                                    onClick={() => setActiveReport('monthly_trend')}
                                    index={1}
                                />
                                <QuickActionCard
                                    icon={<Filter className="w-5 h-5 text-purple-500" />}
                                    label="Critical Filter"
                                    onClick={() => setSearchTerm('negative')}
                                    index={2}
                                />
                                <QuickActionCard
                                    icon={<Download className="w-5 h-5 text-slate-800 dark:text-slate-200" />}
                                    label="Export PDF"
                                    onClick={() => window.print()}
                                    index={3}
                                />
                            </div>

                            <AnimatePresence mode="wait">
                                {aiInsights && (
                                    <motion.div
                                        key="ai-insights"
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className="bg-gradient-to-br from-indigo-900 via-purple-900 to-navy text-brand-50 p-8 md:p-10 rounded-[32px] shadow-2xl shadow-indigo-500/20 overflow-hidden relative border border-white/10"
                                    >
                                        <div className="absolute -right-4 -top-4 p-4 opacity-10">
                                            <Brain className="w-48 h-48" />
                                        </div>
                                        <div className="flex items-center gap-4 mb-8">
                                            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/20">
                                                <Sparkles className="w-6 h-6 text-cyan-400" />
                                            </div>
                                            <div>
                                                <h2 className="text-xl font-black tracking-tight font-display">Elite AI Management Insights</h2>
                                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300">Generative Synthesis v4.0</span>
                                            </div>
                                        </div>
                                        <div className="prose prose-invert prose-lg max-w-none">
                                            <div className="whitespace-pre-wrap text-indigo-100/90 leading-relaxed font-medium">
                                                {aiInsights}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={activeReport}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ duration: 0.3 }}
                                >
                                    {filteredByDateReviews.length > 0 && filteredByDateReviews.length < 20 && (
                                        <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50/70 px-5 py-4 flex items-start gap-3">
                                            <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                                            <div className="text-[12px] leading-relaxed text-orange-900">
                                                <p className="font-bold tracking-wide uppercase text-[10px] text-orange-700 mb-1">Low sample size</p>
                                                <p>Only {filteredByDateReviews.length} review{filteredByDateReviews.length === 1 ? '' : 's'} match the current filters. Averages and themes drawn from fewer than 20 reviews are not statistically reliable -- treat the numbers as directional, not authoritative.</p>
                                            </div>
                                        </div>
                                    )}
                                    {aiKeyMissing && (
                                        <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50/80 px-5 py-4 flex items-start gap-3">
                                            <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                            <div className="text-[12px] leading-relaxed text-blue-900">
                                                <p className="font-bold tracking-wide uppercase text-[10px] text-blue-700 mb-1">AI features disabled</p>
                                                <p>No Gemini API key is configured, so translation, sentiment analysis, and AI insights will fail silently. Set GEMINI_API_KEY in your .env, then run <code className="font-mono bg-blue-100 px-1 rounded">npm run deploy</code> to enable.</p>
                                            </div>
                                        </div>
                                    )}
                                    {cloudSyncError && (
                                        <div className="mb-4 rounded-2xl border border-purple-200 bg-purple-50/80 px-5 py-4 flex items-start gap-3">
                                            <RefreshCw className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                                            <div className="text-[12px] leading-relaxed text-purple-900">
                                                <p className="font-bold tracking-wide uppercase text-[10px] text-purple-700 mb-1">Cloud sync disabled</p>
                                                <p>Your data is saved in this browser but Firestore rejected the cloud write ({cloudSyncError}). Run <code className="font-mono bg-purple-100 px-1 rounded">npx firebase deploy --only firestore</code> to push the latest rules and re-enable cloud sync.</p>
                                            </div>
                                        </div>
                                    )}
                                    {(dataQuality.invalidDate > 0 || dataQuality.missingScore > 0) && (
                                        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4 flex items-start gap-3">
                                            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                            <div className="text-[12px] leading-relaxed text-amber-900">
                                                <p className="font-bold tracking-wide uppercase text-[10px] text-amber-700 mb-1">Data quality</p>
                                                {dataQuality.invalidDate > 0 && (
                                                    <p>{dataQuality.invalidDate} of {dataQuality.total} rows have unparseable dates and are excluded from time-based reports.</p>
                                                )}
                                                {dataQuality.missingScore > 0 && (
                                                    <p>{dataQuality.missingScore} of {dataQuality.total} rows have no overall score; they are excluded from score averages but still counted in totals.</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {renderReport()}
                                </motion.div>
                            </AnimatePresence>
                        </>
                    ) : (
                        <AnimatePresence mode="wait">
                            {persona === 'staff' ? (
                                <StaffView reviews={filteredByDateReviews} averages={averages} />
                            ) : (
                                <GuestView reviews={filteredByDateReviews} averages={averages} />
                            )}
                        </AnimatePresence>
                    )}
                </div>
            </main>
        {/* Upload toast notification */}
    <AnimatePresence>
      {uploadToast && (
        <motion.div
          key="upload-toast"
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl border text-sm font-medium"
          style={{
            backgroundColor: uploadToast.type === 'success' ? '#f0fdf4' : '#fefce8',
            borderColor: uploadToast.type === 'success' ? '#bbf7d0' : '#fde68a',
            color: uploadToast.type === 'success' ? '#166534' : '#92400e',
          }}
        >
          {uploadToast.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#16a34a' }} />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#d97706' }} />
          }
          <span>{uploadToast.message}</span>
          <button onClick={onDismissToast} className="ml-2 opacity-50 hover:opacity-100 transition-opacity">
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
    );
};

const SidebarItem = ({ active, onClick, icon, label, index }: any) => (
    <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.05 }}
        whileHover={{ x: 4 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className={cn(
            "sidebar-item group relative overflow-hidden w-full",
            active
                ? "bg-gradient-to-r from-indigo to-purple text-white shadow-lg shadow-indigo/20"
                : "text-slate-800 hover:bg-slate-50 hover:text-indigo"
        )}
    >
        <div className={cn(
            "transition-transform duration-300 group-hover:scale-110",
            active ? "text-white" : "text-[var(--text-secondary)] group-hover:text-indigo"
        )}>
            {icon}
        </div>
        <span className="relative z-10">{label}</span>
        {active && (
            <motion.div
                layoutId="active-sidebar-indicator"
                className="absolute right-0 top-0 bottom-0 w-1 bg-[var(--card-bg)]/20"
            />
        )}
    </motion.button>
);

const QuickActionCard = ({ icon, label, onClick, loading, index }: any) => (
    <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 + index * 0.1 }}
        whileHover={{ y: -4, shadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)" }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        disabled={loading}
        className="glass-card p-6 flex items-center gap-4 group active:scale-95 w-full"
    >
        <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-[var(--card-bg)] transition-colors">
            {loading ? <Loader2 className="w-5 h-5 animate-spin text-indigo-600" /> : icon}
        </div>
        <div className="text-left">
            <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Action</p>
            <p className="text-sm font-black text-[var(--text-primary)]">{label}</p>
        </div>
    </motion.button>
);

const getReportTitle = (type: ReportType) => {
    const titles: Record<ReportType, string> = {
        overall: 'Overall Guest Satisfaction',
        department: 'Department Performance',
        monthly_trend: 'Performance Trend Analysis',
        negative: 'Negative Experience Report',
        value: 'Value for Money Perception',
        facilities: 'Facilities Improvement Focus',
        staff_impact: 'Staff Performance Impact',
        sentiment: 'Review Sentiment Analysis',
        scorecard: 'Guest Experience Scorecard',
        platform: 'Booking Platform Performance',
        room_performance: 'Room Performance Analysis',
        hostel_comparison: 'Properties Comparison Dashboard',
        data_grid: 'Raw Data Explorer'
    };
    return titles[type];
};

// --- Report Components ---

const RoomPerformanceReport = ({ reviews }: { reviews: BookingReview[] }) => {
    const { roomStats, groupingMode } = useMemo(() => {
        // Build a smart grouping key:
        //  * If both a property and a real room name exist -> "Property / Room"
        //  * If only a property is detected (CSV has no room column) -> property name
        //  * If only a room name exists (PMS-style data) -> the room name
        //  * Otherwise -> "General"
        // This means uploads from sources without per-room data still slice
        // meaningfully by property instead of collapsing to a single "General" row.
        const groups: Record<string, BookingReview[]> = {};
        let sawRealRoom = false;
        let sawProperty = false;

        for (const r of reviews) {
            const property = resolvePropertyForReview(r);
            const rawRoom = (r.roomName || '').trim();
            const isRealRoom = rawRoom && rawRoom.toLowerCase() !== 'general';
            if (isRealRoom) sawRealRoom = true;
            if (property) sawProperty = true;

            let key: string;
            if (property && isRealRoom) key = `${property} / ${rawRoom}`;
            else if (property) key = property;
            else if (isRealRoom) key = rawRoom;
            else key = 'General';

            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
        }

        const stats = Object.entries(groups)
            .map(([room, roomReviews]) => {
                const a = calculateAverages(roomReviews);
                return {
                    room,
                    avg: a?.overall || 0,
                    staff: a?.staff || 0,
                    clean: a?.cleanliness || 0,
                    count: roomReviews.length,
                };
            })
            .filter(r => r.count > 0)
            .sort((a, b) => b.avg - a.avg);

        // Describe what we are grouping by so the UI can label honestly.
        let mode: 'room' | 'property-and-room' | 'property' | 'none' = 'none';
        if (sawRealRoom && sawProperty) mode = 'property-and-room';
        else if (sawRealRoom) mode = 'room';
        else if (sawProperty) mode = 'property';

        return { roomStats: stats, groupingMode: mode };
    }, [reviews]);

    if (roomStats.length === 0) {
        return (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-12 text-center">
                <Home className="w-12 h-12 text-amber-400 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-amber-900">No room-level data available</h3>
                <p className="text-amber-700 mt-2 text-sm leading-relaxed">
                    The reviews loaded don't include a Rental Name / Room column, and no property names were detected in the review text.
                    Upload a PMS export with per-room data, or ensure your reviews mention a known property name.
                </p>
            </div>
        );
    }
    if (roomStats.length === 1 && roomStats[0].room === 'General') {
        return (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-12 text-center">
                <Home className="w-12 h-12 text-amber-400 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-amber-900">All reviews share the same room</h3>
                <p className="text-amber-700 mt-2 text-sm leading-relaxed">
                    {roomStats[0].count} reviews are tagged "General" because the source CSVs don't have a per-room column.
                    Per-room analysis needs PMS-style data with a Rental Name field, or uploads where the property name
                    is mentioned in the review text. Configure PROPERTY_NAMES in src/constants.ts to match your real properties.
                </p>
            </div>
        );
    }

    const groupLabel = groupingMode === 'room' ? 'Room / Rental'
        : groupingMode === 'property' ? 'Property'
        : 'Property / Room';

    return (
        <div className="space-y-8">
            <div className="bg-[var(--card-bg)] rounded-2xl border border-slate-200 shadow-sm overflow-hidden overflow-x-auto">
                <table className="w-full text-left min-w-[700px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4 text-xs font-bold text-slate-800 uppercase tracking-wider">{groupLabel}</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-800 uppercase tracking-wider">Avg Score</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-800 uppercase tracking-wider">Staff</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-800 uppercase tracking-wider">Cleanliness</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-800 uppercase tracking-wider text-right">Reviews</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {roomStats.map((room) => (
                            <tr key={room.room} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 font-bold text-[var(--text-primary)]">{room.room}</td>
                                <td className="px-6 py-4">
                                    <span className={cn(
                                        "text-lg font-black",
                                        room.avg >= 9.0 ? "text-emerald-600" : room.avg >= 7.5 ? "text-amber-600" : "text-rose-600"
                                    )}>
                                        {room.avg}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm font-semibold text-[var(--text-secondary)]">{room.staff}</td>
                                <td className="px-6 py-4 text-sm font-semibold text-[var(--text-secondary)]">{room.clean}</td>
                                <td className="px-6 py-4 text-[var(--text-secondary)] font-medium text-right">{room.count}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
                    <h4 className="font-bold text-indigo-900 mb-2 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Top Performing Rooms
                    </h4>
                    <p className="text-sm text-indigo-800">
                        Rooms {roomStats.slice(0, 3).map(r => r.room).join(', ')} are currently leading in guest satisfaction.
                    </p>
                </div>
                <div className="bg-rose-50 p-6 rounded-2xl border border-rose-100">
                    <h4 className="font-bold text-rose-900 mb-2 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Rooms Needing Attention
                    </h4>
                    <p className="text-sm text-rose-800">
                        Rooms {roomStats.slice(-3).reverse().map(r => r.room).join(', ')} have the lowest average scores.
                    </p>
                </div>
            </div>
        </div>
    );
};

const StaffView = ({ reviews, averages }: { reviews: BookingReview[], averages: any }) => {
    const recentNegatives = reviews.filter(r => r.reviewScore <= 6 && isValidFeedback(r.negativeReview)).slice(0, 3);
    const recentPositives = reviews.filter(r => r.reviewScore >= 9 && isValidFeedback(r.positiveReview)).slice(0, 3);

    return (
        <div className="space-y-12">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-rose-50 rounded-[32px] md:rounded-[40px] p-6 md:p-10 border border-rose-100"
                >
                    <div className="flex items-center gap-4 mb-6 md:mb-8">
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-200">
                            <AlertTriangle className="w-5 h-5 md:w-6 md:h-6" />
                        </div>
                        <div>
                            <h3 className="text-xl md:text-2xl font-black text-rose-900 tracking-tight">Immediate Attention</h3>
                            <p className="text-rose-600 font-bold text-[10px] uppercase tracking-widest">Fix these issues today</p>
                        </div>
                    </div>
                    <ul className="space-y-4">
                        {recentNegatives.length > 0 ? recentNegatives.map((r, i) => (
                            <motion.li
                                key={i}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="flex gap-4 p-5 rounded-3xl bg-white/60 border border-rose-200/50"
                            >
                                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-bold text-xs shrink-0 mt-0.5">
                                    {r.reviewScore}
                                </div>
                                <div>
                                    <p className="text-rose-900 font-bold text-[10px] uppercase tracking-widest mb-1.5">{r.roomName}</p>
                                    <p className="text-rose-700 text-sm italic leading-relaxed">"{r.translatedNegative || r.negativeReview}"</p>
                                </div>
                            </motion.li>
                        )) : (
                            <div className="text-center py-12">
                                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                                <p className="text-rose-900 font-bold">No critical issues reported recently!</p>
                            </div>
                        )}
                    </ul>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-emerald-50 rounded-[32px] md:rounded-[40px] p-6 md:p-10 border border-emerald-100"
                >
                    <div className="flex items-center gap-4 mb-6 md:mb-8">
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-200">
                            <Heart className="w-5 h-5 md:w-6 md:h-6" />
                        </div>
                        <div>
                            <h3 className="text-xl md:text-2xl font-black text-emerald-900 tracking-tight">Staff Celebrations</h3>
                            <p className="text-emerald-600 font-bold text-[10px] uppercase tracking-widest">What guests loved</p>
                        </div>
                    </div>
                    <ul className="space-y-4">
                        {recentPositives.length > 0 ? recentPositives.map((r, i) => (
                            <motion.li
                                key={i}
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="flex gap-4 p-5 rounded-3xl bg-white/60 border border-emerald-200/50"
                            >
                                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-xs shrink-0 mt-0.5">
                                    {r.reviewScore}
                                </div>
                                <div>
                                    <p className="text-emerald-900 font-bold text-[10px] uppercase tracking-widest mb-1.5">{r.roomName}</p>
                                    <p className="text-emerald-700 text-sm italic leading-relaxed">"{r.translatedPositive || r.positiveReview}"</p>
                                </div>
                            </motion.li>
                        )) : (
                            <div className="text-center py-12">
                                <Smile className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                                <p className="text-emerald-900 font-bold">Waiting for some positive vibes!</p>
                            </div>
                        )}
                    </ul>
                </motion.div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                    { label: 'Staff Service', val: averages.staff, icon: <Users className="w-5 h-5" />, color: 'bg-emerald-500' },
                    { label: 'Cleanliness', val: averages.cleanliness, icon: <Droplets className="w-5 h-5" />, color: 'bg-indigo-500' },
                    { label: 'Facilities', val: averages.facilities, icon: <Wrench className="w-5 h-5" />, color: 'bg-amber-500' },
                ].map((stat, i) => (
                    <div key={i} className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-slate-200 shadow-sm flex items-center gap-6">
                        <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg", stat.color)}>
                            {stat.icon}
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{stat.label}</p>
                            <p className="text-3xl font-black text-[var(--text-primary)]">{stat.val}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const GuestView = ({ reviews, averages }: { reviews: BookingReview[], averages: any }) => {
    const topPraise = extractKeywords(reviews, 'positive').slice(0, 5);

    return (
        <div className="space-y-8 md:space-y-16 py-6 md:py-12">
            <div className="text-center max-w-2xl mx-auto px-4">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo/5 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-widest mb-4 md:mb-6">
                    <Sparkles className="w-3 h-3" />
                    Verified Guest Experience
                </div>
                <h2 className="text-4xl md:text-6xl font-black text-[var(--text-primary)] tracking-tight mb-4 md:mb-6">Why Stay With Us?</h2>
                <p className="text-slate-800 text-lg md:text-xl font-medium">Real feedback from thousands of travelers like you.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
                <div className="md:col-span-1 flex flex-col items-center justify-center bg-[var(--card-bg)] rounded-[40px] md:rounded-[60px] p-8 md:p-16 border border-slate-200 shadow-xl shadow-slate-100 text-center">
                    <div className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.3em] mb-4">Overall Score</div>
                    <div className="text-7xl md:text-9xl font-black text-indigo-600 tracking-tighter mb-4">{averages.overall}</div>
                    <div className="flex gap-1 mb-6 md:mb-8">
                        {[1, 2, 3, 4, 5].map(i => (
                            <Star key={i} className={cn("w-5 h-5 md:w-6 md:h-6", i <= Math.round(averages.overall / 2) ? "fill-amber-400 text-amber-400" : "text-slate-200")} />
                        ))}
                    </div>
                    <p className="text-slate-800 font-bold uppercase tracking-widest text-[10px] md:text-xs">Based on {reviews.length} reviews</p>
                </div>

                <div className="md:col-span-2 space-y-12">
                    <div>
                        <h3 className="text-3xl font-black text-[var(--text-primary)] tracking-tight mb-8">What Guests Love Most</h3>
                        <div className="flex flex-wrap gap-4">
                            {topPraise.map((p, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: i * 0.1 }}
                                    className="px-8 py-4 bg-emerald-50 text-emerald-700 rounded-3xl border border-emerald-100 font-black text-lg uppercase tracking-tight flex items-center gap-3"
                                >
                                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                    {p.word}
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-slate-900 rounded-[32px] md:rounded-[40px] p-8 md:p-12 text-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-10">
                            <MessageSquare className="w-24 h-24 md:w-32 md:h-32" />
                        </div>
                        <h3 className="text-2xl md:text-3xl font-black tracking-tight mb-6">We Listened!</h3>
                        <div className="space-y-6">
                            <div className="flex gap-4 md:gap-6">
                                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-[var(--card-bg)]/10 flex items-center justify-center shrink-0">
                                    <Wrench className="w-5 h-5 md:w-6 md:h-6" />
                                </div>
                                <div>
                                    <p className="text-[var(--text-secondary)] font-bold text-[10px] uppercase tracking-widest mb-1">Recent Improvement</p>
                                    <p className="text-base md:text-lg font-medium text-slate-200">Upgraded all common area Wi-Fi routers for 10x faster speeds.</p>
                                </div>
                            </div>
                            <div className="flex gap-4 md:gap-6">
                                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-[var(--card-bg)]/10 flex items-center justify-center shrink-0">
                                    <Droplets className="w-5 h-5 md:w-6 md:h-6" />
                                </div>
                                <div>
                                    <p className="text-[var(--text-secondary)] font-bold text-[10px] uppercase tracking-widest mb-1">Recent Improvement</p>
                                    <p className="text-base md:text-lg font-medium text-slate-200">Installed new eco-friendly shower heads in all bathrooms.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const OverallSatisfactionReport = ({ reviews, averages, setActiveReport, targetLanguage, dateFilter }: { reviews: BookingReview[], averages: any, setActiveReport: (t: ReportType) => void, targetLanguage: string, dateFilter: string }) => {
    const above8 = reviews.filter(r => r.reviewScore >= 8).length;
    const below6 = reviews.filter(r => r.reviewScore < 6).length;
    const above8Percent = Math.round((above8 / reviews.length) * 100);
    const below6Percent = Math.round((below6 / reviews.length) * 100);

    const trendData = useMemo(() => {
        const buckets: Record<string, { sum: number; count: number; firstDate: number }> = {};

        reviews.forEach(r => {
            const date = parseRobustDate(r.reviewDate);
            if (date) {
                let key = format(date, 'MMM yyyy');
                let sortDate = startOfMonth(date).getTime();

                if (dateFilter === '1d' || dateFilter === '7d') {
                    key = format(date, 'MMM dd');
                    sortDate = startOfDay(date).getTime();
                } else if (dateFilter === '30d') {
                    key = `${format(date, 'RRRR-\'W\'II')}`;
                    sortDate = startOfWeek(date).getTime();
                }

                if (!buckets[key]) {
                    buckets[key] = { sum: 0, count: 0, firstDate: sortDate };
                }
                if (r.reviewScore > 0) {
                    buckets[key].sum += r.reviewScore;
                    buckets[key].count += 1;
                }
            }
        });

        return Object.entries(buckets)
            .map(([label, data]) => {
                if (data.count === 0) return null;
                return {
                    label,
                    score: Number((data.sum / data.count).toFixed(1)),
                    sortTime: data.firstDate
                };
            })
            .filter((item): item is any => item !== null)
            .sort((a, b) => a.sortTime - b.sortTime);
    }, [reviews, dateFilter]);

    const topComplaints = useMemo(() => extractKeywords(reviews, 'negative').slice(0, 3), [reviews]);
    const topPraise = useMemo(() => extractKeywords(reviews, 'positive').slice(0, 3), [reviews]);

    const praiseComments = useMemo(() => {
        return topPraise.map(k => {
            const review = reviews.find(r => (r.translatedPositive || r.positiveReview)?.toLowerCase().includes(k.word.toLowerCase()));
            return { keyword: k.word, comment: review?.translatedPositive || review?.positiveReview || '' };
        }).filter(c => c.comment);
    }, [topPraise, reviews]);

    const complaintComments = useMemo(() => {
        return topComplaints.map(k => {
            const review = reviews.find(r => (r.translatedNegative || r.negativeReview)?.toLowerCase().includes(k.word.toLowerCase()));
            return { keyword: k.word, comment: review?.translatedNegative || review?.negativeReview || '' };
        }).filter(c => c.comment);
    }, [topComplaints, reviews]);

    const departments = [
        { name: 'Staff', score: averages.staff },
        { name: 'Clean', score: averages.cleanliness },
        { name: 'Value', score: averages.valueForMoney },
        { name: 'Comfort', score: averages.comfort },
    ].sort((a, b) => b.score - a.score);

    return (
        <div className="space-y-12">
            {/* Dynamic Status Bar */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-wrap items-center gap-3 md:gap-4"
            >
                <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-500/20 text-[10px] font-bold uppercase tracking-[0.2em]">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live Metrics
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-full border border-indigo-500/20 text-[10px] font-bold uppercase tracking-[0.2em]">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    {reviews.length} Data Points
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-full border border-purple-500/20 text-[10px] font-bold uppercase tracking-[0.2em]">
                    <Sparkles className="w-3 h-3" />
                    AI Analysis Ready
                </div>
            </motion.div>

            {/* Top Level KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
                <div className="lg:scale-105 transform origin-left">
                    <ScoreCard
                        label="Overall Satisfaction"
                        score={averages.overall}
                        icon={<Star className="w-5 h-5" />}
                        sampleSize={averages.counts?.overall}
                        sampleTotal={averages.counts?.total}
                        className="ring-2 ring-indigo-600/20 shadow-xl shadow-indigo-100 dark:shadow-none"
                    />
                </div>
                <ScoreCard
                    label="Staff Score"
                    score={averages.staff}
                    icon={<Users className="w-5 h-5" />}
                    sampleSize={averages.counts?.staff}
                    sampleTotal={averages.counts?.total}
                />
                <ScoreCard
                    label="Cleanliness"
                    score={averages.cleanliness}
                    icon={<Droplets className="w-5 h-5" />}
                    sampleSize={averages.counts?.cleanliness}
                    sampleTotal={averages.counts?.total}
                />
                <ScoreCard
                    label="Value"
                    score={averages.valueForMoney}
                    icon={<DollarSign className="w-5 h-5" />}
                    sampleSize={averages.counts?.valueForMoney}
                    sampleTotal={averages.counts?.total}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 md:gap-8">
                {/* Main Trend Chart */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="lg:col-span-2 bg-[var(--card-bg)] p-6 md:p-8 rounded-[32px] md:rounded-[40px] border border-[var(--border-color)] shadow-sm flex flex-col"
                >
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Performance Trend</h3>
                            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">
                                {dateFilter === '1d' ? 'Daily' : dateFilter === '7d' ? 'Weekly' : dateFilter === '30d' ? 'Monthly' : 'Custom'} Average Score
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-indigo/50" />
                            <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest">Score</span>
                        </div>
                    </div>
                    <div className="flex-1 min-h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" opacity={0.3} />
                                <XAxis
                                    dataKey="label"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 900 }}
                                    dy={15}
                                />
                                <YAxis
                                    domain={[0, 10]}
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 900 }}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '24px',
                                        border: 'none',
                                        boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
                                        padding: '16px'
                                    }}
                                    itemStyle={{ fontWeight: 900, fontSize: '16px' }}
                                    labelStyle={{ fontWeight: 900, color: '#64748b', marginBottom: '8px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="score"
                                    stroke="#1e1b4b"
                                    strokeWidth={6}
                                    dot={{ r: 0 }}
                                    activeDot={{ r: 8, fill: '#1e1b4b', stroke: '#fff', strokeWidth: 4 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </motion.div>

                {/* Top Praise & Complaints Column */}
                <div className="lg:col-span-1 space-y-4 h-full">
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-emerald-900 text-emerald-50 p-6 rounded-[32px] md:rounded-[40px] shadow-xl shadow-emerald-500/10"
                    >
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300 mb-4">Top Praise</h4>
                        <div className="space-y-4">
                            {praiseComments.map((c, i) => (
                                <div key={i}>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-1 block">{c.keyword}</span>
                                    <p className="text-xs font-medium italic leading-relaxed opacity-90 line-clamp-1">
                                        "{c.comment}"
                                    </p>
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-rose-900 text-rose-50 p-6 rounded-[32px] md:rounded-[40px] shadow-xl shadow-rose-500/10"
                    >
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-300 mb-4">Top Complaints</h4>
                        <div className="space-y-4">
                            {complaintComments.map((c, i) => (
                                <div key={i}>
                                    <span className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-1 block">{c.keyword}</span>
                                    <p className="text-xs font-medium italic leading-relaxed opacity-90 line-clamp-1">
                                        "{c.comment}"
                                    </p>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </div>

                {/* Department Rank Column */}
                <div className="lg:col-span-1 h-full">
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-[var(--card-bg)] p-8 rounded-[32px] md:rounded-[40px] border border-[var(--border-color)] shadow-sm h-full"
                    >
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-6">Department Rank</h4>
                        <div className="space-y-4">
                            {departments.map((d, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-[var(--text-secondary)]">{d.name}</span>
                                    <span className={cn("text-sm font-black", d.score >= 8.5 ? "text-emerald-600" : "text-indigo-600")}>{d.score}</span>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Recent Feedback Sections - Direct Visibility */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* Positive Feedback */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-[0.3em] flex items-center gap-2">
                            <Smile className="w-4 h-4 text-emerald-500" />
                            Positive Feedbacks
                        </h3>
                    </div>
                    <ul className="space-y-4">
                        {reviews.filter(r => r.reviewScore >= 9 && isValidFeedback(r.positiveReview)).slice(0, 4).map((r, i) => (
                            <motion.li
                                key={i}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="bg-[var(--card-bg)] p-5 rounded-[24px] border border-[var(--border-color)] shadow-sm flex gap-4"
                            >
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700 font-black text-sm shrink-0">
                                    {r.reviewScore}
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1.5">
                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{reviewLocationLabel(r)}</span>
                                        <span className="text-[9px] font-black text-[var(--text-secondary)] opacity-50">{r.reviewDate}</span>
                                    </div>
                                    {(r.guestName || r.reservationNumber) && (
                                        <p className="text-[10px] font-bold text-slate-500 mb-1.5 tracking-wide">
                                            {r.guestName || 'Guest'}{r.reservationNumber && <span className="opacity-70"> * #{r.reservationNumber}</span>}
                                        </p>
                                    )}
                                    <p className="text-sm text-slate-700 font-medium italic leading-relaxed">"{r.translatedPositive || r.positiveReview}"</p>
                                </div>
                            </motion.li>
                        ))}
                    </ul>
                </div>

                {/* Critical Feedback */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-[0.3em] flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-500" />
                            Recent Critical Feedback
                        </h3>
                        <button
                            onClick={() => setActiveReport('negative')}
                            className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline"
                        >
                            View All
                        </button>
                    </div>
                    <ul className="space-y-4">
                        {reviews.filter(r => r.reviewScore < 6 && isValidFeedback(r.negativeReview)).slice(0, 4).map((r, i) => (
                            <motion.li
                                key={i}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="bg-[var(--card-bg)] p-5 rounded-[24px] border border-[var(--border-color)] shadow-sm flex gap-4"
                            >
                                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-700 font-black text-sm shrink-0">
                                    {r.reviewScore}
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1.5">
                                        <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{reviewLocationLabel(r)}</span>
                                        <span className="text-[9px] font-black text-[var(--text-secondary)] opacity-50">{r.reviewDate}</span>
                                    </div>
                                    {(r.guestName || r.reservationNumber) && (
                                        <p className="text-[10px] font-bold text-slate-500 mb-1.5 tracking-wide">
                                            {r.guestName || 'Guest'}{r.reservationNumber && <span className="opacity-70"> * #{r.reservationNumber}</span>}
                                        </p>
                                    )}
                                    <p className="text-sm text-slate-700 font-medium italic leading-relaxed">"{r.translatedNegative || r.negativeReview}"</p>
                                    <CriticalReviewActions review={r} />
                                </div>
                            </motion.li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
};

const DepartmentPerformanceReport = ({ averages }: { averages: any }) => {
    const departments = [
        { name: 'Staff', score: averages.staff, target: 9.0, action: 'Maintain high standards, reward top performers', icon: <Users className="w-5 h-5" />, color: 'bg-indigo-500' },
        { name: 'Location', score: averages.location, target: 9.0, action: 'Update local guides and transport info', icon: <MapPin className="w-5 h-5" />, color: 'bg-emerald-500' },
        { name: 'Cleanliness', score: averages.cleanliness, target: 8.5, action: 'Review housekeeping schedule', icon: <Droplets className="w-5 h-5" />, color: 'bg-cyan-500' },
        { name: 'Comfort', score: averages.comfort, target: 8.5, action: 'Upgrade mattresses or pillows', icon: <Home className="w-5 h-5" />, color: 'bg-purple-500' },
        { name: 'Value', score: averages.valueForMoney, target: 8.5, action: 'Review pricing strategy vs competitors', icon: <DollarSign className="w-5 h-5" />, color: 'bg-pink-500' },
        { name: 'Facilities', score: averages.facilities, target: 8.5, action: 'Upgrade amenities and equipment', icon: <Wrench className="w-5 h-5" />, color: 'bg-amber-500' },
    ].sort((a, b) => b.score - a.score);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {departments.map((dept, idx) => (
                <motion.div
                    key={dept.name}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    className="bg-[var(--card-bg)] p-8 rounded-[40px] border border-[var(--border-color)] shadow-sm hover:shadow-xl transition-all group"
                >
                    <div className="flex justify-between items-start mb-6">
                        <div className={cn("p-4 rounded-2xl text-white shadow-lg", dept.color)}>
                            {dept.icon}
                        </div>
                        <div className="text-right">
                            <span className="text-3xl font-black text-[var(--text-primary)] tabular-nums tracking-tighter">{dept.score}</span>
                            <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1">Target: {dept.target}</p>
                        </div>
                    </div>

                    <h4 className="text-lg font-black text-[var(--text-primary)] mb-4 tracking-tight">{dept.name}</h4>

                    <div className="relative h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-6">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${dept.score * 10}%` }}
                            transition={{ duration: 1, delay: 0.5 + idx * 0.1 }}
                            className={cn("absolute h-full rounded-full transition-all", dept.color)}
                        />
                    </div>

                    <p className="text-xs font-medium text-[var(--text-secondary)] leading-relaxed bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                        <span className="font-bold text-indigo-600 dark:text-indigo-400 block mb-1 uppercase tracking-widest text-[9px]">Insight & Action</span>
                        {dept.action}
                    </p>
                </motion.div>
            ))}
        </div>
    );
};

const PerformanceTrendReport = ({ reviews, dateFilter }: { reviews: BookingReview[], dateFilter: string }) => {
    const trendData = useMemo(() => {
        const buckets: Record<string, any> = {};
        reviews.forEach(r => {
            const date = parseRobustDate(r.reviewDate);
            if (date) {
                let key = format(date, 'MMM yyyy');
                let sortDate = startOfMonth(date).getTime();

                if (dateFilter === '1d' || dateFilter === '7d') {
                    key = format(date, 'MMM dd');
                    sortDate = startOfDay(date).getTime();
                } else if (dateFilter === '30d') {
                    key = `${format(date, 'RRRR-\'W\'II')}`;
                    sortDate = startOfWeek(date).getTime();
                }

                if (!buckets[key]) {
                    buckets[key] = {
                        label: key,
                        overall: 0, overallCount: 0,
                        staff: 0, staffCount: 0,
                        clean: 0, cleanCount: 0,
                        facilities: 0, facilitiesCount: 0,
                        sortTime: sortDate
                    };
                }
                if (r.reviewScore > 0) { buckets[key].overall += r.reviewScore; buckets[key].overallCount++; }
                if (r.staff > 0) { buckets[key].staff += r.staff; buckets[key].staffCount++; }
                if (r.cleanliness > 0) { buckets[key].clean += r.cleanliness; buckets[key].cleanCount++; }
                if (r.facilities > 0) { buckets[key].facilities += r.facilities; buckets[key].facilitiesCount++; }
            }
        });

        return Object.entries(buckets).map(([key, d]: [string, any]) => {
            const point: any = { label: key, sortTime: d.sortTime };
            if (d.overallCount > 0) point.Overall = Number((d.overall / d.overallCount).toFixed(1));
            if (d.staffCount > 0) point.Staff = Number((d.staff / d.staffCount).toFixed(1));
            if (d.cleanCount > 0) point.Cleanliness = Number((d.clean / d.cleanCount).toFixed(1));
            if (d.facilitiesCount > 0) point.Facilities = Number((d.facilities / d.facilitiesCount).toFixed(1));
            return point;
        }).sort((a, b) => a.sortTime - b.sortTime);
    }, [reviews, dateFilter]);

    return (
        <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Departmental Trend Analysis</h3>
                    <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1">
                        Analyzing {dateFilter === '1d' ? 'Daily' : dateFilter === '7d' ? 'Weekly' : dateFilter === '30d' ? 'Monthly' : 'Custom'} performance metrics
                    </p>
                </div>
                <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                    <TrendingUp className="w-4 h-4 text-indigo-600" />
                    <span className="text-[10px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-widest">Live Aggregation</span>
                </div>
            </div>
            <div className="h-[450px]">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 10, right: 30, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" opacity={0.3} />
                        <XAxis
                            dataKey="label"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 900 }}
                            dy={15}
                        />
                        <YAxis
                            domain={[0, 10]}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 900 }}
                        />
                        <Tooltip
                            contentStyle={{
                                borderRadius: '24px',
                                border: 'none',
                                boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)',
                                padding: '16px',
                                backgroundColor: 'var(--card-bg)'
                            }}
                            itemStyle={{ fontWeight: 900, fontSize: '14px' }}
                            labelStyle={{ fontWeight: 900, color: '#64748b', marginBottom: '8px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                        />
                        <Legend verticalAlign="top" height={36} />
                        <Line type="monotone" dataKey="Overall" stroke="#6366f1" strokeWidth={4} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="Staff" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="Cleanliness" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="Facilities" stroke="#ec4899" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

const NegativeExperienceReport = ({ reviews, targetLanguage }: { reviews: BookingReview[], targetLanguage: string }) => {
    const [aiAnalysis, setAiAnalysis] = useState<{ categories: any[], summary: string } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const negativeReviews = reviews.filter(r => r.reviewScore <= 6 && isValidFeedback(r.negativeReview));

    const themes = [
        {
            name: 'Cleanliness',
            icon: <Droplets className="w-4 h-4" />,
            keywords: ['dirty', 'clean', 'smell', 'bathroom', 'shower', 'mold', 'stain', 'hair', 'dust', 'bug', 'bedbug', 'cockroach', 'ant', 'towel', 'sheet', 'linen', 'floor', 'trash', 'hygiene', 'unsanitary', 'filthy']
        },
        {
            name: 'Noise & Sleep',
            icon: <Volume2 className="w-4 h-4" />,
            keywords: ['noise', 'loud', 'music', 'sleep', 'night', 'street', 'party', 'thin walls', 'earplug', 'snoring', 'traffic', 'construction', 'bar', 'club', 'shouting', 'talking', 'quiet']
        },
        {
            name: 'Facilities',
            icon: <Wrench className="w-4 h-4" />,
            keywords: ['wifi', 'internet', 'ac', 'aircon', 'bed', 'power', 'outlet', 'kitchen', 'locker', 'elevator', 'lift', 'fridge', 'microwave', 'kettle', 'common room', 'lounge', 'broken', 'old', 'outdated', 'small']
        },
        {
            name: 'Staff & Service',
            icon: <Users className="w-4 h-4" />,
            keywords: ['staff', 'service', 'rude', 'unhelpful', 'slow', 'check-in', 'check-out', 'reception', 'manager', 'attitude', 'unfriendly', 'ignore', 'help', 'welcoming', 'professional']
        },
        {
            name: 'Location & Safety',
            icon: <MapPin className="w-4 h-4" />,
            keywords: ['location', 'safety', 'area', 'neighborhood', 'far', 'walk', 'transport', 'bus', 'train', 'metro', 'dark', 'sketchy', 'dangerous', 'theft', 'lock', 'distance', 'central']
        },
        {
            name: 'Value & Price',
            icon: <DollarSign className="w-4 h-4" />,
            keywords: ['price', 'expensive', 'cost', 'value', 'money', 'fee', 'charge', 'deposit', 'refund', 'overpriced', 'cheap', 'worth', 'budget']
        },
    ];

    const themeCounts = themes.map(t => ({
        ...t,
        count: negativeReviews.filter(r =>
            t.keywords.some(k => (r.translatedNegative || r.negativeReview).toLowerCase().includes(k))
        ).length
    }));

    const handleDeepAnalysis = async () => {
        if (negativeReviews.length === 0) {
            alert("No critical reviews (score <= 6) found in the selected date range to analyze.");
            return;
        }

        setIsAnalyzing(true);
        try {
            const result = await categorizeNegativeReviews(reviews, targetLanguage);
            if (result) {
                setAiAnalysis(result);
            } else {
                alert("AI analysis returned no results. This might be due to a lack of feedback content.");
            }
        } catch (err: any) {
            console.error("Analysis error:", err);
            alert("Analysis failed: " + (err.message || "Unknown error"));
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="space-y-12">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Negative Feedback Themes</h3>
                    <p className="text-slate-800 font-medium mt-1">Categorized by keyword extraction and AI analysis</p>
                </div>
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleDeepAnalysis}
                    disabled={isAnalyzing}
                    className="flex items-center gap-2 px-6 py-3 bg-indigo/5 text-indigo-600 rounded-2xl text-sm font-bold hover:bg-brand-100 transition-all disabled:opacity-50 shadow-sm shadow-indigo/10/50"
                >
                    {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Deep AI Analysis
                </motion.button>
            </div>

            <AnimatePresence>
                {aiAnalysis && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="bg-rose-50 border border-rose-100 p-8 rounded-3xl relative overflow-hidden"
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-5">
                            <Brain className="w-24 h-24 text-rose-900" />
                        </div>
                        <div className="flex items-center gap-3 text-rose-900 font-black uppercase tracking-widest text-xs mb-4">
                            <Brain className="w-4 h-4" />
                            AI Summary of Critical Issues
                        </div>
                        <p className="text-rose-800 text-lg leading-relaxed font-medium italic">"{aiAnalysis.summary}"</p>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {themeCounts.map((t, idx) => (
                    <motion.div
                        key={t.name}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        whileHover={{ y: -4, shadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)" }}
                        className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm group transition-all duration-300"
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="p-3 rounded-2xl bg-slate-50 text-[var(--text-secondary)] group-hover:bg-indigo/5 group-hover:text-indigo-600 transition-colors">
                                {t.icon}
                            </div>
                            {aiAnalysis && (
                                <motion.span
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="text-[10px] font-black text-rose-500 bg-rose-50 px-3 py-1 rounded-full uppercase tracking-widest"
                                >
                                    AI Confirmed
                                </motion.span>
                            )}
                        </div>
                        <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest mb-2">{t.name}</p>
                        <div className="flex items-baseline gap-2">
                            <p className="text-4xl font-black text-[var(--text-primary)]">{t.count}</p>
                            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">mentions</p>
                        </div>
                        <div className="mt-6 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, (t.count / (negativeReviews.length || 1)) * 100)}%` }}
                                transition={{ duration: 1, delay: 0.5 }}
                                className="bg-rose-500 h-full"
                            />
                        </div>
                    </motion.div>
                ))}
            </div>

            <div className="space-y-8">
                <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Critical Feedback ({negativeReviews.length})</h3>
                    <div className="flex items-center gap-3 bg-rose-50 px-4 py-2 rounded-full">
                        <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                        <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Score &lt;= 6.0</span>
                    </div>
                </div>
                <ul className="space-y-6">
                    {negativeReviews.slice(0, 15).map((r, i) => (
                        <motion.li
                            key={i}
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: i * 0.05 }}
                            className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm flex gap-6"
                        >
                            <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-700 font-black text-xl shrink-0">
                                {r.reviewScore}
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-center mb-4">
                                    <div>
                                        <span className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest block mb-1">{reviewLocationLabel(r)}</span>
                                        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">{r.reviewDate}</p>
                                    </div>
                                    <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">#{r.reservationNumber}</span>
                                </div>
                                <p className="text-lg text-slate-800 font-medium italic leading-relaxed">"{r.translatedNegative || r.negativeReview}"</p>
                                {r.positiveReview && isValidFeedback(r.positiveReview) && (
                                    <div className="mt-4 pt-4 border-t border-slate-50">
                                        <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest block mb-1">Also mentioned:</span>
                                        <p className="text-xs text-slate-600 italic">"{(r.translatedPositive || r.positiveReview).slice(0, 150)}..."</p>
                                    </div>
                                )}
                                <CriticalReviewActions review={r} />
                            </div>
                        </motion.li>
                    ))}
                    {negativeReviews.length > 15 && (
                        <p className="text-center text-[var(--text-secondary)] font-bold uppercase tracking-widest text-xs py-8 border-t border-slate-100">Showing top 15 critical reviews...</p>
                    )}
                </ul>
            </div>
        </div>
    );
};

const ValueForMoneyReport = ({ reviews, averages }: { reviews: BookingReview[], averages: any }) => {
    const insight = averages.overall > averages.valueForMoney
        ? "Overall satisfaction is higher than value perception. This suggests pricing might be slightly high for the current service level."
        : "Value perception is strong. Guests feel they are getting good value for their money.";

    return (
        <div className="space-y-12">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-indigo-900 text-brand-50 p-8 rounded-3xl relative overflow-hidden shadow-xl shadow-indigo-100"
            >
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Brain className="w-24 h-24" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-indigo-300 mb-4 flex items-center gap-3">
                    <Brain className="w-5 h-5" />
                    Value Insight
                </h3>
                <p className="text-xl font-medium leading-relaxed italic">"{insight}"</p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm"
                >
                    <h3 className="text-lg font-black text-[var(--text-primary)] tracking-tight mb-8 uppercase tracking-widest text-xs text-[var(--text-secondary)]">Overall vs Value Score</h3>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[{ name: 'Overall', score: averages.overall }, { name: 'Value', score: averages.valueForMoney }]}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
                                <YAxis domain={[0, 10]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 800, fill: '#64748b' }} />
                                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }} />
                                <Bar dataKey="score" radius={[8, 8, 0, 0]} barSize={40}>
                                    <Cell fill="#6366f1" />
                                    <Cell fill="#22d3ee" />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm"
                >
                    <h3 className="text-lg font-black text-[var(--text-primary)] tracking-tight mb-8 uppercase tracking-widest text-xs text-[var(--text-secondary)]">Distribution</h3>
                    <div className="space-y-6">
                        <div className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
                            <span className="text-sm font-bold text-slate-800 uppercase tracking-widest">Value Score &gt;= 9.0</span>
                            <span className="text-2xl font-black text-emerald-600">{reviews.filter(r => r.valueForMoney >= 9).length}</span>
                        </div>
                        <div className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
                            <span className="text-sm font-bold text-slate-800 uppercase tracking-widest">Value Score &lt;= 6.0</span>
                            <span className="text-2xl font-black text-rose-600">{reviews.filter(r => r.valueForMoney <= 6).length}</span>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

const FacilitiesImprovementReport = ({ reviews }: { reviews: BookingReview[] }) => {
    const facilityKeywords = ['bed', 'wifi', 'internet', 'shower', 'bathroom', 'power', 'outlet', 'ac', 'aircon', 'kitchen'];
    const mentions = reviews.filter(r =>
        facilityKeywords.some(k => r.negativeReview.toLowerCase().includes(k))
    );

    return (
        <div className="space-y-12">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-900 text-rose-50 p-8 rounded-3xl relative overflow-hidden shadow-xl shadow-rose-100"
            >
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Wrench className="w-24 h-24" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-rose-300 mb-4 flex items-center gap-3">
                    <AlertCircle className="w-5 h-5" />
                    Priority Improvement Areas
                </h3>
                <p className="text-xl font-medium leading-relaxed italic">"Facilities is consistently the lowest scoring category. Focus on these recurring mentions to improve overall guest satisfaction."</p>
            </motion.div>

            <div className="grid grid-cols-1 gap-6">
                {mentions.slice(0, 10).map((r, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm hover:shadow-md transition-all group"
                    >
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-[var(--text-secondary)] group-hover:bg-indigo/5 group-hover:text-indigo-600 transition-colors">
                                    <Wrench className="w-5 h-5" />
                                </div>
                                <div>
                                    <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">{r.reviewDate}</span>
                                    <p className="text-sm font-black text-[var(--text-primary)]">#{r.reservationNumber}</p>
                                </div>
                            </div>
                            <span className="px-4 py-2 bg-rose-50 text-rose-700 text-[10px] font-black uppercase tracking-widest rounded-full border border-rose-100">Facilities Score: {r.facilities}</span>
                        </div>
                        <p className="text-lg text-slate-700 font-medium italic leading-relaxed">"{r.translatedNegative || r.negativeReview}"</p>
                        <CriticalReviewActions review={r} />
                    </motion.div>
                ))}
            </div>
        </div>
    );
};

const HostelComparisonReport = ({ reviews }: { reviews: BookingReview[] }) => {
    const propertyNames = PROPERTY_NAMES;

    const propertyStats = useMemo(() => {
        return propertyNames.map(name => {
            const propertyReviews = reviews.filter(r =>
                matchesPropertyName(r, name)
            );
            const avg = calculateAverages(propertyReviews);
            return {
                name,
                count: propertyReviews.length,
                avg: avg || { overall: 0, staff: 0, cleanliness: 0, location: 0, facilities: 0, comfort: 0, valueForMoney: 0 }
            };
        });
    }, [reviews]);

    const metrics = [
        { key: 'overall', label: 'Overall Score', icon: <Target className="w-4 h-4" /> },
        { key: 'staff', label: 'Staff Service', icon: <Users className="w-4 h-4" /> },
        { key: 'cleanliness', label: 'Cleanliness', icon: <Droplets className="w-4 h-4" /> },
        { key: 'facilities', label: 'Facilities', icon: <Wrench className="w-4 h-4" /> },
        { key: 'valueForMoney', label: 'Value', icon: <DollarSign className="w-4 h-4" /> }
    ];

    return (
        <div className="space-y-12">
            {/* Visual Leaderboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {propertyStats.map((stat, i) => (
                    <motion.div
                        key={stat.name}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="bg-[var(--card-bg)] p-8 rounded-[40px] border border-[var(--border-color)] shadow-sm relative overflow-hidden group"
                    >
                        <div className={cn(
                            "absolute top-0 right-0 w-32 h-32 opacity-5 -mr-8 -mt-8 rounded-full",
                            i === 0 ? "bg-indigo-600" : i === 1 ? "bg-purple-600" : "bg-emerald-600"
                        )} />
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">Property</span>
                                <h4 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">{stat.name}</h4>
                            </div>
                            <div className={cn(
                                "w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black shadow-lg",
                                i === 0 ? "bg-indigo-50 text-indigo-700" : i === 1 ? "bg-purple-50 text-purple-700" : "bg-emerald-50 text-emerald-700"
                            )}>
                                {stat.avg.overall || 'N/A'}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex justify-between items-end">
                                <span className="text-xs font-bold text-[var(--text-secondary)]">Total Volume</span>
                                <span className="text-sm font-black text-[var(--text-primary)]">{stat.count} <span className="text-[10px] opacity-50 uppercase">Reviews</span></span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${(stat.avg.overall / 10) * 100}%` }}
                                    className={cn(
                                        "h-full rounded-full",
                                        i === 0 ? "bg-indigo-500" : i === 1 ? "bg-purple-500" : "bg-emerald-500"
                                    )}
                                />
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Comparative Matrix */}
            <div className="bg-[var(--card-bg)] rounded-[40px] border border-[var(--border-color)] shadow-sm overflow-hidden">
                <div className="p-8 border-b border-[var(--border-color)] bg-slate-50/50">
                    <h3 className="text-sm font-black uppercase tracking-[0.3em] text-[var(--text-primary)]">Key Metric Comparison</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-100/30">
                                <th className="p-6 text-left text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Category</th>
                                {propertyStats.map(s => (
                                    <th key={s.name} className="p-6 text-center text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)] bg-slate-50/30">{s.name}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {metrics.map((m, idx) => (
                                <tr key={m.key} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="p-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-[var(--text-secondary)]">
                                                {m.icon}
                                            </div>
                                            <span className="text-sm font-bold text-[var(--text-primary)]">{m.label}</span>
                                        </div>
                                    </td>
                                    {propertyStats.map(s => {
                                        const value = (s.avg as any)[m.key];
                                        const isWinner = value > 0 && propertyStats.every(other => (other.avg as any)[m.key] <= value);
                                        return (
                                            <td key={s.name} className="p-6 text-center">
                                                <span className={cn(
                                                    "text-base font-black px-4 py-2 rounded-xl transition-all",
                                                    isWinner ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 scale-110" : "text-[var(--text-secondary)]"
                                                )}>
                                                    {value || '-'}
                                                </span>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Cross-Property Sentiment Insights */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="bg-indigo-900 text-indigo-50 p-10 rounded-[40px] shadow-xl">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-300 mb-6">Market Leadership</h4>
                    <p className="text-xl font-medium leading-relaxed italic mb-8">
                        "{(propertyStats.sort((a, b) => b.avg.overall - a.avg.overall)[0]).name} is currently leading the group in overall guest satisfaction. Their performance in {(propertyStats.sort((a, b) => b.avg.staff - a.avg.staff)[0]).name === (propertyStats.sort((a, b) => b.avg.overall - a.avg.overall)[0]).name ? "Staff Service" : "multiple categories"} is a key driver."
                    </p>
                    <div className="flex gap-4">
                        {propertyStats.map((s, i) => (
                            <div key={i} className="flex flex-col items-center">
                                <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center font-black">{s.avg.overall}</div>
                                <span className="text-[8px] uppercase mt-2 opacity-60 font-black">{s.name.slice(0, 3)}</span>
                            </div>
                        ))}
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-[var(--card-bg)] p-10 rounded-[40px] border border-[var(--border-color)] shadow-sm">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-secondary)] mb-6">Group Distribution</h4>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={propertyStats}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="count"
                                    nameKey="name"
                                >
                                    {propertyStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={['#6366f1', '#a855f7', '#10b981'][index % 3]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

const StaffPerformanceImpactReport = ({ reviews }: { reviews: BookingReview[] }) => {
    const staffCompensating = reviews.filter(r => r.staff >= 9 && r.reviewScore < 7.5 && (isValidFeedback(r.positiveReview) || isValidFeedback(r.negativeReview)));

    return (
        <div className="space-y-12">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-emerald-900 text-emerald-50 p-8 rounded-3xl relative overflow-hidden shadow-xl shadow-emerald-100"
            >
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Users className="w-24 h-24" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-emerald-300 mb-4 flex items-center gap-3">
                    <Users className="w-5 h-5" />
                    Staff Compensation Effect
                </h3>
                <p className="text-xl font-medium leading-relaxed italic">
                    Found {staffCompensating.length} instances where staff performance was exceptional (9+) but overall satisfaction remained low ({'<'}7.5).
                    This indicates that great service is struggling to overcome infrastructure weaknesses.
                </p>
            </motion.div>

            <ul className="space-y-8">
                {staffCompensating.map((r, i) => (
                    <motion.li
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="bg-[var(--card-bg)] p-10 rounded-[40px] border border-[var(--border-color)] shadow-sm hover:shadow-md transition-all flex gap-8"
                    >
                        <div className="flex flex-col gap-3 shrink-0">
                            <div className="w-16 h-16 rounded-3xl bg-emerald-50 flex flex-col items-center justify-center text-emerald-700 font-black shadow-sm">
                                <span className="text-[8px] uppercase">Staff</span>
                                <span className="text-xl leading-none">{r.staff}</span>
                            </div>
                            <div className="w-16 h-16 rounded-3xl bg-rose-50 flex flex-col items-center justify-center text-rose-700 font-black shadow-sm">
                                <span className="text-[8px] uppercase">Overall</span>
                                <span className="text-xl leading-none">{r.reviewScore}</span>
                            </div>
                        </div>

                        <div className="flex-1">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h4 className="text-xl font-black text-[var(--text-primary)] tracking-tight mb-1">"{r.reviewTitle || "Guest Review"}"</h4>
                                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-[0.2em]">{reviewLocationLabel(r)} * {r.reviewDate}</p>
                                </div>
                                <span className="text-[10px] font-black text-[var(--text-secondary)] opacity-50 uppercase tracking-widest">#{r.reservationNumber}</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {isValidFeedback(r.positiveReview) && (
                                    <div className="space-y-3">
                                        <span className="inline-flex px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-full">Positive Highlight</span>
                                        <p className="text-sm text-slate-700 leading-relaxed italic">"{r.translatedPositive || r.positiveReview}"</p>
                                    </div>
                                )}
                                {isValidFeedback(r.negativeReview) && (
                                    <div className="space-y-3">
                                        <span className="inline-flex px-3 py-1 bg-rose-50 text-rose-600 text-[10px] font-black uppercase tracking-widest rounded-full">Critical Issue</span>
                                        <p className="text-sm text-slate-700 leading-relaxed italic">"{r.translatedNegative || r.negativeReview}"</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.li>
                ))}
            </ul>
        </div>
    );
};

const ReviewSentimentReport = ({ reviews }: { reviews: BookingReview[] }) => {
    const positiveKeywords = useMemo(() => extractKeywords(reviews, 'positive'), [reviews]);
    const negativeKeywords = useMemo(() => extractKeywords(reviews, 'negative'), [reviews]);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-[var(--card-bg)] p-10 rounded-[40px] border border-[var(--border-color)] shadow-sm"
            >
                <h3 className="text-xs font-black text-emerald-600 uppercase tracking-[0.3em] mb-8 flex items-center gap-3">
                    <TrendingUp className="w-5 h-5" />
                    Top Positive Keywords
                </h3>
                <div className="flex flex-wrap gap-3">
                    {positiveKeywords.map((k, i) => (
                        <motion.span
                            key={i}
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: i * 0.05 }}
                            whileHover={{ scale: 1.1, backgroundColor: '#ecfdf5' }}
                            className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-2xl text-sm font-black border border-emerald-100 shadow-sm shadow-emerald-100/50 cursor-default"
                        >
                            {k.word} <span className="opacity-40 ml-2 text-[10px]">{k.count}</span>
                        </motion.span>
                    ))}
                </div>
            </motion.div>

            <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-[var(--card-bg)] p-10 rounded-[40px] border border-[var(--border-color)] shadow-sm"
            >
                <h3 className="text-xs font-black text-rose-600 uppercase tracking-[0.3em] mb-8 flex items-center gap-3">
                    <AlertCircle className="w-5 h-5" />
                    Top Complaints
                </h3>
                <div className="flex flex-wrap gap-3">
                    {negativeKeywords.map((k, i) => (
                        <motion.span
                            key={i}
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: i * 0.05 }}
                            whileHover={{ scale: 1.1, backgroundColor: '#fff1f2' }}
                            className="px-4 py-2 bg-rose-50 text-rose-700 rounded-2xl text-sm font-black border border-rose-100 shadow-sm shadow-rose-100/50 cursor-default"
                        >
                            {k.word} <span className="opacity-40 ml-2 text-[10px]">{k.count}</span>
                        </motion.span>
                    ))}
                </div>
            </motion.div>
        </div>
    );
};

const GuestExperienceScorecard = ({ averages }: { averages: any }) => {
    const metrics = [
        { label: 'Overall', current: averages.overall, target: 8.5 },
        { label: 'Staff', current: averages.staff, target: 9.0 },
        { label: 'Cleanliness', current: averages.cleanliness, target: 8.5 },
        { label: 'Facilities', current: averages.facilities, target: 8.5 },
        { label: 'Comfort', current: averages.comfort, target: 8.5 },
        { label: 'Value', current: averages.valueForMoney, target: 8.5 },
    ];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[var(--card-bg)] p-12 rounded-[40px] border border-[var(--border-color)] shadow-sm"
        >
            <div className="space-y-10">
                {metrics.map((m, idx) => {
                    const progress = (m.current / 10) * 100;
                    const targetProgress = (m.target / 10) * 100;
                    const isMet = m.current >= m.target;

                    return (
                        <div key={m.label} className="space-y-4">
                            <div className="flex justify-between items-end">
                                <div>
                                    <span className="text-2xl font-black text-[var(--text-primary)] tracking-tight">{m.label}</span>
                                    <span className="ml-3 text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest">Target: {m.target}</span>
                                </div>
                                <div className="text-right">
                                    <motion.span
                                        initial={{ scale: 0.5, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={{ delay: idx * 0.1 }}
                                        className={cn("text-4xl font-black tabular-nums", isMet ? "text-emerald-600" : "text-indigo-600")}
                                    >
                                        {m.current}
                                    </motion.span>
                                </div>
                            </div>
                            <div className="h-6 bg-slate-100 rounded-full overflow-hidden relative shadow-inner">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ duration: 1.5, delay: 0.2 + idx * 0.1, ease: "easeOut" }}
                                    className={cn("h-full", isMet ? "bg-emerald-500" : "bg-indigo/50")}
                                />
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: 1 }}
                                    className="absolute top-0 h-full w-1.5 bg-slate-900/10 z-10"
                                    style={{ left: `${targetProgress}%` }}
                                    title={`Target: ${m.target}`}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </motion.div>
    );
};

const BookingPlatformReport = ({ reviews }: { reviews: BookingReview[] }) => {
    const volumeData = useMemo(() => {
        const months: Record<string, number> = {};
        reviews.forEach(r => {
            const date = parseRobustDate(r.reviewDate);
            if (date) {
                const key = format(date, 'MMM yyyy');
                months[key] = (months[key] || 0) + 1;
            }
        });
        return Object.entries(months).map(([month, count]) => ({ month, count }))
            .sort((a, b) => parse(a.month, 'MMM yyyy', new Date()).getTime() - parse(b.month, 'MMM yyyy', new Date()).getTime());
    }, [reviews]);

    const replied = reviews.filter(r => r.propertyReply && r.propertyReply.trim().length > 0).length;
    const responseRate = Math.round((replied / reviews.length) * 100);

    return (
        <div className="space-y-12">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-navy text-brand-50 p-10 rounded-[40px] relative overflow-hidden shadow-xl shadow-indigo/10"
            >
                <div className="absolute top-0 right-0 p-6 opacity-10">
                    <BarChart3 className="w-24 h-24" />
                </div>
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-brand-300 mb-6 flex items-center gap-3">
                    <BarChart3 className="w-5 h-5" />
                    Platform Performance Insight
                </h3>
                <p className="text-xl font-medium leading-relaxed italic">
                    A high response rate (especially to negative reviews) significantly improves your Booking.com ranking and conversion rate.
                    Aim for 100% response rate on reviews below 8.0 to maximize visibility.
                </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <motion.div
                    whileHover={{ y: -5 }}
                    className="bg-[var(--card-bg)] p-10 rounded-[40px] border border-[var(--border-color)] shadow-sm flex flex-col justify-center items-center text-center"
                >
                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-4">Response Rate</p>
                    <p className="text-7xl font-black text-indigo-600 tracking-tighter tabular-nums">{responseRate}%</p>
                    <div className="mt-6 px-4 py-2 bg-indigo/5 text-brand-700 text-[10px] font-black uppercase tracking-widest rounded-full border border-brand-100">
                        Goal: {'>'} 90% for ranking boost
                    </div>
                </motion.div>

                <motion.div
                    whileHover={{ y: -5 }}
                    className="bg-[var(--card-bg)] p-10 rounded-[40px] border border-[var(--border-color)] shadow-sm flex flex-col justify-center items-center text-center"
                >
                    <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-4">Total Review Volume</p>
                    <p className="text-7xl font-black text-[var(--text-primary)] tracking-tighter tabular-nums">{reviews.length}</p>
                    <div className="mt-6 px-4 py-2 bg-slate-50 text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-widest rounded-full border border-slate-100">
                        Verified Guest Reviews
                    </div>
                </motion.div>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[var(--card-bg)] p-10 rounded-[40px] border border-[var(--border-color)] shadow-sm"
            >
                <h3 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-[0.3em] mb-10">Review Volume Trend</h3>
                <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={volumeData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis
                                dataKey="month"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }}
                                dy={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fontWeight: 900, fill: '#94a3b8' }}
                            />
                            <Tooltip
                                cursor={{ fill: '#f8fafc' }}
                                contentStyle={{
                                    borderRadius: '24px',
                                    border: 'none',
                                    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
                                    padding: '16px'
                                }}
                            />
                            <Bar dataKey="count" fill="#0f0d2e" radius={[12, 12, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </motion.div>
        </div>
    );
};

const ReviewDataGrid = ({ reviews }: { reviews: BookingReview[] }) => {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-[var(--card-bg)] rounded-[40px] border border-[var(--border-color)] shadow-sm overflow-hidden"
        >
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-6 py-5 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Date</th>
                            <th className="px-6 py-5 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Score</th>
                            <th className="px-6 py-5 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Guest</th>
                            <th className="px-6 py-5 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Room</th>
                            <th className="px-6 py-5 text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Feedback Summary</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {reviews.map((r, i) => (
                            <tr key={i} className="hover:bg-[var(--bg-main)] transition-colors group">
                                <td className="px-6 py-5">
                                    <span className="text-xs font-black text-[var(--text-secondary)] tabular-nums">{r.reviewDate}</span>
                                </td>
                                <td className="px-6 py-5">
                                    <span className={cn(
                                        "px-3 py-1 rounded-full text-xs font-black tabular-nums",
                                        r.reviewScore >= 8 ? "bg-emerald-50 text-emerald-700" :
                                            r.reviewScore >= 6 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"
                                    )}>
                                        {r.reviewScore}
                                    </span>
                                </td>
                                <td className="px-6 py-5">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-black text-[var(--text-primary)]">{r.reservationNumber}</span>
                                        <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">Res ID</span>
                                    </div>
                                </td>
                                <td className="px-6 py-5">
                                    <span className="text-xs font-bold text-[var(--text-secondary)]">{r.roomName}</span>
                                </td>
                                <td className="px-6 py-5">
                                    <div className="max-w-md">
                                        <p className="text-sm font-black text-[var(--text-primary)] truncate mb-1">{r.translatedTitle || r.reviewTitle || 'No Title'}</p>
                                        <p className="text-xs text-slate-800 line-clamp-1 italic">
                                            {r.translatedPositive || r.positiveReview ? `+ ${r.translatedPositive || r.positiveReview}` : ''}
                                            {r.translatedNegative || r.negativeReview ? ` - ${r.translatedNegative || r.negativeReview}` : ''}
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </motion.div>
    );
};

const FilterBtn = ({ active, onClick, label, count, color = 'brand' }: any) => {
    const colors: any = {
        brand: active ? 'bg-navy text-white shadow-lg shadow-indigo/10' : 'bg-slate-50 text-[var(--text-secondary)] hover:bg-slate-100',
        emerald: active ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
        rose: active ? 'bg-rose-600 text-white shadow-lg shadow-rose-100' : 'bg-rose-50 text-rose-700 hover:bg-rose-100',
    };

    return (
        <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClick}
            className={cn(
                "flex justify-between items-center px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all",
                colors[color]
            )}
        >
            <span>{label}</span>
            <span className="ml-4 opacity-40 tabular-nums">{count}</span>
        </motion.button>
    );
};
