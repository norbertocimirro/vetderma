import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Activity, AlertTriangle, Files, Plus, User, ChevronLeft, ChevronRight, 
  Search, Stethoscope, Save, Trash2, Clock, Image as ImageIcon,
  Folder, FolderOpen, FolderPlus, X, Pill, Microscope, Printer, Edit3,
  MessageCircle, ArrowRight, Lock, Star, CheckCircle, Upload,
  Settings, LogOut, Bell, HelpCircle, LayoutGrid, Zap, ShieldCheck, FileText, Calendar, ScanLine, BrainCircuit
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, setDoc } from 'firebase/firestore';

// --- CONFIGURAÇÃO DE AMBIENTE SEGURA ---
const getEnv = (key) => {
  try { return import.meta.env[key] || ""; } 
  catch (e) { return ""; }
};

const firebaseConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID')
};

const finalConfig = (typeof __firebase_config !== 'undefined') ? JSON.parse(__firebase_config) : firebaseConfig;
const app = initializeApp(finalConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "vet-derma-pro-production"; 

// CHAVES VITAIS
const geminiApiKey = getEnv('VITE_GEMINI_API_KEY');
const STRIPE_CHECKOUT_URL = getEnv('VITE_STRIPE_URL');

// --- COMPONENTES AUXILIARES ---
const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000); 
    return () => clearTimeout(timer);
  }, [onClose]);
  const bg = type === 'success' ? 'bg-teal-600/95' : 'bg-red-500/95';
  return (
    <div className={`fixed top-4 left-4 right-4 z-[100] ${bg} backdrop-blur-md text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-4`}>
      <div className="mt-0.5">{type === 'success' ? <CheckCircle size={20}/> : <AlertTriangle size={20}/>}</div>
      <span className="font-medium text-sm leading-tight break-words flex-1">{message}</span>
      <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors"><X size={16}/></button>
    </div>
  );
};

// --- COMPONENTE PRINCIPAL ---
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [subscription, setSubscription] = useState({ plan: 'free', usage: 0, isPremium: false });
  const [toast, setToast] = useState(null);
  
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [cases, setCases] = useState([]);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [newPatientData, setNewPatientData] = useState({ name: '', species: 'Cão', breed: '', owner: '' });
  const [newCaseData, setNewCaseData] = useState({ description: '', diagnosis: '', treatment: '' });

  // ESTADOS DA IA
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const fileInputRef = useRef(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // 1. Monitor de Autenticação
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) setUser(u);
      else signInAnonymously(auth);
    });
    return () => unsubscribe();
  }, []);

  // 2. Monitor de Assinatura
  useEffect(() => {
    if (!user) return;
    const subRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'subscription');
    return onSnapshot(subRef, (snap) => {
      if (snap.exists()) setSubscription(snap.data());
      else setDoc(subRef, { plan: 'free', usage: 0, isPremium: false });
    });
  }, [user]);

  // 3. Monitor de Pacientes
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'patients'));
    return onSnapshot(q, (s) => {
      const pts = s.docs.map(d => ({ id: d.id, ...d.data() }));
      pts.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      setPatients(pts);
    });
  }, [user]);

  // 4. Monitor de Prontuários do Paciente
  useEffect(() => {
    if (!user || !selectedPatient) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'patients', selectedPatient.id, 'cases'));
    return onSnapshot(q, (s) => {
      const cs = s.docs.map(d => ({ id: d.id, ...d.data() }));
      cs.sort((a, b) => b.date?.toMillis() - a.date?.toMillis());
      setCases(cs);
    });
  }, [user, selectedPatient]);

  const handleRedirectToStripe = () => {
    if (STRIPE_CHECKOUT_URL && user) {
      window.location.href = `${STRIPE_CHECKOUT_URL}?client_reference_id=${user.uid}`;
    } else {
      showToast("Link de pagamento não configurado.", "error");
    }
  };

  // --- LÓGICA DA IA (GEMINI) ---
  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) return showToast("A imagem deve ter menos de 4MB", "error");
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
      setAiResult(null); 
    }
  };

  const analyzeImage = async () => {
    if (!imageFile) return showToast("Por favor, tire ou selecione uma foto.", "error");
    if (!geminiApiKey) return showToast("A chave VITE_GEMINI_API_KEY não foi encontrada no Vercel.", "error");
    
    if (!subscription.isPremium && subscription.usage >= 1) {
      showToast("Você atingiu o limite de análises do plano gratuito.", "error");
      setTimeout(() => setView('settings'), 2000);
      return;
    }

    setIsAnalyzing(true);
    
    try {
      const base64Data = imagePreview.split(',')[1];
      
      const prompt = `Atue como um Especialista em Dermatologia Veterinária. Analise a imagem da lesão na pele deste animal. 
      Retorne APENAS um texto bem formatado em tópicos com as seguintes 3 seções:
      [DESCRIÇÃO DA LESÃO]: (Descreva o que você vê fisicamente na imagem)
      [SUSPEITAS CLÍNICAS]: (Liste de 1 a 3 possíveis diagnósticos dermatológicos)
      [RECOMENDAÇÕES]: (Sugira exames adicionais, raspados ou condutas terapêuticas iniciais). Seja técnico, directo e profissional.`;

      // CORREÇÃO DA AUDITORIA: Utilização do modelo 'gemini-1.5-flash-latest'
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { mimeType: imageFile.type, data: base64Data } }
            ]
          }]
        })
      });

      const data = await response.json();
      
      if(data.error) {
         console.error("Erro da API Google:", data.error);
         throw new Error(data.error.message);
      }

      if (!data.candidates || data.candidates.length === 0) {
          throw new Error("A IA não retornou nenhum resultado. A imagem pode estar ilegível.");
      }

      const textResult = data.candidates[0].content.parts[0].text;
      setAiResult(textResult);

      if (!subscription.isPremium) {
        const subRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'subscription');
        await updateDoc(subRef, { usage: subscription.usage + 1 });
      }

    } catch (err) {
      console.error(err);
      showToast(`Falha na IA: ${err.message}`, "error");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const saveAiResultToPatient = async () => {
    if (!aiResult || !selectedPatient) return;
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'patients', selectedPatient.id, 'cases'), { 
      description: "Análise Assistida por Inteligência Artificial (Gemini Vision).",
      treatment: aiResult,
      date: serverTimestamp(),
      isAiGenerated: true
    });
    showToast("Laudo da IA salvo no prontuário!");
    setView('patientDetail');
    setImageFile(null);
    setImagePreview(null);
    setAiResult(null);
  };


  const renderContent = () => {
    switch(view) {
      case 'dashboard':
        return (
          <div className="pb-24 animate-in fade-in">
            <div className="bg-teal-700 text-white p-6 pt-8 rounded-b-[2rem] shadow-xl">
              <h1 className="text-2xl font-black mb-1 flex items-center gap-2 tracking-tight"><Stethoscope /> Vet Derma Pro</h1>
              <p className="text-[10px] font-bold opacity-80 uppercase tracking-widest">{subscription.isPremium ? 'Membro Premium' : 'Plano de Avaliação'}</p>
              <div className="mt-6 relative">
                <Search className="absolute left-3 top-3.5 text-teal-300" size={18} />
                <input className="w-full bg-teal-800/50 border border-teal-600 rounded-xl py-3 pl-10 text-white placeholder-teal-300 outline-none" placeholder="Buscar paciente..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-center mb-4 text-slate-800">
                <h2 className="font-bold text-lg">Prontuários Ativos</h2>
                <button onClick={() => setView('newPatient')} className="p-3 bg-slate-900 text-white rounded-full shadow-lg active:scale-90 transition-transform"><Plus size={20}/></button>
              </div>
              <div className="space-y-3">
                {patients.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map(p => (
                  <div key={p.id} onClick={() => { setSelectedPatient(p); setView('patientDetail'); }} className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm active:bg-slate-50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${p.species === 'Gato' ? 'bg-orange-50 text-orange-500' : 'bg-teal-50 text-teal-600'}`}>{p.species === 'Gato' ? '🐱' : '🐶'}</div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-base">{p.name}</h3>
                        <p className="text-xs text-slate-400 font-medium">{p.breed} • Tutor(a): {p.owner}</p>
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-slate-300" />
                  </div>
                ))}
                {patients.length === 0 && (
                  <div className="text-center p-8 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
                    <FolderOpen size={48} className="mx-auto mb-3 opacity-50" />
                    <p className="font-medium">Nenhum paciente cadastrado</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'newPatient':
        return (
          <div className="p-6 animate-in slide-in-from-right duration-300">
            <button onClick={() => setView('dashboard')} className="mb-6 flex items-center gap-1 text-slate-500 font-bold"><ChevronLeft /> Voltar</button>
            <div className="bg-white p-6 rounded-3xl space-y-5 shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold text-slate-800 mb-2">Novo Cadastro</h2>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Nome do Paciente</label>
                <input className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500" placeholder="Ex: Rex" value={newPatientData.name} onChange={e => setNewPatientData({...newPatientData, name: e.target.value})} />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Espécie</label>
                  <select className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100" value={newPatientData.species} onChange={e => setNewPatientData({...newPatientData, species: e.target.value})}><option>Cão</option><option>Gato</option></select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Raça</label>
                  <input className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500" placeholder="Poodle" value={newPatientData.breed} onChange={e => setNewPatientData({...newPatientData, breed: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Tutor(a)</label>
                <input className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500" placeholder="Nome Completo" value={newPatientData.owner} onChange={e => setNewPatientData({...newPatientData, owner: e.target.value})} />
              </div>
              <button onClick={async () => {
                if(!newPatientData.name) return showToast("Preencha o nome!", "error");
                await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'patients'), { ...newPatientData, createdAt: serverTimestamp() });
                setNewPatientData({ name: '', species: 'Cão', breed: '', owner: '' });
                setView('dashboard');
                showToast("Paciente cadastrado!");
              }} className="w-full py-4 mt-4 bg-teal-600 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all text-lg">Salvar Paciente</button>
            </div>
          </div>
        );

      case 'patientDetail':
        if(!selectedPatient) return null;
        return (
          <div className="pb-24 animate-in slide-in-from-right duration-300">
             <div className="bg-slate-900 text-white p-6 pt-8 rounded-b-[2rem] shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10"><Stethoscope size={100}/></div>
                <button onClick={() => setView('dashboard')} className="mb-4 flex items-center gap-1 text-slate-300 hover:text-white transition-colors relative z-10"><ChevronLeft /> Voltar</button>
                <div className="flex items-center gap-4 relative z-10">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-inner ${selectedPatient.species === 'Gato' ? 'bg-orange-500/20 text-orange-400' : 'bg-teal-500/20 text-teal-300'}`}>
                    {selectedPatient.species === 'Gato' ? '🐱' : '🐶'}
                  </div>
                  <div>
                    <h1 className="text-3xl font-black tracking-tight">{selectedPatient.name}</h1>
                    <p className="text-sm text-slate-300 mt-1">{selectedPatient.breed} • {selectedPatient.species}</p>
                  </div>
                </div>
             </div>

             <div className="p-6">
                <button onClick={() => setView('aiScanner')} className="w-full bg-gradient-to-r from-teal-500 to-emerald-600 p-5 rounded-2xl text-white shadow-lg mb-8 flex items-center gap-4 active:scale-95 transition-transform">
                  <div className="bg-white/20 p-3 rounded-xl"><BrainCircuit size={28} className="text-white" /></div>
                  <div className="text-left flex-1">
                    <h3 className="font-black text-lg leading-tight shadow-sm">Analisar com IA</h3>
                    <p className="text-xs font-medium text-teal-100 mt-1">Identifique lesões usando foto</p>
                  </div>
                  <ChevronRight size={24} className="text-teal-200"/>
                </button>

                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2"><FileText size={20} className="text-teal-600"/> Histórico Clínico</h2>
                  <button onClick={() => setView('newCase')} className="flex items-center gap-1 px-4 py-2 bg-teal-50 text-teal-700 font-bold rounded-xl text-sm active:bg-teal-100 transition-colors">
                    <Plus size={16}/> Consulta Manual
                  </button>
                </div>

                <div className="space-y-4">
                  {cases.length === 0 ? (
                     <div className="text-center p-8 bg-white border border-slate-100 rounded-2xl shadow-sm">
                        <Activity size={40} className="mx-auto mb-3 text-slate-300" />
                        <p className="font-medium text-slate-600">Nenhum registo clínico.</p>
                     </div>
                  ) : (
                    cases.map(c => (
                      <div key={c.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                        {c.isAiGenerated && <div className="absolute top-0 right-0 bg-teal-500 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest">IA AI-Scanner</div>}
                        <div className="flex items-center gap-2 mb-3 text-xs font-bold text-slate-400 uppercase">
                          <Calendar size={14} />
                          {c.date ? new Date(c.date.toMillis()).toLocaleDateString('pt-BR') : 'Data recente'}
                        </div>
                        <p className="text-sm text-slate-700 mb-3 whitespace-pre-wrap">{c.description}</p>
                        {c.diagnosis && (
                          <div className="p-3 bg-red-50 text-red-800 rounded-xl text-xs mb-2 border border-red-100"><span className="font-bold block mb-1">Diagnóstico:</span>{c.diagnosis}</div>
                        )}
                        {c.treatment && (
                          <div className="p-3 bg-slate-50 text-slate-700 rounded-xl text-xs border border-slate-200 whitespace-pre-wrap"><span className="font-bold block mb-1 text-teal-700">Conduta / Laudo IA:</span>{c.treatment}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
             </div>
          </div>
        );

      case 'aiScanner':
        return (
          <div className="p-6 animate-in slide-in-from-bottom duration-300 pb-24">
            <div className="flex items-center justify-between mb-6">
              <button onClick={() => { setView('patientDetail'); setImagePreview(null); setAiResult(null); }} className="flex items-center gap-1 text-slate-500 font-bold"><ChevronLeft /> Voltar</button>
              <div className="bg-teal-100 text-teal-800 text-[10px] font-black px-3 py-1 rounded-full uppercase flex items-center gap-1"><BrainCircuit size={12}/> Gemini IA</div>
            </div>

            <h2 className="text-2xl font-black text-slate-800 mb-1">Scanner Dermatológico</h2>
            <p className="text-xs text-slate-500 mb-6">Tire uma foto clara da lesão de {selectedPatient?.name} para análise.</p>

            <input type="file" accept="image/*" capture="environment" className="hidden" ref={fileInputRef} onChange={handleImageSelect} />

            {!imagePreview ? (
              <div onClick={() => fileInputRef.current.click()} className="border-2 border-dashed border-teal-300 bg-teal-50 rounded-3xl p-10 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-teal-100 transition-colors">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm text-teal-600 mb-4"><Camera size={32} /></div>
                <h3 className="font-bold text-teal-800">Tirar Foto da Lesão</h3>
                <p className="text-xs text-teal-600/70 mt-1">Use a câmara do seu telemóvel</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative rounded-3xl overflow-hidden border border-slate-200 shadow-sm bg-black">
                  <img src={imagePreview} alt="Preview" className="w-full h-64 object-cover opacity-90" />
                  {isAnalyzing && (
                    <div className="absolute inset-0 scanner-line bg-gradient-to-b from-transparent via-teal-400/50 to-transparent"></div>
                  )}
                  <button onClick={() => { setImagePreview(null); setAiResult(null); }} className="absolute top-3 right-3 bg-white/20 backdrop-blur-md p-2 rounded-full text-white"><X size={20}/></button>
                </div>

                {!aiResult && !isAnalyzing && (
                  <button onClick={analyzeImage} className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-transform flex items-center justify-center gap-2 text-lg">
                    <ScanLine size={20}/> Iniciar Análise IA
                  </button>
                )}

                {isAnalyzing && (
                  <div className="text-center p-6 text-teal-600 font-bold animate-pulse">
                    <BrainCircuit size={32} className="mx-auto mb-2" />
                    A Inteligência Artificial está a analisar as características da lesão...
                  </div>
                )}

                {aiResult && (
                  <div className="bg-white p-5 rounded-2xl border border-teal-200 shadow-lg animate-in fade-in">
                    <h3 className="font-black text-teal-800 mb-3 flex items-center gap-2"><CheckCircle size={18}/> Resultado da Análise</h3>
                    <div className="text-sm text-slate-700 whitespace-pre-wrap font-medium">{aiResult}</div>
                    
                    <button onClick={saveAiResultToPatient} className="w-full mt-6 py-4 bg-teal-600 text-white font-bold rounded-xl shadow-md active:scale-95 transition-transform flex items-center justify-center gap-2">
                      <Save size={18}/> Salvar no Prontuário
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 'newCase':
        return (
          <div className="p-6 animate-in slide-in-from-bottom duration-300 pb-24">
            <button onClick={() => setView('patientDetail')} className="mb-6 flex items-center gap-1 text-slate-500 font-bold"><ChevronLeft /> Cancelar</button>
            <div className="bg-white p-6 rounded-3xl space-y-5 shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold text-slate-800 mb-2">Evolução Manual</h2>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Anamnese / Sintomas</label>
                <textarea rows="3" className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500 transition-all resize-none" placeholder="Descreva os sintomas..." value={newCaseData.description} onChange={e => setNewCaseData({...newCaseData, description: e.target.value})} />
              </div>
              <div className="pt-4 border-t border-slate-100">
                <button onClick={async () => {
                  if(!newCaseData.description) return showToast("A descrição é obrigatória.", "error");
                  await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'patients', selectedPatient.id, 'cases'), { 
                    ...newCaseData, date: serverTimestamp() 
                  });
                  setNewCaseData({ description: '', diagnosis: '', treatment: '' });
                  setView('patientDetail');
                  showToast("Evolução salva!");
                }} className="w-full py-4 bg-teal-600 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all text-lg flex justify-center items-center gap-2">
                  <Save size={20}/> Salvar Evolução
                </button>
              </div>
            </div>
          </div>
        );

      case 'settings':
        return (
          <div className="p-6 animate-in slide-in-from-bottom duration-300">
             <div className="flex items-center gap-2 mb-6">
                <button onClick={() => setView('dashboard')} className="p-2 -ml-2 text-slate-800"><ChevronLeft size={24}/></button>
                <h1 className="font-black text-xl tracking-tight text-slate-800">Minha Clínica</h1>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 border"><User size={30}/></div>
                <div><h3 className="font-bold text-slate-800 text-lg leading-tight">Dr. Cimirro</h3><p className="text-[10px] font-mono text-slate-400 mt-1 truncate w-40">ID: {user?.uid}</p></div>
              </div>
              <div className={`p-5 rounded-2xl border mb-8 ${subscription.isPremium ? 'bg-teal-50 border-teal-100' : 'bg-slate-50 border-slate-100'}`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Assinatura</p>
                <p className={`text-2xl font-black ${subscription.isPremium ? 'text-teal-700' : 'text-slate-800'}`}>{subscription.isPremium ? 'PRO Ilimitado' : 'Versão Trial'}</p>
                {!subscription.isPremium && <p className="text-xs text-slate-500 mt-1">Créditos de IA consumidos: {subscription.usage}/1</p>}
              </div>
              {!subscription.isPremium && (
                <button onClick={handleRedirectToStripe} className="w-full py-5 bg-slate-900 text-white font-bold rounded-2xl shadow-2xl active:scale-95 transition-transform flex items-center justify-center gap-2 text-lg text-center">
                  <Star className="fill-yellow-400 text-yellow-400" size={20} /> Upgrade PRO - R$ 49,90
                </button>
              )}
            </div>
            <button onClick={() => auth.signOut()} className="w-full mt-6 p-4 text-red-600 font-bold flex items-center justify-center gap-2 hover:bg-red-50 rounded-2xl transition-colors"><LogOut size={20}/> Sair da Conta</button>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 max-w-md mx-auto relative shadow-2xl overflow-hidden font-sans border-x border-slate-200">
      <style>{`
        * { -webkit-tap-highlight-color: transparent; }
        body { background-color: #f1f5f9; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        @keyframes scan {
          0% { transform: translateY(-100%); }
          50% { transform: translateY(100%); }
          100% { transform: translateY(-100%); }
        }
        .scanner-line { animation: scan 2.5s ease-in-out infinite; height: 100%; width: 100%; top: 0; }
      `}</style>
      
      {renderContent()}
      
      {(view === 'dashboard' || view === 'settings') && (
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/90 backdrop-blur-lg border-t border-slate-100 flex justify-around py-3 px-6 pb-10 z-50 shadow-lg">
          <button onClick={() => setView('dashboard')} className={`flex flex-col items-center gap-1.5 p-2 transition-all ${view === 'dashboard' ? 'text-teal-600' : 'text-slate-400'}`}>
            <LayoutGrid size={24} />
            <p className="text-[10px] font-black uppercase tracking-tighter">Dashboard</p>
          </button>
          <button onClick={() => setView('settings')} className={`flex flex-col items-center gap-1.5 p-2 transition-all ${view === 'settings' ? 'text-teal-600' : 'text-slate-400'}`}>
            <Settings size={24} />
            <p className="text-[10px] font-black uppercase tracking-tighter">Ajustes</p>
          </button>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
