import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Activity, AlertTriangle, Files, Plus, User, ChevronLeft, ChevronRight, 
  Search, Stethoscope, Save, Trash2, Clock, Image as ImageIcon,
  Folder, FolderOpen, FolderPlus, X, Pill, Microscope, Printer, Edit3,
  MessageCircle, ArrowRight, Lock, Star, CheckCircle, Upload,
  Settings, LogOut, Bell, HelpCircle, LayoutGrid, Zap, ShieldCheck, FileText, Calendar, ScanLine, BrainCircuit,
  ClipboardList
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getStorage, ref, uploadString, getDownloadURL, deleteObject } from 'firebase/storage';

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
const storage = getStorage(app);
const appId = "vet-derma-pro-production"; 

const geminiApiKey = getEnv('VITE_GEMINI_API_KEY');
const STRIPE_CHECKOUT_URL = getEnv('VITE_STRIPE_URL');

// --- COMPONENTES AUXILIARES ---
const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000); 
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

const DeleteConfirmModal = ({ isOpen, onConfirm, onCancel }) => {
  if(!isOpen) return null;
  return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white p-6 rounded-3xl w-full max-w-sm shadow-2xl animate-in zoom-in-95">
              <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
                  <AlertTriangle size={24} />
              </div>
              <h3 className="font-black text-lg text-slate-800 mb-2">Excluir Prontuário?</h3>
              <p className="text-sm text-slate-500 mb-6 font-medium">Esta ação não pode ser desfeita. O laudo será permanentemente apagado da ficha do paciente.</p>
              <div className="flex gap-3">
                  <button onClick={onCancel} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl active:scale-95 transition-transform">Cancelar</button>
                  <button onClick={onConfirm} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-600/20 active:scale-95 transition-transform">Sim, Excluir</button>
              </div>
          </div>
      </div>
  )
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

  // ESTADOS DA IA E ARMAZENAMENTO
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [scanContext, setScanContext] = useState(''); 
  const fileInputRef = useRef(null);

  // ESTADOS DE EDIÇÃO E EXCLUSÃO
  const [caseToDelete, setCaseToDelete] = useState(null);
  const [editingCase, setEditingCase] = useState(null); // Armazena os dados do caso em edição

  const showToast = (message, type = 'success') => setToast({ message, type });

  // 1. Monitor de Autenticação
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) setUser(u);
      else signInAnonymously(auth);
    });
    return () => unsubscribe();
  }, []);

  // 2. Monitor de Subscrição
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

  // 4. Monitor de Fichas Clínicas (Casos) do Paciente
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

  // --- TRADUTOR DE MARKDOWN PARA UI CLÍNICA ---
  const formatClinicalText = (text) => {
    if (!text) return null;
    const sections = text.split(/(?=###\s)/);

    return sections.map((section, index) => {
      if (!section.trim()) return null;

      const lines = section.trim().split('\n');
      let title = "DETALHES CLÍNICOS";
      let contentLines = lines;
      let isMainSection = false;

      if (lines[0].startsWith('###')) {
        title = lines[0].replace(/###/g, '').trim();
        contentLines = lines.slice(1);
        isMainSection = true;
      }

      let cardColor = "border-slate-200 bg-white";
      let headerColor = "text-slate-700";
      let Icon = Activity;

      const upperTitle = title.toUpperCase();
      if (upperTitle.includes('DESCRIÇÃO')) {
        cardColor = "border-blue-200 bg-blue-50/50 shadow-blue-900/5";
        headerColor = "text-blue-800";
        Icon = Microscope;
      } else if (upperTitle.includes('SUSPEITA') || upperTitle.includes('DIAGNÓSTICO')) {
        cardColor = "border-amber-200 bg-amber-50/50 shadow-amber-900/5";
        headerColor = "text-amber-800";
        Icon = AlertTriangle;
      } else if (upperTitle.includes('RECOMENDAÇÃO') || upperTitle.includes('CONDUTA')) {
        cardColor = "border-emerald-200 bg-emerald-50/50 shadow-emerald-900/5";
        headerColor = "text-emerald-800";
        Icon = Pill;
      }

      return (
        <div key={index} className={`mb-4 rounded-2xl border ${cardColor} p-4 shadow-sm relative overflow-hidden transition-all duration-300 hover:shadow-md`}>
          {isMainSection && (
            <div className={`flex items-center gap-2 mb-3 pb-3 border-b border-slate-900/5 ${headerColor}`}>
              <div className="p-1.5 rounded-lg bg-white/60 shadow-sm">
                <Icon size={18} strokeWidth={2.5} />
              </div>
              <h4 className="font-black text-[12px] uppercase tracking-widest">{title}</h4>
            </div>
          )}
          
          <div className="space-y-2">
            {contentLines.map((line, i) => {
              const cleanLine = line.trim();
              if (!cleanLine) return <div key={i} className="h-1"></div>;
              const isListItem = cleanLine.startsWith('*') && !cleanLine.startsWith('**');
              let lineContent = cleanLine.replace(/^\*\s/, '').trim();
              const parts = lineContent.split(/\*\*(.*?)\*\*/g);

              return (
                <div key={i} className={`flex text-[13px] text-slate-700 leading-relaxed ${isListItem ? 'ml-1' : ''}`}>
                  {isListItem && <div className={`${headerColor} opacity-70 font-black mr-2 mt-0.5`}>•</div>}
                  <div className="flex-1">
                    {parts.map((part, pIndex) => pIndex % 2 === 1 ? <strong key={pIndex} className="text-slate-900 font-extrabold">{part}</strong> : part)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    });
  };

  // --- LÓGICA DA IA ---
  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) return showToast("A imagem deve ter menos de 4MB", "error");
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
      setAiResult(null); 
      setScanContext(''); 
    }
  };

  const analyzeImage = async () => {
    if (!imageFile) return showToast("Por favor, tire ou selecione uma fotografia.", "error");
    if (!geminiApiKey) return showToast("Chave da IA não encontrada.", "error");
    
    if (!subscription.isPremium && subscription.usage >= 50) {
      showToast("Atingiu o limite do plano gratuito.", "error");
      setTimeout(() => setView('settings'), 2000);
      return;
    }

    setIsAnalyzing(true);
    
    try {
      const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`);
      const modelsData = await modelsRes.json();
      if (modelsData.error) throw new Error(modelsData.error.message);

      let validModels = modelsData.models
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace('models/', ''));

      validModels.sort((a, b) => {
        let scoreA = 0; let scoreB = 0;
        if (a.includes('1.5-pro')) scoreA += 100; else if (a.includes('pro')) scoreA += 50;
        if (a.includes('1.5-flash')) scoreA += 30; else if (a.includes('flash')) scoreA += 10;
        if (b.includes('1.5-pro')) scoreB += 100; else if (b.includes('pro')) scoreB += 50;
        if (b.includes('1.5-flash')) scoreB += 30; else if (b.includes('flash')) scoreB += 10;
        return scoreB - scoreA;
      });

      const base64Data = imagePreview.split(',')[1];
      const mimeType = imagePreview.split(';')[0].split(':')[1];
      const contextStr = scanContext.trim() !== '' ? `\n- Anamnese/Sintomas relatados: ${scanContext}` : '\n- Anamnese: Não fornecida. Apenas exame visual.';

      const prompt = `Atue EXCLUSIVAMENTE como um Médico Veterinário Especialista em Dermatologia com vasto conhecimento clínico.
      DADOS CLÍNICOS DO PACIENTE:
      - Espécie: ${selectedPatient?.species || 'Não informada'}
      - Raça: ${selectedPatient?.breed || 'Não informada'}${contextStr}
      
      O seu objetivo é fornecer o diagnóstico diferencial MAIS PRECISO possível.
      INSTRUÇÕES DE RACIOCÍNIO (Chain of Thought):
      1. Se a anamnese mencionar idade jovem e a lesão for um nódulo alopécico circular, considere fortemente Histiocitoma Canino Benigno ou Dermatofitose.
      2. Se for um nódulo crústico com eritema, considere Piodermite Bacteriana, Demodiciose Localizada ou Mastocitoma.
      3. CRUZE a apresentação visual estritamente com os sintomas descritos na anamnese. 
      4. Se a lesão não for compatível com "Alergia a Pulgas", NÃO sugira alergia a pulgas.
      
      Gere o laudo clínico estruturado EXACTAMENTE com estes três títulos em Markdown (NÃO adicione outros):
      
      ### DESCRIÇÃO DA LESÃO
      [Descreva os padrões morfológicos primários e secundários (ex: pápula, crosta, alopecia focal, colar epidérmico).]
      
      ### SUSPEITAS CLÍNICAS (DIAGNÓSTICO DIFERENCIAL)
      [Liste de 1 a 3 diagnósticos exatos. Seja muito específico. Justifique brevemente cada um relacionando o que vê com a anamnese.]
      
      ### RECOMENDAÇÕES E CONDUTA
      [Especifique os exames e indique a abordagem terapêutica preliminar.]`;

      let finalData = null;
      let lastError = "Nenhum modelo compatível encontrado.";
      let success = false;

      for (const model of validModels) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: mimeType, data: base64Data } }] }],
              generationConfig: { temperature: 0.3 }
            })
          });

          const data = await response.json();
          if (data.error) { lastError = data.error.message; continue; }
          if (data.candidates && data.candidates.length > 0) { finalData = data; success = true; break; }
        } catch (err) { lastError = err.message; }
      }

      if (!success) throw new Error(lastError);

      const textResult = finalData.candidates[0].content.parts[0].text;
      setAiResult(textResult);

      if (!subscription.isPremium) {
        const subRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'subscription');
        await updateDoc(subRef, { usage: subscription.usage + 1 });
      }

    } catch (err) {
      showToast(`Falha: ${err.message}`, "error");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const saveAiResultToPatient = async () => {
    if (!aiResult || !selectedPatient || !user) return;
    setIsSavingRecord(true);
    
    try {
      let imageUrl = null;
      // Salvar a imagem no Firebase Storage
      if (imagePreview) {
        const imageName = `image_${Date.now()}.jpg`;
        const storageRef = ref(storage, `artifacts/${appId}/users/${user.uid}/patients/${selectedPatient.id}/cases/${imageName}`);
        await uploadString(storageRef, imagePreview, 'data_url');
        imageUrl = await getDownloadURL(storageRef);
      }

      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'patients', selectedPatient.id, 'cases'), { 
        description: `Análise Assistida por IA.\n${scanContext ? 'Sintomas relatados: ' + scanContext : ''}`,
        treatment: aiResult,
        date: serverTimestamp(),
        isAiGenerated: true,
        imageUrl: imageUrl // URL da foto salva
      });
      
      showToast("Laudo e foto guardados no prontuário!");
      setView('patientDetail');
      setImageFile(null);
      setImagePreview(null);
      setAiResult(null);
      setScanContext('');
    } catch (error) {
      console.error(error);
      showToast("Erro ao guardar a imagem. Verificou as regras do Storage?", "error");
    } finally {
      setIsSavingRecord(false);
    }
  };

  // --- FUNÇÕES DE EXCLUSÃO E EDIÇÃO ---
  const handleDeleteCase = async () => {
    if (!caseToDelete || !user || !selectedPatient) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'patients', selectedPatient.id, 'cases', caseToDelete.id));
      showToast("Prontuário excluído com sucesso.");
      setCaseToDelete(null);
    } catch (error) {
      showToast("Erro ao excluir.", "error");
    }
  };

  const openEditCase = (c) => {
    setEditingCase({
      id: c.id,
      description: c.description || '',
      diagnosis: c.diagnosis || '',
      treatment: c.treatment || '',
      isAiGenerated: c.isAiGenerated || false
    });
    setView('editCase');
  };

  const saveEditedCase = async () => {
    if (!editingCase || !user || !selectedPatient) return;
    try {
      const caseRef = doc(db, 'artifacts', appId, 'users', user.uid, 'patients', selectedPatient.id, 'cases', editingCase.id);
      await updateDoc(caseRef, {
        description: editingCase.description,
        diagnosis: editingCase.diagnosis,
        treatment: editingCase.treatment,
        // Não alteramos a data para preservar o histórico original, ou poderíamos adicionar 'updatedAt'
      });
      showToast("Prontuário atualizado!");
      setView('patientDetail');
      setEditingCase(null);
    } catch (error) {
      showToast("Erro ao atualizar.", "error");
    }
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
                <input className="w-full bg-teal-800/50 border border-teal-600 rounded-xl py-3 pl-10 text-white placeholder-teal-300 outline-none" placeholder="Pesquisar paciente..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-center mb-4 text-slate-800">
                <h2 className="font-bold text-lg">Fichas Clínicas Ativas</h2>
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
                    <p className="font-medium">Nenhum paciente registado</p>
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
              <h2 className="text-xl font-bold text-slate-800 mb-2">Novo Registo</h2>
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
                  <input className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500" placeholder="Ex: Poodle" value={newPatientData.breed} onChange={e => setNewPatientData({...newPatientData, breed: e.target.value})} />
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
                showToast("Paciente registado!");
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
                    <p className="text-xs font-medium text-teal-100 mt-1">Foto, Laudo e Contexto Clínico</p>
                  </div>
                  <ChevronRight size={24} className="text-teal-200"/>
                </button>

                <div className="flex justify-between items-center mb-6">
                  <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2"><FileText size={20} className="text-teal-600"/> Histórico de Prontuários</h2>
                  <button onClick={() => setView('newCase')} className="flex items-center gap-1 px-4 py-2 bg-teal-50 text-teal-700 font-bold rounded-xl text-sm active:bg-teal-100 transition-colors">
                    <Plus size={16}/> Inserir Manual
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
                      <div key={c.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group">
                        
                        {/* Ações do Prontuário (Editar / Excluir) */}
                        <div className="absolute top-4 right-4 flex items-center gap-2 opacity-90">
                           <button onClick={() => openEditCase(c)} className="p-2 bg-slate-50 text-slate-500 hover:text-teal-600 rounded-lg transition-colors"><Edit3 size={16}/></button>
                           <button onClick={() => setCaseToDelete(c)} className="p-2 bg-slate-50 text-slate-500 hover:text-red-600 rounded-lg transition-colors"><Trash2 size={16}/></button>
                        </div>

                        {c.isAiGenerated && <div className="absolute top-0 left-0 bg-teal-500 text-white text-[9px] font-black px-3 py-1 rounded-br-xl uppercase tracking-widest flex items-center gap-1"><BrainCircuit size={10}/> Laudo IA</div>}
                        
                        <div className={`flex items-center gap-2 mb-4 text-xs font-bold text-slate-400 uppercase ${c.isAiGenerated ? 'mt-4' : ''}`}>
                          <Clock size={14} />
                          {c.date ? new Date(c.date.toMillis()).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data recente'}
                        </div>

                        {/* Imagem do Prontuário (se existir) */}
                        {c.imageUrl && (
                          <div className="mb-4 rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
                            <img src={c.imageUrl} alt="Lesão" className="w-full h-48 object-cover hover:h-auto transition-all cursor-pointer" />
                          </div>
                        )}

                        {c.isAiGenerated ? (
                          <div className="mt-2 -mx-1">
                            {c.description.includes('Sintomas') && (
                                <div className="bg-slate-50 p-3 rounded-xl text-xs text-slate-600 mb-3 font-medium border border-slate-100 flex gap-2 items-start">
                                    <User size={14} className="text-slate-400 mt-0.5 shrink-0"/>
                                    "{c.description.replace('Análise Assistida por IA.\nSintomas relatados: ', '')}"
                                </div>
                            )}
                            {formatClinicalText(c.treatment)}
                          </div>
                        ) : (
                          <>
                            <p className="text-sm text-slate-700 mb-3 whitespace-pre-wrap leading-relaxed">{c.description}</p>
                            {c.diagnosis && <div className="p-3 bg-red-50 text-red-800 rounded-xl text-xs mb-2 border border-red-100"><span className="font-bold block mb-1 uppercase tracking-wider text-[10px]">Diagnóstico:</span>{c.diagnosis}</div>}
                            {c.treatment && <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs border border-emerald-100 whitespace-pre-wrap"><span className="font-bold block mb-1 uppercase tracking-wider text-[10px]">Conduta / Tratamento:</span>{c.treatment}</div>}
                          </>
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
              <button onClick={() => { setView('patientDetail'); setImagePreview(null); setAiResult(null); setScanContext(''); }} className="flex items-center gap-1 text-slate-500 font-bold"><ChevronLeft /> Voltar</button>
              <div className="bg-teal-100 text-teal-800 text-[10px] font-black px-3 py-1 rounded-full uppercase flex items-center gap-1"><BrainCircuit size={12}/> Scanner IA</div>
            </div>

            <h2 className="text-2xl font-black text-slate-800 mb-1">Análise Dermatológica</h2>
            <p className="text-xs text-slate-500 mb-6">Tire uma fotografia ou escolha da galeria para avaliar {selectedPatient?.name} ({selectedPatient?.breed}).</p>

            {!imagePreview ? (
              <div className="flex flex-col gap-4">
                <label className="border-2 border-dashed border-teal-400 bg-teal-50 rounded-3xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-teal-100 transition-colors shadow-sm active:scale-95">
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageSelect} />
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm text-teal-600 mb-3"><Camera size={32} /></div>
                  <h3 className="font-bold text-teal-800 text-lg">Câmera</h3>
                  <p className="text-xs text-teal-600/70 mt-1">Tirar foto na hora</p>
                </label>

                <label className="border-2 border-slate-200 bg-white rounded-3xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-slate-50 transition-colors shadow-sm active:scale-95">
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 mb-2"><ImageIcon size={24} /></div>
                  <h3 className="font-bold text-slate-700">Galeria</h3>
                  <p className="text-xs text-slate-400 mt-1">Escolher foto do celular</p>
                </label>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative rounded-3xl overflow-hidden border border-slate-200 shadow-sm bg-black">
                  <img src={imagePreview} alt="Preview" className="w-full h-64 object-cover opacity-90" />
                  {isAnalyzing && (
                    <div className="absolute inset-0 scanner-line bg-gradient-to-b from-transparent via-teal-400/50 to-transparent"></div>
                  )}
                  <button onClick={() => { setImagePreview(null); setAiResult(null); setScanContext(''); }} className="absolute top-3 right-3 bg-white/20 backdrop-blur-md p-2 rounded-full text-white"><X size={20}/></button>
                </div>

                {!aiResult && !isAnalyzing && (
                  <div className="animate-in fade-in slide-in-from-bottom-2">
                    <div className="mb-4">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 flex items-center gap-1"><Stethoscope size={12}/> Anamnese Breve (Opcional)</label>
                        <textarea 
                            className="w-full mt-1 p-3 bg-white rounded-xl outline-none border border-slate-200 focus:ring-2 focus:ring-teal-500 text-sm shadow-sm transition-all" 
                            placeholder="Ex: Animal tem 5 meses. Lesão cresceu rápido. Não tem prurido." 
                            value={scanContext} 
                            onChange={e => setScanContext(e.target.value)} 
                            rows="2"
                        />
                    </div>
                    <button onClick={analyzeImage} className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-transform flex items-center justify-center gap-2 text-lg">
                        <ScanLine size={20}/> Gerar Laudo Clínico
                    </button>
                  </div>
                )}

                {isAnalyzing && (
                  <div className="text-center p-6 text-teal-600 font-bold animate-pulse flex flex-col items-center justify-center">
                    <BrainCircuit size={32} className="mx-auto mb-3 animate-bounce" />
                    <p>A cruzar evidências visuais com anamnese...</p>
                    <p className="text-xs opacity-70 mt-1">A elaborar hipóteses diagnósticas.</p>
                  </div>
                )}

                {aiResult && (
                  <div className="bg-slate-100 p-3 rounded-3xl border border-slate-200 shadow-inner animate-in fade-in">
                    <div className="bg-teal-600 text-white mb-3 p-4 rounded-2xl shadow-sm flex items-center gap-3">
                      <ClipboardList size={24} className="opacity-90"/> 
                      <div>
                        <h3 className="font-black text-lg leading-none">Laudo Concluído</h3>
                        <p className="text-[10px] text-teal-100 uppercase tracking-wider mt-1">Vet Derma Pro IA Especialista</p>
                      </div>
                    </div>
                    
                    <div className="max-h-[65vh] overflow-y-auto pr-1 custom-scrollbar">
                      {formatClinicalText(aiResult)}
                    </div>
                    
                    <button disabled={isSavingRecord} onClick={saveAiResultToPatient} className={`w-full mt-4 py-4 ${isSavingRecord ? 'bg-teal-800' : 'bg-teal-600'} text-white font-black text-lg rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 border-b-4 border-teal-800`}>
                      {isSavingRecord ? <><Activity className="animate-spin" size={20}/> Guardando Foto e Laudo...</> : <><Save size={20}/> Guardar no Prontuário</>}
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
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Anamnese / Evolução</label>
                <textarea rows="3" className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500 transition-all resize-none" placeholder="Descreva a evolução do paciente..." value={newCaseData.description} onChange={e => setNewCaseData({...newCaseData, description: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Diagnóstico / Suspeita (Opcional)</label>
                <input className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500 transition-all" placeholder="Ex: Dermatite Atópica" value={newCaseData.diagnosis} onChange={e => setNewCaseData({...newCaseData, diagnosis: e.target.value})} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Conduta / Tratamento (Opcional)</label>
                <textarea rows="2" className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500 transition-all resize-none" placeholder="Prescrição e recomendações..." value={newCaseData.treatment} onChange={e => setNewCaseData({...newCaseData, treatment: e.target.value})} />
              </div>
              <div className="pt-4 border-t border-slate-100">
                <button onClick={async () => {
                  if(!newCaseData.description) return showToast("A descrição principal é obrigatória.", "error");
                  await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'patients', selectedPatient.id, 'cases'), { 
                    ...newCaseData, date: serverTimestamp() 
                  });
                  setNewCaseData({ description: '', diagnosis: '', treatment: '' });
                  setView('patientDetail');
                  showToast("Evolução guardada com sucesso!");
                }} className="w-full py-4 bg-teal-600 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all text-lg flex justify-center items-center gap-2">
                  <Save size={20}/> Guardar Prontuário
                </button>
              </div>
            </div>
          </div>
        );

      case 'editCase':
        if (!editingCase) return null;
        return (
          <div className="p-6 animate-in slide-in-from-bottom duration-300 pb-24">
            <button onClick={() => { setView('patientDetail'); setEditingCase(null); }} className="mb-6 flex items-center gap-1 text-slate-500 font-bold"><ChevronLeft /> Cancelar</button>
            <div className="bg-white p-6 rounded-3xl space-y-5 shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold text-slate-800 mb-2 flex items-center gap-2"><Edit3 size={20}/> Editar Prontuário</h2>
              
              {editingCase.isAiGenerated && (
                <div className="bg-amber-50 p-3 rounded-xl text-xs text-amber-800 flex items-start gap-2 mb-2">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5"/>
                  <p>Está a editar um laudo gerado pela IA. As alterações que fizer no texto abaixo serão aplicadas diretamente ao formato visual do laudo.</p>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Contexto / Anamnese</label>
                <textarea rows={editingCase.isAiGenerated ? 2 : 3} className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500 transition-all resize-none" value={editingCase.description} onChange={e => setEditingCase({...editingCase, description: e.target.value})} />
              </div>
              
              {!editingCase.isAiGenerated && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Diagnóstico / Suspeita</label>
                  <input className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500 transition-all" value={editingCase.diagnosis} onChange={e => setEditingCase({...editingCase, diagnosis: e.target.value})} />
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">{editingCase.isAiGenerated ? 'Texto do Laudo (Markdown)' : 'Conduta / Tratamento'}</label>
                <textarea rows={editingCase.isAiGenerated ? 10 : 3} className="w-full mt-1 p-4 bg-slate-50 rounded-xl outline-none border border-slate-100 focus:ring-2 focus:ring-teal-500 transition-all resize-none text-xs font-mono" value={editingCase.treatment} onChange={e => setEditingCase({...editingCase, treatment: e.target.value})} />
              </div>
              
              <div className="pt-4 border-t border-slate-100">
                <button onClick={saveEditedCase} className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all text-lg flex justify-center items-center gap-2">
                  <Save size={20}/> Atualizar Prontuário
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
                <h1 className="font-black text-xl tracking-tight text-slate-800">A Minha Clínica</h1>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 border"><User size={30}/></div>
                <div><h3 className="font-bold text-slate-800 text-lg leading-tight">Dr. Cimirro</h3><p className="text-[10px] font-mono text-slate-400 mt-1 truncate w-40">ID: {user?.uid}</p></div>
              </div>
              <div className={`p-5 rounded-2xl border mb-8 ${subscription.isPremium ? 'bg-teal-50 border-teal-100' : 'bg-slate-50 border-slate-100'}`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Subscrição</p>
                <p className={`text-2xl font-black ${subscription.isPremium ? 'text-teal-700' : 'text-slate-800'}`}>{subscription.isPremium ? 'PRO Ilimitado' : 'Versão Trial'}</p>
                {!subscription.isPremium && <p className="text-xs text-slate-500 mt-1">Créditos de IA consumidos: {subscription.usage}/50</p>}
              </div>
              {!subscription.isPremium && (
                <button onClick={handleRedirectToStripe} className="w-full py-5 bg-slate-900 text-white font-bold rounded-2xl shadow-2xl active:scale-95 transition-transform flex items-center justify-center gap-2 text-lg text-center">
                  <Star className="fill-yellow-400 text-yellow-400" size={20} /> Actualizar para PRO - R$ 49,90
                </button>
              )}
            </div>
            <button onClick={() => auth.signOut()} className="w-full mt-6 p-4 text-red-600 font-bold flex items-center justify-center gap-2 hover:bg-red-50 rounded-2xl transition-colors"><LogOut size={20}/> Terminar Sessão</button>
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
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
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
            <p className="text-[10px] font-black uppercase tracking-tighter">Início</p>
          </button>
          <button onClick={() => setView('settings')} className={`flex flex-col items-center gap-1.5 p-2 transition-all ${view === 'settings' ? 'text-teal-600' : 'text-slate-400'}`}>
            <Settings size={24} />
            <p className="text-[10px] font-black uppercase tracking-tighter">Definições</p>
          </button>
        </div>
      )}
      
      <DeleteConfirmModal 
        isOpen={!!caseToDelete} 
        onConfirm={handleDeleteCase} 
        onCancel={() => setCaseToDelete(null)} 
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
