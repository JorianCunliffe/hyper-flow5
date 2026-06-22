import React, { useState } from 'react';
import { Cloud, ShieldAlert, CheckCircle2, LogOut, History, Database, AlertTriangle, ArrowRight, X } from 'lucide-react';
import { firebaseService } from '../../services/firebaseService';

interface CloudSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  cloudStatus: 'disconnected' | 'syncing' | 'connected' | 'error';
  syncError: string | null;
  onDisconnect: () => void;
  onRestoreBackup: () => void;
}

export const CloudSetupModal: React.FC<CloudSetupModalProps> = ({ 
  isOpen, onClose, cloudStatus, syncError, onDisconnect, onRestoreBackup 
}) => {
  const [firebaseConfigInput, setFirebaseConfigInput] = useState('');
  const [configError, setConfigError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSaveFirebaseConfig = () => {
    const success = firebaseService.configure(firebaseConfigInput);
    if (success) {
      onClose();
    } else {
      setConfigError("Invalid configuration format. Please ensure it contains 'databaseURL'.");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-white/20 flex flex-col max-h-[90vh]">
        <div className="p-8 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-2xl ${cloudStatus === 'error' ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'}`}>
                {cloudStatus === 'error' ? <ShieldAlert size={28} /> : <Cloud size={28} />}
              </div>
              <div>
                <h3 className="text-2xl font-black text-slate-900">Cloud Sync Setup</h3>
                <p className="text-sm text-slate-500">Connect to Google Firebase for real-time collaboration.</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={24} /></button>
        </div>
        
        <div className="p-8 overflow-y-auto">
          {firebaseService.isConfigured() ? (
            <div className="space-y-6">
              <div className="text-center">
                {cloudStatus === 'error' ? (
                  <div className="w-20 h-20 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                      <ShieldAlert size={40} />
                  </div>
                ) : (
                  <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={40} />
                  </div>
                )}
                
                <h4 className="text-xl font-bold text-slate-800">
                  {cloudStatus === 'error' ? 'Sync Paused - Error' : 'You are connected!'}
                </h4>
                
                {cloudStatus === 'error' && (
                    <p className="text-red-600 font-bold bg-red-50 p-2 rounded-lg mt-2 text-sm">{syncError}</p>
                )}

                <p className="text-slate-500 max-w-md mx-auto mt-2">
                  Your projects are configured to sync with Firebase.
                </p>
                <button 
                  onClick={onDisconnect}
                  className="bg-red-50 text-red-600 font-bold px-6 py-3 rounded-xl hover:bg-red-100 transition-colors flex items-center gap-2 mx-auto mt-6"
                >
                  <LogOut size={18} /> Disconnect & Switch to Local
                </button>
              </div>

              <div className="border-t border-slate-100 pt-6 mt-6">
                <h5 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <History size={18} className="text-indigo-600" /> Disaster Recovery
                </h5>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Restore from Safety Backup</p>
                    <p className="text-xs text-slate-500 mt-1">
                      If your data disappeared, use this to revert to the last successful download from the cloud.
                    </p>
                  </div>
                  <button 
                    onClick={onRestoreBackup}
                    className="bg-white border-2 border-indigo-100 hover:border-indigo-600 text-indigo-700 font-bold px-4 py-2 rounded-lg transition-colors whitespace-nowrap active:scale-95"
                  >
                    Restore Backup
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
                <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Database size={18} className="text-indigo-600" />
                  How to get your credentials:
                </h4>
                <ol className="space-y-3 text-sm text-slate-600 list-decimal pl-5">
                  <li>Go to <a href="https://console.firebase.google.com" target="_blank" className="text-indigo-600 font-bold hover:underline">console.firebase.google.com</a> and create a new project.</li>
                  <li>In the project overview, click the <strong>Web (&lt;/&gt;)</strong> icon to register a web app.</li>
                  <li>Copy the <code>firebaseConfig</code> object shown in the setup step.</li>
                  <li>Make sure to enable <strong>Realtime Database</strong> in the Firebase console sidebar.</li>
                  <li>Start in <strong>Test Mode</strong> for development (or configure rules for read/write).</li>
                </ol>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Firebase Configuration</label>
                <textarea 
                  className="w-full h-48 bg-slate-900 text-slate-50 font-mono text-xs p-4 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 resize-none border border-slate-800"
                  placeholder={`const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  databaseURL: "...",\n  projectId: "...",\n  storageBucket: "...",\n  messagingSenderId: "...",\n  appId: "..."\n};`}
                  value={firebaseConfigInput}
                  onChange={(e) => { setFirebaseConfigInput(e.target.value); setConfigError(null); }}
                />
                {configError && <p className="text-red-500 text-xs font-bold flex items-center gap-1"><AlertTriangle size={12} /> {configError}</p>}
                <p className="text-[10px] text-slate-400">Paste the full code block or just the JSON object.</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button onClick={onClose} className="px-6 py-3 font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-xl transition-colors">Cancel</button>
                  <button 
                    onClick={handleSaveFirebaseConfig}
                    disabled={!firebaseConfigInput.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-8 py-3 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center gap-2"
                  >
                    Connect Cloud <ArrowRight size={18} />
                  </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};