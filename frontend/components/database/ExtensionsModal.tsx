
import React, { useState, useMemo } from 'react';
import { Search, Puzzle, X, Loader2, Info, CheckCircle2, Cloud, Database, Shield, FileText, Code2, Globe, Clock, Wrench, Zap, Share2, Lock, AlertTriangle } from 'lucide-react';
import { EXTENSIONS_CATALOG, ExtensionMeta } from '../../lib/pg-extensions';

interface ExtensionStatus {
    name: string;
    default_version: string;
    installed_version: string | null;
    comment?: string;
    tier?: number | 'shared';
    weight?: string;
    available?: boolean;
}

interface ExtensionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    installedExtensions: ExtensionStatus[];
    onToggle: (name: string, enable: boolean) => Promise<void>;
    loadingName: string | null;
    onSetupGeo?: () => Promise<void>;
}

// Helper icon component
const BrainIcon = ({ size, className }: any) => <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" /></svg>;

const CATEGORIES = [
    { id: 'All', label: 'All', icon: Puzzle },
    { id: 'AI', label: 'AI & Vector', icon: BrainIcon },
    { id: 'Geo', label: 'GeoSpatial', icon: Globe },
    { id: 'Crypto', label: 'Crypto', icon: Shield },
    { id: 'Search', label: 'Search', icon: Search },
    { id: 'DataType', label: 'Data Types', icon: FileText },
    { id: 'Net', label: 'Network', icon: Cloud },
    { id: 'Admin', label: 'Admin', icon: Wrench }
];

const TIER_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
    '0': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Core' },
    '1': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Essential' },
    '2': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Extended' },
    '3': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', label: 'Heavy' },
    'shared': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', label: 'Shared' },
};

const ExtensionsModal: React.FC<ExtensionsModalProps> = ({ isOpen, onClose, installedExtensions, onToggle, loadingName, onSetupGeo }) => {
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState('All');

    // Create a set of available extension names from the DB query
    const availableSet = useMemo(() => {
        return new Set(installedExtensions.map(e => e.name));
    }, [installedExtensions]);

    // Merge logic: Combine installed status from DB with rich metadata from static catalog
    const mergedList = useMemo(() => {
        const map = new Map<string, ExtensionMeta & { installed_version: string | null; available: boolean }>();

        // 1. Add all from catalog
        EXTENSIONS_CATALOG.forEach(ext => {
            map.set(ext.name, { ...ext, installed_version: null, available: availableSet.has(ext.name) });
        });

        // 2. Overlay installed status
        installedExtensions.forEach(inst => {
            const existing = map.get(inst.name);
            if (existing) {
                map.set(inst.name, { ...existing, installed_version: inst.installed_version, available: true });
            } else {
                // If extension exists in DB but not in our catalog, add it generically
                map.set(inst.name, {
                    name: inst.name,
                    category: 'Util',
                    description: inst.comment || 'System extension',
                    installed_version: inst.installed_version,
                    available: true,
                    tier: (inst as any).tier ?? 0,
                    weight: (inst as any).weight ?? '0 MB'
                });
            }
        });

        return Array.from(map.values());
    }, [installedExtensions, availableSet]);

    const filteredList = useMemo(() => {
        return mergedList.filter(ext => {
            const matchesSearch = ext.name.toLowerCase().includes(search.toLowerCase()) ||
                ext.description.toLowerCase().includes(search.toLowerCase());
            const matchesCategory = activeCategory === 'All' || ext.category === activeCategory;
            return matchesSearch && matchesCategory;
        }).sort((a, b) => {
            // Sort: Installed first, then available, then featured, then alphabetical
            if (a.installed_version && !b.installed_version) return -1;
            if (!a.installed_version && b.installed_version) return 1;
            if (a.available && !b.available) return -1;
            if (!a.available && b.available) return 1;
            if (a.featured && !b.featured) return -1;
            if (!a.featured && b.featured) return 1;
            return a.name.localeCompare(b.name);
        });
    }, [mergedList, search, activeCategory]);

    if (!isOpen) return null;

    const tierString = (tier: number | 'shared') => String(tier);
    const tierInfo = (tier: number | 'shared') => TIER_COLORS[tierString(tier)] || TIER_COLORS['0'];

    return (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in zoom-in-95">
            <div className="bg-white rounded-[2.5rem] w-full max-w-5xl h-[85vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-200">
                            <Puzzle size={28} />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Extensions Marketplace</h3>
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Supercharge your Postgres • Tier System</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {onSetupGeo && (
                            <button
                                onClick={onSetupGeo}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-purple-200 transition-all"
                            >
                                <Share2 size={14} /> Setup Shared Geo
                            </button>
                        )}
                        <button onClick={onClose} className="p-3 hover:bg-slate-200 rounded-full text-slate-400 transition-colors"><X size={24} /></button>
                    </div>
                </div>

                {/* Tier Legend */}
                <div className="px-8 py-3 border-b border-slate-100 bg-white flex items-center gap-3 overflow-x-auto">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0">Tiers:</span>
                    {Object.entries(TIER_COLORS).map(([key, val]) => (
                        <span key={key} className={`${val.bg} ${val.text} px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider shrink-0 border ${val.border}`}>
                            {key === 'shared' ? '⚡ Shared' : `T${key}`} — {val.label}
                        </span>
                    ))}
                </div>

                {/* Toolbar */}
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row gap-4 items-center bg-white">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search extensions (e.g. vector, geo, crypto)..."
                            className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            autoFocus
                        />
                    </div>
                    <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-1 custom-scrollbar">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${activeCategory === cat.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                            >
                                <cat.icon size={14} /> {cat.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto p-8 bg-[#FAFBFC] custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredList.map(ext => {
                            const ti = tierInfo(ext.tier);
                            const isShared = ext.tier === 'shared';
                            const isAvailable = ext.available;
                            const isInstalled = !!ext.installed_version;
                            const canToggle = isAvailable && !isShared;

                            return (
                                <div key={ext.name} className={`relative flex flex-col bg-white border rounded-[2rem] p-6 transition-all group hover:shadow-xl hover:-translate-y-1 ${isInstalled ? 'border-indigo-200 ring-1 ring-indigo-100' : !isAvailable ? 'border-slate-100 opacity-70' : 'border-slate-200'}`}>
                                    <div className="flex justify-between items-start mb-4">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${isInstalled ? 'bg-indigo-100 text-indigo-600' : isShared ? 'bg-purple-100 text-purple-500' : !isAvailable ? 'bg-slate-50 text-slate-300' : 'bg-slate-100 text-slate-400'}`}>
                                            {ext.category === 'AI' ? <BrainIcon size={20} /> :
                                                ext.category === 'Geo' ? <Globe size={20} /> :
                                                    ext.category === 'Crypto' ? <Shield size={20} /> :
                                                        isShared ? <Share2 size={20} /> :
                                                            <Puzzle size={20} />}
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            {/* Tier Badge */}
                                            <span className={`${ti.bg} ${ti.text} border ${ti.border} px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-wider`}>
                                                {isShared ? '⚡ Shared' : `Tier ${ext.tier}`}
                                            </span>
                                            {/* Toggle or Status */}
                                            {canToggle ? (
                                                <button
                                                    onClick={() => onToggle(ext.name, isInstalled)}
                                                    disabled={loadingName === ext.name}
                                                    className={`w-12 h-7 rounded-full p-1 transition-all duration-300 ${isInstalled ? 'bg-indigo-600' : 'bg-slate-200 hover:bg-slate-300'}`}
                                                >
                                                    <div className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-300 ${isInstalled ? 'translate-x-5' : ''}`}>
                                                        {loadingName === ext.name && <Loader2 size={12} className="animate-spin text-indigo-600 m-0.5" />}
                                                    </div>
                                                </button>
                                            ) : isShared ? (
                                                <span className="flex items-center gap-1 text-[9px] font-black text-purple-500 uppercase">
                                                    <Share2 size={10} /> Via FDW
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 text-[9px] font-black text-slate-400 uppercase">
                                                    <Lock size={10} /> Tier {ext.tier}+
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <h4 className="text-lg font-black text-slate-900 mb-2">{ext.name}</h4>
                                    <p className="text-xs text-slate-500 font-medium leading-relaxed line-clamp-3 mb-4 flex-1">{ext.description}</p>

                                    <div className="mt-auto pt-4 border-t border-slate-50 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded">{ext.category}</span>
                                            {ext.weight !== '0 MB' && (
                                                <span className="text-[9px] font-bold text-slate-300 bg-slate-50 px-2 py-1 rounded">{ext.weight}</span>
                                            )}
                                        </div>
                                        <span className={`text-[10px] font-mono font-bold flex items-center gap-1 ${isInstalled ? 'text-indigo-600' : isAvailable ? 'text-slate-400' : 'text-slate-300'}`}>
                                            {isInstalled ? <CheckCircle2 size={10} /> : !isAvailable ? <AlertTriangle size={10} /> : null}
                                            {isInstalled ? ext.installed_version : !isAvailable ? 'Not in Image' : 'Ready'}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {filteredList.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <Puzzle size={64} className="opacity-20 mb-4" />
                            <p className="font-black uppercase tracking-widest text-xs">No extensions found</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExtensionsModal;